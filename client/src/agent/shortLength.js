/**
 * client/src/agent/shortLength.js
 *
 * R106 — how long a short should be, decided from the content rather than
 * from a per-platform constant.
 *
 * ── WHAT CHANGED, AND WHY ───────────────────────────────────────────────
 *
 * The slot ranges used to come straight off `PLATFORM_PROFILES[].length`,
 * which produced windows of roughly 12-45 s: 15.75-44 s for TikTok, 11-39 s
 * for Reels, 22-60 s for Shorts. Those were the "attention span" numbers,
 * and they are the reason every short came out about half a minute long
 * whatever was being said in it.
 *
 * Two things are wrong with deciding length that way. The obvious one is
 * that it ignores the material: a dense explanation with three payoffs in it
 * gets cut to the same length as a one-line joke. The less obvious one is
 * that those ceilings were never platform LIMITS — TikTok accepts an hour,
 * Reels and Shorts accept three minutes — so the edit was being constrained
 * by an editorial guess that nothing enforced.
 *
 * So: a hard floor of MIN_SHORT_SECONDS, and above it a target that grows
 * with how much the content can actually sustain.
 *
 * ── THE SIGNALS, AND WHY EACH ONE ───────────────────────────────────────
 *
 * SPEECH DENSITY. Words per second across the transcript. A fast, packed
 * delivery fits more argument into the same minute and holds up longer; a
 * sparse one with long gaps does not, and stretching it just adds dead air.
 *
 * PAYOFF DENSITY. Reveals, punchlines and emphasis moments per minute, from
 * the server's TimelineEventDetector. A stretch of talk with several payoffs
 * in it gives a viewer reasons to keep watching; one with none does not earn
 * a third minute however fast it is spoken.
 *
 * SOURCE LENGTH. A forty-minute podcast contains long self-contained
 * passages. A three-minute clip does not, and asking for two minutes out of
 * it leaves nothing for a second short.
 *
 * STYLE. The editing style the user picked says what they are making. A Reel
 * sits near the floor; an interview or podcast runs long by nature.
 *
 * PLATFORM. Only as a CEILING now, not as a target. Reels and Shorts cap at
 * three minutes by upload limit, so the editorial ceiling stays under that
 * with room for the Pro Finish outro; TikTok's real limit is an hour, which
 * is not a useful ceiling, so it takes the same editorial one.
 *
 * ── THE RULE THAT OVERRIDES EVERYTHING ──────────────────────────────────
 *
 * You cannot cut sixty seconds out of a forty-second video. Every number
 * here is clamped to what the source actually contains, and the floor is the
 * first thing to give way. A caller that asks for three shorts from a
 * ninety-second clip gets one, not three bad ones.
 *
 * Pure: no store, no network, no imports beyond the platform table.
 */

import { PLATFORM_PROFILES } from './PlatformProfiles.js';

/**
 * The floor, in seconds. Every short is at least this long unless the source
 * is shorter than it. This is a product decision, not a platform one: all
 * three platforms accept far more, and a minute is the point where a cut has
 * room to make an argument rather than only land a hook.
 */
export const MIN_SHORT_SECONDS = 60;

/**
 * The editorial ceiling for a platform. Lives on the profile itself
 * (`shortForm`) so the picker and the Shorts panel's own length notes read
 * ONE table — the previous split, where the panel judged against
 * `length.ideal` and the picker used something else, is how every short
 * ended up labelled "too long" the moment the floor moved.
 */
function ceilingFor(platform) {
    const sf = PLATFORM_PROFILES[platform]?.shortForm;
    return Number(sf?.max) > 0 ? Number(sf.max) : 150;
}

/** How far the style pushes the target between the floor and the ceiling. */
const STYLE_FACTOR = Object.freeze({
    reel: 0.35,           // punchy by definition; just past the floor
    vlog: 0.55,
    talking_head: 0.65,
    interview: 0.85,      // two voices need setup before a payoff lands
    podcast: 0.9,         // long-form by nature
});

const EVENT_WEIGHT = { REVEAL: 1, PUNCHLINE_DETECTED: 1, EMPHASIS_MOMENT: 0.6 };

const clamp01 = n => (n < 0 ? 0 : n > 1 ? 1 : n);
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** Words per second across the spoken part of the transcript, or null. */
export function speechDensity(words) {
    const ws = (Array.isArray(words) ? words : []).filter(w => Number.isFinite(Number(w?.start)) && Number.isFinite(Number(w?.end)));
    if (ws.length < 10) return null;
    const first = Math.min(...ws.map(w => Number(w.start)));
    const last = Math.max(...ws.map(w => Number(w.end)));
    const span = last - first;
    if (!(span > 1)) return null;
    return ws.length / span;
}

/** Scored payoffs per minute across the source, or null when nothing was detected. */
export function payoffDensity(events, totalDuration) {
    const list = Array.isArray(events) ? events : [];
    const total = num(totalDuration, 0);
    if (!(total > 1)) return null;
    const weighted = list.reduce((sum, e) => sum + (EVENT_WEIGHT[e?.eventType] || 0), 0);
    if (weighted === 0) return list.length === 0 ? null : 0;
    return (weighted / total) * 60;
}

