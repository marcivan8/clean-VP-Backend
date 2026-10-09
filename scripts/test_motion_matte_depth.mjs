/**
 * scripts/test_motion_matte_depth.mjs
 * Comprehensive validation of background removal, motion reveal transitions,
 * style compatibility rules, and depth sandwich layering.
 */
if (typeof globalThis.localStorage === 'undefined') {
    const store = new Map();
    globalThis.localStorage = {
        getItem: (k) => store.get(k) ?? null,
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear(),
    };
}

import assert from 'assert';
import { execSync } from 'child_process';
import ffmpegPath from 'ffmpeg-static';

const {
    MATTE_MODES,
    MATTE_REVEALS,
    MATTE_DEFAULTS,
    normalizeMatte,
    evaluateAnimatedMatte,
    alphaRamp,
    matteFilterGraph,
} = await import('../client/src/motion/MatteSettings.js');

const {
    STYLE_MOTION_RULES: SERVER_RULES,
    evaluateMotionCompatibility: serverEvalCompatibility,
    getRecommendedMotionSuite: serverGetSuite,
} = await import('../server/audio-engine/timeline/AnimationCompatibilityEvaluator.js');

const {
    STYLE_MOTION_RULES: CLIENT_RULES,
    evaluateMotionCompatibility: clientEvalCompatibility,
    getRecommendedMotionSuite: clientGetSuite,
} = await import('../client/src/agent/AnimationCompatibilityEvaluator.js');

const { backgroundFromText } = await import('../client/src/agent/EditPlanner.js');

console.log('🧪 Starting Motion Matte & Depth Layering Test Suite...\n');

let passed = 0;
function test(name, fn) {
    try {
        fn();
        console.log(`  ✅ ${name}`);
        passed++;
    } catch (err) {
        console.error(`  ❌ ${name}:`, err.message);
        throw err;
    }
}

// ── 1. MatteSettings Schema & Normalization ────────────────────────────────
test('MatteSettings exposes all required modes & reveals', () => {
    assert.deepStrictEqual(MATTE_MODES, ['blur', 'color', 'image', 'dim']);
    assert.ok(MATTE_REVEALS.includes('rack-focus'));
    assert.ok(MATTE_REVEALS.includes('focus-pull'));
    assert.ok(MATTE_REVEALS.includes('dim-spotlight'));
    assert.ok(MATTE_REVEALS.includes('flash-reveal'));
    assert.ok(MATTE_REVEALS.includes('zoom-drift'));
});

test('normalizeMatte handles custom and fallback reveal values', () => {
    const d = normalizeMatte();
    assert.strictEqual(d.reveal, 'none');
    assert.strictEqual(d.revealDuration, 0.7);
    assert.strictEqual(d.sandwich, false);

    const custom = normalizeMatte({
        reveal: 'rack-focus',
        revealDuration: 1.25,
        sandwich: true,
        blur: 24,
    });
    assert.strictEqual(custom.reveal, 'rack-focus');
    assert.strictEqual(custom.revealDuration, 1.25);
    assert.strictEqual(custom.sandwich, true);
    assert.strictEqual(custom.blur, 24);

    const bad = normalizeMatte({ reveal: 'invalid_mode', revealDuration: -5 });
    assert.strictEqual(bad.reveal, 'none');
    assert.strictEqual(bad.revealDuration, 0.1);
});

// ── 2. evaluateAnimatedMatte Real-Time Dynamics ───────────────────────────
test('evaluateAnimatedMatte calculates rack-focus transition curve', () => {
    const s = { mode: 'blur', blur: 16, reveal: 'rack-focus', revealDuration: 0.6 };
    const atStart = evaluateAnimatedMatte(s, 0);
    const atMid = evaluateAnimatedMatte(s, 0.3);
    const atEnd = evaluateAnimatedMatte(s, 0.6);
    const atPast = evaluateAnimatedMatte(s, 1.2);

    assert.ok(atStart.effectiveBlur > atMid.effectiveBlur, 'Blur should sweep down');
    assert.ok(atMid.effectiveBlur > atEnd.effectiveBlur, 'Blur continues sweeping down');
    assert.strictEqual(Math.round(atEnd.effectiveBlur), 16, 'Settles at target blur');
    assert.strictEqual(Math.round(atPast.effectiveBlur), 16, 'Remains at target blur past duration');
});

