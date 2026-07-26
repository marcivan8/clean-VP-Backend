/**
 * utils/waveformPath.js
 *
 * Pure helper used by routes/waveformRoutes.js to resolve a storage-relative
 * path from an asset's proxyUrl. Kept dependency-free (no config/storage,
 * no middleware/auth) on purpose so it can be unit tested in isolation via
 * scripts/test_waveform_pipeline.js without needing Supabase/GCS env vars.
 */

'use strict';

/**
 * Derive a storage-relative path from proxyUrl when gcsPath is not stored on
 * the asset. proxyUrl comes from jobs/videoProcessor.js's uploadToStorage(),
 * which returns TWO different URL shapes depending on storage mode:
 *   - GCS:   /api/proxy/gcs-media/<destinationPath>
 *   - local: /uploads/<destinationPath>
 *
 * IMPORTANT — regression history: this function used to only strip the GCS
 * marker. In local storage mode (the default when no
 * GOOGLE_CLOUD_BUCKET_NAME/credentials are configured — see config/storage.js)
 * that always resolved to null, which fell through to routes/waveformRoutes.js's
 * 400 "gcsPath is required" response and permanently broke waveform
 * extraction — clips showed no waveform at all, forever, in local/dev storage
 * mode. If you add a THIRD storage backend or change either URL shape, update
 * this function and scripts/test_waveform_pipeline.js together — that test
 * pins both shapes so a future refactor can't silently drop one of them again.
 *
 * @param {string|null|undefined} rawGcsPath  Explicit gcsPath from the client, if any
 * @param {string|null|undefined} proxyUrl    asset.proxyUrl as sent by the client
 * @returns {string|null}
 */
function deriveGcsPath(rawGcsPath, proxyUrl) {
    if (rawGcsPath) return rawGcsPath;
    if (!proxyUrl) return null;

    const gcsMarker   = '/api/proxy/gcs-media/';
    const localMarker = '/uploads/';

    let idx = proxyUrl.indexOf(gcsMarker);
    if (idx !== -1) return proxyUrl.slice(idx + gcsMarker.length);

    idx = proxyUrl.indexOf(localMarker);
    if (idx !== -1) return proxyUrl.slice(idx + localMarker.length);

    return null;
}

module.exports = { deriveGcsPath };
