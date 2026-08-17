/**
 * client/src/motion/ClipAdapter.js
 *
 * The hinge that makes the Motion Graphics engine ADDITIVE.
 *
 * A MotionLayer is a VIEW over a legacy clip, not a replacement for it.
 * `clipToMotionLayer` reads; `motionLayerToClipUpdates` writes back as
 * ordinary clip fields that `updateClip` already accepts.
 *
 * WHY THIS SHAPE, AND NOT A NEW ENTITY TYPE:
 * Every component in this app reads `state.tracks`, which is produced by
 * `TimelineStateManager.toLegacyTracks()`. The normalized entity store is
 * write-only in practice — a grep for `entities.` outside the timeline module
 * returns nothing. Introducing a `motionLayers` entity bucket would therefore
 * render exactly nothing until every consumer was repointed, which is the
 * "built but never wired" failure this codebase has hit eight times
 * (CLAUDE.md R33, R37, /api/brain/organize, R46, R52, R55, R55c, and
 * DirectorIntelligence). Adapting instead means the engine is live the moment
 * one component calls it.
 *
 * PERSISTENCE CONTRACT: the three new clip fields this writes — `animations`,
 * `words`, `captionStyle` — must appear in BOTH `toLegacyTracks()` and
 * `fromLegacyTracks()` in TimelineStateManager.js. Those two hand-maintained
 * field lists are the real schema of this app; a field in one but not the
 * other silently vanishes on project reload. (`animation`, the legacy string,
 * was in exactly that broken state before this change — projected out, never
 * read back.)
 */

import { createMotionLayer, LAYER_KINDS } from './MotionSchema.js';
import { buildPreset, LEGACY_ANIMATION_MAP } from './MotionPresets.js';

/** Map a legacy clip/track type onto a motion layer kind. */
function inferKind(clip, trackType) {
    const t = clip?.type || trackType;
    if (t === 'text') {
        // A caption is a text clip that carries word timings or came from the
        // caption pipeline. The distinction matters for word-highlight
        // rendering; everything else treats them identically.
        return (Array.isArray(clip?.words) && clip.words.length > 0) || clip?.style === 'subtitle'
            ? LAYER_KINDS.CAPTION
            : LAYER_KINDS.TEXT;
    }
    if (t === 'image')   return LAYER_KINDS.IMAGE;
    if (t === 'video')   return LAYER_KINDS.VIDEO;
    if (t === 'sticker') return LAYER_KINDS.STICKER;
    if (t === 'shape')   return LAYER_KINDS.SHAPE;
    // R62: an 'overlay' TRACK holds clips typed 'sticker'/'image'/'shape'
    // individually (handled above). This is only reached when a clip on an
    // overlay track has no clip.type of its own — default to image rather
    // than falling through to TEXT, which would misinterpret a graphic as a
    // caption in the resolver and word-highlight code.
    if (t === 'overlay') return LAYER_KINDS.IMAGE;
    return LAYER_KINDS.TEXT;
}

/**
 * Resolve a clip's animations, in priority order:
 *   1. `clip.animations` — the new array, authored by the motion engine
 *   2. `clip.animation`  — the legacy single string, mapped to a preset
 *   3. the clip's caption style pack's `animationPreset`
 * Returns [] when none apply, which resolves to a completely static layer.
 */
function resolveAnimations(clip) {
    if (Array.isArray(clip?.animations) && clip.animations.length > 0) {
        return clip.animations;
    }

    const duration = Number(clip?.duration) || 0;

    // Legacy single-string animation — keeps existing projects animating.
    if (typeof clip?.animation === 'string' && clip.animation !== 'none') {
        const presetId = LEGACY_ANIMATION_MAP[clip.animation];
        if (presetId) return buildPreset(presetId, { duration });
    }

    const packPreset = clip?.captionStyle?.animationPreset;
    if (packPreset) return buildPreset(packPreset, { duration });

    return [];
}

/**
 * Build a MotionLayer view of a legacy clip.
 *
 * @param {object} clip a clip from `state.tracks[].clips[]`
 * @param {object} [track] its track, for type inference
 * @returns {object|null} a MotionLayer, or null for unusable input
 */
