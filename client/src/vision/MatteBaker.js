/**
 * client/src/vision/MatteBaker.js
 *
 * R92: free background removal, computed in the browser.
 *
 * Replaces the paid SAM2-on-Replicate path for "remove / blur / replace the
 * background". A free, on-device person segmentation model (MediaPipe
 * selfie multiclass, Apache-2.0, loaded from a CDN on first use) runs over the
 * clip's source range frame by frame. The result is:
 *   - a soft grayscale mask (white = person), temporally smoothed so edges
 *     do not flicker, uploaded once and stored as a small mp4, which the
 *     preview and the export both read;
 *   - a per-frame person bounding box (bboxTrack), so "zoom to speaker" and
 *     "track speaker" work from the same pass.
 *
 * Browser only (video element, canvas, CompressionStream). Nothing here runs
 * on the server.
 */

import { authFetch } from '../utils/authFetch.js';

const TASKS_VERSION = '0.10.14';
const TASKS_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/vision_bundle.mjs`;
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`;
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';

/** Mask width in px; height follows the source aspect (rounded to even). */
const MASK_WIDTH = 320;
/** Temporal smoothing: weight of the previous frame (reduces edge flicker). */
const SMOOTHING = 0.35;
/** Above this many seconds, sample fewer frames per second. */
const LONG_CLIP_S = 120;
const MAX_SECONDS = 15 * 60;

let segmenterPromise = null;

async function loadSegmenter() {
    if (segmenterPromise) return segmenterPromise;
    segmenterPromise = (async () => {
        const vision = await import(/* @vite-ignore */ TASKS_URL);
        const fileset = await vision.FilesetResolver.forVisionTasks(WASM_URL);
        const make = delegate => vision.ImageSegmenter.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: MODEL_URL, delegate },
            runningMode: 'VIDEO',
            outputCategoryMask: false,
            outputConfidenceMasks: true,
        });
        try { return await make('GPU'); }
        catch (gpuErr) {
            console.warn('[MatteBaker] GPU delegate unavailable, using CPU:', gpuErr.message);
            return make('CPU');
        }
    })();
    try { return await segmenterPromise; }
    catch (err) { segmenterPromise = null; throw err; }
}

function loadVideo(url) {
    return new Promise((resolve, reject) => {
        const v = document.createElement('video');
        v.crossOrigin = 'anonymous';
        v.muted = true;
        v.playsInline = true;
        v.preload = 'auto';
        const done = () => { cleanup(); resolve(v); };
        const fail = () => { cleanup(); reject(new Error('The video could not be loaded for background removal.')); };
        const cleanup = () => { v.removeEventListener('loadeddata', done); v.removeEventListener('error', fail); };
        v.addEventListener('loadeddata', done);
        v.addEventListener('error', fail);
        v.src = url;
    });
}

function seek(video, t) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { video.removeEventListener('seeked', ok); reject(new Error('Seeking the video timed out.')); }, 8000);
        const ok = () => { clearTimeout(timer); video.removeEventListener('seeked', ok); resolve(); };
        video.addEventListener('seeked', ok);
        video.currentTime = t;
    });
}

