// Transcript selection is propagated into Roka planning and scoped captions.
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;
const originalLog = console.log;
console.log = () => {}; console.warn = () => {}; console.info = () => {};

const { default: store } = await import('../client/src/store/useTimelineStore.js');
const { ContextGenerator } = await import('../client/src/agent/ContextGenerator.js');
const { IntentParser } = await import('../client/src/agent/IntentParser.js');
const { EditPlanner } = await import('../client/src/agent/EditPlanner.js');
const { default: CommandCompiler } = await import('../client/src/agent/CommandCompiler.js');

const tracks = [{ id: 'track-default-video', type: 'video', name: 'Video', volume: 1, clips: [
    { id: 'clip-a', clipId: 'asset-a-piece', assetId: 'asset-a', type: 'video', name: 'A', start: 0, duration: 8, offset: 0, speed: 1 },
    { id: 'clip-b', clipId: 'asset-b-piece', assetId: 'asset-b', type: 'video', name: 'B', start: 8, duration: 9, offset: 4, speed: 1 },
] }];
store.setState({ tracks, assets: [
    { id: 'asset-a', type: 'video', name: 'first.mp4', gcsPath: 'raw/u/first.mp4' },
    { id: 'asset-b', type: 'video', name: 'second.mp4', gcsPath: 'raw/u/second.mp4' },
], duration: 17, currentTime: 9, selectedClipIds: [], activeClipId: null, selectedTimelineRange: null });

store.getState().setSelectedTimelineRange({ start: 9.2, end: 11.6, text: 'the part about the launch', wordCount: 5, sourceKeys: ['second.mp4'] });
const context = ContextGenerator.getStructuredContext();
assert.deepEqual(context.TimelineState.selectedSegment.clipIds, ['clip-b']);
assert.equal(context.TimelineState.selectedSegment.start, 9.2);
assert.equal(context.TimelineState.sourcePlacements.length, 2, 'target mapping includes each placed source interval');
assert.match(context.TargetingInstructions.rule, /Do not invent visual\/object\/event timestamps/);
assert.match(ContextGenerator.getTimelineContext().display, /Apply segment edits only inside this range/);
originalLog('✓ selected segment context includes exact timeline bounds, excerpt, and overlapping clip');

const rangeIntent = await IntentParser.parse('Add captions to the selected segment');
assert.equal(rangeIntent.operation, 'auto_captions');
assert.equal(rangeIntent.constraints.scope, 'range');
assert.equal(rangeIntent.constraints.range_start, 9.2);
assert.equal(rangeIntent.constraints.range_end, 11.6);
const rangePlan = EditPlanner.planAutoCaptions('range-captions', rangeIntent.constraints);
assert.equal(rangePlan.steps[0].scope, 'range');
const compiledRange = CommandCompiler.compile(rangePlan);
assert.equal(compiledRange.commands[0].args.payload.scope, 'range');
assert.equal(compiledRange.commands[0].args.payload.rangeStart, 9.2);
originalLog('✓ selected-range caption request keeps its range through intent, plan, and command compilation');

store.getState().setSelectedTimelineRange(null);
store.getState().setActiveClip('clip-b');
const clipIntent = await IntentParser.parse('Add captions to this clip');
assert.equal(clipIntent.constraints.scope, 'clip');
assert.equal(clipIntent.constraints.clip_id, 'clip-b');
const clipPlan = EditPlanner.planAutoCaptions('clip-captions', clipIntent.constraints);
const compiledClip = CommandCompiler.compile(clipPlan);
assert.equal(compiledClip.commands[0].args.payload.scope, 'clip');
assert.equal(compiledClip.commands[0].args.payload.clipId, 'clip-b');
originalLog('✓ selected-clip caption request targets only that clip in a multi-clip edit');

console.log = originalLog;
originalLog('\nALL SEGMENT-SCOPED EDIT CHECKS PASSED');
