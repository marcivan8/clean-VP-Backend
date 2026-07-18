'use strict';

/**
 * server/audio-engine/library/taxonomyMaps.js
 *
 * Keyword → intent/emotion/energy mappings used by QueryParser
 * to extract structured filters from natural language.
 *
 * Keys are lowercased n-grams; values are arrays of matching
 * EditingIntent, EmotionTag, or metadata primitives.
 */

const { EditingIntent, EmotionTag } = require('../types.js');

// ── SFX taxonomy ──────────────────────────────────────────────────────────────

/**
 * Maps NL keyword fragments → EditingIntent values for SFX.
 * Ordered by specificity (more specific entries first).
 *
 * @type {Record<string, string[]>}
 */
const SFX_INTENT_MAP = {
    // Hard cuts
    'hard cut':       [EditingIntent.HARD_CUT, EditingIntent.TRANSITION],
    'cut transition': [EditingIntent.HARD_CUT, EditingIntent.TRANSITION],
    'whoosh':         [EditingIntent.HARD_CUT, EditingIntent.TRANSITION, EditingIntent.ZOOM_OUT],
    'swipe':          [EditingIntent.HARD_CUT, EditingIntent.TRANSITION],
    // Zoom
    'zoom punch':     [EditingIntent.ZOOM_PUNCH, EditingIntent.ZOOM_IN],
    'zoom in':        [EditingIntent.ZOOM_IN, EditingIntent.ZOOM_PUNCH],
    'zoom out':       [EditingIntent.ZOOM_OUT, EditingIntent.TRANSITION],
    'punch':          [EditingIntent.ZOOM_PUNCH, EditingIntent.IMPACT],
    // Impact
    'impact':         [EditingIntent.IMPACT, EditingIntent.ACTION],
    'boom':           [EditingIntent.IMPACT, EditingIntent.DROP],
    'hit':            [EditingIntent.IMPACT, EditingIntent.GAMING_EVENT],
    // Comedy
    'comedy':         [EditingIntent.COMEDY, EditingIntent.COMEDY_MEME],
    'funny':          [EditingIntent.COMEDY, EditingIntent.COMEDY_MEME],
    'meme':           [EditingIntent.COMEDY_MEME, EditingIntent.COMEDY],
    'punchline':      [EditingIntent.PUNCHLINE, EditingIntent.COMEDY],
    'boing':          [EditingIntent.COMEDY, EditingIntent.PUNCHLINE],
    'vine boom':      [EditingIntent.COMEDY_MEME, EditingIntent.PUNCHLINE],
    'fail':           [EditingIntent.COMEDY, EditingIntent.PUNCHLINE],
    // Reveals
    'reveal':         [EditingIntent.REVEAL, EditingIntent.INTRO],
    'intro':          [EditingIntent.INTRO, EditingIntent.REVEAL],
    'sparkle':        [EditingIntent.REVEAL, EditingIntent.LUXURY],
    'power up':       [EditingIntent.REVEAL, EditingIntent.VICTORY, EditingIntent.GAMING_EVENT],
    // Suspense / buildup
    'suspense':       [EditingIntent.SUSPENSE, EditingIntent.BUILDUP],
    'tension':        [EditingIntent.SUSPENSE, EditingIntent.AMBIENT],
    'riser':          [EditingIntent.BUILDUP, EditingIntent.CINEMATIC],
    'buildup':        [EditingIntent.BUILDUP, EditingIntent.SUSPENSE],
    'drone':          [EditingIntent.AMBIENT, EditingIntent.SUSPENSE],
    // Victory
    'victory':        [EditingIntent.VICTORY, EditingIntent.MOTIVATION],
    'success':        [EditingIntent.VICTORY, EditingIntent.UI_FEEDBACK],
    'win':            [EditingIntent.VICTORY, EditingIntent.GAMING_EVENT],
    'fanfare':        [EditingIntent.VICTORY, EditingIntent.CINEMATIC],
    // Emotional
    'emotional':      [EditingIntent.EMOTIONAL_BEAT, EditingIntent.STORYTELLING],
    'emotional beat': [EditingIntent.EMOTIONAL_BEAT, EditingIntent.SOFT_CUT],
    'sad':            [EditingIntent.EMOTIONAL_BEAT, EditingIntent.STORYTELLING],
    // Foley
    'foley':          [EditingIntent.FOLEY, EditingIntent.STORYTELLING],
    'paper':          [EditingIntent.FOLEY, EditingIntent.EDUCATIONAL],
    'keyboard':       [EditingIntent.FOLEY, EditingIntent.TECHNOLOGY, EditingIntent.TEXT_ANIMATION],
    'typing':         [EditingIntent.TEXT_ANIMATION, EditingIntent.TECHNOLOGY],
    'camera click':   [EditingIntent.FASHION, EditingIntent.FOLEY],
    'shutter':        [EditingIntent.FASHION, EditingIntent.FOLEY],
    // Tech
    'tech':           [EditingIntent.TECHNOLOGY, EditingIntent.TECH],
    'beep':           [EditingIntent.TECHNOLOGY, EditingIntent.UI_FEEDBACK],
    'scan':           [EditingIntent.TECHNOLOGY, EditingIntent.REVEAL],
    // Social
    'social':         [EditingIntent.SOCIAL_MEDIA, EditingIntent.UI_FEEDBACK],
    'tiktok':         [EditingIntent.SOCIAL_MEDIA, EditingIntent.COMEDY_MEME],
    'notification':   [EditingIntent.SOCIAL_MEDIA, EditingIntent.UI_FEEDBACK],
    'like':           [EditingIntent.SOCIAL_MEDIA, EditingIntent.UI_FEEDBACK],
    // Gaming
    'gaming':         [EditingIntent.GAMING, EditingIntent.GAMING_EVENT],
    'game':           [EditingIntent.GAMING, EditingIntent.GAMING_EVENT],
    'level up':       [EditingIntent.GAMING_EVENT, EditingIntent.VICTORY],
    'kill':           [EditingIntent.GAMING_EVENT, EditingIntent.IMPACT],
    // Drop
    'bass drop':      [EditingIntent.DROP, EditingIntent.IMPACT],
    'drop':           [EditingIntent.DROP, EditingIntent.BUILDUP],
    // Ambient / nature
    'ambient':        [EditingIntent.AMBIENT, EditingIntent.NATURE],
    'nature':         [EditingIntent.NATURE, EditingIntent.AMBIENT],
    'wind':           [EditingIntent.NATURE, EditingIntent.TRAVEL],
    // Money / luxury
    'money':          [EditingIntent.MONEY, EditingIntent.LUXURY],
    'coin':           [EditingIntent.MONEY, EditingIntent.LUXURY],
    'gold':           [EditingIntent.MONEY, EditingIntent.LUXURY],
    // Podcast / interview
    'podcast':        [EditingIntent.PODCAST, EditingIntent.INTERVIEW],
    'interview':      [EditingIntent.INTERVIEW, EditingIntent.PODCAST],
    'speaker':        [EditingIntent.INTERVIEW, EditingIntent.PODCAST],
    // Text
    'text':           [EditingIntent.TEXT_ANIMATION, EditingIntent.UI_FEEDBACK],
    'caption':        [EditingIntent.TEXT_ANIMATION, EditingIntent.UI_FEEDBACK],
    'subtitle':       [EditingIntent.TEXT_ANIMATION],
    // Cinematic
    'cinematic':      [EditingIntent.CINEMATIC, EditingIntent.STORYTELLING],
    'stinger':        [EditingIntent.CINEMATIC, EditingIntent.IMPACT],
    'orchestral':     [EditingIntent.CINEMATIC, EditingIntent.EPIC],
    // Room tone / silence
    'room tone':      [EditingIntent.PODCAST, EditingIntent.AMBIENT],
    'silence':        [EditingIntent.PODCAST, EditingIntent.AMBIENT],
    // Guitar / acoustic
    'guitar':         [EditingIntent.EMOTIONAL_BEAT, EditingIntent.STORYTELLING],
    'acoustic':       [EditingIntent.EMOTIONAL_BEAT, EditingIntent.AMBIENT],
};

