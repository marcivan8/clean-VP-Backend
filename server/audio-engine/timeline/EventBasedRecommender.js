'use strict';

/**
 * server/audio-engine/timeline/EventBasedRecommender.js
 *
 * Listens on TimelineEventBus and generates contextual SFX recommendations
 * when timeline events occur (cuts, zooms, text reveals, etc.).
 *
 * Recommendations are non-blocking (fire-and-forget) and are pushed to a
 * callback registered per session. They never affect the timeline directly.
 *
 * Setup:
 *   const rec = new EventBasedRecommender();
 *   const sessionHandle = rec.createSession(userId, projectId, onRecommend);
 *   // ... edit events fire ...
 *   rec.destroySession(sessionHandle);
 *
 * The onRecommend callback receives:
 *   { event: TimelineEvent, suggestions: SearchResult[] }
 */

const { timelineEventBus }   = require('./TimelineEventBus.js');
const { TaxonomyService }    = require('../search/TaxonomyService.js');
const { TimelineEventType }  = require('../types.js');

// Events that trigger SFX recommendations
const RECOMMENDABLE_EVENTS = new Set([
    TimelineEventType.HARD_CUT,
    TimelineEventType.SOFT_CUT,
    TimelineEventType.ZOOM_IN,
    TimelineEventType.ZOOM_OUT,
    TimelineEventType.TEXT_APPEARS,
    TimelineEventType.CAPTION_APPEARS,
    TimelineEventType.REVEAL,
    TimelineEventType.EMPHASIS_MOMENT,
    TimelineEventType.CHAPTER_START,
    TimelineEventType.PUNCHLINE_DETECTED,
    TimelineEventType.EMOTIONAL_BEAT,
    TimelineEventType.AUDIO_PEAK,
]);

// Debounce identical event types within 500ms to avoid flooding
const DEBOUNCE_MS = 500;

class EventBasedRecommender {
    constructor() {
        this.taxonomy = new TaxonomyService();
        // Map<sessionHandle, {userId, projectId, onRecommend, lastFired, busHandle}>
        this._sessions = new Map();
    }

    /**
     * Create a recommendation session.
     * Returns a handle used to destroy the session later.
     *
     * @param {string}   userId
     * @param {string}   projectId
     * @param {Function} onRecommend — async callback(result)
     * @returns {number} sessionHandle
     */
    createSession(userId, projectId, onRecommend) {
        const sessionHandle = Date.now() + Math.random();

        // Track last fire time per event type to debounce
        const lastFired = new Map();

        const busHandle = timelineEventBus.subscribe(
            '*',
            (event, context) => {
                if (context.userId !== userId || context.projectId !== projectId) return;
                if (!RECOMMENDABLE_EVENTS.has(event.eventType)) return;

                // Debounce
                const now  = Date.now();
                const last = lastFired.get(event.eventType) || 0;
                if (now - last < DEBOUNCE_MS) return;
                lastFired.set(event.eventType, now);

                // Fire-and-forget — never blocks
                this._generateRecommendation(event, onRecommend).catch(err => {
                    console.warn('[EventBasedRecommender] non-fatal:', err.message);
                });
            },
            { userId, projectId }
        );

        this._sessions.set(sessionHandle, { userId, projectId, onRecommend, lastFired, busHandle });
        return sessionHandle;
    }

    /**
     * Destroy a session and clean up its bus subscription.
     *
     * @param {number} sessionHandle
     */
    destroySession(sessionHandle) {
        const session = this._sessions.get(sessionHandle);
        if (!session) return;
        timelineEventBus.unsubscribe(session.busHandle);
        this._sessions.delete(sessionHandle);
    }

    /**
     * Manually trigger recommendations for an event (without going through the bus).
     * Useful for server-side route handlers.
     *
     * @param {Object}   event
     * @param {Function} onRecommend
     */
    async recommendForEvent(event, onRecommend) {
        if (!event?.eventType) return;
        if (!RECOMMENDABLE_EVENTS.has(event.eventType)) return;
        await this._generateRecommendation(event, onRecommend);
    }

    // ── Private ───────────────────────────────────────────────────────────────

    /**
     * Fetch SFX for the event type and invoke the callback.
     * @private
     */
    async _generateRecommendation(event, onRecommend) {
        try {
            const suggestions = await this.taxonomy.getSFXByEvent(event.eventType, 5);
            if (!suggestions?.length) return;
            onRecommend({ event, suggestions });
        } catch (err) {
            console.error('[EventBasedRecommender._generateRecommendation]', err.message);
        }
    }
}

// Singleton
const eventBasedRecommender = new EventBasedRecommender();
module.exports = { EventBasedRecommender, eventBasedRecommender };
