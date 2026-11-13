/**
 * scripts/test_ae_ai_agent_capabilities.mjs
 *
 * Comprehensive test suite verifying that the AI and agent architecture
 * natively handles the complete After Effects motion engine capabilities:
 *   1. Motion Knowledge Engine & Skill Classification:
 *      - Search and classification for expressions (audioAmp, wiggle, loopOut, spring)
 *      - Track mattes (alpha, alpha-inverted, luma, luma-inverted)
 *      - Hierarchical parenting & constraints
 *      - Vector shape trim paths & draw-on paths
 *      - Cinematic effect racks & 16 blend modes
 *      - Creator aesthetic identities (Vox, Ali Abdaal, MrBeast, Iman Gadzhi, Apple, Hormozi)
 *   2. Server-side Prompt Synthesis & Sanitization:
 *      - buildMotionPrompt & buildScenePlanPrompt injection of AE engine directives
 *      - cleanBeat preservation and validation of expressions, trackMatte, parentId, trim, blendMode
 *   3. Agent Intent Parsing & Command Registry:
 *      - Natural language prompt resolution in English and French
 *      - Accurate parameter extraction (property, expression, mode, preset, target)
 *   4. End-to-End Tool Execution:
 *      - apply_motion_expression: validation, channel updates, syntax error rejection
 *      - set_track_matte: target/source linking, mode validation
 *      - set_layer_parent: parent linking, cycle prevention & rejection
 *      - set_vector_trim: trim config & kinetic draw-on keyframes
 *      - apply_aesthetic_preset: multi-layer styling (grading, effects rack, typography) with undo safety
 */

import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);

import assert from 'assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nodeRequire = createRequire(path.join(ROOT, 'package.json'));

// Stub browser environment globals
globalThis.localStorage = {
    _m: {},
    getItem(k) { return this._m[k] ?? null; },
    setItem(k, v) { this._m[k] = String(v); },
    removeItem(k) { delete this._m[k]; },
};
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.innerWidth = 1200;
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' });

// Stub Supabase credentials for standalone Node runs
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'dummy-key';

let passed = 0;
let failed = 0;

function log(msg = '') {
    process.stdout.write(msg + '\n');
}