async function gzip(parts) {
    const stream = new Blob(parts).stream().pipeThrough(new CompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
}

/**
 * Bake a mask for one clip.
 *
 * @param {object} opts
 * @param {string} opts.sourceUrl   playable URL of the clip's source
 * @param {number} opts.sourceStart source seconds where the clip starts (clip.offset)
 * @param {number} opts.sourceDuration source seconds the clip uses (duration × speed)
 * @param {(p:number)=>void} [opts.onProgress] 0..1
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{maskAssetPath, maskAssetUrl, sourceStart, sourceDuration, fps, bboxTrack, sourceWidth, sourceHeight}>}
 */
export async function bakeMatte({ sourceUrl, sourceStart = 0, sourceDuration, onProgress, signal } = {}) {
    if (!sourceUrl) throw new Error('This clip has no playable source to analyse.');
    if (typeof CompressionStream === 'undefined') throw new Error('This browser cannot compress the mask. Use a recent Chrome, Edge, Firefox or Safari.');

    const segmenter = await loadSegmenter();
    const video = await loadVideo(sourceUrl);
    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    const start = Math.max(0, Number(sourceStart) || 0);
    const total = Number.isFinite(video.duration) ? video.duration : start + (Number(sourceDuration) || 0);
    const dur = Math.min(MAX_SECONDS, Math.max(0.1, Math.min(Number(sourceDuration) || total - start, total - start)));
    const fps = dur > LONG_CLIP_S ? 8 : 12;
    const frames = Math.max(1, Math.ceil(dur * fps));

    const W = MASK_WIDTH;
    const H = Math.max(16, Math.round((W * vh) / vw / 2) * 2);
    const out = new Uint8Array(W * H * frames);
    const prev = new Float32Array(W * H);

    const modelCanvas = document.createElement('canvas');
    const modelCtx = modelCanvas.getContext('2d', { willReadFrequently: true });
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = W; maskCanvas.height = H;
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
    maskCtx.imageSmoothingEnabled = true;

    const bboxTrack = [];
    let lastTs = -1;

    for (let i = 0; i < frames; i++) {
        if (signal?.aborted) throw new DOMException('Background removal was cancelled.', 'AbortError');
        const t = Math.min(start + i / fps, Math.max(start, total - 0.05));
        await seek(video, t);
        // Timestamps must strictly increase for the VIDEO running mode.
        const ts = Math.max(lastTs + 1, Math.round(t * 1000));
        lastTs = ts;
        const result = segmenter.segmentForVideo(video, ts);
        try {
            const masks = result?.confidenceMasks || [];
            const bg = masks[0];
            if (!bg) continue;
            const mw = bg.width, mh = bg.height;
            const conf = bg.getAsFloat32Array();
            if (modelCanvas.width !== mw || modelCanvas.height !== mh) { modelCanvas.width = mw; modelCanvas.height = mh; }
            const img = modelCtx.createImageData(mw, mh);
            for (let p = 0, q = 0; p < conf.length; p++, q += 4) {
                // Category 0 is background in the multiclass model: person = 1 - background.
                const v = Math.round((1 - conf[p]) * 255);
                img.data[q] = v; img.data[q + 1] = v; img.data[q + 2] = v; img.data[q + 3] = 255;
            }
            modelCtx.putImageData(img, 0, 0);
            maskCtx.drawImage(modelCanvas, 0, 0, W, H);
            const px = maskCtx.getImageData(0, 0, W, H).data;

            let minX = W, minY = H, maxX = -1, maxY = -1;
            const base = i * W * H;
            for (let p = 0, q = 0; p < W * H; p++, q += 4) {
                const cur = px[q];
                const v = i === 0 ? cur : cur * (1 - SMOOTHING) + prev[p] * SMOOTHING;
                prev[p] = v;
                out[base + p] = v;
                if (v > 127) {
                    const x = p % W, y = (p / W) | 0;
                    if (x < minX) minX = x; if (x > maxX) maxX = x;
                    if (y < minY) minY = y; if (y > maxY) maxY = y;
                }
            }
            if (maxX >= 0) {
                bboxTrack.push({
                    t: Math.round(t * 1000) / 1000,
                    cx: ((minX + maxX + 1) / 2) / W,
                    cy: ((minY + maxY + 1) / 2) / H,
                    w: (maxX - minX + 1) / W,
                    h: (maxY - minY + 1) / H,
                });
            }
        } finally {
            result?.close?.();
        }
        onProgress?.((i + 1) / frames * 0.9);
    }

    video.removeAttribute('src');
    video.load();

    const header = new TextEncoder().encode(JSON.stringify({ v: 1, width: W, height: H, fps, frames, sourceStart: start, sourceDuration: dur }));
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, header.length, true);
    const body = await gzip([len, header, out]);

    const res = await authFetch('/api/vision/matte', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body,
        signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'The background mask could not be saved.');
    onProgress?.(1);

    return {
        maskAssetPath: data.maskAssetPath,
        maskAssetUrl: data.maskAssetUrl,
        sourceStart: start,
        sourceDuration: dur,
        fps,
        bboxTrack,
        sourceWidth: vw,
        sourceHeight: vh,
    };
}

const urlCache = new Map();
/** A fresh playable link for a stored mask (signed links expire). Cached ~20 h. */
export async function freshMaskUrl(layerMask) {
    const p = layerMask?.maskAssetPath;
    if (!p) return layerMask?.maskAssetUrl || null;
    const hit = urlCache.get(p);
    if (hit && hit.until > Date.now()) return hit.url;
    try {
        const res = await authFetch(`/api/vision/matte-url?path=${encodeURIComponent(p)}`);
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.maskAssetUrl) {
            urlCache.set(p, { url: data.maskAssetUrl, until: Date.now() + 20 * 3600 * 1000 });
            return data.maskAssetUrl;
        }
    } catch (err) {
        console.warn('[MatteBaker] could not refresh the mask link:', err.message);
    }
    return layerMask?.maskAssetUrl || null;
}

export default { bakeMatte, freshMaskUrl };
