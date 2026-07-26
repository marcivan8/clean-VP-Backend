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

console.log('\n=== deriveGcsPath: explicit rawGcsPath always wins ===');
{
    ok(
        'explicit gcsPath short-circuits proxyUrl derivation entirely',
        deriveGcsPath('raw/explicit/path.mp4', '/uploads/should/be/ignored.mp4'),
        'raw/explicit/path.mp4'
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

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
