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

const sfxCache = new Map();

/** Best library sound for a query, or null (cached for the session). */
export async function fetchSfxAsset(query) {
    if (sfxCache.has(query)) return sfxCache.get(query);
    let asset = null;
    try {
        const res = await authFetch('/api/audio/search', { method: 'POST', body: JSON.stringify({ query, assetTypes: ['SOUND_EFFECT'], limit: 5 }) });
        const data = await res.json().catch(() => ({}));
        asset = (Array.isArray(data?.results) ? data.results : []).map(r => r?.asset || r).find(a => sfxPlayableUrl(a)) || null;
    } catch (err) {
        console.warn('[shortFinisher] sound search failed:', err.message);
    }
    sfxCache.set(query, asset);
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
 * Build the finished short.
 * @param {object} state useTimelineStore.getState()
 * @param {object} short an entry of state.shorts
 * @param {{polish?:boolean, popOut?:boolean, sfx?:boolean, plan?:object|null, fetchPlan?:Function, fetchAsset?:Function}} opts
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
    const plan = opts.plan !== undefined ? opts.plan
        : (text ? await (opts.fetchPlan || fetchShortPlan)(text, profile.id, built.duration) : null);
    const polished = polishShort(built, profile, { words, events, plan, popOut: !!opts.popOut });
    if (opts.sfx !== false) {
        const placed = await addSfxTrack(polished.tracks, collectSfxCues(polished.tracks, { level: profile.sfx }), profile.sfx, opts.fetchAsset);
        if (placed) polished.applied.push(`sound effects (${placed})`);
    }
    if (plan?.headline) polished.applied.unshift('AI headline');
    return { ...polished, words };
}

export default { finishShort, fetchShortPlan, fetchSfxAsset, addSfxTrack };
