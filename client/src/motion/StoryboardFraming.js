/**
 * client/src/motion/StoryboardFraming.js
 *
 * R112 round C — the beat's `layout` stops being a label and starts moving
 * the camera.
 *
 * Round B planned a layout per beat and then used it for one thing: where the
 * graphic sits (`StoryboardBridge.LAYOUT_POSITION`). That is real but partial,
 * and the doc said so. The reference edits change SCALE constantly — the
 * speaker is wide when they are setting something up and tight when they land
 * it — and a storyboard that never touches the camera cannot sound like that
 * however good its cards are.
 *
 * This closes `punch`, and only `punch`, on purpose:
 *
 *   punch   a push-in on the speaker for the length of the beat, then back.
 *           Built from `keyframes.scale` on the base video clip — the SAME
 *           mechanism `rhythm_zoom` uses (agent/rhythmShots.js), already
 *           identical in preview and export, so this needs no render code.
 *   split   would have to cut the base clip into before/during/after pieces
 *           and crop the middle one (`applyLayout` does exactly that for a
 *           b-roll overlay). That is clip surgery inside a loop that is
 *           already placing a dozen graphics, and getting it wrong damages
 *           the user's footage rather than just looking bad. Not done, and
 *           not pretended.
 *   broll   needs cutaway footage that does not exist. REMOVED from the
 *           planner's vocabulary rather than left as a layout that silently
 *           means nothing.
 *
 * TWO REFUSALS, both deliberate:
 *
 * 1. **A clip that already has scale keyframes is left alone.** `rhythm_zoom`
 *    writes exactly this field, and a storyboard that overwrote it would
 *    silently delete a zoom rhythm the user asked for twenty minutes ago.
 *    Merging the two is a real feature; quietly clobbering is a bug.
 * 2. **A punch that cannot complete is not started.** Below `MIN_PUNCH_S`
 *    there is no room to move in, hold and come back, and a push-in that
 *    snaps back immediately reads as a glitch.
 *
 * Pure: no store, no DOM.
 */

/** How far in a punch goes. Small on purpose: this runs several times a minute. */
export const PUNCH_SCALE = 1.1;
/** Seconds to move in, and to come back out. */
export const PUNCH_IN_S = 0.42;
export const PUNCH_OUT_S = 0.5;
/** A beat shorter than this has no room for a push-in that completes. */
export const MIN_PUNCH_S = 1.2;
/** Two punches closer than this on the same clip read as a wobble, not a move. */
export const MIN_PUNCH_GAP_S = 1.5;

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const round = (v, p = 3) => Math.round(num(v, 0) * 10 ** p) / 10 ** p;

/** The clip under `t`, or null. Timeline time. */
export function clipAt(clips, t) {
    for (const c of Array.isArray(clips) ? clips : []) {
        const start = num(c?.start, 0);
        const end = start + num(c?.duration, 0);
        if (t >= start - 1e-6 && t < end) return c;
    }
    return null;
}

/**
 * Timeline time → this clip's own local time, which is what a keyframe's
 * `time` field means. Speed matters: a clip at 2x reaches its own 4s mark
 * after 2s of timeline.
 */
export function localTime(clip, t) {
    const start = num(clip?.start, 0);
    return round(Math.max(0, t - start));
}

/**
 * The scale keyframes for one clip from the punches that fall inside it.
 *
 * Each punch is four keyframes — out, in, hold, out — and the series always
 * starts and ends at 1, so a clip is never left zoomed in after its last
 * punch. Consecutive punches share the baseline between them rather than
 * each writing their own, which is why this takes the whole list at once
 * instead of being called per beat.
 *
 * @param {object} clip
 * @param {Array<{start:number,end:number,id?:string}>} punches timeline time
 * @returns {{ keyframes:Array<{time:number,value:number,easing:string}>,
 *             used:string[], refused:Array<{beatId:string, reason:string}> }}
 */
