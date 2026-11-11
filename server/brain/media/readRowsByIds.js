'use strict';

const { mapWithConcurrency } = require('./mapWithConcurrency');

const DEFAULT_ID_BATCH_SIZE = 100;
const DEFAULT_ID_QUERY_CONCURRENCY = 3;

/** Read every requested ID through bounded `in` queries and preserve source order. */
async function readRowsByIds(ids, queryFactory, {
    batchSize = DEFAULT_ID_BATCH_SIZE,
    concurrency = DEFAULT_ID_QUERY_CONCURRENCY,
} = {}) {
    const uniqueIds = [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean).map(String))];
    const size = Math.max(1, Math.floor(Number(batchSize) || DEFAULT_ID_BATCH_SIZE));
    const batches = [];
    for (let index = 0; index < uniqueIds.length; index += size) batches.push(uniqueIds.slice(index, index + size));
    if (!batches.length) return [];

    const rowsByBatch = await mapWithConcurrency(batches, concurrency, async batch => {
        const { data, error } = await queryFactory(batch);
        if (error) throw error;
        return Array.isArray(data) ? data : [];
    });
    const byId = new Map(rowsByBatch.flat().map(row => [String(row.id), row]));
    return uniqueIds.map(id => byId.get(id)).filter(Boolean);
}

module.exports = { readRowsByIds, DEFAULT_ID_BATCH_SIZE, DEFAULT_ID_QUERY_CONCURRENCY };
