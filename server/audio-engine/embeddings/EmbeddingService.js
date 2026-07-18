'use strict';

/**
 * server/audio-engine/embeddings/EmbeddingService.js
 *
 * Generates and caches 1536-dim text embeddings using
 * OpenAI text-embedding-3-small.
 *
 * Caching strategy:
 *   - Redis key: "embed:v1:<sha256(text)>"  TTL: 7 days
 *   - On Redis miss: call OpenAI, write-through cache
 *   - On Redis unavailable: call OpenAI uncached (never throws)
 *
 * All public methods are async and never throw — they return null on failure.
 */

const crypto = require('crypto');
const { OpenAI } = require('openai');
const { supabaseAdmin } = require('../../../config/database.js');

const EMBEDDING_MODEL     = 'text-embedding-3-small';
const EMBEDDING_DIM       = 1536;
const CACHE_TTL_SECONDS   = 7 * 24 * 60 * 60; // 7 days
const CACHE_KEY_PREFIX    = 'embed:v1:';
const MAX_BATCH_SIZE      = 50;

// OpenAI client (lazy-init so tests don't fail on missing key)
let _openai = null;
function getOpenAI() {
    if (!_openai) {
        _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return _openai;
}

// Redis client reference (injected at startup — avoids circular deps)
let _redis = null;

class EmbeddingService {
    /**
     * Inject a Redis client (ioredis instance) for caching.
     * If not called, embeddings are generated without caching.
     *
     * @param {import('ioredis').Redis} redisClient
     */
    setRedisClient(redisClient) {
        _redis = redisClient;
    }

    // ── Cache helpers ─────────────────────────────────────────────────────────

    /**
     * Build a Redis cache key for a text string.
     * @private
     */
    _cacheKey(text) {
        const hash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 32);
        return `${CACHE_KEY_PREFIX}${hash}`;
    }

    /**
     * Try to read embedding from Redis.
     * @private
     * @returns {Promise<number[]|null>}
     */
    async _fromCache(text) {
        if (!_redis) return null;
        try {
            const raw = await _redis.get(this._cacheKey(text));
            if (!raw) return null;
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    /**
     * Write embedding to Redis (fire-and-forget — never throws).
     * @private
     */
    _toCache(text, embedding) {
        if (!_redis) return;
        try {
            _redis
                .set(this._cacheKey(text), JSON.stringify(embedding), 'EX', CACHE_TTL_SECONDS)
                .catch(() => {}); // swallow Redis write errors
        } catch {
            // ignore
        }
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Generate a single 1536-dim embedding for `text`.
     * Returns null on any failure.
     *
     * @param {string} text
     * @returns {Promise<number[]|null>}
     */
    async embed(text) {
        if (!text?.trim()) return null;

        // Cache hit
        const cached = await this._fromCache(text);
        if (cached) return cached;

        try {
            const response = await getOpenAI().embeddings.create({
                model: EMBEDDING_MODEL,
                input: text.trim(),
            });

            const embedding = response?.data?.[0]?.embedding;
            if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIM) {
                console.error('[EmbeddingService.embed] unexpected shape:', embedding?.length);
                return null;
            }

            this._toCache(text, embedding);
            return embedding;
        } catch (err) {
            console.error('[EmbeddingService.embed] OpenAI error:', err.message);
            return null;
        }
    }

    /**
     * Generate embeddings for a batch of texts.
     * Returns an array of the same length as `texts`, with null for failures.
     *
     * @param {string[]} texts
     * @returns {Promise<(number[]|null)[]>}
     */
    async embedBatch(texts) {
        if (!texts?.length) return [];

        const results = new Array(texts.length).fill(null);

        // Split into chunks of MAX_BATCH_SIZE
        for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
            const chunk = texts.slice(i, i + MAX_BATCH_SIZE);
            const indices = chunk.map((_, j) => i + j);

            // Check cache first for each item
            const uncachedIndices = [];
            const uncachedTexts   = [];

            for (let k = 0; k < chunk.length; k++) {
                const cached = await this._fromCache(chunk[k]);
                if (cached) {
                    results[indices[k]] = cached;
                } else {
                    uncachedIndices.push(indices[k]);
                    uncachedTexts.push(chunk[k].trim());
                }
            }

            if (uncachedTexts.length === 0) continue;

            try {
                const response = await getOpenAI().embeddings.create({
                    model: EMBEDDING_MODEL,
                    input: uncachedTexts,
                });

                (response?.data || []).forEach((item, j) => {
                    const globalIdx = uncachedIndices[j];
                    const embedding = item?.embedding;
                    if (Array.isArray(embedding) && embedding.length === EMBEDDING_DIM) {
                        results[globalIdx] = embedding;
                        this._toCache(uncachedTexts[j], embedding);
                    }
                });
            } catch (err) {
                console.error('[EmbeddingService.embedBatch] OpenAI error:', err.message);
                // partial results still returned
            }
        }

        return results;
    }

    /**
     * Build the canonical text for an asset that will be embedded.
     * Combines display_name, description, editing_intents, emotion_tags,
     * search_keywords, and best_use_cases.
     *
     * @param {Object} asset — raw DB row from assets table
     * @returns {string}
     */
    buildAssetText(asset) {
        const parts = [
            asset.display_name || asset.displayName || '',
            asset.description || '',
            (asset.editing_intents || asset.editingIntents || []).join(' '),
            (asset.emotion_tags    || asset.emotionTags    || []).join(' '),
            (asset.style           || []).join(' '),
            (asset.search_keywords || asset.searchKeywords || []).join(' '),
            (asset.best_use_cases  || asset.bestUseCases  || []).join(' '),
        ];
        return parts.filter(Boolean).join('. ').toLowerCase();
    }

    /**
     * Generate embedding for an asset object and return the vector.
     * Does not write to DB — caller is responsible for persistence.
     *
     * @param {Object} asset
     * @returns {Promise<number[]|null>}
     */
    async embedAsset(asset) {
        const text = this.buildAssetText(asset);
        return this.embed(text);
    }

    /**
     * Embed an asset and immediately persist the vector to the assets table.
     * Returns true on success, false on failure.
     *
     * @param {string} assetId
     * @param {Object} asset   — asset row (needs display_name, description, etc.)
     * @returns {Promise<boolean>}
     */
    async embedAndPersist(assetId, asset) {
        const embedding = await this.embedAsset(asset);
        if (!embedding) return false;

        try {
            const { error } = await supabaseAdmin
                .from('assets')
                .update({
                    embedding,
                    embedding_generated_at: new Date().toISOString(),
                })
                .eq('id', assetId);

            if (error) {
                console.error('[EmbeddingService.embedAndPersist] DB error:', error.message);
                return false;
            }
            return true;
        } catch (err) {
            console.error('[EmbeddingService.embedAndPersist] error:', err.message);
            return false;
        }
    }

    /**
     * Find assets semantically similar to a query string using the
     * search_assets_by_embedding RPC.
     *
     * @param {string}   queryText
     * @param {Object}   [opts]
     * @param {string}   [opts.assetTypeFilter]
     * @param {number}   [opts.limit=20]
     * @param {number}   [opts.minSimilarity=0.60]
     * @returns {Promise<Array<{id:string, type:string, name:string, display_name:string, similarity:number}>>}
     */
    async searchBySimilarity(queryText, opts = {}) {
        const embedding = await this.embed(queryText);
        if (!embedding) return [];

        try {
            const { data, error } = await supabaseAdmin.rpc('search_assets_by_embedding', {
                query_embedding:   embedding,
                asset_type_filter: opts.assetTypeFilter || null,
                limit_count:       opts.limit           || 20,
                min_similarity:    opts.minSimilarity   || 0.60,
            });

            if (error) throw error;
            return data || [];
        } catch (err) {
            console.error('[EmbeddingService.searchBySimilarity]', err.message);
            return [];
        }
    }
}

// Singleton
const embeddingService = new EmbeddingService();
module.exports = { EmbeddingService, embeddingService };
