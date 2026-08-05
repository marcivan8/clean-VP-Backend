/**
 * server/brain/media/analysisStatus.js
 *
 * The three values `media_assets.analysis_status` can hold, in ONE place.
 *
 * WHY THIS FILE EXISTS: this string was previously a bare literal duplicated
 * across the writer (MediaIntelligencePipeline) and several readers. Getting it
 * wrong in a reader is completely silent — the comparison simply never matches,
 * every analysed asset is skipped, and the feature that depends on it goes dead
 * with no error anywhere. That already happened twice:
 *
 *   - routes/interviewRoutes.js filtered profiles on 'completed' while the
 *     pipeline writes 'done', which would have left Organize v2's profile path
 *     permanently unreachable (R43).
 *   - ContextEngine derived `binReady` from a client field that is never
 *     written at all, so the Brain's prompt always said the bin was still
 *     processing (R44).
 *
 * Deliberately dependency-free (no DB, no config) so even ContextEngine — which
 * is documented as pure and synchronous — can import it without dragging in a
 * Supabase client.
 *
 * If you add a new status, add it here and grep for every consumer; do not
 * introduce a fourth literal.
 */

'use strict';

/** Analysis finished successfully and every profile column is populated. */
const ASSET_ANALYSIS_DONE = 'done';

/** Row exists, job is in flight. Carries NO usable signal yet. */
const ASSET_ANALYSIS_PROCESSING = 'processing';

/** Job ran and failed. Carries no signal, and must not be retried blindly. */
const ASSET_ANALYSIS_FAILED = 'failed';

module.exports = {
    ASSET_ANALYSIS_DONE,
    ASSET_ANALYSIS_PROCESSING,
    ASSET_ANALYSIS_FAILED,
};
