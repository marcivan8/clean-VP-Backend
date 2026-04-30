/**
 * EventBus - Decoupled Pub/Sub System for Viral Pilot
 *
 * Core infrastructure for non-blocking, event-driven architecture.
 * All agents communicate through typed events, never direct calls.
 *
 * Features:
 * - Typed event subscriptions
 * - Wildcard subscriptions (*) for debugging
 * - Automatic unsubscribe on component unmount
 * - Event history for debugging
 * - Priority-based event dispatch
 */

// Event Types - Centralized event definitions
export const EVENT_TYPES = {
    // Job Lifecycle
    JOB_CREATED: 'job:created',
    JOB_STARTED: 'job:started',
    JOB_COMPLETED: 'job:completed',
    JOB_FAILED: 'job:failed',
    JOB_CANCELLED: 'job:cancelled',
    JOB_TIMEOUT: 'job:timeout',
    JOB_HUNG: 'job:hung',

    // Planning Phase
    PHASE_PLANNING: 'phase:planning',
    INTENT_PARSED: 'intent:parsed',
    INTENT_FAILED: 'intent:failed',
    PLAN_READY: 'plan:ready',
    PLAN_FAILED: 'plan:failed',

    // Execution Phase
    PHASE_EXECUTING: 'phase:executing',
    COMMANDS_COMPILED: 'commands:compiled',
    EXECUTION_PROGRESS: 'execution:progress',
    EXECUTION_COMPLETE: 'execution:complete',
    EXECUTION_FAILED: 'execution:failed',

    // Validation Phase
    PHASE_VALIDATING: 'phase:validating',
    VALIDATION_PASSED: 'validation:passed',
    VALIDATION_FAILED: 'validation:failed',

    // Clarification
    CLARIFICATION_NEEDED: 'clarification:needed',
    CLARIFICATION_PROVIDED: 'clarification:provided',

    // Recovery & Approval
    RECOVERY_SUGGESTED: 'recovery:suggested',
    APPROVAL_REQUIRED: 'approval:required',
    APPROVAL_GRANTED: 'approval:granted',
    APPROVAL_DENIED: 'approval:denied',

    // AI Fallback
    AI_UNAVAILABLE: 'ai:unavailable',
    FALLBACK_USED: 'fallback:used',

    // ── Transcription & Analysis (NEW) ────────────────────────────────────────
    // Emitted by TranscriptionManager during background processing.
    // UI components subscribe to these to show progress indicators.
    TRANSCRIPTION_PROGRESS: 'transcription:progress',  // { status, progress 0-100, filename }
    TRANSCRIPTION_COMPLETE: 'transcription:complete',  // { filename, wordCount }
    TRANSCRIPTION_FAILED: 'transcription:failed',    // { filename, error }
    ANALYSIS_READY: 'analysis:ready',           // { filename, analysis, wordCount }

    // Phase 7: Autonomous Editing Mode
    AUTONOMOUS_PLAN_READY: 'autonomous:plan_ready',
    AUTONOMOUS_STEP_READY: 'autonomous:step_ready',
    AUTONOMOUS_STEPS_UPDATED: 'autonomous:steps_updated',
    AUTONOMOUS_STATUS: 'autonomous:status',
    AUTONOMOUS_SESSION_ENDED: 'autonomous:session_ended',

    // Phase 7: A/B Iteration System
    ITERATION_STARTED: 'iteration:started',
    ITERATION_COMPLETE: 'iteration:complete',
    VARIATION_LOADED: 'iteration:variation_loaded',

    // System
    SYSTEM_ERROR: 'system:error',
    DEBUG: 'debug',
};

// Subscription priority levels
export const PRIORITY = {
    HIGH: 0,  // Executed first (e.g., logging, metrics)
    NORMAL: 1,  // Default
    LOW: 2,  // Executed last (e.g., cleanup)
};

class EventBusClass {
    constructor() {
        // Map of eventType -> Set of { callback, priority, id }
        this.subscribers = new Map();

        // Wildcard subscribers (receive all events)
        this.wildcardSubscribers = new Set();

        // Event history for debugging (circular buffer)
        this.history = [];
        this.maxHistorySize = 100;

        // Subscription counter for unique IDs
        this.subscriptionIdCounter = 0;

        // Debug mode
        this.debugMode = false;
    }

