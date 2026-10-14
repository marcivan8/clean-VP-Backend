/**
 * client/src/motion/DepthCompositor.js
 *
 * Subject-Aware Compositing & Depth Engine (Pillar G).
 *
 * Provides:
 *   1. Depth layer partitioning (Background -> Behind-Subject Sandwich -> Cutout Subject -> Foreground).
 *   2. Subject spatial anchor derivation from MediaPipe bbox tracks (head, behind, shoulders, chest).
 *   3. Selective styling presets for background (blur, dim, color, desaturate) and subject (glow, outline, shadow).
 *   4. Export sandwich filter compilation for FFmpeg / @napi-rs/canvas parity.
 */

export const DEPTH_LAYERS = Object.freeze({
    BACKGROUND:     'background',
    BEHIND_SUBJECT: 'behind_subject',
    SUBJECT:        'subject',
    FOREGROUND:     'foreground',
});

export const SUBJECT_ANCHORS = Object.freeze({
    HEAD:           'head',
    BEHIND:         'behind',
    LEFT_SHOULDER:  'left_shoulder',
    RIGHT_SHOULDER: 'right_shoulder',
    CHEST:          'chest',
    LOWER_THIRD:    'lower_third',
});

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

/**
 * Derives subject spatial anchor points in percent coordinates (0-100)
 * from a subject bounding box track.
 *
 * @param {Array<{t:number, cx:number, cy:number, w:number, h:number}>} bboxTrack
 * @param {object} [opts] { sourceStart, duration, margin = 5 }
 * @returns {Record<string, {x:number, y:number}>}
 */
export function deriveSubjectAnchors(bboxTrack, opts = {}) {
    const list = Array.isArray(bboxTrack) ? bboxTrack : [];
    const sourceStart = num(opts.sourceStart, 0);
    const duration = num(opts.duration, Infinity);
    const margin = num(opts.margin, 5);

    const relevant = list.filter(s => s && s.t >= sourceStart && s.t <= sourceStart + duration);
    if (relevant.length === 0) {
        // Fallback default anchors centered in frame
        return {
            [SUBJECT_ANCHORS.HEAD]:           { x: 50, y: 25 },
            [SUBJECT_ANCHORS.BEHIND]:         { x: 50, y: 40 },
            [SUBJECT_ANCHORS.LEFT_SHOULDER]:  { x: 30, y: 45 },
            [SUBJECT_ANCHORS.RIGHT_SHOULDER]: { x: 70, y: 45 },
            [SUBJECT_ANCHORS.CHEST]:          { x: 50, y: 50 },
            [SUBJECT_ANCHORS.LOWER_THIRD]:    { x: 50, y: 85 },
        };
    }

    // Compute median center and bounding box dimensions in percent (0..100)
    const xs = relevant.map(s => s.cx * 100);
    const ys = relevant.map(s => s.cy * 100);
    const ws = relevant.map(s => s.w * 100);
    const hs = relevant.map(s => s.h * 100);

    const median = arr => {
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    };

    const cx = median(xs);
    const cy = median(ys);
    const w = median(ws);
    const h = median(hs);

    return {
        [SUBJECT_ANCHORS.HEAD]: {
            x: clamp(cx, 10, 90),
            y: clamp(cy - h / 2 - margin, 5, 95),
        },
        [SUBJECT_ANCHORS.BEHIND]: {
            x: clamp(cx, 10, 90),
            y: clamp(cy - h * 0.1, 5, 95),
        },
        [SUBJECT_ANCHORS.LEFT_SHOULDER]: {
            x: clamp(cx - w / 2 - margin, 5, 95),
            y: clamp(cy - h * 0.15, 5, 95),
        },
        [SUBJECT_ANCHORS.RIGHT_SHOULDER]: {
            x: clamp(cx + w / 2 + margin, 5, 95),
            y: clamp(cy - h * 0.15, 5, 95),
        },
        [SUBJECT_ANCHORS.CHEST]: {
            x: clamp(cx, 10, 90),
            y: clamp(cy, 5, 95),
        },
        [SUBJECT_ANCHORS.LOWER_THIRD]: {
            x: 50,
            y: 85,
        },
    };
}

/**
 * Checks whether a clip is designated to be rendered behind the speaker/subject.
 * @param {object} clip
 * @returns {boolean}
 */
export function isBehindSubject(clip) {
    if (!clip || typeof clip !== 'object') return false;
    return clip.placement === 'behind_subject'
        || clip.placement === 'behind_speaker'
        || clip.depth === 'behind_subject'
        || clip.sandwich === true;
}

/**
 * Partitions clips that overlap a matted base clip into sandwich (behind subject)
 * and front (foreground) layers.
 *
 * @param {Array<object>} clips
 * @param {object} baseClip
 * @returns {{ behind: Array<object>, front: Array<object> }}
 */
export function partitionClipsByDepth(clips, baseClip) {
    const list = Array.isArray(clips) ? clips : [];
    const baseStart = num(baseClip?.start, 0);
    const baseEnd = baseStart + Math.max(0, num(baseClip?.duration, 0));

    const behind = [];
    const front = [];

    for (const clip of list) {
        if (!clip) continue;
        const cStart = num(clip.start, 0);
        const cEnd = cStart + Math.max(0, num(clip.duration, 0));
        const overlaps = Math.max(cStart, baseStart) < Math.min(cEnd, baseEnd);

        if (overlaps && isBehindSubject(clip)) {
            behind.push(clip);
        } else {
            front.push(clip);
        }
    }

    return { behind, front };
}

/**
 * Compiles selective background/subject styling parameters.
 *
 * @param {object} [settings]
 * @returns {object} normalized selective styling descriptor
 */
export function resolveSelectiveEffects(settings = {}) {
    const s = settings || {};
    return {
        backgroundMode:   s.backgroundMode || s.mode || 'blur',
        desaturateBg:     Boolean(s.desaturateBg || s.mode === 'desaturate'),
        subjectGlow:      s.subjectGlow ? {
            color:   s.subjectGlow.color || '#3b82f6',
            radius:  clamp(num(s.subjectGlow.radius, 15), 1, 50),
            opacity: clamp(num(s.subjectGlow.opacity, 0.6), 0, 1),
        } : null,
        subjectOutline:   s.subjectOutline ? {
            color: s.subjectOutline.color || '#ffffff',
            width: clamp(num(s.subjectOutline.width, 3), 1, 15),
        } : null,
    };
}

export default {
    DEPTH_LAYERS,
    SUBJECT_ANCHORS,
    deriveSubjectAnchors,
    isBehindSubject,
    partitionClipsByDepth,
    resolveSelectiveEffects,
};
