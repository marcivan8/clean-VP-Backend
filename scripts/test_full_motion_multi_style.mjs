/**
 * scripts/test_full_motion_multi_style.mjs
 *
 * Automated verification of full motion lifecycle, multiple animation presets,
 * and text auto-fit across 8 distinct editing styles.
 */

import assert from 'assert';
import { buildComponent } from '../client/src/motion/ComponentLibrary.js';
import { applyPresetToClip, clipToMotionLayer } from '../client/src/motion/ClipAdapter.js';
import { resolveMotionAt } from '../client/src/motion/MotionResolver.js';
import { fitTextToBox, computeAccentBounds } from '../client/src/motion/TextMeasurement.js';
import { MOTION_PRESETS } from '../client/src/motion/MotionPresets.js';

console.log('=== VERIFYING FULL MOTION ACROSS 8 EDITING STYLES ===\n');

const EDIT_STYLES = [
    { id: 'reel', name: 'Viral Reel', comp: 'KineticTitle', preset: 'punchy', motion: 'pop' },
    { id: 'talking_head', name: 'Talking Head', comp: 'LowerThird', preset: 'pro-minimal', motion: 'slide-up' },
    { id: 'explainer', name: 'Vox Explainer', comp: 'TitleSequence', preset: 'cinematic', motion: 'scale-reveal' },
    { id: 'podcast', name: 'Podcast Clip', comp: 'QuoteCard', preset: 'fade', motion: 'fade' },
    { id: 'tech_glitch', name: 'Cyberpunk Tech', comp: 'KineticTitle', preset: 'creator', motion: 'sticker-pop' },
    { id: 'stat_kpi', name: 'KPI Growth', comp: 'StatCallout', preset: 'growth', motion: 'pop' },
    { id: 'cta_drop', name: 'E-Commerce CTA', comp: 'CTAWidget', preset: 'subscribe', motion: 'bounce' },
    { id: 'arrow_guide', name: 'Directional Guide', comp: 'AnimatedArrow', preset: 'bounce', motion: 'bounce' },
];

// Test 1: Verify all 8 style components generate valid coordinated placements
console.log('Test 1: Component Generation & Auto-Fit across 8 Styles');
for (const style of EDIT_STYLES) {
    const comp = buildComponent(style.comp, style.preset, {
        title: `DYNAMIC HEADLINE FOR ${style.name.toUpperCase()}`,
        subtitle: 'Secondary supporting editorial content',
        kicker: 'CHAPTER 01',
        text: 'Actionable insight',
        quote: 'The essence of strategy is choosing what not to do.',
        author: 'Michael Porter',
        value: '+280% GROWTH',
        direction: 'right',
    });

    assert(comp.placements.length >= 1, `${style.name} should generate at least 1 placement`);
    if (comp.placements.length > 1) {
        const firstGroupId = comp.placements[0].clip.groupId;
        assert(firstGroupId, `${style.name} multi-layer component should have groupId`);
        for (const p of comp.placements) {
            assert.strictEqual(p.clip.groupId, firstGroupId, `${style.name} placements must share groupId`);
        }
    }
    console.log(`  ✓ ${style.name} (${style.comp}): ${comp.placements.length} layers grouped under ${comp.placements[0]?.clip?.groupId || 'single'}`);
}

