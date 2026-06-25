/**
 * TimelineHistory.js
 * Manages undo/redo history with snapshots and versioning support.
 * Implements command-based history with optional snapshot compression.
 */

import { deepClone, deepFreeze } from './ImmutableUtils.js';
import { TIMELINE_EVENTS, EVENT_SOURCES, timelineEvents } from './TimelineEvents.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEFAULT_OPTIONS = {
    maxHistorySize: 100,           // Maximum undo steps
    maxVersions: 20,               // Maximum named versions
    compressionThreshold: 10,      // Compress after N sequential same-type actions
    persistenceKey: 'vp_timeline_history',
    autoPersist: true,
    debounceMs: 500                // Debounce rapid changes
};

// ============================================================================
// HISTORY ENTRY
// ============================================================================

/**
 * Create a history entry
 */
function createHistoryEntry(state, action, metadata = {}) {
    return {
        id: `entry-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        timestamp: Date.now(),
        state: deepClone(state),  // Full state snapshot
        action: action,           // Action that was performed
        metadata: {
            source: metadata.source || EVENT_SOURCES.USER,
            label: metadata.label || action?.type || 'Unknown',
            compressed: false,
            ...metadata
        }
    };
}

// ============================================================================
// TIMELINE VERSION
// ============================================================================

/**
 * Create a named version (checkpoint)
 */
function createVersion(state, label, parentId = null) {
    return {
        id: `version-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        label: label || `v${new Date().toISOString().slice(0, 10)}`,
        parentId,
        createdAt: Date.now(),
        state: deepClone(state),
        metadata: {
            duration: state.metadata?.duration || 0,
            clipCount: Object.keys(state.entities?.clips || {}).length,
            layerCount: Object.keys(state.entities?.layers || {}).length
        }
    };
}

// ============================================================================
// TIMELINE HISTORY CLASS
// ============================================================================

export class TimelineHistory {
    constructor(options = {}) {
        this.options = { ...DEFAULT_OPTIONS, ...options };

        // History stacks
        this.past = [];           // Undo stack
        this.future = [];         // Redo stack

        // Named versions
        this.versions = new Map();

        // Current state reference
        this.currentState = null;

        // Debounce tracking
        this.lastAction = null;
        this.lastActionTime = 0;
        this.pendingEntry = null;

        // Transaction support
        this.transactionState = null;
        this.transactionActions = [];
    }

    // ========================================================================
    // INITIALIZATION
    // ========================================================================

    /**
     * Initialize history with current state
     */
    initialize(state) {
        this.currentState = deepClone(state);
        this.past = [];
        this.future = [];

        // Create initial version
        this.createVersion('Initial', null);

        if (this.options.autoPersist) {
            this.loadFromStorage();
        }
    }

    // ========================================================================
    // RECORDING
    // ========================================================================

    /**
     * Record a state change to history
     * @param {object} newState - New state after action
     * @param {object} action - Action that was performed
     * @param {object} metadata - Optional metadata
     */
    record(newState, action = null, metadata = {}) {
        // Don't record during transactions
        if (this.transactionState !== null) {
            this.transactionActions.push({ state: newState, action, metadata });
            return;
        }

        // Debounce rapid changes of same type
        if (this._shouldDebounce(action)) {
            this.pendingEntry = { state: newState, action, metadata };
            return;
        }

        this._commitEntry(newState, action, metadata);
    }

    /**
     * Check if action should be debounced
     */
    _shouldDebounce(action) {
        if (!action || !this.lastAction) return false;

        const now = Date.now();
        const timeDiff = now - this.lastActionTime;

        // Same action type within debounce window
        return action.type === this.lastAction.type &&
            timeDiff < this.options.debounceMs;
    }

