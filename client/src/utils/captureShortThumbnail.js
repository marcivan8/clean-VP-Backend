/**
 * client/src/utils/captureShortThumbnail.js
 *
 * R93: a real picture for every short in the Shorts tab: one 9:16 frame of the
 * speaker, framed exactly like the exported short (the same speaker crop
 * agent/shortTimeline.js applies), taken at the short's opening moment.
 *
 * Kept in memory only (a few KB per short, regenerated on load) so project
 * saves and the localStorage autosave do not grow with images.
 */
import { buildShortTimeline } from '../agent/shortTimeline.js';
import { PLATFORM_PROFILES } from '../agent/PlatformProfiles.js';

const W = 180;
const H = 320;
const PAD = { before: 0.15, after: 0.3 }; // same lead-in as the exported short
const cache = new Map();                 // key -> data URL
const inflight = new Map();              // key -> Promise

/** Cache key: a short moved, retimed or re-framed gets a new picture. */
export function thumbnailKey(short) {
    if (!short) return '';
    return `${short.id}:${Number(short.start) || 0}:${Number(short.end) || 0}:${short.platform || ''}`;
}

export function getCachedShortThumbnail(short) {
    return cache.get(thumbnailKey(short)) || null;
}

/** Playable URLs for an asset, best first (proxy is faststart, so it seeks reliably). */
export function videoUrlsFor(asset) {
    if (!asset) return [];
    const out = [];
    const push = (u) => { if (u && !out.includes(u)) out.push(u); };
    if (asset.proxyUrl && !String(asset.proxyUrl).endsWith('.m3u8')) {
        const p = String(asset.proxyUrl);
        push(p.startsWith('/') || p.startsWith('http') || p.startsWith('blob:') ? p : `/api/proxy/gcs-media/${p}`);
    }
    if (asset.url) push(asset.url); // a blob: URL is fine while this session lasts
    if (asset.sourceUrl) {
        const src = String(asset.sourceUrl);
        if (src.startsWith('https://storage.googleapis.com/')) {
            try {
                const segments = new URL(src).pathname.split('/').filter(Boolean);
                segments.shift(); // bucket
                push(`/api/proxy/gcs-media/${segments.join('/')}`);
            } catch (err) {
                console.warn('[captureShortThumbnail] bad source URL:', err.message);
            }
        } else if (!src.startsWith('blob:')) {
            push(src);
        }
    }
    return out;
}

/**
 * Where to take the picture: the video clip of the finished short showing at
 * its opening moment, the source time, and the 9:16 crop.
 * Pure (no DOM), so it is testable.
 * @returns {{assetId:string, sourceTime:number, crop:{cropX:number,cropY:number,cropW:number,cropH:number}|null}|null}
 */
export function planShortThumbnail(state, short) {
    if (!short || !state) return null;
    const profile = PLATFORM_PROFILES[short.platform] || PLATFORM_PROFILES.tiktok;
    let built;
    try {
        built = buildShortTimeline(state.tracks || [], short, { assets: state.assets || [], profile, pad: PAD });
    } catch (err) {
        console.warn('[captureShortThumbnail] could not frame the short:', err.message);
        return null;
    }
    const len = Number(built?.duration) || 0;
    // The opening moment (the hook), or the first detected moment inside the short's first half.
    const firstEvent = (Array.isArray(short.events) ? short.events : [])
        .map(e => Number(e?.timelineTime) - ((Number(short.start) || 0) - PAD.before))
        .filter(t => Number.isFinite(t) && t > 0.3 && t < len * 0.5)
        .sort((a, b) => a - b)[0];
    const at = Math.min(Math.max(0, len - 0.1), Number.isFinite(firstEvent) ? firstEvent : PAD.before + Math.min(1.2, Math.max(0.4, len * 0.06)));

    const videoClips = (built.tracks || [])
        .filter(t => t.type === 'video')
        .flatMap(t => t.clips || [])
        .filter(c => (!c.type || c.type === 'video') && c.assetId);
    const clip = videoClips.find(c => at >= c.start && at < c.start + c.duration)
        || videoClips.sort((a, b) => a.start - b.start)[0];
    if (!clip) return null;
    const speed = Number(clip.speed) > 0 ? Number(clip.speed) : 1;
    const local = Math.min(Math.max(0, at - clip.start), Math.max(0, clip.duration - 0.05));
    const vc = clip.virtualCam;
    const crop = vc && Number(vc.cropW) > 0 && Number(vc.cropH) > 0
        ? { cropX: Number(vc.cropX) || 0, cropY: Number(vc.cropY) || 0, cropW: Number(vc.cropW), cropH: Number(vc.cropH) }
        : null;
    return { assetId: clip.assetId, sourceTime: (Number(clip.offset) || 0) + local * speed, crop };
}

