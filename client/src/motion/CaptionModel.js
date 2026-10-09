/**
 * client/src/motion/CaptionModel.js
 *
 * PHASE 4 — the Caption Engine's data model.
 *
 * ─── THE ONE THING THAT WAS ACTUALLY MISSING ────────────────────────────────
 * Word-level timings have existed in this app the whole time. Three providers
 * produce them, all normalised to seconds:
 *   • services/AssemblyAIService.js  → { word, start, end }  (+ speaker)
 *   • jobs/audioProcessor.js         → Whisper verbose_json, word granularity
 *   • diarize-service/app.py         → WhisperX + pyannote, with speaker
 * They survive into the store as `state.captions` and `state.transcripts`.
 *
 * Then `groupWordsIntoCaptions()` in agent/MediaExecutionEngine.js joined them
 * into a string and returned `{ text, start, end }` — discarding the array at
 * that single line. Everything downstream (caption clips, TextOverlay, the
 * drawtext export) has therefore only ever seen whole lines.
 *
 * `groupWordsIntoSegments()` below is a drop-in replacement that returns the
 * SAME `{ text, start, end }` fields plus a `words` array. Callers that ignore
 * `words` behave exactly as before — that backwards compatibility is what
 * makes this safe to swap in.
 *
 * ─── STYLE PACKS ────────────────────────────────────────────────────────────
 * Every font referenced below is verified present in FONT_SPECS
 * (jobs/exportProcessor.js) AND declared as an @font-face in
 * client/src/index.css. Referencing a font that ships in neither is exactly
 * the bug that made every caption render in the browser default font — see
 * the R57 journal entry. If you add a pack, add its font to all three places
 * or scripts/test_caption_fonts.js will fail the build.
 */

/**
 * Group word-level timestamps into caption segments, PRESERVING the words.
 *
 * @param {Array<{word:string,start:number,end:number,speaker?:string}>} words
 * @param {number} [maxWords=6]
 * @param {number} [pauseThreshold=0.4] seconds of silence that forces a break
 * @returns {Array<{text:string,start:number,end:number,words:Array}>}
 */
export function groupWordsIntoSegments(words, maxWords = 6, pauseThreshold = 0.4) {
    if (!Array.isArray(words) || words.length === 0) return [];

    const segments = [];
    let group = [];

    const flush = () => {
        if (group.length === 0) return;
        segments.push({
            text:  group.map(w => w.word).join(' '),
            start: group[0].start,
            end:   group[group.length - 1].end,
            // Word times are stored ABSOLUTE (same clock as start/end) so a
            // consumer never has to know the segment's origin to look up the
            // active word. The renderer converts to local time if it needs to.
            words: group.map(w => ({
                text:  w.word,
                start: w.start,
                end:   w.end,
                ...(w.speaker ? { speaker: w.speaker } : {}),
            })),
        });
        group = [];
    };

    for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (!w || typeof w.word !== 'string') continue;
        const gap = i > 0 ? (w.start || 0) - (words[i - 1].end || 0) : 0;
        if (group.length >= maxWords || (group.length > 0 && gap >= pauseThreshold)) flush();
        group.push(w);
    }
    flush();

    return segments;
}

/**
 * Which word is active at a given time.
 * Returns the index into `words`, or -1 when between words / out of range.
 * Times are compared in the same clock the words were stored in.
 *
 * @param {Array<{start:number,end:number}>} words
 * @param {number} time
 */
export function activeWordIndex(words, time) {
    if (!Array.isArray(words) || words.length === 0) return -1;
    const t = Number(time);
    if (!Number.isFinite(t)) return -1;
    for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (t >= w.start && t <= w.end) return i;
    }
    return -1;
}

/**
 * How many words should be visible at `time` for a progressive reveal.
 *
 * Prefers REAL word timings when present. Falls back to `reveal` (0..1, from
 * a typewriter/word-reveal animation) when they aren't — which is what the
 * old TextOverlay WordByWord did for every caption, because it never had word
 * timings to work with.
 *
 * @param {Array} words
 * @param {number} time
 * @param {number} fallbackReveal 0..1
 * @param {number} wordCount total words in the rendered string
 */
