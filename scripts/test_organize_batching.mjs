import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chunkItems, completeOrder, mergeGroupOrders } = require('../server/brain/media/organizeBatching');

const clips = Array.from({ length: 237 }, (_, index) => ({ id: `clip-${index}` }));
const batches = chunkItems(clips, 40);
assert.deepEqual(batches.map(batch => batch.length), [40, 40, 40, 40, 40, 37]);
assert.deepEqual(batches.flat().map(clip => clip.id), clips.map(clip => clip.id),
    'batching preserves every clip exactly once and keeps source order');

assert.deepEqual(completeOrder(['a', 'b', 'c'], ['c', 'bogus', 'c']), ['c', 'a', 'b'],
    'batch results cannot introduce unknown IDs or drop clips');

const groups = [
    { id: 'g1', orderedIds: ['a', 'b'] },
    { id: 'g2', orderedIds: ['c'] },
    { id: 'g3', orderedIds: ['d', 'e'] },
];
assert.deepEqual(mergeGroupOrders(groups, ['g3', 'g1', 'missing']), ['d', 'e', 'a', 'b', 'c'],
    'global merge reorders batch groups while retaining each local order and appending omitted groups');

console.log('Organizer batching passed: large bins retain every clip across bounded batches and safe global merges.');
