'use strict';

/**
 * server/audio-engine/timeline/TimelineEventBus.js
 *
 * Lightweight in-memory pub/sub bus for TimelineEvent notifications.
 * Used by the recommendation pipeline to react to edit actions.
 *
 * Events are session-scoped (keyed by userId:projectId) and ephemeral —
 * they are not persisted here. Persistence is handled by timeline_event_log
 * via the route handlers when relevant.
 *
 * Usage:
 *   eventBus.subscribe('HARD_CUT', handler);   // global
 *   eventBus.subscribe('HARD_CUT', handler, { userId, projectId }); // scoped
 *   eventBus.emit(event, { userId, projectId });
 *   eventBus.unsubscribe(handle);
 */

let _nextHandle = 1;

class TimelineEventBus {
    constructor() {
        // Map<eventType → Map<handle, {fn, scope}>>
        this._listeners = new Map();
    }

    /**
     * Subscribe to a TimelineEventType.
     *
     * @param {string}   eventType  — TimelineEventType value or '*' for all
     * @param {Function} fn         — called with (event, context)
     * @param {Object}   [scope]    — { userId?, projectId? } filter
     * @returns {number} handle (use to unsubscribe)
     */
    subscribe(eventType, fn, scope = {}) {
        if (!this._listeners.has(eventType)) {
            this._listeners.set(eventType, new Map());
        }
        const handle = _nextHandle++;
        this._listeners.get(eventType).set(handle, { fn, scope });
        return handle;
    }

    /**
     * Unsubscribe by handle.
     *
     * @param {number} handle
     */
    unsubscribe(handle) {
        for (const typeMap of this._listeners.values()) {
            if (typeMap.has(handle)) {
                typeMap.delete(handle);
                return;
            }
        }
    }

    /**
     * Emit a timeline event to all matching subscribers.
     * All handlers run synchronously (bus is local, lightweight).
     *
     * @param {Object} event     — TimelineEvent shape
     * @param {Object} [context] — { userId?, projectId? }
     */
    emit(event, context = {}) {
        const type = event?.eventType;
        if (!type) return;

        const targets = [
            ...(this._listeners.get(type) || new Map()).values(),
            ...(this._listeners.get('*')  || new Map()).values(),
        ];

        for (const { fn, scope } of targets) {
            // Scope filter: skip if scope specifies userId/projectId and it doesn't match
            if (scope.userId    && scope.userId    !== context.userId)    continue;
            if (scope.projectId && scope.projectId !== context.projectId) continue;

            try {
                fn(event, context);
            } catch (err) {
                console.warn('[TimelineEventBus] handler error:', err.message);
            }
        }
    }

    /**
     * Emit multiple events at once.
     *
     * @param {Object[]} events
     * @param {Object}   [context]
     */
    emitBatch(events, context = {}) {
        for (const event of (events || [])) {
            this.emit(event, context);
        }
    }

    /**
     * Remove all listeners for a specific scope (cleanup on session end).
     *
     * @param {Object} scope — { userId?, projectId? }
     */
    clearScope(scope = {}) {
        for (const typeMap of this._listeners.values()) {
            for (const [handle, entry] of typeMap.entries()) {
                const { scope: s } = entry;
                if (
                    (scope.userId    && s.userId    === scope.userId)    ||
                    (scope.projectId && s.projectId === scope.projectId)
                ) {
                    typeMap.delete(handle);
                }
            }
        }
    }

    /**
     * Return count of active listeners (for debugging).
     */
    listenerCount() {
        let total = 0;
        for (const typeMap of this._listeners.values()) {
            total += typeMap.size;
        }
        return total;
    }
}

// Singleton
const timelineEventBus = new TimelineEventBus();
module.exports = { TimelineEventBus, timelineEventBus };
