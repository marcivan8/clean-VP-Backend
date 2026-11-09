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

/**
 * R158 — what each detected moment is WORTH, and why these numbers.
 *
 * The weights used to be REVEAL 3 / PUNCHLINE 3 / EMPHASIS 2 with a flat +2
 * for anything landing in the first 3 s, against +1 for an explicit verbal
 * hook. That made a bare audio peak worth +4 and "Here's the secret nobody
 * tells you…" worth +1 — so one loud noise anywhere outranked the strongest
 * verbal signal the transcript could offer. Measured: a single stray
 * EMPHASIS_MOMENT in a video's outro scored 4.50 and took the pick off a
 * verbally-hooked passage scoring 3.42. A cough, a laugh or a door slam could
 * decide the short.
 *
 * The weights now follow how much each signal actually tells us:
 *
 *   REVEAL (3)   — caption wording that reads as a reveal, or a deliberate
 *                  big push-in. Grounded in words or in an editing decision.
 *   PUNCHLINE (3)— a silence gap followed by a loud peak: a real rhetorical
 *                  shape (setup, pause, payoff), not just volume.
 *   EMPHASIS (1) — a standalone loud peak. The weakest signal there is: any
 *                  noise qualifies. It can support a pick, never carry one.
 */
const EVENT_WEIGHT = { REVEAL: 3, PUNCHLINE_DETECTED: 3, EMPHASIS_MOMENT: 1 };

/**
 * Events that may earn the hook-proximity bonus.
 *
 * A moment near the start is only a hook if it MEANS something. EMPHASIS is
 * excluded: "it was loud 2 seconds in" is not a hook, and treating it as one
 * is exactly how the stray-peak hijack happened.
 */
const HOOK_EVENTS = new Set(['REVEAL', 'PUNCHLINE_DETECTED']);

/** Ceiling on the total event contribution, so a peak-storm cannot run away. */
const EVENT_CAP = 6;

/** An explicit verbal hook is worth as much as a detected reveal. It should be. */
const VERBAL_HOOK = 3;

const HOOK_BONUS = 2;
const HOOK_S = 3;

/**
 * The lowest score worth presenting as a short.
 *
 * Chosen from the arithmetic rather than by feel. With no content signal at
 * all, a window can only earn the two state-independent terms:
 *
 *   speech density   max 2.0   (saturates at ~3 words/s)
 *   length fit       max 1.0
 *                    ───────
 *                        3.0   ← the ceiling for a window with NOTHING in it
 *
 * So any floor above 3.0 provably requires at least one real signal: a verbal
 * hook (3), a reveal or punchline (3 + 2 near the start), or at minimum a
 * detected emphasis (1). 3.5 is just above that ceiling, which keeps a
 * marginal-but-real pick (one emphasis + dense speech + good length = 4.0)
 * while refusing pure filler.
 *
 * This exists because `findShortCandidates` previously returned the best
 * non-overlapping window per slot NO MATTER HOW BAD IT WAS. On a talk with one
 * strong passage it still produced three shorts: the real one at 13.37 and two
 * at 2.41 and 2.39 — noise, presented identically to the good one. There was
 * no way to say "this video supports one short".
 */