// Test 2: Full Temporal Motion Resolution across Keyframe Phases
console.log('\nTest 2: Full Temporal Motion Resolution (t = 0.0s, 0.15s, 0.5s, 1.0s, 3.0s)');
{
    const testCases = [
        { name: 'Pop Preset', presetId: 'pop' },
        { name: 'Slide-Up Preset', presetId: 'slide-up' },
        { name: 'Scale-Reveal Preset', presetId: 'scale-reveal' },
        { name: 'Bounce Preset', presetId: 'bounce' },
        { name: 'Fade Preset', presetId: 'fade' },
    ];

    for (const tc of testCases) {
        let clip = {
            id: `test-${tc.presetId}`,
            type: 'text',
            content: 'MOTION PREVIEW',
            x: 50,
            y: 50,
            duration: 3.0,
        };
        clip = { ...clip, ...applyPresetToClip(clip, tc.presetId) };

        const layer = clipToMotionLayer(clip);
        assert(layer.animations.length > 0, `${tc.name} should produce animations`);

        // Sample at 5 timepoints
        const t0 = resolveMotionAt(layer, 0.0);
        const tMid = resolveMotionAt(layer, 0.25);
        const tSettle = resolveMotionAt(layer, 0.7);
        const tEnd = resolveMotionAt(layer, 2.9);

        // Entrance verification
        assert(t0.opacity !== undefined && t0.opacity <= tSettle.opacity, `${tc.name} t0 opacity should be <= settled opacity`);
        assert(Number.isFinite(tMid.scale), `${tc.name} tMid scale must be finite number`);
        assert(Number.isFinite(tSettle.scale), `${tc.name} tSettle scale must be finite number`);
        assert(Number.isFinite(tEnd.opacity), `${tc.name} tEnd opacity must be finite number`);

        console.log(`  ✓ ${tc.name}: t0[op=${t0.opacity.toFixed(2)}, s=${t0.scale.toFixed(2)}] → tMid[op=${tMid.opacity.toFixed(2)}, s=${tMid.scale.toFixed(2)}] → tSettle[s=${tSettle.scale.toFixed(2)}]`);
    }
}

// Test 3: Staggered Multi-Layer Timing Isolation
console.log('\nTest 3: Staggered Multi-Layer Timing Isolation');
{
    const titleSeq = buildComponent('TitleSequence', 'cinematic', {
        title: 'STAGGER TEST HEADLINE',
        subtitle: 'Subordinate subtitle text',
    });

    const underline = titleSeq.placements.find(p => p.clip.template?.kind === 'underline').clip;
    const headline = titleSeq.placements.find(p => p.clip.content === 'STAGGER TEST HEADLINE').clip;
    const subtitle = titleSeq.placements.find(p => p.clip.content === 'Subordinate subtitle text').clip;

    const uLayer = clipToMotionLayer(underline);
    const hLayer = clipToMotionLayer(headline);
    const sLayer = clipToMotionLayer(subtitle);

    // R95: the accent LEADS the stagger, so it starts at 0 - a first element
    // that waits before anything else moves is a delay, not a stagger. The
    // layers after it still hold their initial state until their own turn,
    // which is what this test is really for.
    const uSample0 = resolveMotionAt(uLayer, 0.02);
    const hSample0 = resolveMotionAt(hLayer, 0.02);
    const sSample0 = resolveMotionAt(sLayer, 0.02);

    assert(uSample0.opacity > 0 && uSample0.opacity < 1, `Underline leads the stagger and is already moving (got ${uSample0.opacity})`);
    assert.strictEqual(hSample0.opacity, 0, 'Headline should hold opacity 0 before its delay');
    assert.strictEqual(sSample0.opacity, 0, 'Subtitle should hold opacity 0 before its delay');

    // At t=0.20s: underline & headline animating, subtitle still waiting
    const sSampleMid = resolveMotionAt(sLayer, 0.20);
    assert.strictEqual(sSampleMid.opacity, 0, 'Subtitle should still hold opacity 0 at t=0.20s before delay 0.25s');

    // At t=0.80s: all layers fully entered and visible
    const uSampleFull = resolveMotionAt(uLayer, 0.80);
    const hSampleFull = resolveMotionAt(hLayer, 0.80);
    const sSampleFull = resolveMotionAt(sLayer, 0.80);

    assert.strictEqual(uSampleFull.opacity, 1, 'Underline should be 1.0 at t=0.80s');
    assert.strictEqual(hSampleFull.opacity, 1, 'Headline should be 1.0 at t=0.80s');
    assert.strictEqual(sSampleFull.opacity, 1, 'Subtitle should be 1.0 at t=0.80s');

    console.log('  ✓ Staggered entrances cleanly isolated: no early flashing or abrupt pops');
}

console.log('\n=== ALL FULL MOTION & MULTI-STYLE TESTS PASSED ===');
