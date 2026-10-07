/**
 * client/src/agent/shortTimeline.js
 *
 * R92 round B: turn one window of the main edit into a stand-alone short,
 * WITHOUT touching the main edit. Pure: tracks in, new tracks out. The Shorts
 * panel sends the result straight to the normal export (same compositor,
 * caption program and camera motion as any export).
 *
 * What changes for the short:
 *   - every clip is trimmed to the window and moved so the short starts at 0
 *     (source offsets advance by the trimmed head, speed included);
 *   - caption word times move with their clip (they are absolute times);
 *   - video clips get a 9:16 crop centred on the speaker (the same
 *     fillFrameCrop the Reel style uses), unless the user set their own crop;
 *   - captions move into the platform's safe zone (above the bottom UI);
 *   - a transition on the very last clip is dropped (nothing comes after it).
 */

import { fillFrameCrop } from '../motion/LayoutPresets.js';

const EPS = 1e-3;

function isCaptionClip(clip, track) {
    return track?.type === 'text' && ((Array.isArray(clip?.words) && clip.words.length > 0)
        || clip?.style === 'subtitle' || String(clip?.clipId || clip?.id || '').startsWith('caption-'));
}

/**
 * Cut every track down to [start, end] and shift it to start at 0.
 * @returns {{tracks:Array, duration:number}}
 */
export function sliceTimeline(tracks, start, end) {
    const a = Math.max(0, Number(start) || 0);
    const b = Math.max(a, Number(end) || 0);
    const out = [];
    for (const track of tracks || []) {
        const clips = [];
        for (const c of track.clips || []) {
            const cs = Number(c.start) || 0;
            const ce = cs + (Number(c.duration) || 0);
            if (ce <= a + EPS || cs >= b - EPS) continue;
            const ns = Math.max(cs, a);
            const ne = Math.min(ce, b);
            const head = ns - cs;
            const speed = Number(c.speed) > 0 ? Number(c.speed) : 1;
            const clip = {
                ...c,
                start: Math.round((ns - a) * 1000) / 1000,
                duration: Math.round((ne - ns) * 1000) / 1000,
            };
            if (Number.isFinite(Number(c.offset))) clip.offset = Math.round(((Number(c.offset) || 0) + head * speed) * 1000) / 1000;
            if (Array.isArray(c.words)) {
                clip.words = c.words
                    .filter(w => Number(w?.end) > ns && Number(w?.start) < ne)
                    .map(w => ({ ...w, start: Math.max(0, Number(w.start) - a), end: Math.max(0, Number(w.end) - a) }));
            }
            // A trimmed head means keyframes/animations authored at clip time 0
            // would now start late; shift what we can, drop what fell off.
            if (head > EPS && Array.isArray(c.keyframes)) {
                clip.keyframes = c.keyframes.map(k => ({ ...k, time: (Number(k.time) || 0) - head })).filter(k => k.time >= -EPS);
            }
            clips.push(clip);
        }
        out.push({ ...track, clips });
    }
    return { tracks: out, duration: Math.round((b - a) * 1000) / 1000 };
}

/**
 * Build the export-ready short.
 * @param {Array} tracks main-edit tracks
 * @param {{start:number, end:number}} short
 * @param {{assets?:Array, profile?:object, frameAspect?:number, pad?:{before:number, after:number}}} opts
 * @returns {{tracks:Array, duration:number, aspectRatio:string, reframed:number}}
 */
export function buildShortTimeline(tracks, short, opts = {}) {
    const profile = opts.profile || null;
    const pad = opts.pad || { before: 0.15, after: 0.3 };
    const total = (tracks || []).reduce((m, t) => Math.max(m, ...(t.clips || []).map(c => (Number(c.start) || 0) + (Number(c.duration) || 0))), 0);
    const start = Math.max(0, (Number(short?.start) || 0) - pad.before);
    const end = Math.min(total || Infinity, (Number(short?.end) || 0) + pad.after);
    const { tracks: sliced, duration } = sliceTimeline(tracks, start, end);

    const aspectRatio = profile?.aspectRatio || '9:16';
    const [aw, ah] = aspectRatio.split(':').map(Number);
    const frameAspect = Number(opts.frameAspect) > 0 ? Number(opts.frameAspect) : aw / ah;
    const assetOf = c => (opts.assets || []).find(x => x.id === c?.assetId) || null;
    const aspectOf = c => {
        const r = c?.metadata?.resolution || assetOf(c)?.resolution || null;
        if (r && r.w > 0 && r.h > 0) return r.w / r.h;
        const as = assetOf(c);
        if (as && as.width > 0 && as.height > 0) return as.width / as.height;
        const lm = c?.layerMask;
        if (lm && lm.sourceWidth > 0 && lm.sourceHeight > 0) return lm.sourceWidth / lm.sourceHeight;
        return null; // unknown shape: leave the frame as it is rather than guess a crop
    };

    let reframed = 0;
    let lastVideoEnd = -1;
    let lastVideo = null;
    for (const track of sliced) {
        for (const c of track.clips) {
            if (track.type === 'video' && (!c.type || c.type === 'video')) {
                const ce = c.start + c.duration;
                if (ce > lastVideoEnd) { lastVideoEnd = ce; lastVideo = c; }
                if (!c.virtualCam || c.virtualCam.reframe) {
                    const speed = Number(c.speed) > 0 ? Number(c.speed) : 1;
                    const fit = fillFrameCrop({
                        bboxTrack: c.layerMask?.bboxTrack || null,
                        sourceStart: Number(c.offset) || 0,
                        duration: c.duration * speed,
                        sourceAspect: aspectOf(c),
                        frameAspect,
                    });
                    if (fit) { c.virtualCam = { ...fit.crop, reframe: aspectRatio }; reframed += 1; }
                    else if (c.virtualCam?.reframe) delete c.virtualCam;
                }
            }
            if (profile && isCaptionClip(c, track)) {
                c.y = profile.captionY;
                c.x = 50;
                c.position = undefined;
            }
        }
    }
    if (lastVideo?.transition) delete lastVideo.transition;

    return { tracks: sliced, duration, aspectRatio, reframed };
}

export default { sliceTimeline, buildShortTimeline };