export function revealedWordCount(words, time, fallbackReveal, wordCount) {
    if (Array.isArray(words) && words.length > 0) {
        const t = Number(time);
        if (Number.isFinite(t)) {
            let n = 0;
            for (const w of words) {
                if (t >= w.start) n++;
            }
            return n;
        }
    }
    const r = Number.isFinite(Number(fallbackReveal)) ? Number(fallbackReveal) : 1;
    return Math.ceil(Math.max(0, Math.min(1, r)) * (wordCount || 0));
}

/**
 * Named caption style packs — PHASE 4.
 *
 * `animationPreset` refers to a MotionPresets id; `wordHighlight` describes
 * how the currently-spoken word is treated when word timings are available.
 * A pack is pure data: applying one is a clip-field update, nothing more.
 */
export const CAPTION_STYLE_PACKS = {
    'mrbeast': {
        id: 'mrbeast', name: 'MrBeast',
        fontFamily: 'Anton', fontWeight: 900, fontSize: 56,
        color: '#FFFFFF',
        stroke: { width: 4, color: '#000000' },
        textShadow: '3px 3px 0 #000, -3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000',
        uppercase: true,
        animationPreset: 'pop',
        wordHighlight: { mode: 'color', color: '#FFE500', scale: 1.12 },
    },
    'hormozi': {
        id: 'hormozi', name: 'Alex Hormozi',
        fontFamily: 'Montserrat', fontWeight: 800, fontSize: 52,
        color: '#FFFFFF',
        stroke: { width: 3, color: '#000000' },
        textShadow: '2px 2px 0 #000, -2px -2px 0 #000',
        uppercase: true,
        animationPreset: 'pop',
        wordHighlight: { mode: 'box', color: '#000000', background: '#FFE500', scale: 1.06 },
    },
    'ali-abdaal': {
        id: 'ali-abdaal', name: 'Ali Abdaal',
        fontFamily: 'Poppins', fontWeight: 600, fontSize: 44,
        color: '#FFFFFF',
        stroke: { width: 0, color: '#000000' },
        textShadow: '0 2px 8px rgba(0,0,0,0.55)',
        uppercase: false,
        animationPreset: 'slide-up',
        wordHighlight: { mode: 'color', color: '#4ADE80', scale: 1.0 },
    },
    'apple': {
        id: 'apple', name: 'Apple',
        fontFamily: 'Inter', fontWeight: 500, fontSize: 40,
        color: '#FFFFFF',
        stroke: { width: 0, color: '#000000' },
        textShadow: '0 1px 6px rgba(0,0,0,0.4)',
        uppercase: false,
        animationPreset: 'fade',
        wordHighlight: { mode: 'opacity', scale: 1.0 },
    },
    'documentary': {
        id: 'documentary', name: 'Documentary',
        fontFamily: 'Playfair Display', fontWeight: 400, fontSize: 40,
        color: '#F5F5F0',
        stroke: { width: 0, color: '#000000' },
        textShadow: '0 2px 10px rgba(0,0,0,0.7)',
        uppercase: false,
        animationPreset: 'fade',
        wordHighlight: { mode: 'none', scale: 1.0 },
    },
    'podcast': {
        id: 'podcast', name: 'Podcast',
        fontFamily: 'DM Sans', fontWeight: 600, fontSize: 42,
        color: '#FFFFFF',
        stroke: { width: 2, color: '#000000' },
        textShadow: '0 2px 6px rgba(0,0,0,0.5)',
        uppercase: false,
        animationPreset: 'slide-up',
        wordHighlight: { mode: 'color', color: '#00E5FF', scale: 1.04 },
    },
    'luxury': {
        id: 'luxury', name: 'Luxury',
        fontFamily: 'Cormorant Garamond', fontWeight: 400, fontSize: 46,
        color: '#F0E6D2',
        stroke: { width: 0, color: '#000000' },
        textShadow: '0 2px 12px rgba(0,0,0,0.6)',
        uppercase: true,
        animationPreset: 'blur-reveal',
        wordHighlight: { mode: 'none', scale: 1.0 },
    },
    'gaming': {
        id: 'gaming', name: 'Gaming',
        fontFamily: 'Rajdhani', fontWeight: 700, fontSize: 48,
        color: '#FFFFFF',
        stroke: { width: 3, color: '#0A0A0E' },
        textShadow: '0 0 12px rgba(0,229,255,0.8)',
        uppercase: true,
        animationPreset: 'glow-reveal',
        wordHighlight: { mode: 'color', color: '#00E5FF', scale: 1.1 },
    },
    'vox-highlighter': {
        id: 'vox-highlighter', name: 'Vox Highlighter',
        fontFamily: 'Montserrat', fontWeight: 800, fontSize: 50,
        color: '#111827',
        stroke: { width: 0, color: '#000000' },
        textShadow: 'none',
        uppercase: true,
        animationPreset: 'pop',
        wordHighlight: { mode: 'vox-marker', color: '#111827', background: '#FFE500', scale: 1.05 },
    },
    'hormozi-bounce': {
        id: 'hormozi-bounce', name: 'Hormozi Explosive',
        fontFamily: 'Anton', fontWeight: 900, fontSize: 58,
        color: '#FFFFFF',
        stroke: { width: 4, color: '#000000' },
        textShadow: '4px 4px 0 #000, -2px -2px 0 #000',
        uppercase: true,
        animationPreset: 'pop',
        wordHighlight: { mode: 'bounce-box', color: '#000000', background: '#FFE500', altBackground: '#00E5FF', scale: 1.15 },
    },
    'typewriter-terminal': {
        id: 'typewriter-terminal', name: 'Terminal Typewriter',
        fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 42,
        color: '#10B981',
        stroke: { width: 0, color: '#000000' },
        textShadow: '0 0 10px rgba(16,185,129,0.6)',
        uppercase: false,
        animationPreset: 'fade',
        wordHighlight: { mode: 'terminal-cursor', color: '#34D399', cursor: '█', scale: 1.0 },
    },
    'neon-punch': {
        id: 'neon-punch', name: 'Neon Electric',
        fontFamily: 'Rajdhani', fontWeight: 800, fontSize: 52,
        color: '#FFFFFF',
        stroke: { width: 2, color: '#FF0055' },
        textShadow: '0 0 16px #FF0055, 0 0 32px #00E5FF',
        uppercase: true,
        animationPreset: 'glow-reveal',
        wordHighlight: { mode: 'neon-glow', color: '#00E5FF', glowColor: '#00E5FF', scale: 1.12 },
    },
};

