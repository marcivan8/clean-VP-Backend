#!/usr/bin/env node
/**
 * Regression: R82 — combinatorial animation synthesis ("mix presets from
 * the library together"), the follow-on to R81's per-instance intensity.
 *
 * Covers:
 *   1. server/audio-engine/timeline/AnimationCombiner.js — SECONDARY_PRESETS
 *      drift-checked against the REAL client/src/motion/MotionPresets.js
 *      MOTION_PRESETS keys (every id referenced, key or value, must be a
 *      preset that actually exists — a renamed/removed preset would silently
 *      resolve to nothing otherwise), each pairing spans a DIFFERENT
 *      animation `type` channel than its primary, `computeStyleSeed` /
 *      `pickSecondaryPreset` determinism and variety.
 *   2. Wiring — audioEngineRoutes.js only ever calls ProjectIntelligence's
 *      read-only `getMap` (never `ensureMap`/`deriveMap`, which call OpenAI
 *      and would silently reintroduce a paid dependency the user explicitly
 *      rejected — see CLAUDE.md's R80 revert entry), and attaches
 *      `secondaryPresetId` to each plan item; AnimationKnowledgeGraph.js's
 *      `resolveOverlayAnimations` does the same and accepts a `tone` param.
 *   3. End-to-end: the REAL `applyPresetToClip` (client/src/motion/
 *      ClipAdapter.js), evaluated against the REAL `buildPreset`
 *      (MotionPresets.js) and REAL `scaleAnimations` (AnimationSynthesizer.js)
 *      via the same CJS-strip-eval technique as test_animation_synthesizer.js,
 *      actually returns BOTH the primary's and the secondary's animations
 *      concatenated — not a source-regex proxy for that behaviour.
 *
 * Run: node scripts/test_animation_combiner.js
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

const {
    SECONDARY_PRESETS,
    computeStyleSeed,
    pickSecondaryPreset,
} = require(path.join(ROOT, 'server/audio-engine/timeline/AnimationCombiner.js'));

// ── Build the REAL MOTION_PRESETS (id → animation type) via strip-eval ──
function stripModuleSyntax(src) {
    return src
        .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
        .replace(/^\s*export\s+default\s+\{[\s\S]*?\};\s*$/gm, '')
        .replace(/\bexport\s+(const|function)\b/g, '$1');
}

let schemaSrc = read('client/src/motion/MotionSchema.js');
let presetsSrc = read('client/src/motion/MotionPresets.js');
let synthSrc  = read('client/src/motion/AnimationSynthesizer.js');

schemaSrc = stripModuleSyntax(schemaSrc).replace(/\bclamp\(/g, '__clamp(');
presetsSrc = stripModuleSyntax(presetsSrc);
synthSrc = stripModuleSyntax(synthSrc);

const motionHarness = `
const __clamp = (v, min, max) => Math.max(min, Math.min(max, v));
${schemaSrc}
${presetsSrc}
${synthSrc}
return { MOTION_PRESETS, buildPreset, createAnimation, createKeyframe, scaleAnimations };
`;

let motionMod = null;
try {
    // eslint-disable-next-line no-new-func
    motionMod = new Function(motionHarness)();
} catch (err) {
    failed++;
    console.log(`  ✗ could not evaluate MotionSchema.js + MotionPresets.js + AnimationSynthesizer.js — ${err.message}`);
}

if (!motionMod) {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(1);
}

const { MOTION_PRESETS, buildPreset, scaleAnimations } = motionMod;

// ── Extract the REAL applyPresetToClip body from ClipAdapter.js ──
const clipAdapterSrc = read('client/src/motion/ClipAdapter.js');
const applyMatch = clipAdapterSrc.match(/export function applyPresetToClip\(clip, presetId, opts = \{\}\) \{[\s\S]*?\n\}/);
let applyPresetToClip = null;
if (applyMatch) {
    const fnSrc = applyMatch[0].replace(/^export function/, 'function');
    const applyHarness = `
        const buildPreset = arguments[0];
        const scaleAnimations = arguments[1];
        ${fnSrc}
        return applyPresetToClip;
    `;
    try {
        // eslint-disable-next-line no-new-func
        applyPresetToClip = new Function(applyHarness)(buildPreset, scaleAnimations);
    } catch (err) {
        failed++;
        console.log(`  ✗ could not evaluate applyPresetToClip from ClipAdapter.js — ${err.message}`);
    }
} else {
    failed++;
    console.log('  ✗ could not locate applyPresetToClip in ClipAdapter.js (source shape changed?)');
}

section('1 · SECONDARY_PRESETS — every id (key AND value) is a REAL, currently-existing preset');
{
    const realIds = new Set(Object.keys(MOTION_PRESETS));
    const badKeys = Object.keys(SECONDARY_PRESETS).filter((id) => !realIds.has(id));
    check('every primary key exists in the real MOTION_PRESETS', badKeys.length === 0,
        `unknown primary keys: ${badKeys.join(', ')}`);

    const badValues = [];
    for (const [primary, secondaries] of Object.entries(SECONDARY_PRESETS)) {
        for (const secondary of secondaries) {
            if (!realIds.has(secondary)) badValues.push(`${primary} → ${secondary}`);
        }
    }
    check('every secondary value exists in the real MOTION_PRESETS', badValues.length === 0,
        `unknown secondary ids: ${badValues.join(', ')}`);
}

section('2 · SECONDARY_PRESETS — every pairing spans a DIFFERENT animation `type` than its primary');
{
    const typeOf = (id) => {
        const built = buildPreset(id, { duration: 2 });
        return built[0]?.type || null;
    };
    const sameChannelPairs = [];
    for (const [primary, secondaries] of Object.entries(SECONDARY_PRESETS)) {
        const primaryType = typeOf(primary);
        for (const secondary of secondaries) {
            if (typeOf(secondary) === primaryType) sameChannelPairs.push(`${primary}(${primaryType}) + ${secondary}(${typeOf(secondary)})`);
        }
    }
    check('no primary/secondary pair shares the same animation-type channel', sameChannelPairs.length === 0,
        sameChannelPairs.join('; '));
}

section('3 · computeStyleSeed / pickSecondaryPreset — determinism and real variety');
{
    const eventA = { eventType: 'PUNCHLINE_DETECTED', clipId: 'c1', metadata: { db: -1 } };
    check('the same event + tone always produces the same seed',
        computeStyleSeed(eventA, 'dramatic') === computeStyleSeed(eventA, 'dramatic'));
    check('a different clipId changes the seed',
        computeStyleSeed(eventA, 'dramatic') !== computeStyleSeed({ ...eventA, clipId: 'c2' }, 'dramatic'));
    check('a different tone changes the seed',
        computeStyleSeed(eventA, 'dramatic') !== computeStyleSeed(eventA, 'promotional'));
    check('a missing tone falls back to a stable "neutral" seed component, not a crash',
        computeStyleSeed(eventA, null) === computeStyleSeed(eventA, undefined));
    check('event metadata.text changes the seed (REVEAL/EMOTIONAL_BEAT free per-event signal)',
        computeStyleSeed({ ...eventA, metadata: { text: 'thank you' } }, null) !==
        computeStyleSeed({ ...eventA, metadata: { text: 'goodbye' } }, null));

    check('unknown primary → null, not a throw', pickSecondaryPreset('not-a-real-preset', 'seed') === null);
    check('null primary → null', pickSecondaryPreset(null, 'seed') === null);
    check('the same (primary, seed) pair always resolves to the same secondary',
        pickSecondaryPreset('pop', 'seedA') === pickSecondaryPreset('pop', 'seedA'));
    check('pop has more than one candidate, and different seeds can select different ones (real variety, not a fixed always-first)',
        (() => {
            const seen = new Set();
            for (let i = 0; i < 20; i++) seen.add(pickSecondaryPreset('pop', `seed-${i}`));
            return seen.size > 1 && [...seen].every((v) => SECONDARY_PRESETS['pop'].includes(v));
        })());
    check('a primary with exactly one candidate always returns that one, regardless of seed',
        pickSecondaryPreset('ken-burns', 'x') === 'float' && pickSecondaryPreset('ken-burns', 'y') === 'float');
}

section('4 · applyPresetToClip — REAL end-to-end combination (not a source-regex proxy)');
{
    if (typeof applyPresetToClip === 'function') {
        const clip = { duration: 2 };
        const primaryOnly = applyPresetToClip(clip, 'ken-burns');
        check('with no secondaryPresetId: exactly the primary\'s one animation (unchanged R81 behaviour)',
            Array.isArray(primaryOnly.animations) && primaryOnly.animations.length === 1 &&
            primaryOnly.animations[0].presetId === 'ken-burns');

        const combined = applyPresetToClip(clip, 'ken-burns', { intensity: 0.5, secondaryPresetId: 'float' });
        check('with secondaryPresetId="float": BOTH the primary and secondary animations are present',
            Array.isArray(combined.animations) && combined.animations.length === 2 &&
            combined.animations.some((a) => a.presetId === 'ken-burns') &&
            combined.animations.some((a) => a.presetId === 'float'));

        const unknownSecondary = applyPresetToClip(clip, 'ken-burns', { secondaryPresetId: 'not-a-real-preset' });
        check('an unknown secondaryPresetId degrades to primary-only, not a crash or an empty result',
            Array.isArray(unknownSecondary.animations) && unknownSecondary.animations.length === 1);

        check('animation:"none" is still set on a combined result (legacy field still cleared)',
            combined.animation === 'none');
    } else {
        failed++;
        console.log('  ✗ applyPresetToClip was not evaluable — skipping section 4');
    }
}

section('5 · wiring — the route reads tone READ-ONLY (getMap only, never ensureMap/deriveMap)');
{
    const routeSrc = read('server/routes/audioEngineRoutes.js');
    check('audioEngineRoutes.js requires AnimationCombiner.js',
        /require\(['"]\.\.\/audio-engine\/timeline\/AnimationCombiner\.js['"]\)/.test(routeSrc));
    check('audioEngineRoutes.js calls ProjectIntelligence().getMap(...)',
        /new ProjectIntelligence\(\)\.getMap\(projectId,\s*userId\)/.test(routeSrc));
    check('audioEngineRoutes.js NEVER calls ensureMap or deriveMap (both trigger a paid OpenAI call)',
        !/\.ensureMap\(/.test(routeSrc) && !/\.deriveMap\(/.test(routeSrc));
    check('the tone lookup is guarded by a try/catch that degrades to null, not a thrown request failure',
        /projectTone = null;[\s\S]{0,400}catch \(piErr\)/.test(routeSrc));
    check('audioEngineRoutes.js computes secondaryPresetId via pickSecondaryPreset(presetId, computeStyleSeed(event, projectTone))',
        /pickSecondaryPreset\(presetId,\s*computeStyleSeed\(event,\s*projectTone\)\)/.test(routeSrc));
    check('the route\'s plan item includes secondaryPresetId',
        /secondaryPresetId,\s*\n\s*intensity,/.test(routeSrc));
    check('resolveOverlayAnimations is now called with projectTone as a third argument',
        /resolveOverlayAnimations\(events, projectState\.tracks, projectTone\)/.test(routeSrc));

    const graphSrc = read('server/audio-engine/timeline/AnimationKnowledgeGraph.js');
    check('AnimationKnowledgeGraph.js requires AnimationCombiner.js',
        /require\(['"]\.\/AnimationCombiner\.js['"]\)/.test(graphSrc));
    check('resolveOverlayAnimations accepts a tone param defaulting to null',
        /function resolveOverlayAnimations\(events, tracks, tone = null\)/.test(graphSrc));
    check('resolveOverlayAnimations attaches secondaryPresetId to its plan items',
        /secondaryPresetId,\s*\n\s*intensity,/.test(graphSrc));
}

section('6 · wiring — client-side pass-through');
{
    check('ClipAdapter.js\'s applyPresetToClip builds+scales a secondary and concatenates it',
        /animations = animations\.concat\(scaleAnimations\(builtSecondary, opts\?\.intensity\)\)/.test(clipAdapterSrc));

    const mediaExecSrc = read('client/src/agent/MediaExecutionEngine.js');
    check('MediaExecutionEngine.js passes item.secondaryPresetId through to applyPresetToClip',
        /secondaryPresetId:\s*item\.secondaryPresetId/.test(mediaExecSrc));
    check('MediaExecutionEngine.js sends projectId in the /animate-automatically request (so the route can look up cached tone)',
        /projectId:\s*aaStore\.projectId \|\| null/.test(mediaExecSrc));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
