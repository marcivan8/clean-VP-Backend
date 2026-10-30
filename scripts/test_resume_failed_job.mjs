// R131 — "the brain loses the flow after each task done, just like in this
// image. It should be able to remember and continue a job it has started,
// that stopped, failed when asked to continue." (user report, with a
// screenshot of a long-form edit that failed partway through and had
// nothing to pick back up with).
//
// Pins:
//   - longFormJobMemory.js's pure remainingCommandsFrom() helper: commands
//     with no result (the loop hard-stopped before reaching them — exactly
//     what R130's "Unknown tool" bug did) AND commands that ran but
//     reported success:false are both "still remaining"; commands that
//     succeeded are not.
//   - save/get/clear round-trip through the localStorage polyfill, scoped
//     per project id.
//   - "continue the edit" / "try again" resolve, via CommandRegistry, to
//     the resume_failed_job operation.
//   - VideoEditorTools.resumeFailedJob() end to end: no saved record →
//     clear failure message; a saved record whose commands now succeed →
//     applies them and clears the record; a saved record that still fails
//     → re-saves exactly the still-failing subset for a second "continue".
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' });

const realLog = console.log;
console.log = () => {}; console.warn = () => {}; console.info = () => {};

const { default: useTimelineStore } = await import('../client/src/store/useTimelineStore.js');
const { VideoEditorTools } = await import('../client/src/agent/VideoEditorTools.js');
const { CommandCompiler } = await import('../client/src/agent/CommandCompiler.js');
const { IntentParser } = await import('../client/src/agent/IntentParser.js');
const memory = await import('../client/src/agent/longFormJobMemory.js');

console.log = realLog;
const ok = (name) => realLog(`✓ ${name}`);

const tm = window.timelineManager;

function setupThreeClips(projectId = 'proj-1') {
    tm.fromLegacyTracks([{ id: 'track-video', type: 'video', name: 'V', clips: [
        { id: 'v1', clipId: 'e1', assetId: 'a', type: 'video', name: 'A', start: 0, duration: 4, offset: 0, speed: 1 },
        { id: 'v2', clipId: 'e2', assetId: 'a', type: 'video', name: 'B', start: 4, duration: 4, offset: 4, speed: 1 },
        { id: 'v3', clipId: 'e3', assetId: 'a', type: 'video', name: 'C', start: 8, duration: 4, offset: 8, speed: 1 },
    ] }]);
    useTimelineStore.setState({
        tracks: tm.toLegacyTracks(), duration: 12, currentTime: 0, activeClipId: null,
        aspectRatio: '9:16', assets: [{ id: 'a', type: 'video' }], projectId,
    });
}

// ── 1. remainingCommandsFrom — the core "what's still left to do" logic ────
{
    const commands = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }, { id: 'c4' }];
    // c1 succeeded, c2 "soft-failed" (ran, reported failure), c3/c4 never ran at all (hard stop).
    const results = [{ success: true }, { success: false }];
    const remaining = memory.remainingCommandsFrom(commands, results);
    assert.deepEqual(remaining, [{ id: 'c2' }, { id: 'c3' }, { id: 'c4' }]);
    ok('remainingCommandsFrom keeps soft-failures AND never-attempted commands, drops only clean successes, preserving order');
}
{
    const commands = [{ id: 'c1' }, { id: 'c2' }];
    const remaining = memory.remainingCommandsFrom(commands, [{ success: true }, { success: true }]);
    assert.deepEqual(remaining, []);
    ok('a fully successful run leaves nothing remaining');
}

// ── 2. save/get/clear round-trip, scoped per project ────────────────────────
{
    memory.clearResumableJob('proj-a');
    memory.clearResumableJob('proj-b');
    assert.equal(memory.getResumableJob('proj-a'), null, 'nothing saved yet');

    memory.saveResumableJob({ projectId: 'proj-a', planId: 'plan-1', remainingCommands: [{ x: 1 }], failedMessage: 'boom', totalSteps: 5 });
    const rec = memory.getResumableJob('proj-a');
    assert.ok(rec, 'record must round-trip');
    assert.deepEqual(rec.remainingCommands, [{ x: 1 }]);
    assert.equal(rec.failedMessage, 'boom');
    assert.equal(rec.totalSteps, 5);

    assert.equal(memory.getResumableJob('proj-b'), null, 'a different project must not see proj-a\'s record');

    memory.clearResumableJob('proj-a');
    assert.equal(memory.getResumableJob('proj-a'), null, 'cleared record is gone');
    ok('save/get/clear round-trips correctly and is scoped per project');
}
{
    memory.saveResumableJob({ projectId: 'proj-c', planId: null, remainingCommands: [], failedMessage: null, totalSteps: 0 });
    assert.equal(memory.getResumableJob('proj-c'), null, 'an empty remainingCommands array must never be saved as a resumable record');
    ok('saveResumableJob is a no-op when there is nothing to remember (empty remainingCommands)');
}

