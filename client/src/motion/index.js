/**
 * NOT MOUNTED TODAY (R165) — the BARREL is unused, the engine behind it is not.
 *
 * Nothing imports this file. Every consumer reaches into the modules directly
 * (`from '../motion/MotionResolver.js'` and so on), which is why the engine is
 * live while its front door is not: MotionResolver, LayerEffects, Scene3D,
 * VectorGraphics, TimeRemap, CameraMotionCompiler and the rest all reach AI
 * commands, Auto mode, the editor and the export.
 *
 * One module is reachable ONLY through this barrel and is therefore dead:
 * SpringPhysics.js (223 lines, tested by test_motion_springs.mjs).
 *
 * Keeping the barrel is harmless and it documents the engine's public surface.
 * Deleting it would strand SpringPhysics with no explanation, which is worse.
 */
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
 *     and export path (R62). Vector graphics and animated path morphs use the
 *     shared Canvas renderer in preview and the PNG-frame export renderer.
 *   • Camera presets (push/pull/punch-zoom/whip/shake) applied to a clip on
 *     the BASE video/image track now animate in the Revideo live preview
 *     (project.tsx `motionOffsets`), and scale-type presets (push/pull/
 *     punch-zoom) now reach the export too, via a derived
 *     `clip.keyframes.scale` fed through the existing zoompan path
 *     (CameraMotionCompiler.js — R64). Scale, pan, whip and shake tracks are
 *     sampled from the shared resolver into export keyframes.
 *   • Motion layers animate independent horizontal and vertical scale as well
 *     as uniform scale, with the same keyframes in preview and Revideo export.
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
    sampleStepForFps,
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

export {
    measureSingleLineWidth,
    measureTextBounds,
    fitTextToBox,
    computeAccentBounds,
} from './TextMeasurement.js';

export {
    SCENE_SCHEMA_VERSION,
    NODE_TYPES,
    OVERLAY_WIDTH_FRACTION,
    frameForAspect,
    createScene,
    createNode,
    createGroup,
    normalizeScene,
    migrateScene,
    walkScene,
    findNode,
    listNodes,
    updateNode,
    removeNode,
    addNode,
    composeTransform,
    resolveAbsoluteTransform,
    nodeBox,
    nodeLife,
    flattenScene,
    sceneFromPlacements,
    rootGroup,
    validateSceneShape,
} from './SceneSchema.js';

export {
    SEVERITY,
    ISSUE_CODES,
    safeZoneForAspect,
    contentRect,
    validateScene,
    autoFixScene,
    describeIssues,
} from './SceneValidator.js';

export {
    parseSvgPath,
    interpolateSvgPaths,
    drawSvgPath,
    drawRoundRect,
    drawPolygon,
    drawStar,
    drawArrow,
    drawCapsule,
    resolveGradient,
    applyShadow,
    setBlendMode,
    applyTrimPath,
    withClip,
    withAlphaMask,
    vectorMatteDataUrl,
    drawVectorGraphic,
    drawVectorFrame,
} from './VectorGraphics.js';

export {
    normalizeRuns,
    layoutRichText,
    sampleTypographyMotion,
    drawRichText,
    drawRichTextFrame,
} from './RichTextEngine.js';

export {
    SPRING_PRESETS as PHYSICS_SPRING_PRESETS,
    createSpring,
    estimateSpringSettlingTime,
    solveSpringAt,
    sampleSpringTrajectory,
    compileSpringKeyframes,
} from './SpringPhysics.js';

export {
    evaluateCubicBezier,
    evaluateCubicBezierDerivative,
    buildArcLengthLUT,
    pointsToBezierSpline,
    computeMotionBlur,
} from './SpatialMotion.js';

export { drawScene3D, normalizeScene3D, remapSceneObjectTime, maxSceneObjectSourceTime, sampleAudioEnvelope, SCENE3D_PRIMITIVES, getScene3DRenderLimitWarnings, getScene3DCompatibilityWarnings } from './Scene3D.js';
export { applyAudioReactiveMotion } from './AudioReactive.js';
export { sampleProceduralParticle, sampleProceduralParticles } from './ProceduralParticles.js';
export { evaluateMotionExpression, validateMotionExpression } from './MotionExpression.js';

export {
    topologicalSortNodes,
    resolvePinToEdge,
    computeLookAtRotation,
    resolveConstraints,
} from './ConstraintEngine.js';

export {
    DEPTH_LAYERS,
    SUBJECT_ANCHORS,
    deriveSubjectAnchors,
    isBehindSubject,
    partitionClipsByDepth,
    resolveSelectiveEffects,
} from './DepthCompositor.js';

export {
    VISUAL_PURPOSES,
    CADENCE_TIERS,
    classifyVisualPurpose,
    deriveCadenceTier,
    adaptArtDirection,
    auditMotionCoherence,
} from './ArtDirector.js';

export {
    VISUAL_TREATMENTS,
    SPEAKER_LAYOUTS,
    TRANSITION_PRESETS,
    analyzePacingNeed,
    decideVisualTreatment,
    decideSpeakerLayout,
    planTransitionStyling,
    generateStorytellingPlan,
} from './DirectorStoryteller.js';

export { drawLayerWithEffects } from './LayerEffects.js';

