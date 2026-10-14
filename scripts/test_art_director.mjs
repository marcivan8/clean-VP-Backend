/**
 * scripts/test_art_director.mjs
 *
 * Test suite for Phase 4: Intelligent Art Direction & Director AI (Pillar E).
 *
 * Verifies:
 *   1. Visual Purpose Classification (intro, explain, emphasize, cta, chapter).
 *   2. Contextual Cadence derivation (rapid, measured, deliberate) from WPM.
 *   3. Contextual Adaptation to footage tempo, editing style, and purpose.
 *   4. Motion Coherence audit & gratuitous motion suppression.
 */

import assert from 'node:assert';
import {
    VISUAL_PURPOSES,
    CADENCE_TIERS,
    classifyVisualPurpose,
    deriveCadenceTier,
    adaptArtDirection,
    auditMotionCoherence,
} from '../client/src/motion/ArtDirector.js';

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

console.log('\n--- 1. Visual Purpose Classification ---');

check('classifyVisualPurpose recognizes intro/hook in opening window', () => {
    assert.strictEqual(classifyVisualPurpose({ content: 'Welcome to the Masterclass', start: 1.0 }, { totalDuration: 60 }), VISUAL_PURPOSES.INTRO);
    assert.strictEqual(classifyVisualPurpose({ content: 'Episode 4: The Secret', start: 0.5 }, { totalDuration: 30 }), VISUAL_PURPOSES.INTRO);
    assert.strictEqual(classifyVisualPurpose({ content: 'Random topic', start: 0.5 }, { isFirstClip: true, totalDuration: 60 }), VISUAL_PURPOSES.INTRO);
});

check('classifyVisualPurpose recognizes metrics and emphasized figures', () => {
    assert.strictEqual(classifyVisualPurpose({ content: '+450% Growth in Q3', start: 12.0 }, { totalDuration: 60 }), VISUAL_PURPOSES.EMPHASIZE);
    assert.strictEqual(classifyVisualPurpose({ content: '$1.2M Revenue Milestone', start: 15.0 }, { totalDuration: 60 }), VISUAL_PURPOSES.EMPHASIZE);
    assert.strictEqual(classifyVisualPurpose({ content: '10x Faster Deployment', start: 18.0 }, { totalDuration: 60 }), VISUAL_PURPOSES.EMPHASIZE);
});

check('classifyVisualPurpose recognizes call-to-actions at outro', () => {
    assert.strictEqual(classifyVisualPurpose({ content: 'Subscribe for part 2', start: 27.0, duration: 3.0 }, { totalDuration: 30 }), VISUAL_PURPOSES.CTA);
    assert.strictEqual(classifyVisualPurpose({ content: 'Link in bio to download', start: 10.0 }, { isLastClip: true, totalDuration: 30 }), VISUAL_PURPOSES.CTA);
});

check('classifyVisualPurpose identifies chapters and explanatory concepts', () => {
    assert.strictEqual(classifyVisualPurpose({ content: 'Chapter 2: The Core Rule', start: 14.0 }, { totalDuration: 60 }), VISUAL_PURPOSES.CHAPTER);
    assert.strictEqual(classifyVisualPurpose({ content: 'How standard models evaluate loss functions', start: 15.0 }, { totalDuration: 60 }), VISUAL_PURPOSES.EXPLAIN);
});

console.log('\n--- 2. Cadence Tier Derivation ---');

check('deriveCadenceTier computes accurate cadence from numeric WPM and speech arrays', () => {
    assert.strictEqual(deriveCadenceTier(180), CADENCE_TIERS.RAPID);
    assert.strictEqual(deriveCadenceTier(145), CADENCE_TIERS.MEASURED);
    assert.strictEqual(deriveCadenceTier(115), CADENCE_TIERS.DELIBERATE);

    const speechWords = [
        { word: 'Hello', start: 0.0, end: 0.4 },
        { word: 'everyone', start: 0.4, end: 0.8 },
        { word: 'welcome', start: 0.8, end: 1.2 },
        { word: 'back', start: 1.2, end: 1.6 },
    ];
    // 4 words in 1.6s -> 150 WPM (measured)
    assert.strictEqual(deriveCadenceTier(speechWords), CADENCE_TIERS.MEASURED);
});

console.log('\n--- 3. Contextual Adaptation ---');

check('adaptArtDirection adapts timing and springs to style and purpose', () => {
    // Punchy / rapid style
    const punchy = adaptArtDirection(VISUAL_PURPOSES.EMPHASIZE, { cadence: CADENCE_TIERS.RAPID, style: 'punchy' });
    assert.ok(punchy.entranceDuration <= 0.35, 'Punchy entrance must be snappy');
    assert.strictEqual(punchy.springPreset, 'bouncy');
    assert.strictEqual(punchy.suppressSecondaryMotion, false);

    // Calm / podcast style
    const podcast = adaptArtDirection(VISUAL_PURPOSES.EXPLAIN, { cadence: CADENCE_TIERS.DELIBERATE, style: 'podcast' });
    assert.ok(podcast.entranceDuration >= 0.55, 'Podcast entrance must be calm and measured');
    assert.strictEqual(podcast.springPreset, 'smooth');
    assert.strictEqual(podcast.suppressSecondaryMotion, true);
    assert.ok(podcast.energy < 0.6);
});

console.log('\n--- 4. Motion Coherence & Gratuitous Motion Suppression ---');

check('auditMotionCoherence detects unreadable short durations and crowded transitions', () => {
    const graphics = [
        { id: 'g1', start: 2.0, duration: 2.0, purpose: VISUAL_PURPOSES.INTRO },
        { id: 'g2', start: 4.1, duration: 0.4, purpose: VISUAL_PURPOSES.EXPLAIN }, // Too short (0.4s) and crowded (0.1s gap)
    ];

    const audit = auditMotionCoherence(graphics);
    assert.strictEqual(audit.isCoherent, false);
    assert.ok(audit.issues.some(i => i.includes('too short to be readable')));
    assert.ok(audit.issues.some(i => i.includes('Crowded transition')));
    assert.ok(audit.adjustments.has('g2'));
});

check('auditMotionCoherence flags continuous wobble on explanatory text', () => {
    const graphics = [
        {
            id: 'g-explain',
            start: 5.0,
            duration: 3.0,
            purpose: VISUAL_PURPOSES.EXPLAIN,
            animations: [{ repeat: { times: 0 }, presetId: 'wobble' }],
        },
    ];

    const audit = auditMotionCoherence(graphics);
    assert.strictEqual(audit.isCoherent, false);
    assert.ok(audit.issues.some(i => i.includes('continuous shaking')));
    assert.strictEqual(audit.adjustments.get('g-explain').removeContinuousWobble, true);
});

console.log('\n========================================');
console.log(`Results: ${passed} passed, ${failed} failed.`);
console.log('========================================\n');

if (failed > 0) process.exit(1);
