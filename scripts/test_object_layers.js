#!/usr/bin/env node
/**
 * Regression: Object Intelligence Integration (CLAUDE.md R67) — SAM2
 * speaker/background separation. Covers the pure
 * `client/src/motion/ObjectLayers.js` crop/segment derivation, the
 * persistence contract (`layerMask`/`layerTarget` in BOTH
 * `toLegacyTracks()`/`fromLegacyTracks()`), and that every layer of wiring
 * (backend service/job/route, store actions, AI-tool switch, export branch,
 * preview overlay) actually exists and references what it should.
 *
 * Run: node scripts/test_object_layers.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const check = (n, c, d) => {
    if (c) { passed++; console.log(`  ✓ ${n}`); }
    else { failed++; console.log(`  ✗ ${n}`); if (d) console.log(`      ${d}`); }
};
const section = (t) => console.log(`\n${t}`);

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => {
    try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
    catch (err) { console.log(`  ✗ could not read ${rel} — ${err.code || err.message}`); failed++; return ''; }
};
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

function loadObjectLayers() {
    let src = read('client/src/motion/ObjectLayers.js');
    src = src
        .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
        .replace(/^\s*export\s+default\s+\{[\s\S]*?\};\s*$/gm, '')
        .replace(/\bexport\s+(const|function|class|let)\b/g, '$1');
    src += '\nreturn { LAYER_TARGETS, deriveSpeakerCrop, deriveTrackingSegments };';
    // eslint-disable-next-line no-new-func
    return new Function(src)();
}
const OL = loadObjectLayers();

// A synthetic bboxTrack: subject starts centered, drifts right at t=3s past
// the default 0.12 threshold, drifts back left at t=6s. Mirrors how a real
// SAM2-derived track looks for someone walking across frame mid-clip.
function syntheticTrack() {
    const track = [];
    for (let t = 0; t < 3; t += 0.2) track.push({ t, cx: 0.5, cy: 0.45, w: 0.2, h: 0.5 });
    for (let t = 3; t < 6; t += 0.2) track.push({ t, cx: 0.8, cy: 0.45, w: 0.2, h: 0.5 });
    for (let t = 6; t < 9; t += 0.2) track.push({ t, cx: 0.3, cy: 0.45, w: 0.2, h: 0.5 });
    return track;
}

section('1 · deriveSpeakerCrop');
{
    const track = syntheticTrack();
    const crop = OL.deriveSpeakerCrop(track, { sourceStart: 0, duration: 9 });
    check('returns a crop object for a covered range', !!crop && typeof crop.cropX === 'number');
    check('crop stays within [0,1] bounds', crop.cropX >= 0 && crop.cropY >= 0 && crop.cropX + crop.cropW <= 1.0001 && crop.cropY + crop.cropH <= 1.0001);
    check('crop is padded larger than the raw bbox (0.2x0.5)', crop.cropW > 0.2 && crop.cropH > 0.5);

    const empty = OL.deriveSpeakerCrop(track, { sourceStart: 100, duration: 5 });
    check('returns null when no samples cover the requested range', empty === null);

    const noTrack = OL.deriveSpeakerCrop([], { sourceStart: 0, duration: 5 });
    check('returns null for an empty bboxTrack rather than throwing', noTrack === null);

    const malformed = OL.deriveSpeakerCrop(null, {});
    check('handles a null bboxTrack without throwing', malformed === null);
}

section('2 · deriveTrackingSegments');
{
    const track = syntheticTrack();
    const segments = OL.deriveTrackingSegments(track, { sourceStart: 0, duration: 9, threshold: 0.12, minSegmentDuration: 0.5 });
    check('splits into multiple segments when the subject drifts past threshold', segments.length >= 2);
    check('segments are ordered and contiguous', segments.every((s, i) => i === 0 || Math.abs(s.start - segments[i - 1].end) < 0.001));
    check('every segment has a valid crop', segments.every(s => s.crop && s.crop.cropW > 0 && s.crop.cropH > 0));
    check('first segment starts at sourceStart', Math.abs(segments[0].start - 0) < 0.001);
    check('last segment ends at sourceStart+duration', Math.abs(segments[segments.length - 1].end - 9) < 0.001);

    const stillTrack = [];
    for (let t = 0; t < 5; t += 0.2) stillTrack.push({ t, cx: 0.5, cy: 0.5, w: 0.3, h: 0.6 });
    const stillSegments = OL.deriveTrackingSegments(stillTrack, { sourceStart: 0, duration: 5 });
    check('a subject that never drifts produces exactly one segment', stillSegments.length === 1);

    const noisyTrack = [];
    for (let t = 0; t < 2; t += 0.1) noisyTrack.push({ t, cx: t < 1 ? 0.3 : 0.9, cy: 0.5, w: 0.2, h: 0.5 }); // one abrupt, short-lived jump
    const noisySegments = OL.deriveTrackingSegments(noisyTrack, { sourceStart: 0, duration: 2, minSegmentDuration: 0.5 });
    check('a too-short drifted segment gets merged rather than left as a sliver', noisySegments.every(s => (s.end - s.start) >= 0.4 || noisySegments.length === 1));

    check('LAYER_TARGETS exposes speaker/background', OL.LAYER_TARGETS.SPEAKER === 'speaker' && OL.LAYER_TARGETS.BACKGROUND === 'background');
}

section('3 · persistence contract — layerMask/layerTarget round-trip');
{
    const tsm = read('client/src/timeline/TimelineStateManager.js');
    const toStart = tsm.indexOf('toLegacyTracks()');
    const fromStart = tsm.indexOf('fromLegacyTracks(', toStart);
    check('toLegacyTracks() defined before fromLegacyTracks() (slice anchor sanity)', toStart > -1 && fromStart > toStart);
    const toLegacyBlock = tsm.slice(toStart, fromStart);
    const fromLegacyBlock = tsm.slice(fromStart);

    check('toLegacyTracks() projects clip.layerMask', /layerMask:\s*clip\.layerMask/.test(toLegacyBlock));
    check('toLegacyTracks() projects clip.layerTarget', /layerTarget:\s*clip\.layerTarget/.test(toLegacyBlock));
    check('fromLegacyTracks() restores layerMask', /layerMask:\s*legacyClip\.layerMask/.test(fromLegacyBlock));
    check('fromLegacyTracks() restores layerTarget', /layerTarget:\s*legacyClip\.layerTarget/.test(fromLegacyBlock));
}

section('4 · backend — Replicate service, BullMQ job, route, queue/worker wiring');
{
    check('services/ReplicateSAM2Service.js exists', exists('services/ReplicateSAM2Service.js'));
    check('jobs/objectSegmentationProcessor.js exists', exists('jobs/objectSegmentationProcessor.js'));
    check('routes/objectIntelligenceRoutes.js exists', exists('routes/objectIntelligenceRoutes.js'));

    const queues = read('queue/queues.js');
    check('queue/queues.js defines visionQueue', /visionQueue\s*=\s*new Queue\('object-segmentation'/.test(queues));
    check('queue/queues.js exports visionQueue', /module\.exports\s*=\s*\{[^}]*visionQueue/.test(queues));

    const worker = read('worker.js');
    check('worker.js registers the object-segmentation worker', /new Worker\('object-segmentation'/.test(worker));

    const jobRoutes = read('routes/jobRoutes.js');
    check('jobRoutes.js findJob() checks visionQueue', /visionQueue\.getJob/.test(jobRoutes));

    const indexJs = read('index.js');
    check('index.js mounts /api/vision', /app\.use\('\/api\/vision'/.test(indexJs));

    const envExample = read('.env.example');
    check('.env.example documents REPLICATE_API_TOKEN', /REPLICATE_API_TOKEN=/.test(envExample));

    const service = read('services/ReplicateSAM2Service.js');
    check('service exports isConfigured/createPrediction/waitForPrediction', /isConfigured/.test(service) && /createPrediction/.test(service) && /waitForPrediction/.test(service));
}

section('5 · store wiring');
{
    const store = read('client/src/store/useTimelineStore.js');
    check('imports ObjectLayers', /from '\.\.\/motion\/ObjectLayers\.js'/.test(store));
    check('defines applyLayerSeparation', /applyLayerSeparation:/.test(store));
    check('defines zoomToSpeaker', /zoomToSpeaker:/.test(store));
    check('defines trackSpeaker', /trackSpeaker:/.test(store));
    check('defines setLayerTarget', /setLayerTarget:/.test(store));
    check('updateClip allow-list includes layerMask', /updates\.layerMask !== undefined/.test(store));
    check('updateClip allow-list includes layerTarget', /updates\.layerTarget !== undefined/.test(store));
}

section('6 · AI-tool switch wiring (MediaExecutionEngine.js)');
{
    const mee = read('client/src/agent/MediaExecutionEngine.js');
    check("case 'separate_speaker' exists", /case 'separate_speaker':/.test(mee));
    check("case 'zoom_speaker' exists", /case 'zoom_speaker':/.test(mee));
    check("case 'track_speaker' exists", /case 'track_speaker':/.test(mee));
    check("case 'blur_background' exists", /case 'blur_background':/.test(mee));
    check('_findClipAndTrack helper defined', /_findClipAndTrack\(store, clipId\)/.test(mee));
    check('separate_speaker posts to /api/vision/separate-speaker', /\/api\/vision\/separate-speaker/.test(mee));
}

section('7 · export wiring (jobs/exportProcessor.js) — reuse + new primitive');
{
    const exp = read('jobs/exportProcessor.js');
    check('defines renderBackgroundBlurSegment', /function renderBackgroundBlurSegment/.test(exp));
    check('uses alphamerge for the SAM2 matte composite', /alphamerge/.test(exp));
    check('branches on clip.layerTarget === \'background\'', /clip\.layerTarget === 'background'/.test(exp));
    check('blur-background branch fails open (falls through, does not throw the whole export)', /falling back to unblurred/.test(exp));
    // zoom_speaker/track_speaker need ZERO new export code — confirm the
    // EXISTING virtualCam crop path (R14) is untouched and still present.
    check('existing virtualCam crop path is unchanged (R14 — no new gating added)', /const vc = clip\.virtualCam;/.test(exp));
}

section('8 · preview wiring (ObjectLayerOverlay.jsx + VideoPlayer.jsx mount)');
{
    check('ObjectLayerOverlay.jsx exists', exists('client/src/components/Player/ObjectLayerOverlay.jsx'));
    const overlay = read('client/src/components/Player/ObjectLayerOverlay.jsx');
    check('reads clip.layerTarget === \'background\'', /clip\.layerTarget === 'background'/.test(overlay));
    check('reads clip.layerMask.maskAssetUrl', /layerMask\?\.maskAssetUrl/.test(overlay));
    check('composites via luma matte (getImageData/putImageData)', /getImageData/.test(overlay) && /putImageData/.test(overlay));

    const videoPlayer = read('client/src/components/Player/VideoPlayer.jsx');
    check('VideoPlayer.jsx imports ObjectLayerOverlay', /import ObjectLayerOverlay from '\.\/ObjectLayerOverlay'/.test(videoPlayer));
    check('VideoPlayer.jsx mounts <ObjectLayerOverlay', /<ObjectLayerOverlay/.test(videoPlayer));
}

console.log(`\n${'─'.repeat(60)}\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