export function punchKeyframesFor(clip, punches, opts = {}) {
    const scale = num(opts.scale, PUNCH_SCALE);
    const inDur = num(opts.inDur, PUNCH_IN_S);
    const outDur = num(opts.outDur, PUNCH_OUT_S);
    const minLen = num(opts.minLen, MIN_PUNCH_S);
    const minGap = num(opts.minGap, MIN_PUNCH_GAP_S);

    const clipStart = num(clip?.start, 0);
    const clipEnd = clipStart + num(clip?.duration, 0);
    const kfs = [];
    const used = [];
    // Each refusal names ITS OWN reason. Reporting every miss as "too close
    // to the one before" would be this module lying about its own decisions,
    // which is precisely what a reasoning string is for.
    const refused = [];
    let lastEnd = -Infinity;

    for (const p of [...(punches || [])].sort((a, b) => num(a.start, 0) - num(b.start, 0))) {
        const start = num(p.start, NaN);
        const end = num(p.end, NaN);
        if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
        // Entirely inside this clip: a punch that straddles a cut would move
        // the camera on one side of it only.
        const label = p.id || `${start}`;
        if (start < clipStart || end > clipEnd) {
            refused.push({ beatId: label, reason: 'it would cross a cut' });
            continue;
        }
        if (end - start < minLen) {
            refused.push({ beatId: label, reason: 'too short to push in and come back' });
            continue;
        }
        if (start - lastEnd < minGap) {
            refused.push({ beatId: label, reason: 'too close to the push-in before it' });
            continue;
        }

        const a = localTime(clip, start);
        const b = localTime(clip, end);
        const inAt = round(Math.min(b - 0.1, a + inDur));
        const outAt = round(Math.min(num(clip?.duration, b), b + outDur));
        if (!(inAt > a) || !(outAt > b)) {
            refused.push({ beatId: label, reason: 'no room left in the clip to come back out' });
            continue;
        }

        if (kfs.length === 0 || kfs[kfs.length - 1].time < a) {
            kfs.push({ time: a, value: 1, easing: 'linear' });
        }
        kfs.push({ time: inAt, value: round(scale, 4), easing: 'easeOutCubic' });
        kfs.push({ time: round(b), value: round(scale, 4), easing: 'linear' });
        kfs.push({ time: outAt, value: 1, easing: 'easeOutCubic' });
        used.push(label);
        lastEnd = end;
    }

    return { keyframes: kfs, used, refused };
}

/**
 * The whole framing plan: which base clips get which keyframes, and which
 * beats were refused and why.
 *
 * @param {Array} beats     from planStoryboard
 * @param {Array} videoClips base video clips, each with `_trackId`
 * @param {object} [opts]
 * @returns {{ work:Array<{trackId:string, clipId:string, keyframes:Array}>,
 *             applied:number, refused:Array<{beatId:string, reason:string}> }}
 */
export function framingPlan(beats, videoClips, opts = {}) {
    const clips = Array.isArray(videoClips) ? videoClips : [];
    const refused = [];
    const punchesByClip = new Map();

    for (const beat of Array.isArray(beats) ? beats : []) {
        if (beat?.layout !== 'punch') continue;
        const start = num(beat.start, NaN);
        const end = num(beat.end, NaN);
        if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

        const clip = clipAt(clips, start);
        if (!clip) { refused.push({ beatId: beat.id, reason: 'no video clip under this beat' }); continue; }
        if (Array.isArray(clip.keyframes?.scale) && clip.keyframes.scale.length > 0) {
            // rhythm_zoom owns this field. Taking it over would delete a zoom
            // rhythm the user already asked for, without saying so.
            refused.push({ beatId: beat.id, reason: 'this clip already has its own zoom rhythm' });
            continue;
        }
        const key = `${clip._trackId || ''}::${clip.id}`;
        if (!punchesByClip.has(key)) punchesByClip.set(key, { clip, punches: [] });
        punchesByClip.get(key).punches.push({ start, end, id: beat.id });
    }

    const work = [];
    let applied = 0;
    for (const { clip, punches } of punchesByClip.values()) {
        const r = punchKeyframesFor(clip, punches, opts);
        refused.push(...r.refused);
        if (r.keyframes.length === 0) continue;
        work.push({ trackId: clip._trackId || null, clipId: clip.id, keyframes: r.keyframes });
        applied += r.used.length;
    }

    return { work, applied, refused };
}

export default {
    PUNCH_SCALE, PUNCH_IN_S, PUNCH_OUT_S, MIN_PUNCH_S, MIN_PUNCH_GAP_S,
    clipAt, localTime, punchKeyframesFor, framingPlan,
};