    /**
     * Commit a history entry
     */
    _commitEntry(newState, action, metadata) {
        // Flush any pending entry first
        if (this.pendingEntry && this.pendingEntry.state !== newState) {
            const pending = this.pendingEntry;
            this.pendingEntry = null;
            this._commitEntry(pending.state, pending.action, pending.metadata);
        }
        this.pendingEntry = null;

        // Create entry for current state (before the change)
        if (this.currentState) {
            const entry = createHistoryEntry(this.currentState, action, metadata);
            this.past.push(entry);

            // Trim history if too long
            if (this.past.length > this.options.maxHistorySize) {
                this.past = this.past.slice(-this.options.maxHistorySize);
            }
        }

        // Update current state
        this.currentState = deepClone(newState);

        // Clear redo stack (new branch)
        this.future = [];

        // Track for debouncing
        this.lastAction = action;
        this.lastActionTime = Date.now();

        // Emit event
        timelineEvents.emit(TIMELINE_EVENTS.HISTORY_PUSH, {
            action,
            historyLength: this.past.length,
            source: metadata.source || EVENT_SOURCES.INTERNAL
        });

        // Auto-persist
        if (this.options.autoPersist) {
            this._debouncedPersist();
        }
    }

    // ========================================================================
    // UNDO / REDO
    // ========================================================================

    /**
     * Check if undo is possible
     */
    canUndo() {
        return this.past.length > 0;
    }

    /**
     * Check if redo is possible
     */
    canRedo() {
        return this.future.length > 0;
    }

    /**
     * Undo the last action
     * @returns {object|null} Previous state or null if nothing to undo
     */
    undo() {
        if (!this.canUndo()) {
            console.warn('[TimelineHistory] Nothing to undo');
            return null;
        }

        // Get the previous entry
        const previousEntry = this.past.pop();

        // Save current state to future (for redo)
        const currentEntry = createHistoryEntry(
            this.currentState,
            { type: 'REDO_POINT' },
            { source: EVENT_SOURCES.UNDO }
        );
        this.future.unshift(currentEntry);

        // Restore previous state
        this.currentState = deepClone(previousEntry.state);

        // Emit event
        timelineEvents.emit(TIMELINE_EVENTS.HISTORY_UNDO, {
            restoredAction: previousEntry.action,
            historyLength: this.past.length,
            futureLength: this.future.length,
            source: EVENT_SOURCES.UNDO
        });

        return this.currentState;
    }

    /**
     * Redo the last undone action
     * @returns {object|null} Next state or null if nothing to redo
     */
    redo() {
        if (!this.canRedo()) {
            console.warn('[TimelineHistory] Nothing to redo');
            return null;
        }

        // Get the next entry
        const nextEntry = this.future.shift();

        // Save current state to past
        const currentEntry = createHistoryEntry(
            this.currentState,
            { type: 'UNDO_POINT' },
            { source: EVENT_SOURCES.REDO }
        );
        this.past.push(currentEntry);

        // Restore next state
        this.currentState = deepClone(nextEntry.state);

        // Emit event
        timelineEvents.emit(TIMELINE_EVENTS.HISTORY_REDO, {
            restoredAction: nextEntry.action,
            historyLength: this.past.length,
            futureLength: this.future.length,
            source: EVENT_SOURCES.REDO
        });

        return this.currentState;
    }

    /**
     * Clear all history
     */
    clear() {
        this.past = [];
        this.future = [];
        this.pendingEntry = null;

        timelineEvents.emit(TIMELINE_EVENTS.HISTORY_CLEAR, {
            source: EVENT_SOURCES.INTERNAL
        });
    }

    // ========================================================================
    // TRANSACTIONS
    // ========================================================================

    /**
     * Begin a transaction (batch multiple changes as single undo step)
     */
    beginTransaction() {
        if (this.transactionState !== null) {
            console.warn('[TimelineHistory] Transaction already in progress');
            return;
        }

        this.transactionState = deepClone(this.currentState);
        this.transactionActions = [];

        timelineEvents.emit(TIMELINE_EVENTS.TRANSACTION_BEGIN, {
            source: EVENT_SOURCES.INTERNAL
        });
    }

