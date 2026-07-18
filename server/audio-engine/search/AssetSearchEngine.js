'use strict';

/**
 * server/audio-engine/search/AssetSearchEngine.js
 *
 * ONE search engine for ALL asset types (SFX, LUT, Preset).
 * Type filtering is handled internally via SemanticSearchQuery.assetTypes.
 *
 * THREE-PASS search:
 *   Pass 1 — Metadata (taxonomy, intents, energy, duration filters)
 *   Pass 2 — Embedding (vector cosine via pgvector RPC)
 *   Pass 3 — Context / Event (TimelineEventType compatible assets)
 *
 * Results are merged and re-ranked by RankingEngine.
 * Max latency target: 300ms (passes run concurrently where possible).
 */

const { supabaseAdmin } = require('../../../config/database.js');
const { TaxonomyService } = require('./TaxonomyService.js');
const { RankingEngine }   = require('./RankingEngine.js');
const { embeddingService } = require('../embeddings/EmbeddingService.js');
const { AssetType }        = require('../types.js');

const DEFAULT_LIMIT = 20;

class AssetSearchEngine {
    constructor() {
        this.taxonomy = new TaxonomyService();
        this.ranker   = new RankingEngine();
    }

    /**
     * Main search entry point.
     *
     * @param {import('../types').SemanticSearchQuery} query
     * @param {Object} [opts]
     * @param {string} [opts.userId]      — for personalisation
     * @param {Object} [opts.userPrefs]   — UserPreferenceEngine profile
     * @returns {Promise<import('../types').SearchResult[]>}
     */
    async search(query, opts = {}) {
        const limit = query.limit || DEFAULT_LIMIT;
        const types = query.assetTypes || [AssetType.SOUND_EFFECT];

        // Run all three passes concurrently
        const [metaResults, embeddingResults, contextResults] = await Promise.all([
            this._passMetadata(query, types),
            this._passEmbedding(query, types),
            this._passContext(query),
        ]);

        // Merge — deduplicate by asset id, accumulate scores
        const merged = this._merge(metaResults, embeddingResults, contextResults, query);

        // Rank + personalise
        const ranked = this.ranker.rank(merged, query, opts.userPrefs || null);

        return ranked.slice(0, limit);
    }

    // ── Pass 1: Metadata ──────────────────────────────────────────────────────

    /**
     * @private
     */
    async _passMetadata(query, types) {
        const results = [];

        for (const type of types) {
            try {
                if (type === AssetType.SOUND_EFFECT) {
                    const intents = query._allIntents?.length
                        ? query._allIntents
                        : (query.extractedIntent ? [query.extractedIntent] : []);

                    if (intents.length > 0) {
                        const assets = await this.taxonomy.getSFXByIntents(intents, 30);
                        assets.forEach(a => results.push({ asset: a, source: 'metadata', intentMatch: 0.8 }));
                    }
                } else if (type === AssetType.LUT) {
                    const intents = query._allIntents?.length
                        ? query._allIntents
                        : (query.extractedIntent ? [query.extractedIntent] : []);

                    // Try profile-based first
                    if (query.warmthRange) {
                        const luts = await this.taxonomy.getLUTsByProfile({
                            warmthMin:  query.warmthRange.min,
                            warmthMax:  query.warmthRange.max,
                        }, 15);
                        luts.forEach(a => results.push({ asset: a, source: 'metadata', intentMatch: 0.7 }));
                    }

                    if (intents.length > 0) {
                        const luts = await this.taxonomy.getLUTsByIntents(intents, 15);
                        luts.forEach(a => results.push({ asset: a, source: 'metadata', intentMatch: 0.75 }));
                    }
                } else if (type === AssetType.TEMPLATE) {
                    const intents = query._allIntents?.length
                        ? query._allIntents
                        : (query.extractedIntent ? [query.extractedIntent] : []);

                    const presets = await this.taxonomy.getPresetsByIntents(
                        intents,
                        query._presetTypeFilter || null,
                        15
                    );
                    presets.forEach(a => results.push({ asset: a, source: 'metadata', intentMatch: 0.75 }));
                }
            } catch (err) {
                console.error(`[AssetSearchEngine._passMetadata] type=${type}`, err.message);
            }
        }

        return results;
    }

    // ── Pass 2: Embedding ─────────────────────────────────────────────────────

    /**
     * @private
     */
    async _passEmbedding(query, types) {
        if (!query.naturalLanguage?.trim()) return [];

        try {
            const typeFilter = types.length === 1 ? types[0] : null;
            const hits = await embeddingService.searchBySimilarity(
                query.naturalLanguage,
                {
                    assetTypeFilter: typeFilter,
                    limit:           30,
                    minSimilarity:   0.55,
                }
            );

            return hits.map(h => ({
                asset: { id: h.id, type: h.type, name: h.name, display_name: h.display_name },
                source:   'embedding',
                similarity: h.similarity,
            }));
        } catch (err) {
            console.error('[AssetSearchEngine._passEmbedding]', err.message);
            return [];
        }
    }

    // ── Pass 3: Context / Event ───────────────────────────────────────────────

    /**
     * @private
     */
    async _passContext(query) {
        if (!query.contextTimelineEvent) return [];

        try {
            const assets = await this.taxonomy.getSFXByEvent(query.contextTimelineEvent, 10);
            return assets.map(a => ({ asset: a, source: 'context', contextScore: 0.9 }));
        } catch (err) {
            console.error('[AssetSearchEngine._passContext]', err.message);
            return [];
        }
    }

    // ── Merge ─────────────────────────────────────────────────────────────────

    /**
     * Deduplicate by asset.id, accumulate pass-specific scores.
     * @private
     */
    _merge(meta, embedding, context, query) {
        /** @type {Map<string, Object>} */
        const map = new Map();

        const add = (item, passKey, score) => {
            const id = item.asset?.id;
            if (!id) return;

            if (!map.has(id)) {
                map.set(id, {
                    asset: item.asset,
                    scores: {
                        semanticSimilarity: 0,
                        intentMatch:        0,
                        emotionMatch:       0,
                        energyMatch:        0,
                        popularityScore:    0,
                        userPreferenceScore: 0,
                        contextScore:       0,
                    },
                    sources: new Set(),
                });
            }

            const entry = map.get(id);
            entry.sources.add(item.source || passKey);

            // Accumulate pass scores
            if (item.similarity !== undefined) {
                entry.scores.semanticSimilarity = Math.max(entry.scores.semanticSimilarity, item.similarity);
            }
            if (item.intentMatch !== undefined) {
                entry.scores.intentMatch = Math.max(entry.scores.intentMatch, item.intentMatch);
            }
            if (item.contextScore !== undefined) {
                entry.scores.contextScore = Math.max(entry.scores.contextScore, item.contextScore);
            }
        };

        meta.forEach(item      => add(item, 'metadata', item.intentMatch || 0));
        embedding.forEach(item => add(item, 'embedding', item.similarity || 0));
        context.forEach(item   => add(item, 'context', item.contextScore || 0));

        return [...map.values()];
    }
}

// Singleton
const assetSearchEngine = new AssetSearchEngine();
module.exports = { AssetSearchEngine, assetSearchEngine };
