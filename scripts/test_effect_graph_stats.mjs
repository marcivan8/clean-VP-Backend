import assert from 'node:assert/strict';
import { EffectGraph } from '../client/src/effects/EffectGraph.js';
import { EffectNode } from '../client/src/effects/EffectNode.js';

const add = (graph, id) => graph.addNode(new EffectNode({ id, type: 'blur' }));

const linear = new EffectGraph();
add(linear, 'a'); add(linear, 'b');
linear.connect('a', 'b');
assert.deepEqual(linear.getStats(), {
    totalNodes: 2,
    totalConnections: 1,
    nodesByEngine: { gpu: 2 },
    nodesByCategory: {},
    hasCircularDeps: false,
    isExecutable: true,
    validationErrors: [],
    topology: {
        valid: true,
        roots: 1,
        sinks: 1,
        branchNodes: 0,
        joinNodes: 0,
        executableAsLinearStack: true,
    },
});

const implicit = new EffectGraph();
add(implicit, 'late').order = 5;
add(implicit, 'early').order = 1;
assert.deepEqual(implicit.getTopologyPlan().orderedNodes.map(node => node.id), ['early', 'late']);
assert.equal(implicit.getStats().topology.executableAsLinearStack, true,
    'an unconnected authored-order stack is represented as an implicit chain');

const branch = new EffectGraph();
add(branch, 'a'); add(branch, 'b'); add(branch, 'c');
branch.connect('a', 'b').connect('a', 'c');
const branchStats = branch.getStats();
assert.equal(branchStats.hasCircularDeps, false, 'an acyclic fork is not reported as a cycle');
assert.equal(branchStats.isExecutable, false, 'a fork with multiple outputs has no defined composition');
assert.match(branchStats.validationErrors.join(' '), /one input and one output/);
assert.deepEqual(branchStats.topology, {
    valid: true,
    roots: 1,
    sinks: 2,
    branchNodes: 1,
    joinNodes: 0,
    executableAsLinearStack: false,
});

const compositeDag = new EffectGraph();
add(compositeDag, 'source'); add(compositeDag, 'base'); add(compositeDag, 'overlay');
compositeDag.addNode({ id: 'merge', type: 'composite' });
compositeDag.connect('source', 'base').connect('source', 'overlay')
    .connect('base', 'merge', 'base').connect('overlay', 'merge', 'overlay');
assert.equal(compositeDag.getStats().isExecutable, true,
    'a fork with an explicit base/overlay composite is executable');

const cycle = new EffectGraph();
add(cycle, 'a'); add(cycle, 'b');
cycle.connect('a', 'b').connect('b', 'a');
const cycleStats = cycle.getStats();
assert.equal(cycleStats.hasCircularDeps, true, 'actual cycles remain distinguishable');
assert.equal(cycleStats.isExecutable, false);
assert.match(cycleStats.validationErrors.join(' '), /circular dependency/i);

console.log('Effect graph diagnostics passed: cycle state is distinct from unsupported DAG topology.');
