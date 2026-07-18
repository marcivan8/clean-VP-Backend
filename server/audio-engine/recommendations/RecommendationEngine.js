'use strict';

/**
 * server/audio-engine/recommendations/RecommendationEngine.js
 *
 * Contextual recommendation engine for SFX, LUT, and Presets.
 * Combines taxonomy search, user preferences, and project context
 * to produce ranked, non-blocking suggestions.
 *
 * Methods:
 *   recommendSFX(projectState, userId, opts)   — SFX suggestions
 *   recommendLUTs(projectState, userId, opts)  — LUT suggestions
 *   recommendPresets(projectState, userId, opts) — Preset suggestions
 *   recommendAll(projectState, userId, opts)   — all three, concurrent
 *
 * All methods return SearchResult[] and NEVER throw (return [] on error).
 * Callers must NOT await these on the critical request path —
 * use them inside non-blocking recommendation routes.
 */

const { AssetType, EditingIntent } = require('../types.js');
const { TaxonomyService }          = require('../search/TaxonomyService.js');
const { RankingEngine }            = require('../search/RankingEngine.js');
const { UserPreferenceEngine }     = require('../search/UserPreferenceEngine.js');
const { TimelineEventDetector }    = require('../timeline/TimelineEventDetector.js');
const { QueryParser }              = require('../search/QueryParser.js');

class RecommendationEngine {
    constructor() {
        this.taxonomy   = new TaxonomyService();
        this.ranker     = new RankingEngine();
        this.prefs      = new UserPreferenceEngine();
        this.detector   = new TimelineEventDetector();
        this.parser     = new QueryParser();
    }

    // ── SFX ───────────────────────────────────────────────────────────────────

    /**
     * Recommend SFX based on project context and recent timeline events.
     *
     * @param {Object}  projectState — timeline snapshot from useBrain/ContextEngine
     * @param {string}  [userId]
     * @param {Object}  [opts]
     * @param {number}  [opts.limit=5]
     * @param {string}  [opts.eventType] — specific TimelineEventType to drive recs
     * @returns {Promise<import('../types').SearchResult[]>}
     */
    async recommendSFX(projectState, userId = null, opts = {}) {
        const limit = opts.limit || 5;

        try {
            // Detect timeline events to use as context
            let eventType = opts.eventType || null;
            if (!eventType && projectState) {
                const events = this.detector.detect(projectState);
                // Most recent relevant event
                const recent = events
                    .filter(e => e.eventType !== 'CLIP_START')
                    .slice(-1)[0];
                eventType = recent?.eventType || null;
            }

            // Determine intents from project context
            const intents = this._inferIntentsFromProject(projectState);

            // Fetch candidates
            const [byEvent, byIntent] = await Promise.all([
                eventType ? this.taxonomy.getSFXByEvent(eventType, limit + 5) : Promise.resolve([]),
                intents.length ? this.taxonomy.getSFXByIntents(intents, limit + 5) : Promise.resolve([]),
            ]);

            // Merge and deduplicate
            const seen  = new Set();
            const candidates = [];
            for (const asset of [...byEvent, ...byIntent]) {
                const id = asset.id || asset.name;
                if (!seen.has(id)) { seen.add(id); candidates.push(asset); }
            }

            // Fetch user prefs for ranking
            const userPrefs = userId
                ? await this.prefs.getUserPrefs(userId, AssetType.SOUND_EFFECT)
                : null;

            // Build minimal query for ranking
            const query = {
                extractedIntent:  intents[0] || null,
                extractedEnergy:  this._inferEnergy(projectState),
                contextTimelineEvent: eventType,
                naturalLanguage:  '',
                _allIntents:      intents,
                _allEmotions:     [],
            };

            // Build rank entries (all from metadata pass = intentMatch score)
            const entries = candidates.map(asset => ({
                asset,
                scores: {
                    semanticSimilarity:  0,
                    intentMatch:         eventType && (asset.compatible_timeline_events || []).includes(eventType) ? 0.9 : 0.6,
                    emotionMatch:        0,
                    energyMatch:         0,
                    popularityScore:     0,
                    userPreferenceScore: 0,
                    contextScore:        eventType ? 0.8 : 0,
                },
                sources: new Set(['metadata']),
            }));

            return this.ranker.rank(entries, query, userPrefs).slice(0, limit);
        } catch (err) {
            console.error('[RecommendationEngine.recommendSFX]', err.message);
            return [];
        }
    }

    // ── LUTs ──────────────────────────────────────────────────────────────────

    /**
     * Recommend LUTs based on project context (platform, content type, emotion).
     *
     * @param {Object}  projectState
     * @param {string}  [userId]
     * @param {Object}  [opts]
     * @param {number}  [opts.limit=3]
     * @returns {Promise<import('../types').SearchResult[]>}
     */
    async recommendLUTs(projectState, userId = null, opts = {}) {
        const limit = opts.limit || 3;

        try {
            const intents = this._inferIntentsFromProject(projectState);

            // Build a LUT query from project platform/intent
            const platform = projectState?.platform || null;
            const queryText = [
                ...intents.slice(0, 3).map(i => i.toLowerCase().replace(/_/g, ' ')),
                platform ? `for ${platform}` : '',
            ].filter(Boolean).join(' ') || 'cinematic';

            const parsed = this.parser.parse(queryText, { forcedAssetType: AssetType.LUT });

            const luts = await this.taxonomy.getLUTsByIntents(intents, limit + 5);

            const userPrefs = userId
                ? await this.prefs.getUserPrefs(userId, AssetType.LUT)
                : null;

            const query = {
                extractedIntent: parsed.extractedIntent,
                extractedEnergy: null,
                contextTimelineEvent: null,
                naturalLanguage: queryText,
                _allIntents:     intents,
                _allEmotions:    [],
            };

            const entries = luts.map(asset => ({
                asset,
                scores: {
                    semanticSimilarity:  0,
                    intentMatch:         0.7,
                    emotionMatch:        0,
                    energyMatch:         0,
                    popularityScore:     0,
                    userPreferenceScore: 0,
                    contextScore:        0,
                },
                sources: new Set(['metadata']),
            }));

            return this.ranker.rank(entries, query, userPrefs).slice(0, limit);
        } catch (err) {
            console.error('[RecommendationEngine.recommendLUTs]', err.message);
            return [];
        }
    }

