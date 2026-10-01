/**
 * transcriptSelect.js — pure helpers for the mobile transcript sheet:
 * the words to show (same rule as TranscriptPanel), filler words, and the
 * timeline ranges a selection covers. All times are TIMELINE seconds.
 */
import { mapTranscriptToTimeline } from './transcriptMap.js';

/**
 * Words on the edited timeline, in order. Prefers transcripts known to be
 * in source time (transcriptVerified); older projects without that marker use
 * every entry; with no per-file transcript, the store's timeline captions.
 */
export function getDisplayWords({ transcripts, transcriptVerified, tracks, assets, captions }) {
    const all = transcripts && typeof transcripts === 'object' ? transcripts : {};
    if (Object.keys(all).length > 0) {
        const verified = Object.fromEntries(Object.entries(all).filter(([k]) => transcriptVerified?.[k]));
        const source = Object.keys(verified).length > 0 ? verified : all;
        const mapped = mapTranscriptToTimeline({ tracks, assets, transcripts: source });
        if (mapped.length > 0) return mapped;
    }
    return (Array.isArray(captions) ? captions : [])
        .filter(w => Number.isFinite(Number(w?.start)))
        .map(w => ({ ...w, word: w.word ?? w.text ?? '' }));
}

// Single-word hesitations in English and French. Kept short on purpose:
// words like "like", "so" or "bah" often carry meaning, so they are left alone.
const FILLERS = new Set(['um', 'umm', 'uhm', 'uh', 'uhh', 'erm', 'er', 'hmm', 'mm', 'mmm', 'euh', 'euhm', 'heu', 'hum']);

export const normalizeWord = (w) => String(w ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z']/g, '');

/** Indices of filler words. */
export function findFillerIndices(words) {
    const out = [];
    (Array.isArray(words) ? words : []).forEach((w, i) => {
        if (FILLERS.has(normalizeWord(w?.word ?? w?.text))) out.push(i);
    });
    return out;
}

/**
 * Timeline ranges for a set of word indices, neighbours merged
 * (two fillers in a row become one cut).
 * @returns {Array<[number, number]>}
 */
export function rangesForIndices(words, indices) {
    const list = Array.isArray(words) ? words : [];
    const idx = [...new Set(indices || [])].filter(i => list[i]).sort((a, b) => a - b);
    const out = [];
    for (const i of idx) {
        const a = Number(list[i].start);
        const b = Number(list[i].end);
        if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
        const last = out[out.length - 1];
        if (last && last.i === i - 1) { last.range[1] = Math.max(last.range[1], b); last.i = i; }
        else out.push({ i, range: [a, b] });
    }
    return out.map(o => o.range);
}

/** { first, last, count, seconds, start, end } for a selection between two indices (any order). */
export function selectionSummary(words, anchor, focus) {
    const list = Array.isArray(words) ? words : [];
    if (!list.length || anchor == null || focus == null) return null;
    const first = Math.max(0, Math.min(anchor, focus));
    const last = Math.min(list.length - 1, Math.max(anchor, focus));
    const start = Number(list[first]?.start);
    const end = Number(list[last]?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    return { first, last, count: last - first + 1, seconds: Math.max(0, end - start), start, end };
}

/** Index of the word playing at `time` (last word that started), or -1. */
export function activeWordIndexAt(words, time) {
    const list = Array.isArray(words) ? words : [];
    const t = Number(time) || 0;
    let idx = -1;
    for (let i = 0; i < list.length; i++) {
        if (Number(list[i].start) <= t) idx = i; else break;
    }
    return idx;
}
