/**
 * client/src/vision/FootageAnalyzer.js
 *
 * R101 PHASE 2 & 3 — "adapt to footage": read two things off a single
 * sampled frame of the clip the graphics will sit on, instead of guessing
 * from a fixed table or ignoring the footage altogether.
 *
 *   - PALETTE (Phase 2): the footage's own dominant, saturated hue becomes
 *     the sequence's accent colour, and the frame's overall brightness picks
 *     readable text/sub colours — sourced from the actual pixels of the shot,
 *     never a saved brand kit.
 *   - SUBJECT (Phase 3): a general object/person box, found with coco-ssd (a
 *     lightweight, already-installed detector — see package.json — loaded
 *     from a CDN on first use, the same loading pattern MatteBaker.js uses
 *     for its MediaPipe segmenter). This is what lets `placementAvoiding`
 *     keep a graphic off an actual product or face even when nothing has
 *     been through the heavier MatteBaker person-tracking pass.
 *
 * Both are read off ONE seeked frame — one video load, one seek — so asking
 * for "adapt to footage" costs a single quick decode, not two. Nothing here
 * uploads anything or writes an asset: this is an in-memory read of a single
 * frame, not the per-frame bake MatteBaker.js does for "remove background".
 *
 * Every public entry point resolves to `null` rather than throwing, so a
 * sequence still designs exactly as it did before Phase 2/3 existed — with
 * the tone's own static palette and a centred placement — if a browser
 * blocks the one-time download, the footage has no playable source yet, or
 * detection simply finds nothing worth avoiding.
 *
 * The two PURE, DOM-free pieces that actually decide the answer —
 * `paletteFromPixels` and `bestDetectionToSubject` — are split out and
 * exported on their own so they can be unit-tested directly with synthetic
 * pixel/detection data, the same split MatteBaker.js uses between its pure
 * `withMirrors` (tested) and its DOM-bound `bakeMatte` (not — there is no
 * video/canvas in the Node test harness).
 */

/** Analysis canvas sizes. Small and fast: this never needs to be sharp. */
const PALETTE_SIZE = { w: 48, h: 27 };
const DETECT_SIZE = { w: 320, h: 180 };

const TFJS_URL_MIRRORS = [
    'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js',
    'https://unpkg.com/@tensorflow/tfjs@4.22.0/dist/tf.min.js',
];
const COCO_SSD_URL_MIRRORS = [
    'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js',
    'https://unpkg.com/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js',
];

/** A detection below this confidence is noise, not a subject to avoid. */
const MIN_SCORE = 0.45;
/** Too small to matter for placement, or so large placementAvoiding's own "fills the frame" case already handles it. */
const MIN_AREA_FRACTION = 0.015;
const MAX_AREA_FRACTION = 0.97;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Try `attempt(url)` against each mirror in turn, returning the first
 * success. Same shape as MatteBaker.js's `withMirrors`, kept separate so the
 * error this throws names what actually failed to load here.
 * @param {string[]} urls
 * @param {(url:string)=>Promise<any>} attempt
 */
export async function tryMirrors(urls, attempt) {
    let lastErr = null;
    for (const url of urls) {
        try {
            // eslint-disable-next-line no-await-in-loop
            return await attempt(url);
        } catch (err) {
            lastErr = err;
        }
    }
    const tried = urls.length === 1 ? '1 source' : `${urls.length} sources`;
    throw new Error(`Reading the footage needs a one-time download that could not be reached (tried ${tried}).${lastErr?.message ? ` (${lastErr.message})` : ''}`);
}

// ─────────────────────────────────────────────────────────────────────────
// PURE: palette from pixels
// ─────────────────────────────────────────────────────────────────────────

function rgbToHsl(r, g, b) {
    const rN = r / 255, gN = g / 255, bN = b / 255;
    const max = Math.max(rN, gN, bN), min = Math.min(rN, gN, bN);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    switch (max) {
        case rN: h = ((gN - bN) / d + (gN < bN ? 6 : 0)); break;
        case gN: h = (bN - rN) / d + 2; break;
        default: h = (rN - gN) / d + 4;
    }
    return { h: h * 60, s, l };
}

