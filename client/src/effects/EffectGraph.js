/**
 * EffectGraph.js
 * Manages connected effect chains for the Viral Pilot effects pipeline.
 * 
 * Supports node-based composition where effects can be connected
 * in various configurations (linear chains, parallel, etc.)
 */

import { EffectNode, createEffectNode } from './EffectNode.js';
import { effectRegistry } from './EffectRegistry.js';

const COMPOSITE_BLEND_MODES = Object.freeze([
    'source-over', 'multiply', 'screen', 'darken', 'lighten', 'difference',
    'addition', 'overlay', 'color-dodge', 'color-burn', 'hard-light',
    'soft-light', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
]);

function normalizeCompositeBlendMode(value) {
    const mode = String(value ?? 'source-over').trim().toLowerCase();
    if (mode === 'normal') return 'source-over';
    if (mode === 'add' || mode === 'plus-lighter') return 'addition';
    return mode;
}

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
        } else if (nodeOrConfig.type === 'composite') {
            const compositeParams = {};
            const suppliedParams = nodeOrConfig.params || {};
            const schemas = {
                mode: { value: 'source-over', type: 'select', options: COMPOSITE_BLEND_MODES, label: 'Blend Mode' },
                opacity: { value: 1, min: 0, max: 1, type: 'float', label: 'Opacity' },
            };
            for (const [key, schema] of Object.entries(schemas)) {
                const supplied = suppliedParams[key];
                const suppliedValue = supplied && typeof supplied === 'object' && !Array.isArray(supplied) && 'value' in supplied
                    ? supplied.value : supplied;
                compositeParams[key] = supplied && typeof supplied === 'object' && !Array.isArray(supplied) && 'value' in supplied
                    ? { ...schema, ...supplied, ...(key === 'mode' ? { value: normalizeCompositeBlendMode(suppliedValue), options: COMPOSITE_BLEND_MODES } : {}) }
                    : { ...schema, value: key === 'mode' ? normalizeCompositeBlendMode(suppliedValue) : (supplied ?? schema.value) };
            }
            for (const [key, value] of Object.entries(suppliedParams)) {
                if (!Object.hasOwn(schemas, key)) compositeParams[key] = value;
            }
            node = createEffectNode({
                ...nodeOrConfig,
                name: nodeOrConfig.name || 'Composite Branches',
                engine: 'gpu',
                params: compositeParams,
            });
        } else if (nodeOrConfig.type && effectRegistry.has(nodeOrConfig.type)) {
            // Create from registry
            const config = effectRegistry.createConfig(nodeOrConfig.type, nodeOrConfig);
            node = createEffectNode(config);
        } else {
            // Create generic node
            node = createEffectNode(nodeOrConfig);
        }

        // Normalize composites hydrated from saved EffectNode instances too.
        if (node.type === 'composite' && node.params?.mode) {
            node.params.mode.value = normalizeCompositeBlendMode(node.params.mode.value);
            node.params.mode.options = COMPOSITE_BLEND_MODES;
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
     * Describe the graph as ordered, parallel stages without flattening
     * branches into a serial effect stack. This is deliberately a topology
     * description only: a renderer must still implement the declared joins
     * (including their blend/composite operation) before it may execute a
     * branched plan.
     */
    getTopologyPlan() {
        if (!this.connections.length) {
            const orderedNodes = this.getAllNodes()
                .map((node, index) => ({ node, index }))
                .sort((a, b) => (Number(a.node.order) || 0) - (Number(b.node.order) || 0) || a.index - b.index)
                .map(({ node }) => node);
            return {
                valid: true,
                errors: [],
                stages: orderedNodes.map(node => [node]),
                orderedNodes,
                roots: orderedNodes.length ? [orderedNodes[0]] : [],
                sinks: orderedNodes.length ? [orderedNodes.at(-1)] : [],
                branches: [],
                joins: [],
                connections: [],
                implicitChain: true,
                executableAsLinearStack: true,
            };
        }

        const insertionOrder = new Map([...this.nodes.keys()].map((id, index) => [id, index]));
        const indegree = new Map([...this.nodes.keys()].map(id => [id, 0]));
        const outgoing = new Map([...this.nodes.keys()].map(id => [id, []]));
        const errors = [];

        for (const edge of this.connections) {
            if (!this.nodes.has(edge.from) || !this.nodes.has(edge.to)) {
                errors.push(`Connection references missing ${!this.nodes.has(edge.from) ? 'source' : 'destination'} node: ${!this.nodes.has(edge.from) ? edge.from : edge.to}`);
                continue;
            }
            outgoing.get(edge.from).push(edge);
            indegree.set(edge.to, indegree.get(edge.to) + 1);
        }

        const compareIds = (left, right) => {
            const leftNode = this.nodes.get(left), rightNode = this.nodes.get(right);
            const orderDelta = (Number(leftNode?.order) || 0) - (Number(rightNode?.order) || 0);
            return orderDelta || insertionOrder.get(left) - insertionOrder.get(right);
        };
        const ready = [...this.nodes.keys()].filter(id => indegree.get(id) === 0).sort(compareIds);
        const stages = [];
        const orderedIds = [];

        while (ready.length) {
            const stage = ready.splice(0).sort(compareIds);
            stages.push(stage);
            orderedIds.push(...stage);
            const next = new Set();
            for (const id of stage) {
                for (const edge of outgoing.get(id)) {
                    const remaining = indegree.get(edge.to) - 1;
                    indegree.set(edge.to, remaining);
                    if (remaining === 0) next.add(edge.to);
                }
            }
            ready.push(...[...next].sort(compareIds));
        }

        const hasCycle = orderedIds.length !== this.nodes.size;
        if (hasCycle) errors.push('Effect graph contains a circular dependency');
        const roots = [...this.nodes.keys()].filter(id => !this.connections.some(edge => edge.to === id && this.nodes.has(edge.from)));
        const sinks = [...this.nodes.keys()].filter(id => !(outgoing.get(id) || []).length);
        const branches = [...this.nodes.keys()].filter(id => (outgoing.get(id) || []).length > 1);
        const joins = [...this.nodes.keys()].filter(id => this.connections.filter(edge => edge.to === id && this.nodes.has(edge.from)).length > 1);

        return {
            valid: errors.length === 0,
            errors,
            stages: stages.map(stage => stage.map(id => this.nodes.get(id))),
            orderedNodes: orderedIds.map(id => this.nodes.get(id)),
            roots: roots.map(id => this.nodes.get(id)),
            sinks: sinks.map(id => this.nodes.get(id)),
            branches: branches.map(id => this.nodes.get(id)),
            joins: joins.map(id => this.nodes.get(id)),
            connections: this.connections.filter(edge => this.nodes.has(edge.from) && this.nodes.has(edge.to)).map(edge => ({ ...edge })),
            implicitChain: false,
            // Explicitly prevents consumers from mistaking a DAG ordering
            // for an executable render graph.
            executableAsLinearStack: errors.length === 0 && branches.length === 0 && joins.length === 0 && roots.length <= 1,
        };
    }

    /**
     * Validate and return an execution plan for a connected effect DAG.
     * Forks are allowed; joins must use an explicit composite node with one
     * `base` and one `overlay` input so renderers never guess merge semantics.
     */
    getExecutionPlan() {
        const topology = this.getTopologyPlan();
        if (!topology.valid) throw new Error(topology.errors.join('; '));
        if (!this.connections.length) {
            const standaloneComposite = topology.orderedNodes.find(node => node.type === 'composite');
            if (standaloneComposite) {
                throw new Error(`Composite node "${standaloneComposite.name || standaloneComposite.id}" requires base and overlay inputs`);
            }
            return { ...topology, graph: this };
        }
        // Check reachability before enforcing a single sink. An orphan node
        // creates extra roots and sinks too, but that is a disconnected graph
        // with a concrete repair (reconnect/remove the orphan), not merely an
        // ambiguous multi-output DAG.
        if (topology.roots.length !== 1) {
            throw new Error('Effect graph contains disconnected nodes and must have one input');
        }
        const reachable = new Set();
        const visit = node => {
            if (reachable.has(node.id)) return;
            reachable.add(node.id);
            for (const edge of this.getOutputConnections(node.id)) visit(this.nodes.get(edge.to));
        };
        visit(topology.roots[0]);
        if (reachable.size !== this.nodes.size) throw new Error('Effect graph contains disconnected nodes');
        if (topology.sinks.length !== 1) {
            throw new Error('Effect graph must have one input and one output');
        }

        for (const node of topology.orderedNodes) {
            const incoming = this.getInputConnections(node.id);
            if (incoming.length > 1) {
                const ports = incoming.map(edge => edge.port);
                if (node.type !== 'composite' || incoming.length !== 2
                    || new Set(ports).size !== 2 || !ports.includes('base') || !ports.includes('overlay')) {
                    throw new Error(`Effect graph join "${node.name || node.id}" must be a composite node with one base and one overlay input`);
                }
            } else if (node.type === 'composite') {
                throw new Error(`Composite node "${node.name || node.id}" requires base and overlay inputs`);
            }
        }
        return { ...topology, graph: this };
    }

    /**
     * Return the executable effect stack for a linear graph. Branched graphs
     * must be consumed through getExecutionPlan() by a DAG-capable renderer.
     */
    getExecutionOrder() {
        if (!this.connections.length) {
            return this.getAllNodes()
                .map((node, index) => ({ node, index }))
                .sort((a, b) => (Number(a.node.order) || 0) - (Number(b.node.order) || 0) || a.index - b.index)
                .map(({ node }) => node);
        }

        // Also performs cycle detection.
        const topological = this.getProcessingOrder();
        const incoming = new Map([...this.nodes.keys()].map(id => [id, 0]));
        const outgoing = new Map([...this.nodes.keys()].map(id => [id, 0]));
        for (const edge of this.connections) {
            incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1);
            outgoing.set(edge.from, (outgoing.get(edge.from) || 0) + 1);
        }

        const roots = [...this.nodes.keys()].filter(id => incoming.get(id) === 0);
        if ([...incoming.values()].some(count => count > 1) || [...outgoing.values()].some(count => count > 1)) {
            throw new Error('Effect graph must be a single linear chain; branching and multi-input graphs are not supported');
        }
        if (roots.length !== 1) {
            throw new Error('Effect graph contains disconnected nodes and cannot be executed as one stack');
        }

        const chain = [];
        const visited = new Set();
        let current = roots[0];
        while (current != null) {
            if (visited.has(current)) break;
            visited.add(current);
            const node = this.nodes.get(current);
            if (node) chain.push(node);
            const edge = this.connections.find(item => item.from === current);
            current = edge?.to ?? null;
        }

        if (chain.length !== this.nodes.size || topological.length !== this.nodes.size) {
            throw new Error('Effect graph contains disconnected nodes and cannot be executed as one stack');
        }
        return chain;
    }

    /**
     * Get linear chain of nodes (for simple sequential graphs)
     */
    getLinearChain() {
        return this.getExecutionOrder();
    }

    // ========================================================================
    // EFFECT CHAIN OPERATIONS
    // ========================================================================

    /**
     * Get effects active at a specific time
     */
    getActiveEffectsAt(time, placement = null) {
        return this.getExecutionPlan().orderedNodes.filter(node =>
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

        // Topological order alone is insufficient: joins need an explicit
        // composite operation and the full graph must have one source/sink.
        try {
            this.getExecutionPlan();
        } catch (e) {
            if (!errors.includes(e.message)) errors.push(e.message);
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

        // Invalid topology is not synonymous with a cycle: a DAG can be
        // unsupported by the current linear renderer because it forks,
        // joins, or contains disconnected nodes. Keep those states distinct
        // so the UI and diagnostics do not tell users to repair a cycle that
        // does not exist.
        const validation = this.validate();
        const hasCircularDeps = validation.errors.some(error => /circular dependency/i.test(error));
        const topology = this.getTopologyPlan();

        return {
            totalNodes: this.nodes.size,
            totalConnections: this.connections.length,
            nodesByEngine,
            nodesByCategory,
            hasCircularDeps,
            isExecutable: validation.valid,
            validationErrors: validation.errors,
            topology: {
                valid: topology.valid,
                roots: topology.roots.length,
                sinks: topology.sinks.length,
                branchNodes: topology.branches.length,
                joinNodes: topology.joins.length,
                executableAsLinearStack: topology.executableAsLinearStack,
            },
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