export const MIN_WINDOW_SCORE = 3.5;
const SENTENCE_GAP_S = 0.7;
const HOOK_OPENERS = /^(how|why|what|here'?s|the secret|the truth|the reason|stop|never|nobody|this is|you need|if you|comment|pourquoi|voici|le secret|la v[eé]rit[eé]|arr[eê]te|personne|si tu|tu dois)/i;
const CONNECTORS = /^(and|so|but|because|then|also|et|donc|mais|parce|alors|puis|aussi)\b/i;

function wordText(w) { return String(w?.word ?? w?.text ?? '').trim(); }

/**
 * R159 — the identity a candidate window is judged under.
 *
 * Client and server have to agree on this string with no shared type: the
 * client pools windows and sends ids, the judge returns verdicts keyed by
 * them, and the picker looks each one up again while scoring. Two decimal
 * places because both ends come from the SAME sentence objects on both passes
 * (pool and pick), so the digits are bit-identical rather than merely close.
 */
export function windowId(start, end) {
    return `w${Number(start).toFixed(2)}-${Number(end).toFixed(2)}`;
}

/**
 * How far a judge's verdict may move a window's score.
 *
 * Bounded for the same reason EditPolicy's JUDGE_SPAN is, but calibrated to a
 * different scale. Here the terms are worth 1-6 points each (see EVENT_WEIGHT
 * and VERBAL_HOOK), so +-2 is about one real signal's worth of reach: enough
 * to settle a near-tie between two plausible passages, and nowhere near
 * enough to lift a 2.4 filler window over a 13.4 one. A judge that could do
 * the latter would not be arbitrating the heuristic, it would be replacing it
 * — without ever having seen the waveform, the cut or the events.
 */
export const JUDGE_SPAN = 2;

/**
 * Two windows are "the same passage" when they mostly cover each other.
 *
 * Used for two things that have to agree: which runners-up are worth a judge
 * call (a pool of eight trims of one moment teaches the judge nothing), and
 * which windows a verdict carries over to. 0.6 of the SHORTER window keeps
 * two genuinely different passages that happen to touch, and collapses a
 * family of trims.
 */
const POOL_OVERLAP = 0.6;

/**
 * Turn a verdict map back into windows with times.
 *
 * The ids carry the times, so this is a parse rather than a lookup — which
 * matters because the picker needs to know WHERE a judged passage was, not
 * just that something was judged. Returns null when there is nothing usable,
 * so every caller's "no judge" path is one falsy check.
 *
 * @returns {Array<{start:number,end:number,confidence:number}>|null}
 */
export function compileJudge(verdicts) {
    if (!verdicts || typeof verdicts !== 'object') return null;
    const out = [];
    for (const [id, v] of Object.entries(verdicts)) {
        const m = /^w(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/.exec(String(id));
        if (!m) continue;
        const start = Number(m[1]);
        const end = Number(m[2]);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
        // `typeof === 'number'` is load-bearing exactly as it is in
        // judgeBlend.js: Number(null) is 0, so a verdict of
        // { confidence: null } would coerce to a legitimate score of ZERO and
        // apply the full NEGATIVE swing — the judge's silence read as its
        // harshest possible verdict.
        const raw = (v && typeof v.confidence === 'number' && Number.isFinite(v.confidence))
            ? v.confidence
            : null;
        if (raw === null) continue;
        out.push({ start, end, confidence: Math.min(1, Math.max(0, raw)) });
    }
    return out.length > 0 ? out : null;
}

/**
 * The verdict for one window as a score delta, centred so an average verdict
 * (0.5) changes nothing.
 *
 * WHY THIS MATCHES BY OVERLAP AND NOT BY ID ALONE
 * ----------------------------------------------
 * The pool collapses near-duplicates (see POOL_OVERLAP), so the window the
 * judge was shown is usually one of a FAMILY of windows differing by a
 * sentence at either end. Matching on the exact id would make a verdict apply
 * to one member of that family and not the others, with two bad consequences:
 * the picker's argmax often lands on an unjudged sibling, so the verdict does
 * nothing at all; and a veto could be dodged by shifting the window by one
 * second. A judge judges a PASSAGE, so every trim of that passage inherits
 * the judgement. Exact id still wins when it is present.
 *
 * @param {Array|Object|null} verdicts compiled entries, or a raw verdict map
 * @returns {{delta:number, confidence:number|null}}
 */
export function judgeDelta(verdicts, start, end) {
    const entries = Array.isArray(verdicts) ? verdicts : compileJudge(verdicts);
    if (!entries) return { delta: 0, confidence: null };

    let hit = null;
    let bestFrac = 0;
    for (const e of entries) {
        if (Math.abs(e.start - start) < 0.005 && Math.abs(e.end - end) < 0.005) { hit = e; break; }
        const inter = Math.min(e.end, end) - Math.max(e.start, start);
        if (inter <= 0) continue;
        const shorter = Math.min(e.end - e.start, end - start);
        const frac = shorter > 0 ? inter / shorter : 0;
        if (frac >= POOL_OVERLAP && frac > bestFrac) { bestFrac = frac; hit = e; }
    }
    if (!hit) return { delta: 0, confidence: null };
    return { delta: (hit.confidence - 0.5) * 2 * JUDGE_SPAN, confidence: hit.confidence };
}

function mostlySame(a, b) {
    const inter = Math.min(a.end, b.end) - Math.max(a.start, b.start);
    if (inter <= 0) return false;
    const shorter = Math.min(a.end - a.start, b.end - b.start);
    return shorter > 0 && inter / shorter >= POOL_OVERLAP;
}

/**
 * R159 — the top few GENUINELY DIFFERENT candidate windows, for the judge.
 *
 * The picker is an argmax: it computes a score for every legal window and
 * keeps one. That is all the heuristic can use, but it throws away exactly
 * what arbitration needs — the runners-up. This returns them.
 *
 * It deliberately does NOT choose, filter by quality or respect the
 * cross-slot non-overlap rule. Those are the picker's job and they still run
 * afterwards, over scores the judge has weighed in on. All this does is
 * enumerate the same windows the picker would consider and hand back the best
 * distinct handful, with the words a judge needs to read them.
 *
 * @param {Array} words timeline-time words
 * @param {{events?:Array, slots?:Array, perSlot?:number, limit?:number,
 *          lengthMode?:'target'|'cap'}} opts
 * @returns {Array<{id,start,end,dur,words:number,opener,tail,score,hookEvent,platform}>}
 */
export function shortWindowPool(words, opts = {}) {
    const slots = (Array.isArray(opts.slots) && opts.slots.length > 0) ? opts.slots : [opts];
    const events = normalizeEvents(opts.events);
    const sentences = splitSentences(words);
    if (sentences.length === 0) return [];

    const perSlot = Number(opts.perSlot) > 0 ? Number(opts.perSlot) : 3;
    const limit = Number(opts.limit) > 0 ? Number(opts.limit) : 8;
    const byCap = opts.lengthMode === 'cap';

    const picked = [];

    for (const slot of slots) {
        const target = Number(slot.target) > 0 ? Number(slot.target) : 60;
        const max = Number(slot.max) > 0 ? Number(slot.max) : target;
        const min = Number(slot.min) > 0 ? Math.min(Number(slot.min), max) : Math.min(15, max);

        const found = [];
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
                const { score, hookEvent } = scoreWindow({
                    start, end, dur, nWords, opener, events,
                    // Must match the path this pool is feeding, or the pool
                    // would rank by one rule and the picker by another.
                    lengthTerm: byCap ? dur / target : 1 - Math.min(1, Math.abs(dur - target) / target),
                });
                found.push({
                    id: windowId(start, end),
                    start, end, dur,
                    words: nWords,
                    opener,
                    tail: sentences[j].text,
                    score, hookEvent,
                    platform: slot.platform || null,
                });
            }
        }

        found.sort((a, b) => b.score - a.score || a.start - b.start);
        let kept = 0;
        for (const w of found) {
            if (kept >= perSlot) break;
            if (picked.some(q => mostlySame(q, w))) continue;
            picked.push(w);
            kept += 1;
        }
    }

    return picked
        .sort((a, b) => b.score - a.score || a.start - b.start)
        .slice(0, limit);
}

