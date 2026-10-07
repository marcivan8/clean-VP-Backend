/**
 * client/src/agent/sfxCues.js
 *
 * R92 round A: where sound effects belong in an edit, and how loud.
 *
 * Pure (no store, no network) so the regression can test it on plain tracks.
 *
 * Cues come from what is already on the timeline:
 *   - a whoosh just before every transition (transitions sit at a clip's END);
 *   - a pop when a template or sticker appears (number pops, counters, shapes);
 *   - an impact on a composed "slam-in" (full level only).
 *
 * Level by editing style (Marc, R92): Reel and Vlog get the full set, Talking
 * head gets soft whooshes and pops with no impacts, Podcast and Interview get
 * none. With no style picked, the style recipe decides.
 */

export const SFX_LEVELS = ['full', 'subtle', 'none'];

const STYLE_LEVEL = { reel: 'full', vlog: 'full', talking_head: 'subtle', interview: 'none', podcast: 'none' };
const RECIPE_LEVEL = { punchy: 'full', travel: 'full', explainer: 'subtle', podcast: 'none' };

/** Search query per cue kind (server /api/audio/search). */
export const SFX_QUERIES = Object.freeze({
    whoosh: 'whoosh transition swoosh',
    pop: 'pop bubble click',
    impact: 'impact hit boom',
});

/** Seconds a cue starts before its visual event (a whoosh leads the cut). */
const LEAD = { whoosh: 0.18, pop: 0.02, impact: 0.04 };
/** Two cues closer than this are one cue. */
const MIN_GAP_S = 0.45;
const MAX_CUES = 60;

/** 'full' | 'subtle' | 'none' for an editing style (or a recipe when no style). */
export function sfxLevel(styleId, recipeId = null) {
    if (styleId && STYLE_LEVEL[styleId]) return STYLE_LEVEL[styleId];
    if (recipeId && RECIPE_LEVEL[recipeId]) return RECIPE_LEVEL[recipeId];
    return 'full';
}

/** Volume for a sound effect at a level. `base` is the library's recommended volume. */
export function sfxVolume(base, level) {
    const b = Number(base) > 0 ? Number(base) : 0.8;
    if (level === 'none') return 0;
    return level === 'subtle' ? Math.round(b * 0.45 * 100) / 100 : b;
}

/**
 * Cues for the current timeline.
 * @param {Array} tracks state.tracks
 * @param {{level?: string, kinds?: string[]}} opts
 * @returns {Array<{t:number, kind:string, sourceId:string}>} sorted, spaced
 */
export function collectSfxCues(tracks, { level = 'full', kinds = null } = {}) {
    if (level === 'none') return [];
    const want = k => (!kinds || kinds.includes(k)) && !(level === 'subtle' && k === 'impact');
    const raw = [];
    for (const track of tracks || []) {
        for (const c of track.clips || []) {
            const start = Number(c.start) || 0;
            const end = start + (Number(c.duration) || 0);
            if (track.type === 'video' && c.transition?.type && want('whoosh')) {
                raw.push({ t: end - LEAD.whoosh, kind: 'whoosh', sourceId: c.id });
            }
            if (track.type === 'overlay' && (c.type === 'template' || c.type === 'sticker') && want('pop')) {
                raw.push({ t: start + LEAD.pop, kind: 'pop', sourceId: c.id });
            }
            if ((track.type === 'text' || track.type === 'overlay') && Array.isArray(c.animations) && want('impact')) {
                const slam = c.animations.find(a => a?.presetId === 'composed:slam-in');
                if (slam) raw.push({ t: start + (Number(slam.startTime) || 0) + (Number(slam.duration) || 0) * 0.5 - LEAD.impact, kind: 'impact', sourceId: c.id });
            }
        }
    }
    raw.sort((a, b) => a.t - b.t);
    const out = [];
    for (const cue of raw) {
        const t = Math.max(0, Math.round(cue.t * 1000) / 1000);
        if (out.length && t - out[out.length - 1].t < MIN_GAP_S) continue;
        out.push({ ...cue, t });
        if (out.length >= MAX_CUES) break;
    }
    return out;
}

/**
 * What sound a request names ("add a whoosh", "a pop sound"), or null.
 * Plural / general requests ("add sound effects") return null: they mean
 * "sound the whole edit", handled by collectSfxCues.
 */
export function sfxQueryFromText(text) {
    const s = String(text || '').toLowerCase();
    const named = s.match(/\b(whoosh|swoosh|woosh|riser|impact|boom|hit|pop|ding|click|swish|whip|bell|cash register|applause|laugh(?:ter)?|record scratch|camera shutter|notification|typing|glitch)\b/);
    if (named) return named[1];
    const quoted = (String(text || '').match(/["“«]\s*([^"”»]{2,40}?)\s*["”»]/) || [])[1];
    return quoted || null;
}

export default { SFX_LEVELS, SFX_QUERIES, sfxLevel, sfxVolume, collectSfxCues, sfxQueryFromText };
