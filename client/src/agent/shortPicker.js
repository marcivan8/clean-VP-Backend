/**
 * shortPicker.js (R91): the strongest passage of a longer talk, for the Reel
 * style ("short social cut and repurposing"). Pure, no imports.
 *
 * R106 — the windows it is asked for are now a minute and up, not 15-60 s.
 * This module did not change: it takes min/max/target per slot and always
 * did, so the move happened entirely in who decides those numbers
 * (agent/shortLength.js). Worth knowing when reading the scoring below:
 * `target` is now content-derived and can be anywhere from 60 s to about
 * 165 s, so the closeness-to-target term matters more than it used to.
 *
 * Works on timeline-time words (store.captions). A window always starts and
 * ends on a sentence boundary (a pause or end punctuation), so the short
 * never opens or closes mid-sentence. Score:
 *   - reveal / punchline / emphasis moments inside it (from the server's
 *     TimelineEventDetector), more when one lands in the first 3 s (the hook);
 *   - speech density (a short with long gaps feels slow);
 *   - an opening that asks or promises something ("how", "why", "here's",
 *     "le secret") gets a small bonus; one that starts on a connector
 *     ("and", "so", "donc", "mais") a penalty, it needs earlier context;
 *   - closer to the target length is better.
 */

const EVENT_WEIGHT = { REVEAL: 3, PUNCHLINE_DETECTED: 3, EMPHASIS_MOMENT: 2 };
const HOOK_S = 3;
const SENTENCE_GAP_S = 0.7;
const HOOK_OPENERS = /^(how|why|what|here'?s|the secret|the truth|the reason|stop|never|nobody|this is|you need|if you|comment|pourquoi|voici|le secret|la v[eé]rit[eé]|arr[eê]te|personne|si tu|tu dois)/i;
const CONNECTORS = /^(and|so|but|because|then|also|et|donc|mais|parce|alors|puis|aussi)\b/i;

function wordText(w) { return String(w?.word ?? w?.text ?? '').trim(); }

/** Split timeline words into sentences or natural speech clauses. */
export function splitSentences(words) {
    const ws = (Array.isArray(words) ? words : [])
        .filter(w => Number.isFinite(Number(w?.start)) && Number.isFinite(Number(w?.end)) && wordText(w))
        .map(w => ({ t: wordText(w), start: Number(w.start), end: Number(w.end) }))
        .sort((a, b) => a.start - b.start);
    const out = [];
    let cur = [];
    for (let i = 0; i < ws.length; i++) {
        cur.push(ws[i]);
        const next = ws[i + 1];
        const endsSentence = /[.!?…]["»)]?$/.test(ws[i].t);
        const pause = next ? next.start - ws[i].end : Infinity;
        const curDur = ws[i].end - cur[0].start;

        // Split on standard punctuation, or on natural clause pauses if the segment is long
        const commaClause = curDur > 6 && /[,;:]["»)]?$/.test(ws[i].t) && pause > 0.25;
        const maxClause = curDur > 12 && pause > 0.3;
        const hardCap = curDur > 18;

        if (!next || endsSentence || pause > SENTENCE_GAP_S || commaClause || maxClause || hardCap) {
            out.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur, text: cur.map(w => w.t).join(' ') });
            cur = [];
        }
    }
    return out;
}

/**
 * @param {Array} words timeline-time words
 * @param {{events?:Array, target?:number, min?:number, max?:number}} opts
 * @returns {{start:number, end:number, score:number, hookEvent:string|null, text:string}|null}
 */
export function findBestShortWindow(words, opts = {}) {
    const target = Number(opts.target) > 0 ? Number(opts.target) : 60;
    const max = Number(opts.max) > 0 ? Number(opts.max) : target;
    const min = Number(opts.min) > 0 ? Math.min(Number(opts.min), max) : Math.min(15, max);
    const events = (Array.isArray(opts.events) ? opts.events : [])
        .map(e => ({ type: e?.eventType, t: Number(e?.timelineTime) }))
        .filter(e => EVENT_WEIGHT[e.type] && Number.isFinite(e.t));
    const sentences = splitSentences(words);
    if (sentences.length === 0) return null;

    let best = null;
    for (let i = 0; i < sentences.length; i++) {
        const opener = sentences[i].text;
        let nWords = 0;
        for (let j = i; j < sentences.length; j++) {
            nWords += sentences[j].words.length;
            const start = sentences[i].start;
            const end = sentences[j].end;
            const dur = end - start;
            if (dur > max) break;
            if (dur < min) continue;
            let score = 0;
            let hookEvent = null;
            for (const e of events) {
                if (e.t < start || e.t > end) continue;
                score += EVENT_WEIGHT[e.type];
                if (e.t - start <= HOOK_S) { score += 2; hookEvent = hookEvent || e.type; }
            }
            score += Math.min(2, (nWords / dur) / 1.5);          // ~3 words/s scores the full 2
            if (HOOK_OPENERS.test(opener)) score += 1;
            if (CONNECTORS.test(opener)) score -= 1.5;
            score += dur / target;                                  // prefer using the length available
            if (!best || score > best.score + 1e-9) {
                best = { start, end, score, hookEvent, text: opener };
            }
        }
    }
    return best;
}

/**
 * R92 round B: several non-overlapping shorts from one long video, each with
 * its own length range (one per platform). Same scoring as
 * findBestShortWindow; picks greedily, best first, never overlapping (with a
 * small gap) and never re-using the same opening sentence.
 *
 * @param {Array} words timeline-time words
 * @param {{events?:Array, slots:Array<{min:number,max:number,target:number,platform?:string}>, gap?:number}} opts
 * @returns {Array<{start,end,score,hookEvent,text,platform}>} in slot order (a slot can come back empty: skipped)
 */
export function findShortCandidates(words, opts = {}) {
    const slots = Array.isArray(opts.slots) ? opts.slots : [];
    const gap = Number.isFinite(Number(opts.gap)) ? Number(opts.gap) : 2;
    const taken = [];
    const out = [];
    const overlaps = (a, b) => a.start < b.end + gap && b.start < a.end + gap;
    for (const slot of slots) {
        const pick = bestWindowAvoiding(words, { ...opts, ...slot }, w => !taken.some(t => overlaps(t, w)));
        if (pick) {
            taken.push(pick);
            out.push({ ...pick, platform: slot.platform || null });
        }
    }
    return out;
}

function bestWindowAvoiding(words, opts, allowed) {
    const target = Number(opts.target) > 0 ? Number(opts.target) : 60;
    const max = Number(opts.max) > 0 ? Number(opts.max) : target;
    const min = Number(opts.min) > 0 ? Math.min(Number(opts.min), max) : Math.min(15, max);
    const events = (Array.isArray(opts.events) ? opts.events : [])
        .map(e => ({ type: e?.eventType, t: Number(e?.timelineTime) }))
        .filter(e => EVENT_WEIGHT[e.type] && Number.isFinite(e.t));
    const sentences = splitSentences(words);
    let best = null;

    // 1. First pass: sentence-aligned combinations
    for (let i = 0; i < sentences.length; i++) {
        const opener = sentences[i].text;
        let nWords = 0;
        for (let j = i; j < sentences.length; j++) {
            nWords += sentences[j].words.length;
            const start = sentences[i].start;
            const end = sentences[j].end;
            const dur = end - start;
            if (dur > max) break;
            if (dur < min) continue;
            if (!allowed({ start, end })) continue;
            let score = 0;
            let hookEvent = null;
            for (const e of events) {
                if (e.t < start || e.t > end) continue;
                score += EVENT_WEIGHT[e.type];
                if (e.t - start <= HOOK_S) { score += 2; hookEvent = hookEvent || e.type; }
            }
            score += Math.min(2, (nWords / dur) / 1.5);
            if (HOOK_OPENERS.test(opener)) score += 1;
            if (CONNECTORS.test(opener)) score -= 1.5;
            // Closeness to the slot's target
            score += 1 - Math.min(1, Math.abs(dur - target) / target);
            if (!best || score > best.score + 1e-9) best = { start, end, score, hookEvent, text: opener };
        }
    }

    // 2. Fallback: if sentence combinations yielded nothing, slide across words
    if (!best && Array.isArray(words) && words.length >= 5) {
        const ws = words.filter(w => Number.isFinite(Number(w?.start)) && Number.isFinite(Number(w?.end)));
        for (let i = 0; i < ws.length; i += 3) {
            const start = Number(ws[i].start);
            for (let j = i + 4; j < ws.length; j += 2) {
                const end = Number(ws[j].end);
                const dur = end - start;
                if (dur > max) break;
                if (dur < min) continue;
                if (!allowed({ start, end })) continue;
                const score = 1.0 + (1 - Math.min(1, Math.abs(dur - target) / target));
                const text = ws.slice(i, i + 8).map(wordText).join(' ');
                if (!best || score > best.score + 1e-9) {
                    best = { start, end, score, hookEvent: null, text };
                }
            }
        }
    }

    return best;
}

/**
 * Fallback when transcript words are missing or empty:
 * Intelligently extracts non-overlapping short candidate windows across the timeline
 * using clip cut points, semantic events, and golden-ratio moments.
 *
 * @param {number} totalDuration Total timeline duration in seconds
 * @param {{slots:Array, events?:Array, tracks?:Array, gap?:number}} opts
 * @returns {Array<{start:number, end:number, score:number, hookEvent:string|null, text:string, platform:string|null}>}
 */
export function findShortCandidatesFallback(totalDuration, opts = {}) {
    const total = Math.max(0, Number(totalDuration) || 0);
    const slots = Array.isArray(opts.slots) ? opts.slots : [];
    if (total <= 5 || slots.length === 0) return [];

    const gap = Number.isFinite(Number(opts.gap)) ? Number(opts.gap) : 2;
    const cuts = new Set([0, total]);

    // Collect cut points from tracks
    for (const track of opts.tracks || []) {
        for (const clip of track.clips || []) {
            const s = Number(clip.start) || 0;
            const e = s + (Number(clip.duration) || 0);
            if (s > 0 && s < total) cuts.add(Math.round(s * 10) / 10);
            if (e > 0 && e < total) cuts.add(Math.round(e * 10) / 10);
        }
    }
    const cutPoints = Array.from(cuts).sort((a, b) => a - b);
    const snapCut = (t, maxDelta = 3) => {
        let best = t;
        let minDiff = maxDelta;
        for (const cp of cutPoints) {
            const d = Math.abs(cp - t);
            if (d < minDiff) { minDiff = d; best = cp; }
        }
        return best;
    };

    const taken = [];
    const overlaps = (a, b) => a.start < b.end + gap && b.start < a.end + gap;
    const out = [];

    // Fallback golden anchor ratios for up to 5 slots
    const anchorRatios = [0.03, 0.42, 0.72, 0.22, 0.88];
    // Neutral labels: without a transcript nothing is known about the content.
    const label = (t) => `Moment at ${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;

    slots.forEach((slot, idx) => {
        const target = Math.max(slot.min || 15, Math.min(slot.max || 60, slot.target || 30));
        const ratio = anchorRatios[idx % anchorRatios.length];
        let idealStart = Math.max(0, (total - target) * ratio);
        let start = snapCut(idealStart, 2.5);
        let end = Math.min(total, start + target);

        // Adjust if it pushes beyond total
        if (end > total) {
            end = total;
            start = Math.max(0, end - target);
        }

        // Avoid overlap with existing picks; no free window means no short.
        let candidate = { start: Math.round(start * 10) / 10, end: Math.round(end * 10) / 10 };
        if (taken.some(t => overlaps(t, candidate))) {
            candidate = null;
            for (let searchStart = 0; searchStart + target <= total; searchStart += 5) {
                const testCand = { start: searchStart, end: searchStart + target };
                if (!taken.some(t => overlaps(t, testCand))) { candidate = testCand; break; }
            }
            if (!candidate) return;
        }

        if (candidate.end - candidate.start >= (slot.min ? Math.min(slot.min, 12) : 10)) {
            taken.push(candidate);
            out.push({
                start: candidate.start,
                end: candidate.end,
                score: 2.5 - idx * 0.2,
                hookEvent: null,
                text: label(candidate.start),
                platform: slot.platform || null,
            });
        }
    });

    return out;
}

/**
 * Ranges to cut so only [start, end] stays, padded a little so the first and
 * last words are not clipped.
 * @returns {Array<[number, number]>}
 */
export function rangesOutside(window, total, pad = { before: 0.15, after: 0.3 }) {
    if (!window || !(total > 0)) return [];
    const a = Math.max(0, window.start - (pad.before ?? 0));
    const b = Math.min(total, window.end + (pad.after ?? 0));
    const out = [];
    if (b < total - 0.05) out.push([b, total]);
    if (a > 0.05) out.push([0, a]);
    return out;
}

export default { splitSentences, findBestShortWindow, findShortCandidates, findShortCandidatesFallback, rangesOutside };

