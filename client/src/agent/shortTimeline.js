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
 *   - a transition on the very last clip is dropped (nothing comes after it);
 *   - two people side by side in one wide shot (a duo scene analysis exists
 *     for the asset): the host goes in the top half, the guest in the bottom
 *     half (DuoSplit.js), and captions sit on the seam. `duo: false` turns it off.
 */

import { computeReframePlan, sourceAspectOf } from '../motion/LayoutPresets.js';
import { duoAnchorsFromScene, duoSplitFrames } from '../motion/DuoSplit.js';

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
            const clipDur = (ne - ns);
            if (c.keyframes && typeof c.keyframes === 'object') {
                if (Array.isArray(c.keyframes)) {
                    clip.keyframes = c.keyframes
                        .map(k => ({ ...k, time: Math.round(((Number(k.time) || 0) - head) * 1000) / 1000 }))
                        .filter(k => k.time >= -EPS && k.time <= clipDur + EPS);
                } else {
                    const shifted = {};
                    for (const [prop, kfs] of Object.entries(c.keyframes)) {
                        if (Array.isArray(kfs)) {
                            shifted[prop] = kfs
                                .map(k => ({ ...k, time: Math.round(((Number(k.time) || 0) - head) * 1000) / 1000 }))
                                .filter(k => k.time >= -EPS && k.time <= clipDur + EPS);
                        } else {
                            shifted[prop] = kfs;
                        }
                    }
                    clip.keyframes = shifted;
                }
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

    // R100: the per-clip crop maths (fillFrameCrop + the aspectOf/assetOf
    // lookups) is shared with the live editor's reframeToFrame()
    // (useTimelineStore.js) via computeReframePlan() -- the short/repurposing
    // pipeline gets the SAME intelligent, subject-aware reframe instead of a
    // second, separately-maintained copy of the same logic.
    const { work } = computeReframePlan(sliced, { frameAspect, assets: opts.assets, aspectRatio });
    const cropByKey = new Map(work.map(w => [`${w.trackId}::${w.clipId}`, w.crop]));

    let reframed = 0;
    let lastVideoEnd = -1;
    let lastVideo = null;
    for (const track of sliced) {
        for (const c of track.clips) {
            if (track.type === 'video' && (!c.type || c.type === 'video')) {
                const ce = c.start + c.duration;
                if (ce > lastVideoEnd) { lastVideoEnd = ce; lastVideo = c; }
                const key = `${track.id}::${c.id}`;
                if (cropByKey.has(key)) {
                    const crop = cropByKey.get(key);
                    if (crop) { c.virtualCam = crop; reframed += 1; }
                    else delete c.virtualCam;
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

    const duoSplit = opts.duo === false ? 0 : applyDuoSplit(sliced, {
        frameAspect, assets: opts.assets, scenes: opts.sceneAnalysisByAsset,
    });
    if (duoSplit > 0) {
        for (const track of sliced) {
            for (const c of track.clips) if (isCaptionClip(c, track)) { c.y = DUO_CAPTION_Y; c.x = 50; c.position = undefined; }
        }
    }

    return { tracks: sliced, duration, aspectRatio, reframed, duoSplit };
}

/** Caption height for the stacked split: on the seam between the halves. */
export const DUO_CAPTION_Y = 50;
export const DUO_TRACK_ID = 'track-short-duo';

/**
 * Stack the two speakers. For every base-track video clip whose asset has a
 * usable duo analysis, adds two muted, framed copies of it (host on top,
 * guest below) on an overlay track drawn under the short's other graphics.
 * The base clip stays underneath, fully covered; it keeps the audio.
 * Mutates `tracks`. Returns how many clips were split.
 */
export function applyDuoSplit(tracks, { frameAspect, assets = [], scenes = null } = {}) {
    if (!scenes || typeof scenes !== 'object') return 0;
    const base = (tracks || []).find(t => t.type === 'video');
    if (!base) return 0;
    const halves = [];
    let split = 0;
    for (const c of base.clips || []) {
        if (c.type && c.type !== 'video') continue;
        const anchors = duoAnchorsFromScene(scenes[c.assetId]);
        if (!anchors) continue;
        const frames = duoSplitFrames({ ...anchors, sourceAspect: sourceAspectOf(c, assets), frameAspect });
        if (!frames) continue;
        // The base is fully covered by the two halves: a background matte on it
        // would be rendered for nothing. shortPolish skips camera moves on it.
        c.duoSplit = true;
        delete c.layerMask;
        delete c.layerTarget;
        const half = (frame, role) => ({
            ...c,
            id: `${c.id}-duo-${role}`,
            type: 'video',
            name: role === 'top' ? 'Host' : 'Guest',
            frame,
            fit: 'cover',
            muted: true,
            volume: 0,
            animations: [],
            keyframes: undefined,
            virtualCam: undefined,
            transition: undefined,
            duoSplit: role,
        });
        halves.push(half(frames.top, 'top'), half(frames.bottom, 'bottom'));
        split += 1;
    }
    if (split === 0) return 0;
    const minOrder = Math.min(0, ...(tracks || []).filter(t => t.type === 'overlay' && Number.isFinite(Number(t.order))).map(t => Number(t.order)));
    const firstOverlay = tracks.findIndex(t => t.type === 'overlay');
    const track = { id: DUO_TRACK_ID, type: 'overlay', name: 'Split speakers', order: minOrder - 1, clips: halves };
    if (firstOverlay >= 0) tracks.splice(firstOverlay, 0, track);
    else tracks.push(track);
    return split;
}

export default { sliceTimeline, buildShortTimeline, applyDuoSplit };
