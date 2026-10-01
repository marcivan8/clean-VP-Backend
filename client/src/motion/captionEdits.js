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