export function clipToMotionLayer(clip, track) {
    if (!clip || typeof clip !== 'object') return null;

    // clip.x / clip.y are PERCENTAGES of the frame naming the element's centre.
    // `position` is a separate, older string enum ('top' | 'bottom') that only
    // text clips use. Numeric coords win when present; otherwise the enum is
    // translated to the same percentages TextOverlay and exportProcessor use,
    // so all three agree on where 'bottom' actually is.
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
        x,
        y,
        scale:     Number.isFinite(Number(clip.scale)) ? Number(clip.scale) : 1,
        rotation:  Number.isFinite(Number(clip.rotation)) ? Number(clip.rotation) : 0,
        opacity:   Number.isFinite(Number(clip.opacity)) ? Number(clip.opacity) : 1,
        animations: resolveAnimations(clip),
        words:     Array.isArray(clip.words) ? clip.words : null,
        content:   clip.content ?? clip.name ?? '',
        style: {
            fontFamily:     clip.fontFamily,
            fontSize:       clip.fontSize,
            fontWeight:     clip.fontWeight,
            fontStyle:      clip.fontStyle,
            textDecoration: clip.textDecoration,
            textShadow:     clip.textShadow,
            stroke:         clip.stroke,
            color:          clip.color,
            textAlign:      clip.textAlign,
            captionStyle:   clip.captionStyle,
        },
    });
}

/**
 * Convert MotionLayer edits back into a clip-field update bag suitable for
 * `updateClip(trackId, clipId, updates)`.
 *
 * Only fields the caller actually changed should be passed in — this returns
 * exactly what it is given, translated. It deliberately does NOT write
 * `endTime`, because the timeline's canonical model is start + duration and
 * writing both invites them to disagree.
 *
 * @param {object} layer a MotionLayer (or a partial one)
 * @returns {object} clip updates
 */
export function motionLayerToClipUpdates(layer) {
    if (!layer || typeof layer !== 'object') return {};
    const updates = {};

    if (Number.isFinite(layer.startTime)) updates.start = layer.startTime;
    if (Number.isFinite(layer.duration))  updates.duration = layer.duration;
    if (Number.isFinite(layer.x))         updates.x = layer.x;
    if (Number.isFinite(layer.y))         updates.y = layer.y;
    if (Number.isFinite(layer.scale))     updates.scale = layer.scale;
    if (Number.isFinite(layer.rotation))  updates.rotation = layer.rotation;
    if (Number.isFinite(layer.opacity))   updates.opacity = layer.opacity;
    if (Array.isArray(layer.animations))  updates.animations = layer.animations;
    if (Array.isArray(layer.words))       updates.words = layer.words;
    if (typeof layer.content === 'string') updates.content = layer.content;

    if (layer.style && typeof layer.style === 'object') {
        for (const key of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle',
                           'textDecoration', 'textShadow', 'stroke', 'color',
                           'textAlign', 'captionStyle']) {
            if (layer.style[key] !== undefined) updates[key] = layer.style[key];
        }
    }

    return updates;
}

/**
 * Apply a motion preset to a clip, returning the clip updates to dispatch.
 * Replaces any existing animations rather than appending — stacking presets
 * by accident produces compounding scale/opacity that reads as a bug.
 *
 * @param {object} clip
 * @param {string} presetId
 * @returns {object} clip updates ({} when the preset is unknown)
 */
export function applyPresetToClip(clip, presetId) {
    if (!clip) return {};
    const animations = buildPreset(presetId, { duration: Number(clip.duration) || 0 });
    if (animations.length === 0) return {};
    return {
        animations,
        // Clear the legacy single-string field so the two can't both claim to
        // drive the same layer — `resolveAnimations` prefers the array, but
        // leaving a stale string behind makes the UI show the wrong selection.
        animation: 'none',
    };
}

/** Collect every clip on a track as motion layers. Skips unusable clips. */
export function trackToMotionLayers(track) {
    if (!track || !Array.isArray(track.clips)) return [];
    const out = [];
    for (const clip of track.clips) {
        const layer = clipToMotionLayer(clip, track);
        if (layer) out.push(layer);
    }
    return out;
}

export default {
    clipToMotionLayer,
    motionLayerToClipUpdates,
    applyPresetToClip,
    trackToMotionLayers,
};