/** Style pack ids, for UI pickers. */
export function listStylePacks() {
    return Object.values(CAPTION_STYLE_PACKS).map(p => ({ id: p.id, name: p.name, fontFamily: p.fontFamily }));
}

/**
 * Motion behaviour for the caption style picker that ALREADY EXISTS and is
 * already reachable — `CAPTION_STYLES` in `components/Assistant/ReasoningPanel.jsx`.
 *
 * ─── WHY MAP INSTEAD OF SHIPPING A SECOND PICKER ────────────────────────────
 * That card has ten packs, live font previews, and a working apply path that
 * fans across every text track. The packs above were written without knowing
 * it existed. Adding a second style picker would leave the app with two
 * competing caption-style systems whose ids don't match and whose "applied"
 * states can disagree — a worse outcome than either alone, and the same
 * duplication mistake that produced two preset stacks and two easing
 * vocabularies elsewhere in this codebase.
 *
 * So the existing card stays the single UI and single source of the VISUAL
 * style (font, weight, colour, stroke, shadow). This table adds only what it
 * had no concept of: which motion preset the captions animate with, whether
 * the pack is uppercase, and how the currently-spoken word is highlighted once
 * word timings exist.
 *
 * Keys are the EXISTING card's ids, not the ids above.
 */
export const LEGACY_PACK_MOTION = {
    'bold-impact':   { uppercase: true,  animationPreset: 'pop',         wordHighlight: { mode: 'color', color: '#FFE500', scale: 1.12 } },
    'clean-modern':  { uppercase: true,  animationPreset: 'pop',         wordHighlight: { mode: 'box', color: '#000000', background: '#FFE500', scale: 1.06 } },
    'soft-rounded':  { uppercase: false, animationPreset: 'slide-up',    wordHighlight: { mode: 'color', color: '#4ADE80', scale: 1.04 } },
    'cinematic':     { uppercase: false, animationPreset: 'fade',        wordHighlight: { mode: 'none',  scale: 1 } },
    'handwritten':   { uppercase: false, animationPreset: 'fade',        wordHighlight: { mode: 'color', color: '#FDE68A', scale: 1.05 } },
    'motivational':  { uppercase: true,  animationPreset: 'scale-reveal', wordHighlight: { mode: 'color', color: '#FACC15', scale: 1.1 } },
    'modern-tech':   { uppercase: false, animationPreset: 'blur-reveal', wordHighlight: { mode: 'color', color: '#00E5FF', scale: 1.06 } },
    'extended-bold': { uppercase: true,  animationPreset: 'scale-reveal', wordHighlight: { mode: 'box', color: '#0A0A0E', background: '#FFFFFF', scale: 1.04 } },
    'platform-sans': { uppercase: false, animationPreset: 'slide-up',    wordHighlight: { mode: 'opacity', scale: 1 } },
    'editorial':     { uppercase: true,  animationPreset: 'fade',        wordHighlight: { mode: 'none',  scale: 1 } },
};

