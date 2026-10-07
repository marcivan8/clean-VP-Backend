// Roka command pipeline: parse → plan → compile for every registry command,
// "clean up", combined clean-ups and colour grade.
// node scripts/test_command_pipeline.mjs
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' });
const log = console.log; console.log = () => {}; console.warn = () => {}; console.info = () => {};

const { default: useTimelineStore } = await import('../client/src/store/useTimelineStore.js');
const { IntentParser } = await import('../client/src/agent/IntentParser.js');
const { EditPlanner, colorLookQuery } = await import('../client/src/agent/EditPlanner.js');
const { CommandCompiler } = await import('../client/src/agent/CommandCompiler.js');
const { COMMANDS } = await import('../client/src/agent/CommandRegistry.js');

const tm = window.timelineManager;
tm.fromLegacyTracks([
    { id: 'track-default-video', type: 'video', name: 'V', clips: [
        { id: 'v1', clipId: 'ev1', assetId: 'a', type: 'video', name: 'IMG.MOV', start: 0, duration: 10, offset: 0, speed: 1 },
        { id: 'v2', clipId: 'ev2', assetId: 'a', type: 'video', name: 'IMG.MOV', start: 10, duration: 5, offset: 12, speed: 1 }] },
]);
useTimelineStore.setState({ tracks: tm.toLegacyTracks(), duration: 15, currentTime: 4, activeClipId: 'v1', uploadedFile: { name: 'IMG.MOV' }, assets: [{ id: 'a', type: 'video', name: 'IMG.MOV', duration: 20 }] });

async function run(prompt) {
    const intent = await IntentParser.parse(prompt);
    const plan = await EditPlanner.generatePlan(intent);
    let commands = [];
    if (plan.success && plan.plan) {
        commands = CommandCompiler.compile({ ...plan.plan, intent: { ...intent, confidence: 'HIGH' } }, useTimelineStore.getState()).commands || [];
    }
    return { intent, plan, steps: plan.plan?.steps?.map(s => s.action) || [], commands: commands.map(c => c.action) };
}

// Registry commands reach a plan (they used to stop at an empty clarification
// because resolveCommand reports 'high' and the planner wants 'HIGH').
const PLANNED_BY_SERVER = new Set(['add_text_overlay', 'add_sfx', 'queue_export', 'virtual_multicam']);
for (const cmd of COMMANDS) {
    const phrase = (cmd.phrases || [])[0];
    if (!phrase) continue;
    const r = await run(phrase);
    assert.equal(r.intent.confidence, 'HIGH', `"${phrase}": confidence ${r.intent.confidence}`);
    assert.notEqual(r.plan.status, 'clarification_needed', `"${phrase}" (${cmd.id}) stopped at a clarification`);
    if (!PLANNED_BY_SERVER.has(r.intent.operation)) assert.ok(r.commands.length > 0, `"${phrase}" (${cmd.id}) compiled to nothing`);
}
log('✓ every registry command plans and compiles (no empty clarification)');

for (const p of ['clean up', 'Clean it up', 'clean up my video', 'clean up the video']) {
    const r = await run(p);
    // R92: plus voice enhancement, last and optional.
    assert.deepEqual(r.steps, ['remove_repeated_takes', 'silence_removal', 'remove_filler_words', 'enhance_audio'], p);
    assert.deepEqual(r.commands, ['detectRepeatedTakes', 'silenceDetect', 'fillerDetect', 'audioEnhance'], p);
    assert.equal(r.plan.plan.steps[0].optional, true, 'repeated takes are optional inside a clean-up');
    assert.equal(r.plan.plan.steps[3].optional, true, 'voice enhancement is optional inside a clean-up');
}
log('✓ "clean up" = repeated takes + silences + fillers + voice enhancement (optional ones flagged)');

let r = await run('Remove silences and filler words');
assert.deepEqual(r.steps, ['silence_removal', 'remove_filler_words'], 'chip runs both, not fillers only');
r = await run('remove the pauses and the ums');
assert.deepEqual(r.steps, ['silence_removal', 'remove_filler_words']);
r = await run('remove filler words');
assert.deepEqual(r.steps, ['remove_filler_words'], 'single command unchanged');
r = await run('clean it up and make it dynamic');
assert.equal(r.intent.operation, 'compound_clean_dynamic', 'dynamic compound unchanged');
log('✓ combined clean-ups run every named action; single ones unchanged');

for (const [p, q] of [['color grade', 'cinematic'], ['make it cinematic', 'cinematic'], ['warm it up', 'warm'], ['Add a color grade', 'cinematic'], ['apply a lut', 'cinematic'], ['apply a warm lut', 'warm']]) {
    r = await run(p);
    assert.deepEqual(r.steps, ['apply_lut'], p);
    assert.deepEqual(r.commands, ['apply_lut'], p);
    assert.equal(r.plan.plan.steps[0].query, q, p);
}
assert.equal(colorLookQuery({ style: 'teal orange' }, 'whatever'), 'teal orange');
log('✓ colour grade → a LUT look (preview + export), default "cinematic"');

log('\nALL COMMAND-PIPELINE CHECKS PASSED');
process.exit(0);
