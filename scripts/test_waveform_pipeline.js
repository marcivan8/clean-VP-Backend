/**
 * test_waveform_pipeline.js
 *
 * Regression test for utils/waveformPath.js's deriveGcsPath(), the function
 * routes/waveformRoutes.js (POST /api/waveform/extract) uses to turn an
 * asset's proxyUrl into a storage-relative path before running ffmpeg.
 *
 * WHY THIS TEST EXISTS
 * jobs/videoProcessor.js's uploadToStorage() returns two different URL shapes
 * depending on storage mode:
 *   - GCS:   /api/proxy/gcs-media/<destinationPath>
 *   - local: /uploads/<destinationPath>          (default when no
 *            GOOGLE_CLOUD_BUCKET_NAME/credentials are configured)
 *
 * deriveGcsPath() used to only strip the GCS marker. In local storage mode
 * that always resolved to null, which made /api/waveform/extract 400 with
 * "gcsPath is required" on every request — clips never showed a waveform,
 * silently, in local/dev mode. This test pins both URL shapes (plus the
 * explicit-gcsPath and no-proxyUrl cases) so a future refactor of either
 * deriveGcsPath() or uploadToStorage()'s URL shapes gets caught here instead
 * of shipping silently broken again.
 *
 * Run: node scripts/test_waveform_pipeline.js
 */

const { deriveGcsPath } = require('../utils/waveformPath');

let passed = 0;
let failed = 0;

function ok(label, got, expected) {
    if (got === expected) {
        console.log(`  ✅ ${label}`);
        passed++;
    } else {
        console.error(`  ❌ ${label}`);
        console.error(`     expected: ${JSON.stringify(expected)}`);
        console.error(`     got:      ${JSON.stringify(got)}`);
        failed++;
    }
}

console.log('\n=== deriveGcsPath: GCS storage mode ===');
{
    const proxyUrl = '/api/proxy/gcs-media/proxies/user123/myvideo.mp4/proxy.mp4';
    ok(
        'strips the GCS marker and returns the destination path',
        deriveGcsPath(null, proxyUrl),
        'proxies/user123/myvideo.mp4/proxy.mp4'
    );
}

console.log('\n=== deriveGcsPath: local storage mode (the regression) ===');
{
    // This is the exact shape uploadToStorage() returns when
    // useLocalStorage || !bucket — see config/storage.js's default when no
    // GCS credentials/bucket are configured.
    const proxyUrl = '/uploads/proxies/dev-user/myvideo.mp4/proxy.mp4';
    ok(
        'strips the /uploads/ marker and returns the destination path',
        deriveGcsPath(null, proxyUrl),
        'proxies/dev-user/myvideo.mp4/proxy.mp4'
    );
}

console.log('\n=== deriveGcsPath: waveform.json paths (not just proxy.mp4) ===');
{
    ok(
        'GCS waveform.json path',
        deriveGcsPath(null, '/api/proxy/gcs-media/proxies/u1/f.mov/waveform.json'),
        'proxies/u1/f.mov/waveform.json'
    );
    ok(
        'local waveform.json path',
        deriveGcsPath(null, '/uploads/proxies/u1/f.mov/waveform.json'),
        'proxies/u1/f.mov/waveform.json'
    );
}

console.log('\n=== deriveGcsPath: the PROXY wins; raw is the fallback ===');
{
    // THIS ASSERTION WAS DELIBERATELY INVERTED.
    //
    // It previously read "explicit gcsPath short-circuits proxyUrl derivation
    // entirely" and pinned `if (rawGcsPath) return rawGcsPath` — which turned
    // out to BE the bug, not the contract. asset.gcsPath is set from the RAW
    // upload key and the client sends it for every clip, so preferring it meant
    // ffmpeg always decoded the original camera file and the proxy was never
    // used. In production that produced two consecutive
    // "ffmpeg decode timed out after 90s" failures on raw HEVC .MOV files whose
    // proxies had already finished encoding.
    //
    // R34 requires the proxy be preferred for anything that ffmpeg-decodes.
    // Proxies are faststart and never trimmed, so peaks are identical.
    ok(
        'a usable proxyUrl is preferred over an explicit raw gcsPath',
        deriveGcsPath('raw/u1/original.MOV', '/api/proxy/gcs-media/proxies/u1/original.MOV/proxy.mp4'),
        'proxies/u1/original.MOV/proxy.mp4'
    );
    ok(
        'local-mode proxyUrl also wins over raw',
        deriveGcsPath('raw/u1/original.MOV', '/uploads/proxies/u1/original.MOV/proxy.mp4'),
        'proxies/u1/original.MOV/proxy.mp4'
    );
    // The fallback still matters: audio-only assets have no proxy at all, and a
    // video whose proxy job hasn't finished yet must still get a waveform
    // eventually rather than none.
    ok(
        'raw gcsPath is still used when there is no proxy',
        deriveGcsPath('raw/u1/original.MOV', null),
        'raw/u1/original.MOV'
    );
    ok(
        'raw gcsPath is used when proxyUrl is an unusable blob: URL',
        deriveGcsPath('raw/u1/original.MOV', 'blob:https://app/abc-123'),
        'raw/u1/original.MOV'
    );
}

