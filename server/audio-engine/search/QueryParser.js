'use strict';

/**
 * server/audio-engine/search/QueryParser.js
 *
 * Type-aware natural language → structured SemanticSearchQuery.
 *
 * Parsing is purely local (regex + taxonomy maps) — zero network calls.
 * Fast enough to run synchronously for every search request.
 *
 * Rules:
 * - Asset type is inferred from explicit type keywords first,
 *   then from context (event type, intent clues).
 * - Multiple intents/emotions are accumulated (OR semantics).
 * - Energy level is inferred from explicit energy words.
 * - Duration is extracted in seconds from "under Xs", "about Xs", etc.
 * - Warmth/contrast hints from LUT_KEYWORD_MAP are used for LUT profile search.
 */

const { AssetType, EditingIntent, EmotionTag } = require('../types.js');
const {
    SFX_INTENT_MAP,
    SFX_EMOTION_MAP,
    LUT_KEYWORD_MAP,
    PRESET_KEYWORD_MAP,
    ENERGY_KEYWORD_MAP,
} = require('../library/taxonomyMaps.js');

// ── Explicit asset-type triggers ──────────────────────────────────────────────

const ASSET_TYPE_TRIGGERS = {
    [AssetType.SOUND_EFFECT]: [
        'sound effect', 'sfx', 'sound', 'audio effect', 'whoosh', 'boom',
        'boing', 'hit sound', 'transition sound', 'audio cue',
    ],
    [AssetType.LUT]: [
        'lut', 'color grade', 'colour grade', 'color look', 'colour look',
        'color filter', 'colour filter', 'grade', 'look', 'film look',
        'color preset', 'colour preset',
    ],
    [AssetType.TEMPLATE]: [
        'preset', 'template', 'workflow', 'auto edit', 'one tap',
        'full edit', 'caption preset', 'export preset', 'style preset',
    ],
};

