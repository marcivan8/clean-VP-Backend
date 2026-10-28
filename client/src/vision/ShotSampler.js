/**
 * client/src/vision/ShotSampler.js
 *
 * R112 — where the picture CHANGES, so the storyboard can cut with the
 * footage instead of across it.
 *
 * `FootageAnalyzer` reads ONE frame of a clip (palette, subject box). That is
 * enough to pick a colour and avoid a face, and it is all the engine has ever
 * known about the footage. It cannot answer the question a storyboard asks
 * constantly: is this still the same shot? A card dropped two frames after a
 * cut reads as a mistake; the same card half a second earlier reads as design.
 *
 * The method is deliberately the cheap one: sample N frames at 24x14, compare
 * consecutive frames by colour histogram, and call a boundary where the
 * distance spikes against the clip's OWN typical distance rather than a fixed
 * threshold. A talking head on a locked-off camera has a tiny baseline and a
 * real cut towers over it; a handheld vlog has a noisy baseline and the same
 * fixed threshold would report a cut every second. Adaptive is the only
 * version of this that works on both, and both are what VIBED's users shoot.
 *
 * Accuracy honestly stated: this finds HARD cuts. A dissolve spreads its
 * difference over many frames and will usually be missed, and a whip pan can
 * read as a cut. Boundaries are a HINT the storyboard snaps to when one is
 * near — never a requirement — so a miss costs alignment, not correctness.
 *
 * Split the same way FootageAnalyzer is: `histogram` and `boundariesFrom` are
 * pure and tested with synthetic pixels; `sampleShots` needs a browser and is
 * not.
 */

/** Analysis frame size. Small on purpose: this measures change, not detail. */
export const SAMPLE_SIZE = Object.freeze({ w: 24, h: 14 });
/** Bins per channel. 4^3 = 64 buckets — coarse enough to ignore grain. */
const BINS = 4;
/** Frames per second of video sampled. More is slower, not more accurate. */
export const SAMPLE_FPS = 2;
/** Never decode more than this many frames, whatever the duration. */
export const MAX_SAMPLES = 180;
/**
 * A distance this many times the clip's median counts as a cut. Tuned to be
 * deliberately conservative: a missed boundary costs a graphic its snap, a
 * false one would cut a sentence in half.
 */
export const CUT_RATIO = 3.2;
/** Below this absolute distance nothing is a cut, however quiet the clip. */
export const CUT_FLOOR = 0.12;
/**
 * And above this, everything is — however busy the clip.
 *
 * The adaptive bar defeats itself on footage where almost every sample
 * differs (a slideshow, a rapid montage, a clip sampled so sparsely that
 * consecutive samples are unrelated): the median rises with the content, the
 * bar rises with the median, and a run of genuine cuts reports none at all.
 * Two frames sharing less than half their colour are not one shot under any
 * camera, so this is the ceiling the ratio cannot climb past.
 */
export const CUT_CEILING = 0.55;
/** Two boundaries closer than this are one cut seen twice. */
export const MIN_SHOT_S = 0.6;

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const round = (v, p = 3) => Math.round(num(v, 0) * 10 ** p) / 10 ** p;

/**
 * A normalised 64-bucket colour histogram of an RGBA buffer.
 * @param {Uint8ClampedArray|number[]} rgba
 * @returns {number[]} length BINS^3, summing to 1 (or all zeros for no pixels)
 */
export function histogram(rgba) {
    const bins = new Array(BINS * BINS * BINS).fill(0);
    const data = rgba || [];
    let n = 0;
    for (let i = 0; i + 3 < data.length; i += 4) {
        const r = (data[i] / 256 * BINS) | 0;
        const g = (data[i + 1] / 256 * BINS) | 0;
        const b = (data[i + 2] / 256 * BINS) | 0;
        bins[(r * BINS + g) * BINS + b] += 1;
        n += 1;
    }
    if (n === 0) return bins;
    for (let i = 0; i < bins.length; i++) bins[i] /= n;
    return bins;
}

/** Total-variation distance between two histograms: 0 identical, 1 disjoint. */
export function histogramDistance(a, b) {
    const x = a || [];
    const y = b || [];
    const len = Math.max(x.length, y.length);
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Math.abs((x[i] || 0) - (y[i] || 0));
    return round(sum / 2);
}

