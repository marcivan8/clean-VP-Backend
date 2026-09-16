#!/usr/bin/env node
/**
 * Regression: R81 — the zero-cost, rule-based bespoke animation synthesizer.
 *
 * Covers the server-side half, server/audio-engine/timeline/
 * AnimationIntensity.js:
 *   1. `computeIntensity` — every eventType branch, both directions
 *      (louder/longer → higher intensity), the neutral (0.5) fallback for
 *      missing/unusable metadata, and clamping outside the normal range.
 *   2. `pickPresetForIntensity` — the priority-ordered candidate selection.
 *   3. Wiring — audioEngineRoutes.js and AnimationKnowledgeGraph.js both
 *      actually use this module rather than a stray reimplementation.
 *
 * Run: node scripts/test_animation_intensity.js
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

const { TimelineEventType } = require(path.join(ROOT, 'server/audio-engine/types.js'));
const {
    NEUTRAL_INTENSITY,
    computeIntensity,
    pickPresetForIntensity,
} = require(path.join(ROOT, 'server/audio-engine/timeline/AnimationIntensity.js'));

section('1 · computeIntensity — neutral fallback (missing/unusable metadata never throws, never guesses)');
{
    check('NEUTRAL_INTENSITY is exactly 0.5 (the documented identity midpoint)', NEUTRAL_INTENSITY === 0.5);
    check('PUNCHLINE_DETECTED with no metadata → neutral',
        computeIntensity(TimelineEventType.PUNCHLINE_DETECTED, undefined) === NEUTRAL_INTENSITY);
    check('EMPHASIS_MOMENT with no metadata → neutral',
        computeIntensity(TimelineEventType.EMPHASIS_MOMENT, {}) === NEUTRAL_INTENSITY);
    check('EMOTIONAL_BEAT with no metadata → neutral',
        computeIntensity(TimelineEventType.EMOTIONAL_BEAT, null) === NEUTRAL_INTENSITY);
    check('REVEAL with no metadata → neutral',
        computeIntensity(TimelineEventType.REVEAL, undefined) === NEUTRAL_INTENSITY);
    check('an unknown eventType → neutral, not a throw',
        computeIntensity('SOMETHING_ELSE', { db: 0 }) === NEUTRAL_INTENSITY);
}

section('2 · computeIntensity — EMPHASIS_MOMENT (metadata.db, EMPHASIS_PEAK_DB=-4 .. 0dB)');
{
    check('db at the -4dB floor → 0 (weakest qualifying emphasis)',
        computeIntensity(TimelineEventType.EMPHASIS_MOMENT, { db: -4 }) === 0);
    check('db at 0dBFS (loudest possible) → 1',
        computeIntensity(TimelineEventType.EMPHASIS_MOMENT, { db: 0 }) === 1);
    check('db at -2dB (midpoint of -4..0) → 0.5',
        close(computeIntensity(TimelineEventType.EMPHASIS_MOMENT, { db: -2 }), 0.5));
    check('a louder db always yields a higher-or-equal intensity than a quieter one',
        computeIntensity(TimelineEventType.EMPHASIS_MOMENT, { db: -1 }) >
        computeIntensity(TimelineEventType.EMPHASIS_MOMENT, { db: -3 }));
    check('db below the floor clamps to 0, does not go negative',
        computeIntensity(TimelineEventType.EMPHASIS_MOMENT, { db: -40 }) === 0);
    check('db above 0dBFS clamps to 1',
        computeIntensity(TimelineEventType.EMPHASIS_MOMENT, { db: 6 }) === 1);
}

section('3 · computeIntensity — PUNCHLINE_DETECTED (metadata.db + metadata.silenceGapS, averaged)');
{
    check('db at the -8dB floor AND silenceGapS at 0 → 0',
        computeIntensity(TimelineEventType.PUNCHLINE_DETECTED, { db: -8, silenceGapS: 0 }) === 0);
    check('db at 0dBFS AND silenceGapS at the 1.2s ceiling → 1',
        computeIntensity(TimelineEventType.PUNCHLINE_DETECTED, { db: 0, silenceGapS: 1.2 }) === 1);
    check('a loud db but a short gap lands strictly between the two extremes',
        (() => {
            const v = computeIntensity(TimelineEventType.PUNCHLINE_DETECTED, { db: 0, silenceGapS: 0 });
            return v > 0 && v < 1;
        })());
    check('only db present (silenceGapS missing) still returns a usable value from db alone',
        computeIntensity(TimelineEventType.PUNCHLINE_DETECTED, { db: 0 }) === 1);
    check('only silenceGapS present (db missing) still returns a usable value from the gap alone',
        computeIntensity(TimelineEventType.PUNCHLINE_DETECTED, { silenceGapS: 1.2 }) === 1);
}

section('4 · computeIntensity — EMOTIONAL_BEAT (metadata.durationS, 1.0s floor .. 3.0s ceiling)');
{
    check('durationS at the 1.0s floor → 0',
        computeIntensity(TimelineEventType.EMOTIONAL_BEAT, { durationS: 1.0 }) === 0);
    check('durationS at the 3.0s ceiling → 1',
        computeIntensity(TimelineEventType.EMOTIONAL_BEAT, { durationS: 3.0 }) === 1);
    check('a longer held pause always yields a higher-or-equal intensity',
        computeIntensity(TimelineEventType.EMOTIONAL_BEAT, { durationS: 2.5 }) >
        computeIntensity(TimelineEventType.EMOTIONAL_BEAT, { durationS: 1.2 }));
    check('durationS beyond the ceiling clamps to 1, does not exceed it',
        computeIntensity(TimelineEventType.EMOTIONAL_BEAT, { durationS: 30 }) === 1);
}

section('5 · computeIntensity — REVEAL (push-in variant scales on zoomLevel; keyword variant is honestly neutral)');
{
    check('push-in at the 1.3 zoom floor → 0',
        computeIntensity(TimelineEventType.REVEAL, { via: 'push-in', zoomLevel: 1.3 }) === 0);
    check('push-in at the 2.0 zoom ceiling → 1',
        computeIntensity(TimelineEventType.REVEAL, { via: 'push-in', zoomLevel: 2.0 }) === 1);
    check('a bigger push-in always yields a higher-or-equal intensity',
        computeIntensity(TimelineEventType.REVEAL, { via: 'push-in', zoomLevel: 1.8 }) >
        computeIntensity(TimelineEventType.REVEAL, { via: 'push-in', zoomLevel: 1.4 }));
    check('the keyword variant (no numeric signal) is honestly neutral, not a fabricated guess',
        computeIntensity(TimelineEventType.REVEAL, { via: 'keyword', text: 'check this out' }) === NEUTRAL_INTENSITY);
}

section('6 · computeIntensity — CHAPTER_START (no numeric signal exists yet — documented limitation, not a bug)');
{
    check('a real R79 chapter_transition metadata shape ({markerClipId,label}) → neutral',
        computeIntensity(TimelineEventType.CHAPTER_START, { markerClipId: 'm1', label: 'Chapter 2' }) === NEUTRAL_INTENSITY);
}

section('7 · pickPresetForIntensity — priority-ordered candidate selection');
{
    check('empty candidates → null', pickPresetForIntensity([], 0.9) === null);
    check('non-array candidates → null', pickPresetForIntensity(undefined, 0.9) === null);
    check('a single candidate is always returned regardless of intensity',
        pickPresetForIntensity(['only-one'], 0.01) === 'only-one');
    check('intensity at or above neutral (0.5) picks index 0',
        pickPresetForIntensity(['strong', 'soft'], 0.5) === 'strong' &&
        pickPresetForIntensity(['strong', 'soft'], 1) === 'strong');
    check('intensity below neutral picks index 1 when one exists',
        pickPresetForIntensity(['strong', 'soft'], 0.2) === 'soft');
    check('a non-numeric/invalid intensity falls back to neutral behaviour (index 0)',
        pickPresetForIntensity(['strong', 'soft'], undefined) === 'strong' &&
        pickPresetForIntensity(['strong', 'soft'], NaN) === 'strong');
    check('more than 2 candidates: below-neutral still lands on index 1, not further down',
        pickPresetForIntensity(['a', 'b', 'c'], 0.1) === 'b');
}

section('8 · wiring — the route and the knowledge graph both actually use this module');
{
    const routeSrc = read('server/routes/audioEngineRoutes.js');
    check('audioEngineRoutes.js requires AnimationIntensity.js',
        /require\(['"]\.\.\/audio-engine\/timeline\/AnimationIntensity\.js['"]\)/.test(routeSrc));
    check('audioEngineRoutes.js computes intensity per event before choosing a preset',
        /computeIntensity\(event\.eventType,\s*event\.metadata\)/.test(routeSrc));
    check('audioEngineRoutes.js uses pickPresetForIntensity instead of a bare [0] index',
        /pickPresetForIntensity\(candidates,\s*intensity\)/.test(routeSrc));
    check('the route\'s plan item includes intensity alongside presetId',
        /presetId,\s*\n\s*secondaryPresetId,\s*\n\s*intensity,\s*\n\s*sfx,/.test(routeSrc));

    const graphSrc = read('server/audio-engine/timeline/AnimationKnowledgeGraph.js');
    check('AnimationKnowledgeGraph.js requires AnimationIntensity.js',
        /require\(['"]\.\/AnimationIntensity\.js['"]\)/.test(graphSrc));
    check('resolveOverlayAnimations also computes and attaches intensity',
        /computeIntensity\(event\.eventType,\s*event\.metadata\)/.test(graphSrc) &&
        /pickPresetForIntensity\(candidates,\s*intensity\)/.test(graphSrc));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
