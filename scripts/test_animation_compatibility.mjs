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

log('\n─── 3. Expanded Modern Online Motion Elements ─────────────────────────');
const TG = await import('../client/src/motion/TemplateGraphics.js');

const MODERN_TEMPLATES = [
    'lower-third-minimal', 'location-badge', 'retention-progress-bar', 'quote-card',
    'comparison-card', 'social-notification', 'comment-bubble', 'kpi-stat-callout',
    'newspaper-headline', 'search-bar'
];

await check('all 10 modern templates registered in TEMPLATE_KINDS with defaults and valid geometry', () => {
    for (const k of MODERN_TEMPLATES) {
        assert.ok(TG.TEMPLATE_KINDS.includes(k), `${k} in TEMPLATE_KINDS`);
        assert.ok(TG.TEMPLATE_DEFAULTS[k], `${k} has default params`);
        assert.ok(TG.TEMPLATE_WIDTH_FRACTION[k] > 0, `${k} has width fraction`);
        const sz = TG.templateSize(k, {});
        assert.ok(sz.w > 0 && sz.h > 0, `${k} has valid dimensions (${sz.w}x${sz.h})`);
    }
});

await check('natural language parsing matches modern template kinds and arguments', () => {
    assert.equal(TG.templateFromText('add lower third "Sarah Connor"')?.kind, 'lower-third-minimal');
    assert.equal(TG.templateFromText('location pin "Tokyo"')?.[0]?.kind || TG.templateFromText('location pin "Tokyo"')?.kind, 'location-badge');
    assert.equal(TG.templateFromText('retention bar 80%')?.kind, 'retention-progress-bar');
    assert.equal(TG.templateFromText('quote card "Simplicity"')?.[0]?.kind || TG.templateFromText('quote card "Simplicity"')?.kind, 'quote-card');
    assert.equal(TG.templateFromText('comparison card "10x vs 1x"')?.[0]?.kind || TG.templateFromText('comparison card "10x vs 1x"')?.kind, 'comparison-card');
    assert.equal(TG.templateFromText('social notification "Subscribed"')?.[0]?.kind || TG.templateFromText('social notification "Subscribed"')?.kind, 'social-notification');
    assert.equal(TG.templateFromText('comment bubble "Great video"')?.[0]?.kind || TG.templateFromText('comment bubble "Great video"')?.kind, 'comment-bubble');
    assert.equal(TG.templateFromText('kpi stat callout "+240%"')?.[0]?.kind || TG.templateFromText('kpi stat callout "+240%"')?.kind, 'kpi-stat-callout');
    assert.equal(TG.templateFromText('newspaper headline "Breaking Launch"')?.[0]?.kind || TG.templateFromText('newspaper headline "Breaking Launch"')?.kind, 'newspaper-headline');
    assert.equal(TG.templateFromText('search bar "best AI tools"')?.[0]?.kind || TG.templateFromText('search bar "best AI tools"')?.kind, 'search-bar');
});

log('\n─── 4. Semantic Ontology Catalog & Query Engine ───────────────────────');

await check('MOTION_ELEMENT_CATALOG indexes all elements with complete metadata', () => {
    const catalog = ACE_client.MOTION_ELEMENT_CATALOG;
    assert.ok(Object.keys(catalog).length >= 20, 'catalog contains all core elements');

    for (const [id, item] of Object.entries(catalog)) {
        assert.equal(item.id, id);
        assert.ok(item.name, `${id} has human name`);
        assert.ok(item.category, `${id} has category`);
        assert.ok(['editorial', 'data_viz', 'social_proof', 'attention_hook', 'location_context', 'technical', 'vector_accent', 'ambient_texture', 'identification'].includes(item.category), `${id} category valid`);
        assert.ok(['lower_third', 'top_header', 'center_hero', 'side_rail', 'floating_corner', 'fullscreen_overlay'].includes(item.screenZone), `${id} screenZone valid`);
        assert.ok(item.defaultAlignment && typeof item.defaultAlignment.x === 'number' && typeof item.defaultAlignment.y === 'number', `${id} alignment valid`);
        assert.ok(Array.isArray(item.semanticTriggers) && item.semanticTriggers.length > 0, `${id} has triggers`);
        assert.ok(item.recommendedDuration > 0, `${id} has positive duration`);
    }
});

await check('queryMotionCatalog filters by category, screen zone, and semantic intent', () => {
    const topSocial = ACE_client.queryMotionCatalog({ category: 'social_proof' });
    assert.ok(topSocial.length >= 3, 'finds social proof elements');
    assert.ok(topSocial.some(e => e.id === 'social-notification'));
    assert.ok(topSocial.some(e => e.id === 'comment-bubble'));
    assert.ok(topSocial.some(e => e.id === 'comparison-card'));

    const lowerThirds = ACE_client.queryMotionCatalog({ screenZone: 'lower_third' });
    assert.ok(lowerThirds.some(e => e.id === 'lower-third-minimal'));

    const searchIntent = ACE_client.queryMotionCatalog({ intent: 'before after' });
    assert.ok(searchIntent.some(e => e.id === 'comparison-card'));

    const revenueIntent = ACE_client.queryMotionCatalog({ intent: 'revenue' });
    assert.ok(revenueIntent.some(e => e.id === 'data-counter'));
});

log('\n─── 5. Style Variation Presets & Rotation ──────────────────────────────');

await check('STYLE_VARIATION_PRESETS defines 3 distinct combination sets for each style', () => {
    const styles = ['talking_head', 'reel', 'vlog', 'repurposing', 'podcast', 'explainer'];
    for (const style of styles) {
        const presets = ACE_client.STYLE_VARIATION_PRESETS[style];
        assert.equal(presets.length, 3, `${style} has exactly 3 variation presets (Set A, B, C)`);

        // Check each preset structure
        for (const p of presets) {
            assert.ok(p.id, 'preset has id');
            assert.ok(p.name, 'preset has name');
            assert.ok(p.theme, 'preset has theme');
            assert.ok(p.captionPack, 'preset specifies caption pack');
            assert.ok(p.cameraMotion, 'preset specifies camera motion');
            assert.ok(p.transition, 'preset specifies transition');
            assert.ok(p.colorPalette && p.colorPalette.primary && p.colorPalette.accent, 'preset specifies palette');
            assert.ok(Array.isArray(p.motionElements) && p.motionElements.length >= 2, 'preset specifies motion combo');
            assert.ok(p.screenPlacementRecipe, 'preset specifies placement recipe');
        }
    }
});

await check('selectStyleVariation enables deterministic rotation and avoids repetition', () => {
    const varA = ACE_client.selectStyleVariation('talking_head', { seed: 0 });
    const varB = ACE_client.selectStyleVariation('talking_head', { seed: 1 });
    const varC = ACE_client.selectStyleVariation('talking_head', { seed: 2 });

    assert.ok(varA.id);
    assert.ok(varB.id);
    assert.ok(varC.id);

    // Test avoidance of repeated variation across consecutive edits
    const rotated = ACE_client.selectStyleVariation('talking_head', { avoidVariationId: varA.id });
    assert.notEqual(rotated.id, varA.id, 'rotates away from previous edit variation');

    // Test theme preference matching
    const dataPref = ACE_client.selectStyleVariation('talking_head', { themePreference: 'data' });
    assert.ok(dataPref.id.includes('data') || dataPref.theme.toLowerCase().includes('data'));
});

if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
} else {
    console.log('\nALL ANIMATION COMPATIBILITY & MOTION ELEMENT CHECKS PASSED\n');
}
