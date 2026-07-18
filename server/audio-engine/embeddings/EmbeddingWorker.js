'use strict';

/**
 * server/audio-engine/embeddings/EmbeddingWorker.js
 *
 * BullMQ worker that processes `asset-embeddings` jobs.
 *
 * Job payload schema:
 *   { assetId: string, asset: Object }   — embed a single asset
 *   { batchAssetIds: string[] }          — embed assets fetched from DB by ID
 *   { seedAll: true }                    — backfill all assets missing embeddings
 *
 * Rules:
 * - Always async, never blocks request path
 * - Embedding failure is logged, job is NOT retried more than 3 times
 * - Worker concurrency: 3 (embedding calls are I/O-bound)
 */

const { Worker } = require('bullmq');
const { supabaseAdmin } = require('../../../config/database.js');
const { embeddingService } = require('./EmbeddingService.js');
const { redisConnection } = require('../../../queue/connection.js');

const QUEUE_NAME = 'asset-embeddings';
const BATCH_SIZE = 20;

// ── Job processor ──────────────────────────────────────────────────────────────

async function processEmbeddingJob(job) {
    const { assetId, asset, batchAssetIds, seedAll } = job.data || {};

    // ── Mode 1: Single asset
    if (assetId && asset) {
        console.log(`[EmbeddingWorker] Embedding asset ${assetId}`);
        const ok = await embeddingService.embedAndPersist(assetId, asset);
        if (!ok) throw new Error(`Failed to embed asset ${assetId}`);
        return { embedded: 1 };
    }

    // ── Mode 2: Batch by IDs
    if (Array.isArray(batchAssetIds) && batchAssetIds.length > 0) {
        console.log(`[EmbeddingWorker] Batch embedding ${batchAssetIds.length} assets`);
        const { data: rows, error } = await supabaseAdmin
            .from('assets')
            .select('id, display_name, description, editing_intents, emotion_tags, style, search_keywords, best_use_cases')
            .in('id', batchAssetIds);

        if (error) throw new Error(`DB fetch failed: ${error.message}`);

        let embedded = 0;
        for (const row of (rows || [])) {
            const ok = await embeddingService.embedAndPersist(row.id, row);
            if (ok) embedded++;
        }
        console.log(`[EmbeddingWorker] Batch done: ${embedded}/${batchAssetIds.length}`);
        return { embedded, total: batchAssetIds.length };
    }

    // ── Mode 3: Seed all missing
    if (seedAll) {
        console.log('[EmbeddingWorker] Seeding all assets without embeddings…');
        let offset     = 0;
        let totalDone  = 0;
        let hasMore    = true;

        while (hasMore) {
            const { data: rows, error } = await supabaseAdmin
                .from('assets')
                .select('id, display_name, description, editing_intents, emotion_tags, style, search_keywords, best_use_cases')
                .is('embedding', null)
                .eq('is_active', true)
                .range(offset, offset + BATCH_SIZE - 1);

            if (error) throw new Error(`DB fetch failed: ${error.message}`);
            if (!rows || rows.length === 0) { hasMore = false; break; }

            for (const row of rows) {
                const ok = await embeddingService.embedAndPersist(row.id, row);
                if (ok) totalDone++;
            }

            offset += BATCH_SIZE;
            if (rows.length < BATCH_SIZE) hasMore = false;

            // Progress update
            await job.updateProgress(Math.min(99, Math.floor((totalDone / (offset + 1)) * 100)));
        }

        console.log(`[EmbeddingWorker] Seed complete: ${totalDone} assets embedded`);
        return { embedded: totalDone };
    }

    throw new Error('EmbeddingWorker: unknown job payload schema');
}

// ── Worker factory ────────────────────────────────────────────────────────────

/**
 * Create and return the BullMQ Worker for asset-embeddings queue.
 * Called once at server/worker startup.
 *
 * @returns {Worker}
 */
function createEmbeddingWorker() {
    const worker = new Worker(QUEUE_NAME, processEmbeddingJob, {
        connection:  redisConnection,
        concurrency: 3,
    });

    worker.on('completed', (job, result) => {
        console.log(`[EmbeddingWorker] Job ${job.id} completed:`, result);
    });

    worker.on('failed', (job, err) => {
        console.error(`[EmbeddingWorker] Job ${job?.id} failed:`, err.message);
    });

    return worker;
}

module.exports = { createEmbeddingWorker };
