'use strict';

// PostgREST applies a server-side row cap to each response. Read large media
// collections in bounded, ID-cursor pages so concurrent uploads cannot shift
// offset boundaries and silently duplicate or skip an asset.
const DEFAULT_PAGE_SIZE = 500;

async function readAllRows(queryOrFactory, { pageSize = DEFAULT_PAGE_SIZE } = {}) {
    const size = Math.max(1, Math.min(1000, Math.floor(Number(pageSize) || DEFAULT_PAGE_SIZE)));
    const rows = [];
    let cursor = null;
    for (;;) {
        // Callers pass a factory so each page starts with a fresh PostgREST
        // builder. Reusing one builder would accumulate cursor filters.
        const query = typeof queryOrFactory === 'function' ? queryOrFactory() : queryOrFactory;
        if (!query) throw new TypeError('readAllRows requires a query or query factory');
        let pageQuery = typeof query.order === 'function'
            ? query.order('id', { ascending: true })
            : query;
        if (cursor !== null) {
            if (typeof pageQuery.gt !== 'function') {
                throw new TypeError('readAllRows cursor queries require a .gt() filter');
            }
            pageQuery = pageQuery.gt('id', cursor);
        }
        if (typeof pageQuery.limit === 'function') pageQuery = pageQuery.limit(size);
        const { data, error } = await pageQuery;
        if (error) throw error;
        const page = Array.isArray(data) ? data : [];
        rows.push(...page);
        if (page.length < size) return rows;
        const nextCursor = page[page.length - 1]?.id;
        if (nextCursor === null || nextCursor === undefined || String(nextCursor) === String(cursor)) {
            throw new Error('readAllRows received a full page without advancing its ID cursor');
        }
        cursor = nextCursor;
    }
}

module.exports = { readAllRows, DEFAULT_PAGE_SIZE };
