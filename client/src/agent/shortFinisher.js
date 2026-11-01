/**
 * client/src/agent/shortFinisher.js
 *
 * R92 round C: everything a short goes through between "found" and "exported",
 * in one place, used by the Shorts tab (Export and Open as project):
 *   1. its own timeline (agent/shortTimeline.js): sliced, 9:16 speaker crop,
 *      captions in the safe zone;
 *   2. an editorial plan (POST /api/motion/short-plan): AI hook headline and
 *      key words, with a rules fallback;
 *   3. a local, transcript/visual scene plan enriched by the Motion Knowledge
 *      Base; scene structure and timing do not call a generative model;
 *   4. the pro treatment (agent/shortPolish.js): hook title with written
 *      motion, platform captions, camera moves, number pops, transitions,
 *      optional speaker pop-out;
 *   5. sound effects on all of it (agent/sfxCues.js + the sound library), on
 *      their own SFX track of the SHORT, never on the main edit.
 */

import { authFetch } from '../utils/authFetch.js';
import { buildShortTimeline } from './shortTimeline.js';
import { fallbackShortScenePlan, polishShort, shiftToShort } from './shortPolish.js';
import { collectSfxCues, mergeSfxCues, sfxVolume, SFX_QUERIES } from './sfxCues.js';
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

/**
 * The optional headline call has a bounded wait. Scene structure and timing
 * are planned locally; the motion-technique and visual-context lookups are
 * also bounded and never call a generative model.
 */
export const PLAN_TIMEOUT_MS = 35000;
export const MOTION_TECHNIQUE_TIMEOUT_MS = 3000;
export const VISUAL_CONTEXT_TIMEOUT_MS = 3000;

/** authFetch with a deadline. Aborting reads as a normal failure to the caller. */
async function fetchWithTimeout(url, options, ms = PLAN_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    const externalSignal = options?.signal;
    const abortFromExternal = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) abortFromExternal();
    else externalSignal?.addEventListener?.('abort', abortFromExternal, { once: true });
    try {
        return await authFetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
        externalSignal?.removeEventListener?.('abort', abortFromExternal);
    }
}

/**
 * Optional headline plans for one short, kept for the session.
 *
 * Reopening a preview should not repeat a model call for an unchanged
 * transcript. The local scene plan and Motion KB lookup do not use this cache.
 */
const planCache = new Map();
const planKey = (kind, text, platform, duration) => `${kind}|${platform}|${Math.round(Number(duration) * 100)}|${text}`;

async function cachedPlan(kind, text, platform, duration, run) {
    const key = planKey(kind, text, platform, duration);
    if (planCache.has(key)) return planCache.get(key);
    const promise = run();
    // The PROMISE is cached, not its result: two previews started at once
    // share one request instead of racing two identical ones.
    planCache.set(key, promise);
    try {
        const result = await promise;
        // Only a real headline is kept. Caching a failure for the session would
        // mean a model that was briefly down, or one request that timed out,
        // stays "down" for this transcript until the tab is reloaded — and the
        // user's only visible symptom would be a short that never gets its
        // headline, with a retry that cannot possibly help.
        const useful = !!result;
        if (!useful) planCache.delete(key);
        return result;
    } catch (err) {
        planCache.delete(key);
        throw err;
    }
}

/** Forget the cached plans (the transcript changed, or a retry is wanted). */
export function clearPlanCache() {
    planCache.clear();
}

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
        const asset = await fetchAsset(cue.query || SFX_QUERIES[cue.kind] || cue.kind);
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

/** Optional AI headline/keyword suggestion, or null (local copy applies). */
export async function fetchShortPlan(text, platform, duration) {
    return cachedPlan('short', text, platform, duration, async () => {
        try {
            const res = await fetchWithTimeout('/api/motion/short-plan', {
                method: 'POST',
                body: JSON.stringify({ text, platform, duration }),
            });
            const data = await res.json().catch(() => ({}));
            return res.ok ? (data.plan || null) : null;
        } catch (err) {
            const why = err.name === 'AbortError'
                ? `it did not answer within ${PLAN_TIMEOUT_MS / 1000}s`
                : err.message;
            console.warn(`[shortFinisher] short plan unavailable, using rules: ${why}`);
            return null;
        }
    });
}

/** Fast, read-only retrieval over the Motion Knowledge Base; no model generation. */
export async function fetchShortMotionTechniques(text, platform, tone = '', signal) {
    if (!String(text || '').trim()) return [];
    try {
        const res = await fetchWithTimeout('/api/motion/techniques', {
            method: 'POST',
            body: JSON.stringify({ query: String(text).slice(0, 600), platform, tone, limit: 24 }),
            ...(signal ? { signal } : {}),
        }, MOTION_TECHNIQUE_TIMEOUT_MS);
        if (!res.ok) return [];
        const data = await res.json().catch(() => ({}));
        return Array.isArray(data?.techniques) ? data.techniques : [];
    } catch (err) {
        if (signal?.aborted) throw err;
        console.warn('[shortFinisher] motion technique lookup unavailable; built-in recipes will be used:', err.message);
        return [];
    }
}