test('evaluateAnimatedMatte calculates dim-spotlight transition curve', () => {
    const s = { mode: 'dim', dim: 0.6, reveal: 'dim-spotlight', revealDuration: 0.5 };
    const atStart = evaluateAnimatedMatte(s, 0);
    const atMid = evaluateAnimatedMatte(s, 0.25);
    const atEnd = evaluateAnimatedMatte(s, 0.5);

    assert.strictEqual(atStart.effectiveDim, 0, 'Starts at 0 dim');
    assert.ok(atMid.effectiveDim > 0 && atMid.effectiveDim < 0.6, 'Dims progressively');
    assert.strictEqual(Math.round(atEnd.effectiveDim * 10) / 10, 0.6, 'Settles at target dim');
});

test('evaluateAnimatedMatte calculates flash-reveal dissipation', () => {
    const s = { mode: 'blur', blur: 18, reveal: 'flash-reveal', revealDuration: 0.4 };
    const atStart = evaluateAnimatedMatte(s, 0);
    const atEnd = evaluateAnimatedMatte(s, 0.4);

    assert.strictEqual(atStart.flashAlpha, 1.0, 'Starts with full flash burst');
    assert.strictEqual(atEnd.flashAlpha, 0.0, 'Flash completely dissipates');
});

test('evaluateAnimatedMatte calculates zoom-drift parallax scale', () => {
    const s = { mode: 'blur', blur: 18, reveal: 'zoom-drift', revealDuration: 1.0 };
    const atStart = evaluateAnimatedMatte(s, 0);
    const atEnd = evaluateAnimatedMatte(s, 1.0);

    assert.strictEqual(atStart.effectiveScale, 1.0, 'Starts at 1.0 scale');
    assert.ok(atEnd.effectiveScale > 1.04 && atEnd.effectiveScale <= 1.05, 'Drifts to ~1.05 scale');
});

// ── 3. FFmpeg Complex Filter Graph Parity ─────────────────────────────────
test('matteFilterGraph outputs valid lines for all reveal modes', () => {
    for (const rev of MATTE_REVEALS) {
        const graph = matteFilterGraph({ mode: 'blur', blur: 18, reveal: rev, revealDuration: 0.6 }, { width: 1080, height: 1920 });
        assert.ok(Array.isArray(graph) && graph.length >= 3, `Graph generated for ${rev}`);
        assert.ok(graph[graph.length - 1].includes('[outv]'), 'Graph outputs outv');
    }
});

test('matteFilterGraph incorporates sandwich layer filter when provided', () => {
    const graph = matteFilterGraph(
        { mode: 'blur', blur: 18 },
        { width: 1080, height: 1920, sandwichFilter: 'drawtext=text="KINETIC HEADLINE":fontsize=64:fontcolor=white' }
    );
    const joined = graph.join(';');
    assert.ok(joined.includes('KINETIC HEADLINE'), 'Sandwich filter text is included in pipeline');
    assert.ok(joined.includes('[bg_raw]drawtext'), 'Draws onto background plate before foreground composite');
});

test('FFmpeg executes real filter graph for rack-focus & dim-spotlight', () => {
    const testCases = [
        matteFilterGraph({ mode: 'blur', blur: 18, reveal: 'rack-focus', revealDuration: 0.5 }, { width: 320, height: 240 }),
        matteFilterGraph({ mode: 'dim', dim: 0.55, reveal: 'dim-spotlight', revealDuration: 0.5 }, { width: 320, height: 240 }),
        matteFilterGraph({ mode: 'blur', blur: 15, reveal: 'flash-reveal', revealDuration: 0.4 }, { width: 320, height: 240 }),
    ];

    for (const lines of testCases) {
        const filterStr = lines.join(';');
        const cmd = `${ffmpegPath} -f lavfi -i testsrc=size=320x240:rate=25:duration=1 -f lavfi -i color=c=white:size=320x240:duration=1 -filter_complex "${filterStr}" -map "[outv]" -f null -`;
        execSync(cmd, { stdio: 'pipe' });
    }
});

