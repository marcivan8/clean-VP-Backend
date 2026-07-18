/**
 * server/audio-engine/types.js
 *
 * Shared typedefs for the Creative Asset Intelligence System.
 * No runtime logic — pure JSDoc + enum constants.
 *
 * Covers: SFX, LUT, Presets, Audio Export, Timeline Events.
 */

'use strict';

// ── AssetType enum ────────────────────────────────────────────────────────────
const AssetType = Object.freeze({
    SOUND_EFFECT:   'SOUND_EFFECT',
    MUSIC:          'MUSIC',
    ANIMATION:      'ANIMATION',
    TRANSITION:     'TRANSITION',
    MOTION_GRAPHIC: 'MOTION_GRAPHIC',
    LUT:            'LUT',
    TEMPLATE:       'TEMPLATE',
    STICKER:        'STICKER',
    FONT:           'FONT',
    PLUGIN:         'PLUGIN',
});

// ── EnergyLevel enum (1–5) ────────────────────────────────────────────────────
const EnergyLevel = Object.freeze({ 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 });

// ── EditingIntent enum ────────────────────────────────────────────────────────
const EditingIntent = Object.freeze({
    TRANSITION:       'TRANSITION',
    REVEAL:           'REVEAL',
    COMEDY:           'COMEDY',
    IMPACT:           'IMPACT',
    MOVEMENT:         'MOVEMENT',
    ZOOM_IN:          'ZOOM_IN',
    ZOOM_OUT:         'ZOOM_OUT',
    TEXT_ANIMATION:   'TEXT_ANIMATION',
    ACTION:           'ACTION',
    VICTORY:          'VICTORY',
    SUSPENSE:         'SUSPENSE',
    LUXURY:           'LUXURY',
    MINIMAL:          'MINIMAL',
    CORPORATE:        'CORPORATE',
    EDUCATIONAL:      'EDUCATIONAL',
    GAMING:           'GAMING',
    TECHNOLOGY:       'TECHNOLOGY',
    NATURE:           'NATURE',
    TRAVEL:           'TRAVEL',
    FOOD:             'FOOD',
    PODCAST:          'PODCAST',
    DOCUMENTARY:      'DOCUMENTARY',
    STORYTELLING:     'STORYTELLING',
    FASHION:          'FASHION',
    LIFESTYLE:        'LIFESTYLE',
    NEWS:             'NEWS',
    INTERVIEW:        'INTERVIEW',
    MOTIVATION:       'MOTIVATION',
    EMOTION:          'EMOTION',
    CHILDREN:         'CHILDREN',
    HORROR:           'HORROR',
    ROMANCE:          'ROMANCE',
    CINEMATIC:        'CINEMATIC',
    EMPHASIS:         'EMPHASIS',
    AMBIENT:          'AMBIENT',
    UI_FEEDBACK:      'UI_FEEDBACK',
    SOCIAL_MEDIA:     'SOCIAL_MEDIA',
    FOLEY:            'FOLEY',
    COMEDY_MEME:      'COMEDY_MEME',
    HARD_CUT:         'HARD_CUT',
    SOFT_CUT:         'SOFT_CUT',
    ZOOM_PUNCH:       'ZOOM_PUNCH',
    PUNCHLINE:        'PUNCHLINE',
    EMOTIONAL_BEAT:   'EMOTIONAL_BEAT',
    SCENE_CHANGE:     'SCENE_CHANGE',
    INTRO:            'INTRO',
    OUTRO:            'OUTRO',
    BUILDUP:          'BUILDUP',
    DROP:             'DROP',
    CAMERA_ACTION:    'CAMERA_ACTION',
    TECH:             'TECH',
    MONEY:            'MONEY',
    GAMING_EVENT:     'GAMING_EVENT',
    COLOR_GRADE:      'COLOR_GRADE',
    LOOK_DEVELOPMENT: 'LOOK_DEVELOPMENT',
    TYPOGRAPHY:       'TYPOGRAPHY',
    BRANDING:         'BRANDING',
    WORKFLOW:         'WORKFLOW',
    VLOG:             'VLOG',
});