    /**
     * Subscribe to an event type
     * @param {string} eventType - Event type from EVENT_TYPES
     * @param {function} callback - Handler function (payload) => void
     * @param {object} options - { priority: PRIORITY.NORMAL }
     * @returns {function} Unsubscribe function
     */
    on(eventType, callback, options = {}) {
        const { priority = PRIORITY.NORMAL } = options;
        const id = ++this.subscriptionIdCounter;

        if (eventType === '*') {
            const sub = { callback, priority, id };
            this.wildcardSubscribers.add(sub);
            return () => this.wildcardSubscribers.delete(sub);
        }

        if (!this.subscribers.has(eventType)) {
            this.subscribers.set(eventType, new Set());
        }

        const subscription = { callback, priority, id };
        this.subscribers.get(eventType).add(subscription);

        if (this.debugMode) {
            console.log(`[EventBus] Subscribed to "${eventType}" (id: ${id})`);
        }

        return () => {
            const subs = this.subscribers.get(eventType);
            if (subs) {
                subs.delete(subscription);
                if (this.debugMode) {
                    console.log(`[EventBus] Unsubscribed from "${eventType}" (id: ${id})`);
                }
            }
        };
    }

    /**
     * Subscribe to an event once (auto-unsubscribe after first call)
     */
    once(eventType, callback) {
        const unsubscribe = this.on(eventType, (payload) => {
            unsubscribe();
            callback(payload);
        });
        return unsubscribe;
    }

    /**
     * Emit an event to all subscribers
     */
    emit(eventType, payload = {}) {
        const timestamp = Date.now();
        const event = { type: eventType, payload, timestamp };

        this.recordEvent(event);

        if (this.debugMode) {
            console.log(`[EventBus] Emit: ${eventType}`, payload);
        }

        const allSubscribers = [];

        const typedSubs = this.subscribers.get(eventType);
        if (typedSubs) {
            typedSubs.forEach(sub => allSubscribers.push({ ...sub, eventType }));
        }

        this.wildcardSubscribers.forEach(sub => allSubscribers.push({ ...sub, eventType: '*' }));

        allSubscribers.sort((a, b) => a.priority - b.priority);

        for (const sub of allSubscribers) {
            try {
                sub.callback(payload, eventType);
            } catch (error) {
                console.error(`[EventBus] Error in subscriber for "${eventType}":`, error);
                if (eventType !== EVENT_TYPES.SYSTEM_ERROR) {
                    this.emit(EVENT_TYPES.SYSTEM_ERROR, {
                        source: 'EventBus',
                        originalEvent: eventType,
                        error: error.message,
                    });
                }
            }
        }
    }

    /**
     * Emit an event and wait for all async handlers to complete
     */
    async emitAsync(eventType, payload = {}) {
        const timestamp = Date.now();
        const event = { type: eventType, payload, timestamp };
        this.recordEvent(event);

        const allSubscribers = [];

        const typedSubs = this.subscribers.get(eventType);
        if (typedSubs) {
            typedSubs.forEach(sub => allSubscribers.push(sub));
        }

        this.wildcardSubscribers.forEach(sub => allSubscribers.push(sub));
        allSubscribers.sort((a, b) => a.priority - b.priority);

        const promises = allSubscribers.map(async (sub) => {
            try {
                await sub.callback(payload, eventType);
            } catch (error) {
                console.error(`[EventBus] Async error in subscriber for "${eventType}":`, error);
            }
        });

        await Promise.all(promises);
    }

    recordEvent(event) {
        this.history.push(event);
        if (this.history.length > this.maxHistorySize) {
            this.history.shift();
        }
    }

    getHistory(eventType = null) {
        if (eventType) {
            return this.history.filter(e => e.type === eventType);
        }
        return [...this.history];
    }

    clear() {
        this.subscribers.clear();
        this.wildcardSubscribers.clear();
        console.log('[EventBus] All subscriptions cleared');
    }

    clearHistory() {
        this.history = [];
    }

    setDebugMode(enabled) {
        this.debugMode = enabled;
        console.log(`[EventBus] Debug mode: ${enabled ? 'ON' : 'OFF'}`);
    }

    getSubscriberCount(eventType) {
        const subs = this.subscribers.get(eventType);
        return (subs ? subs.size : 0) + this.wildcardSubscribers.size;
    }
}

// Singleton instance
export const EventBus = new EventBusClass();

export default EventBus;