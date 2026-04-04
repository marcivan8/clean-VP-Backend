/**
 * EffectGraph.js
 * Manages connected effect chains for the Viral Pilot effects pipeline.
 * 
 * Supports node-based composition where effects can be connected
 * in various configurations (linear chains, parallel, etc.)
 */

import { EffectNode, createEffectNode } from './EffectNode.js';
import { effectRegistry } from './EffectRegistry.js';

// ============================================================================
// EFFECT GRAPH CLASS
// ============================================================================

export class EffectGraph {
    constructor() {
        // Map of node ID -> EffectNode
        this.nodes = new Map();

        // Connections: [{ from: nodeId, to: nodeId, port?: string }]
        this.connections = [];

        // Input/output nodes (for connecting to external sources)
        this.inputNodeId = null;
        this.outputNodeId = null;

        // Cached processing order
        this._processingOrder = null;
        this._orderDirty = true;
    }

    // ========================================================================
    // NODE MANAGEMENT
    // ========================================================================

    /**
     * Add a node to the graph
     * @param {EffectNode|object} nodeOrConfig - EffectNode instance or config
     * @returns {EffectNode} The added node
     */
    addNode(nodeOrConfig) {
        let node;

        if (nodeOrConfig instanceof EffectNode) {
            node = nodeOrConfig;
        } else if (nodeOrConfig.type && effectRegistry.has(nodeOrConfig.type)) {
            // Create from registry
            const config = effectRegistry.createConfig(nodeOrConfig.type, nodeOrConfig);
            node = createEffectNode(config);
        } else {
            // Create generic node
            node = createEffectNode(nodeOrConfig);
        }

        this.nodes.set(node.id, node);
        this._orderDirty = true;

        return node;
    }

    /**
     * Remove a node from the graph
     */
    removeNode(nodeId) {
        // Remove associated connections
        this.connections = this.connections.filter(
            conn => conn.from !== nodeId && conn.to !== nodeId
        );

        this.nodes.delete(nodeId);
        this._orderDirty = true;
    }

    /**
     * Get a node by ID
     */
    getNode(nodeId) {
        return this.nodes.get(nodeId);
    }

    /**
     * Get all nodes
     */
    getAllNodes() {
        return Array.from(this.nodes.values());
    }

    /**
     * Get nodes count
     */
    get size() {
        return this.nodes.size;
    }

    /**
     * Check if graph is empty
     */
    get isEmpty() {
        return this.nodes.size === 0;
    }

    // ========================================================================
    // CONNECTION MANAGEMENT
    // ========================================================================

    /**
     * Connect two nodes
     * @param {string} fromId - Source node ID
     * @param {string} toId - Destination node ID
     * @param {string} port - Optional port name for multi-input nodes
     */
    connect(fromId, toId, port = 'default') {
        // Validate nodes exist
        if (!this.nodes.has(fromId)) {
            throw new Error(`Source node not found: ${fromId}`);
        }
        if (!this.nodes.has(toId)) {
            throw new Error(`Destination node not found: ${toId}`);
        }

        // Check for duplicate connection
        const exists = this.connections.some(
            conn => conn.from === fromId && conn.to === toId && conn.port === port
        );

        if (!exists) {
            this.connections.push({ from: fromId, to: toId, port });
            this._orderDirty = true;
        }

        return this;
    }

    /**
     * Disconnect two nodes
     */
    disconnect(fromId, toId, port = null) {
        this.connections = this.connections.filter(conn => {
            if (conn.from !== fromId || conn.to !== toId) return true;
            if (port !== null && conn.port !== port) return true;
            return false;
        });
        this._orderDirty = true;
    }

    /**
     * Get outgoing connections from a node
     */
    getOutputConnections(nodeId) {
        return this.connections.filter(conn => conn.from === nodeId);
    }

    /**
     * Get incoming connections to a node
     */
    getInputConnections(nodeId) {
        return this.connections.filter(conn => conn.to === nodeId);
    }

    // ========================================================================
    // PROCESSING ORDER
    // ========================================================================

    /**
     * Get nodes in processing order (topological sort)
     * @returns {EffectNode[]} Nodes in order they should be processed
     */
    getProcessingOrder() {
        if (!this._orderDirty && this._processingOrder) {
            return this._processingOrder;
        }

        const sorted = [];
        const visited = new Set();
        const visiting = new Set();

        const visit = (nodeId) => {
            if (visited.has(nodeId)) return;
            if (visiting.has(nodeId)) {
                throw new Error(`Circular dependency detected at node: ${nodeId}`);
            }

            visiting.add(nodeId);

            // Visit dependencies first (nodes that feed into this one)
            const inputs = this.getInputConnections(nodeId);
            for (const conn of inputs) {
                visit(conn.from);
            }

            visiting.delete(nodeId);
            visited.add(nodeId);

            const node = this.nodes.get(nodeId);
            if (node) {
                sorted.push(node);
            }
        };

        // Visit all nodes
        for (const nodeId of this.nodes.keys()) {
            visit(nodeId);
        }

        this._processingOrder = sorted;
        this._orderDirty = false;

        return sorted;
    }