    /**
     * Commit the current transaction
     * @param {string} label - Label for the combined action
     */
    commitTransaction(label = 'Batch Action') {
        if (this.transactionState === null) {
            console.warn('[TimelineHistory] No transaction to commit');
            return null;
        }

        // Get final state from last action in transaction
        const finalAction = this.transactionActions[this.transactionActions.length - 1];
        if (!finalAction) {
            this.rollbackTransaction();
            return null;
        }

        const finalState = finalAction.state;

        // Record the entire transaction as a single entry
        this._commitEntry(finalState, { type: label }, {
            source: EVENT_SOURCES.USER,
            transactionSize: this.transactionActions.length
        });

        // Clear transaction state
        this.transactionState = null;
        this.transactionActions = [];

        timelineEvents.emit(TIMELINE_EVENTS.TRANSACTION_COMMIT, {
            label,
            source: EVENT_SOURCES.INTERNAL
        });

        return this.currentState;
    }

    /**
     * Rollback the current transaction
     */
    rollbackTransaction() {
        if (this.transactionState === null) {
            console.warn('[TimelineHistory] No transaction to rollback');
            return null;
        }

        const originalState = this.transactionState;

        // Clear transaction state
        this.transactionState = null;
        this.transactionActions = [];

        timelineEvents.emit(TIMELINE_EVENTS.TRANSACTION_ROLLBACK, {
            source: EVENT_SOURCES.INTERNAL
        });

        return originalState;
    }

    // ========================================================================
    // VERSIONING
    // ========================================================================

    /**
     * Create a named version (checkpoint)
     * @param {string} label - Version label
     * @param {string} parentId - Parent version ID (for branching)
     * @returns {object} Created version
     */
    createVersion(label, parentId = null) {
        const version = createVersion(this.currentState, label, parentId);

        this.versions.set(version.id, version);

        // Trim versions if too many
        if (this.versions.size > this.options.maxVersions) {
            const oldestKey = this.versions.keys().next().value;
            this.versions.delete(oldestKey);
        }

        timelineEvents.emit(TIMELINE_EVENTS.VERSION_CREATED, {
            version: { ...version, state: undefined }, // Don't include full state in event
            source: EVENT_SOURCES.USER
        });

        return version;
    }

    /**
     * Get all versions
     * @returns {Array} Array of versions (without full state)
     */
    listVersions() {
        return Array.from(this.versions.values()).map(v => ({
            id: v.id,
            label: v.label,
            parentId: v.parentId,
            createdAt: v.createdAt,
            metadata: v.metadata
        }));
    }

    /**
     * Load a specific version
     * @param {string} versionId - Version ID to load
     * @returns {object|null} Loaded state or null
     */
    loadVersion(versionId) {
        const version = this.versions.get(versionId);

        if (!version) {
            console.warn(`[TimelineHistory] Version not found: ${versionId}`);
            return null;
        }

        // Record current state before loading version
        this.record(this.currentState, { type: 'BEFORE_VERSION_LOAD' }, {
            label: `Before loading ${version.label}`
        });

        // Load version state
        this.currentState = deepClone(version.state);

        timelineEvents.emit(TIMELINE_EVENTS.VERSION_LOADED, {
            version: { ...version, state: undefined },
            source: EVENT_SOURCES.LOAD
        });

        return this.currentState;
    }

    /**
     * Delete a version
     * @param {string} versionId - Version ID to delete
     */
    deleteVersion(versionId) {
        if (this.versions.has(versionId)) {
            this.versions.delete(versionId);

            timelineEvents.emit(TIMELINE_EVENTS.VERSION_DELETED, {
                versionId,
                source: EVENT_SOURCES.USER
            });
        }
    }

    // ========================================================================
    // PERSISTENCE
    // ========================================================================

    _persistTimeout = null;

    /**
     * Debounced persist to avoid excessive writes
     */
    _debouncedPersist() {
        if (this._persistTimeout) {
            clearTimeout(this._persistTimeout);
        }
        this._persistTimeout = setTimeout(() => {
            this.persist();
        }, 1000);
    }

