'use strict';

/** Run a mapper with bounded parallelism while preserving input order. */
async function mapWithConcurrency(items, concurrency, mapper) {
    const values = Array.isArray(items) ? items : [];
    const results = new Array(values.length);
    let nextIndex = 0;
    const workerCount = Math.min(values.length, Math.max(1, Math.floor(Number(concurrency)) || 1));
    await Promise.all(Array.from({ length: workerCount }, async () => {
        while (true) {
            const index = nextIndex++;
            if (index >= values.length) return;
            results[index] = await mapper(values[index], index);
        }
    }));
    return results;
}

module.exports = { mapWithConcurrency };