/**
 * Maps NL keyword fragments → EmotionTag values for SFX.
 *
 * @type {Record<string, string[]>}
 */
const SFX_EMOTION_MAP = {
    'epic':         [EmotionTag.EPIC, EmotionTag.DRAMATIC],
    'dramatic':     [EmotionTag.DRAMATIC, EmotionTag.CINEMATIC],
    'funny':        [EmotionTag.FUNNY, EmotionTag.PLAYFUL],
    'playful':      [EmotionTag.PLAYFUL, EmotionTag.CUTE],
    'cute':         [EmotionTag.CUTE, EmotionTag.PLAYFUL],
    'happy':        [EmotionTag.HAPPY, EmotionTag.ENERGETIC],
    'sad':          [EmotionTag.SAD, EmotionTag.EMOTIONAL],
    'emotional':    [EmotionTag.EMOTIONAL, EmotionTag.SAD],
    'tense':        [EmotionTag.TENSE, EmotionTag.MYSTERIOUS],
    'mysterious':   [EmotionTag.MYSTERIOUS, EmotionTag.DARK],
    'dark':         [EmotionTag.DARK, EmotionTag.TENSE],
    'horror':       [EmotionTag.DARK, EmotionTag.TENSE],
    'relaxed':      [EmotionTag.RELAXED, EmotionTag.CALM],
    'calm':         [EmotionTag.CALM, EmotionTag.PEACEFUL],
    'peaceful':     [EmotionTag.PEACEFUL, EmotionTag.CALM],
    'aggressive':   [EmotionTag.AGGRESSIVE, EmotionTag.ENERGETIC],
    'energetic':    [EmotionTag.ENERGETIC, EmotionTag.EPIC],
    'hype':         [EmotionTag.ENERGETIC, EmotionTag.EPIC],
    'warm':         [EmotionTag.WARM, EmotionTag.HOPEFUL],
    'cool':         [EmotionTag.COOL, EmotionTag.MODERN],
    'elegant':      [EmotionTag.ELEGANT, EmotionTag.LUXURIOUS],
    'luxury':       [EmotionTag.LUXURIOUS, EmotionTag.ELEGANT],
    'nostalgic':    [EmotionTag.NOSTALGIC, EmotionTag.WARM],
    'inspiring':    [EmotionTag.INSPIRATIONAL, EmotionTag.HOPEFUL],
    'motivational': [EmotionTag.INSPIRATIONAL, EmotionTag.CONFIDENT],
    'professional': [EmotionTag.PROFESSIONAL, EmotionTag.NEUTRAL],
    'polished':     [EmotionTag.POLISHED, EmotionTag.PROFESSIONAL],
    'raw':          [EmotionTag.RAW, EmotionTag.ENERGETIC],
};

