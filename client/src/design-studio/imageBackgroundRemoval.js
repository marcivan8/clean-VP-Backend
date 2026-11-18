/**
 * client/src/design-studio/imageBackgroundRemoval.js
 *
 * Client-side automatic background removal for image layers.
 * Performs edge-connected flood-fill and color distance thresholding
 * from image perimeter corners with alpha edge smoothing.
 *
 * Zero external network dependencies, runs 100% in browser memory.
 */

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
 * Removes background from an image source (URL or data URL).
 * Returns a Promise that resolves to a transparent PNG data URL.
 *
 * @param {string} src - The image URL or data URL
 * @param {object} options - Configuration options
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

        img.onload = () => {
            try {
                // Downscale for processing if image is huge to keep performance 60fps
                const maxDim = options.maxDimension || 1200;
                let w = img.naturalWidth || img.width;
                let h = img.naturalHeight || img.height;

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
                if (!ctx) {
                    reject(new Error('Canvas 2D context unavailable'));
                    return;
                }

                ctx.drawImage(img, 0, 0, w, h);
                const imgData = ctx.getImageData(0, 0, w, h);
                const data = imgData.data;

                // 1. Sample perimeter border colors (corners + midpoints)
                const samples = [];
                const samplePts = [
                    [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
                    [Math.floor(w / 2), 0], [0, Math.floor(h / 2)],
                    [w - 1, Math.floor(h / 2)], [Math.floor(w / 2), h - 1]
                ];

                for (const [sx, sy] of samplePts) {
                    const idx = (sy * w + sx) * 4;
                    samples.push({
                        r: data[idx],
                        g: data[idx + 1],
                        b: data[idx + 2],
                    });
                }

                // Average background color from perimeter samples
                const avgBg = samples.reduce(
                    (acc, c) => ({ r: acc.r + c.r / samples.length, g: acc.g + c.g / samples.length, b: acc.b + c.b / samples.length }),
                    { r: 0, g: 0, b: 0 }
                );

                const tolerance = options.tolerance || 38;
                const feather = options.feather || 16;
                const visited = new Uint8Array(w * h);
                const queue = [];

                // 2. Seed BFS flood-fill from all 4 perimeter borders
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

                    const dist = colorDistance(
                        data[cIdx], data[cIdx + 1], data[cIdx + 2],
                        avgBg.r, avgBg.g, avgBg.b
                    );

                    // Check if current pixel matches background profile
                    if (dist < tolerance + feather) {
                        if (dist <= tolerance) {
                            data[cIdx + 3] = 0; // Fully transparent
                        } else {
                            // Soft edge feathering
                            const alphaRatio = (dist - tolerance) / feather;
                            data[cIdx + 3] = Math.min(data[cIdx + 3], Math.round(alphaRatio * 255));
                        }

                        // Explore 4-neighbors
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
                                    const nDist = colorDistance(
                                        data[nIdx], data[nIdx + 1], data[nIdx + 2],
                                        avgBg.r, avgBg.g, avgBg.b
                                    );
                                    if (nDist < tolerance + feather) {
                                        queue.push(nx, ny);
                                    }
                                }
                            }
                        }
                    }
                }

                ctx.putImageData(imgData, 0, 0);
                resolve(canvas.toDataURL('image/png'));
            } catch (err) {
                reject(err);
            }
        };

        img.onerror = (err) => {
            reject(new Error(`Failed to load image for background removal: ${err?.message || 'Network/CORS error'}`));
        };

        img.src = src;
    });
}
