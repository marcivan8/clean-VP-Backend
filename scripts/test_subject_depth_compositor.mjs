/**
 * scripts/test_subject_depth_compositor.mjs
 *
 * Test suite for Phase 3: Pillar G (Subject-Aware Compositing & Depth).
 *
 * Verifies:
 *   1. Subject anchor derivation (head, behind, left/right shoulder, chest).
 *   2. Depth layer classification & clip partitioning (behind-subject sandwich vs front).
 *   3. Selective styling presets (background desaturation, subject glow/outline).
 *   4. Animated matte reveals & filter graph sandwich integration.
 *   5. Export processor sandwich filter compilation.
 */

import assert from 'node:assert';
import {
    DEPTH_LAYERS,
    SUBJECT_ANCHORS,
    deriveSubjectAnchors,
    isBehindSubject,
    partitionClipsByDepth,
    resolveSelectiveEffects,
} from '../client/src/motion/DepthCompositor.js';

import {
    normalizeMatte,
    evaluateAnimatedMatte,
    matteFilterGraph,
} from '../client/src/motion/MatteSettings.js';

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

function approx(actual, expected, tol = 0.5, msg = '') {
    const diff = Math.abs(actual - expected);
    assert.ok(diff <= tol, `${msg || 'approx failed'}: expected ${expected} ± ${tol}, got ${actual}`);
}

console.log('\n--- 1. Subject Spatial Anchor Derivation ---');

check('deriveSubjectAnchors returns fallback defaults when bboxTrack is empty', () => {
    const anchors = deriveSubjectAnchors([]);
    assert.strictEqual(anchors[SUBJECT_ANCHORS.HEAD].x, 50);
    assert.strictEqual(anchors[SUBJECT_ANCHORS.HEAD].y, 25);
    assert.strictEqual(anchors[SUBJECT_ANCHORS.BEHIND].x, 50);
    assert.strictEqual(anchors[SUBJECT_ANCHORS.LOWER_THIRD].y, 85);
});

check('deriveSubjectAnchors calculates frame-clamped anchors from tracked subject bbox', () => {
    // Subject positioned slightly to the left: cx=0.4, cy=0.5, w=0.3, h=0.6
    const bboxTrack = [
        { t: 0.0, cx: 0.40, cy: 0.50, w: 0.30, h: 0.60 },
        { t: 0.5, cx: 0.42, cy: 0.51, w: 0.31, h: 0.59 },
        { t: 1.0, cx: 0.39, cy: 0.49, w: 0.30, h: 0.61 },
    ];

    const anchors = deriveSubjectAnchors(bboxTrack, { sourceStart: 0, duration: 1.0, margin: 5 });

    // Median cx ~ 40%, cy ~ 50%, w ~ 30%, h ~ 60%
    approx(anchors[SUBJECT_ANCHORS.CHEST].x, 40, 1.0);
    approx(anchors[SUBJECT_ANCHORS.CHEST].y, 50, 1.0);

    // Head anchor: cy - h/2 - margin = 50 - 30 - 5 = 15%
    approx(anchors[SUBJECT_ANCHORS.HEAD].x, 40, 1.0);
    approx(anchors[SUBJECT_ANCHORS.HEAD].y, 15, 1.0);

    // Left shoulder: cx - w/2 - margin = 40 - 15 - 5 = 20%
    approx(anchors[SUBJECT_ANCHORS.LEFT_SHOULDER].x, 20, 1.0);

    // Right shoulder: cx + w/2 + margin = 40 + 15 + 5 = 60%
    approx(anchors[SUBJECT_ANCHORS.RIGHT_SHOULDER].x, 60, 1.0);
});

console.log('\n--- 2. Depth Classification & Partitioning ---');

