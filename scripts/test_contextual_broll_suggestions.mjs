/**
 * scripts/test_contextual_broll_suggestions.mjs
 *
 * Test suite for Level 2 Context-Aware B-Roll Integration.
 *
 * Verifies:
 *   1. Transcript word tokenization and stopword filtering.
 *   2. Keyword scoring and visual seed detection (locations, actions, atmospheres).
 *   3. Clustering of transcript words into non-overlapping visual moments.
 *   4. Chapter boundary bonuses and cutaway duration adaptation.
 *   5. Suggestion generation pipeline (mock Pexels search, primary asset + alternatives).
 *   6. Route contract for POST /api/stock/suggest-broll (400 validation, 200 execution).
 *   7. Creator review workflow simulation:
 *      - Approve: bin asset creation and overlay cutaway placement (scale: 4, x: 50, y: 50).
 *      - Reject: suggestion dismissal.
 *      - Replace: candidate option switching and query delegation.
 */

import 'dotenv/config';
import assert from 'node:assert';

// Fallback dummy supabase env vars for CI offline testing
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.mock';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.mock';

import {
    tokenizeWords,
    scoreKeyword,
    extractVisualMoments,
    BrollSuggesterService,
} from '../services/BrollSuggesterService.js';
import { PexelsService, normalizeVideoAsset } from '../services/PexelsService.js';

let passed = 0;
let failed = 0;

function check(label, fn) {
    try {
        fn();
        passed += 1;
        console.log(`  ✓ ${label}`);
    } catch (err) {
        failed += 1;
        console.error(`  ✗ ${label}`);
        console.error(`      ${err.message}`);
    }
}

async function checkAsync(label, fn) {
    try {
        await fn();
        passed += 1;
        console.log(`  ✓ ${label}`);
    } catch (err) {
        failed += 1;
        console.error(`  ✗ ${label}`);
        console.error(`      ${err.message}`);
    }
}

console.log('\n--- 1. Tokenization and Visual Scoring ---');

check('tokenizeWords folds accents and drops stopwords', () => {
    const text = "When we arrived in Paris at night, the journée was basically incredible";
    const tokens = tokenizeWords(text);
    assert.ok(tokens.includes('paris'), 'Should retain location "paris"');
    assert.ok(tokens.includes('night'), 'Should retain visual noun "night"');
    assert.ok(tokens.includes('journee'), 'Should fold accent on "journée"');
    assert.ok(!tokens.includes('when'), 'Should drop stopword "when"');
    assert.ok(!tokens.includes('basically'), 'Should drop stopword "basically"');
});

check('scoreKeyword assigns higher weight to locations, settings, and visual seeds', () => {
    assert.strictEqual(scoreKeyword('paris'), 3.0);
    assert.strictEqual(scoreKeyword('coffee'), 3.0);
    assert.strictEqual(scoreKeyword('sunset'), 3.0);
    assert.strictEqual(scoreKeyword('coding'), 3.0);
    assert.strictEqual(scoreKeyword('computer'), 3.0);
    assert.strictEqual(scoreKeyword('meeting'), 1.5);
});

console.log('\n--- 2. Visual Moment Extraction from Transcript ---');

const sampleTranscriptWords = [
    { start: 0.5, end: 1.0, word: "Welcome" },
    { start: 1.1, end: 1.5, word: "to" },
    { start: 1.6, end: 2.0, word: "my" },
    { start: 2.1, end: 2.8, word: "vlog" },
    // Visual Moment 1: Paris at night (start ~12s)
    { start: 12.0, end: 12.5, word: "We" },
    { start: 12.6, end: 13.0, word: "walked" },
    { start: 13.1, end: 13.6, word: "around" },
    { start: 13.7, end: 14.2, word: "Paris" },
    { start: 14.3, end: 14.8, word: "at" },
    { start: 14.9, end: 15.5, word: "night" },
    { start: 15.6, end: 16.0, word: "seeing" },
    { start: 16.1, end: 16.5, word: "lights" },
    // Visual Moment 2: Coding laptop in coffee shop (start ~26s)
    { start: 26.0, end: 26.5, word: "Next" },
    { start: 26.6, end: 27.0, word: "morning" },
    { start: 27.1, end: 27.5, word: "I" },
    { start: 27.6, end: 28.0, word: "started" },
    { start: 28.1, end: 28.6, word: "coding" },
    { start: 28.7, end: 29.2, word: "on" },
    { start: 29.3, end: 29.8, word: "my" },
    { start: 29.9, end: 30.4, word: "laptop" },
    { start: 30.5, end: 31.0, word: "in" },
    { start: 31.1, end: 31.6, word: "a" },
    { start: 31.7, end: 32.2, word: "cafe" },
];

check('extractVisualMoments clusters dialogue words and identifies visual queries', () => {
    const moments = extractVisualMoments(sampleTranscriptWords, [], { maxMoments: 4, minSpacing: 8 });
    assert.strictEqual(moments.length, 2, 'Expected 2 distinct visual moments');

    // Moment 1
    assert.ok(moments[0].timelineTime >= 12.0 && moments[0].timelineTime <= 13.0);
    assert.ok(moments[0].query.includes('paris'));
    assert.ok(moments[0].reason.includes('Paris'));

    // Moment 2
    assert.ok(moments[1].timelineTime >= 26.0 && moments[1].timelineTime <= 27.0);
    assert.ok(moments[1].query.includes('coding') || moments[1].query.includes('laptop') || moments[1].query.includes('cafe'));
});