// ── LUT taxonomy ──────────────────────────────────────────────────────────────

/**
 * Maps NL keyword fragments → LUT characteristics.
 * Values are { intents, emotions, warmthHint, contrastHint }.
 *
 * @type {Record<string, {intents: string[], emotions: string[], warmthHint?: number, contrastHint?: number}>}
 */
const LUT_KEYWORD_MAP = {
    'cinematic':        { intents: [EditingIntent.CINEMATIC],    emotions: [EmotionTag.CINEMATIC, EmotionTag.DRAMATIC] },
    'teal orange':      { intents: [EditingIntent.CINEMATIC],    emotions: [EmotionTag.CINEMATIC],    warmthHint: 2 },
    'warm':             { intents: [EditingIntent.TRAVEL, EditingIntent.LIFESTYLE],  emotions: [EmotionTag.WARM],  warmthHint: 3 },
    'golden':           { intents: [EditingIntent.TRAVEL],       emotions: [EmotionTag.WARM, EmotionTag.HOPEFUL], warmthHint: 4 },
    'cool':             { intents: [EditingIntent.MINIMAL, EditingIntent.CORPORATE], emotions: [EmotionTag.COOL],  warmthHint: -3 },
    'cold':             { intents: [EditingIntent.MINIMAL],      emotions: [EmotionTag.COOL, EmotionTag.TENSE],   warmthHint: -4 },
    'dark':             { intents: [EditingIntent.HORROR, EditingIntent.SUSPENSE],   emotions: [EmotionTag.DARK],  contrastHint: 3 },
    'moody':            { intents: [EditingIntent.STORYTELLING], emotions: [EmotionTag.DRAMATIC, EmotionTag.MYSTERIOUS] },
    'vintage':          { intents: [EditingIntent.STORYTELLING, EditingIntent.VLOG], emotions: [EmotionTag.NOSTALGIC, EmotionTag.VINTAGE] },
    'film':             { intents: [EditingIntent.CINEMATIC, EditingIntent.STORYTELLING], emotions: [EmotionTag.CINEMATIC, EmotionTag.RAW] },
    'faded':            { intents: [EditingIntent.VLOG, EditingIntent.LIFESTYLE],    emotions: [EmotionTag.NOSTALGIC, EmotionTag.VINTAGE] },
    'clean':            { intents: [EditingIntent.CORPORATE, EditingIntent.INTERVIEW], emotions: [EmotionTag.PROFESSIONAL, EmotionTag.NEUTRAL] },
    'corporate':        { intents: [EditingIntent.CORPORATE, EditingIntent.EDUCATIONAL], emotions: [EmotionTag.PROFESSIONAL] },
    'saturated':        { intents: [EditingIntent.SOCIAL_MEDIA, EditingIntent.FOOD], emotions: [EmotionTag.ENERGETIC, EmotionTag.HAPPY] },
    'punchy':           { intents: [EditingIntent.SOCIAL_MEDIA], emotions: [EmotionTag.ENERGETIC] },
    'vivid':            { intents: [EditingIntent.SOCIAL_MEDIA, EditingIntent.FOOD], emotions: [EmotionTag.HAPPY, EmotionTag.ENERGETIC] },
    'matte':            { intents: [EditingIntent.LUXURY, EditingIntent.FASHION],    emotions: [EmotionTag.ELEGANT, EmotionTag.MODERN] },
    'luxury':           { intents: [EditingIntent.LUXURY],       emotions: [EmotionTag.LUXURIOUS, EmotionTag.ELEGANT] },
    'horror':           { intents: [EditingIntent.HORROR],       emotions: [EmotionTag.DARK, EmotionTag.TENSE],   warmthHint: -4, contrastHint: 3 },
    'travel':           { intents: [EditingIntent.TRAVEL],       emotions: [EmotionTag.WARM, EmotionTag.HAPPY] },
    'sunset':           { intents: [EditingIntent.TRAVEL, EditingIntent.NATURE],     emotions: [EmotionTag.WARM],  warmthHint: 3 },
    'noir':             { intents: [EditingIntent.SUSPENSE, EditingIntent.DOCUMENTARY], emotions: [EmotionTag.DARK, EmotionTag.MYSTERIOUS] },
    'fashion':          { intents: [EditingIntent.FASHION],      emotions: [EmotionTag.ELEGANT, EmotionTag.MODERN] },
    'editorial':        { intents: [EditingIntent.FASHION, EditingIntent.LUXURY],    emotions: [EmotionTag.ELEGANT, EmotionTag.POLISHED] },
    'nordic':           { intents: [EditingIntent.MINIMAL],      emotions: [EmotionTag.COOL, EmotionTag.CALM],    warmthHint: -3 },
    'natural':          { intents: [EditingIntent.CORPORATE, EditingIntent.DOCUMENTARY], emotions: [EmotionTag.NEUTRAL] },
    'high contrast':    { intents: [EditingIntent.CINEMATIC, EditingIntent.DRAMA],   emotions: [EmotionTag.DRAMATIC], contrastHint: 3 },
    'low contrast':     { intents: [EditingIntent.LIFESTYLE, EditingIntent.VLOG],    emotions: [EmotionTag.WARM, EmotionTag.RELAXED], contrastHint: -2 },
    'social media':     { intents: [EditingIntent.SOCIAL_MEDIA], emotions: [EmotionTag.ENERGETIC, EmotionTag.PLAYFUL] },
};

