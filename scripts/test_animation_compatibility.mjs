// scripts/test_animation_compatibility.mjs
// Verifies the Style-Aware Motion Compatibility Engine and new online motion elements.
import assert from 'assert/strict';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const log = console.log;
let failures = 0;
const check = async (name, fn) => {
    try {
        await fn();
        log(`✓ ${name}`);
    } catch (err) {
        failures += 1;
        log(`✗ ${name}\n    ${err.message}`);
    }
};

log('\n─── 1. Style-Aware Motion Compatibility Rules ─────────────────────────');
const ACE_client = await import('../client/src/agent/AnimationCompatibilityEvaluator.js');
const ACE_server = await import('../server/audio-engine/timeline/AnimationCompatibilityEvaluator.js');

await check('evaluator defines all standard editing styles', () => {
    for (const style of ['talking_head', 'reel', 'vlog', 'repurposing', 'podcast', 'explainer']) {
        assert.ok(ACE_client.STYLE_MOTION_RULES[style], `${style} defined in client rules`);
        assert.ok(ACE_server.STYLE_MOTION_RULES[style], `${style} defined in server rules`);
    }
});

await check('talking head style allows lower thirds and clean data charts, rejects noisy glitch', () => {
    const resGood = ACE_client.evaluateMotionCompatibility('talking_head', 'template', 'lower-third-minimal');
    assert.equal(resGood.verdict, 'ideal');
    assert.ok(resGood.score >= 0.85);
    assert.ok(resGood.compatible);

    const resGraph = ACE_client.evaluateMotionCompatibility('talking_head', 'template', 'line-graph');
    assert.equal(resGraph.verdict, 'ideal');
    assert.ok(resGraph.compatible);

    const resBad = ACE_client.evaluateMotionCompatibility('talking_head', 'template', 'vhs-glitch');
    assert.equal(resBad.verdict, 'incompatible');
    assert.ok(resBad.score < 0.45);
    assert.ok(!resBad.compatible);
    assert.ok(resBad.alternatives.length > 0, 'provides clean alternatives');
});

await check('talking head style flags chaotic Hormozi captions and rapid punch-ins', () => {
    const resHormozi = ACE_client.evaluateMotionCompatibility('talking_head', 'caption', 'hormozi-bounce');
    assert.equal(resHormozi.verdict, 'incompatible');
    assert.ok(!resHormozi.compatible);

    const resVox = ACE_client.evaluateMotionCompatibility('talking_head', 'caption', 'vox-highlighter');
    assert.equal(resVox.verdict, 'ideal');
    assert.ok(resVox.compatible);

    const resCamera = ACE_client.evaluateMotionCompatibility('talking_head', 'camera', 'dynamic');
    assert.equal(resCamera.verdict, 'incompatible');
    assert.ok(!resCamera.compatible);
});

await check('reel / short-form style prioritizes retention bars, Hormozi bounce, and punchy transitions', () => {
    const resProg = ACE_client.evaluateMotionCompatibility('reel', 'template', 'retention-progress-bar');
    assert.equal(resProg.verdict, 'ideal');
    assert.ok(resProg.compatible);

    const resBounce = ACE_client.evaluateMotionCompatibility('reel', 'caption', 'hormozi-bounce');
    assert.equal(resBounce.verdict, 'ideal');
    assert.ok(resBounce.compatible);

    const resWhip = ACE_client.evaluateMotionCompatibility('reel', 'transition', 'whip-left');
    assert.equal(resWhip.verdict, 'ideal');
    assert.ok(resWhip.compatible);

    const resDip = ACE_client.evaluateMotionCompatibility('reel', 'transition', 'dip');
    assert.equal(resDip.verdict, 'incompatible');
    assert.ok(!resDip.compatible, 'slow dips rejected on fast short-form reels');
});

