/**
 * routes/sessionRoutes.js — Anonymous session management
 *
 * Implements progressive authentication:
 *   POST /api/session/create  → create anonymous session, return { sessionId, expiresAt }
 *   POST /api/session/migrate → link sessionId to a verified user account
 *   GET  /api/session/:id     → return status (expiresAt, isMigrated, hoursLeft)
 *
 * Storage: in-memory Map (fast, zero migration needed).
 * For persistence across deploys, create this table in Supabase and swap the
 * three CRUD helpers below to use supabaseAdmin:
 *
 *   CREATE TABLE anonymous_sessions (
 *     id           TEXT PRIMARY KEY,
 *     created_at   TIMESTAMPTZ DEFAULT NOW(),
 *     expires_at   TIMESTAMPTZ NOT NULL,
 *     user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
 *     migrated_at  TIMESTAMPTZ
 *   );
 *   CREATE INDEX ON anonymous_sessions (expires_at);
 */

const express      = require('express');
const { randomUUID } = require('crypto');
const rateLimit    = require('express-rate-limit');

const router = express.Router();

// ── In-memory store ───────────────────────────────────────────────────────────
// { sessionId → { expiresAt: Date, userId: null|string, migratedAt: null|Date } }
const sessions = new Map();

const SESSION_TTL_MS = 48 * 3_600_000; // 48 hours

// Purge expired sessions once per hour
setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) {
        if (s.expiresAt.getTime() < now) sessions.delete(id);
    }
}, 3_600_000);

// ── Rate limits ───────────────────────────────────────────────────────────────
const createLimiter = rateLimit({
    windowMs: 60_000, max: 5,
    message: { error: 'Too many session creation requests.' }
});

// ── POST /api/session/create ──────────────────────────────────────────────────
router.post('/create', createLimiter, (req, res) => {
    const id        = randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    sessions.set(id, { expiresAt, userId: null, migratedAt: null });
    console.log(`[session] Created anonymous session ${id} (expires ${expiresAt.toISOString()})`);
    res.json({ sessionId: id, expiresAt: expiresAt.toISOString() });
});

// ── POST /api/session/migrate ─────────────────────────────────────────────────
// Links an anonymous session to an authenticated user account.
// Called from the client after Supabase sign-up/sign-in completes.
router.post('/migrate', (req, res) => {
    const { sessionId, userId } = req.body || {};
    if (!sessionId || !userId) {
        return res.status(400).json({ error: 'sessionId and userId are required.' });
    }

    const session = sessions.get(sessionId);
    if (!session) {
        // Session may have expired or already been cleaned up — that's OK.
        return res.status(404).json({ error: 'Session not found or already expired.' });
    }
    if (session.expiresAt.getTime() < Date.now()) {
        sessions.delete(sessionId);
        return res.status(410).json({ error: 'Session has expired.' });
    }

    session.userId     = userId;
    session.migratedAt = new Date();
    console.log(`[session] Migrated session ${sessionId} → user ${userId}`);
    res.json({ success: true });
});

// ── GET /api/session/:sessionId ───────────────────────────────────────────────
router.get('/:sessionId', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session) {
        return res.status(404).json({ error: 'Session not found.' });
    }

    const hoursLeft = Math.max(0, (session.expiresAt.getTime() - Date.now()) / 3_600_000);
    res.json({
        expiresAt:   session.expiresAt.toISOString(),
        isMigrated:  !!session.userId,
        isExpired:   session.expiresAt.getTime() < Date.now(),
        hoursLeft:   Math.round(hoursLeft),
    });
});

module.exports = router;
