#!/usr/bin/env node
/**
 * Regression: Director Intelligence (R52).
 *
 * The one property that matters: A PROPOSAL MAY NOT CLAIM TO BE APPLICABLE
 * UNLESS IT RESOLVES TO A REAL COMMAND. Everything else here supports it.
 *
 * This is not hypothetical. CreativeDirector.js proposes 14 operations of which
 * 12 do not exist in CommandRegistry — wiring it up would have rendered a panel
 * of Apply buttons routing to handlers that do not exist (R23 + R30).
 *
 * Executes the real module; the verification gate and the ranking are logic and
 * have to be run to be trusted.
 *
 * Run: node scripts/test_director_intelligence.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const check = (n, c, d) => {
    if (c) { passed++; console.log(`  ✓ ${n}`); }
    else { failed++; console.log(`  ✗ ${n}`); if (d) console.log(`      ${d}`); }
};
const section = (t) => console.log(`\n${t}`);

// ── Load the ES modules by transpiling their import/export lines ─────────────
// Same technique as scripts/test_waveform_engine.js.
function loadModules() {
    const dir = path.resolve(__dirname, '../client/src/agent');
    const registrySrc = fs.readFileSync(path.join(dir, 'CommandRegistry.js'), 'utf8');
    const directorSrc = fs.readFileSync(path.join(dir, 'DirectorIntelligence.js'), 'utf8');

    const registry = registrySrc
        .replace(/^export default .*$/m, '')
        .replace(/^export (const|function) /gm, '$1 ');
    const director = directorSrc
        .replace(/^import \{ COMMAND_BY_ID \} from .*$/m, '')
        .replace(/^export default .*$/m, '')
        .replace(/^export (const|function) /gm, '$1 ');

    const sandbox = {};
    const fn = new Function(
        `${registry}\n${director}\nreturn { buildProposals, isExecutable, PRIORITY, COMMAND_BY_ID, COMMANDS };`
    );
    return Object.assign(sandbox, fn());
}

const M = loadModules();

const STORY_OK = {
    status: 'ok',
    hook_at_sec: 41.2,
    hook_strength: 'weak',
    hook_note: 'the strongest line is buried in the demo',
    delivers_through_line: false,
    through_line_note: 'the point arrives after the drop-off',
    sag_windows: [{ startSec: 12, endSec: 38, reason: 'no change in energy', severity: 'high' }],
    issues: [{ issue: 'outro trails off', severity: 'low', suggestion: 'end on the CTA', atSec: 80 }],
};

const PROJECT_OK = {
    status: 'ok',
    coverage_gaps: [
        { gap: 'No cutaways for the 3-minute explanation', severity: 'high', suggestion: 'Shoot b-roll of the product' },
    ],
};

async function main() {

    section('0 · The module loaded and the registry is real');
    {
        check('buildProposals is a function', typeof M.buildProposals === 'function');
        check('the real registry came with it',
            Array.isArray(M.COMMANDS) && M.COMMANDS.length > 10, `${M.COMMANDS?.length}`);
    }

    section('1 · THE RULE: applicable ⇒ a real command exists');
    {
        const { proposals } = M.buildProposals({ storyMap: STORY_OK, projectMap: PROJECT_OK });

        check('proposals were produced', proposals.length > 0, `${proposals.length}`);

        const liars = proposals.filter(p => p.applicable && !M.COMMAND_BY_ID[p.command]);
        check('NO proposal is applicable without a registry command',
            liars.length === 0,
            liars.map(p => `${p.id}→${p.command}`).join(', '));

        const ghosts = proposals.filter(p => p.command && !M.COMMAND_BY_ID[p.command]);
        check('no proposal carries an unresolvable command at all',
            ghosts.length === 0,
            'a UI keying its Apply button off `command` would render a dead one');

        const advisory = proposals.filter(p => !p.applicable);
        check('every advisory proposal explains why it is advisory',
            advisory.every(p => typeof p.advisoryReason === 'string' && p.advisoryReason.length > 0));
        check('advisory proposals expose no params',
            advisory.every(p => p.params === null));
    }

    section('2 · A named-but-nonexistent command is DEMOTED, not dropped');
    {
        // The buried-hook finding names reorder_for_hook, which does not exist.
        // The observation is still true and must survive — as advice.
        const { proposals } = M.buildProposals({ storyMap: STORY_OK });
        const hook = proposals.find(p => p.id === 'hook_buried');

        check('the buried-hook finding is still surfaced', !!hook);
        check('it is NOT applicable', hook && hook.applicable === false);
        check('its command is nulled out', hook && hook.command === null,
            'leaving reorder_for_hook here would let a UI offer it');
        check('the advisory reason names the missing command',
            hook && /reorder_for_hook/.test(hook.advisoryReason), hook?.advisoryReason);
        check('it still cites the time', hook && hook.atSec === 41.2);
    }

    section('3 · isExecutable is the single gate');
    {
        check('a real command passes', M.isExecutable('silence_removal') === true);
        check('a real command passes (2)', M.isExecutable('organize_clips') === true);
        for (const ghost of ['reorder_for_hook', 'trim_opening', 'split_long_clips',
                             'vary_clip_durations', 'add_hook_text', 'generate_captions']) {
            check(`"${ghost}" is rejected`, M.isExecutable(ghost) === false);
        }
        check('null/undefined are rejected',
            M.isExecutable(null) === false && M.isExecutable(undefined) === false);
    }

    section('4 · Ranking is by IMPACT, not by what we happen to be able to do');
    {
        const { proposals } = M.buildProposals({ storyMap: STORY_OK, projectMap: PROJECT_OK });

        const prio = proposals.map(p => M.PRIORITY[p.priority]);
        check('priorities are non-decreasing', prio.every((v, i) => i === 0 || v >= prio[i - 1]),
            proposals.map(p => `${p.id}:${p.priority}`).join(' '));

        // The critical finding here is advisory. It must still come first —
        // sorting applicable-first would be a UI convenience that misleads.
        check('a critical ADVISORY outranks an applicable lower-priority item',
            proposals[0].priority === 'critical' && proposals[0].applicable === false,
            `first was ${proposals[0].id} (${proposals[0].priority}, applicable=${proposals[0].applicable})`);

        const ids = proposals.map(p => p.id);
        check('ranking is deterministic across runs',
            M.buildProposals({ storyMap: STORY_OK, projectMap: PROJECT_OK })
                .proposals.map(p => p.id).join() === ids.join());
    }

    section('5 · Every proposal traces to a stored finding');
    {
        const { proposals } = M.buildProposals({ storyMap: STORY_OK, projectMap: PROJECT_OK });
        check('each has a non-empty why',
            proposals.every(p => typeof p.why === 'string' && p.why.trim().length > 0));
        check('each declares its source map',
            proposals.every(p => p.source === 'story' || p.source === 'project'));
        check('the sag reason is carried verbatim',
            proposals.some(p => p.why === 'no change in energy'));
        check('the coverage gap is carried verbatim',
            proposals.some(p => p.title === 'No cutaways for the 3-minute explanation'));
    }

    section('6 · Unreadable maps produce nothing, not guesses');
    {
        for (const [label, args] of [
            ['no maps at all',        {}],
            ['story failed',          { storyMap: { status: 'failed' } }],
            ['story insufficient',    { storyMap: { status: 'insufficient_data' } }],
            ['project failed',        { projectMap: { status: 'failed' } }],
        ]) {
            const r = M.buildProposals(args);
            check(`${label} → zero proposals`, r.proposals.length === 0, `${r.proposals.length}`);
        }
        check('basis reports none', M.buildProposals({}).basis === 'none');
        check('basis reports story+project when both readable',
            M.buildProposals({ storyMap: STORY_OK, projectMap: PROJECT_OK }).basis === 'story+project');
    }

    section('7 · Counts are honest');
    {
        const r = M.buildProposals({ storyMap: STORY_OK, projectMap: PROJECT_OK });
        check('executable + advisory = total',
            r.executableCount + r.advisoryCount === r.proposals.length);
        check('executableCount matches the applicable flags',
            r.executableCount === r.proposals.filter(p => p.applicable).length);
        check('at least one genuinely applicable proposal exists',
            r.executableCount > 0, 'otherwise the module offers nothing actionable at all');
    }

    section('8 · CreativeDirector is marked superseded');
    {
        const src = fs.readFileSync(
            path.resolve(__dirname, '../client/src/agent/CreativeDirector.js'), 'utf8');
        check('it carries a do-not-wire-up warning',
            /SUPERSEDED — DO NOT WIRE THIS UP/.test(src));
        check('the warning names the count', /TWELVE of them do not exist/.test(src));
        check('it points at the replacement', /DirectorIntelligence/.test(src));

        // It must STAY unwired until those commands exist.
        const consumers = [];
        const dir = path.resolve(__dirname, '../client/src');
        const walk = (d) => {
            for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                const full = path.join(d, e.name);
                if (e.isDirectory()) { walk(full); continue; }
                if (!/\.(js|jsx)$/.test(e.name)) continue;
                if (e.name === 'CreativeDirector.js') continue;
                let t; try { t = fs.readFileSync(full, 'utf8'); } catch { continue; }
                if (/from '.*CreativeDirector/.test(t)) consumers.push(full);
            }
        };
        walk(dir);
        check('nothing imports CreativeDirector',
            consumers.length === 0,
            consumers.join(', ') + ' — 12 of its operations still do not exist');
    }

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Director Intelligence: ${passed} passed, ${failed} failed`);
    console.log('─'.repeat(60));
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('\nHarness crashed:', e); process.exit(1); });
