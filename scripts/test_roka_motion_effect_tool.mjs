import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.innerWidth = 1280;
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' });

const { VideoEditorTools, TOOL_DEFINITIONS, TOOL_CAPABILITIES } = await import('../client/src/agent/VideoEditorTools.js');
const store = (await import('../client/src/store/useTimelineStore.js')).default;
const { IntentParser } = await import('../client/src/agent/IntentParser.js');
const { EditPlanner } = await import('../client/src/agent/EditPlanner.js');
const { CommandCompiler } = await import('../client/src/agent/CommandCompiler.js');
const { mediaExecutionEngine } = await import('../client/src/agent/MediaExecutionEngine.js');
const { ValidationService } = await import('../client/src/agent/ValidationService.js');

const tool = TOOL_DEFINITIONS.find(definition => definition.name === 'apply_motion_effect_stack');
assert.ok(tool, 'ROKA has an effect stack tool');
assert.ok(TOOL_CAPABILITIES.some(capability => capability.name === tool.name), 'effect stack has an execution contract');
for (const name of ['design_scene', 'add_motion_component', 'compose_motion']) {
    assert.ok(TOOL_DEFINITIONS.some(definition => definition.name === name), `ROKA exposes ${name} to its autonomous planner`);
    assert.ok(TOOL_CAPABILITIES.some(capability => capability.name === name), `${name} has an execution contract`);
}

const videoTrackId = store.getState().addTrack('video');
store.getState().addClip(videoTrackId, { id: 'main', type: 'video', name: 'Talking head', start: 0, duration: 10, effects: [] });
store.getState().addClip(videoTrackId, { id: 'later', type: 'video', name: 'Cutaway', start: 12, duration: 4, effects: [] });
store.setState({ currentTime: 2, selectedClipIds: [] });

const result = await new VideoEditorTools().execute({
    name: 'apply_motion_effect_stack',
    args: { effects: [{ type: 'film_grain', params: { intensity: 0.2 } }, { type: 'vignette', params: { intensity: 0.15 } }] },
});
assert.equal(result.success, true, result.message);
assert.equal(result.details.verified, true);
const trackState = store.getState().tracks.find(track => track.id === videoTrackId);
const mainId = trackState.clips.find(clip => clip.name === 'Talking head').id;
const laterId = trackState.clips.find(clip => clip.name === 'Cutaway').id;
assert.deepEqual(result.details.clipIds, [mainId], 'defaults to the video clip under the playhead');
let clips = store.getState().tracks.find(track => track.id === videoTrackId).clips;
assert.deepEqual(clips.find(clip => clip.id === mainId).effects.map(effect => effect.type), ['film_grain', 'vignette']);
assert.equal(clips.find(clip => clip.id === laterId).effects.length, 0, 'does not affect unrelated footage');

const beforeInvalid = clips[0].effects;
const invalid = await new VideoEditorTools().execute({
    name: 'apply_motion_effect_stack',
    args: { clipId: mainId, effects: [{ type: 'unsupported-3d-fog' }] },
});
assert.equal(invalid.success, false, 'unsupported effects fail honestly');
assert.deepEqual(store.getState().tracks.find(track => track.id === videoTrackId).clips.find(clip => clip.id === mainId).effects, beforeInvalid, 'invalid effect request does not mutate the timeline');

const badParam = await new VideoEditorTools().execute({
    name: 'apply_motion_effect_stack',
    args: { clipId: mainId, effects: [{ type: 'blur_gaussian', params: { radius: 500 } }] },
});
assert.equal(badParam.success, false, 'out-of-range effect parameters are rejected');
assert.deepEqual(store.getState().tracks.find(track => track.id === videoTrackId).clips.find(clip => clip.id === mainId).effects, beforeInvalid, 'invalid parameters do not mutate the timeline');

const textTrackId = store.getState().addTrack('text');
store.getState().addClip(textTrackId, { id: 'title', type: 'text', name: 'Opening title', content: 'A better edit', start: 0, duration: 3 });
const titleId = store.getState().tracks.find(track => track.id === textTrackId).clips[0].id;
const animated = await new VideoEditorTools().execute({ name: 'compose_motion', args: { brief: 'make the title pop in' } });
assert.equal(animated.success, true, animated.message);
assert.ok(store.getState().tracks.find(track => track.id === textTrackId).clips.find(clip => clip.id === titleId).animations?.length,
    'custom motion reaches the existing keyframe composer and persists on the target layer');
const validator = new ValidationService();
const animationValidation = await validator.validate({ steps: [{ action: 'compose_motion' }] }, {
    success: true, results: [{ ...animated, action: 'compose_motion' }],
});
assert.equal(animationValidation.success, true, animationValidation.message);

const component = await new VideoEditorTools().execute({
    name: 'add_motion_component',
    args: { component: 'TitleSequence', preset: 'cinematic', params: { title: 'Create more', subtitle: 'A test sequence', start: 4 } },
});
assert.equal(component.success, true, component.message);
assert.equal(component.details.verified, true, 'component reports success only after scene and layer persistence are checked');
const componentValidation = await validator.validate({ steps: [{ action: 'addMotionComponent' }] }, {
    success: true, results: [{ ...component, action: 'addMotionComponent' }],
});
assert.equal(componentValidation.success, true, componentValidation.message);

const scene = await new VideoEditorTools().execute({
    name: 'design_scene',
    args: { brief: 'Create an elegant opening title and a closing call to action for a short video about creative work.' },
});
assert.equal(scene.success, true, scene.message);
assert.ok(scene.details?.sceneId, 'scene designer returns the created editable scene ID');
assert.ok(scene.details?.clipCount > 0, 'scene designer places its designed layers on the timeline');
const sceneValidation = await validator.validate({ steps: [{ action: 'design_scene' }] }, {
    success: true, results: [{ ...scene, action: 'design_scene' }],
});
assert.equal(sceneValidation.success, true, sceneValidation.message);

// ROKA's active chat path is IntentParser → EditPlanner → CommandCompiler →
// MediaExecutionEngine, rather than the standalone function-call tool route.
store.setState({ currentTime: 2, selectedClipIds: [] });
const intent = await IntentParser.parse('add a glow effect and film grain to the footage');
assert.equal(intent.operation, 'apply_motion_effect_stack');
const plan = await EditPlanner.generatePlan(intent);
assert.equal(plan.success, true, plan.error);
const compiled = CommandCompiler.compile({ ...plan.plan, intent }, store.getState());
assert.deepEqual(compiled.commands.map(command => command.action), ['apply_motion_effect_stack']);
const activePathResult = await mediaExecutionEngine.execute(compiled.commands);
assert.equal(activePathResult.success, true, activePathResult.error);
clips = store.getState().tracks.find(track => track.id === videoTrackId).clips;
assert.ok(clips.find(clip => clip.id === mainId).effects.some(effect => effect.type === 'glow'), 'active ROKA path applies the effect stack through the shared engine');
const validation = await new ValidationService().validate(plan.plan, activePathResult);
assert.equal(validation.success, true, validation.message);
assert.ok(validation.outputs.some(output => output.action === 'apply_motion_effect_stack' && output.status === 'verified'),
    'active ROKA path verifies the stored effect stack before reporting the edit complete');

console.log('ROKA motion tools passed: callable and chat pipeline discovery, footage effects, custom keyframes, scene-backed components, targeting, verification, and invalid-request guards.');
