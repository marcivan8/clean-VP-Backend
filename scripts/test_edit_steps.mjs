// scripts/test_edit_steps.mjs
//
// R143 — the per-step channel the mobile progress screen reads.
//
// The screen this feeds is the trust moment of the new mobile flow: instead of
// a spinner it narrates the real edit ("cut the silence -2:41"). That only
// works if every command the engine runs announces itself with a name a
// beginner understands and the sentence it reported afterwards.
//
// What these checks protect:
//   - a step never shows a raw snake_case action to a user
//   - housekeeping (seek, chat, undo) stays out of the narration
//   - the engine really emits, start and finish, once per command
//   - the store tracks a run in order, updates a step in place rather than
//     appending a duplicate, and resets when a new job starts
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

let n = 0;
const check = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };

console.log('\nedit steps\n');

// ── labels ───────────────────────────────────────────────────────────────────
const { stepLabel } = await import('../client/src/agent/stepLabels.js');
const { COMMAND_BY_ID } = await import('../client/src/agent/CommandRegistry.js');

check('a registry command uses the label already written for it', () => {
    assert.equal(stepLabel({ action: 'silence_removal' }), COMMAND_BY_ID.silence_removal.label);
    assert.equal(stepLabel({ action: 'auto_captions' }), COMMAND_BY_ID.auto_captions.label);
});

check('an engine-only action still gets a written label', () => {
    assert.equal(stepLabel({ action: 'smart_cleanup' }), 'Clean it up');
    assert.equal(stepLabel({ action: 'identify_quotable_moments' }), 'Find the best moments');
});

check('housekeeping is not narrated', () => {
    for (const a of ['seek_to', 'chat', 'undo', 'redo']) {
        assert.equal(stepLabel({ action: a }), null, `${a} should not be shown`);
    }
});

check('an unknown action is humanised, never shown raw', () => {
    const label = stepLabel({ action: 'some_future_action' });
    assert.equal(label, 'Some future action');
    assert.ok(!/_/.test(label), 'no underscore may reach the screen');
});

check('an explicit label from the compiler wins over everything', () => {
    assert.equal(stepLabel({ action: 'silence_removal', meta: { label: 'Tightening it up' } }), 'Tightening it up');
});

check('a missing command does not throw', () => {
    assert.equal(stepLabel(null), null);
    assert.equal(stepLabel({}), 'Working');
});

// ── the engine really emits ──────────────────────────────────────────────────
const engine = read('client/src/agent/MediaExecutionEngine.js');

check('the engine emits a step as a command starts and as it finishes', () => {
    const loop = engine.slice(engine.indexOf('async executeCommands(job)'));
    const body = loop.slice(0, loop.indexOf('return job.results;'));
    const emits = body.match(/EventBus\.emit\(EVENT_TYPES\.EDIT_STEP/g) || [];
    assert.equal(emits.length, 2, 'expected exactly one start and one finish emit');
    assert.ok(/state: 'running'/.test(body), 'the start emit must mark the step running');
    assert.ok(/message: result\?\.message/.test(body),
        "the finish emit must carry the handler's own sentence — that is where the numbers are");
    assert.ok(/stepLabel\(command\)/.test(body), 'the label must come from stepLabels, not the raw action');
    assert.ok(/if \(label\)/.test(body), 'a null label must suppress the emit');
});

check('EDIT_STEP is a declared event type', () => {
    assert.ok(/EDIT_STEP:\s*'edit:step'/.test(read('client/src/agent/EventBus.js')));
});

// ── the store ────────────────────────────────────────────────────────────────
const { default: useEditStepsStore } = await import('../client/src/store/useEditStepsStore.js');
const S = () => useEditStepsStore.getState();

check('a run is collected in order', () => {
    S().clear();
    S().ingest({ jobId: 'j1', index: 0, total: 3, action: 'silence_removal', label: 'Remove silences', state: 'running' });
    S().ingest({ jobId: 'j1', index: 0, total: 3, action: 'silence_removal', label: 'Remove silences', state: 'done', message: 'Removed 2:41 of silence.' });
    S().ingest({ jobId: 'j1', index: 1, total: 3, action: 'auto_captions', label: 'Add captions', state: 'running' });
    assert.deepEqual(S().steps.map(x => x.index), [0, 1]);
    assert.equal(S().steps.length, 2, 'a finished step must update in place, not append');
    assert.equal(S().steps[0].message, 'Removed 2:41 of silence.');
    assert.equal(S().steps[0].state, 'done');
});

check('the sentence survives a later event that does not carry one', () => {
    S().ingest({ jobId: 'j1', index: 0, total: 3, action: 'silence_removal', label: 'Remove silences', state: 'done' });
    assert.equal(S().steps[0].message, 'Removed 2:41 of silence.',
        'a re-emit without a message must not wipe the numbers already reported');
});

check('summary counts what the screen draws', () => {
    const s = S().summary();
    assert.equal(s.done, 1);
    assert.equal(s.failed, 0);
    assert.equal(s.running.label, 'Add captions');
    assert.equal(s.complete, false);
});

check('a failed step is counted, not hidden', () => {
    S().ingest({ jobId: 'j1', index: 2, total: 3, action: 'apply_lut', label: 'Colour grade', state: 'failed', message: 'No LUT matched.' });
    assert.equal(S().summary().failed, 1);
});

check('finishing clears anything still marked running', () => {
    S().finish();
    assert.ok(!S().steps.some(x => x.state === 'running'));
    assert.equal(S().summary().complete, true);
});

check('a new job starts a new list', () => {
    S().ingest({ jobId: 'j2', index: 0, total: 1, action: 'extract_short', label: 'Make a short', state: 'running' });
    assert.equal(S().steps.length, 1, 'the previous run must not bleed into this one');
    assert.equal(S().jobId, 'j2');
});

check('total is measured against what is shown, never below it', () => {
    S().clear();
    // the engine reports 9 commands but only 2 are worth narrating
    S().ingest({ jobId: 'j3', index: 0, total: 9, action: 'silence_removal', label: 'Remove silences', state: 'done' });
    S().ingest({ jobId: 'j3', index: 5, total: 9, action: 'auto_captions', label: 'Add captions', state: 'done' });
    assert.equal(S().summary().total, 9);
    assert.ok(S().summary().total >= S().steps.length);
});

console.log(`\n${n} checks passed\n`);