    /**
     * Get linear chain of nodes (for simple sequential graphs)
     */
    getLinearChain() {
        // Find the start node (no inputs)
        let startId = null;
        for (const nodeId of this.nodes.keys()) {
            if (this.getInputConnections(nodeId).length === 0) {
                startId = nodeId;
                break;
            }
        }

        if (!startId) {
            // Return in order of addition if no clear start
            return this.getAllNodes().sort((a, b) => a.order - b.order);
        }

        // Traverse chain
        const chain = [];
        let currentId = startId;
        const visited = new Set();

        while (currentId && !visited.has(currentId)) {
            visited.add(currentId);
            const node = this.nodes.get(currentId);
            if (node) {
                chain.push(node);
            }

            // Get next node
            const outputs = this.getOutputConnections(currentId);
            currentId = outputs.length > 0 ? outputs[0].to : null;
        }

        return chain;
    }

    // ========================================================================
    // EFFECT CHAIN OPERATIONS
    // ========================================================================

    /**
     * Get effects active at a specific time
     */
    getActiveEffectsAt(time, placement = null) {
        return this.getProcessingOrder().filter(node =>
            node.enabled && node.isActiveAt(time, placement)
        );
    }

    /**
     * Get effects by engine type
     */
    getEffectsByEngine(engine) {
        return this.getAllNodes().filter(node => node.engine === engine);
    }

    /**
     * Build a linear chain from an array of effects
     */
    static fromLinearChain(effects) {
        const graph = new EffectGraph();

        let prevNode = null;
        for (const effect of effects) {
            const node = graph.addNode(effect);

            if (prevNode) {
                graph.connect(prevNode.id, node.id);
            }

            prevNode = node;
        }

        return graph;
    }

    /**
     * Build chain for a specific target
     */
    static forTarget(effects, targetId) {
        const targetEffects = effects.filter(e => e.targetId === targetId);
        targetEffects.sort((a, b) => (a.order || 0) - (b.order || 0));
        return EffectGraph.fromLinearChain(targetEffects);
    }

    // ========================================================================
    // SERIALIZATION
    // ========================================================================

    /**
     * Serialize graph to plain object
     */
    serialize() {
        return {
            nodes: this.getAllNodes().map(node => node.serialize()),
            connections: [...this.connections],
            inputNodeId: this.inputNodeId,
            outputNodeId: this.outputNodeId
        };
    }

    /**
     * Create graph from serialized data
     */
    static deserialize(data) {
        const graph = new EffectGraph();

        // Restore nodes
        for (const nodeData of data.nodes || []) {
            const node = EffectNode.deserialize(nodeData);
            graph.nodes.set(node.id, node);
        }

        // Restore connections
        graph.connections = [...(data.connections || [])];
        graph.inputNodeId = data.inputNodeId;
        graph.outputNodeId = data.outputNodeId;

        return graph;
    }

    /**
     * Clone the graph
     */
    clone() {
        return EffectGraph.deserialize(this.serialize());
    }

    // ========================================================================
    // UTILITY METHODS
    // ========================================================================

    /**
     * Clear all nodes and connections
     */
    clear() {
        this.nodes.clear();
        this.connections = [];
        this.inputNodeId = null;
        this.outputNodeId = null;
        this._orderDirty = true;
        this._processingOrder = null;
    }

    /**
     * Validate the graph
     */
    validate() {
        const errors = [];

        // Check for orphan connections
        for (const conn of this.connections) {
            if (!this.nodes.has(conn.from)) {
                errors.push(`Connection references missing source node: ${conn.from}`);
            }
            if (!this.nodes.has(conn.to)) {
                errors.push(`Connection references missing destination node: ${conn.to}`);
            }
        }

        // Check for circular dependencies
        try {
            this.getProcessingOrder();
        } catch (e) {
            errors.push(e.message);
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Get graph statistics
     */
    getStats() {
        const nodesByEngine = {};
        const nodesByCategory = {};

        for (const node of this.nodes.values()) {
            // By engine
            nodesByEngine[node.engine] = (nodesByEngine[node.engine] || 0) + 1;

            // By category (from registry)
            const def = effectRegistry.get(node.type);
            if (def?.category) {
                nodesByCategory[def.category] = (nodesByCategory[def.category] || 0) + 1;
            }
        }

        return {
            totalNodes: this.nodes.size,
            totalConnections: this.connections.length,
            nodesByEngine,
            nodesByCategory,
            hasCircularDeps: !this.validate().valid
        };
    }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new effect graph
 */
export function createEffectGraph(config = {}) {
    const graph = new EffectGraph();

    if (config.nodes) {
        for (const nodeConfig of config.nodes) {
            graph.addNode(nodeConfig);
        }
    }

    if (config.connections) {
        for (const conn of config.connections) {
            graph.connect(conn.from, conn.to, conn.port);
        }
    }

    return graph;
}

export default EffectGraph;
