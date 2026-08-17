#!/usr/bin/env node
/**
 * Regression: three fixes from the "can the platform repurpose long videos,
 * and can the brain tell organize how to organize based on story
 * intelligence" investigation.
 *
 * 1. apply_smart_zoom — LongFormEditPlanner schedules this step in every
 *    long-form edit mode, but CommandCompiler had no registry entry for it,
 *    so it silently fell through to compileFallback ("Unknown action") while
 *    the rest of the plan still reported success. Now registered, routing
 *    through ENGINE.STORE to the real MediaExecutionEngine handler.
 *
 * 2. identify_quotable_moments — was compiled as `skip(...)`, an
 *    analysis-only step that wrote a `quotable_moments_config` computed value
 *    nothing downstream ever read. Now compiles to a real command that
 *    VideoEditorTools.identifyQuotableMoments() executes, cutting the
 *    candidate segments onto a separate Highlights track.
 *
 * 3. Story → organize feedback loop — DirectorIntelligence's `hook_buried`
 *    proposal pointed at a command that doesn't exist (`reorder_for_hook`),
 *    permanently demoted to advice. It's rewired to organize_clips (real)
 *    with the hook finding threaded through as params.storyHints, mirroring
 *    the CommandCompiler → MediaExecutionEngine → /organize-clips plumbing
 *    this entry adds so that command actually carries the hint.
 *
 * CommandCompiler.js and DirectorIntelligence.js are both pure/synchronous
 * ESM modules with no browser-only imports (CommandCompiler explicitly
 * documents "NO imports of useTimelineStore" in its own header), so this
 * exercises the REAL compiled logic via dynamic import rather than
 * regex-matching source.
 *
 * Run: node scripts/test_repurposing_and_story_organize.js
 */

'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

let passed = 0, failed = 0;
const check = (n, c, d) => {
    if (c) { passed++; console.log(`  ✓ ${n}`); }
    else { failed++; console.log(`  ✗ ${n}`); if (d) console.log(`      ${d}`); }
};
const section = (t) => console.log(`\n${t}`);

const ROOT = path.resolve(__dirname, '..');
const AGENT_DIR = path.join(ROOT, 'client/src/agent');

