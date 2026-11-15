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
const { getAIClient } = require('../../../services/AIProvider');
const { OpenAI } = require('openai');
const { supabaseAdmin } = require('../../../config/database.js');

const EMBEDDING_MODEL     = 'text-embedding-3-small';
const EMBEDDING_DIM       = 1536;
const CACHE_TTL_SECONDS   = 7 * 24 * 60 * 60; // 7 days
const CACHE_KEY_PREFIX    = 'embed:v1:';
const MAX_BATCH_SIZE      = 50;

/**
 * Normalizes an arbitrary-dimension vector (e.g. 768 from Gemini text-embedding-004)
 * and zero-pads it to targetDim (1536) so it is 100% compatible with Supabase's
 * pgvector column `vector(1536)` and search_assets_by_embedding RPC.
 *
 * Preserves exact cosine similarity: cos(u', v') == cos(u, v) because:
 *   sum(u'_i * v'_i) for i in [0..767] == sum(u_i * v_i)
 *   sum(u'_i * v'_i) for i in [768..1535] == 0
 *   ||u'|| == 1.0, ||v'|| == 1.0
 */
function padAndNormalizeEmbedding(vector, targetDim = EMBEDDING_DIM) {
    if (!Array.isArray(vector) || vector.length === 0) return null;
    if (vector.length === targetDim) return vector;
    if (vector.length > targetDim) return vector.slice(0, targetDim);

    let norm = 0;
    for (let i = 0; i < vector.length; i++) {
        norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm);
    const scale = norm > 0 ? 1 / norm : 1;

    const padded = new Array(targetDim).fill(0);
    for (let i = 0; i < vector.length; i++) {
        padded[i] = vector[i] * scale;
    }
    return padded;
}

function shouldPreferGemini() {
    const prov = (process.env.AI_EMBEDDING_PROVIDER || process.env.AI_PROVIDER || '').toLowerCase();
    if (prov === 'gemini') return true;
    if (process.env.GEMINI_API_KEY && (!process.env.OPENAI_API_KEY || prov === 'groq')) return true;
    return false;
}

async function callGeminiEmbed(text) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return null;
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${encodeURIComponent(key)}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'models/text-embedding-004',
                content: { parts: [{ text: text.trim() }] },
            }),
        });
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            console.warn(`[EmbeddingService] Gemini embed error (${res.status}):`, errText.slice(0, 160));
            return null;
        }
        const data = await res.json();
        const values = data?.embedding?.values;
        if (!Array.isArray(values) || values.length === 0) return null;
        return padAndNormalizeEmbedding(values, EMBEDDING_DIM);
    } catch (err) {
        console.warn('[EmbeddingService] Gemini embed fetch error:', err.message);
        return null;
    }
}

async function callGeminiBatchEmbed(texts) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return texts.map(() => null);
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents?key=${encodeURIComponent(key)}`;
        const requests = texts.map(t => ({
            model: 'models/text-embedding-004',
            content: { parts: [{ text: String(t || '').trim() }] },
        }));
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requests }),
        });
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            console.warn(`[EmbeddingService] Gemini batch embed error (${res.status}):`, errText.slice(0, 160));
            return texts.map(() => null);
        }
        const data = await res.json();
        const embeddings = data?.embeddings || [];
        return texts.map((_, i) => {
            const values = embeddings[i]?.values;
            return Array.isArray(values) && values.length > 0 ? padAndNormalizeEmbedding(values, EMBEDDING_DIM) : null;
        });
    } catch (err) {
        console.warn('[EmbeddingService] Gemini batch embed fetch error:', err.message);
        return texts.map(() => null);
    }
}

// OpenAI client (lazy-init so tests don't fail on missing key)
let _openai = null;
function getOpenAI() {
    if (!_openai) {
        _openai = getAIClient({ capability: 'embeddings' });
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

        // 1. Direct Gemini path when configured or preferred
        if (shouldPreferGemini() && process.env.GEMINI_API_KEY) {
            const geminiEmbedding = await callGeminiEmbed(text);
            if (geminiEmbedding) {
                this._toCache(text, geminiEmbedding);
                return geminiEmbedding;
            }
        }

        // 2. OpenAI path
        const client = getOpenAI();
        if (client?.embeddings?.create) {
            try {
                const response = await client.embeddings.create({
                    model: EMBEDDING_MODEL,
                    input: text.trim(),
                });

                const embedding = response?.data?.[0]?.embedding;
                if (Array.isArray(embedding) && embedding.length === EMBEDDING_DIM) {
                    this._toCache(text, embedding);
                    return embedding;
                }
                console.error('[EmbeddingService.embed] unexpected shape:', embedding?.length);
            } catch (err) {
                console.warn('[EmbeddingService.embed] OpenAI error:', err.message);
                // Fallback to Gemini on OpenAI failure (e.g. 429 out of credits)
                if (process.env.GEMINI_API_KEY) {
                    const fallbackEmbedding = await callGeminiEmbed(text);
                    if (fallbackEmbedding) {
                        this._toCache(text, fallbackEmbedding);
                        return fallbackEmbedding;
                    }
                }
                return null;
            }
        }

        // 3. Last chance Gemini fallback if OpenAI was unavailable
        if (process.env.GEMINI_API_KEY) {
            const geminiEmbedding = await callGeminiEmbed(text);
            if (geminiEmbedding) {
                this._toCache(text, geminiEmbedding);
                return geminiEmbedding;
            }
        }

        return null;
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

            // Prefer Gemini when configured
            if (shouldPreferGemini() && process.env.GEMINI_API_KEY) {
                const geminiResults = await callGeminiBatchEmbed(uncachedTexts);
                geminiResults.forEach((emb, j) => {
                    if (emb) {
                        results[uncachedIndices[j]] = emb;
                        this._toCache(uncachedTexts[j], emb);
                    }
                });
                continue;
            }

            const client = getOpenAI();
            let batchSuccess = false;
            if (client?.embeddings?.create) {
                try {
                    const response = await client.embeddings.create({
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
                    batchSuccess = true;
                } catch (err) {
                    console.warn('[EmbeddingService.embedBatch] OpenAI error:', err.message);
                }
            }

            // Fallback to Gemini if OpenAI failed or unavailable
            if (!batchSuccess && process.env.GEMINI_API_KEY) {
                const geminiResults = await callGeminiBatchEmbed(uncachedTexts);
                geminiResults.forEach((emb, j) => {
                    if (emb) {
                        results[uncachedIndices[j]] = emb;
                        this._toCache(uncachedTexts[j], emb);
                    }
                });
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
module.exports = { EmbeddingService, embeddingService, padAndNormalizeEmbedding };
