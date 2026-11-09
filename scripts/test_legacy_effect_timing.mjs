import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { createEffect, createTimelineState } = await import('../client/src/timeline/TimelineSchema.js');
const { TimelineStateManager } = await import('../client/src/timeline/TimelineStateManager.js');

const state = createTimelineState();
const effects = [
  createEffect({ id: 'explicit', targetId: 'not-hydrated', targetType: 'placement', startTime: 2, endTime: 4 }),
  createEffect({ id: 'inherited', targetId: 'placed', targetType: 'placement' }),
  createEffect({ id: 'partial', targetId: 'placed', targetType: 'placement', startTime: 12 }),
];
state.entities.effects = Object.fromEntries(effects.map(effect => [effect.id, effect]));
state.entities.placements.placed = {
  id: 'placed', clipId: 'clip', layerId: 'track-default-video', startTime: 10, duration: 5,
};

const manager = new TimelineStateManager(state, { freezeState: false, validateOnDispatch: false });
assert.deepEqual(manager.getActiveEffectsAt('not-hydrated', 1), [], 'an explicit effect window is respected without a hydrated placement');
assert.deepEqual(manager.getActiveEffectsAt('not-hydrated', 2).map(effect => effect.id), ['explicit'], 'effect window includes its start');
assert.deepEqual(manager.getActiveEffectsAt('not-hydrated', 3.99).map(effect => effect.id), ['explicit'], 'effect window remains active immediately before its end');
assert.deepEqual(manager.getActiveEffectsAt('not-hydrated', 4), [], 'effect window excludes its end, matching preview and export');
assert.deepEqual(manager.getActiveEffectsAt('placed', 10).map(effect => effect.id), ['inherited'], 'an unbounded effect inherits its placement start');
assert.deepEqual(manager.getActiveEffectsAt('placed', 12).map(effect => effect.id), ['inherited', 'partial'], 'a partial explicit window combines with inherited placement bounds');
assert.deepEqual(manager.getActiveEffectsAt('placed', 15), [], 'placement end is exclusive');
assert.deepEqual(manager.getActiveEffectsAt('placed', Number.NaN), [], 'invalid playhead values cannot activate effects');

console.log('Legacy effect timing checks passed: explicit and inherited windows follow renderer [start, end) semantics.');
