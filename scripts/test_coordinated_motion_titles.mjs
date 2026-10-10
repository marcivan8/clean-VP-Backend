/**
 * scripts/test_coordinated_motion_titles.mjs
 *
 * Automated verification for Coordinated Multi-Layer Motion Graphics:
 * 1. MotionResolver staggered entrance holding behaviour (anchor === 'in' with delay).
 * 2. Backward compatibility of all existing ComponentLibrary components.
 * 3. TitleSequence, KineticTitle, and StatCallout component generation, layering, and shared groupId.
 * 4. Procedural shape LowerThird (pro-minimal / modern-line).
 * 5. TimelineStateManager persistence roundtrip of placement & groupId.
 */

import assert from 'node:assert/strict';
import { resolveMotionAt, sampleAnimation } from '../client/src/motion/MotionResolver.js';
import { COMPONENT_IDS, COMPONENT_PRESETS, buildComponent } from '../client/src/motion/ComponentLibrary.js';
import { applyPresetToClip } from '../client/src/motion/ClipAdapter.js';
import { TimelineStateManager } from '../client/src/timeline/TimelineStateManager.js';
import { measureTextBounds, fitTextToBox, computeAccentBounds } from '../client/src/motion/TextMeasurement.js';

console.log('=== RUNNING COORDINATED MOTION TITLES VERIFICATION ===\n');

// ── 1. MotionResolver Staggered Timing Test ─────────────────────────────
console.log('Test 1: MotionResolver Staggered Entrance Keyframe Hold');
{
    // Apply a fade entrance with a 0.3s stagger delay to a 4s clip
    const update = applyPresetToClip({ duration: 4 }, 'fade', { delay: 0.3 });
    assert(Array.isArray(update.animations), 'applyPresetToClip should produce animations array');
    const entranceAnim = update.animations.find(a => a.anchor === 'in');
    assert(entranceAnim, 'Should have an entrance animation');
    assert.equal(entranceAnim.startTime, 0.3, 'Entrance animation startTime should be offset by delay');

    // Layer initial base properties (starts at absoluteTime = 0, duration = 4s)
    const layer = {
        id: 'title-text',
        startTime: 0,
        duration: 4,
        opacity: 1,
        animations: update.animations,
    };

    // Sample at t = 0.0s (before entrance startTime of 0.3s)
    const stateAtZero = resolveMotionAt(layer, 0.0);
    assert.equal(
        stateAtZero.opacity,
        0,
        `At t=0.0s, layer opacity should hold initial entrance keyframe (0), but got ${stateAtZero.opacity}`
    );

    // Sample at t = 0.15s (still before 0.3s)
    const stateAtHalfDelay = resolveMotionAt(layer, 0.15);
    assert.equal(
        stateAtHalfDelay.opacity,
        0,
        `At t=0.15s, layer opacity should still hold initial keyframe (0), but got ${stateAtHalfDelay.opacity}`
    );

    // Sample at t = 0.3s + anim.duration (fully entered)
    const stateEntered = resolveMotionAt(layer, 0.3 + entranceAnim.duration + 0.05);
    assert.equal(
        stateEntered.opacity,
        1,
        `After entrance completes, opacity should be 1, but got ${stateEntered.opacity}`
    );

    console.log('  ✓ Staggered entrance holds initial keyframe without popping on at base values');
}

// ── 2. Backward Compatibility of Existing Components ───────────────────
console.log('\nTest 2: Backward Compatibility of All Existing Components');
{
    const legacyComponents = [
        ['AnimatedText', 'fade', { text: 'Hello' }],
        ['AnimatedImage', 'zoom', { url: '/test.png' }],
        ['AnimatedSticker', 'pop', { url: '/sticker.png' }],
        ['AnimatedEmoji', 'bounce', { emoji: '🔥' }],
        ['AnimatedArrow', 'point', { direction: 'right' }],
        ['LowerThird', 'dark', { title: 'Alex Mercer', subtitle: 'Product Lead' }],
        ['Callout', 'light', { text: 'Important notice' }],
        ['QuoteCard', 'classic', { quote: 'Simplicity is prerequisite for reliability.', author: 'Dijkstra' }],
        ['CTAWidget', 'subscribe', {}],
    ];

    for (const [id, preset, params] of legacyComponents) {
        const result = buildComponent(id, preset, params);
        assert(!result.error, `Legacy component ${id} (${preset}) errored: ${result.error}`);
        assert(result.placements.length > 0, `Legacy component ${id} produced no placements`);
    }

    console.log('  ✓ All 9 pre-existing components build without error');
}