/**
 * The `captionStyle` blob for one of the existing picker's packs.
 *
 * Returns a safe default rather than null for an unknown id: the caller is a
 * style-apply path, and refusing to return anything there would mean picking a
 * style silently dropped the motion half while the fonts changed.
 *
 * @param {string} legacyPackId one of LEGACY_PACK_MOTION's keys
 */
export function legacyPackToCaptionStyle(legacyPackId) {
    const motion = LEGACY_PACK_MOTION[legacyPackId];
    if (!motion) {
        console.warn(`[CaptionModel] no motion mapping for style pack "${legacyPackId}" — captions will render unanimated`);
        return { packId: legacyPackId || null, uppercase: false, animationPreset: null, wordHighlight: { mode: 'none', scale: 1 } };
    }
    return { packId: legacyPackId, ...motion };
}

/**
 * Convert a style pack into the flat clip fields the store/TextOverlay/export
 * already understand. Deliberately returns EXISTING field names (fontFamily,
 * stroke, textShadow, …) rather than a nested blob, so applying a pack is an
 * ordinary `updateClip` and every existing consumer picks it up unchanged.
 *
 * @param {string} packId
 * @returns {object|null} clip field updates, or null for an unknown pack
 */
export function stylePackToClipFields(packId) {
    const pack = CAPTION_STYLE_PACKS[packId];
    if (!pack) {
        console.warn(`[CaptionModel] unknown style pack "${packId}"`);
        return null;
    }
    return {
        fontFamily: pack.fontFamily,
        fontWeight: pack.fontWeight,
        fontSize:   pack.fontSize,
        color:      pack.color,
        stroke:     pack.stroke,
        textShadow: pack.textShadow,
        // Nested under `captionStyle` so the pack's motion-specific bits travel
        // with the clip without colliding with any existing flat field.
        captionStyle: {
            packId:          pack.id,
            uppercase:       pack.uppercase,
            animationPreset: pack.animationPreset,
            wordHighlight:   pack.wordHighlight,
        },
    };
}

// ─── Keyword emphasis (R88, to-do A2) ───────────────────────────────────────
//
// One or two words per caption are EMPHASISED for the whole time the caption
// is on screen (the creator-style "key word in yellow"). This is separate from
// `wordHighlight`, which follows the word being spoken right now.
//
// Data: `clip.emphasis = { indices: number[], source: 'auto'|'assistant'|'user' }`.
// Indices point into the caption text split on single spaces, the same tokens
// CaptionWords renders and CaptionCompiler ships. The LOOK is not stored on the
// clip: it follows the caption's style pack (EMPHASIS_BY_PACK), so switching
// pack restyles the keywords too.

