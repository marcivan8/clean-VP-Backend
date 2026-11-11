import { EffectGraph } from '../EffectGraph';
import { EffectNode } from '../EffectNode';
import { describe, it, expect, beforeEach } from '@jest/globals';

describe('EffectGraph', () => {
    let graph;

    beforeEach(() => {
        graph = new EffectGraph();
    });

    it('should add nodes', () => {
        const node = new EffectNode({ type: 'blur' });
        graph.addNode(node);
        expect(graph.nodes.has(node.id)).toBe(true);
    });

    it('should connect nodes', () => {
        const node1 = new EffectNode({ type: 'blur', id: 'n1' });
        const node2 = new EffectNode({ type: 'glow', id: 'n2' });

        graph.addNode(node1);
        graph.addNode(node2);

        graph.connect('n1', 'n2');

        expect(graph.connections.length).toBe(1);
        expect(graph.connections[0]).toEqual({ from: 'n1', to: 'n2', port: 'default' });
    });

    it('should perform topological sort', () => {
        // n1 -> n2 -> n3
        const n1 = new EffectNode({ id: 'n1' });
        const n2 = new EffectNode({ id: 'n2' });
        const n3 = new EffectNode({ id: 'n3' });

        graph.addNode(n1);
        graph.addNode(n2);
        graph.addNode(n3);

        graph.connect('n1', 'n2');
        graph.connect('n2', 'n3');

        const order = graph.getProcessingOrder();
        const ids = order.map(n => n.id);

        expect(ids).toEqual(['n1', 'n2', 'n3']);
    });

    it('should detect cycles', () => {
        const n1 = new EffectNode({ id: 'n1' });
        const n2 = new EffectNode({ id: 'n2' });

        graph.addNode(n1);
        graph.addNode(n2);

        graph.connect('n1', 'n2');
        graph.connect('n2', 'n1'); // Cycle!

        expect(() => graph.getProcessingOrder()).toThrow();
    });

    it('uses authored order for an unconnected effect stack', () => {
        graph.addNode(new EffectNode({ id: 'later', order: 8 }));
        graph.addNode(new EffectNode({ id: 'first', order: 1 }));
        expect(graph.getExecutionOrder().map(node => node.id)).toEqual(['first', 'later']);
        const plan = graph.getTopologyPlan();
        expect(plan.implicitChain).toBe(true);
        expect(plan.stages.map(stage => stage.map(node => node.id))).toEqual([['first'], ['later']]);
        expect(plan.executableAsLinearStack).toBe(true);
    });

    it('uses connections as the execution order even when authored order differs', () => {
        graph.addNode(new EffectNode({ id: 'a', order: 9 }));
        graph.addNode(new EffectNode({ id: 'b', order: 0 }));
        graph.addNode(new EffectNode({ id: 'c', order: 4 }));
        graph.connect('a', 'b').connect('b', 'c');
        expect(graph.getExecutionOrder().map(node => node.id)).toEqual(['a', 'b', 'c']);
    });

    it('rejects branched graphs with ambiguous outputs rather than silently dropping an effect', () => {
        graph.addNode(new EffectNode({ id: 'a' }));
        graph.addNode(new EffectNode({ id: 'b' }));
        graph.addNode(new EffectNode({ id: 'c' }));
        graph.connect('a', 'b').connect('a', 'c');
        expect(() => graph.getExecutionPlan()).toThrow(/one input and one output/);
        expect(graph.validate()).toMatchObject({ valid: false });
        expect(graph.validate().errors.join(' ')).toMatch(/one input and one output/);
    });

    it('accepts branch DAGs that reunite at an explicit base/overlay composite', () => {
        for (const id of ['source', 'left', 'right', 'merge', 'finish']) {
            graph.addNode(new EffectNode({ id, type: id === 'merge' ? 'composite' : 'glow', engine: 'gpu' }));
        }
        graph.connect('source', 'left')
            .connect('source', 'right')
            .connect('left', 'merge', 'base')
            .connect('right', 'merge', 'overlay')
            .connect('merge', 'finish');

        const plan = graph.getTopologyPlan();
        expect(plan.valid).toBe(true);
        expect(plan.stages.map(stage => stage.map(node => node.id))).toEqual([
            ['source'], ['left', 'right'], ['merge'], ['finish']
        ]);
        expect(plan.branches.map(node => node.id)).toEqual(['source']);
        expect(plan.joins.map(node => node.id)).toEqual(['merge']);
        expect(plan.roots.map(node => node.id)).toEqual(['source']);
        expect(plan.sinks.map(node => node.id)).toEqual(['finish']);
        expect(plan.executableAsLinearStack).toBe(false);
        expect(graph.getExecutionPlan().orderedNodes.map(node => node.id)).toEqual(['source', 'left', 'right', 'merge', 'finish']);
        expect(graph.validate()).toMatchObject({ valid: true, errors: [] });
        expect(graph.getStats().topology).toMatchObject({
            valid: true, branchNodes: 1, joinNodes: 1, executableAsLinearStack: false
        });
        expect(() => graph.getExecutionOrder()).toThrow(/single linear chain/);
    });

    it('rejects joins without the explicit composite node and named ports', () => {
        graph.addNode(new EffectNode({ id: 'a', type: 'glow', engine: 'gpu' }));
        graph.addNode(new EffectNode({ id: 'b', type: 'glow', engine: 'gpu' }));
        graph.addNode(new EffectNode({ id: 'join', type: 'glow', engine: 'gpu' }));
        graph.connect('a', 'join', 'base').connect('b', 'join', 'overlay');
        expect(() => graph.getExecutionPlan()).toThrow(/must be a composite node/);
        expect(graph.validate()).toMatchObject({ valid: false });
    });

    it('reports cycles in topology plans instead of returning a partial execution order', () => {
        graph.addNode(new EffectNode({ id: 'a' }));
        graph.addNode(new EffectNode({ id: 'b' }));
        graph.connect('a', 'b').connect('b', 'a');
        const plan = graph.getTopologyPlan();
        expect(plan.valid).toBe(false);
        expect(plan.errors.join(' ')).toMatch(/circular dependency/);
        expect(plan.orderedNodes).toEqual([]);
    });

    it('rejects disconnected nodes in a connected graph', () => {
        graph.addNode(new EffectNode({ id: 'a' }));
        graph.addNode(new EffectNode({ id: 'b' }));
        graph.addNode(new EffectNode({ id: 'orphan' }));
        graph.connect('a', 'b');
        expect(() => graph.getExecutionOrder()).toThrow(/disconnected nodes/);
        expect(graph.validate()).toMatchObject({ valid: false });
        expect(graph.validate().errors.join(' ')).toMatch(/disconnected nodes/);
    });

    it('reports cyclic graphs as invalid', () => {
        graph.addNode(new EffectNode({ id: 'a' }));
        graph.addNode(new EffectNode({ id: 'b' }));
        graph.connect('a', 'b').connect('b', 'a');
        expect(graph.validate()).toMatchObject({ valid: false });
        expect(graph.validate().errors.join(' ')).toMatch(/Circular dependency/);
    });
});
