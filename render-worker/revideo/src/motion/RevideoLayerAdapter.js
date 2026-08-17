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

/** Map a legacy clip/track type onto a motion layer kind — mirrors ClipAdapter.inferKind(). */
export function inferKind(clip, trackType) {
    const t = clip?.type || trackType;
    if (t === 'text') {
        return (Array.isArray(clip?.words) && clip.words.length > 0) || clip?.style === 'subtitle'
            ? LAYER_KINDS.CAPTION
            : LAYER_KINDS.TEXT;
    }
    if (t === 'image')   return LAYER_KINDS.IMAGE;
    if (t === 'sticker') return LAYER_KINDS.STICKER;
    if (t === 'shape')   return LAYER_KINDS.SHAPE;
    // An 'overlay' TRACK holds clips typed 'sticker'/'image' individually
    // (handled above); this is only reached for an overlay clip with no
    // clip.type of its own — default to image, matching ClipAdapter.js.
    if (t === 'overlay') return LAYER_KINDS.IMAGE;
    return LAYER_KINDS.TEXT;
}

/**
 * Resolve a clip's animations, in the SAME priority order as
 * ClipAdapter.resolveAnimations():
 *   1. `clip.animations` — the array authored by the motion engine
 *   2. `clip.animation`  — the legacy single string, mapped to a preset
 *   3. the clip's caption style pack's `animationPreset`
 */
function resolveAnimations(clip) {
    if (Array.isArray(clip?.animations) && clip.animations.length > 0) {
        return clip.animations;
    }
    const duration = Number(clip?.duration) || 0;
    if (typeof clip?.animation === 'string' && clip.animation !== 'none') {
        const presetId = LEGACY_ANIMATION_MAP[clip.animation];
        if (presetId) return buildPreset(presetId, { duration });
    }
    const packPreset = clip?.captionStyle?.animationPreset;
    if (packPreset) return buildPreset(packPreset, { duration });
    return [];
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

    let x = Number.isFinite(Number(clip.x)) ? Number(clip.x) : null;
    let y = Number.isFinite(Number(clip.y)) ? Number(clip.y) : null;
    if (x === null || y === null) {
        if (clip.position === 'top')         { x = 50; y = 12; }
        else if (clip.position === 'bottom') { x = 50; y = 85; }
        else                                 { x = 50; y = 50; }
    }

    return createMotionLayer({
        id:        `motion-${clip.id}`,
        sourceId:  clip.id,
        trackId:   track?.id || null,
        kind:      inferKind(clip, track?.type),
        name:      clip.name || 'Layer',
        startTime: Number(clip.start) || 0,
        duration:  Number(clip.duration) || 0,
        x, y,
        scale:     Number.isFinite(Number(clip.scale)) ? Number(clip.scale) : 1,
        rotation:  Number.isFinite(Number(clip.rotation)) ? Number(clip.rotation) : 0,
        opacity:   Number.isFinite(Number(clip.opacity)) ? Number(clip.opacity) : 1,
        animations: resolveAnimations(clip),
        words:     Array.isArray(clip.words) ? clip.words : null,
        content:   clip.content ?? clip.text ?? clip.caption ?? clip.name ?? '',
    });
}

export default { inferKind, clipToLayer };