// Regex patterns
const DURATION_PATTERN   = /(?:under|about|around|max|~)\s*(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?/i;
const DURATION_PATTERN2  = /(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)\s+(?:long|or\s+less|max)/i;
const LIMIT_PATTERN      = /(?:top|first|show\s+me|give\s+me)?\s*(\d+)\s+(?:results?|sounds?|luts?|presets?)/i;

class QueryParser {
    /**
     * Parse a natural language query into a SemanticSearchQuery.
     *
     * @param {string} naturalLanguage
     * @param {Object} [context]
     * @param {string} [context.eventType]      — TimelineEventType hint
     * @param {string} [context.forcedAssetType] — AssetType to force
     * @param {number} [context.defaultLimit]
     * @returns {import('../types').SemanticSearchQuery}
     */
    parse(naturalLanguage, context = {}) {
        const raw     = naturalLanguage || '';
        const lower   = raw.toLowerCase();
        const limit   = this._extractLimit(lower, context.defaultLimit || 20);

        // 1. Asset type
        const assetTypes = context.forcedAssetType
            ? [context.forcedAssetType]
            : this._detectAssetTypes(lower);

        // 2. Intents + emotions (accumulated across all types)
        const { intents, emotions, warmthHint, contrastHint } =
            this._extractSemantic(lower, assetTypes);

        // 3. Energy
        const energy = this._extractEnergy(lower);

        // 4. Duration
        const duration = this._extractDuration(lower);

        // 5. LUT profile hints
        const warmthRange = (warmthHint !== null)
            ? { min: warmthHint - 1.5, max: warmthHint + 1.5 }
            : null;

        // 6. Preset type filter
        const presetTypeFilter = this._extractPresetType(lower, assetTypes);

        // 7. Platform
        const platformFilter = this._extractPlatform(lower);

        // 8. Content type
        const contentTypeFilter = this._extractContentType(lower);

        return {
            naturalLanguage: raw,
            extractedIntent:  intents[0]  || null,
            extractedEmotion: emotions[0] || null,
            extractedEnergy:  energy,
            extractedDuration: duration,
            assetTypes,
            limit,
            contextClipId:        context.clipId       || null,
            contextTimelineEvent: context.eventType    || null,
            warmthRange,
            contentTypeFilter,
            platformFilter,
            // Extended — used internally
            _allIntents:       intents,
            _allEmotions:      emotions,
            _presetTypeFilter: presetTypeFilter,
            _warmthHint:       warmthHint,
            _contrastHint:     contrastHint,
        };
    }

    // ── Private ───────────────────────────────────────────────────────────────

    /**
     * Detect which asset types are mentioned in the query.
     * Returns [SOUND_EFFECT] if no type cue found (default for SFX searches).
     * @private
     */
    _detectAssetTypes(lower) {
        const found = [];

        for (const [type, keywords] of Object.entries(ASSET_TYPE_TRIGGERS)) {
            if (keywords.some(kw => lower.includes(kw))) {
                found.push(type);
            }
        }

        // If nothing detected, check for LUT visual terms
        if (found.length === 0) {
            const lutCues = Object.keys(LUT_KEYWORD_MAP);
            const isLutQuery = lutCues.some(kw => lower.includes(kw));
            if (isLutQuery) {
                found.push(AssetType.LUT);
            }
        }

        // Default to SOUND_EFFECT if still nothing
        return found.length > 0 ? [...new Set(found)] : [AssetType.SOUND_EFFECT];
    }

    /**
     * Extract intents, emotions, and LUT profile hints.
     * @private
     */
    _extractSemantic(lower, assetTypes) {
        const intentSet   = new Set();
        const emotionSet  = new Set();
        let warmthHint   = null;
        let contrastHint = null;

        const isLUT    = assetTypes.includes(AssetType.LUT);
        const isPreset = assetTypes.includes(AssetType.TEMPLATE);

        // SFX intent scan
        if (!isLUT) {
            for (const [kw, intents] of Object.entries(SFX_INTENT_MAP)) {
                if (lower.includes(kw)) {
                    intents.forEach(i => intentSet.add(i));
                }
            }
        }

        // SFX emotion scan
        for (const [kw, emotions] of Object.entries(SFX_EMOTION_MAP)) {
            if (lower.includes(kw)) {
                emotions.forEach(e => emotionSet.add(e));
            }
        }

        // LUT keyword scan (also extracts warmth/contrast hints)
        if (isLUT || (!isPreset && intentSet.size === 0)) {
            for (const [kw, info] of Object.entries(LUT_KEYWORD_MAP)) {
                if (lower.includes(kw)) {
                    (info.intents || []).forEach(i => intentSet.add(i));
                    (info.emotions || []).forEach(e => emotionSet.add(e));
                    if (info.warmthHint   !== undefined) warmthHint   = info.warmthHint;
                    if (info.contrastHint !== undefined) contrastHint = info.contrastHint;
                }
            }
        }

        // Preset keyword scan
        if (isPreset || intentSet.size === 0) {
            for (const [kw, info] of Object.entries(PRESET_KEYWORD_MAP)) {
                if (lower.includes(kw)) {
                    (info.intents || []).forEach(i => intentSet.add(i));
                }
            }
        }

        return {
            intents:     [...intentSet],
            emotions:    [...emotionSet],
            warmthHint,
            contrastHint,
        };
    }

    /**
     * Extract energy level from keywords (returns null if not found).
     * @private
     */
    _extractEnergy(lower) {
        // Explicit numeric: "energy 3", "energy level 4"
        const numMatch = lower.match(/energy(?:\s+level)?\s+([1-5])/i);
        if (numMatch) return parseInt(numMatch[1], 10);

        // Keyword scan — highest matching energy wins
        let maxEnergy = null;
        for (const [kw, level] of Object.entries(ENERGY_KEYWORD_MAP)) {
            if (lower.includes(kw)) {
                if (maxEnergy === null || level > maxEnergy) {
                    maxEnergy = level;
                }
            }
        }
        return maxEnergy;
    }

    /**
     * Extract max duration in seconds.
     * @private
     */
    _extractDuration(lower) {
        let m = DURATION_PATTERN.exec(lower);
        if (!m) m = DURATION_PATTERN2.exec(lower);
        if (m) return parseFloat(m[1]);
        return null;
    }

    /**
     * Extract result limit.
     * @private
     */
    _extractLimit(lower, defaultLimit) {
        const m = LIMIT_PATTERN.exec(lower);
        if (m) {
            const n = parseInt(m[1], 10);
            return isNaN(n) ? defaultLimit : Math.min(n, 50);
        }
        return defaultLimit;
    }

    /**
     * Extract target platform from query.
     * @private
     */
    _extractPlatform(lower) {
        if (lower.includes('tiktok'))     return 'tiktok';
        if (lower.includes('instagram'))  return 'instagram';
        if (lower.includes('youtube'))    return 'youtube';
        if (lower.includes('linkedin'))   return 'linkedin';
        if (lower.includes('reels'))      return 'instagram';
        if (lower.includes('shorts'))     return 'youtube';
        if (lower.includes('twitter') || lower.includes('x.com')) return 'twitter';
        return null;
    }

    /**
     * Extract content type from query.
     * @private
     */
    _extractContentType(lower) {
        if (lower.includes('interview'))    return 'interview';
        if (lower.includes('podcast'))      return 'podcast';
        if (lower.includes('documentary'))  return 'documentary';
        if (lower.includes('vlog'))         return 'vlog';
        if (lower.includes('gaming'))       return 'gaming';
        if (lower.includes('food'))         return 'food';
        if (lower.includes('travel'))       return 'travel';
        if (lower.includes('fashion'))      return 'fashion';
        if (lower.includes('music video'))  return 'music-video';
        if (lower.includes('corporate'))    return 'corporate';
        if (lower.includes('horror'))       return 'horror';
        return null;
    }

    /**
     * Extract a PresetType filter when the query is for a preset.
     * @private
     */
    _extractPresetType(lower, assetTypes) {
        if (!assetTypes.includes(AssetType.TEMPLATE)) return null;

        const { PresetType } = require('../types.js');
        if (lower.includes('color') || lower.includes('colour') || lower.includes('lut') || lower.includes('grade')) return PresetType.COLOR_GRADE;
        if (lower.includes('caption') || lower.includes('subtitle') || lower.includes('text style')) return PresetType.CAPTION_STYLE;
        if (lower.includes('transition')) return PresetType.TRANSITION;
        if (lower.includes('sound') || lower.includes('audio') || lower.includes('mix')) return PresetType.SOUND_SETTINGS;
        if (lower.includes('export')) return PresetType.EXPORT_SETTINGS;
        if (lower.includes('full edit') || lower.includes('auto edit') || lower.includes('one tap') || lower.includes('workflow')) return PresetType.FULL_EDIT;
        return null;
    }
}

module.exports = { QueryParser };