await check('vlog style prefers location badges, film grain, and casual callouts', () => {
    const resLoc = ACE_client.evaluateMotionCompatibility('vlog', 'template', 'location-badge');
    assert.equal(resLoc.verdict, 'ideal');
    assert.ok(resLoc.compatible);

    const resGrain = ACE_client.evaluateMotionCompatibility('vlog', 'template', 'film-grain');
    assert.equal(resGrain.verdict, 'ideal');
    assert.ok(resGrain.compatible);

    const resCode = ACE_client.evaluateMotionCompatibility('vlog', 'template', 'code-window');
    assert.equal(resCode.verdict, 'incompatible');
    assert.ok(!resCode.compatible);
});

await check('repurposing style allows quote cards and safe zone captions', () => {
    const resQuote = ACE_client.evaluateMotionCompatibility('repurposing', 'template', 'quote-card');
    assert.equal(resQuote.verdict, 'ideal');
    assert.ok(resQuote.compatible);

    const suite = ACE_client.getRecommendedMotionSuite('repurposing');
    assert.ok(suite.recommendedTemplates.includes('quote-card'));
    assert.ok(suite.safeZones.bottom >= 0.75, 'safe zone margin enforced');
});

log('\n─── 2. Multi-Step Plan Validation & Auto-Adaptation ───────────────────');

await check('validateAndAdaptPlan detects clashing actions and auto-adapts them', () => {
    const proposedPlan = [
        { action: 'add_template', args: { kind: 'vhs-glitch' } },
        { action: 'apply_caption_pack', args: { packId: 'hormozi-bounce' } },
        { action: 'rhythm_zoom', args: { style: 'dynamic' } },
        { action: 'add_transition', args: { type: 'flash' } },
    ];

    const result = ACE_client.validateAndAdaptPlan('talking_head', proposedPlan);
    assert.ok(!result.valid, 'initial unadapted plan is marked incompatible for talking head');
    assert.equal(result.warnings.length, 4, 'all 4 clashing steps flagged');

    // Check auto-adaptation
    const adapted = result.adaptedPlan;
    assert.notEqual(adapted[0].args.kind, 'vhs-glitch', 'adapted template changed away from glitch');
    assert.equal(adapted[1].args.packId, 'vox-highlighter', 'adapted caption pack to vox-highlighter');
    assert.equal(adapted[2].args.style, 'subtle', 'adapted camera motion to subtle');
    assert.equal(adapted[3].args.type, 'dip', 'adapted transition to dip');
});

log('\n─── 3. New Modern Online Motion Elements ──────────────────────────────');
const TG = await import('../client/src/motion/TemplateGraphics.js');

await check('all 4 new templates registered in TEMPLATE_KINDS', () => {
    for (const k of ['lower-third-minimal', 'location-badge', 'retention-progress-bar', 'quote-card']) {
        assert.ok(TG.TEMPLATE_KINDS.includes(k), `${k} in TEMPLATE_KINDS`);
        assert.ok(TG.TEMPLATE_DEFAULTS[k], `${k} has default params`);
        assert.ok(TG.TEMPLATE_WIDTH_FRACTION[k] > 0, `${k} has width fraction`);
        const sz = TG.templateSize(k, {});
        assert.ok(sz.w > 0 && sz.h > 0, `${k} has valid dimensions`);
    }
});

await check('natural language parsing matches new templates', () => {
    assert.equal(TG.templateFromText('add lower third "Sarah Connor"')?.kind, 'lower-third-minimal');
    assert.equal(TG.templateFromText('location pin "Tokyo"')?.[0]?.kind || TG.templateFromText('location pin "Tokyo"')?.kind, 'location-badge');
    assert.equal(TG.templateFromText('retention bar 80%')?.kind, 'retention-progress-bar');
    assert.equal(TG.templateFromText('quote card "Simplicity"')?.[0]?.kind || TG.templateFromText('quote card "Simplicity"')?.kind, 'quote-card');
});

if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
} else {
    console.log('\nALL ANIMATION COMPATIBILITY & MOTION ELEMENT CHECKS PASSED\n');
}
