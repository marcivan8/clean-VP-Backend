/**
 * scripts/test_styles_motion_autofit.mjs
 *
 * Automated verification suite for Text Auto-Fit, Accent Bounding,
 * and Multi-Layer Motion Title Coordination across distinct editing styles:
 * 1. Talking Head (Direct Address / Authority)
 * 2. Viral Reel (Short-Form 9:16 Retention)
 * 3. Explainer (Vox-Style Data & Journalism)
 * 4. Podcast / Repurposed Clip (Warm Conversational Authority)
 */

import assert from 'assert';
import { buildComponent } from '../client/src/motion/ComponentLibrary.js';
import { fitTextToBox, computeAccentBounds, measureTextBounds } from '../client/src/motion/TextMeasurement.js';
import { evaluateMotionCompatibility, EDITING_STYLES, STYLE_MOTION_RULES } from '../client/src/agent/AnimationCompatibilityEvaluator.js';

console.log('=== RUNNING MULTI-STYLE MOTION & AUTO-FIT VERIFICATION ===\n');

// -------------------------------------------------------------
// Test 1: Style 1 — Talking Head Lower-Third Auto-Fit & Bounds
// -------------------------------------------------------------
console.log('Test 1: Talking Head Lower-Third Auto-Fit & Bounds');
{
    const shortName = 'Alex Rivera';
    const longName = 'Dr. Jacqueline Thorne-Montgomery';
    const longRole = 'Chief AI Research Scientist & Distinguished Fellow';

    // Verify compatibility evaluation
    const evalResult = evaluateMotionCompatibility(EDITING_STYLES.TALKING_HEAD, 'template', 'lower-third-minimal');
    assert.strictEqual(evalResult.verdict, 'ideal', 'lower-third-minimal should be ideal for talking_head');
    assert(evalResult.score >= 0.85, 'score should be high');

    // Build components with short vs long text
    const shortComp = buildComponent('LowerThird', 'pro-minimal', { title: shortName, subtitle: 'Product Lead' });
    const longComp = buildComponent('LowerThird', 'pro-minimal', { title: longName, subtitle: longRole });

    assert.strictEqual(shortComp.placements.length, 3, 'pro-minimal should have 3 placements');
    assert.strictEqual(longComp.placements.length, 3, 'pro-minimal should have 3 placements');

    const shortAccent = shortComp.placements[0].clip;
    const shortText = shortComp.placements[1].clip;
    const longAccent = longComp.placements[0].clip;
    const longText = longComp.placements[1].clip;

    // Assert auto-fitting scaled font down for long presenter name
    assert(shortText.fontSize > longText.fontSize, `Short name (${shortText.fontSize}px) should have larger font than long name (${longText.fontSize}px)`);
    // Assert underline dynamically expanded for long presenter name
    assert(longAccent.template.params.w > shortAccent.template.params.w * 1.8, `Long name underline (${longAccent.template.params.w}px) should be much wider than short name (${shortAccent.template.params.w}px)`);

    console.log(`  ✓ Short name font: ${shortText.fontSize}px, underline: ${shortAccent.template.params.w}px`);
    console.log(`  ✓ Long name font: ${longText.fontSize}px, underline: ${longAccent.template.params.w}px`);
}

// -------------------------------------------------------------
// Test 2: Style 2 — Viral Reel Kinetic Title Auto-Fit & Safe Zones
// -------------------------------------------------------------
console.log('\nTest 2: Viral Reel Kinetic Title Auto-Fit & Safe Zones');
{
    const reelRules = STYLE_MOTION_RULES.reel;
    assert.strictEqual(reelRules.pacing, 'rapid');

    const shortHook = 'SCALE 10X';
    const longHook = 'STOP WASTING 40 HOURS EDITING EVERY SINGLE WEEK';

    const shortReel = buildComponent('KineticTitle', 'punchy', {
        title: shortHook,
        kicker: 'PRO SECRET',
        accentColor: reelRules.palette.primary,
    });

    const longReel = buildComponent('KineticTitle', 'punchy', {
        title: longHook,
        kicker: 'CRITICAL WARNING',
        accentColor: reelRules.palette.primary,
    });

    const shortTitleClip = shortReel.placements.find(p => p.clip.content === shortHook).clip;
    const longTitleClip = longReel.placements.find(p => p.clip.content === longHook).clip;
    const shortBox = shortReel.placements.find(p => p.clip.template).clip;
    const longBox = longReel.placements.find(p => p.clip.template).clip;

    // Long hook must be scaled down to fit 9:16 mobile horizontal safe zone
    assert(longTitleClip.fontSize < shortTitleClip.fontSize, 'Long viral hook must scale down font');
    assert(longBox.template.params.w > shortBox.template.params.w * 2, 'Highlight box must dynamically widen for long hook');

    // Test StatCallout in Viral Reel
    const statComp = buildComponent('StatCallout', 'metric-callout', {
        value: '+340% RETENTION',
        label: 'ALGORITHM BOOST',
        accentColor: reelRules.palette.primary,
    });
    const statClip = statComp.placements.find(p => p.clip.content && p.clip.content.includes('+340%')).clip;
    const statCalloutShape = statComp.placements.find(p => p.clip.template).clip;
    assert(statCalloutShape.template.params.w > 300, 'Circle callout shape should dynamically bound the stat text');

    console.log(`  ✓ Short viral hook: ${shortTitleClip.fontSize}px, box: ${shortBox.template.params.w}px`);
    console.log(`  ✓ Long viral hook: ${longTitleClip.fontSize}px, box: ${longBox.template.params.w}px`);
    console.log(`  ✓ Viral stat callout bounded at: ${statCalloutShape.template.params.w}x${statCalloutShape.template.params.h}px`);
}

