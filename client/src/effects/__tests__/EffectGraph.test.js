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
    });

    it('uses connections as the execution order even when authored order differs', () => {
        graph.addNode(new EffectNode({ id: 'a', order: 9 }));
        graph.addNode(new EffectNode({ id: 'b', order: 0 }));
        graph.addNode(new EffectNode({ id: 'c', order: 4 }));
        graph.connect('a', 'b').connect('b', 'c');
        expect(graph.getExecutionOrder().map(node => node.id)).toEqual(['a', 'b', 'c']);
    });

    it('rejects branched graphs rather than silently dropping an effect', () => {
        graph.addNode(new EffectNode({ id: 'a' }));
        graph.addNode(new EffectNode({ id: 'b' }));
        graph.addNode(new EffectNode({ id: 'c' }));
        graph.connect('a', 'b').connect('a', 'c');
        expect(() => graph.getExecutionOrder()).toThrow(/single linear chain/);
        expect(graph.validate()).toMatchObject({ valid: false });
        expect(graph.validate().errors.join(' ')).toMatch(/single linear chain/);
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
