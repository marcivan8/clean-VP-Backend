/**
 * client/src/motion/ — the VIBED Motion Graphics engine.
 *
 * A unified, renderer-agnostic layer/animation model. Everything here is pure:
 * no React, no DOM, no store, no network. That is what lets the same code drive
 * the DOM preview, the Revideo canvas scene and (later) the export, instead of
 * each growing its own copy that silently diverges — the failure documented in
 * CLAUDE.md R14, R16 and R53.
 *
 * WHAT'S WIRED TODAY (see the R58/R62/R63/R64 journal entries for the full map):
 *   • Caption word timings are preserved end-to-end and rendered per-word.
 *   • Text/caption layers animate through the resolver in the live preview
 *     AND, for clips that use animation/shadow/uppercase, in the export too
 *     (CaptionCompiler.js — R63). Per-word HIGHLIGHT colour is still preview-
 *     only; it needs font metrics the export side doesn't have (see that
 *     file's header for the exact scope line).
 *   • Motion presets generate keyframes on demand, from the Motion tab, for
 *     ANY clip on ANY track.
 *   • Image-sourced overlays (stickers/logos) have a real track, UI, preview
 *     and export path (R62). Vector shapes/arrows/emoji still have a model
 *     and no renderer — nothing can rasterize them to a file yet.
 *   • Camera presets (push/pull/punch-zoom/whip/shake) applied to a clip on
 *     the BASE video/image track now animate in the Revideo live preview
 *     (project.tsx `motionOffsets`), and scale-type presets (push/pull/
 *     punch-zoom) now reach the export too, via a derived
 *     `clip.keyframes.scale` fed through the existing zoompan path
 *     (CameraMotionCompiler.js — R64). Translate-type presets (whip/shake)
 *     are preview-only by design — see that file's header for why.
 */

export {
    EASING_FUNCTIONS,
    resolveEasing,
    listEasingNames,
    clamp,
} from './Easing.js';

export {
    LAYER_KINDS,
    ANIMATION_TYPES,
    ANIMATABLE_PROPS,
    COMPOSITION_RULES,
    IDENTITY,
    createKeyframe,
    createAnimation,
    createMotionLayer,
    validateMotionLayer,
} from './MotionSchema.js';

export {
    sampleAnimation,
    resolveMotionAt,
    resolvedToCSS,
} from './MotionResolver.js';

export {
    MOTION_PRESETS,
    PRESET_GROUPS,
    buildPreset,
    presetsForKind,
    LEGACY_ANIMATION_MAP,
} from './MotionPresets.js';

export {
    groupWordsIntoSegments,
    activeWordIndex,
    revealedWordCount,
    CAPTION_STYLE_PACKS,
    listStylePacks,
    stylePackToClipFields,
} from './CaptionModel.js';

export {
    clipToMotionLayer,
    motionLayerToClipUpdates,
    applyPresetToClip,
    trackToMotionLayers,
} from './ClipAdapter.js';

export {
    CUSTOM_ANIMATION_ID,
    MOTION_PARAM_DEFS,
    MOTION_PARAM_NAMES,
    animationsToParamTracks,
    paramTracksToAnimations,
    buildEditorModel,
    applyKeyframeOp,
} from './KeyframeBridge.js';

export {
    LEGACY_PACK_MOTION,
    legacyPackToCaptionStyle,
} from './CaptionModel.js';

export {
    COMPOSITION_PLAN_VERSION,
    GEOMETRY_SAMPLE_STEP,
    buildTimeMap,
    timelineToOutputTime,
    buildCompositionPlan,
    planIsNoOp,
    validateCompositionPlan,
    resolveCompositionAt,
    interpolateGeometry,
    simplifySamples,
} from './Compositor.js';

export {
    CAPTION_PROGRAM_VERSION,
    parseTextShadow,
    buildCaptionProgram,
    captionProgramIsNoOp,
    validateCaptionProgram,
} from './CaptionCompiler.js';

export {
    deriveZoomKeyframes,
    applyCameraMotionToBaseTrack,
} from './CameraMotionCompiler.js';

export {
    COMPONENT_IDS,
    COMPONENT_PRESETS,
    buildComponent,
} from './ComponentLibrary.js';

export {
    nextGroupId,
    assignGroupId,
    clipsInGroup,
    computeGroupMoveUpdates,
    computeGroupDuplicateSpecs,
} from './ClipGrouping.js';

export {
    LAYER_TARGETS,
    deriveSpeakerCrop,
    deriveTrackingSegments,
} from './ObjectLayers.js';
