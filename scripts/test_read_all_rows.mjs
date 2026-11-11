import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { readAllRows } = require('../server/brain/media/readAllRows.js');

const source = Array.from({ length: 1050 }, (_, index) => ({ id: `asset-${String(index).padStart(4, '0')}` }));
const cursors = [];
let pageNumber = 0;
const makeQuery = () => {
    let cursor = null;
    let limit = Infinity;
    return {
        order(column, options) {
            assert.equal(column, 'id');
            assert.deepEqual(options, { ascending: true });
            return this;
        },
        gt(column, value) {
            assert.equal(column, 'id');
            cursor = value;
            return this;
        },
        limit(value) { limit = value; return this; },
        then(resolve) {
            cursors.push(cursor);
            const data = source.filter(row => cursor === null || row.id > cursor)
                .sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit);
            // Simulate an upload between pages. An offset-based read would
            // shift the next page and duplicate or omit an existing asset.
            if (pageNumber++ === 0) source.push({ id: 'asset-9999' });
            return Promise.resolve({ data, error: null }).then(resolve);
        },
    };
};

const rows = await readAllRows(makeQuery, { pageSize: 500 });
assert.equal(rows.length, 1051, 'all original rows plus a later upload are returned');
assert.equal(new Set(rows.map(row => row.id)).size, rows.length, 'concurrent changes do not duplicate rows');
assert.deepEqual(rows.map(row => row.id), [...rows.map(row => row.id)].sort(), 'stable ID ordering is retained');
assert.deepEqual(cursors, [null, 'asset-0499', 'asset-0999'], 'bounded pages advance with the last stable ID');

await assert.rejects(() => readAllRows(() => ({
    order() { return this; },
    limit() { return this; },
    then(resolve) { return Promise.resolve({ data: null, error: new Error('database unavailable') }).then(resolve); },
})), /database unavailable/, 'page errors are surfaced to callers');

console.log('Large-row paging passed: complete concurrent-upload coverage, unique stable cursors, bounded pages, and error propagation.');