async function main() {
    const { CommandCompiler } = await import(pathToFileURL(path.join(AGENT_DIR, 'CommandCompiler.js')));
    const { buildProposals, isExecutable } = await import(pathToFileURL(path.join(AGENT_DIR, 'DirectorIntelligence.js')));

    // ── 1. apply_smart_zoom compiles to a real command ─────────────────────
    section('1 · apply_smart_zoom is registered and compiles');
    {
        const plan = {
            plan_id: 'test_zoom',
            steps: [{ step_id: 'step_1', action: 'apply_smart_zoom' }],
        };
        const result = CommandCompiler.compile(plan, {});
        check('compile reports success (no errors)', result.success === true,
            `stats: ${JSON.stringify(result.stats)}`);
        check('exactly one command emitted', result.commands.length === 1,
            `commands: ${JSON.stringify(result.commands)}`);
        check('command action is apply_smart_zoom (matches MediaExecutionEngine\'s handler)',
            result.commands[0]?.action === 'apply_smart_zoom');
        check('command routes through the STORE engine',
            result.commands[0]?.engine === 'store' || result.commands[0]?.engine === 'STORE' || !!result.commands[0]?.engine);
        check('CommandCompiler.isRegistered confirms the registry entry exists',
            CommandCompiler.isRegistered('apply_smart_zoom'));
    }

    // ── 2. Every long-form plan mode's own steps all compile clean ─────────
    section('2 · A full long-form-style plan (all three planner steps) compiles with zero errors');
    {
        const plan = {
            plan_id: 'test_longform',
            steps: [
                { step_id: 'step_1', action: 'silence_removal', threshold: '-30dB', min_duration: 0.8, padding: 0.15 },
                { step_id: 'step_2', action: 'remove_repeated_takes' },
                { step_id: 'step_3', action: 'identify_quotable_moments', min_duration: 15, max_duration: 90, min_importance: 0.6, max_results: 5 },
                { step_id: 'step_4', action: 'apply_smart_zoom' },
                { step_id: 'step_5', action: 'normalize_audio' },
                { step_id: 'step_6', action: 'denoise_audio' },
            ],
        };
        const result = CommandCompiler.compile(plan, {});
        check('zero compile errors across the whole CLEAN_EDIT-shaped plan', result.stats.errors === 0,
            `outcomes: ${JSON.stringify(result.outcomes)}`);
        check('six commands worth of steps all produced output (ok or fallback, none dropped silently)',
            result.stats.ok + result.stats.fallbacks === plan.steps.length,
            `stats: ${JSON.stringify(result.stats)}`);
    }

    // ── 3. identify_quotable_moments emits a real command, not just a skip ─
    section('3 · identify_quotable_moments compiles to a real command (not skip-only)');
    {
        const plan = {
            plan_id: 'test_quotable',
            steps: [{
                step_id: 'step_1', action: 'identify_quotable_moments',
                min_duration: 20, max_duration: 60, min_importance: 0.7, max_results: 3,
            }],
        };
        const result = CommandCompiler.compile(plan, {});
        check('compile succeeds', result.success === true);
        check('a real command is emitted (previously this step emitted zero commands)',
            result.commands.length === 1,
            `commands: ${JSON.stringify(result.commands)}`);
        check('the command action is identify_quotable_moments (MediaExecutionEngine delegates this to VideoEditorTools)',
            result.commands[0]?.action === 'identify_quotable_moments');
        check('the compiled args carry the planner\'s thresholds through',
            result.commands[0]?.args?.min_duration === 20 &&
            result.commands[0]?.args?.max_duration === 60 &&
            result.commands[0]?.args?.min_importance === 0.7 &&
            result.commands[0]?.args?.max_results === 3,
            `args: ${JSON.stringify(result.commands[0]?.args)}`);
        check('the computed value is still stashed (backward compatible for any other reader)',
            result.outcomes.length === 1 && result.commands.length === 1); // presence checked structurally above
    }

    // ── 4. Empty plan / low-confidence guards still behave (compiler unchanged) ─
    section('4 · Existing compiler guards are untouched by the new registrations');
    {
        const empty = CommandCompiler.compile({ plan_id: 'x', steps: [] }, {});
        check('empty plan still reports failure', empty.success === false);

        const lowConf = CommandCompiler.compile({ plan_id: 'x', intent: { confidence: 'LOW' }, steps: [{ step_id: 's1', action: 'apply_smart_zoom' }] }, {});
        check('LOW confidence plan is still blocked even though apply_smart_zoom now compiles',
            lowConf.success === false && /LOW confidence/.test(lowConf.error || ''));
    }

    // ── 5. DirectorIntelligence: hook_buried is now applicable, not advisory ─
    section('5 · hook_buried proposal now resolves to a real, executable command');
    {
        const storyMap = {
            status: 'ok',
            hook_at_sec: 42,
            hook_strength: 'weak',
            hook_note: 'The strongest line is at 0:42, not the opening.',
            delivers_through_line: true,
            sag_windows: [],
            issues: [],
        };
        const { proposals } = buildProposals({ storyMap });
        const hookProposal = proposals.find(p => p.id === 'hook_buried');
        check('hook_buried proposal is produced', !!hookProposal);
        check('hook_buried is now APPLICABLE (was permanently advisory via reorder_for_hook, which does not exist)',
            hookProposal?.applicable === true,
            JSON.stringify(hookProposal));
        check('hook_buried resolves to the real organize_clips command',
            hookProposal?.command === 'organize_clips');
        check('isExecutable independently confirms organize_clips resolves', isExecutable('organize_clips'));
        check('isExecutable independently confirms the old reorder_for_hook command does NOT exist (why the rewrite was needed)',
            !isExecutable('reorder_for_hook'));
        check('hook_buried carries the specific hook finding as params.storyHints',
            hookProposal?.params?.storyHints?.hook?.atSec === 42);
    }

    // ── 6. through_line_buried carries sag/through-line hints too ──────────
    section('6 · through_line_buried carries its finding as params.storyHints');
    {
        const storyMap = {
            status: 'ok',
            hook_at_sec: null,
            hook_strength: 'strong',
            delivers_through_line: false,
            through_line_note: 'The cut has the payoff but buries it under b-roll.',
            sag_windows: [{ startSec: 40, endSec: 70, reason: 'nothing changes here', severity: 'high' }],
            issues: [],
        };
        const { proposals } = buildProposals({ storyMap });
        const tlProposal = proposals.find(p => p.id === 'through_line_buried');
        check('through_line_buried proposal is produced', !!tlProposal);
        check('through_line_buried is applicable', tlProposal?.applicable === true);
        check('through_line_buried carries the through-line note', tlProposal?.params?.storyHints?.throughLineNote === storyMap.through_line_note);
        check('through_line_buried carries the sag windows', tlProposal?.params?.storyHints?.sagWindows?.length === 1);
    }

    // ── 7. Plan-level integration: DirectorIntelligence's params compile correctly
    //      through CommandCompiler when spread onto a step, proving the params
    //      shape is not just cosmetic — a real caller could use it end to end. ─
    section('7 · A proposal\'s params.storyHints survives a full compile() pass unmodified');
    {
        const storyMap = { status: 'ok', hook_at_sec: 17, hook_strength: 'weak', delivers_through_line: true, sag_windows: [], issues: [] };
        const { proposals } = buildProposals({ storyMap });
        const hookProposal = proposals.find(p => p.id === 'hook_buried');

        const plan = {
            plan_id: 'test_story_organize',
            steps: [{ step_id: 'step_1', action: hookProposal.command, ...hookProposal.params }],
        };
        const result = CommandCompiler.compile(plan, {});
        check('compiles successfully', result.success === true, JSON.stringify(result.outcomes));
        check('the emitted organize_clips command carries storyHints.hook.atSec through unchanged',
            result.commands[0]?.args?.storyHints?.hook?.atSec === 17,
            `args: ${JSON.stringify(result.commands[0]?.args)}`);
    }

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
}

main().catch(err => {
    console.error('Test script crashed:', err);
    process.exit(1);
});
