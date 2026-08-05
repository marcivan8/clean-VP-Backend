#!/usr/bin/env node
/**
 * Regression: Organize v2 — profile-first clip organizing (CLAUDE.md R43).
 *
 * Unlike a purely static check, most of this EXECUTES the real signal-priority
 * logic exported from routes/interviewRoutes.js. The guarantees being pinned
 * are behavioural, not textual:
 *
 *   1. A stored media_assets profile always beats live frame analysis.
 *   2. A clip with no signal at all is LABELLED unanalysed, never described.
 *   3. The pipeline label reflects what actually produced the ordering.
 *   4. describeAssetProfile omits unknown/empty fields rather than emitting
 *      a wall of "unknown" the model learns to ignore.
 *
 * Plus static assertions on the two call sites that can silently regress:
 *   5. The client sends per-asset gcsPath/assetId, not the global
 *      uploadedFilePath (the R21 single-global-field bug).
 *   6. Both the route and the client refuse to claim semantic ordering when
 *      there was no signal (R30).
 *
 * Run: node scripts/test_organize_v2.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
    if (condition) {
        passed++;
        console.log(`  ✓ ${name}`);
    } else {
        failed++;
        console.log(`  ✗ ${name}`);
        if (detail) console.log(`      ${detail}`);
    }
}

function section(title) {
    console.log(`\n${title}`);
}

// ── Load the real implementation ─────────────────────────────────────────────
// interviewRoutes.js → middleware/auth → config/database, which THROWS at
// require time when SUPABASE_URL is unset (i.e. in CI and on any dev machine
// without a .env). Stub it in require.cache first — the same technique
// scripts/test_data_health.js uses — so this script tests the organizer's
// logic rather than the environment it happens to run in.
const DB_PATH = require.resolve(path.resolve(__dirname, '../config/database.js'));
require.cache[DB_PATH] = {
    id: DB_PATH, filename: DB_PATH, loaded: true,
    exports: { supabaseAdmin: null },
};

const routes = require(path.resolve(__dirname, '../routes/interviewRoutes.js'));
const buildOrganizeDescriptors = routes._buildOrganizeDescriptors;
const describeAssetProfile     = routes._describeAssetProfile;
const ASSET_ANALYSIS_DONE      = routes._ASSET_ANALYSIS_DONE;

section('0 · Helpers are exported');
check('buildOrganizeDescriptors is exported',
    typeof buildOrganizeDescriptors === 'function');
check('describeAssetProfile is exported',
    typeof describeAssetProfile === 'function');

// ── 0b · Every consumer reads the SAME analysis-status value ─────────────────
// This check exists because the bug it prevents already happened twice: the
// organizer filtered profiles on analysis_status === 'completed' while the
// analyser writes 'done', and ContextEngine derived binReady from a client
// field nothing writes. Both are silent — the comparison never matches, the
// dependent feature is simply dead, and nothing errors.
//
// The literal now lives in ONE dependency-free module. These checks assert
// that the writer and the readers all go through it rather than re-inlining
// a string that can drift.
section('0b · Analysis-status value is shared, not re-inlined');
{
    const STATUS_PATH = path.resolve(__dirname, '../server/brain/media/analysisStatus.js');
    const shared = require(STATUS_PATH);

    check('analysisStatus module exports a success value',
        typeof shared.ASSET_ANALYSIS_DONE === 'string' && shared.ASSET_ANALYSIS_DONE.length > 0);
    check('the organizer uses the shared value',
        ASSET_ANALYSIS_DONE === shared.ASSET_ANALYSIS_DONE,
        `organizer has "${ASSET_ANALYSIS_DONE}", shared module has "${shared.ASSET_ANALYSIS_DONE}"`);

    const consumers = {
        'MediaIntelligencePipeline.js': '../server/brain/media/MediaIntelligencePipeline.js',
        'ContextEngine.js':             '../server/brain/ContextEngine.js',
        'EditorialBrain.js':            '../server/brain/EditorialBrain.js',
        'brainRoutes.js':               '../server/routes/brainRoutes.js',
        'interviewRoutes.js':           '../routes/interviewRoutes.js',
    };

    for (const [label, rel] of Object.entries(consumers)) {
        const src = fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
        check(`${label} imports the shared constant`,
            /require\((['"]).*analysisStatus\1\)/.test(src),
            'still relying on its own literal');

        // A bare `analysis_status === 'x'` comparison anywhere means someone
        // re-inlined the value and the drift risk is back.
        const inlined = src.match(/analysis_status\s*[!=]==\s*'[a-z_]+'/g);
        check(`${label} has no inlined analysis_status comparison`,
            !inlined, inlined ? inlined.join(', ') : '');
    }
}

if (typeof buildOrganizeDescriptors !== 'function') {
    console.log('\nCannot continue without the exported helper.');
    process.exit(1);
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
const PROFILE = {
    id: 'asset-A',
    name: 'interview.mp4',
    scene_type: 'talking_head',
    camera_angle: 'medium',
    subject_count: 1,
    has_main_speaker: true,
    has_faces: true,
    is_broll: false,
    is_screen_recording: false,
    location_type: 'indoor',
    lighting_quality: 'good',
    stability: 'stable',
    emotional_tone: 'confident',
    content_description: 'A person explaining a product at a desk.',
    suggested_label: 'Main interview',
    audio_type: 'speech',
    has_spoken_word: true,
    analysis_status: 'done',
};

const ML = {
    id: 'clip-2',
    clip_type: 'broll_cutaway',
    clip_type_confidence: 0.82,
    top_types: { broll_cutaway: 0.82, product_shot: 0.11 },
    has_face: false,
    face_count: 0,
    face_size: 'none',
    energy: 'low',
    topic_cluster: 1,
};

// ── 1 · Profile beats frames ─────────────────────────────────────────────────
section('1 · A stored profile takes priority over live frame analysis');
{
    // clip-1 has BOTH a profile and extracted frames. The profile must win —
    // otherwise Organize v2 pays for vision on footage already analysed.
    const r = buildOrganizeDescriptors({
        clips: [{ id: 'clip-1', assetId: 'asset-A', duration: 12 }],
        profilesById: { 'asset-A': PROFILE },
        clipFrameMap: { 'clip-1': ['BASE64FRAME'] },
    });

    const d = r.descriptors[0];
    check('descriptor source is "profile", not "frame"', d.source === 'profile',
        `got "${d.source}"`);
    check('no image is attached when a profile exists', d.frame === null);
    check('imageDescriptors is empty (no vision call needed)',
        r.imageDescriptors.length === 0,
        `got ${r.imageDescriptors.length}`);
    check('pipeline is "profile"', r.pipeline === 'profile', `got "${r.pipeline}"`);
    check('descriptor text carries the content description',
        d.text.includes('A person explaining a product at a desk.'));
    check('descriptor text names its provenance',
        d.text.includes('analysed at upload'));
}

// ── 2 · Unanalysed clips are labelled, not described ─────────────────────────
section('2 · A clip with no signal is labelled unanalysed');
{
    const r = buildOrganizeDescriptors({
        clips: [{ id: 'clip-x', duration: 5 }],
        profilesById: {},
        clipFrameMap: {},
    });

    const d = r.descriptors[0];
    check('source is "none"', d.source === 'none', `got "${d.source}"`);
    check('text says NOT ANALYSED', d.text.includes('NOT ANALYSED'));
    check('id appears in unanalysedIds',
        r.unanalysedIds.length === 1 && r.unanalysedIds[0] === 'clip-x',
        JSON.stringify(r.unanalysedIds));
    check('no image attached', d.frame === null);
}

// ── 3 · Mixed coverage produces the right pipeline label ─────────────────────
section('3 · Pipeline label reflects the signals actually used');
{
    const mixed = buildOrganizeDescriptors({
        clips: [
            { id: 'clip-1', assetId: 'asset-A', duration: 12 },  // profile
            { id: 'clip-2', duration: 4 },                        // ml
            { id: 'clip-3', duration: 6 },                        // frame only
            { id: 'clip-4', duration: 3 },                        // nothing
        ],
        profilesById: { 'asset-A': PROFILE },
        mlById:       { 'clip-2': ML },
        clipFrameMap: { 'clip-2': ['F2'], 'clip-3': ['F3a', 'F3b'] },
    });

    const bySource = Object.fromEntries(mixed.descriptors.map(d => [d.id, d.source]));
    check('clip-1 → profile', bySource['clip-1'] === 'profile', bySource['clip-1']);
    check('clip-2 → ml (ML beats a raw frame)', bySource['clip-2'] === 'ml', bySource['clip-2']);
    check('clip-3 → frame', bySource['clip-3'] === 'frame', bySource['clip-3']);
    check('clip-4 → none', bySource['clip-4'] === 'none', bySource['clip-4']);

    check('pipeline is "profile+ml" when both are present',
        mixed.pipeline === 'profile+ml', `got "${mixed.pipeline}"`);
    check('only the frame-only clip needs an image',
        mixed.imageDescriptors.length === 1 && mixed.imageDescriptors[0].id === 'clip-3',
        JSON.stringify(mixed.imageDescriptors.map(d => d.id)));
    check('a clip with frames but ML coverage does not also send an image',
        !mixed.imageDescriptors.some(d => d.id === 'clip-2'));
    check('unanalysedIds contains only clip-4',
        mixed.unanalysedIds.length === 1 && mixed.unanalysedIds[0] === 'clip-4',
        JSON.stringify(mixed.unanalysedIds));

    // The second frame is the one sampled at 45% — preferred over the first.
    check('the mid-clip frame is preferred over the first',
        mixed.imageDescriptors[0].frame === 'F3b',
        mixed.imageDescriptors[0].frame);
}

section('3b · Pipeline label for the frames-only and profile-only cases');
{
    const framesOnly = buildOrganizeDescriptors({
        clips: [{ id: 'c1', duration: 2 }],
        clipFrameMap: { c1: ['F'] },
    });
    check('frames but no profile/ML → "vision_fallback"',
        framesOnly.pipeline === 'vision_fallback', framesOnly.pipeline);

    const profileAndFrame = buildOrganizeDescriptors({
        clips: [
            { id: 'c1', assetId: 'asset-A', duration: 2 },
            { id: 'c2', duration: 2 },
        ],
        profilesById: { 'asset-A': PROFILE },
        clipFrameMap: { c2: ['F'] },
    });
    check('profile + a frame-only clip → "profile+vision"',
        profileAndFrame.pipeline === 'profile+vision', profileAndFrame.pipeline);

    const mlOnly = buildOrganizeDescriptors({
        clips: [{ id: 'clip-2', duration: 2 }],
        mlById: { 'clip-2': ML },
        clipFrameMap: { 'clip-2': ['F'] },
    });
    check('ML but no profile → "ml"', mlOnly.pipeline === 'ml', mlOnly.pipeline);
}

// ── 4 · describeAssetProfile omits empty/unknown fields ──────────────────────
section('4 · Profile rendering skips unknown/empty fields');
{
    const sparse = describeAssetProfile({
        id: 'asset-B',
        scene_type: 'unknown',
        camera_angle: null,
        location_type: '',
        lighting_quality: 'poor',
        content_description: undefined,
    });

    check('no "unknown" value is rendered', !sparse.includes('unknown'), sparse);
    check('null/empty fields are omitted',
        !sparse.includes('Framing') && !sparse.includes('Location'), sparse);
    check('a real value is still rendered', sparse.includes('poor'), sparse);

    const full = describeAssetProfile(PROFILE);
    check('B-roll flag is only stated when true',
        !full.includes('B-roll'), full);
    check('main-speaker flag is stated when true',
        full.includes('main speaker'), full);

    const broll = describeAssetProfile({ ...PROFILE, is_broll: true, has_main_speaker: false });
    check('B-roll flag appears when the asset is B-roll',
        broll.includes('B-roll'), broll);
}

// ── 5 · Client sends per-asset paths (static) ────────────────────────────────
section('5 · Client payload is asset-scoped (R21 global-field bug)');
{
    const enginePath = path.resolve(__dirname, '../client/src/agent/MediaExecutionEngine.js');
    const src = fs.readFileSync(enginePath, 'utf8');

    // Isolate the organize_clips case so unrelated code can't satisfy these.
    const start = src.indexOf("case 'organize_clips'");
    const end   = src.indexOf("case 'virtual_multicam'", start);
    const block = start >= 0 && end > start ? src.slice(start, end) : '';

    check('the organize_clips case was located', block.length > 0);
    check('payload sends per-clip assetId',
        /assetId:\s*clip\.assetId/.test(block), 'assetId missing from clipPayload');
    check('payload sends the asset\'s own gcsPath',
        /gcsPath:\s*asset\?\.gcsPath/.test(block), 'gcsPath missing from clipPayload');
    check('uploadedFilePath is no longer sent unconditionally as filePath',
        !/filePath:\s*uploadedFP\s*\|\|\s*null/.test(block),
        'the global uploadedFilePath is still the primary path for every clip');
    check('uploadedFilePath is only a fallback when gcsPath is absent',
        /filePath:\s*asset\?\.gcsPath\s*\?\s*null\s*:/.test(block));
}

// ── 6 · Nobody claims semantic ordering without signal (R30) ─────────────────
section('6 · No-signal path stays honest (R30)');
{
    const routeSrc = fs.readFileSync(
        path.resolve(__dirname, '../routes/interviewRoutes.js'), 'utf8');

    check('route has an explicit no-signal guard',
        /profiledClips\.length === 0 && totalFrames === 0/.test(routeSrc));
    check('no-signal response returns an empty order',
        /pipeline:\s*'none'/.test(routeSrc) && /orderedIds:\s*\[\]/.test(routeSrc));
    check('route reports coverage back to the client',
        /coverage,/.test(routeSrc));

    const enginePath = path.resolve(__dirname, '../client/src/agent/MediaExecutionEngine.js');
    const engineSrc  = fs.readFileSync(enginePath, 'utf8');
    const start = engineSrc.indexOf("case 'organize_clips'");
    const end   = engineSrc.indexOf("case 'virtual_multicam'", start);
    const block = engineSrc.slice(start, end);

    check('client short-circuits on pipeline "none"',
        /pipeline === 'none'/.test(block));
    check('client surfaces partial-coverage honestly',
        /coverage\.unanalyzed\s*>\s*0/.test(block));
    check('client does not reorder when orderedIds is empty',
        /orderedIds\.length === 0/.test(block));
}

// ── 7 · Frame extraction is not local-file-only ──────────────────────────────
section('7 · Frame extraction works in GCS mode');
{
    const routeSrc = fs.readFileSync(
        path.resolve(__dirname, '../routes/interviewRoutes.js'), 'utf8');

    const start = routeSrc.indexOf("router.post('/organize-clips'");
    const end   = routeSrc.indexOf("router.post('/virtual-multicam'", start);
    const block = start >= 0 && end > start ? routeSrc.slice(start, end) : routeSrc.slice(start);

    check('the organize-clips route was located', block.length > 0);
    check('extractFrame accepts a remote (signed) URL',
        /isRemote\s*=\s*\/\^https\?/.test(block) || /https\?:\\\/\\\//.test(block),
        'no remote-URL branch found in extractFrame');
    check('extractFrame no longer hard-requires a local file',
        !/if\s*\(!filePath\s*\|\|\s*!fs\.existsSync\(filePath\)\)/.test(block),
        'the local-file-only precondition is still present');
    check('clip sources resolve through resolveClipSource',
        /resolveClipSource\(/.test(block));
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`Organize v2: ${passed} passed, ${failed} failed`);
console.log('─'.repeat(60));

process.exit(failed > 0 ? 1 : 0);
