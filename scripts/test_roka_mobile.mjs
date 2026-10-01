// Mobile Roka phase 3 pure helpers. node scripts/test_roka_mobile.mjs
import assert from 'assert/strict';
import { shouldPlanFirst, planLineKeys, formatLength, timelineLength, PLAN_FIRST_OPERATIONS } from '../client/src/agent/planFirst.js';
import { aiWaitReason } from '../client/src/utils/uploadStatus.js';

// plan first: only removal edits, only on mobile
for (const op of ['silence_removal', 'remove_filler_words', 'remove_repetition', 'semantic_cut', 'compound_clean_dynamic']) {
    assert.equal(shouldPlanFirst(op, true), true, op);
    assert.equal(shouldPlanFirst(op, false), false, op + ' desktop unchanged');
}
for (const op of ['auto_captions', 'color_grade', 'music', 'chat', 'dynamic_rhythm', undefined, null]) {
    assert.equal(shouldPlanFirst(op, true), false, String(op));
}
for (const op of PLAN_FIRST_OPERATIONS) assert.ok(planLineKeys(op).length > 0 && planLineKeys(op)[0] !== 'planGeneric', op);
assert.deepEqual(planLineKeys('compound_clean_dynamic'), ['planSilence', 'planZoom']);
assert.deepEqual(planLineKeys('something_new'), ['planGeneric']);
assert.equal(formatLength(72), '1:12'); assert.equal(formatLength(51.4), '0:51'); assert.equal(formatLength(-3), '0:00');
assert.equal(timelineLength([{ clips: [{ start: 0, duration: 4 }, { start: 4, duration: 3 }] }, { clips: [{ start: 2, duration: 9 }] }]), 11);
assert.equal(timelineLength(null), 0);
console.log('✓ plan-before-apply: removal edits on mobile only; copy keys; lengths');

// request queue: wait only while the timeline video can't play
const F = { name: 'x' };
const up = { id: 'a', type: 'video', file: F, uploadPhase: 'uploading', isProxying: true, uploadProgress: 30 };
const ready = { id: 'r', type: 'video', uploadPhase: 'ready', isProxying: false };
const T = (clips) => [{ id: 'v', type: 'video', clips }];
assert.equal(aiWaitReason([up], T([{ id: 'c', assetId: 'a', start: 0, duration: 5 }])), 'uploading');
assert.equal(aiWaitReason([ready], T([{ id: 'c', assetId: 'r', start: 0, duration: 5 }])), null);
assert.equal(aiWaitReason([ready, up], T([{ id: 'c', assetId: 'r', start: 0, duration: 5 }])), null, 'bin-only upload never blocks Roka');
assert.equal(aiWaitReason([{ ...up, uploadError: 'x' }], T([{ id: 'c', assetId: 'a', start: 0, duration: 5 }])), 'failed');
assert.equal(aiWaitReason([], T([])), null);
console.log('✓ request queue waits only for timeline videos; failed uploads pause it');
// queue store: FIFO, shift returns the item it removed
const { default: useAIStore } = await import('../client/src/store/useAIStore.js');
const ai = useAIStore.getState();
ai.enqueuePrompt('one'); ai.enqueuePrompt('two');
assert.equal(useAIStore.getState().queuedPrompts.length, 2);
assert.equal(useAIStore.getState().shiftQueuedPrompt().text, 'one');
assert.equal(useAIStore.getState().shiftQueuedPrompt().text, 'two');
assert.equal(useAIStore.getState().shiftQueuedPrompt(), null);
ai.enqueuePrompt('x'); useAIStore.getState().clearQueuedPrompts();
assert.equal(useAIStore.getState().queuedPrompts.length, 0);
useAIStore.getState().setTaskOutcome('t1', 'undone');
assert.equal(useAIStore.getState().taskOutcomes.t1, 'undone');
console.log('✓ queue store FIFO + task outcomes');
console.log('\nALL MOBILE ROKA CHECKS PASSED');
