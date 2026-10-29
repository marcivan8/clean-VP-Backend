// R126 — Slice 1 of the layout-variety scoping (claude/qc-loop-and-layout-scoping-R126.md):
// thread the three existing layout presets (split/pip/fullscreen, R88) into the
// AUTOMATIC long-form plan instead of leaving them manual-only.
//
// Three things pinned here:
//   1. decideAutoLayout() (VideoEditorTools.js) — the pure decision rule: a
//      cutaway short enough to read fine covering the whole frame gets no
//      layout at all (the existing implicit default); a longer one gets
//      'split' when the covered base clip has face-tracking data, else the
//      safer 'pip' (no face dependency).
//   2. compilePlaceContextualBroll (CommandCompiler.js) used to hardcode {}
//      for this action's args, silently dropping ANY step.args a planner
//      set (wordSync/events/layout/autoLayout) — fixed to forward step.args.
//   3. placeContextualBroll (VideoEditorTools.js) now honors args.autoLayout
//      per match when args.layout isn't explicitly set, and an explicit
//      args.layout still wins outright (back-compat for existing callers).
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;

const realLog = console.log;
console.log = () => {}; console.warn = () => {}; console.info = () => {};

const { decideAutoLayout, AUTO_LAYOUT_MIN_DURATION_S } = await import('../client/src/agent/VideoEditorTools.js');
const { CommandCompiler } = await import('../client/src/agent/CommandCompiler.js');

console.log = realLog;
const ok = (name) => realLog(`✓ ${name}`);

// ── 1. decideAutoLayout — pure decision rule ───────────────────────────────
{
    assert.equal(typeof decideAutoLayout, 'function', 'decideAutoLayout must be exported');
    assert.equal(typeof AUTO_LAYOUT_MIN_DURATION_S, 'number', 'AUTO_LAYOUT_MIN_DURATION_S must be exported');
    ok('decideAutoLayout and its threshold are exported from VideoEditorTools.js');
}

{
    const short = AUTO_LAYOUT_MIN_DURATION_S - 1;
    assert.equal(decideAutoLayout(short, true), null, 'a short cutaway gets no layout even with face tracking');
    assert.equal(decideAutoLayout(short, false), null, 'a short cutaway gets no layout without face tracking either');
    assert.equal(decideAutoLayout(0, true), null, 'zero duration gets no layout');
    assert.equal(decideAutoLayout(undefined, true), null, 'missing/NaN duration gets no layout (treated as 0)');
    ok('short cutaways (< threshold) always get null — no layout, matches today\'s implicit fullscreen-cutaway default');
}

{
    const long = AUTO_LAYOUT_MIN_DURATION_S + 2;
    assert.equal(decideAutoLayout(long, true), 'split', 'a long cutaway with face-tracking data gets split (keeps speaker visible, face-aware)');
    assert.equal(decideAutoLayout(long, false), 'pip', 'a long cutaway without face-tracking data gets pip (keeps speaker visible, no face dependency)');
    ok('long cutaways (>= threshold) get split when face-tracking data exists, pip otherwise');
}

{
    assert.equal(decideAutoLayout(AUTO_LAYOUT_MIN_DURATION_S, false), 'pip', 'exactly at the threshold counts as "long enough"');
    ok('the threshold boundary itself is inclusive (>= not >)');
}

// ── 2. compilePlaceContextualBroll forwards step.args ──────────────────────
{
    const result = CommandCompiler.compile(
        { steps: [{ step_id: 'step_1', action: 'place_contextual_broll', args: { autoLayout: true, wordSync: true } }] },
        {}
    );
    const cmds = result.commands || (result.results || []).flatMap(r => r.commands || []);
    assert.ok(cmds.length > 0, 'expected at least one compiled command');
    const c = cmds[0];
    assert.equal(c.action, 'placeContextualBroll');
    assert.equal(c.args.autoLayout, true, 'step.args.autoLayout must survive compilation (used to be dropped — hardcoded {})');
    assert.equal(c.args.wordSync, true, 'step.args.wordSync must also survive compilation');
    ok('compilePlaceContextualBroll now forwards step.args instead of hardcoding {}');
}

{
    // No args on the step at all — must not throw, must compile to {}.
    const result = CommandCompiler.compile(
        { steps: [{ step_id: 'step_1', action: 'place_contextual_broll' }] },
        {}
    );
    const cmds = result.commands || (result.results || []).flatMap(r => r.commands || []);
    assert.equal(cmds.length, 1, 'a step with no args at all must still compile to exactly one command');
    assert.deepEqual(cmds[0].args, {}, 'missing step.args compiles to an empty args object, not a crash');
    ok('a place_contextual_broll step with no args at all still compiles cleanly to {}');
}

realLog('\nALL AUTO LAYOUT SELECTION TESTS PASSED');
