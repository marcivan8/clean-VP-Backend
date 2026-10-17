/**
 * scripts/test_director_storytelling.mjs
 *
 * Test suite for Level 3 Director-Driven Visual Storytelling Engine.
 *
 * Verifies:
 *   1. Pacing Analysis: detects talking-head monotony and derives optimal cutaway duration.
 *   2. Treatment Classification: decides between Footage, Motion Graphics, Hybrid, and Speaker Focus.
 *   3. Speaker Visibility: assigns Behind-Speaker depth sandwiching, Picture-in-Picture, or Full Cutaway.
 *   4. Transition Dynamics: pairs entrance and exit motion curves (zoom cut, matte reveal, dissolve).
 *   5. End-to-end Storytelling Plan generation.
 */

import assert from 'node:assert';
import {
    VISUAL_TREATMENTS,
    SPEAKER_LAYOUTS,
    TRANSITION_PRESETS,
    analyzePacingNeed,
    decideVisualTreatment,
    decideSpeakerLayout,
    planTransitionStyling,
    generateStorytellingPlan,
} from '../client/src/motion/DirectorStoryteller.js';
import { CADENCE_TIERS } from '../client/src/motion/ArtDirector.js';

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

console.log('\n--- 1. Pacing Analysis & Talking-Head Monotony ---');

check('analyzePacingNeed detects continuous talking-head exceeding monotony threshold', () => {
    // 30 seconds of words with NO overlays
    const words = [];
    for (let t = 0; t < 30; t += 0.4) {
        words.push({ start: t, end: t + 0.35, word: `word_${t}` });
    }

    const res = analyzePacingNeed(words, []);
    assert.strictEqual(res.requiresPacingRelief, true);
    assert.ok(res.pacingSpans.length > 0);
    assert.ok(res.pacingSpans[0].duration >= 8.5);
    assert.ok(res.targetCutawayDuration > 0);
});

check('analyzePacingNeed adapts relief threshold to rapid vs deliberate cadence', () => {
    // Rapid cadence (~200 WPM)
    const rapidWords = [];
    for (let t = 0; t < 15; t += 0.28) {
        rapidWords.push({ start: t, end: t + 0.25, word: `word_${t}` });
    }
    const rapidRes = analyzePacingNeed(rapidWords, []);
    assert.strictEqual(rapidRes.cadence, CADENCE_TIERS.RAPID);
    assert.strictEqual(rapidRes.targetCutawayDuration, 2.2, 'Rapid speech should recommend ~2.2s snappy cutaway');

    // Deliberate cadence (~100 WPM)
    const deliberateWords = [];
    for (let t = 0; t < 15; t += 0.6) {
        deliberateWords.push({ start: t, end: t + 0.55, word: `word_${t}` });
    }
    const deliberateRes = analyzePacingNeed(deliberateWords, []);
    assert.strictEqual(deliberateRes.cadence, CADENCE_TIERS.DELIBERATE);
    assert.strictEqual(deliberateRes.targetCutawayDuration, 5.0, 'Deliberate speech should recommend ~5.0s cinematic cutaway');
});

console.log('\n--- 2. Visual Treatment Decision (Footage vs Motion Graphic vs Speaker Focus) ---');

check('decideVisualTreatment routes numeric statistics to Motion Graphics', () => {
    const res = decideVisualTreatment("In Q3 we achieved +350% growth across all channels");
    assert.strictEqual(res.treatment, VISUAL_TREATMENTS.MOTION_GRAPHIC);
    assert.ok(res.reason.includes('statistic') || res.reason.includes('metric'));

    const res2 = decideVisualTreatment("Here are the 3 rules you must follow");
    assert.strictEqual(res2.treatment, VISUAL_TREATMENTS.MOTION_GRAPHIC);
});

check('decideVisualTreatment preserves Speaker Focus on high-emotion confessions', () => {
    const res = decideVisualTreatment("The honest truth is I almost quit everything");
    assert.strictEqual(res.treatment, VISUAL_TREATMENTS.SPEAKER_FOCUS);
    assert.ok(res.reason.includes('vulnerability') || res.reason.includes('eye contact'));
});

