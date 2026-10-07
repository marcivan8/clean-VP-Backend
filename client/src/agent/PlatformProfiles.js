/**
 * client/src/agent/PlatformProfiles.js
 *
 * R92 round B: what TikTok, Instagram Reels and YouTube Shorts each want from
 * an edit, in one place. Pure (no store, no network), used by the shorts
 * finder, the short timeline builder, the Shorts panel and the Brain.
 *
 * Sources (checked 2026-10): platform upload limits are TikTok up to 60 min,
 * Reels up to 3 min (ads only up to 90 s), Shorts up to 3 min. Those are
 * LIMITS, not targets: the editorial ranges below are the lengths that hold
 * attention on each feed, and every number here is meant to be tuned.
 * Safe zones follow the conservative cross-platform guidance (keep text out
 * of roughly the top 12-15 %, the bottom 25-35 % and the right-hand action
 * column), adjusted per platform for where its interface sits.
 */

export const PLATFORM_IDS = ['tiktok', 'reels', 'shorts'];

export const PLATFORM_PROFILES = Object.freeze({
    tiktok: Object.freeze({
        id: 'tiktok',
        label: 'TikTok',
        exportPreset: 'tiktok',          // client/src/components/exportPresets.js
        aspectRatio: '9:16',
        fps: 30,
        uploadLimitSeconds: 3600,
        length: { min: 12, ideal: [21, 34], max: 60 },
        hookSeconds: 1.5,
        avgShotSeconds: [1.2, 2.5],
        // Fractions of the frame to keep text out of.
        safeZone: { top: 0.12, bottom: 0.30, left: 0.06, right: 0.15 },
        captionY: 62,                    // % from the top, centre of the caption
        captionPack: 'hormozi',
        zoomStyle: 'dynamic',
        sfx: 'full',
        pacing: { minSilence: 0.25, padding: 0.06 },
        loopEnding: true,
        guidance: 'Hook in the first 1.5 s with words on screen. Fast cuts (about every 2 s), bold word-by-word captions above the bottom third, punchy sound effects, and an ending that loops back into the start.',
    }),
    reels: Object.freeze({
        id: 'reels',
        label: 'Instagram Reels',
        exportPreset: 'reels',
        aspectRatio: '9:16',
        fps: 30,
        uploadLimitSeconds: 180,
        length: { min: 10, ideal: [15, 30], max: 90 },
        hookSeconds: 2,
        avgShotSeconds: [1.5, 3],
        safeZone: { top: 0.14, bottom: 0.32, left: 0.06, right: 0.14 },
        captionY: 60,
        captionPack: 'mrbeast',
        zoomStyle: 'subtle',
        sfx: 'full',
        pacing: { minSilence: 0.3, padding: 0.08 },
        loopEnding: false,
        guidance: 'A strong first frame (it is also the cover), hook within 2 s, a polished look, clean captions kept above the caption and audio bar, music-led rhythm. Under 90 s so it can be boosted.',
    }),
    shorts: Object.freeze({
        id: 'shorts',
        label: 'YouTube Shorts',
        exportPreset: 'shorts',
        aspectRatio: '9:16',
        fps: 60,
        uploadLimitSeconds: 180,
        length: { min: 15, ideal: [30, 50], max: 60 },
        hookSeconds: 1,
        avgShotSeconds: [1.5, 3.5],
        safeZone: { top: 0.12, bottom: 0.28, left: 0.06, right: 0.14 },
        captionY: 64,
        captionPack: 'ali-abdaal',
        zoomStyle: 'dynamic',
        sfx: 'full',
        pacing: { minSilence: 0.3, padding: 0.08 },
        loopEnding: true,
        guidance: 'State the payoff in the first second, keep a clear title idea, a little more room to explain (30-50 s), captions centred above the channel bar, and a clean loop to the start.',
    }),
});

/** A profile by id, or null. Accepts loose spellings ("TikTok", "Instagram Reels", "yt shorts"). */
export function getPlatformProfile(id) {
    const s = String(id || '').toLowerCase();
    if (PLATFORM_PROFILES[s]) return PLATFORM_PROFILES[s];
    if (/tik ?tok/.test(s)) return PLATFORM_PROFILES.tiktok;
    if (/reel|insta/.test(s)) return PLATFORM_PROFILES.reels;
    if (/short|youtube|\byt\b/.test(s)) return PLATFORM_PROFILES.shorts;
    return null;
}