// ── EmotionTag enum ───────────────────────────────────────────────────────────
const EmotionTag = Object.freeze({
    HAPPY:          'HAPPY',
    EPIC:           'EPIC',
    SERIOUS:        'SERIOUS',
    PROFESSIONAL:   'PROFESSIONAL',
    FUNNY:          'FUNNY',
    CUTE:           'CUTE',
    EMOTIONAL:      'EMOTIONAL',
    DARK:           'DARK',
    HOPEFUL:        'HOPEFUL',
    SAD:            'SAD',
    TENSE:          'TENSE',
    RELAXED:        'RELAXED',
    AGGRESSIVE:     'AGGRESSIVE',
    PEACEFUL:       'PEACEFUL',
    ELEGANT:        'ELEGANT',
    LUXURIOUS:      'LUXURIOUS',
    MODERN:         'MODERN',
    VINTAGE:        'VINTAGE',
    PLAYFUL:        'PLAYFUL',
    MYSTERIOUS:     'MYSTERIOUS',
    CONFIDENT:      'CONFIDENT',
    NOSTALGIC:      'NOSTALGIC',
    ENERGETIC:      'ENERGETIC',
    CALM:           'CALM',
    DRAMATIC:       'DRAMATIC',
    INSPIRATIONAL:  'INSPIRATIONAL',
    WARM:           'WARM',
    COOL:           'COOL',
    NEUTRAL:        'NEUTRAL',
    CINEMATIC:      'CINEMATIC',
    RAW:            'RAW',
    POLISHED:       'POLISHED',
});

// ── TimelineEventType enum ────────────────────────────────────────────────────
const TimelineEventType = Object.freeze({
    HARD_CUT:               'HARD_CUT',
    SOFT_CUT:               'SOFT_CUT',
    ZOOM_IN:                'ZOOM_IN',
    ZOOM_OUT:               'ZOOM_OUT',
    TRANSITION_ADDED:       'TRANSITION_ADDED',
    TEXT_APPEARS:           'TEXT_APPEARS',
    TEXT_DISAPPEARS:        'TEXT_DISAPPEARS',
    CAPTION_APPEARS:        'CAPTION_APPEARS',
    AUDIO_PEAK:             'AUDIO_PEAK',
    SILENCE_START:          'SILENCE_START',
    SILENCE_END:            'SILENCE_END',
    PUNCHLINE_DETECTED:     'PUNCHLINE_DETECTED',
    EMOTIONAL_BEAT:         'EMOTIONAL_BEAT',
    SCENE_CHANGE:           'SCENE_CHANGE',
    CHAPTER_START:          'CHAPTER_START',
    SPEAKER_CHANGE:         'SPEAKER_CHANGE',
    B_ROLL_START:           'B_ROLL_START',
    B_ROLL_END:             'B_ROLL_END',
    REVEAL:                 'REVEAL',
    EMPHASIS_MOMENT:        'EMPHASIS_MOMENT',
    CLIP_START:             'CLIP_START',
    CLIP_END:               'CLIP_END',
    LUT_APPLIED:            'LUT_APPLIED',
    PRESET_APPLIED:         'PRESET_APPLIED',
    COLOR_GRADE_CHANGED:    'COLOR_GRADE_CHANGED',
});

// ── PresetType enum ───────────────────────────────────────────────────────────
const PresetType = Object.freeze({
    COLOR_GRADE:     'COLOR_GRADE',
    CAPTION_STYLE:   'CAPTION_STYLE',
    TRANSITION:      'TRANSITION',
    SOUND_SETTINGS:  'SOUND_SETTINGS',
    EXPORT_SETTINGS: 'EXPORT_SETTINGS',
    FULL_EDIT:       'FULL_EDIT',
});