console.log('\n=== deriveGcsPath: unresolvable inputs return null (not a crash) ===');
{
    ok('no proxyUrl, no rawGcsPath', deriveGcsPath(null, null), null);
    ok('undefined inputs', deriveGcsPath(undefined, undefined), null);
    ok(
        'blob: URL (clip not yet uploaded — asset.proxyUrl not set yet)',
        deriveGcsPath(null, 'blob:http://localhost:5173/8f2c1e40-abcd-1234'),
        null
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// A FAILED extraction must never be reported as "this source is silent".
//
// extractPeaks used to set `hasAudio: pcm.length > 0 && peaks.length > 0`, which
// is also false when ffmpeg merely FAILED. Because the client caches a
// hasAudio:false result as a FINAL answer ("render an empty track, stop
// asking"), a 90-second decode timeout presented permanently as "this clip has
// no audio" — observed in production on two clips whose transcripts contained
// 84 and 168 words. Only a CLEAN ffmpeg exit may declare a source silent.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== waveformRoutes: failed extraction ≠ silent source ===');
{
    const fs   = require('fs');
    const path = require('path');
    const src  = fs.readFileSync(path.resolve(__dirname, '../routes/waveformRoutes.js'), 'utf8');

    const gated = /const cleanExit = code === 0;/.test(src)
        && /hasAudio:\s*cleanExit\s*\?/.test(src);
    ok('hasAudio is gated on a clean ffmpeg exit', gated, true);

    ok('the old ungated form is gone',
        !/hasAudio:\s*pcm\.length > 0 && peaks\.length > 0,/.test(src), true);

    ok('a non-clean exit returns a bounded-retry 500, not a 503',
        /return res\.status\(500\)\.json\(\{\s*\n\s*error:\s*.Waveform extraction did not complete cleanly/.test(src), true);
    ok('it is NOT a 503 (503 never consumes a retry attempt)',
        !/status\(503\)[\s\S]{0,120}extraction did not complete/.test(src), true);

    ok('an unknown result is NOT returned as hasAudio:false',
        /peaksData\.hasAudio === null \|\| peaksData\.extractionFailed/.test(src), true);
}

// ─────────────────────────────────────────────────────────────────────────────
// A range read must ALWAYS terminate the response.
//
// The old handler was `if (!res.headersSent) res.status(500).end()`. On a range
// response the 206 headers are already sent, so a mid-stream "socket hang up"
// from GCS logged and then left the response open forever; Railway's edge timed
// it out and synthesised a 502, making one clip's proxy.mp4 unplayable.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== proxyRoutes: a range-stream error always ends the response ===');
{
    const fs   = require('fs');
    const path = require('path');
    const src  = fs.readFileSync(path.resolve(__dirname, '../routes/proxyRoutes.js'), 'utf8');

    ok('range reads are retried', /openRangeStream\(attempt \+ 1\)/.test(src), true);
    ok('the response is destroyed when headers already went out',
        /else res\.destroy\(\);/.test(src), true);
    ok('the no-headers case still sends a status',
        /if \(!res\.headersSent\) res\.status\(502\)\.end\(\);/.test(src), true);
    ok('the old log-and-hang handler is gone',
        !/Range stream error[\s\S]{0,120}if \(!res\.headersSent\) res\.status\(500\)\.end\(\);\s*\}\);/.test(src),
        true);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