// -------------------------------------------------------------
// Test 3: Style 3 — Explainer / Vox Journalistic Title & Accent
// -------------------------------------------------------------
console.log('\nTest 3: Explainer / Vox Journalistic Title & Accent');
{
    const explainerRules = STYLE_MOTION_RULES.explainer;
    assert.strictEqual(explainerRules.pacing, 'deliberate');

    // Compatibility checks
    const underlineComp = evaluateMotionCompatibility(EDITING_STYLES.EXPLAINER, 'template', 'underline');
    assert.strictEqual(underlineComp.verdict, 'ideal');

    const thesisTitle = 'THE GEOPOLITICAL ECONOMICS OF SEMICONDUCTOR LITHOGRAPHY';
    const thesisSubtitle = 'Why high-NA EUV machinery controls global supply chains';

    const explainerTitle = buildComponent('TitleSequence', 'cinematic', {
        title: thesisTitle,
        subtitle: thesisSubtitle,
        kicker: 'INVESTIGATION #12',
        accentColor: explainerRules.palette.primary,
    });

    const titleClip = explainerTitle.placements.find(p => p.clip.content === thesisTitle).clip;
    const underlineClip = explainerTitle.placements.find(p => p.clip.template && p.clip.template.kind === 'underline').clip;

    // R95: a long thesis title must still scale down, but it is now allowed to
    // WRAP to a second line before shrinking (SceneLayout's measure and line
    // budget), which is better typography than forcing one tiny line. So the
    // check is the intent - a long title comes out smaller than a short one and
    // stays inside its measure - rather than the old fixed 44px, which pinned
    // the single-line implementation.
    const shortTitleComp = buildComponent('TitleSequence', 'cinematic', {
        title: 'LITHOGRAPHY',
        subtitle: thesisSubtitle,
        kicker: 'INVESTIGATION #12',
    });
    const shortTitleClipRef = shortTitleComp.placements.find(p => p.clip.content === 'LITHOGRAPHY').clip;
    assert(titleClip.fontSize < shortTitleClipRef.fontSize,
        `Explainer thesis title (${titleClip.fontSize}px) should scale down below a short one (${shortTitleClipRef.fontSize}px)`);
    assert(titleClip.fontSize <= 70, `Explainer title should still be bounded (got ${titleClip.fontSize}px)`);
    assert(underlineClip.template.params.w > 500, `Underline should stretch across long title (got ${underlineClip.template.params.w}px)`);

    console.log(`  ✓ Explainer thesis scaled to: ${titleClip.fontSize}px`);
    console.log(`  ✓ Explainer underline width: ${underlineClip.template.params.w}px`);
}

// -------------------------------------------------------------
// Test 4: Style 4 — Podcast & Repurposed Clip Aesthetic
// -------------------------------------------------------------
console.log('\nTest 4: Podcast & Repurposed Clip Aesthetic');
{
    const podcastRules = STYLE_MOTION_RULES.podcast;
    assert.strictEqual(podcastRules.pacing, 'calm');

    // Evaluate compatibility for quote card and lower third
    const quoteEval = evaluateMotionCompatibility(EDITING_STYLES.PODCAST, 'template', 'quote-card');
    assert.strictEqual(quoteEval.verdict, 'ideal');

    // Parameter adaptation for podcast style (should use warm gold palette)
    const adaptEval = evaluateMotionCompatibility(EDITING_STYLES.PODCAST, 'template', 'underline', {
        thickness: 18,
    });
    assert.strictEqual(adaptEval.adaptedParams.color, podcastRules.palette.primary, 'Adapted color should match podcast palette primary');

    // Test QuoteCard multi-line text measurement
    const longQuote = '"Focus is not about saying yes to what you want to do; it is saying no to the hundred other good ideas."';
    const quoteBounds = measureTextBounds(longQuote, {
        fontSize: 34,
        fontFamily: 'Inter',
        maxWidth: 520,
    });
    assert(quoteBounds.lines.length >= 3, `Quote should wrap to at least 3 lines (got ${quoteBounds.lines.length})`);
    assert(quoteBounds.width <= 520, `Quote width should stay within maxWidth`);

    console.log(`  ✓ Podcast parameter adaptation applied palette: ${adaptEval.adaptedParams.color}`);
    console.log(`  ✓ Multi-line quote wrapped to ${quoteBounds.lines.length} lines, width ${quoteBounds.width}px`);
}

console.log('\n=== ALL MULTI-STYLE MOTION VERIFICATION TESTS PASSED ===');
