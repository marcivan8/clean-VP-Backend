/**
 * client/src/motion/ObjectLayers.js
 *
 * R67 — Object Intelligence Integration. Pure module, like every other file
 * in this directory: given a SAM2-derived `bboxTrack` (see
 * jobs/objectSegmentationProcessor.js — `[{t, cx, cy, w, h}]`, ALL fractions
 * of the SOURCE asset frame, `t` in source-asset seconds) these functions
 * compute crop/segment descriptors. They never touch the store, the DOM, or
 * ffmpeg — that is `useTimelineStore.js` (`separateSpeaker`) and
 * `jobs/exportProcessor.js`'s job.
 *
 * ─── WHY THIS BUYS THREE OF THE FOUR FEATURES FOR FREE ─────────────────────
 * "Zoom speaker", "animate speaker" and "track speaker" are camera-framing
 * operations, and this codebase already has a complete, tested,
 * preview+export framing pipeline for exactly that: `clip.virtualCam =
 * {cropX, cropY, cropW, cropH}` (see CLAUDE.md R14/R16/R18 — VideoPlayer.jsx
 * reads it for the WebGL UV crop, jobs/exportProcessor.js reads it for the
 * FFmpeg `crop` filter, the Revideo/Lambda scene reads it too). SAM2 gives
 * per-frame masks; this file turns those masks into `virtualCam`-shaped crop
 * descriptors so those three examples need ZERO new render code in either
 * preview or export — the exact win CameraMotionCompiler.js took for
 * camera-push/pull/zoom presets, applied one level up.
 *
 * "Blur background" is NOT a framing operation — it needs real per-pixel
 * alpha compositing, which this codebase has never had (see ADR-001's
 * audit). That one genuinely is new render work; it is wired separately in
 * `ObjectLayerOverlay.jsx` (preview) and `exportProcessor.js`'s
 * `buildBackgroundBlurFilter` (export), not here.
 *
 * ─── THE MODEL ──────────────────────────────────────────────────────────
 * `deriveSpeakerCrop` — ONE static crop for a whole clip (median-centered,
 * padded bounding box). Use for "zoom speaker" / "animate speaker", where a
 * single well-chosen framing is what's wanted, not continuous tracking.
 *
 * `deriveTrackingSegments` — splits a clip into re-centering pieces wherever
 * the subject's bbox center drifts past `threshold`, each with its own
 * static crop. This is "track speaker" — the SAME piece-splitting shape
 * `virtual_multicam` already uses for per-turn angle changes (see
 * MediaExecutionEngine.js's `virtual_multicam` case: `pieceCursor` laid out
 * inside the clip's own span), applied to subject motion instead of speaker
 * turns. A continuously-ANIMATED crop (x/y keyframed every frame) was
 * explicitly ruled out by R64 for camera-whip/shake for the same reason it's
 * ruled out here: teaching zoompan's x=/y= pan window a per-frame expression
 * is materially higher risk than reusing the existing static-crop-per-piece
 * path, and re-centering every `threshold` of drift already reads as
 * "tracking" without it.
 */

export const LAYER_TARGETS = { SPEAKER: 'speaker', BACKGROUND: 'background' };

