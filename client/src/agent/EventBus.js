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

    // System
    SYSTEM_ERROR: 'system:error',
    DEBUG: 'debug'
};

// Subscription priority levels
export const PRIORITY = {
    HIGH: 0,    // Executed first (e.g., logging, metrics)
    NORMAL: 1,  // Default
    LOW: 2      // Executed last (e.g., cleanup)
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
            // Wildcard subscription
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

        // Return unsubscribe function
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
     * @param {string} eventType - Event type
     * @param {function} callback - Handler function
     * @returns {function} Unsubscribe function
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
     * @param {string} eventType - Event type
     * @param {object} payload - Event data
     */
    emit(eventType, payload = {}) {
        const timestamp = Date.now();
        const event = { type: eventType, payload, timestamp };

        // Record in history
        this.recordEvent(event);

        if (this.debugMode) {
            console.log(`[EventBus] Emit: ${eventType}`, payload);
        }

        // Collect all subscribers (typed + wildcard)
        const allSubscribers = [];

        // Typed subscribers
        const typedSubs = this.subscribers.get(eventType);
        if (typedSubs) {
            typedSubs.forEach(sub => allSubscribers.push({ ...sub, eventType }));
        }

        // Wildcard subscribers
        this.wildcardSubscribers.forEach(sub => allSubscribers.push({ ...sub, eventType: '*' }));

        // Sort by priority (lower = higher priority)
        allSubscribers.sort((a, b) => a.priority - b.priority);

        // Dispatch to all subscribers
        for (const sub of allSubscribers) {
            try {
                sub.callback(payload, eventType);
            } catch (error) {
                console.error(`[EventBus] Error in subscriber for "${eventType}":`, error);
                // Emit system error but prevent infinite loop
                if (eventType !== EVENT_TYPES.SYSTEM_ERROR) {
                    this.emit(EVENT_TYPES.SYSTEM_ERROR, {
                        source: 'EventBus',
                        originalEvent: eventType,
                        error: error.message
                    });
                }
            }
        }
    }

    /**
     * Emit an event and wait for all async handlers to complete
     * @param {string} eventType - Event type
     * @param {object} payload - Event data
     * @returns {Promise<void>}
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

    /**
     * Record event in history (circular buffer)
     */
    recordEvent(event) {
        this.history.push(event);
        if (this.history.length > this.maxHistorySize) {
            this.history.shift();
        }
    }

    /**
     * Get event history
     * @param {string} eventType - Optional filter by type
     * @returns {Array} Event history
     */
    getHistory(eventType = null) {
        if (eventType) {
            return this.history.filter(e => e.type === eventType);
        }
        return [...this.history];
    }

    /**
     * Clear all subscriptions
     */
    clear() {
        this.subscribers.clear();
        this.wildcardSubscribers.clear();
        console.log('[EventBus] All subscriptions cleared');
    }

    /**
     * Clear event history
     */
    clearHistory() {
        this.history = [];
    }

    /**
     * Enable/disable debug mode
     * @param {boolean} enabled
     */
    setDebugMode(enabled) {
        this.debugMode = enabled;
        console.log(`[EventBus] Debug mode: ${enabled ? 'ON' : 'OFF'}`);
    }

    /**
     * Get subscriber count for an event type
     * @param {string} eventType
     * @returns {number}
     */
    getSubscriberCount(eventType) {
        const subs = this.subscribers.get(eventType);
        return (subs ? subs.size : 0) + this.wildcardSubscribers.size;
    }
}

// Singleton instance
export const EventBus = new EventBusClass();

export default EventBus;