/** The median of a numeric list; 0 for an empty one. */
function median(values) {
    const v = [...values].filter(Number.isFinite).sort((p, q) => p - q);
    if (v.length === 0) return 0;
    const mid = v.length >> 1;
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * Shot boundaries from a series of sampled frames.
 *
 * @param {Array<{t:number, hist:number[]}>} samples in time order
 * @param {{ ratio?:number, floor?:number, minShot?:number }} [opts]
 * @returns {{ cuts:number[], distances:Array<{t:number,d:number}>, baseline:number }}
 */
export function boundariesFrom(samples, opts = {}) {
    const list = (Array.isArray(samples) ? samples : [])
        .filter(s => Number.isFinite(num(s?.t, NaN)))
        .sort((a, b) => a.t - b.t);
    const ratio = num(opts.ratio, CUT_RATIO);
    const floor = num(opts.floor, CUT_FLOOR);
    const ceiling = num(opts.ceiling, CUT_CEILING);
    const minShot = num(opts.minShot, MIN_SHOT_S);

    const distances = [];
    for (let i = 1; i < list.length; i++) {
        distances.push({ t: round(list[i].t), d: histogramDistance(list[i - 1].hist, list[i].hist) });
    }
    // The clip's own typical frame-to-frame change. A locked-off interview
    // sits near 0; a handheld vlog sits well above it, and both get the same
    // treatment because the bar is relative to this.
    const baseline = round(median(distances.map(x => x.d)));
    const bar = Math.min(ceiling, Math.max(floor, baseline * ratio));

    const cuts = [];
    for (const x of distances) {
        if (x.d < bar) continue;
        if (cuts.length && x.t - cuts[cuts.length - 1] < minShot) continue;
        cuts.push(x.t);
    }
    return { cuts, distances, baseline };
}

/**
 * Cut points turned into spans covering [0, duration).
 * @returns {Array<{start:number,end:number,index:number}>}
 */
export function shotsFromCuts(cuts, duration) {
    const total = num(duration, 0);
    if (!(total > 0)) return [];
    const points = [0, ...(cuts || []).map(c => num(c, 0)).filter(c => c > 0 && c < total), total]
        .sort((a, b) => a - b);
    const shots = [];
    for (let i = 0; i < points.length - 1; i++) {
        if (points[i + 1] - points[i] <= 0) continue;
        shots.push({ start: round(points[i]), end: round(points[i + 1]), index: shots.length });
    }
    return shots;
}

/** The boundary nearest `t`, or null when none is within `window` seconds. */
export function nearestBoundary(cuts, t, window = 0.5) {
    let best = null;
    for (const c of cuts || []) {
        const d = Math.abs(num(c, 0) - num(t, 0));
        if (d <= window && (best === null || d < best.d)) best = { t: round(num(c, 0)), d: round(d) };
    }
    return best ? best.t : null;
}

// ─── The browser half (not unit-tested: there is no video element in Node) ───

function loadVideoFrame(sourceUrl) {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.muted = true;
        video.preload = 'auto';
        const fail = (e) => reject(new Error(e?.message || 'could not load the video'));
        video.addEventListener('loadeddata', () => resolve(video), { once: true });
        video.addEventListener('error', fail, { once: true });
        video.src = sourceUrl;
        video.load();
    });
}

function seekVideo(video, t) {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, 1800);
        const ok = () => { clearTimeout(timer); video.removeEventListener('seeked', ok); resolve(); };
        video.addEventListener('seeked', ok);
        video.currentTime = t;
    });
}

/**
 * Sample a clip and report its shot boundaries.
 *
 * Resolves to `null` rather than throwing on any failure — a browser that
 * blocks the decode, a source that is not playable yet — because every caller
 * must work without this. A storyboard with no boundaries places its beats on
 * the speech alone, which is exactly what it did before this module existed.
 *
 * @param {{sourceUrl:string, duration?:number, fps?:number, max?:number, signal?:AbortSignal}} opts
 * @returns {Promise<{cuts:number[], shots:Array, baseline:number, sampled:number}|null>}
 */
export async function sampleShots({ sourceUrl, duration, fps = SAMPLE_FPS, max = MAX_SAMPLES, signal } = {}) {
    if (!sourceUrl) return null;
    if (typeof document === 'undefined') return null;
    let video;
    try {
        video = await loadVideoFrame(sourceUrl);
        const total = num(duration, 0) > 0 ? num(duration, 0)
            : (Number.isFinite(video.duration) ? video.duration : 0);
        if (!(total > 0)) return null;

        const step = Math.max(1 / Math.max(0.1, fps), total / Math.max(1, max));
        const canvas = document.createElement('canvas');
        canvas.width = SAMPLE_SIZE.w;
        canvas.height = SAMPLE_SIZE.h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        const samples = [];
        for (let t = 0; t < total && samples.length < max; t += step) {
            if (signal?.aborted) break;
            await seekVideo(video, Math.min(t, Math.max(0, total - 0.05)));
            ctx.drawImage(video, 0, 0, SAMPLE_SIZE.w, SAMPLE_SIZE.h);
            const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE.w, SAMPLE_SIZE.h);
            samples.push({ t: round(t), hist: histogram(data) });
        }
        if (samples.length < 2) return null;

        const { cuts, baseline } = boundariesFrom(samples);
        return { cuts, shots: shotsFromCuts(cuts, total), baseline, sampled: samples.length };
    } catch (err) {
        console.warn('[ShotSampler] could not read the footage, the storyboard will use speech alone:', err.message);
        return null;
    } finally {
        if (video) { video.removeAttribute('src'); video.load(); }
    }
}

export default {
    SAMPLE_SIZE, SAMPLE_FPS, MAX_SAMPLES, CUT_RATIO, CUT_FLOOR, CUT_CEILING, MIN_SHOT_S,
    histogram, histogramDistance, boundariesFrom, shotsFromCuts, nearestBoundary, sampleShots,
};