/** Source rectangle for a 9:16 picture: the short's crop, else a centred one. */
export function sourceRect(vw, vh, crop) {
    if (crop) {
        let sx = crop.cropX * vw, sy = crop.cropY * vh, sw = crop.cropW * vw, sh = crop.cropH * vh;
        // The crop can be a hair off 9:16 after rounding: trim to the exact shape.
        const want = W / H;
        if (sw / sh > want) { const nw = sh * want; sx += (sw - nw) / 2; sw = nw; } else { const nh = sw / want; sy += (sh - nh) / 2; sh = nh; }
        return { sx, sy, sw, sh };
    }
    const want = W / H;
    if (vw / vh > want) { const sw = vh * want; return { sx: (vw - sw) / 2, sy: 0, sw, sh: vh }; }
    const sh = vw / want;
    return { sx: 0, sy: (vh - sh) / 2, sw: vw, sh };
}

function grabFrame(url, sourceTime, crop) {
    return new Promise((resolve) => {
        const video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        let done = false;
        const finish = (result) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            video.removeAttribute('src');
            try { video.load(); } catch (err) { console.warn('[captureShortThumbnail] release failed:', err.message); }
            resolve(result);
        };
        const timer = setTimeout(() => finish(null), 10000);
        video.onloadedmetadata = () => {
            const d = Number(video.duration);
            video.currentTime = Number.isFinite(d) && d > 0 ? Math.min(sourceTime, Math.max(0, d - 0.2)) : sourceTime;
        };
        video.onseeked = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = W;
                canvas.height = H;
                const ctx = canvas.getContext('2d');
                const { sx, sy, sw, sh } = sourceRect(video.videoWidth || 1920, video.videoHeight || 1080, crop);
                ctx.drawImage(video, sx, sy, sw, sh, 0, 0, W, H);
                finish(canvas.toDataURL('image/jpeg', 0.78));
            } catch (err) {
                // A tainted canvas (no CORS on that URL) lands here; the next URL may work.
                console.warn('[captureShortThumbnail] frame capture failed:', err.message);
                finish(null);
            }
        };
        video.onerror = () => finish(null);
        video.src = url;
    });
}

/**
 * The picture for one short, as a data URL, or null when no frame could be read.
 * @param {object} short an entry of store.shorts
 * @param {object} state the MAIN edit's state (not a short being previewed)
 */
export async function captureShortThumbnail(short, state) {
    const key = thumbnailKey(short);
    if (!key) return null;
    if (cache.has(key)) return cache.get(key);
    if (inflight.has(key)) return inflight.get(key);
    const job = (async () => {
        const plan = planShortThumbnail(state, short);
        if (!plan) return null;
        const asset = (state.assets || []).find(a => a.id === plan.assetId);
        for (const url of videoUrlsFor(asset)) {
            // eslint-disable-next-line no-await-in-loop
            const pic = await grabFrame(url, plan.sourceTime, plan.crop);
            if (pic) { cache.set(key, pic); return pic; }
        }
        return null;
    })();
    inflight.set(key, job);
    try {
        return await job;
    } finally {
        inflight.delete(key);
    }
}

export default { captureShortThumbnail, getCachedShortThumbnail, planShortThumbnail, thumbnailKey };
