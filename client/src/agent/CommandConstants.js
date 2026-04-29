/**
 * Command Constants
 * Shared definitions for intent types and operations.
 * Extracted to prevent circular dependencies.
 */

// Intent types - What the user wants to achieve
export const INTENT_TYPES = {
    EDIT: 'edit',
    CUT: 'cut',
    APPLY_EFFECT: 'apply_effect',
    EXPORT: 'export',
    COMPARE: 'compare',
    QUERY: 'query',
    UNDO: 'undo',
    REDO: 'redo',
    CREATIVE_EDIT: 'creative_edit',
    OPTIMIZE: 'optimize',

    // Long-Form Intelligence Engine
    ANALYZE: 'analyze',
    LONG_FORM_BUILD: 'long_form_build',
};

// Supported operations per intent
export const OPERATIONS = {
    // Edit operations
    ADD_CLIP: 'add_clip',
    SPLIT_CLIP: 'split_clip',
    REMOVE_CLIP: 'remove_clip',
    TRIM_CLIP: 'trim_clip',
    MOVE_CLIP: 'move_clip',
    DUPLICATE_CLIP: 'duplicate_clip',
    SET_CLIP_SPEED: 'set_clip_speed',
    SET_ASPECT_RATIO: 'set_aspect_ratio',
    SILENCE_REMOVAL: 'silence_removal',
    REMOVE_FILLER_WORDS: 'remove_filler_words',
    AUDIO_DENOISE: 'audio_denoise',
    NORMALIZE_AUDIO: 'normalize_audio',
    AUTO_CAPTIONS: 'auto_captions',
    APPLY_PRESET: 'apply_preset',

    // Cut operations
    CUT_AT_PLAYHEAD: 'cut_at_playhead',
    CUT_AT_TIMESTAMP: 'cut_at_timestamp',
    CUT_SEGMENT: 'cut_segment',

    // Effect operations
    ADD_TRANSITION: 'add_transition',
    APPLY_FILTER: 'apply_filter',
    ADD_FILTER: 'add_filter',
    ADD_TEXT: 'add_text',
    ADD_CAPTION: 'add_caption',
    ADD_TEXT_OVERLAY: 'add_text_overlay',
    SET_VOLUME: 'set_volume',
    ADJUST_VOLUME: 'adjust_volume',
    COLOR_GRADE: 'color_grade',

    // Export operations
    EXPORT_VIDEO: 'export_video',
    EXPORT_AUDIO: 'export_audio',
    EXPORT_THUMBNAIL: 'export_thumbnail',

    // Compare operations
    COMPARE_VERSIONS: 'compare_versions',
    PREVIEW_BEFORE_AFTER: 'preview_before_after',

    // Creative / Optimization operations (CRL)
    CREATIVE_ENHANCE: 'creative_enhance',
    PLATFORM_OPTIMIZE: 'platform_optimize',

    // Long-Form Intelligence Engine operations
    ANALYZE_STRUCTURE: 'analyze_structure',
    LONG_FORM_EDIT: 'long_form_edit',
    FIND_HOOK: 'find_hook',
    REMOVE_REPETITION: 'remove_repetition',
    BUILD_FROM_RUSHES: 'build_from_rushes',
    REORDER_SEGMENT: 'reorder_segment',
};

