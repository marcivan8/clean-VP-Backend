/**
 * scripts/test_lut_ai_commands.js
 *
 * Regression for the AI-executable LUT command layer (R75). Run after
 * touching CommandRegistry.js / EditPlanner.js / CommandCompiler.js /
 * VideoEditorTools.js / MediaExecutionEngine.js / DirectorIntelligence.js
 * LUT code, or RecommendationEngine.js's recommendLUTs():
 *
 *   node scripts/test_lut_ai_commands.js
 *
 * Pins the three independent ways this layer was found broken before this
 * work: (1) unreachable from any NLP path — not in CommandRegistry at all;
 * (2) even when reached via CommandCompiler, routed to a store action
 * ('setProjectLUT') that MediaExecutionEngine had zero handling for; (3)
 * typed unquoted mood requests ("apply a warm lut") resolved the command but
 * silently dropped the mood description, because extractParams' text-type
 * params only ever read quoted text.
 *
 * ESM modules are staged as .mjs temp files so plain `node` can import them
 * without a bundler — same technique as test_command_registry.js.
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

let fails = 0;
const assert = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); fails++; } else { console.log('  ok: ' + msg); } };

async function main() {
    // ── Stage CommandRegistry + CommandCompiler + DirectorIntelligence into ONE
    //    temp dir so DirectorIntelligence's relative `./CommandRegistry.js`
    //    import resolves. CommandCompiler has no cross-imports of its own.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lut-ai-test-'));
    fs.copyFileSync(path.resolve(__dirname, '../client/src/agent/CommandRegistry.js'),      path.join(tmpDir, 'CommandRegistry.js'));
    fs.copyFileSync(path.resolve(__dirname, '../client/src/agent/CommandCompiler.js'),      path.join(tmpDir, 'CommandCompiler.mjs'));
    fs.copyFileSync(path.resolve(__dirname, '../client/src/agent/DirectorIntelligence.js'), path.join(tmpDir, 'DirectorIntelligence.mjs'));

    const reg = await import('file://' + path.join(tmpDir, 'CommandRegistry.js'));
    const cc  = await import('file://' + path.join(tmpDir, 'CommandCompiler.mjs'));
    const di  = await import('file://' + path.join(tmpDir, 'DirectorIntelligence.mjs'));

    // ── 1. Registry: resolution + param extraction ───────────────────────────
    console.log('\n[1] CommandRegistry resolution + params');
    for (const [text, expectedOp] of [
        ['apply a lut',                'apply_lut'],
        ['apply a warm cinematic lut', 'apply_lut'],
        ['use a lut',                  'apply_lut'],
        ['clear the lut',              'clear_lut'],
        ['remove the lut',             'clear_lut'],
        ['recommend a lut',            'recommend_luts'],
        ['suggest a look',             'recommend_luts'],
        ['color grade it',             'color_grade'],   // the original collision command, unaffected
    ]) {
        const r = reg.resolveCommand(text);
        assert(r.match && r.match.id === expectedOp, `"${text}" -> ${expectedOp}, got ${r.match && r.match.id}`);
    }

    // Regression: 'apply a lut' must NOT still live under color_grade's phrases
    // (the original vocabulary collision the user asked about).
    const colorGradeScore = reg.scoreCommand(reg.COMMAND_BY_ID.color_grade, 'apply a lut');
    assert(colorGradeScore === 0, `"apply a lut" must be VETOED for color_grade (score ${colorGradeScore})`);

    // Unquoted mood text must survive extraction (this was the silent-drop bug).
    const p1 = reg.extractParams(reg.COMMAND_BY_ID.apply_lut, 'apply a warm cinematic lut');
    assert(p1.query === 'warm cinematic', `unquoted mood text extracted, got "${p1.query}"`);
    assert(p1.target === 'clip', `default target is 'clip', got "${p1.target}"`);

    const p2 = reg.extractParams(reg.COMMAND_BY_ID.apply_lut, 'apply a lut to all the clips');
    assert(p2.target === 'all', `"all the clips" -> target 'all', got "${p2.target}"`);
    assert(!p2.query, `selector words ("all"/"clips") must not leak into query, got "${p2.query}"`);

    // Quoted text still takes priority over the fallback.
    const p3 = reg.extractParams(reg.COMMAND_BY_ID.apply_lut, 'apply a lut called "midnight blue"');
    assert(p3.query === 'midnight blue', `quoted text still wins, got "${p3.query}"`);

    // ── 2. CommandCompiler: pure compile, no store needed ────────────────────
    console.log('\n[2] CommandCompiler.compile()');

    const applyPlan = { plan_id: 'p1', steps: [
        { step_id: 'step_1', action: 'apply_lut', lut_id: null, query: 'warm cinematic', apply_to_all: false },
    ]};
    const applyResult = cc.CommandCompiler.compile(applyPlan, {});
    assert(applyResult.success, 'apply_lut plan compiles without error');
    assert(applyResult.commands.length === 1, `apply_lut plan produces 1 command, got ${applyResult.commands.length}`);
    const applyCmd = applyResult.commands[0];
    assert(applyCmd.action === 'apply_lut', `compiled command action is 'apply_lut', got "${applyCmd.action}"`);
    assert(applyCmd.args.query === 'warm cinematic', 'compiled command carries the query through');
    assert(applyCmd.args.applyToAll === false, 'compiled command carries applyToAll=false through');

    const clearPlan = { plan_id: 'p2', steps: [
        { step_id: 'step_1', action: 'clear_lut', apply_to_all: true },
    ]};
    const clearResult = cc.CommandCompiler.compile(clearPlan, {});
    assert(clearResult.success, 'clear_lut plan compiles without error');
    const clearCmd = clearResult.commands[0];
    assert(clearCmd.action === 'clear_lut', `compiled command action is 'clear_lut', got "${clearCmd.action}"`);
    assert(clearCmd.args.applyToAll === true, 'compiled command carries applyToAll=true through');

    // Regression: neither action may still be 'setProjectLUT' — the store
    // action MediaExecutionEngine had zero handling for.
    assert(applyCmd.action !== 'setProjectLUT' && clearCmd.action !== 'setProjectLUT',
        'neither apply_lut nor clear_lut compiles to the dead setProjectLUT action');

    const recommendPlan = { plan_id: 'p3', steps: [
        { step_id: 'step_1', action: 'recommend_luts', limit: 3 },
    ]};
    const recommendResult = cc.CommandCompiler.compile(recommendPlan, {});
    assert(recommendResult.success, 'recommend_luts plan compiles without error');
    const recommendCmd = recommendResult.commands[0];
    assert(recommendCmd.args.endpoint === '/api/luts/recommend', 'recommend_luts hits /api/luts/recommend');

    // Missing both lut_id and query must fail validation, not silently no-op.
    const badPlan = { plan_id: 'p4', steps: [{ step_id: 'step_1', action: 'apply_lut' }] };
    const badResult = cc.CommandCompiler.compile(badPlan, {});
    assert(!badResult.success, 'apply_lut with no lut_id/query fails compilation (not a silent no-op)');

    // ── 3. EditPlanner wiring — static source check (browser-only imports
    //    prevent a live import here; test_command_registry.js's check #7
    //    already enforces every registered command reaches a real handler
    //    across planner/compiler/engine, so this focuses on the FIELD NAMES
    //    the planner emits actually matching what the compiler reads). ──────
    console.log('\n[3] EditPlanner ↔ CommandCompiler field-name agreement');
    const plannerSrc = fs.readFileSync(path.resolve(__dirname, '../client/src/agent/EditPlanner.js'), 'utf8');
    assert(/case 'apply_lut':\s*return this\.planApplyLUT/.test(plannerSrc), 'EditPlanner switches apply_lut -> planApplyLUT');
    assert(/case 'clear_lut':\s*return this\.planClearLUT/.test(plannerSrc), 'EditPlanner switches clear_lut -> planClearLUT');
    assert(/case 'recommend_luts':\s*return this\.planRecommendLUTs/.test(plannerSrc), 'EditPlanner switches recommend_luts -> planRecommendLUTs');
    assert(/static planApplyLUT/.test(plannerSrc), 'planApplyLUT is implemented');
    assert(/static planClearLUT/.test(plannerSrc), 'planClearLUT is implemented');
    assert(/static planRecommendLUTs/.test(plannerSrc), 'planRecommendLUTs is implemented');
    // Field names compileApplyLUT/compileClearLUT actually read (step.lut_id /
    // step.query / step.apply_to_all) must be the ones the planner emits.
    const applyLUTBlock = plannerSrc.slice(plannerSrc.indexOf('static planApplyLUT'), plannerSrc.indexOf('static planClearLUT'));
    assert(/lut_id:\s*lutId/.test(applyLUTBlock), 'planApplyLUT emits step.lut_id (compileApplyLUT reads step.lut_id)');
    assert(/query,/.test(applyLUTBlock) || /query:/.test(applyLUTBlock), 'planApplyLUT emits step.query');
    assert(/apply_to_all:\s*applyToAll/.test(applyLUTBlock), 'planApplyLUT emits step.apply_to_all (compileApplyLUT reads step.apply_to_all)');

    // ── 4. MediaExecutionEngine: real handlers exist, dead action is gone ────
    console.log('\n[4] MediaExecutionEngine handlers');
    const engineSrc = fs.readFileSync(path.resolve(__dirname, '../client/src/agent/MediaExecutionEngine.js'), 'utf8');
    assert(/case 'apply_lut':/.test(engineSrc), 'MediaExecutionEngine has a case for apply_lut');
    assert(/case 'clear_lut':/.test(engineSrc), 'MediaExecutionEngine has a case for clear_lut');
    assert(!/case 'setProjectLUT':/.test(engineSrc), 'the dead setProjectLUT case was never (re)introduced');
    assert(/endpoint === '\/api\/luts\/recommend'/.test(engineSrc), 'executeApiCall injects projectId for /api/luts/recommend');

    // ── 5. DirectorIntelligence: content-aware LUT proposal ──────────────────
    console.log('\n[5] DirectorIntelligence lut_suggestion proposal');
    const withTone = di.buildProposals({ storyMap: null, projectMap: { status: 'ok', tone: 'dramatic', through_line: 'test', coverage_gaps: [] } });
    const lutProp = withTone.proposals.find(p => p.id === 'lut_suggestion');
    assert(!!lutProp, 'a tone-bearing project produces a lut_suggestion proposal');
    assert(lutProp && lutProp.applicable === true, 'lut_suggestion is applicable');
    assert(lutProp && lutProp.command === 'apply_lut', `lut_suggestion command is apply_lut, got ${lutProp && lutProp.command}`);

    // The whole point: BrainPanel's Accept only resubmits proposal.title as
    // free text (params are dropped) — the title itself must round-trip.
    const resolved = reg.resolveCommand(lutProp.title);
    assert(resolved.match && resolved.match.id === 'apply_lut', 'resubmitted proposal title resolves to apply_lut');
    const roundTrip = reg.extractParams(resolved.match, lutProp.title);
    assert(roundTrip.query === lutProp.params.query, `resubmitted title's extracted query matches the proposal's own params.query ("${roundTrip.query}" vs "${lutProp.params.query}")`);

    const noTone = di.buildProposals({ storyMap: null, projectMap: { status: 'ok', tone: null, coverage_gaps: [] } });
    assert(!noTone.proposals.find(p => p.id === 'lut_suggestion'), 'no tone -> no lut_suggestion proposal (fail-open)');

    const unmappedTone = di.buildProposals({ storyMap: null, projectMap: { status: 'ok', tone: 'some_future_tone_value', coverage_gaps: [] } });
    assert(!unmappedTone.proposals.find(p => p.id === 'lut_suggestion'), 'an unmapped future tone value -> no proposal, not a garbage query');

    // ── 6. RecommendationEngine: content-aware source check ──────────────────
    // Can't execute live (Supabase not configured in this environment), but
    // pin the structural fix: recommendLUTs must consult getLUTsByProfile
    // when a mood signal resolves a warmth/contrast hint, not only intents.
    console.log('\n[6] RecommendationEngine content-awareness (static)');
    const recEngineSrc = fs.readFileSync(path.resolve(__dirname, '../server/audio-engine/recommendations/RecommendationEngine.js'), 'utf8');
    assert(/opts\.tone/.test(recEngineSrc), 'recommendLUTs reads opts.tone');
    assert(/getLUTsByProfile/.test(recEngineSrc), 'recommendLUTs calls getLUTsByProfile (was intent-only before R75)');
    const lutRoutesSrc = fs.readFileSync(path.resolve(__dirname, '../server/routes/lutRoutes.js'), 'utf8');
    assert(/projectId/.test(lutRoutesSrc) && /ProjectIntelligence/.test(lutRoutesSrc), '/api/luts/recommend fetches ProjectIntelligence tone by projectId');

    fs.rmSync(tmpDir, { recursive: true, force: true });

    console.log(fails === 0 ? '\nALL LUT AI-COMMAND TESTS PASSED' : `\n${fails} FAILURES`);
}

main()
    .catch(err => { console.error('test harness error:', err.stack || err.message); fails++; })
    .finally(() => process.exit(fails ? 1 : 0));
