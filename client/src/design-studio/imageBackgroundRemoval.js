/**
 * client/src/design-studio/imageBackgroundRemoval.js
 *
 * Precision semantic background removal for design images and photos.
 *
 * Hybrid pipeline:
 * 1. On-device semantic person/subject segmentation using Google MediaPipe
 *    Selfie Multiclass (hair, face, skin, clothes, accessories).
 * 2. High-speed edge-connected contour flood-fill fallback for non-human objects
 *    or when ML vision bundle is unreachable.
 *
 * Runs 100% locally in browser memory with zero server latency.
 */

const TASKS_VERSION = '0.10.14';
const TASKS_URL_MIRRORS = [
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/vision_bundle.mjs`,
    `https://unpkg.com/@mediapipe/tasks-vision@${TASKS_VERSION}/vision_bundle.mjs`,
];
const WASM_URL_MIRRORS = [
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`,
    `https://unpkg.com/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`,
];
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';

let _imageSegmenterPromise = null;

/**
 * Initializes and caches the MediaPipe ImageSegmenter instance.
 */
async function getOrInitImageSegmenter() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return null;
    if (_imageSegmenterPromise) return _imageSegmenterPromise;

    _imageSegmenterPromise = (async () => {
        let vision = null;
        for (const url of TASKS_URL_MIRRORS) {
            try {
                vision = await import(/* @vite-ignore */ url);
                if (vision) break;
            } catch (_) {}
        }
        if (!vision) return null;

        let fileset = null;
        for (const url of WASM_URL_MIRRORS) {
            try {
                fileset = await vision.FilesetResolver.forVisionTasks(url);
                if (fileset) break;
            } catch (_) {}
        }
        if (!fileset) return null;

        const make = delegate => vision.ImageSegmenter.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: MODEL_URL, delegate },
            runningMode: 'IMAGE',
            outputCategoryMask: true,
            outputConfidenceMasks: false,
        });

        try {
            return await make('GPU');
        } catch (_) {
            try {
                return await make('CPU');
            } catch (_) {
                return null;
            }
        }
    })().catch(() => null);

    return _imageSegmenterPromise;
}

/**
 * Segments person/subject from an image using MediaPipe semantic segmentation.
 *
 * @param {HTMLImageElement} img
 * @returns {Promise<string|null>} Data URL or null if failed / non-human
 */
async function segmentWithMediaPipe(img) {
    try {
        const segmenter = await getOrInitImageSegmenter();
        if (!segmenter) return null;

        const result = segmenter.segment(img);
        if (!result || !result.categoryMask) return null;

        const maskData = result.categoryMask.getAsUint8Array();
        const maskW = result.categoryMask.width;
        const maskH = result.categoryMask.height;

        let personPixels = 0;
        for (let i = 0; i < maskData.length; i++) {
            if (maskData[i] > 0) personPixels++;
        }

        // If no significant person detected (< 0.8% of pixels), fall back to contour flood-fill
        if (personPixels < (maskW * maskH * 0.008)) {
            return null;
        }

        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = maskW;
        maskCanvas.height = maskH;
        const mCtx = maskCanvas.getContext('2d');
        if (!mCtx) return null;

        const maskImgData = mCtx.createImageData(maskW, maskH);
        const d = maskImgData.data;

        for (let i = 0; i < maskData.length; i++) {
            const isSubject = maskData[i] > 0;
            const pIdx = i * 4;
            d[pIdx] = 255;
            d[pIdx + 1] = 255;
            d[pIdx + 2] = 255;
            d[pIdx + 3] = isSubject ? 255 : 0;
        }
        mCtx.putImageData(maskImgData, 0, 0);

        // Render composite onto destination canvas with bilinear edge feathering
        const finalCanvas = document.createElement('canvas');
        const finalW = img.naturalWidth || img.width || 800;
        const finalH = img.naturalHeight || img.height || 600;
        finalCanvas.width = finalW;
        finalCanvas.height = finalH;
        const fCtx = finalCanvas.getContext('2d');
        if (!fCtx) return null;

        fCtx.drawImage(img, 0, 0, finalW, finalH);
        fCtx.globalCompositeOperation = 'destination-in';
        fCtx.drawImage(maskCanvas, 0, 0, finalW, finalH);
        fCtx.globalCompositeOperation = 'source-over';

        return finalCanvas.toDataURL('image/png');
    } catch (err) {
        console.warn('[imageBackgroundRemoval] MediaPipe segmentation fallback triggered:', err?.message);
        return null;
    }
}

