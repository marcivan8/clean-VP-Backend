/**
 * server/brain/Session.js
 *
 * Per-user-project editing session — tracks events, shown suggestions,
 * and commands run within a single browser session.
 *
 * Sessions live in-memory (Map). They are intentionally ephemeral;
 * persistent learning goes to Supabase via PatternLearner.
 */

'use strict';

/** @type {Map<string, EditingSession>} */
const _sessions = new Map();

let _eventCounter = 0;

/** Sessions older than this are silently expired on next access. */
const SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

/**
 * Background sweeper — purges sessions that have exceeded TTL.
 * Runs every 30 minutes; harmless if the server is idle.
 * Not exported — starts automatically when the module is loaded.
 */
setInterval(() => {
    const cutoff = Date.now() - SESSION_TTL_MS;
    let pruned = 0;
    for (const [key, session] of _sessions) {
        if (session.startedAt < cutoff) {
            _sessions.delete(key);
            pruned++;
        }
    }
    if (pruned > 0) {
        console.log(`[Session] TTL sweep: removed ${pruned} stale session(s)`);
    }
}, 30 * 60 * 1000).unref(); // .unref() so the interval never prevents process exit

class EditingSession {
    /**
     * @param {string} userId
     * @param {string} projectId
     */
    constructor(userId, projectId) {
        this.id = `session_${userId}_${projectId}_${Date.now()}`;
        this.userId = userId;
        this.projectId = projectId;
        this.createdAt = new Date().toISOString();
        /** Numeric timestamp for fast TTL comparison — never mutate. */
        this.startedAt = Date.now();
        this.processing = false;

        /** @type {import('./types').SessionEvent[]} */
        this.log = [];

        /** Last 10 events for quick context */
        this.recentContext = [];

        /** Types of suggestions already shown this session */
        this.shownSuggestions = new Set();

        /** Ordered list of commands executed this session */
        this.commandsRun = [];
    }

    /**
     * Append an event to the session log and update recentContext.
     * @param {{ type: string, summary: string, [key: string]: * }} event
     * @returns {import('./types').SessionEvent}
     */
    record(event) {
        _eventCounter++;
        const sessionEvent = {
            id: `evt_${_eventCounter}_${Date.now()}`,
            sessionId: this.id,
            timestamp: new Date().toISOString(),
            type: event.type || 'unknown',
            summary: event.summary || '',
            ...event,
        };

        this.log.push(sessionEvent);

        // Keep a rolling window of the last 10 events
        this.recentContext = this.log.slice(-10);

        return sessionEvent;
    }

    /**
     * Check whether a suggestion type has already been shown.
     * @param {string} type
     * @returns {boolean}
     */
    wasSuggestionShown(type) {
        return this.shownSuggestions.has(type);
    }

    /**
     * Mark a suggestion type as shown so it won't be re-surfaced.
     * @param {string} type
     */
    markSuggestionShown(type) {
        this.shownSuggestions.add(type);
    }

    /**
     * Check if a command appears in the last N items of commandsRun.
     * @param {string} command
     * @param {number} [withinLast=3]
     * @returns {boolean}
     */
    wasRecentlyRun(command, withinLast = 3) {
        const tail = this.commandsRun.slice(-withinLast);
        return tail.some(c => c === command || c.includes(command));
    }

    /**
     * Return a compact summary for inclusion in AI system prompts.
     * @returns {{ duration: number, eventsCount: number, commandsRun: string[], recentEvents: import('./types').SessionEvent[] }}
     */
    summarize() {
        const nowMs = Date.now();
        const createdMs = new Date(this.createdAt).getTime();
        const durationSeconds = Math.round((nowMs - createdMs) / 1000);

        return {
            duration: durationSeconds,
            eventsCount: this.log.length,
            commandsRun: [...this.commandsRun],
            recentEvents: this.recentContext.map(e => ({
                type: e.type,
                summary: e.summary,
                timestamp: e.timestamp,
            })),
        };
    }
}

// ─── Session Store Helpers ────────────────────────────────────────────────────

/**
 * Return the existing session for this user+project, or create a new one.
 * @param {string} userId
 * @param {string} projectId
 * @returns {EditingSession}
 */
function getOrCreateSession(userId, projectId) {
    const key = `${userId}:${projectId}`;

    // Expire stale sessions on access — prevents cross-day bleed
    const existing = _sessions.get(key);
    if (existing && Date.now() - existing.startedAt > SESSION_TTL_MS) {
        _sessions.delete(key);
        console.log(`[Session] Expired stale session for ${key}`);
    }

    if (!_sessions.has(key)) {
        _sessions.set(key, new EditingSession(userId, projectId));
    }
    return _sessions.get(key);
}

/**
 * Remove the session for this user+project (e.g. on project close).
 * @param {string} userId
 * @param {string} projectId
 */
function clearSession(userId, projectId) {
    const key = `${userId}:${projectId}`;
    _sessions.delete(key);
}

module.exports = { EditingSession, getOrCreateSession, clearSession };