check('decideVisualTreatment selects Hybrid for environmental data', () => {
    const res = decideVisualTreatment("In Tokyo over 45% of commuters take the subway every single day");
    assert.strictEqual(res.treatment, VISUAL_TREATMENTS.HYBRID);
    assert.ok(res.reason.includes('B-roll background with animated graphic card'));
});

check('decideVisualTreatment routes descriptive storytelling to Footage B-Roll', () => {
    const res = decideVisualTreatment("We strolled down the narrow streets of Paris at sunset");
    assert.strictEqual(res.treatment, VISUAL_TREATMENTS.FOOTAGE);
});

console.log('\n--- 3. Speaker Visibility & Depth Sandwiching ---');

check('decideSpeakerLayout assigns BEHIND_SPEAKER when subject mask is available', () => {
    const res = decideSpeakerLayout(VISUAL_TREATMENTS.FOOTAGE, { hasSubjectMask: true });
    assert.strictEqual(res.layout, SPEAKER_LAYOUTS.BEHIND_SPEAKER);
    assert.strictEqual(res.behindSubject, true);
    assert.ok(res.reason.includes('sandwich B-roll behind the speaker'));
});

check('decideSpeakerLayout assigns PICTURE_IN_PICTURE for instructional walkthroughs', () => {
    const res = decideSpeakerLayout(VISUAL_TREATMENTS.FOOTAGE, { isInstructional: true });
    assert.strictEqual(res.layout, SPEAKER_LAYOUTS.PICTURE_IN_PICTURE);
    assert.strictEqual(res.behindSubject, false);
});

check('decideSpeakerLayout defaults to FULL_CUTAWAY for standard narrative', () => {
    const res = decideSpeakerLayout(VISUAL_TREATMENTS.FOOTAGE, {});
    assert.strictEqual(res.layout, SPEAKER_LAYOUTS.FULL_CUTAWAY);
    assert.strictEqual(res.behindSubject, false);
});

console.log('\n--- 4. Transition Dynamics Planning ---');

check('planTransitionStyling pairs matte reveal & dissolve for behind-speaker layout', () => {
    const plan = planTransitionStyling(VISUAL_TREATMENTS.FOOTAGE, SPEAKER_LAYOUTS.BEHIND_SPEAKER);
    assert.strictEqual(plan.inTransition.type, TRANSITION_PRESETS.MATTE_REVEAL);
    assert.strictEqual(plan.outTransition.type, TRANSITION_PRESETS.CROSS_DISSOLVE);
});

check('planTransitionStyling adapts entrance and exit to rapid cadence in full cutaway', () => {
    const plan = planTransitionStyling(VISUAL_TREATMENTS.FOOTAGE, SPEAKER_LAYOUTS.FULL_CUTAWAY, CADENCE_TIERS.RAPID);
    assert.strictEqual(plan.inTransition.type, TRANSITION_PRESETS.ZOOM_CUT);
    assert.strictEqual(plan.outTransition.type, TRANSITION_PRESETS.WHIP_PAN);
    assert.strictEqual(plan.inTransition.duration, 0.25);
});

console.log('\n--- 5. End-to-End Director Storytelling Plan ---');

check('generateStorytellingPlan synthesizes diagnostics, treatments, and transitions', () => {
    const words = [
        { start: 0, end: 1, word: "Welcome" },
        { start: 1, end: 2, word: "everyone" },
        // Long speaking span
        { start: 2, end: 12, word: "When we visited Paris we spent the entire week exploring the architecture" },
        { start: 12, end: 24, word: "Our team grew by 250% over the next quarter" },
    ];

    const plan = generateStorytellingPlan({
        words,
        overlays: [],
        hasSubjectMask: true,
    });

    assert.ok(plan.recommendations.length > 0);
    const first = plan.recommendations[0];
    assert.ok(first.duration > 0);
    assert.ok(first.transitions.inTransition);
    assert.ok(first.transitions.outTransition);
    assert.strictEqual(first.behindSubject, true, 'Should recommend behindSubject when subject mask is ready');
});

console.log(`\n========================================`);
console.log(`Director Storytelling Tests: ${passed} passed, ${failed} failed`);
console.log(`========================================\n`);

if (failed > 0) {
    process.exit(1);
}