// ── 3. "continue the edit" / "try again" resolve to resume_failed_job ───────
{
    for (const phrase of ['continue the edit', 'try again', 'resume the edit', 'continue where it left off']) {
        const intent = await IntentParser.parse(phrase);
        assert.equal(intent.operation, 'resume_failed_job', `"${phrase}" → ${intent.operation}`);
        assert.equal(intent.confidence, 'HIGH', `"${phrase}" confidence`);
    }
    ok('"continue the edit" / "try again" / "resume the edit" / "continue where it left off" all resolve to resume_failed_job');
}

// ── 4. resumeFailedJob() — nothing saved → clear failure, not a crash. ──────
{
    setupThreeClips('proj-empty');
    memory.clearResumableJob('proj-empty');
    const tools = new VideoEditorTools();
    const r = await tools.execute({ name: 'resume_failed_job', args: {} });
    assert.equal(r.success, false);
    assert.ok(/nothing to continue/i.test(r.message), r.message);
    ok('resumeFailedJob with nothing saved reports a clear "nothing to continue" message');
}

// ── 5. resumeFailedJob() end to end — a saved record resolves cleanly and clears itself. ──
{
    setupThreeClips('proj-resume');
    const state = useTimelineStore.getState();
    const compiled = CommandCompiler.compile(
        { steps: [{ step_id: 'step_1', action: 'add_transitions_to_sections', type: 'fade', duration: 0.5, apply_at: 'all_cuts' }] },
        state
    );
    assert.ok(compiled.commands.length > 0, 'sanity: the compiler produced a real command');
    memory.saveResumableJob({
        projectId: 'proj-resume', planId: 'plan-x', remainingCommands: compiled.commands,
        failedMessage: 'Unknown tool: add_transitions_to_sections', totalSteps: 3,
    });

    const tools = new VideoEditorTools();
    const r = await tools.execute({ name: 'resume_failed_job', args: {} });
    assert.equal(r.success, true, JSON.stringify(r));
    assert.ok(/continued and finished/i.test(r.message), r.message);
    assert.equal(memory.getResumableJob('proj-resume'), null, 'a fully-resolved resume must clear its own record');

    const videoTrack = useTimelineStore.getState().tracks.find(t => t.type === 'video');
    const byId = Object.fromEntries(videoTrack.clips.map(c => [c.id, c]));
    assert.deepEqual(byId.v2.transition, { type: 'fade', duration: 0.5 }, 'the previously-stuck transition step actually applied on resume');
    ok('resumeFailedJob applies the saved remaining commands and clears the record once they all succeed');
}

// ── 6. resumeFailedJob() — a still-failing resume re-saves exactly the still-failing subset. ──
{
    setupThreeClips('proj-still-failing');
    // A command whose action genuinely does not exist — guaranteed to still fail on resume.
    const fakeCommand = { engine: 'store', action: 'this_action_does_not_exist', args: {}, meta: { description: 'bogus' } };
    memory.saveResumableJob({
        projectId: 'proj-still-failing', planId: 'plan-y', remainingCommands: [fakeCommand],
        failedMessage: 'Unknown tool: this_action_does_not_exist', totalSteps: 1,
    });

    const tools = new VideoEditorTools();
    const r = await tools.execute({ name: 'resume_failed_job', args: {} });
    assert.equal(r.success, false);
    assert.ok(/still couldn.t finish/i.test(r.message), r.message);

    const rec = memory.getResumableJob('proj-still-failing');
    assert.ok(rec, 'a still-failing resume must re-save a record for a later "continue"');
    assert.equal(rec.remainingCommands.length, 1);
    assert.equal(rec.remainingCommands[0].action, 'this_action_does_not_exist');
    ok('a resume attempt that still fails re-saves exactly the still-failing command(s), ready for another "continue"');
}

realLog('\nALL RESUME FAILED JOB TESTS PASSED');
// The imported timeline/engine modules keep background listeners alive; this
// standalone regression script should exit once its assertions have finished.
process.exit(0);
