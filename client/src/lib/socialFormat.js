/**
 * client/src/lib/socialFormat.js — how a video will land on each platform
 * (R175). Pure.
 *
 * YouTube decides by itself: a vertical or square video of 3 minutes or less
 * becomes a Short, anything else a regular video. Instagram publishes every
 * API video as a Reel; a landscape one shows with bars, and Reels stop at
 * 15 minutes. Unknown size or length gives null rather than a guess.
 */

export const YOUTUBE_SHORT_MAX_S = 180;
export const INSTAGRAM_REEL_MAX_S = 15 * 60;

/** { width, height, duration } → per-platform verdicts. */
export function postFormat(video) {
    const w = Number(video?.width);
    const h = Number(video?.height);
    const d = Number(video?.duration);
    const hasShape = w > 0 && h > 0;
    const hasLength = d > 0;
    const portraitOrSquare = hasShape ? h >= w : null;

    let youtube = null;
    if (hasShape) {
        if (!portraitOrSquare) youtube = 'video';
        else if (hasLength) youtube = d <= YOUTUBE_SHORT_MAX_S ? 'short' : 'video';
        else youtube = 'short';
    }

    let instagram = null;
    if (hasLength && d > INSTAGRAM_REEL_MAX_S) instagram = 'tooLong';
    else if (hasShape) instagram = portraitOrSquare ? 'ok' : 'bars';

    return { youtube, instagram };
}

/** '1920x1080' → { width, height }, or {} when it does not parse. */
export function parseResolution(value) {
    const m = /^(\d+)\s*x\s*(\d+)$/i.exec(String(value || '').trim());
    return m ? { width: Number(m[1]), height: Number(m[2]) } : {};
}

/** Width, height and length of a video URL, read from its metadata (browser only). */
export function probeVideo(url, { timeoutMs = 15000 } = {}) {
    return new Promise((resolve) => {
        if (typeof document === 'undefined' || !url) { resolve({}); return; }
        const el = document.createElement('video');
        let done = false;
        const finish = (value) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            el.removeAttribute('src');
            try { el.load(); } catch { /* released */ }
            resolve(value);
        };
        const timer = setTimeout(() => finish({}), timeoutMs);
        el.preload = 'metadata';
        el.muted = true;
        el.onloadedmetadata = () => finish({ width: el.videoWidth, height: el.videoHeight, duration: el.duration });
        el.onerror = () => finish({});
        el.src = url;
    });
}

/** True when the export lives in the user's cloud exports, the only kind a platform can fetch. */
export function isPostableExport(url) {
    return typeof url === 'string' && /\/api\/proxy\/gcs-media\/exports\//.test(url) && /\.(mp4|mov|webm)$/i.test(url.split('?')[0]);
}

export default { isPostableExport, postFormat, parseResolution, probeVideo, YOUTUBE_SHORT_MAX_S, INSTAGRAM_REEL_MAX_S };
