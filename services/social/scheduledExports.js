// services/social/scheduledExports.js
// The export files a scheduled post still needs (R175).
//
// A scheduled post keeps a signed link to its export and the publish worker
// fetches that file at post time. Deleting the project (or the retention job
// cleaning it up) before then would leave the post pointing at nothing, so
// every path that deletes files asks this first and skips what it returns.
// Once the post has gone out (or was cancelled), its row no longer counts
// and the file follows the normal rules again.

'use strict';

const { objectPathFromMediaUrl } = require('./scheduleMedia');

const PENDING = ['scheduled', 'publishing'];

/**
 * Object paths of exports waiting to be published.
 * @param db        supabaseAdmin
 * @param userId    one user's posts, or null for everyone (retention job)
 * @param bucketName the bucket the signed links point into
 * @returns {Promise<Set<string>>} throws when the table cannot be read, so the
 *          caller can refuse to delete exports rather than guess.
 */
async function scheduledExportPaths(db, userId = null, bucketName = null) {
    let query = db.from('social_publications').select('user_id,media_url').in('status', PENDING);
    if (userId) query = query.eq('user_id', userId);
    const { data, error } = await query;
    if (error) throw new Error(`scheduled exports unreadable: ${error.message}`);
    const paths = new Set();
    for (const row of data || []) {
        const path = objectPathFromMediaUrl(row.media_url, { userId: row.user_id, bucketName });
        if (path) paths.add(path);
    }
    return paths;
}

/**
 * What a deletion should skip: the set above, or ALL exports when it could
 * not be read (deleting nothing is recoverable, deleting a post's video is not).
 */
async function exportProtection(db, userId, bucketName) {
    try {
        return await scheduledExportPaths(db, userId, bucketName);
    } catch (err) {
        console.error('[social] could not read scheduled posts; keeping every export this run:', err.message);
        return 'all-exports';
    }
}

/** True when `path` must not be deleted under this protection. */
function isProtected(path, protect) {
    if (!protect) return false;
    if (protect === 'all-exports') return typeof path === 'string' && path.startsWith('exports/');
    return protect.has(path);
}

module.exports = { scheduledExportPaths, exportProtection, isProtected, PENDING };