function hslToHex(h, s, l) {
    const hue2rgb = (p, q, t) => {
        let tt = t;
        if (tt < 0) tt += 1;
        if (tt > 1) tt -= 1;
        if (tt < 1 / 6) return p + (q - p) * 6 * tt;
        if (tt < 1 / 2) return q;
        if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
        return p;
    };
    let r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        const hN = h / 360;
        r = hue2rgb(p, q, hN + 1 / 3);
        g = hue2rgb(p, q, hN);
        b = hue2rgb(p, q, hN - 1 / 3);
    }
    const toHex = (v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * The footage's own accent hue, plus legible text/sub colours for whatever
 * the frame's overall brightness turns out to be.
 *
 * @param {Uint8ClampedArray|number[]} rgba packed RGBA bytes (alpha ignored)
 * @param {number} width
 * @param {number} height
 * @returns {{accent:string, text:string, sub:string}|null} null when the
 *   frame has nothing saturated enough to call "the colour of this shot"
 *   (near-greyscale footage) — the caller keeps the tone's own palette.
 */
export function paletteFromPixels(rgba, width, height) {
    const pixelCount = Math.floor(rgba.length / 4);
    if (pixelCount === 0) return null;
    const HUE_BINS = 24;
    const binCount = new Array(HUE_BINS).fill(0);
    const binSat = new Array(HUE_BINS).fill(0);
    let lightnessSum = 0;

    for (let i = 0; i < pixelCount; i++) {
        const q = i * 4;
        const { h, s, l } = rgbToHsl(rgba[q], rgba[q + 1], rgba[q + 2]);
        lightnessSum += l;
        if (s < 0.15 || l < 0.08 || l > 0.92) continue;
        const bin = Math.min(HUE_BINS - 1, Math.floor(h / (360 / HUE_BINS)));
        binCount[bin] += 1;
        binSat[bin] += s;
    }

    const avgLightness = lightnessSum / pixelCount;
    const isDark = avgLightness < 0.5;
    const text = isDark ? '#ffffff' : '#101418';
    const sub = isDark ? '#E2E8F0' : '#3A4350';

    let bestBin = -1;
    let bestScore = 0;
    for (let b = 0; b < HUE_BINS; b++) {
        if (binCount[b] === 0) continue;
        const avgSat = binSat[b] / binCount[b];
        const score = binCount[b] * avgSat;
        if (score > bestScore) { bestScore = score; bestBin = b; }
    }
    if (bestBin < 0) return null;

    const hue = (bestBin + 0.5) * (360 / HUE_BINS);
    const avgSat = binSat[bestBin] / binCount[bestBin];
    const accent = hslToHex(hue, clamp(avgSat, 0.55, 0.85), 0.55);
    return { accent, text, sub };
}

// ─────────────────────────────────────────────────────────────────────────
// PURE: the one detection worth avoiding
// ─────────────────────────────────────────────────────────────────────────

/**
 * Pick the one coco-ssd detection worth keeping a graphic clear of: the
 * highest-confidence box inside a sane size range, as fractions of the
 * frame — the same shape SceneDirector.subjectFromClips already returns from
 * a MatteBaker bboxTrack sample, so placementAvoiding needs no changes to
 * accept either source.
 *
 * @param {Array<{bbox:[number,number,number,number], class?:string, score?:number}>} detections
 * @param {number} frameW
 * @param {number} frameH
 * @returns {{cx:number, cy:number, w:number, h:number, label:string, score:number}|null}
 */
export function bestDetectionToSubject(detections, frameW, frameH) {
    if (!Array.isArray(detections) || !(frameW > 0) || !(frameH > 0)) return null;
    const area = frameW * frameH;
    let best = null;
    for (const d of detections) {
        const box = d?.bbox;
        if (!Array.isArray(box) || box.length !== 4) continue;
        const [x, y, w, h] = box;
        const score = Number(d.score) || 0;
        if (score < MIN_SCORE) continue;
        const frac = (w * h) / area;
        if (!(frac >= MIN_AREA_FRACTION && frac <= MAX_AREA_FRACTION)) continue;
        if (!best || score > best.score) {
            best = {
                cx: (x + w / 2) / frameW,
                cy: (y + h / 2) / frameH,
                w: w / frameW,
                h: h / frameH,
                label: String(d.class || 'object'),
                score,
            };
        }
    }
    return best;
}

// ─────────────────────────────────────────────────────────────────────────
// IMPURE: load a frame, load the detector — browser-only, not unit tested
// (same split as MatteBaker.js's withMirrors vs. bakeMatte).
// ─────────────────────────────────────────────────────────────────────────

function loadVideoFrame(sourceUrl) {
    return new Promise((resolve, reject) => {
        const v = document.createElement('video');
        v.crossOrigin = 'anonymous';
        v.muted = true;
        v.playsInline = true;
        v.preload = 'auto';
        const done = () => { cleanup(); resolve(v); };
        const fail = () => { cleanup(); reject(new Error('The footage could not be loaded to read its colours or framing.')); };
        const cleanup = () => { v.removeEventListener('loadeddata', done); v.removeEventListener('error', fail); };
        v.addEventListener('loadeddata', done);
        v.addEventListener('error', fail);
        v.src = sourceUrl;
    });
}

function seekVideo(video, t) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { video.removeEventListener('seeked', ok); reject(new Error('Seeking the footage timed out.')); }, 6000);
        const ok = () => { clearTimeout(timer); video.removeEventListener('seeked', ok); resolve(); };
        video.addEventListener('seeked', ok);
        video.currentTime = t;
    });
}

