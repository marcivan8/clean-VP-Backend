/**
 * captionEdits.js — pure helpers for editing one caption clip's text and
 * word timings (mobile caption edit sheet; store actions in useTimelineStore).
 *
 * Caption clips carry `content` (the text shown) and `words`
 * ([{ text, start, end }], ABSOLUTE timeline seconds as displayed) for the
 * spoken-word highlight. TextOverlay highlights `content`'s Nth token with
 * `words[N]`'s timing, so the two must keep the same number of entries.
 */

const tokenize = (s) => String(s ?? '').split(/\s+/).filter(Boolean);
const wordText = (w) => String(w?.text ?? w?.word ?? '').trim();
const timed = (words) => (Array.isArray(words) ? words : []).filter(w => Number.isFinite(Number(w?.start)));

/**
 * Words for a new caption text, keeping the original timing.
 * Same word count → each word keeps its own timing, gets its new text.
 * Different count → the new words share the original span evenly.
 * @returns {Array|null} null when the clip had no timed words (leave them alone)
 */
export function retimeWordsForText(words, newText) {
    const tokens = tokenize(newText);
    const ws = timed(words);
    if (ws.length === 0) return null;
    if (tokens.length === 0) return [];
    if (ws.length === tokens.length) return ws.map((w, i) => ({ ...w, text: tokens[i] }));
    const a = Number(ws[0].start);
    const lastEnd = Number(ws[ws.length - 1].end);
    const b = Math.max(a, Number.isFinite(lastEnd) ? lastEnd : Number(ws[ws.length - 1].start));
    const step = (b - a) / tokens.length;
    return tokens.map((text, i) => ({ text, start: a + i * step, end: a + (i + 1) * step }));
}

/** The caption's tokens: its content when it matches the words, else the words' own text. */
function captionTokens(words, content) {
    const tokens = tokenize(content);
    const ws = timed(words);
    return tokens.length === ws.length ? tokens : ws.map(wordText);
}

/**
 * Split a caption before word `index` (1 … n-1).
 * @returns {{ splitTime, left: {content, words}, right: {content, words} } | null}
 */
export function splitCaption(words, content, index) {
    const ws = timed(words);
    const i = Math.round(Number(index));
    if (ws.length < 2 || !(i >= 1 && i <= ws.length - 1)) return null;
    const tokens = captionTokens(ws, content);
    const withText = ws.map((w, k) => ({ ...w, text: tokens[k] }));
    return {
        splitTime: Number(ws[i].start),
        left: { content: tokens.slice(0, i).join(' '), words: withText.slice(0, i) },
        right: { content: tokens.slice(i).join(' '), words: withText.slice(i) },
    };
}

/** Index to split at for a playhead time: the word boundary closest to `time` (1 … n-1), or -1. */
export function splitIndexAtTime(words, time) {
    const ws = timed(words);
    if (ws.length < 2) return -1;
    const t = Number(time) || 0;
    let best = -1;
    let bestDist = Infinity;
    for (let i = 1; i < ws.length; i++) {
        const d = Math.abs(Number(ws[i].start) - t);
        if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
}

/** Merge two consecutive captions' text and words. */
export function mergeCaptions(a, b) {
    const content = [String(a?.content ?? '').trim(), String(b?.content ?? '').trim()].filter(Boolean).join(' ');
    const words = [...timed(a?.words), ...timed(b?.words)];
    return { content, words };
}

/** Shift words by `delta` seconds (displayed ↔ stored, see placement wordShift). */
export function shiftWords(words, delta) {
    const d = Number(delta) || 0;
    if (!Array.isArray(words) || d === 0) return words;
    return words.map(w => ({
        ...w,
        start: Number.isFinite(Number(w?.start)) ? Number(w.start) + d : w?.start,
        end: Number.isFinite(Number(w?.end)) ? Number(w.end) + d : w?.end,
    }));
}

/**
 * R105: which spoken words a caption edit REMOVED, so the editor can offer to
 * cut that stretch of the video.
 *
 * Old and new texts are aligned on their common words (longest common
 * subsequence, case and punctuation ignored). A gap where old words have no
 * counterpart at all is a deletion. A gap where the new text puts something
 * else is a REWRITE (a spelling fix, a reworded line) and cuts nothing: an
 * edit must never cut speech the user only re-typed.
 *
 * @param {Array} words    the caption's timed words, as displayed (absolute)
 * @param {string} oldText the caption text before the edit
 * @param {string} newText the caption text after the edit
 * @returns {{ deleted: number[], kept: Array, ranges: Array<[number,number]>, seconds: number }}
 *          empty when nothing was deleted or the words cannot be mapped to the text
 */
export function findDeletedWords(words, oldText, newText) {
    const none = { deleted: [], kept: [], ranges: [], seconds: 0 };
    const ws = timed(words);
    if (ws.length === 0) return none;
    const oldTokens = tokenize(oldText);
    // Only when each displayed word is one timed word can a token be mapped to time.
    if (oldTokens.length !== ws.length) return none;
    const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
    const a = oldTokens.map(norm);
    const b = tokenize(newText).map(norm);
    const n = a.length, m = b.length;
    const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
        L[i][j] = a[i] && a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
    // Walk the alignment, collecting gaps.
    const deleted = [];
    let i = 0, j = 0;
    let gapOld = [], gapNew = 0;
    const flush = () => { if (gapOld.length && gapNew === 0) deleted.push(...gapOld); gapOld = []; gapNew = 0; };
    while (i < n || j < m) {
        if (i < n && j < m && a[i] && a[i] === b[j]) { flush(); i++; j++; }
        else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) { gapNew++; j++; }
        else { gapOld.push(i); i++; }
    }
    flush();
    // Punctuation-only tokens ("-", "...") carry no speech worth a cut.
    const real = deleted.filter((k) => a[k]);
    if (!real.length) return none;
    const set = new Set(real);
    const ranges = [];
    for (const k of real) {
        const s = Number(ws[k].start);
        const e = Number.isFinite(Number(ws[k].end)) ? Number(ws[k].end) : s;
        const last = ranges[ranges.length - 1];
        if (last && k - 1 === last.k) { last.r[1] = e; last.k = k; } else ranges.push({ k, r: [s, e] });
    }
    const out = ranges.map((x) => x.r).filter(([s, e]) => e - s > 0.02);
    if (!out.length) return none;
    return {
        deleted: real,
        kept: ws.filter((_, k) => !set.has(k)).map((w, idx) => ({ ...w, text: tokenize(newText)[idx] ?? wordText(w) })),
        ranges: out,
        seconds: out.reduce((t, [s, e]) => t + (e - s), 0),
    };
}