// ── Preset taxonomy ───────────────────────────────────────────────────────────

/**
 * Maps NL keyword fragments → preset search characteristics.
 *
 * @type {Record<string, {intents: string[], types: string[]}>}
 */
const PRESET_KEYWORD_MAP = {
    'interview':       { intents: [EditingIntent.INTERVIEW, EditingIntent.PODCAST], types: ['FULL_EDIT', 'SOUND_SETTINGS', 'CAPTION_STYLE'] },
    'podcast':         { intents: [EditingIntent.PODCAST, EditingIntent.INTERVIEW], types: ['FULL_EDIT', 'SOUND_SETTINGS'] },
    'tiktok':          { intents: [EditingIntent.SOCIAL_MEDIA, EditingIntent.COMEDY_MEME], types: ['CAPTION_STYLE', 'COLOR_GRADE'] },
    'reels':           { intents: [EditingIntent.SOCIAL_MEDIA], types: ['CAPTION_STYLE', 'COLOR_GRADE', 'EXPORT_SETTINGS'] },
    'viral':           { intents: [EditingIntent.SOCIAL_MEDIA, EditingIntent.COMEDY_MEME], types: ['CAPTION_STYLE'] },
    'captions':        { intents: [EditingIntent.TYPOGRAPHY], types: ['CAPTION_STYLE'] },
    'subtitles':       { intents: [EditingIntent.TYPOGRAPHY], types: ['CAPTION_STYLE'] },
    'color grade':     { intents: [EditingIntent.COLOR_GRADE, EditingIntent.LOOK_DEVELOPMENT], types: ['COLOR_GRADE'] },
    'lut':             { intents: [EditingIntent.COLOR_GRADE], types: ['COLOR_GRADE'] },
    'grade':           { intents: [EditingIntent.COLOR_GRADE], types: ['COLOR_GRADE'] },
    'audio':           { intents: [EditingIntent.PODCAST], types: ['SOUND_SETTINGS'] },
    'sound':           { intents: [EditingIntent.PODCAST], types: ['SOUND_SETTINGS'] },
    'export':          { intents: [EditingIntent.WORKFLOW], types: ['EXPORT_SETTINGS'] },
    'youtube':         { intents: [EditingIntent.WORKFLOW], types: ['EXPORT_SETTINGS'] },
    'auto edit':       { intents: [EditingIntent.WORKFLOW], types: ['FULL_EDIT'] },
    'one tap':         { intents: [EditingIntent.WORKFLOW], types: ['FULL_EDIT'] },
    'full edit':       { intents: [EditingIntent.WORKFLOW], types: ['FULL_EDIT'] },
    'workflow':        { intents: [EditingIntent.WORKFLOW], types: ['FULL_EDIT'] },
    'music video':     { intents: [EditingIntent.ACTION, EditingIntent.SOCIAL_MEDIA], types: ['SOUND_SETTINGS', 'COLOR_GRADE'] },
    'cinematic':       { intents: [EditingIntent.CINEMATIC, EditingIntent.COLOR_GRADE], types: ['COLOR_GRADE'] },
};

// ── Energy level inference ────────────────────────────────────────────────────

/**
 * Maps keyword fragments → estimated energy level (1–5).
 * Used when no explicit energy is stated.
 *
 * @type {Record<string, number>}
 */
const ENERGY_KEYWORD_MAP = {
    'intense':      5,
    'hype':         5,
    'aggressive':   5,
    'action':       5,
    'epic':         4,
    'energetic':    4,
    'punchy':       4,
    'dramatic':     4,
    'impact':       4,
    'loud':         4,
    'moderate':     3,
    'medium':       3,
    'balanced':     3,
    'neutral':      3,
    'soft':         2,
    'gentle':       2,
    'subtle':       2,
    'calm':         2,
    'quiet':        1,
    'minimal':      1,
    'ambient':      1,
    'peaceful':     1,
    'whisper':      1,
};

module.exports = {
    SFX_INTENT_MAP,
    SFX_EMOTION_MAP,
    LUT_KEYWORD_MAP,
    PRESET_KEYWORD_MAP,
    ENERGY_KEYWORD_MAP,
};