/**
 * Score one candidate window. ONE definition, used by every path.
 *
 * This was duplicated in findBestShortWindow and bestWindowAvoiding with the
 * same six terms written out twice, which is why a re-weighting could
 * previously be applied to one path and silently miss the other.
 *
 * `lengthTerm` is the only thing that genuinely differs between callers:
 *   - the single-short path scores against the CAP (R93: when a trim is
 *     unavoidable, use as much of the allowed length as the content supports,
 *     rather than collapsing every Reel to the style's typical 22 s)
 *   - the multi-short path scores closeness to each slot's target
 *
 * @returns {{score:number, hookEvent:string|null}}
 */
/**
 * Keep only the events the scorer understands, as {type, t}.
 * Extracted because this filter was written out identically in both entry
 * points — the same duplication that let the weights drift between paths.
 */
function normalizeEvents(events) {
    return (Array.isArray(events) ? events : [])
        .map(e => ({ type: e?.eventType, t: Number(e?.timelineTime) }))
        .filter(e => EVENT_WEIGHT[e.type] && Number.isFinite(e.t));
}

function scoreWindow({ start, end, dur, nWords, opener, events, lengthTerm }) {
    let eventScore = 0;
    let hookEvent = null;

    for (const e of events) {
        if (e.t < start || e.t > end) continue;
        eventScore += EVENT_WEIGHT[e.type] || 0;
        // Only a meaningful moment near the start counts as a hook.
        if (HOOK_EVENTS.has(e.type) && e.t - start <= HOOK_S) {
            eventScore += HOOK_BONUS;
            hookEvent = hookEvent || e.type;
        }
    }

    let score = Math.min(EVENT_CAP, eventScore);
    score += Math.min(2, (nWords / dur) / 1.5);   // ~3 words/s scores the full 2

    const verbalHook = HOOK_OPENERS.test(opener);
    if (verbalHook) score += VERBAL_HOOK;
    if (CONNECTORS.test(opener)) score -= 1.5;
    score += lengthTerm;

    // A window that OPENS on an explicit verbal hook is reported as hooked
    // even with no detected event. The Shorts panel reads `hookEvent` to
    // decide between "Opens on a key moment" and "No strong moment in the
    // first N s: a text hook on screen will help" — and telling someone their
    // short has no hook when it opens on "Here's the secret nobody tells
    // you…" was simply wrong.
    if (!hookEvent && verbalHook) hookEvent = 'VERBAL_HOOK';

    return { score, hookEvent };
}

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
 * No quality floor here, deliberately: this path serves an explicit "make a
 * short of this" request and it CUTS THE TIMELINE. Refusing to act because the
 * best available passage scored poorly would be worse than acting on it — the
 * user asked. The caller reports the score instead (see MIN_WINDOW_SCORE and
 * MediaExecutionEngine's extract_short message), so a weak pick is disclosed
 * rather than silently presented as "the strongest moment".
 *
 * @param {Array} words timeline-time words
 * @param {{events?:Array, target?:number, min?:number, max?:number}} opts
 * @returns {{start:number, end:number, score:number, hookEvent:string|null, text:string}|null}
 */
export function findBestShortWindow(words, opts = {}) {
    const target = Number(opts.target) > 0 ? Number(opts.target) : 60;
    const max = Number(opts.max) > 0 ? Number(opts.max) : target;
    const min = Number(opts.min) > 0 ? Math.min(Number(opts.min), max) : Math.min(15, max);
    const events = normalizeEvents(opts.events);
    // R159 — optional verdicts, keyed by windowId. Absent (the default, and
    // the only state on a project with no judge model) leaves every delta at
    // zero, so this path is arithmetically identical to before.
    const judge = compileJudge(opts.judgeScores);
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
            const { score, hookEvent } = scoreWindow({
                start, end, dur, nWords, opener, events,
                lengthTerm: dur / target,   // prefer using the length available
            });
            const { delta, confidence } = judgeDelta(judge, start, end);
            const blended = score + delta;
            if (!best || blended > best.score + 1e-9) {
                // `score` is the blended one, because that is what the pick
                // was actually made on and reporting the pre-judge number
                // would misdescribe the decision. `baseScore` keeps the
                // heuristic's own verdict, which is what the quality floor
                // is measured against.
                best = { start, end, score: blended, baseScore: score, judge: confidence, hookEvent, text: opener };
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
    // R158 — a quality floor. Pass 0 to get the old behaviour (every slot
    // filled with whatever scored highest, however poor).
    const floor = Number.isFinite(Number(opts.scoreFloor)) ? Number(opts.scoreFloor) : MIN_WINDOW_SCORE;
    // Optional out-parameter so the caller can TELL the user why it got fewer
    // shorts than it asked for. Added as an opts field rather than a changed
    // return type so every existing caller and test is unaffected.
    const report = (opts.report && typeof opts.report === 'object') ? opts.report : null;
    if (report) {
        report.belowFloor = [];
        report.noWindow = [];
        report.judgeVetoed = [];
        report.judged = 0;
        report.floor = floor;
    }

    const taken = [];
    const out = [];
    const overlaps = (a, b) => a.start < b.end + gap && b.start < a.end + gap;
    for (const slot of slots) {
        const pick = bestWindowAvoiding(words, { ...opts, ...slot }, w => !taken.some(t => overlaps(t, w)));
        if (!pick) {
            if (report) report.noWindow.push(slot.platform || null);
            continue;
        }
        // R159 — the floor is applied to BOTH scores, and that asymmetry is
        // the whole safety property of letting a judge in here:
        //
        //   baseScore < floor  → the heuristic found nothing worth posting.
        //                        A verdict cannot overrule that, because the
        //                        judge has seen a few hundred characters of
        //                        transcript and not the waveform, the cut or
        //                        the detected moments. It may not ADMIT.
        //   blended  < floor  → the judge read the passage and thinks it is
        //                        not postable. That it may say, because the
        //                        failure mode is one fewer short, disclosed —
        //                        the same direction `fitShortCount` already
        //                        errs in. It may VETO.
        //
        // Reported separately so the message can give the real reason rather
        // than blaming arithmetic for a judgement or the reverse.
        const vetoed = pick.baseScore >= floor && pick.score < floor;
        if (pick.baseScore < floor || pick.score < floor) {
            // Deliberately NOT added to `taken`: a window rejected for quality
            // must not also block a later slot from using that stretch.
            if (report) {
                const row = { platform: slot.platform || null, score: pick.score, baseScore: pick.baseScore };
                (vetoed ? report.judgeVetoed : report.belowFloor).push(row);
            }
            continue;
        }
        if (report && typeof pick.judge === 'number') report.judged += 1;
        taken.push(pick);
        out.push({ ...pick, platform: slot.platform || null });
    }
    return out;
}

function bestWindowAvoiding(words, opts, allowed) {
    const target = Number(opts.target) > 0 ? Number(opts.target) : 60;
    const max = Number(opts.max) > 0 ? Number(opts.max) : target;
    const min = Number(opts.min) > 0 ? Math.min(Number(opts.min), max) : Math.min(15, max);
    const events = normalizeEvents(opts.events);
    const judge = compileJudge(opts.judgeScores);
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
            const { score, hookEvent } = scoreWindow({
                start, end, dur, nWords, opener, events,
                // Closeness to the slot's target
                lengthTerm: 1 - Math.min(1, Math.abs(dur - target) / target),
            });
            const { delta, confidence } = judgeDelta(judge, start, end);
            const blended = score + delta;
            if (!best || blended > best.score + 1e-9) {
                best = { start, end, score: blended, baseScore: score, judge: confidence, hookEvent, text: opener };
            }
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
                    // No judge here on purpose: these windows are not
                    // sentence-aligned, so they were never pooled and no
                    // verdict can exist for them.
                    best = { start, end, score, baseScore: score, judge: null, hookEvent: null, text };
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

export default {
    splitSentences, findBestShortWindow, findShortCandidates,
    findShortCandidatesFallback, rangesOutside,
    shortWindowPool, windowId, judgeDelta, compileJudge, JUDGE_SPAN,
};