/** Emphasis look per style pack id (new packs and the legacy picker ids). */
export const EMPHASIS_BY_PACK = {
    // CAPTION_STYLE_PACKS
    'mrbeast':       { mode: 'color', color: '#FFE500', scale: 1.15 },
    'hormozi':       { mode: 'color', color: '#FFE500', scale: 1.08 },
    'ali-abdaal':    { mode: 'color', color: '#4ADE80', scale: 1.06 },
    'apple':         { mode: 'scale', scale: 1.12 },
    'documentary':   { mode: 'color', color: '#E8C27A', scale: 1.0 },
    'podcast':       { mode: 'color', color: '#00E5FF', scale: 1.06 },
    'luxury':        { mode: 'color', color: '#D4AF6A', scale: 1.0 },
    'gaming':        { mode: 'color', color: '#FF3D7F', scale: 1.12 },
    'vox-highlighter':     { mode: 'box',   color: '#111827', background: '#FFE500', scale: 1.05 },
    'hormozi-bounce':      { mode: 'box',   color: '#000000', background: '#FFE500', scale: 1.15 },
    'typewriter-terminal': { mode: 'color', color: '#34D399', scale: 1.0 },
    'neon-punch':          { mode: 'color', color: '#00E5FF', scale: 1.1 },
    // LEGACY_PACK_MOTION ids (the Text panel's original picker)
    'bold-impact':   { mode: 'color', color: '#FFE500', scale: 1.12 },
    'clean-modern':  { mode: 'box',   color: '#000000', background: '#FFE500', scale: 1.04 },
    'soft-rounded':  { mode: 'color', color: '#4ADE80', scale: 1.04 },
    'cinematic':     { mode: 'color', color: '#E8C27A', scale: 1.0 },
    'handwritten':   { mode: 'color', color: '#FDE68A', scale: 1.05 },
    'motivational':  { mode: 'color', color: '#FACC15', scale: 1.12 },
    'modern-tech':   { mode: 'color', color: '#00E5FF', scale: 1.06 },
    'extended-bold': { mode: 'box',   color: '#0A0A0E', background: '#FFFFFF', scale: 1.04 },
    'platform-sans': { mode: 'scale', scale: 1.1 },
    'editorial':     { mode: 'color', color: '#E8C27A', scale: 1.0 },
};

const DEFAULT_EMPHASIS = { mode: 'color', color: '#FACC15', scale: 1.12 };

function isYellowish(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return false;
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return r > 200 && g > 170 && b < 120;
}

/** The emphasis look for a clip: its pack's, else a default that contrasts with the text colour. */
export function emphasisStyleFor(clip) {
    const packId = clip?.captionStyle?.packId;
    if (packId && EMPHASIS_BY_PACK[packId]) return EMPHASIS_BY_PACK[packId];
    // No pack: default yellow, or white when the caption itself is already yellow.
    if (isYellowish(clip?.color || '#FACC15')) return { mode: 'color', color: '#FFFFFF', scale: 1.12 };
    return DEFAULT_EMPHASIS;
}

/**
 * The emphasis to render for a clip, or null when there is none.
 * Indices out of range (text edited after picking) are dropped, not clamped.
 *
 * @param {object} clip
 * @param {number} [tokenCount] number of space-separated tokens in the text
 * @returns {{indices:number[], style:object}|null}
 */
export function resolveEmphasis(clip, tokenCount) {
    const raw = clip?.emphasis;
    if (!raw || !Array.isArray(raw.indices) || raw.indices.length === 0) return null;
    const n = Number.isFinite(tokenCount)
        ? tokenCount
        : String(clip.content || clip.name || '').split(' ').filter(Boolean).length;
    const indices = [...new Set(raw.indices.map(Number))]
        .filter(i => Number.isInteger(i) && i >= 0 && i < n)
        .sort((a, b) => a - b);
    if (indices.length === 0) return null;
    return { indices, style: emphasisStyleFor(clip) };
}

