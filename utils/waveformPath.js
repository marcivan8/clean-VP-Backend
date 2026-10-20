/**
 * utils/waveformPath.js
 *
 * Pure helper used by routes/waveformRoutes.js to resolve a storage-relative
 * path from an asset's proxyUrl. Kept dependency-free (no config/storage,
 * no middleware/auth) on purpose so it can be unit tested in isolation via
 * scripts/test_waveform_pipeline.js without needing Supabase/GCS env vars.
 */

'use strict';

const fs = require('fs');
const path = require('path');

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
    const gcsMarker   = '/api/proxy/gcs-media/';
    const localMarker = '/uploads/';

    // PROXY FIRST. This used to be `if (rawGcsPath) return rawGcsPath;`
    // unconditionally, which meant that whenever the client sent a gcsPath —
    // which it does for every clip, since asset.gcsPath is set from the RAW
    // upload key — ffmpeg decoded the original camera file and the proxy was
    // never used, no matter what proxyUrl said.
    //
    // R34 established that anything ffmpeg-decoding a source must prefer the
    // proxy: raw phone footage is routinely HEVC with its moov atom at the END,
    // so ffmpeg can't produce output until it has buffered nearly the whole
    // object off GCS. Observed in production as two consecutive
    // "ffmpeg decode timed out after 90s" failures on raw .MOV files whose
    // proxies had already finished encoding — extraction from the proxy would
    // have been trivial. R34 fixed the CLIENT callers; this resolver, which
    // every one of them funnels through, still preferred raw.
    //
    // Proxies are always faststart and never trimmed, so timestamps carry over
    // 1:1 and the peaks are identical.
    if (proxyUrl) {
        let idx = proxyUrl.indexOf(gcsMarker);
        if (idx !== -1) return stripQuery(proxyUrl.slice(idx + gcsMarker.length));

        idx = proxyUrl.indexOf(localMarker);
        if (idx !== -1) return stripQuery(proxyUrl.slice(idx + localMarker.length));
    }

    // No usable proxy — fall back to the raw upload. Slower and prone to the
    // timeout above, but better than no waveform at all (and the only option
    // for audio-only assets, which have no proxy concept).
    if (rawGcsPath) return rawGcsPath;
    if (!proxyUrl) return null;

    // Shape 3: a raw/signed GCS https URL
    //   https://storage.googleapis.com/<bucket>/<path>[?X-Goog-Signature=…]
    // Assets that were never proxied (or whose proxy job hasn't finished) carry
    // this shape instead of the two above. Returning null for them meant the
    // route answered 400 "gcsPath is required" and the clip showed NO waveform
    // — the reason that on a multi-clip timeline only the first (already
    // proxied) clip rendered one.
    if (/^https?:\/\//i.test(proxyUrl)) {
        try {
            const u = new URL(proxyUrl);
            if (/(^|\.)storage\.googleapis\.com$/i.test(u.hostname)) {
                // /<bucket>/<objectPath> → drop the leading bucket segment
                const segs = u.pathname.replace(/^\/+/, '').split('/');
                if (segs.length > 1) {
                    return decodeURIComponent(segs.slice(1).join('/'));
                }
            }
        } catch { /* not a parseable URL — fall through */ }
        // Any other absolute URL (blob:, CDN, unknown host) is not resolvable
        // to a storage object — the caller must wait for the proxy job.
        return null;
    }

    // Shape 4: an already storage-relative path ("raw/…", "proxies/…").
    // Some code paths hand the asset's bare storage key straight through.
    if (/^(raw|proxies|uploads|waveforms)\//.test(proxyUrl)) {
        return stripQuery(proxyUrl);
    }

    return null;
}

/**
 * Map a URL of a bundled static audio file to its path relative to the SPA
 * root, or null. Sound-effect clips carry a relative `/sfx-library/<file>`
 * URL (see client/public/sfx-library, R13). That URL is not a storage object,
 * so deriveGcsPath() returns null for it and the route answered 400 every
 * time. The route reads these files from disk instead.
 *
 * Only a single plain file name is accepted after the prefix, so the result
 * can never point outside the library directory.
 *
 * @param {string|null|undefined} url
 * @returns {string|null}  e.g. 'sfx-library/whoosh-01.mp3'
 */
function resolveStaticAudioPath(url) {
    if (typeof url !== 'string') return null;
    const m = /^\/(sfx-library)\/([^/?#]+)(?:[?#].*)?$/.exec(url);
    if (!m) return null;
    let file;
    try { file = decodeURIComponent(m[2]); } catch { return null; }
    if (!/^[\w .()-]+$/.test(file) || file.startsWith('.')) return null;
    return `${m[1]}/${file}`;
}

/** Remove any query string / fragment from a derived object path. */
function stripQuery(p) {
    return p.split('?')[0].split('#')[0];
}

/**
 * Where bundled static audio actually lives on disk: the SPA build, or
 * client/public when there is no build (dev).
 *
 * This list used to be a private const inside routes/waveformRoutes.js. It
 * moved here because a SECOND consumer appeared — jobs/exportProcessor.js,
 * whose `fetchClipSource` could not resolve a `/sfx-library/<file>` URL at
 * all and therefore dropped every generated sound effect out of the render
 * ("Could not find: Cinematic Impact, Metal Impact, ..."). Two copies of
 * "where the library lives" is the drift class this codebase keeps counting,
 * so there is one.
 */
const STATIC_AUDIO_ROOTS = [
    path.resolve(__dirname, '../client/dist'),
    path.resolve(__dirname, '../client/public'),
];

/**
 * Absolute path of a bundled static audio file, or null when it is not on
 * this machine.
 *
 * @param {string|null} rel the value returned by resolveStaticAudioPath()
 * @returns {string|null}
 */
function resolveStaticAudioFile(rel) {
    if (!rel) return null;
    for (const root of STATIC_AUDIO_ROOTS) {
        const candidate = path.join(root, rel);
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

module.exports = { deriveGcsPath, resolveStaticAudioPath, resolveStaticAudioFile, STATIC_AUDIO_ROOTS };
