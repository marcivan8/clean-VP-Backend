/**
 * OrchestratorEvents
 * Event emitter for UI consumption.
 * Emits progress, state changes, and completion events.
 */

// Event Types
export const EVENT_TYPES = {
    STATE_CHANGE: 'ORCHESTRATOR_STATE_CHANGE',
    PROGRESS: 'ORCHESTRATOR_PROGRESS',
    AGENT_START: 'ORCHESTRATOR_AGENT_START',
    AGENT_COMPLETE: 'ORCHESTRATOR_AGENT_COMPLETE',
    ERROR: 'ORCHESTRATOR_ERROR',
    COMPLETE: 'ORCHESTRATOR_COMPLETE',
    CLARIFICATION_NEEDED: 'ORCHESTRATOR_CLARIFICATION_NEEDED',
    CANCELLED: 'ORCHESTRATOR_CANCELLED',
    TIMEOUT: 'ORCHESTRATOR_TIMEOUT'
};

/**
 * Simple EventEmitter implementation for browser environments
 */
export class OrchestratorEventEmitter {
    constructor() {
        this.listeners = new Map();
    }

    /**
     * Subscribe to an event
     * @param {string} eventType - Event type from EVENT_TYPES
     * @param {function} callback - Handler function
     * @returns {function} Unsubscribe function
     */
    on(eventType, callback) {
        if (!this.listeners.has(eventType)) {
            this.listeners.set(eventType, new Set());
        }
        this.listeners.get(eventType).add(callback);

        // Return unsubscribe function
        return () => this.off(eventType, callback);
    }

    /**
     * Subscribe to an event (one-time)
     * @param {string} eventType - Event type
     * @param {function} callback - Handler function
     */
    once(eventType, callback) {
        const wrapper = (data) => {
            this.off(eventType, wrapper);
            callback(data);
        };
        this.on(eventType, wrapper);
    }

    /**
     * Unsubscribe from an event
     * @param {string} eventType - Event type
     * @param {function} callback - Handler to remove
     */
    off(eventType, callback) {
        if (this.listeners.has(eventType)) {
            this.listeners.get(eventType).delete(callback);
        }
    }

    /**
     * Emit an event
     * @param {string} eventType - Event type
     * @param {object} data - Event payload
     */
    emit(eventType, data) {
        const timestamp = Date.now();
        const event = { type: eventType, timestamp, ...data };

        console.log(`[Orchestrator Event] ${eventType}`, event);

        if (this.listeners.has(eventType)) {
            this.listeners.get(eventType).forEach(callback => {
                try {
                    callback(event);
                } catch (err) {
                    console.error(`[Orchestrator Event] Handler error:`, err);
                }
            });
        }

        // Also emit to wildcard listeners
        if (this.listeners.has('*')) {
            this.listeners.get('*').forEach(callback => {
                try {
                    callback(event);
                } catch (err) {
                    console.error(`[Orchestrator Event] Wildcard handler error:`, err);
                }
            });
        }
    }

    /**
     * Remove all listeners
     */
    removeAllListeners() {
        this.listeners.clear();
    }

    /**
     * Helper: Emit state change event
     */
    emitStateChange(jobId, fromState, toState, context = {}) {
        this.emit(EVENT_TYPES.STATE_CHANGE, {
            jobId,
            fromState,
            toState,
            progress: context.progress || 0,
            ...context
        });
    }

    /**
     * Helper: Emit progress event
     */
    emitProgress(jobId, progress, message = '') {
        this.emit(EVENT_TYPES.PROGRESS, {
            jobId,
            progress,
            message
        });
    }

    /**
     * Helper: Emit agent start event
     */
    emitAgentStart(jobId, agentName, input = {}) {
        this.emit(EVENT_TYPES.AGENT_START, {
            jobId,
            agent: agentName,
            input
        });
    }

    /**
     * Helper: Emit agent complete event
     */
    emitAgentComplete(jobId, agentName, result = {}) {
        this.emit(EVENT_TYPES.AGENT_COMPLETE, {
            jobId,
            agent: agentName,
            result,
            success: result.success !== false
        });
    }

    /**
     * Helper: Emit error event
     */
    emitError(jobId, error, state = null) {
        this.emit(EVENT_TYPES.ERROR, {
            jobId,
            error: error instanceof Error ? error.message : error,
            state,
            stack: error instanceof Error ? error.stack : undefined
        });
    }

    /**
     * Helper: Emit completion event
     */
    emitComplete(jobId, result = {}) {
        this.emit(EVENT_TYPES.COMPLETE, {
            jobId,
            success: true,
            ...result
        });
    }

    /**
     * Helper: Emit timeout event
     */
    emitTimeout(jobId, phase, elapsedMs) {
        this.emit(EVENT_TYPES.TIMEOUT, {
            jobId,
            phase,
            elapsedMs
        });
    }

    /**
     * Helper: Emit cancelled event
     */
    emitCancelled(jobId, reason = 'User cancelled') {
        this.emit(EVENT_TYPES.CANCELLED, {
            jobId,
            reason
        });
    }
}

// Singleton instance
export const orchestratorEvents = new OrchestratorEventEmitter();

export default OrchestratorEventEmitter;