function loadScript(url) {
    return new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = url;
        el.async = true;
        el.onload = () => resolve();
        el.onerror = () => reject(new Error(`could not load ${url}`));
        document.head.appendChild(el);
    });
}

let detectorPromise = null;
/** The coco-ssd model, loaded once. Lightest backbone: this only needs to find "something is here", not classify it precisely. */
function loadDetector() {
    if (!detectorPromise) {
        detectorPromise = (async () => {
            if (!window.tf) await tryMirrors(TFJS_URL_MIRRORS, loadScript);
            if (!window.cocoSsd) await tryMirrors(COCO_SSD_URL_MIRRORS, loadScript);
            return window.cocoSsd.load({ base: 'lite_mobilenet_v2' });
        })();
    }
    return detectorPromise.catch((err) => { detectorPromise = null; throw err; });
}

/**
 * Sample one frame of the clip's source and read its palette and, unless
 * told not to bother, its subject.
 *
 * @param {object} opts
 * @param {string} opts.sourceUrl playable URL of the clip's source
 * @param {number} [opts.atSeconds] where in the source to sample (default: 25% in)
 * @param {boolean} [opts.detectSubject] run the object detector too (default true) —
 *   pass false when a MatteBaker bboxTrack subject already exists for this clip.
 * @returns {Promise<{palette:{accent,text,sub}|null, subject:object|null}|null>}
 */
export async function analyzeFootageFrame({ sourceUrl, atSeconds, detectSubject = true } = {}) {
    if (!sourceUrl) return null;
    if (typeof document === 'undefined') return null; // not a browser
    let video;
    try {
        video = await loadVideoFrame(sourceUrl);
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        const t = Number.isFinite(Number(atSeconds)) ? clamp(Number(atSeconds), 0, Math.max(0, duration - 0.05)) : duration * 0.25;
        await seekVideo(video, t);

        const vw = video.videoWidth || 1280;
        const vh = video.videoHeight || 720;

        const paletteCanvas = document.createElement('canvas');
        paletteCanvas.width = PALETTE_SIZE.w;
        paletteCanvas.height = PALETTE_SIZE.h;
        const pCtx = paletteCanvas.getContext('2d', { willReadFrequently: true });
        pCtx.drawImage(video, 0, 0, PALETTE_SIZE.w, PALETTE_SIZE.h);
        const { data } = pCtx.getImageData(0, 0, PALETTE_SIZE.w, PALETTE_SIZE.h);
        const palette = paletteFromPixels(data, PALETTE_SIZE.w, PALETTE_SIZE.h);

        let subject = null;
        if (detectSubject) {
            try {
                const detectCanvas = document.createElement('canvas');
                detectCanvas.width = DETECT_SIZE.w;
                detectCanvas.height = DETECT_SIZE.h;
                detectCanvas.getContext('2d').drawImage(video, 0, 0, DETECT_SIZE.w, DETECT_SIZE.h);
                const model = await loadDetector();
                const detections = await model.detect(detectCanvas);
                subject = bestDetectionToSubject(detections, DETECT_SIZE.w, DETECT_SIZE.h);
            } catch (err) {
                console.warn('[FootageAnalyzer] object detection unavailable, placement stays centred:', err.message);
            }
        }

        return { palette, subject };
    } catch (err) {
        console.warn('[FootageAnalyzer] could not read the footage, using defaults:', err.message);
        return null;
    } finally {
        if (video) { video.removeAttribute('src'); video.load(); }
    }
}

export default { tryMirrors, paletteFromPixels, bestDetectionToSubject, analyzeFootageFrame };