/** Platforms named in a request, in the order named. Empty when none. */
export function platformsFromText(text) {
    const s = String(text || '').toLowerCase();
    const hits = [];
    const push = (id, idx) => { if (idx >= 0 && !hits.some(h => h.id === id)) hits.push({ id, idx }); };
    push('tiktok', s.search(/tik ?tok/));
    push('reels', s.search(/\breels?\b|instagram|\binsta\b/));
    push('shorts', s.search(/youtube shorts?|\byt shorts?\b|\bshorts\b(?! (?:for|on) (?:tik|insta|reel))/));
    // "shorts" alone often just means short videos: only count it when another
    // platform is named next to it or YouTube is named.
    // "shorts" usually just means short videos. It is YouTube Shorts only when
    // YouTube is named, or when it sits in a list with another platform
    // ("TikTok, Reels and Shorts").
    const shortsIsPlatform = /youtube|\byt\b/.test(s) || /(?:tik ?tok|reels?|instagram)\s*(?:,|and|or|&|\+|et|ou)\s*(?:(?:tik ?tok|reels?|instagram)\s*(?:,|and|or|&|\+|et|ou)\s*)?shorts\b/.test(s);
    return hits.sort((a, b) => a.idx - b.idx).map(h => h.id).filter(id => id !== 'shorts' || shortsIsPlatform);
}

/** How many shorts a request asks for (default 3, at most 5). */
export function shortCountFromText(text) {
    const s = String(text || '').toLowerCase();
    const words = { one: 1, two: 2, three: 3, four: 4, five: 5, un: 1, deux: 2, trois: 3, quatre: 4, cinq: 5 };
    const m = s.match(/\b(\d|one|two|three|four|five|un|deux|trois|quatre|cinq)\s+(?:short|clip|reel|tiktok|video|vid|extrait)/);
    if (m) return Math.max(1, Math.min(5, Number(m[1]) || words[m[1]] || 3));
    return 3;
}

/**
 * Which platform each of `count` shorts is tuned for. Named platforms are
 * used in turn; with none named, one per platform (TikTok, Reels, Shorts).
 */
export function assignPlatforms(count, named = []) {
    const order = named.length ? named : PLATFORM_IDS;
    return Array.from({ length: count }, (_, i) => order[i % order.length]);
}

/**
 * Check a short against its platform. Returns notes the UI and the recap can
 * show; never blocks anything.
 * @param {{start:number, end:number, hookEvent?:string|null, text?:string}} short
 * @param {object} profile
 * @param {{hasCaptions?: boolean}} facts
 */
export function profileNotes(short, profile, facts = {}) {
    if (!short || !profile) return [];
    const len = Math.max(0, (Number(short.end) || 0) - (Number(short.start) || 0));
    const [lo, hi] = profile.length.ideal;
    const notes = [];
    if (len > profile.length.max) notes.push({ level: 'warn', code: 'too_long', text: `${Math.round(len)} s is long for ${profile.label}; ${hi} s or less works best.` });
    else if (len < profile.length.min) notes.push({ level: 'warn', code: 'too_short', text: `${Math.round(len)} s is short for ${profile.label}; aim for ${lo} to ${hi} s.` });
    else if (len >= lo && len <= hi) notes.push({ level: 'ok', code: 'length', text: `${Math.round(len)} s is in the ${profile.label} sweet spot (${lo} to ${hi} s).` });
    else notes.push({ level: 'info', code: 'length', text: `${Math.round(len)} s fits ${profile.label}; the sweet spot is ${lo} to ${hi} s.` });
    if (short.hookEvent) notes.push({ level: 'ok', code: 'hook', text: 'Opens on a key moment.' });
    else notes.push({ level: 'info', code: 'hook', text: `No strong moment in the first ${profile.hookSeconds} s: a text hook on screen will help.` });
    if (facts.hasCaptions === false) notes.push({ level: 'warn', code: 'captions', text: 'No captions yet: most people watch with the sound off.' });
    return notes;
}

/** Short context block for the LLM / Brain. */
export function platformContext(id) {
    const p = getPlatformProfile(id);
    if (!p) return null;
    return { id: p.id, label: p.label, idealSeconds: p.length.ideal, maxSeconds: p.length.max, hookSeconds: p.hookSeconds, guidance: p.guidance };
}

export default { PLATFORM_IDS, PLATFORM_PROFILES, getPlatformProfile, platformsFromText, shortCountFromText, assignPlatforms, profileNotes, platformContext };
