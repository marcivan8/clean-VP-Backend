/**
 * render-worker/revideo/src/motion/RevideoLayerAdapter.js
 *
 * SYNCED PORT of the read half of client/src/motion/ClipAdapter.js —
 * `clipToMotionLayer()` and its `resolveAnimations()` priority chain — kept
 * as a separate, trimmed file because this scene only ever READS a clip into
 * a layer, never writes one back (that's the editor's job, not the renderer's).
 * Same reason as the sibling motion/*.js files: the render-worker Docker
 * build context is `render-worker/` only, so the original can't be imported
 * directly. KEEP IN SYNC BY HAND with ClipAdapter.js's resolution priority —
 * scripts/test_revideo_render_path.js pins the resolution order this file
 * implements (clip.animations → legacy clip.animation → captionStyle preset).
 */

import { createMotionLayer, LAYER_KINDS } from './MotionSchema.js';
import { buildPreset, LEGACY_ANIMATION_MAP } from './MotionPresets.js';

const numberOrNull = value => {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
};

/** Map a legacy clip/track type onto a motion layer kind — mirrors ClipAdapter.inferKind(). */
export function inferKind(clip, trackType) {
    const t = clip?.type || trackType;
    if (t === 'text') {
        return (Array.isArray(clip?.words) && clip.words.length > 0) || clip?.style === 'subtitle'
            ? LAYER_KINDS.CAPTION
            : LAYER_KINDS.TEXT;
    }
    if (t === 'video')   return LAYER_KINDS.VIDEO;
    if (t === 'image')   return LAYER_KINDS.IMAGE;
    if (t === 'sticker') return LAYER_KINDS.STICKER;
    if (t === 'template') return LAYER_KINDS.STICKER;
    if (t === 'shape')   return LAYER_KINDS.SHAPE;
    // An 'overlay' TRACK holds clips typed 'sticker'/'image' individually
    // (handled above); this is only reached for an overlay clip with no
    // clip.type of its own — default to image, matching ClipAdapter.js.
    if (t === 'overlay') return LAYER_KINDS.IMAGE;
    return LAYER_KINDS.TEXT;
}

/**
 * Resolve animations with ClipAdapter.resolveAnimations()'s precedence.
 * User-authored animations replace style defaults; automatic moment and
 * caption-intelligence animations layer on top of the style entrance.
 */
const AUTO_ANIMATE = 'auto-animate';
const CAPTION_INTELLIGENCE = 'caption-intelligence';

function baseAnimations(clip) {
    const duration = Number(clip?.duration) || 0;
    if (typeof clip?.animation === 'string' && clip.animation !== 'none') {
        const presetId = LEGACY_ANIMATION_MAP[clip.animation];
        if (presetId) return buildPreset(presetId, { duration });
    }
    const packPreset = clip?.captionStyle?.animationPreset;
    if (packPreset) return buildPreset(packPreset, { duration });
    return [];
}

function resolveAnimations(clip) {
    const own = Array.isArray(clip?.animations) ? clip.animations : [];
    if (own.some(animation => animation
        && animation.source !== AUTO_ANIMATE
        && animation.source !== CAPTION_INTELLIGENCE)) return own;
    const base = baseAnimations(clip);
    return own.length ? [...base, ...own] : base;
}

/**
 * Build a MotionLayer view of a legacy clip — read-only counterpart of
 * ClipAdapter.clipToMotionLayer(). `startTime`/`duration` stay in TIMELINE
 * time (not clip-local) so the caller can compare directly against
 * `playback.time`, matching how the caller waits for `clip.start` already.
 *
 * @param {object} clip a clip from a 'text' or 'overlay' track
 * @param {object} [track] its track, for type inference
 * @returns {object|null} a MotionLayer, or null for unusable input
 */
export function clipToLayer(clip, track) {
    if (!clip || typeof clip !== 'object') return null;

    let x = numberOrNull(clip.x);
    let y = numberOrNull(clip.y);
    if (x === null || y === null) {
        if (clip.position === 'top')         { x = 50; y = 12; }
        else if (clip.position === 'bottom') { x = 50; y = 85; }
        else                                 { x = 50; y = 50; }
    }
    const scale = numberOrNull(clip.scale) ?? 1;
    const scaleX = numberOrNull(clip.scaleX);
    const scaleY = numberOrNull(clip.scaleY);

    return createMotionLayer({
        id:        `motion-${clip.id}`,
        sourceId:  clip.id,
        trackId:   track?.id || null,
        kind:      inferKind(clip, track?.type),
        name:      clip.name || 'Layer',
        startTime: Number(clip.start) || 0,
        duration:  Number(clip.duration) || 0,
        x, y,
        scale,
        scaleX:    scaleX !== null ? scaleX / (scale || 1) : 1,
        scaleY:    scaleY !== null ? scaleY / (scale || 1) : 1,
        rotation:  numberOrNull(clip.rotation) ?? 0,
        opacity:   numberOrNull(clip.opacity) ?? 1,
        // Legacy timeline transform tracks are absolute property values, not
        // Motion Animation deltas. Preserve them for Revideo's shared resolver.
        legacyKeyframes: clip.keyframes && typeof clip.keyframes === 'object' && !Array.isArray(clip.keyframes)
            ? clip.keyframes : {},
        animations: resolveAnimations(clip),
        audioReactive: clip.audioReactive && typeof clip.audioReactive === 'object' ? clip.audioReactive : null,
        motionPath: clip.motionPath && Array.isArray(clip.motionPath.points) ? clip.motionPath : null,
        expressions: clip.expressions && typeof clip.expressions === 'object' ? clip.expressions : {},
        // Match ClipAdapter.clipToMotionLayer(): scene-authored parent groups
        // have already had their static transforms folded into the child by
        // flattenScene(), while live parent transform expressions still need
        // to be evaluated on each rendered frame. Omitting this data made
        // nested scene motion work in editor preview but disappear on export.
        expressionLayers: (Array.isArray(clip.compositionStack) ? clip.compositionStack : [])
            .filter(group => group?.transformExpressions && typeof group.transformExpressions === 'object')
            .map(group => ({
                startTime: Number(group.start) || 0,
                duration: Number(group.duration) || 0,
                originX: Number(group.originX) || 0,
                originY: Number(group.originY) || 0,
                frameW: Number(group.frameW) || 1920,
                frameH: Number(group.frameH) || 1080,
                expressions: group.transformExpressions,
            })),
        words:     Array.isArray(clip.words) ? clip.words : null,
        content:   clip.content ?? clip.text ?? clip.caption ?? clip.name ?? '',
    });
}

export default { inferKind, clipToLayer };
