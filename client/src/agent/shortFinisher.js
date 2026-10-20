/**
 * client/src/agent/shortFinisher.js
 *
 * R92 round C: everything a short goes through between "found" and "exported",
 * in one place, used by the Shorts tab (Export and Open as project):
 *   1. its own timeline (agent/shortTimeline.js): sliced, 9:16 speaker crop,
 *      captions in the safe zone;
 *   2. an editorial plan (POST /api/motion/short-plan): AI hook headline and
 *      key words, with a rules fallback;
 *   3. the pro treatment (agent/shortPolish.js): hook title with written
 *      motion, platform captions, camera moves, number pops, transitions,
 *      optional speaker pop-out;
 *   4. sound effects on all of it (agent/sfxCues.js + the sound library), on
 *      their own SFX track of the SHORT, never on the main edit.
 */

import { authFetch } from '../utils/authFetch.js';
import { buildShortTimeline } from './shortTimeline.js';
import { polishShort, shiftToShort } from './shortPolish.js';
import { collectSfxCues, sfxVolume, SFX_QUERIES } from './sfxCues.js';
import { sfxPlayableUrl } from './animateMoments.js';
import { PLATFORM_PROFILES } from './PlatformProfiles.js';

// Each query caches every playable candidate the library returned (up to 5),
// plus a rotation counter -- so repeated calls for the same query (e.g. every
// "whoosh" cue in one short, or across several shorts generated in one
// session, since this cache is module-level) cycle through real variety
// instead of every call freezing onto the first result found. Previously
// this cached a single resolved asset per query, so every transition's sound
// effect in the whole video was the literal same clip.
const sfxCache = new Map();

/** Best library sound for a query, rotating through real candidates on repeat calls for the same query (cached for the session). */
export async function fetchSfxAsset(query) {
    let entry = sfxCache.get(query);
    if (!entry) {
        let candidates = [];
        try {
            const res = await authFetch('/api/audio/search', { method: 'POST', body: JSON.stringify({ query, assetTypes: ['SOUND_EFFECT'], limit: 5 }) });
            const data = await res.json().catch(() => ({}));
            candidates = (Array.isArray(data?.results) ? data.results : []).map(r => r?.asset || r).filter(a => sfxPlayableUrl(a));
        } catch (err) {
            console.warn('[shortFinisher] sound search failed:', err.message);
        }
        entry = { candidates, next: 0 };
        sfxCache.set(query, entry);
    }
    if (entry.candidates.length === 0) return null;
    const asset = entry.candidates[entry.next % entry.candidates.length];
    entry.next += 1;
    return asset;
}

/** Add an SFX track with sounds on the given cues. Returns the number placed. */
export async function addSfxTrack(tracks, cues, level, fetchAsset = fetchSfxAsset) {
    if (level === 'none' || !cues.length) return 0;
    const clips = [];
    for (const cue of cues) {
        // eslint-disable-next-line no-await-in-loop
        const asset = await fetchAsset(SFX_QUERIES[cue.kind] || cue.kind);
        const url = sfxPlayableUrl(asset);
        if (!url) continue;
        clips.push({
            id: `short-sfx-${cue.kind}-${Math.round(cue.t * 1000)}`,
            type: 'audio', name: asset.display_name || asset.name || cue.kind,
            url, src: url, sourceUrl: url, assetId: asset.id || null,
            start: Math.max(0, cue.t), duration: Number(asset.duration) > 0 ? Math.min(3, Number(asset.duration)) : 1,
            volume: sfxVolume(asset.recommended_volume, level), isSFX: true, sfxCue: cue.kind,
        });
    }
    if (clips.length) tracks.push({ id: 'track-short-sfx', type: 'audio', name: 'SFX', clips });
    return clips.length;
}

/** The AI plan for a short, or null (rules then apply). */
export async function fetchShortPlan(text, platform, duration) {
    try {
        const res = await authFetch('/api/motion/short-plan', { method: 'POST', body: JSON.stringify({ text, platform, duration }) });
        const data = await res.json().catch(() => ({}));
        return res.ok ? (data.plan || null) : null;
    } catch (err) {
        console.warn('[shortFinisher] short plan unavailable, using rules:', err.message);
        return null;
    }
}

/**
 * R102 -- the full SceneDirector plan for a short's hook/CTA (POST
 * /api/motion/scene-plan), grounded in the short's own transcript so the
 * beats carry real words instead of SceneDirector's own "YOUR HEADLINE"-
 * style placeholders (it refuses to invent claims -- see SceneDirector.js's
 * own doc comment). The brief here is deliberately generic ("open strong,
 * surface the key point, close with a call to action") because the actual
 * content comes from the transcript; tone is decided client-side (shortPolish
 * always forces 'viral' for this call), not from this brief. Beats are left
 * unspecified so the model decides the full structure itself (R101 PHASE 1)
 * instead of only ever filling words into a fixed shape -- shortPolish then
 * picks just the intro/point/cta beats it has room for.
 */
/**
 * Why the motion route had no plan, in words an operator can act on.
 *
 * All three of these used to arrive as the same `source: 'rules'`, which is
 * why "the provider is set and it STILL says rules" was impossible to debug
 * from the app: a provider deliberately set to deterministic, a provider set
 * to a real model with no working credentials, and a model that was called
 * and errored are three different jobs for whoever owns the deployment.
 */