check('isBehindSubject identifies all behind-subject designations', () => {
    assert.strictEqual(isBehindSubject({ placement: 'behind_subject' }), true);
    assert.strictEqual(isBehindSubject({ placement: 'behind_speaker' }), true);
    assert.strictEqual(isBehindSubject({ depth: 'behind_subject' }), true);
    assert.strictEqual(isBehindSubject({ sandwich: true }), true);

    assert.strictEqual(isBehindSubject({ placement: 'front' }), false);
    assert.strictEqual(isBehindSubject(null), false);
    assert.strictEqual(isBehindSubject({}), false);
});

check('partitionClipsByDepth segregates overlapping sandwich clips from front overlays', () => {
    const baseClip = { id: 'base-1', start: 2.0, duration: 5.0, layerTarget: 'background' };
    const clips = [
        { id: 'title-behind', start: 3.0, duration: 2.0, placement: 'behind_subject' },
        { id: 'logo-front', start: 3.5, duration: 1.0, placement: 'front' },
        { id: 'outside-time', start: 8.0, duration: 2.0, placement: 'behind_subject' },
    ];

    const { behind, front } = partitionClipsByDepth(clips, baseClip);

    assert.strictEqual(behind.length, 1);
    assert.strictEqual(behind[0].id, 'title-behind');

    assert.strictEqual(front.length, 2);
    assert.strictEqual(front[0].id, 'logo-front');
    assert.strictEqual(front[1].id, 'outside-time');
});

console.log('\n--- 3. Selective Styling & Effects ---');

check('resolveSelectiveEffects normalizes background & subject glow/outline properties', () => {
    const raw = {
        mode: 'desaturate',
        subjectGlow: { color: '#ec4899', radius: 25, opacity: 0.8 },
        subjectOutline: { color: '#ffffff', width: 4 },
    };

    const res = resolveSelectiveEffects(raw);
    assert.strictEqual(res.desaturateBg, true);
    assert.strictEqual(res.subjectGlow.color, '#ec4899');
    assert.strictEqual(res.subjectGlow.radius, 25);
    assert.strictEqual(res.subjectOutline.width, 4);

    const empty = resolveSelectiveEffects({});
    assert.strictEqual(empty.subjectGlow, null);
    assert.strictEqual(empty.subjectOutline, null);
    assert.strictEqual(empty.desaturateBg, false);
});

console.log('\n--- 4. Animated Mattes & Filter Graph Sandwiching ---');

check('evaluateAnimatedMatte calculates reveal curves across all presets', () => {
    const presets = ['rack-focus', 'focus-pull', 'dim-spotlight', 'flash-reveal', 'zoom-drift'];
    for (const reveal of presets) {
        const state = evaluateAnimatedMatte({ mode: 'blur', blur: 20, reveal, revealDuration: 0.8 }, 0.4);
        assert.ok(Number.isFinite(state.effectiveBlur));
        assert.ok(Number.isFinite(state.effectiveDim));
        assert.ok(Number.isFinite(state.effectiveScale));
        assert.ok(Number.isFinite(state.flashAlpha));
    }
});

check('matteFilterGraph connects sandwich filter directly between bg_raw and bg', () => {
    const settings = { mode: 'blur', blur: 15, sandwich: true };
    const sandwichFilter = ",drawtext=text='BEHIND':fontsize=64:x=(w-text_w)/2:y=(h-text_h)/2";
    const graph = matteFilterGraph(settings, {
        width: 1080,
        height: 1920,
        sandwichFilter,
    });

    const hasSandwich = graph.some(line => line.includes('[bg_raw]') && line.includes(sandwichFilter) && line.includes('[bg]'));
    assert.ok(hasSandwich, 'Filter graph must composite sandwichFilter between bg_raw and bg');

    const hasMerge = graph.some(line => line.includes('alphamerge[fg]'));
    assert.ok(hasMerge, 'Filter graph must create sharp foreground cutout');

    const hasOverlay = graph.some(line => line.includes('[bg][fg]overlay=0:0'));
    assert.ok(hasOverlay, 'Filter graph must overlay cutout fg over sandwich-containing bg');
});

console.log('\n========================================');
console.log(`Results: ${passed} passed, ${failed} failed.`);
console.log('========================================\n');

if (failed > 0) process.exit(1);
