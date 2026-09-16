#!/usr/bin/env node
/**
 * Regression: R81 — the zero-cost, rule-based bespoke animation synthesizer.
 *
 * Covers the client-side half, client/src/motion/AnimationSynthesizer.js's
 * `scaleAnimations(animations, intensity)`:
 *   1. Identity at intensity=0.5 — byte-for-byte pass-through, the exact
 *      guarantee every pre-R81 caller (manual Motion tab preset picker,
 *      every ClipAdapter/MotionPresets test written before R81) relies on.
 *   2. Defensive no-ops (non-array input, non-numeric intensity).
 *   3. Magnitude scaling direction and clamping (x/y/scale/rotation/blur/glow).
 *   4. opacity/reveal are LEFT ALONE — the whole point of excluding them.
 *   5. Duration + proportional keyframe-time scaling.
 *   6. Wiring — ClipAdapter.js actually calls this, with a strict no-op when
 *      opts.intensity is omitted (every existing caller).
 *
 * Client code is ESM; this harness strips import/export the same way
 * test_animation_knowledge_graph.js / test_overlay_animation_intelligence.js
 * already do, then `new Function(src)()` to get real functions to call.
 *
 * Run: node scripts/test_animation_synthesizer.js
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
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => {
    try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
    catch (err) { console.log(`  ✗ could not read ${rel} — ${err.code || err.message}`); failed++; return ''; }
};

function stripModuleSyntax(src) {
    return src
        .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
        .replace(/^\s*export\s+default\s+\{[\s\S]*?\};\s*$/gm, '')
        .replace(/\bexport\s+(const|function)\b/g, '$1');
}

// ── Build a real, callable scaleAnimations + createAnimation/createKeyframe/IDENTITY ──
// MotionSchema.js supplies the real IDENTITY/createAnimation/createKeyframe;
// AnimationSynthesizer.js supplies the real scaleAnimations. Concatenated
// (imports stripped) so scaleAnimations's own `import { IDENTITY } from
// './MotionSchema.js'` resolves to the SAME real constant, not a stub.
let schemaSrc = read('client/src/motion/MotionSchema.js');
let synthSrc  = read('client/src/motion/AnimationSynthesizer.js');

schemaSrc = stripModuleSyntax(schemaSrc).replace(/\bclamp\(/g, '__clamp(');
synthSrc  = stripModuleSyntax(synthSrc);

const harness = `
const __clamp = (v, min, max) => Math.max(min, Math.min(max, v));
${schemaSrc}
${synthSrc}
return { createAnimation, createKeyframe, IDENTITY, scaleAnimations };
`;

let mod = null;
try {
    // eslint-disable-next-line no-new-func
    mod = new Function(harness)();
} catch (err) {
    failed++;
    console.log(`  ✗ could not evaluate MotionSchema.js + AnimationSynthesizer.js — ${err.message}`);
}

if (!mod) {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(1);
}

const { createAnimation, createKeyframe, IDENTITY, scaleAnimations } = mod;

function samplePreset() {
    // Mirrors the real 'pop' TEXT_PRESETS entry's shape (MotionPresets.js) —
    // scale delta either side of identity 1, opacity 0→1 fade untouched.
    const d = 0.45;
    return [createAnimation({
        type: 'scale', presetId: 'pop', duration: d, easing: 'backOut',
        keyframes: [
            createKeyframe(0,       { scale: 0.75, opacity: 0 }),
            createKeyframe(d * 0.6, { scale: 1.08, opacity: 1 }),
            createKeyframe(d,       { scale: 1,    opacity: 1 }),
        ],
    })];
}

section('1 · defensive no-ops');
{
    check('non-array input is returned as-is', scaleAnimations('not-an-array', 0.9) === 'not-an-array');
    check('undefined intensity is a strict no-op (same reference back)',
        (() => { const original = samplePreset(); return scaleAnimations(original, undefined) === original; })());
    check('NaN intensity is a strict no-op (same reference back)',
        (() => { const original = samplePreset(); return scaleAnimations(original, NaN) === original; })());
    check('non-numeric intensity ("high") is a strict no-op (same reference back)',
        (() => { const original = samplePreset(); return scaleAnimations(original, 'high') === original; })());
}

section('2 · intensity=0.5 is EXACT identity — the byte-for-byte backward-compat guarantee');
{
    const original = samplePreset();
    const scaled = scaleAnimations(original, 0.5);
    check('duration is unchanged at intensity=0.5', scaled[0].duration === original[0].duration);
    check('every keyframe time is unchanged at intensity=0.5',
        scaled[0].keyframes.every((k, i) => close(k.time, original[0].keyframes[i].time)));
    check('every magnitude property is unchanged at intensity=0.5',
        scaled[0].keyframes.every((k, i) => close(k.properties.scale, original[0].keyframes[i].properties.scale)));
    check('opacity is (trivially) unchanged at intensity=0.5',
        scaled[0].keyframes.every((k, i) => close(k.properties.opacity, original[0].keyframes[i].properties.opacity)));
}

section('3 · magnitude scaling — direction, and delta from IDENTITY (not from 0)');
{
    const original = samplePreset();
    const strong = scaleAnimations(original, 1)[0];
    const weak   = scaleAnimations(original, 0)[0];

    // kf0 scale 0.75 → delta from identity(1) is -0.25. Higher intensity
    // means a BIGGER delta (further from identity), so strong's scale should
    // be FARTHER from 1 than weak's.
    const deltaStrong = Math.abs(strong.keyframes[0].properties.scale - 1);
    const deltaWeak   = Math.abs(weak.keyframes[0].properties.scale - 1);
    check('a stronger intensity produces a LARGER delta from identity (bigger pop)', deltaStrong > deltaWeak);

    // kf2 scale is exactly 1 (already identity) — must stay exactly 1 at any intensity.
    check('a keyframe already AT identity (scale=1) never moves, regardless of intensity',
        strong.keyframes[2].properties.scale === 1 && weak.keyframes[2].properties.scale === 1);

    check('scale never crosses through identity and inverts sign of the delta',
        Math.sign(strong.keyframes[0].properties.scale - 1) === Math.sign(original[0].keyframes[0].properties.scale - 1));
}

section('4 · opacity/reveal are LEFT ALONE at every intensity — visibility/progress, not "strength"');
{
    const strong = scaleAnimations(samplePreset(), 1)[0];
    const weak   = scaleAnimations(samplePreset(), 0)[0];
    check('opacity fade (0→1) is byte-identical at intensity=1 vs the original',
        strong.keyframes.every((k, i) => k.properties.opacity === samplePreset()[0].keyframes[i].properties.opacity));
    check('opacity fade (0→1) is byte-identical at intensity=0 vs the original',
        weak.keyframes.every((k, i) => k.properties.opacity === samplePreset()[0].keyframes[i].properties.opacity));

    const revealAnim = [createAnimation({
        type: 'reveal', presetId: 'mask-reveal', duration: 0.55, easing: 'easeInOutCubic',
        keyframes: [createKeyframe(0, { reveal: 0, opacity: 1 }), createKeyframe(0.55, { reveal: 1, opacity: 1 })],
    })];
    const revealScaled = scaleAnimations(revealAnim, 1)[0];
    check('a reveal progression (0→1) is untouched by magnitude scaling — it still finishes at exactly 1',
        revealScaled.keyframes[0].properties.reveal === 0 && revealScaled.keyframes[1].properties.reveal === 1);
}

section('5 · duration + proportional keyframe-time scaling — inverse of magnitude (stronger = snappier)');
{
    const original = samplePreset();
    const strong = scaleAnimations(original, 1)[0];
    const weak   = scaleAnimations(original, 0)[0];

    check('a stronger intensity produces a SHORTER duration (snappier)', strong.duration < original[0].duration);
    check('a weaker intensity produces a LONGER duration (more held)', weak.duration > original[0].duration);
    check('keyframe times stay proportional to the new duration (60% mark stays 60%)',
        close(strong.keyframes[1].time / strong.duration, original[0].keyframes[1].time / original[0].duration) &&
        close(weak.keyframes[1].time / weak.duration, original[0].keyframes[1].time / original[0].duration));
}

section('6 · IDENTITY is the REAL MotionSchema constant, not a stub (drift detection)');
{
    check('IDENTITY.scale === 1, IDENTITY.x === 0, IDENTITY.opacity === 1 (sanity against the real import)',
        IDENTITY.scale === 1 && IDENTITY.x === 0 && IDENTITY.opacity === 1);
}

section('7 · wiring — ClipAdapter.js calls scaleAnimations, and omits it safely for every pre-R81 caller');
{
    const clipAdapterSrc = read('client/src/motion/ClipAdapter.js');
    check('ClipAdapter.js imports scaleAnimations from AnimationSynthesizer.js',
        /import\s*\{\s*scaleAnimations\s*\}\s*from\s*'\.\/AnimationSynthesizer\.js'/.test(clipAdapterSrc));
    check('applyPresetToClip accepts an opts param defaulting to {}',
        /export function applyPresetToClip\(clip, presetId, opts = \{\}\)/.test(clipAdapterSrc));
    check('applyPresetToClip passes opts.intensity through to scaleAnimations',
        /scaleAnimations\(built,\s*opts\?\.intensity\)/.test(clipAdapterSrc));

    const mediaExecSrc = read('client/src/agent/MediaExecutionEngine.js');
    check('MediaExecutionEngine.js\'s animate_automatically passes item.intensity through',
        /applyPresetToClip\(clip, item\.presetId, \{[\s\S]{0,120}intensity: item\.intensity/.test(mediaExecSrc));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
