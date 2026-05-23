/**
 * useSessionStore.js
 * Tracks the anonymous session lifecycle.
 *
 * Flow:
 *   1. First visit  → createSession() → stores vp_session in localStorage
 *   2. Editing      → session ID attached to every API call via authFetch
 *   3. Sign-up      → migrateSession(userId) links files → clears local token
 *   4. Return visit → if vp_session exists and is still valid, resume silently
 */

import { create } from 'zustand';

const LS_SESSION   = 'vp_session';
const LS_EXPIRES   = 'vp_session_expires';
const LS_MIGRATED  = 'vp_user_migrated';

const useSessionStore = create((set, get) => ({
    sessionId:   localStorage.getItem(LS_SESSION) || null,
    expiresAt:   localStorage.getItem(LS_EXPIRES)
                     ? new Date(localStorage.getItem(LS_EXPIRES))
                     : null,
    // false once the user has signed up and the session was migrated
    isAnonymous: !localStorage.getItem(LS_MIGRATED),

    // ── createSession ──────────────────────────────────────────────────────
    createSession: async () => {
        try {
            const res  = await fetch('/api/session/create', { method: 'POST' });
            const data = await res.json();
            localStorage.setItem(LS_SESSION, data.sessionId);
            localStorage.setItem(LS_EXPIRES, data.expiresAt);
            set({ sessionId: data.sessionId, expiresAt: new Date(data.expiresAt), isAnonymous: true });
            console.log('[session] Anonymous session created:', data.sessionId);
            return data.sessionId;
        } catch (err) {
            // Offline / server error — generate a local-only ID so the rest of
            // the app can keep working; it just won't be tracked server-side.
            const fallback = `local-${crypto.randomUUID()}`;
            localStorage.setItem(LS_SESSION, fallback);
            set({ sessionId: fallback, isAnonymous: true });
            console.warn('[session] Server unreachable, using local-only session:', fallback);
            return fallback;
        }
    },

    // ── getOrCreate ────────────────────────────────────────────────────────
    // Checks the stored session ID against the server and creates a new one
    // if it was wiped (e.g. after a Railway redeploy cleared the in-memory Map
    // before Supabase persistence was configured).
    getOrCreate: async () => {
        const { sessionId, createSession } = get();
        if (!sessionId) return createSession();

        // Local-only fallback IDs don't need server validation
        if (sessionId.startsWith('local-')) return sessionId;

        try {
            const res = await fetch(`/api/session/${sessionId}`);
            if (res.status === 404) {
                // Server no longer knows about this session — create a fresh one
                console.warn('[session] Stored session not found on server, creating new one');
                localStorage.removeItem(LS_SESSION);
                localStorage.removeItem(LS_EXPIRES);
                set({ sessionId: null });
                return createSession();
            }
            const data = await res.json();
            if (data.isExpired) {
                localStorage.removeItem(LS_SESSION);
                localStorage.removeItem(LS_EXPIRES);
                set({ sessionId: null });
                return createSession();
            }
        } catch (_) {
            // Network error — keep using the stored ID, server may come back
        }
        return sessionId;
    },

    // ── migrateSession ─────────────────────────────────────────────────────
    // Called immediately after Supabase sign-up/sign-in succeeds.
    migrateSession: async (userId) => {
        const { sessionId } = get();
        if (!sessionId || sessionId.startsWith('local-')) {
            // Nothing to migrate — mark as authenticated anyway
            localStorage.setItem(LS_MIGRATED, '1');
            set({ isAnonymous: false });
            return;
        }
        try {
            await fetch('/api/session/migrate', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ sessionId, userId }),
            });
            console.log('[session] Migrated session', sessionId, '→ user', userId);
        } catch (err) {
            console.warn('[session] Migration request failed (non-fatal):', err.message);
        }
        localStorage.setItem(LS_MIGRATED, '1');
        localStorage.removeItem(LS_SESSION);
        localStorage.removeItem(LS_EXPIRES);
        set({ isAnonymous: false });
    },

    // ── hoursLeft ──────────────────────────────────────────────────────────
    hoursLeft: () => {
        const { expiresAt } = get();
        if (!expiresAt) return null;
        return Math.max(0, (expiresAt.getTime() - Date.now()) / 3_600_000);
    },

    clearSession: () => {
        localStorage.removeItem(LS_SESSION);
        localStorage.removeItem(LS_EXPIRES);
        localStorage.removeItem(LS_MIGRATED);
        set({ sessionId: null, expiresAt: null, isAnonymous: true });
    },
}));

export default useSessionStore;
