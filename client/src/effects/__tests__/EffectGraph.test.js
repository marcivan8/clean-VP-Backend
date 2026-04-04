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
});
