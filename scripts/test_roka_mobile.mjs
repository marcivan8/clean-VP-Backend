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
// ── R152: the composer matches the design, and the chat has no cards ────────
{
    const { readFileSync } = await import('fs');
    const bar  = readFileSync(new URL('../client/src/components/MobileAIBar.jsx', import.meta.url), 'utf8');
    const flow = readFileSync(new URL('../client/src/components/MobileFlow.jsx', import.meta.url), 'utf8');

    // Marc asked for the suggestion cards out of the chat. They were also the
    // one place still showing untranslated English ("Make it more dynamic").
    assert.ok(!/quickChips/.test(bar), 'the suggestion cards are gone, and so is the state they read');
    assert.ok(!/Suggestion chips/.test(bar));

    // One pill holding field and button, the way the design draws it and the
    // way the flow's own composer already looks.
    assert.match(bar, /padding: '6px 6px 6px 16px'/, 'the composer is one pill');
    assert.match(bar, /borderRadius: 999/);
    assert.match(bar, /background: 'transparent'/, 'the field sits inside the pill, undecorated');
    assert.match(bar, /background: 'var\(--fg\)', color: 'var\(--bg\)'/, 'send is the light circle, not the violet one');
    assert.ok(!/background: 'var\(--accent\)', color: '#fff'/.test(bar), 'the old violet send button is gone');
    assert.match(bar, /<ArrowRight/, 'the design uses an arrow, not a paper plane');

    // iOS Safari zooms the whole page on focus for any field under 16px. The
    // design says 14.5; a zoomed page costs more than half a pixel of type.
    const textarea = bar.slice(bar.indexOf('<textarea'), bar.indexOf('</div>', bar.indexOf('<textarea')));
    assert.match(textarea, /fontSize:\s*16\b/, 'the chat field must not trigger the iOS zoom');
    const flowInput = flow.slice(flow.indexOf('id="flow-ask"'));
    assert.match(flowInput.slice(0, 1200), /fontSize: 16\b/, 'the flow composer must not either');
    assert.ok(!/fontSize: 14\.5, fontFamily: 'var\(--f-sans\)', outline: 'none'/.test(flow),
        'the 14.5px flow input was the one Marc was typing into');

    console.log('\u2713 composer matches the design, no suggestion cards, no iOS zoom');
}

console.log('\nALL MOBILE ROKA CHECKS PASSED');