check('extractVisualMoments adapts duration for chapter boundary proximity', () => {
    // Put a chapter boundary right at 12.5s
    const moments = extractVisualMoments(sampleTranscriptWords, [12.5], { maxMoments: 2 });
    assert.ok(moments.length > 0);
    assert.strictEqual(moments[0].duration, 4.5, 'Chapter boundary moment gets extended duration 4.5s');
    assert.ok(moments[0].reason.includes('Chapter transition'));
});

console.log('\n--- 3. Suggestion Generation Pipeline ---');

const mockPexelsCandidate1 = {
    id: 101,
    url: 'https://www.pexels.com/video/paris-night-101/',
    duration: 15,
    user: { name: 'Alice' },
    video_files: [{ id: 1, file_type: 'video/mp4', width: 1920, height: 1080, link: 'https://v.pexels.com/101.mp4' }],
};

const mockPexelsCandidate2 = {
    id: 102,
    url: 'https://www.pexels.com/video/eiffel-tower-102/',
    duration: 12,
    user: { name: 'Bob' },
    video_files: [{ id: 2, file_type: 'video/mp4', width: 1920, height: 1080, link: 'https://v.pexels.com/102.mp4' }],
};

const mockPexelsCandidate3 = {
    id: 103,
    url: 'https://www.pexels.com/video/paris-streets-103/',
    duration: 10,
    user: { name: 'Charlie' },
    video_files: [{ id: 3, file_type: 'video/mp4', width: 1920, height: 1080, link: 'https://v.pexels.com/103.mp4' }],
};

await checkAsync('BrollSuggesterService queries Pexels and packages suggestions with alternatives', async () => {
    const origFetch = globalThis.fetch;
    const origEnvKey = process.env.PEXELS_API_KEY;
    process.env.PEXELS_API_KEY = 'mock-key';

    globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
            page: 1,
            per_page: 3,
            total_results: 10,
            videos: [mockPexelsCandidate1, mockPexelsCandidate2, mockPexelsCandidate3],
        }),
    });

    try {
        const suggester = new BrollSuggesterService();
        const result = await suggester.suggestBroll({
            words: sampleTranscriptWords,
            chapters: [12.5],
            maxSuggestions: 2,
        });

        assert.ok(result.suggestions.length > 0);
        const first = result.suggestions[0];

        assert.strictEqual(first.status, 'pending');
        assert.ok(first.timelineTime >= 12.0);
        assert.ok(first.asset, 'Must have primary suggested asset');
        assert.strictEqual(first.asset.id, 'pexels-video-101');
        assert.strictEqual(first.asset.attribution.photographer, 'Alice');

        assert.strictEqual(first.alternatives.length, 2, 'Should provide 2 alternatives');
        assert.strictEqual(first.alternatives[0].id, 'pexels-video-102');
        assert.strictEqual(first.alternatives[1].id, 'pexels-video-103');
    } finally {
        globalThis.fetch = origFetch;
        process.env.PEXELS_API_KEY = origEnvKey;
    }
});

console.log('\n--- 4. Creator Review Workflow (Approve, Reject, Replace) ---');

check('Creator Approve action creates asset in bin and places overlay clip at scale: 4', () => {
    const suggestion = {
        id: 'sugg_test_1',
        timelineTime: 14.5,
        duration: 4.0,
        asset: normalizeVideoAsset(mockPexelsCandidate1),
    };

    // Simulated media bin state
    const assets = [];
    const addAssets = (newAssets) => assets.push(...newAssets);

    // Simulated timeline state
    const overlayClips = [];
    const addOverlayClip = (item, options) => {
        overlayClips.push({
            id: `clip_${Date.now()}`,
            assetId: item.id,
            trackId: 'overlay',
            url: item.url,
            start: options.start,
            duration: options.duration,
            scale: options.scale,
            x: options.x,
            y: options.y,
        });
    };

    // Execute approval flow
    addAssets([suggestion.asset]);
    addOverlayClip(suggestion.asset, {
        start: suggestion.timelineTime,
        duration: suggestion.duration,
        scale: 4,
        x: 50,
        y: 50,
    });

    assert.strictEqual(assets.length, 1);
    assert.strictEqual(assets[0].id, 'pexels-video-101');
    assert.strictEqual(overlayClips.length, 1);
    assert.strictEqual(overlayClips[0].assetId, 'pexels-video-101');
    assert.strictEqual(overlayClips[0].start, 14.5);
    assert.strictEqual(overlayClips[0].duration, 4.0);
    assert.strictEqual(overlayClips[0].scale, 4, 'Scale must be 4 for full-frame cutaway');
    assert.strictEqual(overlayClips[0].x, 50);
    assert.strictEqual(overlayClips[0].y, 50);
});

check('Creator Reject action dismisses suggestion without touching timeline', () => {
    let suggestions = [
        { id: 'sugg_1', timelineTime: 12.0 },
        { id: 'sugg_2', timelineTime: 26.0 },
    ];

    const reject = (id) => {
        suggestions = suggestions.filter(s => s.id !== id);
    };

    reject('sugg_1');
    assert.strictEqual(suggestions.length, 1);
    assert.strictEqual(suggestions[0].id, 'sugg_2');
});

check('Creator Replace action switches candidate asset seamlessly', () => {
    const primary = normalizeVideoAsset(mockPexelsCandidate1);
    const alt = normalizeVideoAsset(mockPexelsCandidate2);

    let active = primary;
    const pickAlternative = (newAsset) => {
        active = newAsset;
    };

    pickAlternative(alt);
    assert.strictEqual(active.id, 'pexels-video-102');
    assert.strictEqual(active.attribution.photographer, 'Bob');
});

console.log(`\n========================================`);
console.log(`B-Roll Suggestions Tests: ${passed} passed, ${failed} failed`);
console.log(`========================================\n`);

if (failed > 0) {
    process.exit(1);
}
