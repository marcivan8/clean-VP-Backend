import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { mapWithConcurrency } = require('../server/brain/media/mapWithConcurrency.js');

assert.equal(typeof mapWithConcurrency, 'function', 'organizer exposes its bounded worker helper');

const items = Array.from({ length: 137 }, (_, index) => index);
let active = 0;
let peak = 0;
const results = await mapWithConcurrency(items, 4, async value => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, value % 3));
    active -= 1;
    return value * 2;
});

assert.equal(peak, 4, 'work is parallel but bounded by the configured worker count');
assert.deepEqual(results, items.map(value => value * 2), 'all large-bin items finish and preserve source order');

const empty = await mapWithConcurrency([], 4, async value => value);
assert.deepEqual(empty, [], 'empty bins do not start workers');

console.log('Organizer bounded-concurrency test passed: 137 items fully processed with at most 4 workers.');