/**
 * Computes color distance in RGB space.
 */
function colorDistance(r1, g1, b1, r2, g2, b2) {
    const dr = r1 - r2;
    const dg = g1 - g2;
    const db = b1 - b2;
    return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Edge-connected flood fill fallback for non-human objects and offline mode.
 */
function fallbackFloodFillRemoval(img, options = {}) {
    const maxDim = options.maxDimension || 1200;
    let w = img.naturalWidth || img.width || 800;
    let h = img.naturalHeight || img.height || 600;

    if (w > maxDim || h > maxDim) {
        if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
        } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
        }
    }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return img.src;

    ctx.drawImage(img, 0, 0, w, h);
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    // Sample perimeter border colors
    const samples = [];
    const samplePts = [
        [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
        [Math.floor(w / 2), 0], [0, Math.floor(h / 2)],
        [w - 1, Math.floor(h / 2)], [Math.floor(w / 2), h - 1]
    ];

    for (const [sx, sy] of samplePts) {
        const idx = (sy * w + sx) * 4;
        samples.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
    }

    const avgBg = samples.reduce(
        (acc, c) => ({ r: acc.r + c.r / samples.length, g: acc.g + c.g / samples.length, b: acc.b + c.b / samples.length }),
        { r: 0, g: 0, b: 0 }
    );

    const tolerance = options.tolerance || 38;
    const feather = options.feather || 16;
    const visited = new Uint8Array(w * h);
    const queue = [];

    // Seed BFS flood-fill from all 4 borders
    for (let x = 0; x < w; x++) {
        queue.push(x, 0);
        queue.push(x, h - 1);
        visited[x] = 1;
        visited[(h - 1) * w + x] = 1;
    }
    for (let y = 0; y < h; y++) {
        queue.push(0, y);
        queue.push(w - 1, y);
        visited[y * w] = 1;
        visited[y * w + (w - 1)] = 1;
    }

    let head = 0;
    while (head < queue.length) {
        const cx = queue[head++];
        const cy = queue[head++];
        const cIdx = (cy * w + cx) * 4;

        const dist = colorDistance(data[cIdx], data[cIdx + 1], data[cIdx + 2], avgBg.r, avgBg.g, avgBg.b);

        if (dist < tolerance + feather) {
            if (dist <= tolerance) {
                data[cIdx + 3] = 0;
            } else {
                const alphaRatio = (dist - tolerance) / feather;
                data[cIdx + 3] = Math.min(data[cIdx + 3], Math.round(alphaRatio * 255));
            }

            const neighbors = [
                [cx + 1, cy], [cx - 1, cy],
                [cx, cy + 1], [cx, cy - 1]
            ];

            for (const [nx, ny] of neighbors) {
                if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                    const nPos = ny * w + nx;
                    if (!visited[nPos]) {
                        visited[nPos] = 1;
                        const nIdx = nPos * 4;
                        const nDist = colorDistance(data[nIdx], data[nIdx + 1], data[nIdx + 2], avgBg.r, avgBg.g, avgBg.b);
                        if (nDist < tolerance + feather) {
                            queue.push(nx, ny);
                        }
                    }
                }
            }
        }
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas.toDataURL('image/png');
}

/**
 * Removes background from an image source with person & object awareness.
 *
 * @param {string} src - The image URL or data URL
 * @param {object} [options] - Configuration options
 * @returns {Promise<string>} Transparent PNG data URL
 */
export function removeBackgroundFromImage(src, options = {}) {
    return new Promise((resolve, reject) => {
        if (!src) {
            reject(new Error('No image source provided for background removal.'));
            return;
        }

        const img = new Image();
        img.crossOrigin = 'anonymous';

        img.onload = async () => {
            try {
                // Tier 1: Try on-device MediaPipe semantic person segmentation
                const mpResult = await segmentWithMediaPipe(img);
                if (mpResult) {
                    resolve(mpResult);
                    return;
                }

                // Tier 2: Fall back to edge-connected flood-fill
                const fallbackResult = fallbackFloodFillRemoval(img, options);
                resolve(fallbackResult);
            } catch (err) {
                try {
                    const fallbackResult = fallbackFloodFillRemoval(img, options);
                    resolve(fallbackResult);
                } catch (fallbackErr) {
                    reject(fallbackErr);
                }
            }
        };

        img.onerror = (err) => {
            reject(new Error(`Failed to load image for background removal: ${err?.message || 'Network/CORS error'}`));
        };

        img.src = src;
    });
}