/**
 * @typedef {Object} BaseAsset
 * @property {string}   id
 * @property {string}   type               - AssetType value
 * @property {string}   name               - slug / internal key
 * @property {string}   displayName
 * @property {string}   description
 * @property {string|null} gcsPath
 * @property {string|null} previewUrl
 * @property {string|null} thumbnailUrl
 * @property {number|null} duration         - null for LUTs, fonts
 * @property {number|null} fileSize
 * @property {string|null} mimeType
 * @property {'royalty_free'|'creative_commons'|'vibed_exclusive'} license
 * @property {string|null} creator
 * @property {string|null} pack
 * @property {string[]}  editingIntents    - EditingIntent values
 * @property {string[]}  emotionTags       - EmotionTag values
 * @property {number}    energyLevel       - 1–5
 * @property {string[]}  style
 * @property {string[]}  searchKeywords
 * @property {string[]}  bestUseCases
 * @property {string|null} category
 * @property {string|null} subCategory
 * @property {number[]|null} embedding     - 1536-dim vector
 * @property {Date|null} embeddingGeneratedAt
 * @property {number}    useCount
 * @property {number}    favoriteCount
 * @property {Date|null} lastUsedAt
 * @property {boolean}   isSystem
 * @property {boolean}   isActive
 * @property {Date}      createdAt
 * @property {Date}      updatedAt
 */

/**
 * @typedef {BaseAsset & Object} SoundEffectAsset
 * @property {number}    loudnessLUFS
 * @property {number}    peakDB
 * @property {number}    sampleRate
 * @property {number}    channels
 * @property {number}    bitDepth
 * @property {boolean}   hasAttack
 * @property {boolean}   hasRelease
 * @property {boolean}   isTonal
 * @property {boolean}   isPitchable
 * @property {number}    recommendedVolume      - 0.0–1.0
 * @property {number}    recommendedFadeIn      - ms
 * @property {number}    recommendedFadeOut     - ms
 * @property {number}    offsetFromEvent        - ms (negative=before)
 * @property {'on_event'|'before_event'|'after_event'|'during'} placementStrategy
 * @property {string[]}  similarSoundIds
 * @property {string[]}  complementarySoundIds
 * @property {string[]}  compatibleTimelineEvents - TimelineEventType values
 */

/**
 * @typedef {BaseAsset & Object} LUTAsset
 * @property {'cube'|'3dl'|'lut'|'mga'} format
 * @property {17|33|65}  dimensions
 * @property {'rec709'|'rec2020'|'p3'|'log'|'srgb'} colorSpace
 * @property {string}    inputColorSpace
 * @property {string}    outputColorSpace
 * @property {number}    warmth        - -5 to 5 (negative=cool, positive=warm)
 * @property {number}    contrast      - -5 to 5
 * @property {number}    saturation    - -5 to 5
 * @property {number}    highlights    - -5 to 5
 * @property {number}    shadows       - -5 to 5
 * @property {boolean}   cinematic
 * @property {string}    cssFilterPreview  - NEVER null; CSS filter string for instant preview
 * @property {string[]}  suitableContentTypes
 * @property {string[]}  suitableLightingConditions
 * @property {string[]}  platformSuggestions
 * @property {string[]}  pairsWith
 * @property {string}    ffmpegFilter   - built at apply time: lut3d=file.cube
 */

/**
 * @typedef {Object} ColorGradeSettings
 * @property {string|null} lutId
 * @property {number}  brightness
 * @property {number}  contrast
 * @property {number}  saturation
 * @property {number}  hueRotate
 * @property {number}  highlights
 * @property {number}  shadows
 * @property {number}  temperature
 * @property {number}  tint
 */

/**
 * @typedef {Object} CaptionStyleSettings
 * @property {string}  fontFamily
 * @property {number}  fontSize
 * @property {number}  fontWeight
 * @property {string}  color
 * @property {string}  backgroundColor
 * @property {string}  position
 * @property {string}  animation
 * @property {string}  shadowColor
 * @property {number}  shadowBlur
 * @property {number}  letterSpacing
 * @property {number}  lineHeight
 * @property {string}  textTransform
 * @property {number}  borderRadius
 * @property {number}  padding
 */

