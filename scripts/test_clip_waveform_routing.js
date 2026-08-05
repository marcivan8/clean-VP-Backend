/**
 * scripts/test_clip_waveform_routing.js
 *
 *   node scripts/test_clip_waveform_routing.js
 *
 * Pins that Clip.jsx never hands WaveformEngine a raw (unproxied) video file.
 *
 * WHY THIS EXISTS
 * ---------------
 * Raw phone/camera uploads routinely have their moov atom at the END of the
 * file (documented for this codebase in R7/R25 — it's why `refine-cut-frames`
 * prefers the proxy). ffmpeg reading such a file as a network stream — which is
 * exactly what the waveform route does — often can't produce any output until
 * it has buffered close to the entire file, because the sample table it needs
 * isn't available until the stream ends. A proxy is always faststart, so
 * decoding one is fast and bounded; decoding the raw source is a coin flip that
 * gets worse as the file gets larger.
 *
 * A 4K interview upload hit exactly this: waveform extraction fired against the
 * raw file before the proxy existed, timed out 3 times, and WaveformEngine gave
 * up — all wasted work, since the proxy (which makes extraction trivial) landed
 * moments later anyway.
 *
 * THE SUBTLE PART THIS TEST GUARDS: `asset.gcsPath` (the raw path) and
 * `asset.proxyUrl` are TWO SEPARATE arguments to usePeaks(), and on the server,
 * utils/waveformPath.js's `deriveGcsPath()` checks the explicit `gcsPath`
 * argument FIRST, unconditionally — `if (rawGcsPath) return rawGcsPath`. So
 * withholding `proxyUrl` alone does nothing; `gcsPath` will still force
 * raw-file resolution regardless. Both must be suppressed together, or this
 * fix silently regresses to a no-op the next time someone touches this block.
 *
 * Static analysis of the real source — no browser, no network.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const CLIP_PATH = path.resolve(__dirname, '../client/src/components/Timeline/Clip.jsx');
const src = fs.readFileSync(CLIP_PATH, 'utf8');

let failures = 0;
const check = (name, cond, detail) => {
    if (cond) {
        console.log(`  ✓ ${name}`);
    } else {
        failures++;
        console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
    }
};

// Isolate the usePeaks(...) call and its immediately preceding setup, so the
// assertions below can't accidentally match unrelated code elsewhere in the file.
const callStart = src.indexOf('const isUnproxiedVideoAsset');
const callEnd   = src.indexOf(');', src.indexOf('usePeaks(', callStart)) + 2;
const block = callStart !== -1 && callEnd !== -1 ? src.slice(callStart, callEnd) : '';

console.log('\n── Clip.jsx withholds raw-file URLs from an unproxied video asset ──');

check('an "unproxied video asset" condition exists', !!block,
    'Expected a variable gating raw-file fallback on asset.type === "video" && !asset.proxyUrl.');

check('the condition checks asset.type === \'video\'',
    /asset\?\.type\s*===\s*'video'/.test(block));

check('the condition checks the PROXY is missing',
    /!asset\?\.proxyUrl/.test(block));

check('the raw clip URL fallback is nulled when unproxied',
    /isUnproxiedVideoAsset\s*\?\s*null\s*:/.test(block),
    'clip.sourceUrl / clip.url must not be used as a stand-in while a video proxy is pending.');

check('asset.gcsPath is ALSO nulled when unproxied (the easy-to-miss half)',
    /isUnproxiedVideoAsset\s*\?\s*null\s*:\s*asset\?\.gcsPath/.test(block),
    'gcsPath wins over proxyUrl on the server unconditionally — suppressing proxyUrl alone is a no-op.');

// The failure mode if someone "simplifies" this back to `asset?.gcsPath` directly.
check('gcsPath is not passed unconditionally to usePeaks',
    !/usePeaks\([^)]*,\s*asset\?\.gcsPath\s*,/.test(block.replace(/isUnproxiedVideoAsset[^,]*,\s*/, '')),
    'A direct, unguarded asset.gcsPath argument reintroduces the raw-file timeout.');

// ── The same "raw file has a late moov atom" pattern, second location ────────
// captureProjectThumbnail.js seeks a <video> element to grab a frame, which
// needs the SAME thing ffmpeg needs — the moov atom — to map a time to a byte
// offset. It used to check asset.sourceUrl (raw) BEFORE asset.proxyUrl, so
// thumbnail capture picked the least-reliable URL shape first. Observed in the
// wild: "[thumbnail] Video load error for .../raw/.../4K.mp4" immediately
// followed, once the proxy finished, by a successful capture — the raw file
// wasn't broken, it was just tried first when it's the shape most likely to
// fail a seek.
const THUMB_PATH = path.resolve(__dirname, '../client/src/utils/captureProjectThumbnail.js');
const thumbSrc = fs.readFileSync(THUMB_PATH, 'utf8');
const buildVideoUrlBody = (() => {
    const start = thumbSrc.indexOf('function buildVideoUrl');
    const end   = thumbSrc.indexOf('\n}\n', start);
    return start !== -1 && end !== -1 ? thumbSrc.slice(start, end) : '';
})();

console.log('\n── captureProjectThumbnail.js tries the proxy before the raw file ──');

check('buildVideoUrl was found', !!buildVideoUrlBody);
check('proxyUrl is checked before sourceUrl',
    (() => {
        const proxyIdx  = buildVideoUrlBody.indexOf('asset.proxyUrl');
        const sourceIdx = buildVideoUrlBody.indexOf('asset.sourceUrl');
        return proxyIdx !== -1 && sourceIdx !== -1 && proxyIdx < sourceIdx;
    })(),
    'sourceUrl (raw) checked first means thumbnail capture picks the URL shape most likely to fail a seek.');

console.log(
    failures === 0
        ? '\nALL CLIP WAVEFORM ROUTING TESTS PASSED\n'
        : `\n${failures} CLIP WAVEFORM ROUTING TEST(S) FAILED\n`
);
process.exit(failures === 0 ? 0 : 1);
