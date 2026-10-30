import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.innerWidth = 1200;

const { default: store } = await import('../client/src/store/useTimelineStore.js');
const { VideoEditorTools, TOOL_DEFINITIONS } = await import('../client/src/agent/VideoEditorTools.js');
const { IntentParser } = await import('../client/src/agent/IntentParser.js');
const { EditPlanner } = await import('../client/src/agent/EditPlanner.js');
const { CommandCompiler } = await import('../client/src/agent/CommandCompiler.js');

const tm = window.timelineManager;
tm.fromLegacyTracks([{ id: 'video', type: 'video', name: 'Camera', clips: [
    { id: 'first-use', type: 'video', assetId: 'asset-a', start: 0, duration: 10, offset: 0, speed: 1 },
    { id: 'second-use', type: 'video', assetId: 'asset-a', start: 20, duration: 10, offset: 10, speed: 1 },
] }]);
store.setState({ tracks: tm.toLegacyTracks(), assets: [
    { id: 'asset-a', type: 'video', name: 'camera.mp4' },
    { id: 'asset-b', type: 'video', name: 'rushes-b.mp4' },
], duration: 30, targetFindings: [], assetTargetFindings: [], past: [], future: [] });

const findIntent = await IntentParser.parse('Find every scene where a red car appears');
assert.equal(findIntent.operation, 'locate_visual_targets');
assert.equal(findIntent.constraints.query, 'red car');
const findPlan = await EditPlanner.generatePlan(findIntent);
const findCommands = CommandCompiler.compile(findPlan.plan, store.getState()).commands;
assert.equal(findCommands[0]?.action, 'locateVisualTargets', 'visual search goes through Roka plan and compiler');

let polled = false;
globalThis.fetch = async (url, init = {}) => {
    if (url === '/api/brain/locate-target') {
        const body = JSON.parse(init.body || '{}');
        return new Response(JSON.stringify({ jobId: `target-job-${body.assetId}` }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.startsWith('/api/jobs/target-job-')) {
        polled = true;
        const assetId = url.endsWith('asset-b/status') ? 'asset-b' : 'asset-a';
        return new Response(JSON.stringify({ state: 'completed', result: {
            ranges: [{ id: 'hit', kind: 'visual', sourceStart: assetId === 'asset-a' ? 4 : 8, sourceEnd: assetId === 'asset-a' ? 6 : 10, confidence: 0.9, evidence: 'red car in frame' }],
        } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`Unexpected fetch ${url}`);
};

assert.ok(TOOL_DEFINITIONS.some(tool => tool.name === 'locate_visual_targets'));
assert.ok(TOOL_DEFINITIONS.some(tool => tool.name === 'apply_target_ranges'));
const tools = new VideoEditorTools();
const located = await tools.locateVisualTargets({ query: 'red car' });
assert.equal(polled, true);
assert.equal(located.success, true);
assert.equal(located.details.candidates.length, 2, 'search returns timeline placements and assets still in the media bin');
assert.deepEqual([located.details.candidates[0].start, located.details.candidates[0].end], [4, 6]);
assert.equal(located.details.candidates[1].assetName, 'rushes-b.mp4');
assert.equal(located.details.candidates[1].timebase, 'source');
assert.equal(store.getState().assetTargetFindings.length, 1, 'unplaced rush match is stored for the media-bin badge');
assert.equal(store.getState().targetFindings.length, 1, 'visual match is surfaced for timeline review');

const cutIntent = await IntentParser.parse('Cut all those matches');
assert.equal(cutIntent.operation, 'apply_target_ranges');
assert.equal(cutIntent.constraints.confirmed, true);
const cutPlan = await EditPlanner.generatePlan(cutIntent);
const cutCommands = CommandCompiler.compile(cutPlan.plan, store.getState()).commands;
assert.equal(cutCommands[0]?.action, 'applyTargetRanges', 'follow-up edit reaches the tool executor');
assert.equal(cutCommands[0]?.args?.confirmed, true);

const blocked = await tools.applyTargetRanges({ operation: 'cut', targetIds: [store.getState().targetFindings[0].id] });
assert.equal(blocked.success, false, 'applying candidates requires explicit confirmation');
const applied = await tools.applyTargetRanges({ operation: 'cut', confirmed: true, targetIds: [store.getState().targetFindings[0].id] });
assert.equal(applied.success, true);
assert.equal(applied.details.cutCount, 1);
assert.equal(store.getState().past.length, 1, 'all approved target cuts form one undo step');

console.log('ALL VISUAL TARGET TOOL CHECKS PASSED');
