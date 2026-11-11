import assert from 'node:assert/strict';
import { groupCompositionEntries, resolveCompositionOpacity } from '../client/src/motion/CompositionGrouping.js';

const entry = (name, compositionStack = []) => ({
    clip: { id: name, compositionStack },
    element: name,
});
const group = (id, extra = {}) => ({ id, start: 0, duration: 10, ...extra });

assert.equal(resolveCompositionOpacity([group('static', { opacity: 0.5 }), group('nested', { opacity: 0.4 })], 1), 0.2,
    'nested static opacities multiply once');
assert.equal(resolveCompositionOpacity([group('animated', { opacity: 0.8, duration: 2,
    opacityAnimations: [{ type: 'fade', startTime: 0, duration: 2,
        keyframes: [{ time: 0, properties: { opacity: 0 } }, { time: 2, properties: { opacity: 1 } }] }] })], 1), 0.4,
    'group opacity animation is resolved on the timeline clock');
assert.equal(resolveCompositionOpacity([group('expression', { opacityExpression: '0.25' })], 1), 0.25,
    'group opacity expressions use the shared motion resolver');

// Same composition siblings can be separated by flattened track ordering.
// They must still render as one isolated parent at the first child's position.
const nonAdjacent = groupCompositionEntries([
    entry('child-a', [group('scene')]),
    entry('unrelated'),
    entry('child-b', [group('scene')]),
]);
assert.equal(nonAdjacent.length, 2);
assert.equal(nonAdjacent[0].type, 'composition');
assert.deepEqual(nonAdjacent[0].children.map(node => node.entry.element), ['child-a', 'child-b']);
assert.equal(nonAdjacent[1].entry.element, 'unrelated');

// Nested ancestry keeps identically named child compositions under separate
// parents from accidentally merging.
const nested = groupCompositionEntries([
    entry('a1', [group('parent-a'), group('nested')]),
    entry('b1', [group('parent-b'), group('nested')]),
    entry('a2', [group('parent-a'), group('nested')]),
]);
assert.deepEqual(nested.map(node => node.group?.id || node.entry.element), ['parent-a', 'parent-b']);
assert.deepEqual(nested[0].children[0].children.map(node => node.entry.element), ['a1', 'a2']);
assert.deepEqual(nested[1].children[0].children.map(node => node.entry.element), ['b1']);

// Ungrouped entries remain ordinary layers and maintain their relative order.
const mixed = groupCompositionEntries([
    entry('before'),
    entry('inside', [group('g')]),
    entry('after'),
]);
assert.deepEqual(mixed.map(node => node.entry?.element || node.group.id), ['before', 'g', 'after']);

// Composition node IDs are scene-local. Two scenes can legitimately reuse a
// node ID and must still receive independent isolated groups.
const sceneScoped = groupCompositionEntries([
    { clip: { ...entry('scene-a-child', [group('reused-id')]).clip, sceneId: 'scene-a' }, element: 'scene-a-child' },
    { clip: { ...entry('scene-b-child', [group('reused-id')]).clip, sceneId: 'scene-b' }, element: 'scene-b-child' },
]);
assert.equal(sceneScoped.length, 2);
assert.deepEqual(sceneScoped.map(node => node.children[0].entry.element), ['scene-a-child', 'scene-b-child']);

console.log('Composition grouping checks passed.');