/** Upload-time visual grounding for local scene and b-roll selection. */
export async function fetchShortVisualContext(projectId, signal) {
    if (!projectId) return [];
    try {
        const res = await fetchWithTimeout(`/api/brain/broll-profiles?projectId=${encodeURIComponent(projectId)}`, {
            ...(signal ? { signal } : {}),
        }, VISUAL_CONTEXT_TIMEOUT_MS);
        if (!res.ok) return [];
        const data = await res.json().catch(() => ({}));
        return Array.isArray(data?.profiles) ? data.profiles : [];
    } catch (err) {
        if (signal?.aborted) throw err;
        console.warn('[shortFinisher] visual context unavailable; scene planning will use the transcript:', err.message);
        return [];
    }
}

/**
 * Build the finished short.
 * @param {object} state useTimelineStore.getState()
 * @param {object} short an entry of state.shorts
 * @param {{polish?:boolean, popOut?:boolean, sfx?:boolean, plan?:object|null, scenePlan?:object|null, referenceStyleProfile?:object|null, motionTechniques?:Array, visualContext?:Array, events?:Array, editingStyle?:string, fetchPlan?:Function, fetchMotionTechniques?:Function, fetchAsset?:Function}} opts
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
    const wantsPolish = opts.polish !== false;
    if (!wantsPolish && !opts.popOut) return { ...built, applied: [], words };

    const text = words.map(w => String(w.word ?? w.text ?? '')).join(' ').slice(0, 2000);
    const [plan, techniques, visualContext] = wantsPolish ? await Promise.all([
        opts.plan !== undefined ? opts.plan
            : (text ? (opts.fetchPlan || fetchShortPlan)(text, profile.id, built.duration) : null),
        opts.motionTechniques !== undefined ? opts.motionTechniques
            : (text ? (opts.fetchMotionTechniques || fetchShortMotionTechniques)(text, profile.id, '', opts.signal) : []),
        opts.visualContext !== undefined ? opts.visualContext
            : (state.projectId ? fetchShortVisualContext(state.projectId, opts.signal) : []),
    ]) : [null, [], []];
    const scenePlan = wantsPolish && (opts.scenePlan || fallbackShortScenePlan(words, {
        headline: plan?.headline,
        duration: built.duration,
        techniques,
        visualContext,
        events,
        platform: profile.id,
        editingStyle: opts.editingStyle || state.editingStyle,
    }));
    const layers = wantsPolish ? undefined : {
        title: false, captions: false, camera: false, numbers: false, cuts: false,
    };
    const polished = polishShort(built, profile, {
        words, events, plan, scenePlan,
        referenceStyleProfile: opts.referenceStyleProfile || null,
        assets: state.assets || [],
        popOut: !!opts.popOut, layers,
    });
    // Keep the Shorts panel's generated timeline in parity with the main
    // Pro Finish path: use upload-time visual matches as small, speaker-safe
    // cutaway overlays at the local planner's timed beats.
    const placements = [];
    const usedAssets = new Set();
    for (const moment of (scenePlan?.brollMoments || [])) {
        const at = Number(moment?.start);
        if (!Number.isFinite(at) || at < 0 || at >= built.duration - 0.4) continue;
        const asset = (moment.assetIds || []).map(id => (state.assets || []).find(a => a.id === id)).find(Boolean);
        if (!asset || usedAssets.has(asset.id)) continue;
        usedAssets.add(asset.id);
        const rawType = String(asset.type || asset.mediaType || '').toLowerCase();
        const mediaType = rawType.startsWith('video') ? 'video' : rawType.startsWith('image') ? 'image' : '';
        if (!mediaType) continue;
        const url = asset.proxyUrl || asset.url || asset.sourceUrl || asset.src;
        if (!url) continue;
        const duration = Math.max(0.5, Math.min(1.8, Number(moment.end) > at ? Number(moment.end) - at : 1.5, built.duration - at));
        placements.push({
            id: `short-broll-${placements.length}`, type: mediaType,
            assetId: asset.id, name: asset.name || 'Contextual b-roll',
            url, sourceUrl: url, thumbnail: asset.thumbnail,
            metadata: asset.resolution ? { resolution: asset.resolution } : {},
            start: at, duration, x: 78, y: 24, scale: 1, rotation: 0, opacity: 1,
        });
        if (placements.length >= 2) break;
    }
    if (placements.length) {
        const overlay = polished.tracks.find(track => track.type === 'overlay' && track.id === 'track-short-broll')
            || { id: 'track-short-broll', type: 'overlay', name: 'B-roll', clips: [] };
        overlay.clips.push(...placements);
        if (!polished.tracks.includes(overlay)) polished.tracks.push(overlay);
        polished.applied.push(`contextual b-roll (${placements.length})`);
    }
    if (opts.sfx !== false) {
        const style = opts.editingStyle || state.editingStyle;
        const level = ['interview', 'podcast'].includes(style) ? 'none' : style === 'talking_head' ? 'subtle' : profile.sfx;
        const cues = mergeSfxCues(collectSfxCues(polished.tracks, { level }), scenePlan?.sfxCues)
            .filter(cue => level !== 'subtle' || cue.kind !== 'impact');
        const placed = await addSfxTrack(polished.tracks, cues, level, opts.fetchAsset);
        if (placed) polished.applied.push(`sound effects (${placed})`);
    }
    if (plan?.headline) polished.applied.unshift('AI headline');
    return { ...polished, words };
}

export default { finishShort, fetchShortPlan, fetchShortMotionTechniques, fetchShortVisualContext, fetchSfxAsset, addSfxTrack, clearPlanCache, PLAN_TIMEOUT_MS };
