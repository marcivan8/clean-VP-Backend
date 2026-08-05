/**
 * captureProjectThumbnail.js
 *
 * Captures a JPEG frame from the first video clip in the timeline and uploads
 * it to the backend as the project thumbnail.
 *
 * Approach:
 *   1. Find the first video asset with a usable URL (prefers raw mp4, not HLS)
 *   2. Seek a hidden <video> element to 25 % of its duration
 *   3. Draw to <canvas> and convert to a JPEG Blob
 *   4. POST the Blob to POST /api/projects/:id/thumbnail (multipart)
 *   5. Return the new thumbnail URL, or null on any failure
 */

import { supabase } from '../lib/supabaseClient.js';

// ─── URL resolution ────────────────────────────────────────────────────────────

/**
 * Convert an asset entry to a usable <video src> URL.
 *
 * Priority (raw last, deliberately):
 *   1. asset.proxyUrl  — if it's NOT an HLS playlist (.m3u8), use it directly
 *   2. asset.url       — if not a revoked blob
 *   3. asset.sourceUrl — the original raw GCS URL, as a last resort only
 *
 * This USED to check sourceUrl (raw) first and proxyUrl second — backwards.
 * Raw phone/camera uploads routinely have their moov atom at the END of the
 * file (R7/R25), and seeking a <video> element (`video.currentTime = seekTo`
 * below) needs that atom to map time to a byte offset. Over HTTP against a
 * non-faststart file, the browser frequently can't do that seek at all —
 * `onerror` fires before `onseeked` ever does — which is exactly what showed
 * up in the wild: "[thumbnail] Video load error for .../raw/.../4K.mp4"
 * immediately followed, on the NEXT autosave tick once the proxy had finished,
 * by a successful "[thumbnail] Saved: ...". The raw source wasn't broken, it
 * was just picked first when it's the one URL shape thumbnail capture is
 * least likely to work against. A proxy is always faststart (R7), so it
 * should be tried first whenever one exists.
 */
function buildVideoUrl(asset) {
    if (!asset) return null;

    // 1. proxyUrl — skip HLS streams (browser <video> can't seek them for canvas)
    if (asset.proxyUrl && !asset.proxyUrl.endsWith('.m3u8')) {
        const p = asset.proxyUrl;
        if (p.startsWith('/') || p.startsWith('http')) return p;
        // Relative GCS path like "raw/userId/file.mp4"
        return `/api/proxy/gcs-media/${p}`;
    }

    // 2. Direct url (not a revoked blob) — usually mirrors proxyUrl once hydrated
    if (asset.url && !asset.url.startsWith('blob:')) return asset.url;

    // 3. Raw GCS URL, last resort — no proxy exists yet or ever will for this
    // asset. Still worth trying (short clips / faststart-friendly sources do
    // work), just no longer the FIRST thing attempted.
    if (asset.sourceUrl) {
        const src = asset.sourceUrl;
        if (src.startsWith('https://storage.googleapis.com/')) {
            try {
                const u = new URL(src);
                // pathname is /{bucketName}/raw/... — strip the leading slash + bucket
                const segments = u.pathname.split('/').filter(Boolean);
                segments.shift(); // remove bucket name
                return `/api/proxy/gcs-media/${segments.join('/')}`;
            } catch (_) {}
        }
        // Already a relative or absolute server path
        if (!src.startsWith('blob:')) return src;
    }

    return null;
}

// ─── Canvas frame capture ─────────────────────────────────────────────────────

/**
 * Seek a video to 25 % of its duration and capture a 640-px-wide JPEG Blob.
 * Resolves to null on any error or timeout.
 */
function captureFrame(videoUrl) {
    return new Promise(resolve => {
        const video   = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.muted       = true;
        video.preload     = 'metadata';

        let done = false;
        const finish = (blob) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            video.src = '';
            video.load();
            resolve(blob);
        };

        // Hard timeout — don't block the autosave loop
        const timer = setTimeout(() => {
            console.warn('[thumbnail] Frame capture timed out');
            finish(null);
        }, 12000);

        video.onloadedmetadata = () => {
            const seekTo = video.duration > 0
                ? Math.min(video.duration * 0.25, 4)
                : 0;
            video.currentTime = seekTo;
        };

        video.onseeked = () => {
            try {
                const W = 640;
                const H = video.videoWidth > 0
                    ? Math.round(W * video.videoHeight / video.videoWidth)
                    : 360;
                const canvas = document.createElement('canvas');
                canvas.width  = W;
                canvas.height = H;
                canvas.getContext('2d').drawImage(video, 0, 0, W, H);
                canvas.toBlob(blob => finish(blob), 'image/jpeg', 0.82);
            } catch (err) {
                console.warn('[thumbnail] Canvas capture failed:', err.message);
                finish(null);
            }
        };

        video.onerror = () => {
            console.warn('[thumbnail] Video load error for', videoUrl);
            finish(null);
        };

        video.src = videoUrl;
    });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Capture and upload a project thumbnail.
 *
 * @param {string}   projectId  - Supabase project UUID
 * @param {object[]} tracks     - Timeline tracks array (from useTimelineStore)
 * @param {object[]} assets     - Assets array (from useTimelineStore)
 * @returns {Promise<string|null>}  The new thumbnail_url, or null if capture failed
 */
export async function captureProjectThumbnail(projectId, tracks, assets) {
    if (!projectId || !tracks || !assets) return null;

    // Find the first video clip that has an asset
    const videoTrack = tracks.find(t => t.type === 'video');
    if (!videoTrack?.clips?.length) {
        console.log('[thumbnail] No video clips — skipping');
        return null;
    }

    let videoUrl = null;
    for (const clip of videoTrack.clips) {
        const asset = assets.find(a => a.id === clip.assetId);
        videoUrl = buildVideoUrl(asset);
        if (videoUrl) break;
    }

    if (!videoUrl) {
        console.log('[thumbnail] No usable video URL — skipping');
        return null;
    }

    console.log('[thumbnail] Capturing frame from:', videoUrl);
    const blob = await captureFrame(videoUrl);
    if (!blob) return null;

    // ── Upload ────────────────────────────────────────────────────────────────
    // Get auth token (best-effort — anonymous requests fall back to dev-user on server)
    let authHeader = {};
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
            authHeader = { Authorization: `Bearer ${session.access_token}` };
        }
    } catch (_) {}

    const formData = new FormData();
    formData.append('thumbnail', blob, 'thumbnail.jpg');

    try {
        const res = await fetch(`/api/projects/${projectId}/thumbnail`, {
            method:  'POST',
            headers: authHeader,   // no Content-Type — let the browser set multipart boundary
            body:    formData,
        });

        if (!res.ok) {
            console.error('[thumbnail] Upload failed:', res.status, await res.text());
            return null;
        }

        const { thumbnailUrl } = await res.json();
        console.log('[thumbnail] Saved:', thumbnailUrl);
        return thumbnailUrl;
    } catch (err) {
        console.error('[thumbnail] Upload error:', err.message);
        return null;
    }
}
