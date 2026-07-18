'use strict';

/**
 * server/audio-engine/embeddings/EmbeddingScheduler.js
 *
 * Enqueues embedding jobs on the `asset-embeddings` BullMQ queue.
 *
 * All methods are fire-and-forget: they enqueue and return immediately.
 * Callers must NOT await these in the main request path.
 *
 * Queuing strategy:
 *   - New asset created         → scheduleAsset (delay: 2s)
 *   - Batch of new assets       → scheduleBatch (delay: 5s)
 *   - Nightly backfill          → scheduleSeedAll (delay: 0, runs once per boot)
 *   - Deduplicate by jobId      → uses `assetId` as BullMQ job id to prevent dupes
 */

const { Queue } = require('bullmq');
const { redisConnection } = require('../../../queue/connection.js');

const QUEUE_NAME      = 'asset-embeddings';
const DEFAULT_DELAY   = 2000; // ms
const BATCH_DELAY     = 5000; // ms

// Lazy queue singleton
let _queue = null;
function getQueue() {
    if (!_queue) {
        _queue = new Queue(QUEUE_NAME, { connection: redisConnection });
    }
    return _queue;
}

class EmbeddingScheduler {
    /**
     * Schedule embedding for a single newly-created asset.
     * Idempotent — uses assetId as BullMQ jobId.
     *
     * @param {string} assetId
     * @param {Object} assetRow   — assets table row (for text construction)
     */
    scheduleAsset(assetId, assetRow) {
        if (!assetId || !assetRow) return;
        getQueue()
            .add(
                'embed-asset',
                { assetId, asset: assetRow },
                {
                    jobId:  `embed:${assetId}`,
                    delay:  DEFAULT_DELAY,
                    attempts: 3,
                    backoff: { type: 'exponential', delay: 10000 },
                    removeOnComplete: { count: 100 },
                    removeOnFail:    { count: 50 },
                }
            )
            .catch(err => {
                console.warn('[EmbeddingScheduler.scheduleAsset] queue error:', err.message);
            });
    }

    /**
     * Schedule batch embedding for multiple assets.
     * Uses a combined jobId to deduplicate concurrent batch triggers.
     *
     * @param {string[]} assetIds
     */
    scheduleBatch(assetIds) {
        if (!assetIds?.length) return;
        const jobId = `embed-batch:${assetIds.slice(0, 3).join('-')}`;
        getQueue()
            .add(
                'embed-batch',
                { batchAssetIds: assetIds },
                {
                    jobId,
                    delay:   BATCH_DELAY,
                    attempts: 2,
                    backoff: { type: 'fixed', delay: 30000 },
                    removeOnComplete: { count: 50 },
                    removeOnFail:    { count: 20 },
                }
            )
            .catch(err => {
                console.warn('[EmbeddingScheduler.scheduleBatch] queue error:', err.message);
            });
    }

    /**
     * Schedule a full backfill of all assets missing embeddings.
     * Safe to call on every boot — BullMQ deduplicates by jobId.
     *
     * @param {boolean} [force=false]  — if true, ignore de-dupe and re-run
     */
    scheduleSeedAll(force = false) {
        const jobId = force ? undefined : 'seed-all-embeddings';
        getQueue()
            .add(
                'seed-all',
                { seedAll: true },
                {
                    jobId,
                    delay:   0,
                    attempts: 1,
                    removeOnComplete: { count: 5 },
                    removeOnFail:    { count: 5 },
                }
            )
            .catch(err => {
                console.warn('[EmbeddingScheduler.scheduleSeedAll] queue error:', err.message);
            });
    }
}

// Singleton
const embeddingScheduler = new EmbeddingScheduler();
module.exports = { EmbeddingScheduler, embeddingScheduler };