/**
 * Plan one short's length range.
 *
 * @param {{platform?:string, totalDuration:number, words?:Array, events?:Array, style?:string|null}} opts
 * @returns {{min:number, max:number, target:number, floored:boolean, reasons:string[]}}
 *   `floored` is true when the source was too short to honour the minimum,
 *   so the caller can say so rather than silently shipping a 40 s "minute".
 */
export function planShortLength(opts = {}) {
    const total = Math.max(0, num(opts.totalDuration, 0));
    const platform = PLATFORM_PROFILES[opts.platform] ? opts.platform : 'tiktok';
    const ceiling = ceilingFor(platform);
    const reasons = [];

    // The source is the first and hardest constraint: a window cannot be
    // longer than the thing it is cut from, minus a little room at each end
    // so a short is never the entire timeline edge to edge.
    const usable = Math.max(0, total - 1);

    if (usable < MIN_SHORT_SECONDS) {
        // Honest degradation: take what exists and tell the caller it is not
        // a minute, rather than pretending the floor was met.
        const len = Math.max(0, usable);
        return {
            min: Math.min(10, len),
            max: len,
            target: len,
            floored: true,
            reasons: [`the source is only ${Math.round(total)} s, so a full minute cannot be cut from it`],
        };
    }

    const styleFactor = STYLE_FACTOR[opts.style] ?? 0.55;
    if (opts.style && STYLE_FACTOR[opts.style] !== undefined) {
        reasons.push(`the ${String(opts.style).replace('_', ' ')} style ${styleFactor >= 0.8 ? 'runs long' : styleFactor <= 0.4 ? 'stays tight' : 'sits mid-length'}`);
    }

    // ── Density of what is actually said ────────────────────────────────
    // 2.2 w/s is unhurried speech, 3.4 is fast. Below the floor the content
    // cannot fill extra time; above the ceiling it comfortably can.
    const density = speechDensity(opts.words);
    let densityScore = 0.5;
    if (density !== null) {
        densityScore = clamp01((density - 2.2) / (3.4 - 2.2));
        if (densityScore > 0.66) reasons.push('the delivery is dense, so it holds a longer cut');
        else if (densityScore < 0.33) reasons.push('the delivery is spread out, so a longer cut would drag');
    }

    // ── Density of payoffs ──────────────────────────────────────────────
    // Two scored moments a minute is a lot; none means nothing to sustain a
    // viewer past the first point.
    const payoffs = payoffDensity(opts.events, total);
    let payoffScore = 0.5;
    if (payoffs !== null) {
        payoffScore = clamp01(payoffs / 2);
        if (payoffScore > 0.66) reasons.push('there are several payoffs to carry it');
        else if (payoffScore < 0.2) reasons.push('there are few marked moments, so it stays near the minimum');
    }

    // ── How much source there is to draw on ─────────────────────────────
    // Ten minutes is plenty; at two minutes a long short leaves nothing for
    // a second one.
    const sourceScore = clamp01((total - 120) / (600 - 120));
    if (sourceScore > 0.66) reasons.push('the source is long enough to give a full passage');

    const richness = clamp01(0.4 * densityScore + 0.35 * payoffScore + 0.25 * sourceScore);
    const headroom = Math.max(0, ceiling - MIN_SHORT_SECONDS);

    let target = MIN_SHORT_SECONDS + headroom * richness * styleFactor;
    // Never ask for more than the source can give, and keep the floor.
    target = Math.min(target, usable);
    target = Math.max(MIN_SHORT_SECONDS, target);

    // The picker needs room above the target to reach a sentence ending; the
    // max is that headroom, not a second target.
    const max = Math.min(ceiling, usable, Math.max(target * 1.3, MIN_SHORT_SECONDS + 15));

    return {
        min: MIN_SHORT_SECONDS,
        max: Math.max(MIN_SHORT_SECONDS, max),
        target: Math.round(target),
        floored: false,
        reasons,
    };
}

/**
 * How many shorts of at least the minimum length a source can yield without
 * overlapping. Asking for three from a ninety-second clip should return one
 * good short, not three bad ones or two silent failures.
 *
 * Counted against the length actually PLANNED, not against the floor. Using
 * the floor would promise three shorts from a source that can only hold one
 * at the length this content wants, and the picker would then drop two of
 * them with a message that reads like a bug.
 *
 * @param {number} totalDuration
 * @param {number} requested
 * @param {number} [perShortSeconds] planned length of one short; defaults to the floor
 * @param {number} [gap] seconds kept between windows
 */
export function fitShortCount(totalDuration, requested, perShortSeconds = MIN_SHORT_SECONDS, gap = 2) {
    const total = Math.max(0, num(totalDuration, 0));
    const want = Math.max(1, Math.floor(num(requested, 1)));
    if (total < MIN_SHORT_SECONDS) return 1;   // one short, honestly undersized
    const per = Math.max(MIN_SHORT_SECONDS, num(perShortSeconds, MIN_SHORT_SECONDS)) + gap;
    return Math.max(1, Math.min(want, Math.floor(total / per)));
}

export default { MIN_SHORT_SECONDS, planShortLength, fitShortCount, speechDensity, payoffDensity };