const DEFAULT_PADDING = 0.35;     // extra room around the subject, as a fraction of its own size
const MIN_CROP_SIZE = 0.15;       // never crop tighter than this (avoids a degenerate 1px crop on a bad mask)
const DEFAULT_HEADROOM = 0.08;    // bias crop center slightly above the subject's own center, like anchorCam()

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function median(values) {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function percentile(values, p) {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = clamp(Math.round(p * (sorted.length - 1)), 0, sorted.length - 1);
    return sorted[idx];
}

function samplesInRange(bboxTrack, sourceStart, duration) {
    if (!Array.isArray(bboxTrack) || bboxTrack.length === 0) return [];
    const end = sourceStart + (Number.isFinite(duration) ? duration : Infinity);
    return bboxTrack.filter(s => s && s.t >= sourceStart && s.t <= end);
}

/**
 * Build one `virtualCam`-shaped static crop window from a set of bbox
 * samples. Uses the MEDIAN center (robust to a couple of bad frames) and the
 * 90th-percentile size (covers the subject at its largest without letting a
 * single outlier frame blow the crop out to nearly full-frame).
 */
function cropFromSamples(samples, { padding = DEFAULT_PADDING, headroom = DEFAULT_HEADROOM } = {}) {
    if (samples.length === 0) return null;

    const cx = median(samples.map(s => s.cx));
    const cy = median(samples.map(s => s.cy));
    const w = percentile(samples.map(s => s.w), 0.9);
    const h = percentile(samples.map(s => s.h), 0.9);
    if (cx == null || cy == null || w == null || h == null) return null;

    const cropW = clamp(w * (1 + padding), MIN_CROP_SIZE, 1);
    const cropH = clamp(h * (1 + padding), MIN_CROP_SIZE, 1);

    // Bias the crop center slightly above the subject's own center (headroom),
    // same idea as routes/interviewRoutes.js's anchorCam() for face framing.
    const biasedCy = cy - headroom * cropH;

    const cropX = clamp(cx - cropW / 2, 0, 1 - cropW);
    const cropY = clamp(biasedCy - cropH / 2, 0, 1 - cropH);

    return { cropX, cropY, cropW, cropH };
}

/**
 * ONE static crop for the whole clip's SAM2-tracked duration. Returns null
 * when there are no bbox samples covering the clip's source range (e.g. the
 * clip was trimmed to a range the mask never covers).
 *
 * @param {Array<{t:number,cx:number,cy:number,w:number,h:number}>} bboxTrack
 * @param {{sourceStart?:number, duration?:number, padding?:number}} opts
 *   sourceStart/duration are in the SOURCE ASSET's own timeline (seconds) —
 *   the same space bboxTrack's `t` values are in, NOT the clip's position on
 *   the edit timeline. Callers pass the clip's trim-in/trim-out here.
 * @returns {{cropX:number,cropY:number,cropW:number,cropH:number}|null}
 */
export function deriveSpeakerCrop(bboxTrack, { sourceStart = 0, duration = Infinity, padding = DEFAULT_PADDING } = {}) {
    const samples = samplesInRange(bboxTrack, sourceStart, duration);
    return cropFromSamples(samples, { padding });
}

/**
 * Split a clip's SAM2-tracked duration into re-centering segments. Each
 * segment covers a contiguous run of bbox samples whose center stays within
 * `threshold` of the segment's own crop center; a sample that drifts past
 * `threshold` starts a new segment. Segments shorter than
 * `minSegmentDuration` are merged into the previous one (mirrors
 * `virtual_multicam`'s handling of very short diarization turns — a crop
 * that changes every 0.2s reads as jittery, not "tracking").
 *
 * @returns {Array<{start:number, end:number, crop:{cropX,cropY,cropW,cropH}}>}
 *   start/end are in SOURCE-ASSET seconds (same space as bboxTrack), ordered,
 *   contiguous, covering [sourceStart, sourceStart+duration]. Empty array
 *   when there are no usable samples.
 */
export function deriveTrackingSegments(bboxTrack, {
    sourceStart = 0,
    duration = Infinity,
    threshold = 0.12,
    minSegmentDuration = 0.5,
    padding = DEFAULT_PADDING,
} = {}) {
    const samples = samplesInRange(bboxTrack, sourceStart, duration).sort((a, b) => a.t - b.t);
    if (samples.length === 0) return [];

    const rawSegments = [];
    let current = [samples[0]];

    for (let i = 1; i < samples.length; i++) {
        const sample = samples[i];
        const anchor = current[0];
        const drift = Math.hypot(sample.cx - anchor.cx, sample.cy - anchor.cy);
        if (drift > threshold) {
            rawSegments.push(current);
            current = [sample];
        } else {
            current.push(sample);
        }
    }
    rawSegments.push(current);

    // Merge segments shorter than minSegmentDuration into their predecessor
    // (or successor, if it's the very first segment) so tracking doesn't
    // flicker on a couple of noisy frames.
    const merged = [];
    for (const seg of rawSegments) {
        const segStart = seg[0].t;
        const segEnd = seg[seg.length - 1].t;
        if (merged.length > 0 && (segEnd - segStart) < minSegmentDuration) {
            merged[merged.length - 1] = merged[merged.length - 1].concat(seg);
        } else {
            merged.push(seg);
        }
    }
    // A too-short FIRST segment has no predecessor to merge into — fold it
    // forward into the next one instead, rather than leaving a sub-threshold
    // segment at the very start of the clip.
    if (merged.length > 1 && (merged[0][merged[0].length - 1].t - merged[0][0].t) < minSegmentDuration) {
        merged[1] = merged[0].concat(merged[1]);
        merged.shift();
    }

    const clipEnd = sourceStart + (Number.isFinite(duration) ? duration : samples[samples.length - 1].t - sourceStart);
    return merged
        .map((seg, i) => {
            const crop = cropFromSamples(seg, { padding });
            if (!crop) return null;
            const start = i === 0 ? sourceStart : seg[0].t;
            const end = i === merged.length - 1 ? clipEnd : merged[i + 1][0].t;
            return { start, end, crop };
        })
        .filter(Boolean);
}

export default { LAYER_TARGETS, deriveSpeakerCrop, deriveTrackingSegments };
