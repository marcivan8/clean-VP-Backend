/**
 * shortPicker.js (R91): the strongest 15-60 s of a longer talk, for the Reel
 * style ("short social cut and repurposing"). Pure, no imports.
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

/** Split timeline words into sentences. */
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
        if (!next || endsSentence || next.start - ws[i].end > SENTENCE_GAP_S) {
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
            // Closeness to the slot's target (not just "longer is better"):
            // a TikTok slot should not grow to the Shorts length.
            score += 1 - Math.min(1, Math.abs(dur - target) / target);
            if (!best || score > best.score + 1e-9) best = { start, end, score, hookEvent, text: opener };
        }
    }
    return best;
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

export default { splitSentences, findBestShortWindow, findShortCandidates, rangesOutside };