async function test(name, fn) {
    try {
        await fn();
        passed++;
        log(`  ✓ ${name}`);
    } catch (err) {
        failed++;
        log(`  ✗ ${name}\n    Error: ${err.message}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Motion Knowledge Engine & AE Techniques
// ─────────────────────────────────────────────────────────────────────────────

log('\n1 · Motion Knowledge Engine & Skill Classification');

const {
    SKILL_DOMAINS,
    INTENT_TECHNIQUE_RECIPES,
    classifyPromptSkills,
    searchMotionKnowledge,
    getKnowledgeForBrief,
} = nodeRequire(path.join(ROOT, 'server/knowledge/vibedMotionKnowledge.js'));

await test('new skill domains are defined in SKILL_DOMAINS', () => {
    assert.equal(SKILL_DOMAINS.EXPRESSIONS_ENGINE, 'expressions-engine');
    assert.equal(SKILL_DOMAINS.TRACK_MATTES_DEPTH, 'track-mattes-depth');
    assert.equal(SKILL_DOMAINS.HIERARCHICAL_PARENTING, 'hierarchical-parenting');
    assert.equal(SKILL_DOMAINS.VECTOR_TRIM_MORPH, 'vector-trim-morph');
    assert.equal(SKILL_DOMAINS.CINEMATIC_FX_RACK, 'cinematic-fx-rack');
    assert.equal(SKILL_DOMAINS.CREATOR_AESTHETICS, 'creator-aesthetics');
});

await test('classifyPromptSkills detects AE domains from prompt text', () => {
    const exprDomains = classifyPromptSkills('pulse with bass using a wiggle expression').map(d => d.domain);
    assert.ok(exprDomains.includes('expressions-engine'), 'Should classify as expressions-engine');

    const matteDomains = classifyPromptSkills('create an alpha track matte cutout text with video').map(d => d.domain);
    assert.ok(matteDomains.includes('track-mattes-depth'), 'Should classify as track-mattes-depth');

    const trimDomains = classifyPromptSkills('animate trim path on vector stroke outline').map(d => d.domain);
    assert.ok(trimDomains.includes('vector-trim-morph'), 'Should classify as vector-trim-morph');

    const aestheticDomains = classifyPromptSkills('edit like vox documentary with film grain').map(d => d.domain);
    assert.ok(aestheticDomains.includes('creator-aesthetics'), 'Should classify as creator-aesthetics');
});

await test('searchMotionKnowledge finds audio_reactive_bass_pump for bass punch queries', () => {
    const results = searchMotionKnowledge('pulse with bass');
    assert.ok(results.length > 0, 'Should find matches');
    assert.equal(results[0].technique.id, 'audio_reactive_bass_pump');
});

await test('searchMotionKnowledge finds wiggle_organic_drift for handheld drift queries', () => {
    const results = searchMotionKnowledge('organic handheld camera drift');
    assert.ok(results.length > 0, 'Should find matches');
    assert.equal(results[0].technique.id, 'wiggle_organic_drift');
});

await test('searchMotionKnowledge finds track_matte_alpha_reveal for alpha stencil queries', () => {
    const results = searchMotionKnowledge('alpha track matte stencil');
    assert.ok(results.length > 0, 'Should find matches');
    assert.equal(results[0].technique.id, 'track_matte_alpha_reveal');
});

await test('searchMotionKnowledge finds creator aesthetic techniques', () => {
    const vox = searchMotionKnowledge('vox documentary style');
    assert.ok(vox.length > 0 && vox[0].technique.id === 'vox_documentary_accent');

    const mrbeast = searchMotionKnowledge('mrbeast style hyper retention');
    assert.ok(mrbeast.length > 0 && mrbeast[0].technique.id === 'mrbeast_hyper_retention_punch');

    const abdaal = searchMotionKnowledge('ali abdaal style clean tech');
    assert.ok(abdaal.length > 0 && abdaal[0].technique.id === 'ali_abdaal_clean_minimal');

    const gadzhi = searchMotionKnowledge('iman gadzhi dark luxury look');
    assert.ok(gadzhi.length > 0 && gadzhi[0].technique.id === 'iman_gadzhi_dark_luxury');
});

await test('getKnowledgeForBrief injects After Effects Engine mastery guidelines', () => {
    const knowledge = getKnowledgeForBrief('make the title pulse with bass and link to parent badge');
    assert.ok(knowledge.promptBlock.includes('After Effects Engine Mastery'), 'Should include AE guidelines');
    assert.ok(knowledge.promptBlock.includes('wiggle(freq, amp)'), 'Should mention wiggle');
    assert.ok(knowledge.promptBlock.includes('trackMatte'), 'Should mention trackMatte');
    assert.ok(knowledge.promptBlock.includes('parentId'), 'Should mention parentId');
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Server-side Prompt Synthesis & Sanitization
// ─────────────────────────────────────────────────────────────────────────────

log('\n2 · Server-side Route Prompting & cleanBeat Sanitization');

const {
    buildMotionPrompt,
    buildScenePlanPrompt,
    cleanBeat,
    cleanScenePlan,
} = nodeRequire(path.join(ROOT, 'server/routes/motionRoutes.js'));

await test('buildMotionPrompt includes After Effects capabilities in schema instructions', () => {
    const prompt = buildMotionPrompt({
        brief: 'Animate hero title',
        layers: [{ id: 'title-1', kind: 'text', content: 'Hero Title', duration: 3 }],
        catalog: [{ verb: 'slam-in', group: 'enter', describe: 'Fast slam' }],
    });
    assert.ok(prompt.includes('AFTER EFFECTS MOTION ENGINE'), 'Prompt must instruct model on AE capabilities');
    assert.ok(prompt.includes('expressions: e.g. {"scale": "1 + audioAmp(\'bass\') * 0.2"'), 'Must provide expression examples');
    assert.ok(prompt.includes('trackMatte: e.g. {"mode": "alpha"'), 'Must provide trackMatte examples');
    assert.ok(prompt.includes('parentId: e.g. "<parent layer id>"'), 'Must provide parentId examples');
    assert.ok(prompt.includes('trim: e.g. {"trimStart": 0..1'), 'Must provide trim examples');
});

await test('cleanBeat sanitizes and preserves valid AE engine fields', () => {
    const beat = cleanBeat({
        kind: 'point',
        text: 'Clean Tech Design',
        kicker: '01',
        expressions: {
            scale: "1 + audioAmp('bass') * 0.2",
            rotation: "wiggle(2, 6)",
            invalidChannel: "alert('bad')",
        },
        trackMatte: {
            mode: 'alpha',
            sourceLayerId: 'footage-matte-1',
        },
        parentId: 'hero-badge-container',
        trim: {
            trimStart: 0,
            trimEnd: 0.85,
            trimOffset: 45,
        },
        blendMode: 'screen',
    });

    assert.ok(beat, 'Cleaned beat must not be null');
    assert.equal(beat.kind, 'point');
    assert.equal(beat.text, 'Clean Tech Design');
    assert.equal(beat.kicker, '01');

    // Expressions: valid channels kept, invalid channel dropped
    assert.ok(beat.expressions, 'Expressions object must be preserved');
    assert.equal(beat.expressions.scale, "1 + audioAmp('bass') * 0.2");
    assert.equal(beat.expressions.rotation, "wiggle(2, 6)");
    assert.equal(beat.expressions.invalidChannel, undefined, 'Invalid property channel must be dropped');

    // Track matte preserved
    assert.deepEqual(beat.trackMatte, { mode: 'alpha', sourceLayerId: 'footage-matte-1' });

    // Parent ID preserved
    assert.equal(beat.parentId, 'hero-badge-container');

    // Trim preserved
    assert.deepEqual(beat.trim, { trimStart: 0, trimEnd: 0.85, trimOffset: 45 });

    // Blend mode preserved
    assert.equal(beat.blendMode, 'screen');
});

await test('cleanBeat drops invalid AE field values gracefully', () => {
    const beat = cleanBeat({
        kind: 'point',
        text: 'Defensive Beat',
        expressions: 'not an object',
        trackMatte: { mode: 'invalid-mode', sourceLayerId: 'layer-1' },
        parentId: '   ',
        trim: { trimStart: 'invalid' },
        blendMode: 'invalid-blend-mode',
    });

    assert.equal(beat.expressions, undefined);
    assert.equal(beat.trackMatte, undefined);
    assert.equal(beat.parentId, undefined);
    assert.equal(beat.trim, undefined);
    assert.equal(beat.blendMode, undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Agent Intent Parsing & Command Registry
// ─────────────────────────────────────────────────────────────────────────────

log('\n3 · Agent Intent Parsing & Parameter Extraction');

const { resolveCommand, extractParams, COMMAND_BY_ID } = await import('../client/src/agent/CommandRegistry.js');
const { IntentParser } = await import('../client/src/agent/IntentParser.js');
const { EditPlanner } = await import('../client/src/agent/EditPlanner.js');
const { default: CommandCompiler } = await import('../client/src/agent/CommandCompiler.js');

await test('CommandRegistry resolves expression, matte, parent, trim, and aesthetic prompts', () => {
    const exprMatch = resolveCommand('add a wiggle expression to rotation').match;
    assert.ok(exprMatch && exprMatch.id === 'apply_motion_expression', `Expected apply_motion_expression, got ${exprMatch?.id}`);

    const bassMatch = resolveCommand('pulse with bass').match;
    assert.ok(bassMatch && bassMatch.id === 'apply_motion_expression', `Expected apply_motion_expression, got ${bassMatch?.id}`);

    const matteMatch = resolveCommand('set track matte to alpha inverted').match;
    assert.ok(matteMatch && matteMatch.id === 'set_track_matte', `Expected set_track_matte, got ${matteMatch?.id}`);

    const parentMatch = resolveCommand('parent layer to title').match;
    assert.ok(parentMatch && parentMatch.id === 'set_layer_parent', `Expected set_layer_parent, got ${parentMatch?.id}`);

    const trimMatch = resolveCommand('animate trim path on outline').match;
    assert.ok(trimMatch && trimMatch.id === 'set_vector_trim', `Expected set_vector_trim, got ${trimMatch?.id}`);

    const voxMatch = resolveCommand('edit like vox documentary style').match;
    assert.ok(voxMatch && voxMatch.id === 'apply_aesthetic_preset', `Expected apply_aesthetic_preset, got ${voxMatch?.id}`);

    const abdaalMatch = resolveCommand('edit like ali abdaal minimal').match;
    assert.ok(abdaalMatch && abdaalMatch.id === 'apply_aesthetic_preset', `Expected apply_aesthetic_preset, got ${abdaalMatch?.id}`);
});

await test('CommandRegistry resolves French phrasing accurately', () => {
    const exprFr = resolveCommand('ajoute une expression').match;
    assert.ok(exprFr && exprFr.id === 'apply_motion_expression');

    const matteFr = resolveCommand('masque de piste').match;
    assert.ok(matteFr && matteFr.id === 'set_track_matte');

    const parentFr = resolveCommand('lier le calque').match;
    assert.ok(parentFr && parentFr.id === 'set_layer_parent');

    const trimFr = resolveCommand('tracer le chemin').match;
    assert.ok(trimFr && trimFr.id === 'set_vector_trim');

    const voxFr = resolveCommand('style documentaire vox').match;
    assert.ok(voxFr && voxFr.id === 'apply_aesthetic_preset');
});

await test('EditPlanner builds valid actionable plans for the 5 new operations', () => {
    const planExpr = EditPlanner.createPlan({
        intent: 'edit',
        operation: 'apply_motion_expression',
        originalPrompt: 'pulse with the bass on scale',
        constraints: { property: 'scale' },
    }, { tracks: [] }, 'plan_expr_1');
    assert.ok(planExpr && planExpr.steps?.length === 1);
    assert.equal(planExpr.steps[0].action, 'apply_motion_expression');
    assert.equal(planExpr.steps[0].args.property, 'scale');
    assert.ok(planExpr.steps[0].args.expression.includes('audioAmp'));

    const planMatte = EditPlanner.createPlan({
        intent: 'edit',
        operation: 'set_track_matte',
        originalPrompt: 'set track matte to luma',
        constraints: { mode: 'luma' },
    }, { tracks: [] }, 'plan_matte_1');
    assert.ok(planMatte && planMatte.steps?.length === 1);
    assert.equal(planMatte.steps[0].action, 'set_track_matte');
    assert.equal(planMatte.steps[0].args.mode, 'luma');

    const planAesthetic = EditPlanner.createPlan({
        intent: 'edit',
        operation: 'apply_aesthetic_preset',
        originalPrompt: 'edit like mrbeast style',
    }, { tracks: [] }, 'plan_aest_1');
    assert.ok(planAesthetic && planAesthetic.steps?.length === 1);
    assert.equal(planAesthetic.steps[0].action, 'apply_aesthetic_preset');
    assert.equal(planAesthetic.steps[0].args.preset, 'mrbeast');
});

await test('CommandCompiler compiles new AE commands into ENGINE.STORE commands', () => {
    const plan = {
        plan_id: 'plan_test_ae',
        operation: 'apply_aesthetic_preset',
        steps: [
            { step_id: 'step_1', action: 'apply_aesthetic_preset', args: { preset: 'vox' }, reason: 'Vox style' },
            { step_id: 'step_2', action: 'apply_motion_expression', args: { property: 'rotation', expression: 'wiggle(2, 5)' }, reason: 'Handheld sway' },
        ],
    };

    const compiled = CommandCompiler.compile(plan, { tracks: [] });
    assert.equal(compiled.commands.length, 2);
    assert.equal(compiled.commands[0].engine, 'store');
    assert.equal(compiled.commands[0].action, 'apply_aesthetic_preset');
    assert.equal(compiled.commands[1].engine, 'store');
    assert.equal(compiled.commands[1].action, 'apply_motion_expression');
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. VideoEditorTools Execution & Store State Verification
// ─────────────────────────────────────────────────────────────────────────────

log('\n4 · VideoEditorTools Tool Execution & Store Verification');

const { VideoEditorTools, TOOL_DEFINITIONS } = await import('../client/src/agent/VideoEditorTools.js');
const useTimelineStore = (await import('../client/src/store/useTimelineStore.js')).default;

// Initialize clean timeline store with video and text tracks
const store = useTimelineStore.getState();

const videoTrackId = store.addTrack('video');
const textTrackId = store.addTrack('text');
const shapeTrackId = store.addTrack('overlay');

store.addClip(videoTrackId, {
    id: 'clip-video-1',
    name: 'Interview A-Roll.mp4',
    type: 'video',
    start: 0,
    duration: 10,
    effects: [],
});

store.addClip(textTrackId, {
    id: 'clip-text-1',
    name: 'Headline Text',
    type: 'text',
    text: 'Building Modern Software',
    start: 0.5,
    duration: 4,
    expressions: {},
});

store.addClip(shapeTrackId, {
    id: 'clip-shape-1',
    name: 'Accent Box',
    type: 'shape',
    start: 0.5,
    duration: 4,
    trim: {},
});

const tools = new VideoEditorTools();

await test('apply_motion_expression applies valid expression to target clip', async () => {
    const res = await tools.execute({
        name: 'apply_motion_expression',
        args: {
            clipId: 'clip-text-1',
            property: 'scale',
            expression: "1 + audioAmp('bass') * 0.2",
        },
    });

    assert.ok(res.success, `Expected success, got: ${res.message || res.error}`);
    const fresh = useTimelineStore.getState();
    const clip = fresh.tracks.find(t => t.id === textTrackId)?.clips.find(c => c.id === 'clip-text-1' || c.clipId === 'clip-text-1');
    assert.equal(clip?.expressions?.scale, "1 + audioAmp('bass') * 0.2");
});

await test('apply_motion_expression rejects syntactically invalid or unsafe expressions', async () => {
    const res = await tools.execute({
        name: 'apply_motion_expression',
        args: {
            clipId: 'clip-text-1',
            property: 'rotation',
            expression: "window.alert('danger')",
        },
    });

    assert.equal(res.success, false, 'Must reject unsafe syntax');
    assert.ok(res.message.includes('invalid') || res.message.includes('syntax error'));
});

await test('set_track_matte sets alpha track matte linking target and source layer', async () => {
    const res = await tools.execute({
        name: 'set_track_matte',
        args: {
            clipId: 'clip-text-1',
            sourceLayerId: 'clip-video-1',
            mode: 'alpha',
        },
    });

    assert.ok(res.success, `Expected success: ${res.message}`);
    const fresh = useTimelineStore.getState();
    const clip = fresh.tracks.find(t => t.id === textTrackId)?.clips.find(c => c.id === 'clip-text-1' || c.clipId === 'clip-text-1');
    assert.equal(clip?.trackMatte?.mode, 'alpha');
    assert.ok(clip?.trackMatte?.sourceLayerId);
});

await test('set_layer_parent links child to parent and rejects cyclic dependency', async () => {
    // 1. Valid parent link
    const res1 = await tools.execute({
        name: 'set_layer_parent',
        args: {
            clipId: 'clip-shape-1',
            parentId: 'clip-text-1',
        },
    });
    assert.ok(res1.success, `Expected success linking child to parent: ${res1.message}`);

    const fresh1 = useTimelineStore.getState();
    const shapeClip = fresh1.tracks.find(t => t.id === shapeTrackId)?.clips.find(c => c.id === 'clip-shape-1' || c.clipId === 'clip-shape-1');
    assert.ok(shapeClip?.parentId);

    // 2. Cyclic link attempt: parenting clip-text-1 to clip-shape-1 must be blocked
    const res2 = await tools.execute({
        name: 'set_layer_parent',
        args: {
            clipId: 'clip-text-1',
            parentId: 'clip-shape-1',
        },
    });
    assert.equal(res2.success, false, 'Must reject cyclic parenting');
    assert.ok(res2.message.includes('circular') || res2.message.includes('cycle'));
});

await test('set_vector_trim configures trim and adds keyframed draw-on animation', async () => {
    const res = await tools.execute({
        name: 'set_vector_trim',
        args: {
            clipId: 'clip-shape-1',
            trimStart: 0,
            trimEnd: 0.9,
            trimOffset: 90,
            drawOn: true,
            drawOnDuration: 1.5,
        },
    });

    assert.ok(res.success, `Expected success: ${res.message}`);
    const fresh = useTimelineStore.getState();
    const shapeClip = fresh.tracks.find(t => t.id === shapeTrackId)?.clips.find(c => c.id === 'clip-shape-1' || c.clipId === 'clip-shape-1');
    assert.equal(shapeClip?.trim?.trimEnd, 0.9);
    assert.equal(shapeClip?.trim?.trimOffset, 90);
    assert.ok(shapeClip?.animations?.some(a => a.type === 'trim_path'));
});

await test('apply_aesthetic_preset applies complete styling across video grade and typography', async () => {
    const res = await tools.execute({
        name: 'apply_aesthetic_preset',
        args: {
            preset: 'vox',
        },
    });

    assert.ok(res.success, `Expected success: ${res.message}`);
    const fresh = useTimelineStore.getState();
    const videoClip = fresh.tracks.find(t => t.id === videoTrackId)?.clips.find(c => c.id === 'clip-video-1' || c.clipId === 'clip-video-1');
    const textClip = fresh.tracks.find(t => t.id === textTrackId)?.clips.find(c => c.id === 'clip-text-1' || c.clipId === 'clip-text-1');

    // Video must receive the Vox grade, film grain, and vignette
    assert.ok(videoClip?.effects?.some(e => e.type === 'color_grade'), 'Should have color_grade');
    assert.ok(videoClip?.effects?.some(e => e.type === 'film_grain'), 'Should have film_grain');
    assert.ok(videoClip?.effects?.some(e => e.type === 'vignette'), 'Should have vignette');

    // Text must receive Vox typography styling
    assert.ok(textClip?.fontFamily?.includes('Playfair'), 'Should style font with Playfair Display');
    assert.equal(textClip?.accentColor, '#FFD700');
});

log('\n────────────────────────────────────────────────────────────');
log(`After Effects AI & Agent Capabilities: ${passed} passed, ${failed} failed`);
log('────────────────────────────────────────────────────────────\n');

if (failed > 0) {
    process.exit(1);
}