// Function words that are never the keyword (FR + EN). Lowercase, no accents
// stripped: tokens are compared after the same normalisation.
const STOPWORDS = new Set((
    'a an the and or but so if then than that this these those there here is are was were be been being am ' +
    'i me my we our you your he him his she her it its they them their what which who whom whose when where why how ' +
    'of to in on at by for with from about as into over under up down out off just also too very really ' +
    'do does did done have has had will would can could should may might must shall not no yes all any some ' +
    'get got go going gonna wanna like one yeah yep ok okay um uh hmm well guys ' +
    'le la les l un une des du de d et ou mais donc or ni car si que qu qui quoi dont ou ce cet cette ces c ' +
    'je j tu il elle on nous vous ils elles me m te t se s lui leur leurs mon ma mes ton ta tes son sa ses ' +
    'notre nos votre vos au aux en dans sur sous par pour avec sans chez vers entre est sont etait ete etre ' +
    'ai as a avons avez ont fait faire va vais vas allez vont pas plus ne n y tres bien alors comme aussi ' +
    'tout tous toute toutes ca cela ceci voila voici quand comment pourquoi oui non juste deja encore ' +
    'euh bah ben bon genre ouais enfin quoi'
).split(/\s+/));

// Words that carry the punch of a sentence even though they are short.
const EMPHATIC = new Set((
    'never always only every nothing everything nobody best worst free secret mistake huge massive instantly ' +
    'jamais toujours seul seule seulement rien tout gratuit secret erreur enorme meilleur pire incroyable vraiment'
).split(/\s+/));

function normaliseToken(tok) {
    return String(tok || '')
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/^[^a-z0-9%€$£]+|[^a-z0-9%€$£]+$/g, '');
}

/**
 * Score every token of a caption as a keyword candidate. Zero cost, no API:
 * numbers and prices first, then emphatic words, then long content words,
 * with a small bonus for the last content word (the punchline position).
 *
 * @param {string} text
 * @returns {Array<{index:number, token:string, score:number}>} best first
 */
export function scoreKeywordCandidates(text) {
    const tokens = String(text || '').split(' ').filter(Boolean);
    const scored = [];
    let lastContent = -1;
    tokens.forEach((tok, i) => {
        const norm = normaliseToken(tok);
        if (!norm || STOPWORDS.has(norm)) return;
        let score = 0;
        if (/\d/.test(norm)) score += 6;
        if (/[%€$£]/.test(tok)) score += 2;
        if (EMPHATIC.has(norm)) score += 3.5;
        const core = norm.replace(/[^a-z]/g, '');
        if (core.length >= 3) score += Math.min(core.length, 10) * 0.45;
        if (/^[A-Z0-9]{2,6}$/.test(tok.replace(/[^A-Za-z0-9]/g, '')) && tok !== tok.toLowerCase() && /[A-Z]/.test(tok)) score += 1.5;
        if (/[!?]$/.test(tok)) score += 0.8;
        if (score <= 0) return;
        scored.push({ index: i, token: tok, score });
        lastContent = i;
    });
    // Punchline bonus — not for numbers, where the first one usually leads ("day 14 of 30").
    for (const c of scored) if (c.index === lastContent && !/\d/.test(c.token)) c.score += 0.6;
    return scored.sort((a, b) => b.score - a.score || a.index - b.index);
}

/**
 * Pick the keyword(s) for one caption.
 *
 * @param {string} text
 * @param {{max?:number}} [opts] max keywords (default: 1, or 2 for 8+ words)
 * @returns {{indices:number[], confident:boolean}} `confident` false means the
 *   top candidates are too close to call; the caller may ask the LLM to decide.
 */
export function pickKeywords(text, opts = {}) {
    const tokens = String(text || '').split(' ').filter(Boolean);
    const candidates = scoreKeywordCandidates(text);
    if (candidates.length === 0) return { indices: [], confident: true };
    const max = Number.isInteger(opts.max) ? opts.max : (tokens.length >= 8 ? 2 : 1);
    const picked = candidates.slice(0, Math.max(1, max)).map(c => c.index).sort((a, b) => a - b);
    const [a, b] = candidates;
    const confident = !b || a.score >= 6 || (a.score - b.score) >= 0.9;
    return { indices: picked, confident };
}

export default {
    groupWordsIntoSegments,
    activeWordIndex,
    revealedWordCount,
    CAPTION_STYLE_PACKS,
    listStylePacks,
    stylePackToClipFields,
    EMPHASIS_BY_PACK,
    emphasisStyleFor,
    resolveEmphasis,
    scoreKeywordCandidates,
    pickKeywords,
};