// ── 3. TitleSequence Component Generation & Choreography ───────────────
console.log('\nTest 3: TitleSequence Coordinated Multi-Layer Generation');
{
    const presets = ['cinematic', 'modern-bold', 'minimal'];
    for (const preset of presets) {
        const result = buildComponent('TitleSequence', preset, {
            title: 'REVOLUTIONARY MOTION',
            subtitle: 'Crafted with precision',
            kicker: 'EPISODE 01',
            duration: 4,
        });

        assert(!result.error, `TitleSequence (${preset}) failed: ${result.error}`);
        assert(result.placements.length >= 3, `TitleSequence should produce at least 3 layers, got ${result.placements.length}`);

        // Verify shared groupId across all layers
        const firstGroupId = result.placements[0].clip.groupId;
        assert(firstGroupId, 'Every layer must have a groupId stamped');
        for (const p of result.placements) {
            assert.equal(p.clip.groupId, firstGroupId, 'All layers must share the exact same groupId');
        }

        // Verify procedural template presence and text clips
        const templatePlacement = result.placements.find(p => p.clip.type === 'template');
        assert(templatePlacement, 'TitleSequence must include a procedural accent shape template');
        assert(templatePlacement.clip.template?.kind, 'Template clip must have valid template.kind');

        const textPlacements = result.placements.filter(p => p.clip.type === 'text');
        assert(textPlacements.length >= 2, 'TitleSequence must have headline and subtitle text clips');

        // Check staggered entrance timings
        const headline = textPlacements.find(p => p.clip.content === 'REVOLUTIONARY MOTION');
        assert(headline, 'Must find headline clip');
        const headlineEntrance = headline.clip.animations?.find(a => a.anchor === 'in');
        assert(headlineEntrance, 'Headline must have entrance animation');
        assert(headlineEntrance.startTime > 0, `Headline entrance should be staggered (>0), got ${headlineEntrance.startTime}`);

        console.log(`  ✓ TitleSequence (${preset}): ${result.placements.length} layers, shared groupId ${firstGroupId}`);
    }
}

// ── 4. KineticTitle & StatCallout Generation ────────────────────────────
console.log('\nTest 4: KineticTitle & StatCallout Generation');
{
    // KineticTitle punchy
    const kinetic = buildComponent('KineticTitle', 'punchy', {
        kicker: 'PRO SECRET',
        title: 'NEVER SETTLE',
    });
    assert(!kinetic.error, `KineticTitle failed: ${kinetic.error}`);
    assert(kinetic.placements.length >= 2, 'KineticTitle should have multiple layers');
    const kineticGroupId = kinetic.placements[0].clip.groupId;
    assert(kineticGroupId, 'KineticTitle must have shared groupId');
    assert(kinetic.placements.every(p => p.clip.groupId === kineticGroupId));
    console.log(`  ✓ KineticTitle (punchy): ${kinetic.placements.length} layers, shared groupId ${kineticGroupId}`);

    // StatCallout metric-callout
    const stat = buildComponent('StatCallout', 'metric-callout', {
        value: '+280%',
        label: 'YEAR OVER YEAR',
    });
    assert(!stat.error, `StatCallout failed: ${stat.error}`);
    assert(stat.placements.length >= 2, 'StatCallout should have multiple layers');
    const statGroupId = stat.placements[0].clip.groupId;
    assert(statGroupId, 'StatCallout must have shared groupId');
    assert(stat.placements.every(p => p.clip.groupId === statGroupId));
    console.log(`  ✓ StatCallout (metric-callout): ${stat.placements.length} layers, shared groupId ${statGroupId}`);

    // Procedural LowerThird pro-minimal
    const l3 = buildComponent('LowerThird', 'pro-minimal', {
        title: 'Marc-Ivan',
        subtitle: 'Lead Architect',
    });
    assert(!l3.error, `LowerThird pro-minimal failed: ${l3.error}`);
    const l3Template = l3.placements.find(p => p.clip.type === 'template');
    assert(l3Template, 'LowerThird pro-minimal must use procedural template shape');
    console.log(`  ✓ LowerThird (pro-minimal): procedural accent ${l3Template.clip.template.kind} + ${l3.placements.length} layers`);
}

// ── 5. Timeline Persistence Roundtrip Test ─────────────────────────────
console.log('\nTest 5: Timeline Persistence Roundtrip (placement & groupId)');
{
    const title = buildComponent('TitleSequence', 'cinematic', { title: 'PERSISTENCE TEST' });
    const mockTracks = [
        {
            id: 't-text',
            type: 'text',
            clips: [
                {
                    id: 'c1',
                    trackId: 't-text',
                    start: 1,
                    duration: 3,
                    ...title.placements.find(p => p.clip.type === 'text').clip,
                    placement: { role: 'headline', depth: 1 },
                },
            ],
        },
        {
            id: 't-overlay',
            type: 'overlay',
            clips: [
                {
                    id: 'c2',
                    trackId: 't-overlay',
                    start: 1,
                    duration: 3,
                    ...title.placements.find(p => p.clip.type === 'template').clip,
                    placement: { role: 'accent', depth: 0 },
                },
            ],
        },
    ];

    const manager = new TimelineStateManager();
    manager.fromLegacyTracks(mockTracks);

    // Project to legacy tracks (saved format)
    const saved = manager.toLegacyTracks();
    assert.equal(saved.length, 2);
    assert.equal(saved[0].clips[0].groupId, title.placements[0].clip.groupId, 'groupId must persist in toLegacyTracks');
    assert.deepEqual(saved[0].clips[0].placement, { role: 'headline', depth: 1 }, 'placement must persist in toLegacyTracks');

    // Restore into a fresh manager from legacy tracks
    const freshManager = new TimelineStateManager();
    freshManager.fromLegacyTracks(saved);
    const restored = freshManager.toLegacyTracks();
    assert.equal(restored.length, 2);
    assert.equal(restored[0].clips[0].groupId, title.placements[0].clip.groupId, 'groupId must restore in fromLegacyTracks');
    assert.deepEqual(restored[0].clips[0].placement, { role: 'headline', depth: 1 }, 'placement must restore in fromLegacyTracks');
    assert.deepEqual(restored[1].clips[0].placement, { role: 'accent', depth: 0 }, 'accent placement must restore in fromLegacyTracks');

    console.log('  ✓ TimelineStateManager roundtrips placement and groupId flawlessly');
}

