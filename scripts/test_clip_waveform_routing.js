/**
 * scripts/test_clip_waveform_routing.js
 *
 *   node scripts/test_clip_waveform_routing.js
 *
 * Pins that Clip.jsx withholds raw video until its proxy is ready, then gives
 * the server a raw-source fallback if decoding the proxy fails.
 *
 * WHY THIS EXISTS
 * ---------------
 * Raw phone/camera uploads routinely have their moov atom at the END of the
 * file (documented for this codebase in R7/R25 — it's why `refine-cut-frames`
 * prefers the proxy). ffmpeg reading such a file as a network stream — which is
 * exactly what the waveform route does — often can't produce any output until
 * it has buffered close to the entire file, because the sample table it needs
 * isn't available until the stream ends. A proxy is always faststart, so
 * decoding one is fast and bounded. The raw path remains useful as a fallback
 * if the proxy itself fails.
 *
 * A 4K interview upload hit exactly this: waveform extraction fired against the
 * raw file before the proxy existed, timed out 3 times, and WaveformEngine gave
 * up — all wasted work, since the proxy (which makes extraction trivial) landed
 * moments later anyway.
 *
 * THE SUBTLE PART THIS TEST GUARDS: the server resolver prefers proxyUrl, then
 * retains raw gcsPath as a recovery source. The client must withhold the raw
 * path only until proxy readiness, and keep it available afterward.
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
const callStart = src.indexOf('const assetType =');
const callEnd   = src.indexOf(');', src.indexOf('usePeaks(', callStart)) + 2;
const block = callStart !== -1 && callEnd !== -1 ? src.slice(callStart, callEnd) : '';

console.log('\n── Clip.jsx withholds raw-file URLs from an unproxied video asset ──');

check('an "unproxied video asset" condition exists', !!block,
    'Expected a variable gating raw-file fallback on asset.type === "video" && !asset.proxyUrl.');

check('the condition accepts normalized video and video/* MIME asset types',
    /assetType\s*===\s*'video'\s*\|\|\s*assetType\.startsWith\('video\/'\)/.test(block));

check('the condition checks the PROXY is missing',
    /!serverProxyUrl/.test(block));

check('the raw clip URL fallback is nulled when unproxied',
    /isUnproxiedVideoAsset\s*\?\s*null\s*:/.test(block),
    'clip.sourceUrl / clip.url must not be used as a stand-in while a video proxy is pending.');

check('raw gcsPath is withheld until the proxy is ready, then provided as fallback',
    /waveformGcsPath\s*=\s*isUnproxiedVideoAsset\s*\?\s*null\s*:\s*\(asset\?\.gcsPath\s*\|\|\s*clip\.gcsPath/.test(block));
check('video waveform extraction receives the server proxy URL',
    /const wsAudioUrl\s*=\s*serverProxyUrl\s*\|\|\s*rawUrlFallback/.test(block)
    && /usePeaks\([\s\S]{0,120}waveformGcsPath,\s*wsAudioUrl/.test(block));

const routeSrc = fs.readFileSync(path.resolve(__dirname, '../routes/waveformRoutes.js'), 'utf8');
check('server retries a failed proxy extraction from the raw source when available',
    /if \(useGCS && storagePath && rawGcsPath && rawGcsPath !== storagePath\)[\s\S]{0,220}return await doExtract\(rawGcsPath, null, null\)/.test(routeSrc));

const peaksHookSrc = fs.readFileSync(
    path.resolve(__dirname, '../client/src/hooks/usePeaks.js'), 'utf8');
const proxyArrivalBlock = peaksHookSrc.slice(
    peaksHookSrc.indexOf('if (proxyUrl) WaveformEngine.reset(assetId);'),
    peaksHookSrc.indexOf('let cancelled = false;'));
check('proxy arrival resets stale cache state before checking cached peaks',
    !!proxyArrivalBlock
    && proxyArrivalBlock.indexOf('WaveformEngine.reset(assetId)') < proxyArrivalBlock.indexOf('WaveformEngine.peek(assetId)'));

// The failure mode if someone "simplifies" this back to `asset?.gcsPath` directly.
check('gcsPath is not passed unconditionally to usePeaks',
    !/usePeaks\([^)]*,\s*asset\?\.gcsPath\s*,/.test(block.replace(/isUnproxiedVideoAsset[^,]*,\s*/, '')),
    'A direct, unguarded asset.gcsPath argument reintroduces the raw-file timeout.');

console.log('\n── Timeline clip color and waveform treatment ──');
check('audio is detected from either clip type or its track type',
    /clip\.type === 'audio' \|\| trackType === 'audio'/.test(src));
check('audio clips use an orange body and orange waveform',
    /isAudioClip\s*\?\s*'rgba\(251,146,60,0\.9\)'/.test(src)
    && /isAudioClip\s*\?\s*'bg-orange-500'/.test(src));
check('video waveform remains green', /: 'rgba\(52,211,153,0\.9\)'/.test(src));
check('waveform sits in the lower band and has enough height to read',
    /height:\s*'52%'/.test(src) && /height=\{isMobile \? 24 : 40\}/.test(src));
check('video peaks draw directly to canvas instead of waiting on a WaveSurfer media element',
    /<Waveform[\s\S]{0,250}peaks=\{clipPeaks\}/.test(src)
    && !/<ClipWaveform/.test(src));
check('waveform visibility is gated by extracted peaks, not by a browser playback URL',
    /!isTextClip && clipPeaks\?\.length > 0 && waveformDuration > 0/.test(src)
    && !/!isTextClip && wsAudioUrl/.test(src));
check('trimmed waveform maps across the clip duration at timeline zoom',
    /duration=\{waveformDuration\}[\s\S]{0,120}zoomLevel=\{zoomLevel\}/.test(src));

const projectSrc = fs.readFileSync(path.resolve(__dirname, '../client/src/revideo/project.tsx'), 'utf8');
check('Revideo waits for video, audio and image nodes before async media access',
    (projectSrc.match(/layerRefs\[track\.id\]\(\)\.add\(/g) || []).length === 4
    && (projectSrc.match(/yield mediaRef\(\);/g) || []).length === 3);

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
check('thumbnail capture tries the original source if a processed proxy fails',
    /function buildVideoUrls\(asset\)[\s\S]*?buildVideoUrl\(\{ \.\.\.asset, proxyUrl: null \}\)/.test(thumbSrc)
    && /for \(const videoUrl of candidates\.slice\(0, 3\)\)[\s\S]*?blob = await captureFrame\(videoUrl\)[\s\S]*?if \(blob\) break/.test(thumbSrc));

console.log(
    failures === 0
        ? '\nALL CLIP WAVEFORM ROUTING TESTS PASSED\n'
        : `\n${failures} CLIP WAVEFORM ROUTING TEST(S) FAILED\n`
);
process.exit(failures === 0 ? 0 : 1);