const SCENE_PLAN_FAILURES = Object.freeze({
    rules_requested: 'the motion provider is set to the deterministic rules (AI_MOTION_PROVIDER=rules), so no model was called',
    provider_unconfigured: 'the motion provider has no working credentials on the server, so no model was called',
    client_initialization_failed: 'the motion model could not be initialised on the server',
    timeout: 'the motion model timed out',
    cancelled: 'the request was cancelled before the model answered',
    no_output: 'the motion model returned nothing usable',
    api_error: 'the motion model returned an error',
    route_error: 'the motion route itself failed',
});

export async function fetchScenePlanResult(text, platform, duration) {
    const none = (reason, source = 'none', techniques = []) => ({ plan: null, source, techniques, reason });
    if (!text) return none('there was no transcript text to plan from');
    const brief = 'A short-form video: open with a strong hook, surface the single most '
        + 'important point or figure, and close with a call to action if the video asks for one.';
    try {
        const res = await authFetch('/api/motion/scene-plan', {
            method: 'POST',
            body: JSON.stringify({ brief, transcript: text, platform, duration }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            // This branch used to `return null` with no log at all. Only a
            // thrown network error was ever reported, so a 500/502/503 from
            // the motion route made the entire scene plan — and with it every
            // technique in the knowledge base — vanish in complete silence.
            console.warn(`[shortFinisher] scene plan request failed (${res.status}); the hook falls back to a single title.`);
            return none(`the motion service answered ${res.status}`, 'error');
        }
        const plan = data.plan || null;
        // The route answers 200 with `plan: null, source: 'rules'` whenever the
        // model is unconfigured or the call failed — so "no techniques because
        // the model chose none" and "no techniques because there was no model"
        // looked identical to the caller. They are not, and only one of them
        // is a motion problem.
        const source = String(data.source || (plan ? 'ai' : 'rules'));
        const techniques = Array.isArray(data.techniques) ? data.techniques : [];
        if (!plan) {
            const why = SCENE_PLAN_FAILURES[data.failureCategory]
                || (data.failureCategory ? `the motion model failed (${data.failureCategory})` : null);
            const named = data.provider ? ` [provider: ${data.provider}]` : '';
            console.warn(`[shortFinisher] no AI scene plan (source=${source}, reason=${data.failureCategory || 'unreported'}${named}); `
                + `${techniques.length} knowledge-base technique(s) were offered and none could be used. `
                + 'The hook falls back to a single title.');
            return none(why
                || (source === 'rules'
                    ? 'the motion AI is not answering, so the deterministic rules were used'
                    : `no plan came back (source: ${source})`), source, techniques);
        }
        return { plan, source, techniques, reason: null };
    } catch (err) {
        console.warn('[shortFinisher] scene plan unavailable, hook stays a single title:', err.message);
        return none(`the motion service could not be reached (${err.message})`, 'error');
    }
}

/**
 * The plan alone. Kept as the original contract for every existing caller and
 * for injected test doubles; `fetchScenePlanResult` is what a caller uses when
 * it needs to tell the user WHY there is no plan.
 */
export async function fetchScenePlan(text, platform, duration) {
    const { plan } = await fetchScenePlanResult(text, platform, duration);
    return plan;
}

/**
 * Build the finished short.
 * @param {object} state useTimelineStore.getState()
 * @param {object} short an entry of state.shorts
 * @param {{polish?:boolean, popOut?:boolean, sfx?:boolean, plan?:object|null, scenePlan?:object|null, fetchPlan?:Function, fetchScenePlan?:Function, fetchAsset?:Function}} opts
 * @returns {Promise<{tracks, duration, aspectRatio, applied:string[], words:Array}>}
 */
export async function finishShort(state, short, opts = {}) {
    const profile = PLATFORM_PROFILES[short?.platform] || PLATFORM_PROFILES.tiktok;
    const pad = { before: 0.15, after: 0.3 };
    const built = buildShortTimeline(state.tracks, short, { assets: state.assets, profile, pad });
    const start = Math.max(0, (Number(short.start) || 0) - pad.before);
    const end = start + built.duration;
    const words = shiftToShort(state.captions || [], start, end, 'start');
    const events = (Array.isArray(short.events) ? short.events : []).map(e => ({ ...e, timelineTime: Number(e.timelineTime) - start }));
    if (opts.polish === false) return { ...built, applied: [], words };

    const text = words.map(w => String(w.word ?? w.text ?? '')).join(' ').slice(0, 2000);
    const [plan, scenePlan] = await Promise.all([
        opts.plan !== undefined ? opts.plan
            : (text ? (opts.fetchPlan || fetchShortPlan)(text, profile.id, built.duration) : null),
        opts.scenePlan !== undefined ? opts.scenePlan
            : (text ? (opts.fetchScenePlan || fetchScenePlan)(text, profile.id, built.duration) : null),
    ]);
    const polished = polishShort(built, profile, { words, events, plan, scenePlan, popOut: !!opts.popOut });
    if (opts.sfx !== false) {
        const placed = await addSfxTrack(polished.tracks, collectSfxCues(polished.tracks, { level: profile.sfx }), profile.sfx, opts.fetchAsset);
        if (placed) polished.applied.push(`sound effects (${placed})`);
    }
    if (plan?.headline) polished.applied.unshift('AI headline');
    return { ...polished, words };
}

export default { finishShort, fetchShortPlan, fetchScenePlan, fetchSfxAsset, addSfxTrack };