// ── 6. Text Auto-Fit & Dynamic Accent Bounding Boxes ─────────────────────
console.log('\nTest 6: Text Auto-Fit & Dynamic Accent Bounding Boxes');
{
    // Test measureTextBounds
    const shortBounds = measureTextBounds('AI', { fontSize: 56, fontFamily: 'Montserrat' });
    const longBounds = measureTextBounds('REVOLUTIONARY MOTION DESIGN IN ACTION', { fontSize: 56, fontFamily: 'Montserrat' });
    assert.ok(shortBounds.width > 0, 'Short text width must be > 0');
    assert.ok(longBounds.width > shortBounds.width, 'Long text must measure wider than short text');

    // Test fitTextToBox auto-fit scaling
    const fittedShort = fitTextToBox('SHORT', { maxWidth: 860, maxHeight: 180 }, { initialFontSize: 64 });
    assert.equal(fittedShort.fontSize, 64, 'Short text should retain base font size');
    assert.equal(fittedShort.isScaledDown, false, 'Short text should not be scaled down');

    const longHeadline = 'THIS IS AN EXTREMELY LONG HEADLINE THAT WOULD NORMALLY OVERFLOW THE REFERENCE CANVAS BOX COMPLETELY';
    const fittedLong = fitTextToBox(longHeadline, { maxWidth: 860, maxHeight: 180 }, { initialFontSize: 64, minFontSize: 24 });
    assert.ok(fittedLong.fontSize < 64, `Long text must be scaled down: got ${fittedLong.fontSize}`);
    assert.ok(fittedLong.width <= 860, `Fitted width (${fittedLong.width}) must not exceed maxWidth (860)`);
    assert.equal(fittedLong.isScaledDown, true, 'Long text must be flagged as scaled down');

    // Test computeAccentBounds for highlight-box and underline
    const shortAccent = computeAccentBounds('AI', { shapeKind: 'highlight-box', fontSize: 56 });
    const longAccent = computeAccentBounds('REVOLUTIONARY MOTION DESIGN', { shapeKind: 'highlight-box', fontSize: 56 });
    assert.ok(shortAccent.w < longAccent.w, `Short accent width (${shortAccent.w}) must be smaller than long accent width (${longAccent.w})`);
    assert.ok(shortAccent.scale < longAccent.scale, `Short accent scale (${shortAccent.scale}) must be smaller than long accent scale (${longAccent.scale})`);

    // Test ComponentLibrary integration: TitleSequence with short vs long title
    const compShort = buildComponent('TitleSequence', 'cinematic', { title: 'AI' });
    const compLong = buildComponent('TitleSequence', 'cinematic', { title: 'THE COMPLETE REVOLUTION OF VIDEO EDITING' });

    const shortTpl = compShort.placements.find(p => p.clip.type === 'template');
    const longTpl = compLong.placements.find(p => p.clip.type === 'template');
    assert.ok(shortTpl && longTpl, 'Both must produce template accent clips');
    assert.ok(shortTpl.clip.template.params.w < longTpl.clip.template.params.w,
        `Template clip w must dynamically scale with text length: ${shortTpl.clip.template.params.w} vs ${longTpl.clip.template.params.w}`);
    assert.ok(shortTpl.clip.scale < longTpl.clip.scale,
        `Template clip scale must dynamically scale with text length: ${shortTpl.clip.scale} vs ${longTpl.clip.scale}`);

    console.log(`  ✓ Text auto-fit: short retained @ ${fittedShort.fontSize}px, long auto-fitted to ${fittedLong.fontSize}px`);
    console.log(`  ✓ Dynamic accent bounding: short width ${shortTpl.clip.template.params.w}px (scale ${shortTpl.clip.scale}) vs long width ${longTpl.clip.template.params.w}px (scale ${longTpl.clip.scale})`);
}

console.log('\n=== ALL COORDINATED MOTION TITLE TESTS PASSED ===');