/**
 * @typedef {Object} TransitionSettings
 * @property {string}  type
 * @property {number}  duration
 * @property {string}  easing
 * @property {string}  direction
 */

/**
 * @typedef {Object} SoundSettings
 * @property {number}  musicVolume
 * @property {number}  voiceVolume
 * @property {number}  sfxVolume
 * @property {boolean} normalizeLoudness
 * @property {number}  targetLUFS
 * @property {'off'|'light'|'medium'|'heavy'} denoiseLevel
 * @property {boolean} removeRoomTone
 */

/**
 * @typedef {Object} ExportSettings
 * @property {'720p'|'1080p'|'2k'|'4k'} resolution
 * @property {24|25|30|60} fps
 * @property {'low'|'medium'|'high'|'maximum'} bitrate
 * @property {'mp4'|'mov'|'webm'} format
 * @property {string|null} aspectRatio
 * @property {string|null} platform
 * @property {'aac'|'mp3'} audioFormat
 * @property {'low'|'medium'|'high'} audioQuality
 */

/**
 * @typedef {Object} FullEditSettings
 * @property {boolean} removeSilences
 * @property {boolean} removeFillers
 * @property {boolean} normalizeAudio
 * @property {ColorGradeSettings|null} colorGrade
 * @property {CaptionStyleSettings|null} captionStyle
 * @property {SoundSettings|null} soundSettings
 * @property {boolean} addZoom
 * @property {string|null} targetPlatform
 * @property {number|null} targetDuration
 */

/**
 * @typedef {Object} PresetCommand
 * @property {number}  order
 * @property {string}  action       - Vibed command string
 * @property {Object}  args
 * @property {string}  label        - shown during execution
 * @property {boolean} skipIfFailed
 */

/**
 * @typedef {Object} PresetAsset
 * @property {string}        presetType   - PresetType value
 * @property {ColorGradeSettings|CaptionStyleSettings|TransitionSettings|SoundSettings|ExportSettings|FullEditSettings} settings
 * @property {boolean}       isPublic
 * @property {number}        useCount
 * @property {number}        savedCount
 * @property {PresetCommand[]|null} commandSequence - For FULL_EDIT only
 */

/**
 * @typedef {Object} SemanticSearchQuery
 * @property {string}       naturalLanguage
 * @property {string|null}  extractedIntent
 * @property {string|null}  extractedEmotion
 * @property {number|null}  extractedEnergy
 * @property {number|null}  extractedDuration
 * @property {string[]}     assetTypes         - AssetType values
 * @property {number}       limit
 * @property {string|null}  contextClipId
 * @property {string|null}  contextTimelineEvent
 * @property {{min:number,max:number}|null} warmthRange
 * @property {string|null}  contentTypeFilter
 * @property {string|null}  platformFilter
 */

/**
 * @typedef {Object} SearchResult
 * @property {BaseAsset}  asset
 * @property {number}     score
 * @property {{
 *   semanticSimilarity: number,
 *   intentMatch: number,
 *   emotionMatch: number,
 *   energyMatch: number,
 *   popularityScore: number,
 *   userPreferenceScore: number,
 *   contextScore: number,
 * }} scoreBreakdown
 * @property {string}     reasoning
 * @property {{
 *   suggestedTime: number|null,
 *   suggestedVolume: number|null,
 *   suggestedFadeIn: number|null,
 *   suggestedFadeOut: number|null,
 * }} placement
 */

/**
 * @typedef {Object} AudioExportOptions
 * @property {'mp3'|'wav'|'aac'|'m4a'} format
 * @property {'low'|'medium'|'high'}    quality
 * @property {44100|48000}              sampleRate
 * @property {1|2}                      channels
 * @property {boolean}                  normalize
 * @property {number|null}              targetLUFS
 * @property {boolean}                  includeMusic
 * @property {boolean}                  includeSFX
 * @property {boolean}                  includeVoice
 * @property {boolean}                  trimSilenceEnds
 */

module.exports = {
    AssetType,
    EnergyLevel,
    EditingIntent,
    EmotionTag,
    TimelineEventType,
    PresetType,
};