    // ── Presets ───────────────────────────────────────────────────────────────

    /**
     * Recommend Presets based on project state.
     *
     * @param {Object}  projectState
     * @param {string}  [userId]
     * @param {Object}  [opts]
     * @param {number}  [opts.limit=3]
     * @param {string}  [opts.presetType] — PresetType filter
     * @returns {Promise<import('../types').SearchResult[]>}
     */
    async recommendPresets(projectState, userId = null, opts = {}) {
        const limit      = opts.limit      || 3;
        const presetType = opts.presetType || null;

        try {
            const intents = this._inferIntentsFromProject(projectState);

            const presets = await this.taxonomy.getPresetsByIntents(
                intents.length ? intents : [EditingIntent.WORKFLOW],
                presetType,
                limit + 5
            );

            const userPrefs = userId
                ? await this.prefs.getUserPrefs(userId, AssetType.TEMPLATE)
                : null;

            const query = {
                extractedIntent: intents[0] || null,
                extractedEnergy: null,
                contextTimelineEvent: null,
                naturalLanguage: '',
                _allIntents:     intents,
                _allEmotions:    [],
            };

            const entries = presets.map(asset => ({
                asset,
                scores: {
                    semanticSimilarity:  0,
                    intentMatch:         0.75,
                    emotionMatch:        0,
                    energyMatch:         0,
                    popularityScore:     0,
                    userPreferenceScore: 0,
                    contextScore:        0,
                },
                sources: new Set(['metadata']),
            }));

            return this.ranker.rank(entries, query, userPrefs).slice(0, limit);
        } catch (err) {
            console.error('[RecommendationEngine.recommendPresets]', err.message);
            return [];
        }
    }

    // ── All three ─────────────────────────────────────────────────────────────

    /**
     * Run all three recommendation types concurrently.
     * Returns { sfx, luts, presets } — each is SearchResult[].
     *
     * @param {Object}  projectState
     * @param {string}  [userId]
     * @param {Object}  [opts]
     * @returns {Promise<{sfx: Object[], luts: Object[], presets: Object[]}>}
     */
    async recommendAll(projectState, userId = null, opts = {}) {
        const [sfx, luts, presets] = await Promise.all([
            this.recommendSFX(    projectState, userId, { ...opts, limit: opts.sfxLimit    || 5 }),
            this.recommendLUTs(   projectState, userId, { ...opts, limit: opts.lutLimit    || 3 }),
            this.recommendPresets(projectState, userId, { ...opts, limit: opts.presetLimit || 3 }),
        ]);
        return { sfx, luts, presets };
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /**
     * Infer EditingIntent values from project state signals.
     * @private
     */
    _inferIntentsFromProject(projectState) {
        if (!projectState) return [];
        const intents = new Set();

        // Platform-based hints
        const platform = projectState.platform || '';
        if (platform.includes('tiktok') || platform.includes('reels')) {
            intents.add(EditingIntent.SOCIAL_MEDIA);
        }
        if (platform.includes('youtube')) {
            intents.add(EditingIntent.WORKFLOW);
        }

        // Content cues from tracks
        const tracks = projectState.tracks || [];
        const hasCaptions = projectState.hasCaptions
            || tracks.some(t => t.type === 'text' && (t.clipCount || 0) > 0);
        const hasAudio    = projectState.hasMusicTrack
            || tracks.some(t => t.type === 'audio');

        if (hasCaptions) intents.add(EditingIntent.TEXT_ANIMATION);
        if (hasAudio)    intents.add(EditingIntent.AMBIENT);

        // Aspect ratio
        const ar = projectState.aspectRatio || '16:9';
        if (ar === '9:16') intents.add(EditingIntent.SOCIAL_MEDIA);
        if (ar === '1:1')  intents.add(EditingIntent.SOCIAL_MEDIA);

        // Duration hints
        const duration = projectState.duration || 0;
        if (duration > 600) intents.add(EditingIntent.DOCUMENTARY);  // >10 min
        if (duration < 60)  intents.add(EditingIntent.SOCIAL_MEDIA); // <1 min

        // Clip count
        const clipCount = projectState.clipCount || 0;
        if (clipCount > 20) intents.add(EditingIntent.HARD_CUT);
        if (clipCount <= 5) intents.add(EditingIntent.STORYTELLING);

        return [...intents];
    }

    /**
     * Infer energy level (1–5) from project signals.
     * @private
     */
    _inferEnergy(projectState) {
        if (!projectState) return 3;
        const platform = projectState.platform || '';
        if (platform.includes('tiktok') || platform.includes('reels')) return 4;
        if (platform.includes('podcast')) return 1;
        return 3;
    }
}

// Singleton
const recommendationEngine = new RecommendationEngine();
module.exports = { RecommendationEngine, recommendationEngine };
