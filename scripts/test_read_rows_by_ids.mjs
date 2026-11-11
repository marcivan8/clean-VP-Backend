import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { readRowsByIds } = require('../server/brain/media/readRowsByIds.js');

const ids = Array.from({ length: 1_037 }, (_, index) => `asset-${String(index).padStart(4, '0')}`);
const requestedBatches = [];
let active = 0;
let peak = 0;
const rows = await readRowsByIds([...ids, ids[0]], async batch => {
    requestedBatches.push(batch);
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    return { data: batch.filter(id => Number(id.slice(6)) % 17 !== 0).map(id => ({ id, status: 'done' })), error: null };
}, { batchSize: 100, concurrency: 3 });

assert.equal(requestedBatches.length, 11, 'all IDs are read via bounded query batches');
assert.ok(requestedBatches.every(batch => batch.length <= 100));
assert.equal(peak, 3, 'ID reads use bounded concurrency');
assert.equal(rows.length, ids.filter((_, index) => index % 17 !== 0).length, 'missing database rows are omitted without hiding other batches');
assert.deepEqual(rows.map(row => row.id), ids.filter((_, index) => index % 17 !== 0), 'rows preserve requested order and duplicate IDs are removed');
await assert.rejects(() => readRowsByIds(['asset-1'], async () => ({ data: null, error: new Error('database unavailable') })), /database unavailable/);
console.log('Large ID query test passed: 1,037 IDs, bounded batches/concurrency, stable complete coverage, and error propagation.');
