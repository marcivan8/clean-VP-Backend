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
        // R106 — the editorial range for a REPURPOSED short, which is a
        // different thing from `length` above. `length` is the attention-span
        // guidance for a clip someone is cutting by hand; this is the window
        // the shorts picker is allowed to choose from, and it starts at a
        // minute because a shorter cut rarely has room to make a point.
        // Under the 3600 s upload limit by a wide margin; the ceiling leaves
        // room for the Pro Finish hook title and CTA outro on top.
        shortForm: { min: 60, max: 165 },
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
        // Upload limit is 180 s; the ceiling stays under it so the finish
        // has room and a boosted Reel is not rejected on length.
        shortForm: { min: 60, max: 150 },
        hookSeconds: 2,
        avgShotSeconds: [1.5, 3],
        safeZone: { top: 0.14, bottom: 0.32, left: 0.06, right: 0.14 },
        captionY: 60,
        // A clean editorial caption base. MrBeast's yellow word highlight
        // made every automatically finished Reel look like the same preset,
        // regardless of the source footage or subject.
        captionPack: 'apple',
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
        // Shorts accepts 180 s now, not the old 60 s; `length.max` above is
        // still the attention-span figure, this is the upload reality.
        shortForm: { min: 60, max: 165 },
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

/** Hard ceiling on shorts per request -- generous, but still a count a person can review. */
export const MAX_SHORT_COUNT = 20;

/**
 * How many shorts a request explicitly asks for. Returns:
 *   - an explicit number (digits or a number word) named next to "short/
 *     clip/reel/...", clamped to MAX_SHORT_COUNT;
 *   - MAX_SHORT_COUNT for "as many as possible" / "max variety" / "every
 *     short you can find" style phrasing -- R101: Marc wants variety, not a
 *     flat 3, when he does not name an exact number;
 *   - null when nothing explicit was said, so the caller sizes the default
 *     off the source video itself instead of guessing a flat number (see
 *     autoShortCount below).
 */
export function shortCountFromText(text) {
    const s = String(text || '').toLowerCase();
    const words = {
        one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
        un: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9, dix: 10,
    };
    const m = s.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|un|deux|trois|quatre|cinq|sept|huit|neuf|dix)\s+(?:short|clip|reel|tiktok|video|vid|extrait)/);
    if (m) return Math.max(1, Math.min(MAX_SHORT_COUNT, Number(m[1]) || words[m[1]] || 3));
    if (/\b(as many(?: shorts| as possible)?|every (?:short|clip|moment)|as much variety|more variety|max(?:imum)? variety|lots of shorts?|tons of shorts?|all the shorts|plein de shorts|un max de shorts)\b/.test(s)) return MAX_SHORT_COUNT;
    return null;
}

/**
 * R101: the default short count when nothing explicit was asked for. A flat
 * 3 (the old behaviour) ignored how much usable video there actually was --
 * a 2-minute clip and a 90-minute podcast both got exactly 3 shorts. Scales
 * with the source length instead so a long upload actually yields the
 * variety Marc asked for; findShortCandidates() already reports (never
 * errors) when fewer windows fit without overlapping, so asking for more
 * than a short clip can supply is harmless.
 */
export function autoShortCount(totalSeconds) {
    const t = Math.max(0, Number(totalSeconds) || 0);
    return Math.max(3, Math.min(MAX_SHORT_COUNT, Math.round(t / 40)));
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
    // R106 — judged against the SHORT-FORM range. These notes are shown in the
    // Shorts panel, on windows the picker chose, so measuring them against the
    // hand-editing attention-span range made every repurposed short read as
    // "too long" the moment the floor moved to a minute.
    const sf = profile.shortForm || { min: profile.length.min, max: profile.length.max };
    const notes = [];
    if (len > sf.max) notes.push({ level: 'warn', code: 'too_long', text: `${Math.round(len)} s is past what ${profile.label} will carry; ${sf.max} s or less is safer.` });
    else if (len < sf.min) notes.push({ level: 'info', code: 'too_short', text: `${Math.round(len)} s is under the ${sf.min} s minimum — the source had no longer passage to cut.` });
    else notes.push({ level: 'ok', code: 'length', text: `${Math.round(len)} s suits ${profile.label} (${sf.min} to ${sf.max} s).` });
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

export default { PLATFORM_IDS, PLATFORM_PROFILES, MAX_SHORT_COUNT, getPlatformProfile, platformsFromText, shortCountFromText, autoShortCount, assignPlatforms, profileNotes, platformContext };