// ── 4. Editing Styles & AnimationCompatibilityEvaluator ───────────────────
test('Server & Client style definitions have complete backgroundTreatment rules', () => {
    const styles = ['talking_head', 'reel', 'vlog', 'repurposing', 'podcast', 'explainer'];
    for (const style of styles) {
        const sRule = SERVER_RULES[style];
        const cRule = CLIENT_RULES[style];
        assert.ok(sRule?.backgroundTreatment, `Server style ${style} has backgroundTreatment`);
        assert.ok(cRule?.backgroundTreatment, `Client style ${style} has backgroundTreatment`);
        assert.strictEqual(sRule.backgroundTreatment.recommendedMode, cRule.backgroundTreatment.recommendedMode);
        assert.strictEqual(sRule.backgroundTreatment.allowSandwichText, cRule.backgroundTreatment.allowSandwichText);
    }
});

test('evaluateMotionCompatibility scores background and depth categories', () => {
    // Talking head prefers blur and rack-focus, and allows sandwich text
    const thBg = serverEvalCompatibility('talking_head', 'background', 'blur');
    assert.strictEqual(thBg.verdict, 'ideal');
    assert.ok(thBg.score >= 0.95);

    const thDepth = serverEvalCompatibility('talking_head', 'depth', 'behind_subject');
    assert.strictEqual(thDepth.verdict, 'ideal');
    assert.strictEqual(thDepth.score, 0.98);

    // Vlog cautions against 3D text sandwiching
    const vlogDepth = serverEvalCompatibility('vlog', 'depth', 'behind_subject');
    assert.strictEqual(vlogDepth.verdict, 'caution');
    assert.ok(vlogDepth.score < 0.5);

    // Vlog rejects artificial solid backdrop
    const vlogColor = serverEvalCompatibility('vlog', 'background', 'color');
    assert.strictEqual(vlogColor.verdict, 'incompatible');
});

test('getRecommendedMotionSuite includes backgroundTreatment profile', () => {
    const suite = serverGetSuite('talking_head');
    assert.ok(suite.backgroundTreatment);
    assert.strictEqual(suite.backgroundTreatment.recommendedMode, 'blur');
    assert.strictEqual(suite.backgroundTreatment.reveal, 'rack-focus');
    assert.strictEqual(suite.backgroundTreatment.allowSandwichText, true);

    const cSuite = clientGetSuite('reel');
    assert.ok(cSuite.backgroundTreatment);
    assert.strictEqual(cSuite.backgroundTreatment.recommendedMode, 'dim');
    assert.strictEqual(cSuite.backgroundTreatment.reveal, 'dim-spotlight');
});

// ── 5. Natural Language Command & Planner Integration ─────────────────────
test('backgroundFromText extracts reveal intents correctly', () => {
    const r1 = backgroundFromText('blur the background with a rack focus');
    assert.strictEqual(r1.mode, 'blur');
    assert.strictEqual(r1.reveal, 'rack-focus');

    const r2 = backgroundFromText('spotlight the speaker with dim background');
    assert.strictEqual(r2.mode, 'dim');
    assert.strictEqual(r2.reveal, 'dim-spotlight');

    const r3 = backgroundFromText('flash reveal background');
    assert.strictEqual(r3.reveal, 'flash-reveal');

    const r4 = backgroundFromText('camera drift background');
    assert.strictEqual(r4.reveal, 'zoom-drift');
});

console.log(`\n🎉 ALL ${passed} TESTS PASSED CLEANLY! Motion matte reveals & depth sandwiching verified.\n`);
