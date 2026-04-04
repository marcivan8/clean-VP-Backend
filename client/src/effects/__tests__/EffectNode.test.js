import { EffectNode } from '../EffectNode';
import { describe, it, expect, beforeEach } from '@jest/globals';

describe('EffectNode', () => {
    let node;

    beforeEach(() => {
        node = new EffectNode({
            type: 'blur_gaussian',
            params: { radius: { value: 10 } }
        });
    });

    it('should initialize with correct defaults', () => {
        expect(node.type).toBe('blur_gaussian');
        expect(node.enabled).toBe(true);
        expect(node.params).toHaveProperty('radius');
        expect(node.params.radius.value).toBe(10);
    });

    it('should handle parameter updates', () => {
        node.updateParams({ radius: 20 });
        expect(node.params.radius.value).toBe(20);
    });

    it('should interpolate keyframes correctly', () => {
        // Add keyframes
        node.addKeyframe('radius', 0, 0);   // time 0, value 0
        node.addKeyframe('radius', 10, 100); // time 10, value 100

        // Test interpolation
        expect(node.getParamAt('radius', 0)).toBe(0);
        expect(node.getParamAt('radius', 5)).toBe(50); // Linear midpoint
        expect(node.getParamAt('radius', 10)).toBe(100);
    });

    it('should respect time bounds', () => {
        node.startTime = 5;
        node.endTime = 10;

        expect(node.isActiveAt(4)).toBe(false);
        expect(node.isActiveAt(5)).toBe(true);
        expect(node.isActiveAt(7)).toBe(true);
        expect(node.isActiveAt(10)).toBe(true);
        expect(node.isActiveAt(11)).toBe(false);
    });

    it('should serialize and deserialize correctly', () => {
        const json = node.serialize();
        const copy = EffectNode.deserialize(json);

        expect(copy.id).toBe(node.id);
        expect(copy.type).toBe(node.type);
        expect(copy.params.radius.value).toBe(node.params.radius.value);
    });
});