    /**
     * Persist history to storage
     *
     * `captions`, `transcripts`, and `waveformData` are excluded from every
     * persisted snapshot.  They are the biggest contributors to localStorage
     * size (easily 100 KB+ each × 20 history entries = quota overflow), and
     * they are stored separately in the main timeline store / re-fetched on
     * demand — they don't need to ride along with undo snapshots.
     */
    persist() {
        // Strip large, reconstructable fields from a state snapshot.
        const _slim = (state) => {
            if (!state) return state;
            // eslint-disable-next-line no-unused-vars
            const { captions, transcripts, waveformData, ...slim } = state;
            return slim;
        };

        const slimPast = this.past.slice(-20).map(e => ({ ...e, state: _slim(e.state) }));
        const slimVersions = Array.from(this.versions.entries())
            .map(([k, v]) => [k, { ...v, state: _slim(v.state) }]);
        const slimCurrent = _slim(this.currentState);

        const tryWrite = (past, versions) => {
            const data = { past, versions, currentState: slimCurrent, timestamp: Date.now() };
            localStorage.setItem(this.options.persistenceKey, JSON.stringify(data));
        };

        try {
            tryWrite(slimPast, slimVersions);
            console.log('[TimelineHistory] Persisted to storage');
        } catch (err) {
            if (err.name !== 'QuotaExceededError') {
                console.error('[TimelineHistory] Failed to persist:', err);
                return;
            }
            // Quota exceeded — progressively reduce what we store
            try {
                tryWrite(slimPast.slice(-5), []);
                console.warn('[TimelineHistory] Quota tight — persisted with reduced history (5 entries, no versions)');
            } catch (_) {
                try {
                    tryWrite([], []);
                    console.warn('[TimelineHistory] Quota exceeded — persisted current state only (no history)');
                } catch (last) {
                    console.error('[TimelineHistory] Cannot persist — localStorage full:', last.message);
                }
            }
        }
    }

    /**
     * Load history from storage
     */
    loadFromStorage() {
        try {
            const stored = localStorage.getItem(this.options.persistenceKey);
            if (!stored) return false;

            const data = JSON.parse(stored);

            // Only restore if recent (within 7 days)
            const maxAge = 7 * 24 * 60 * 60 * 1000;
            if (Date.now() - data.timestamp > maxAge) {
                console.log('[TimelineHistory] Stored data too old, ignoring');
                return false;
            }

            this.past = data.past || [];
            this.versions = new Map(data.versions || []);

            // Strip out dead blob URLs from restored state since they don't persist across reloads
            if (data.currentState && data.currentState.assets) {
                data.currentState.assets = data.currentState.assets.map(asset => {
                    if (asset.url && asset.url.startsWith('blob:')) {
                        // Keep the asset, but clear the blob URL to prevent ERR_FILE_NOT_FOUND.
                        // The app will fall back to proxyUrl or show a missing media state.
                        return { ...asset, url: null };
                    }
                    return asset;
                });
            }

            // Don't override current state if already set
            if (!this.currentState && data.currentState) {
                this.currentState = data.currentState;
            }

            console.log('[TimelineHistory] Loaded from storage');
            return true;
        } catch (err) {
            console.error('[TimelineHistory] Failed to load from storage:', err);
            return false;
        }
    }

    /**
     * Clear persisted history
     */
    clearStorage() {
        localStorage.removeItem(this.options.persistenceKey);
    }

    // ========================================================================
    // GETTERS
    // ========================================================================

    /**
     * Get current history length
     */
    getHistoryLength() {
        return {
            past: this.past.length,
            future: this.future.length,
            versions: this.versions.size
        };
    }

    /**
     * Get history entries (for debugging)
     */
    getHistory() {
        return {
            past: this.past.map(e => ({
                id: e.id,
                timestamp: e.timestamp,
                action: e.action,
                metadata: e.metadata
            })),
            future: this.future.map(e => ({
                id: e.id,
                timestamp: e.timestamp,
                action: e.action,
                metadata: e.metadata
            }))
        };
    }

    /**
     * Get current state
     */
    getCurrentState() {
        return this.currentState;
    }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const timelineHistory = new TimelineHistory();

export default TimelineHistory;
