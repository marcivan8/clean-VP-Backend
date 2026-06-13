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

const express        = require('express');
const { randomUUID } = require('crypto');
const rateLimit      = require('express-rate-limit');

const router = express.Router();

// ── Persistence layer ─────────────────────────────────────────────────────────
// Primary: Supabase `anonymous_sessions` table (survives Railway restarts).
// Fallback: in-memory Map (used when table does not exist yet).
//
// To enable Supabase persistence, run this migration once in your project:
//   CREATE TABLE IF NOT EXISTS anonymous_sessions (
//     id           TEXT PRIMARY KEY,
//     created_at   TIMESTAMPTZ DEFAULT NOW(),
//     expires_at   TIMESTAMPTZ NOT NULL,
//     user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
//     migrated_at  TIMESTAMPTZ
//   );
//   CREATE INDEX IF NOT EXISTS anon_sessions_expires ON anonymous_sessions (expires_at);

let supabaseAdmin = null;
try {
    supabaseAdmin = require('../config/database').supabaseAdmin;
} catch (_) { /* config not available in some envs */ }

// In-memory fallback (also acts as a write-through cache for Supabase reads)
const memSessions = new Map();
const SESSION_TTL_MS = 48 * 3_600_000; // 48 hours
let _useSupabase = null; // null = untested, true/false = cached result

async function dbAvailable() {
    if (_useSupabase !== null) return _useSupabase;
    if (!supabaseAdmin) { _useSupabase = false; return false; }
    try {
        const { error } = await supabaseAdmin.from('anonymous_sessions').select('id').limit(1);
        _useSupabase = !error;
        if (!_useSupabase) console.warn('[session] anonymous_sessions table not found — using in-memory fallback. See sessionRoutes.js for the CREATE TABLE migration.');
    } catch (_) { _useSupabase = false; }
    return _useSupabase;
}

async function sessionGet(id) {
    if (await dbAvailable()) {
        const { data } = await supabaseAdmin.from('anonymous_sessions').select('*').eq('id', id).maybeSingle();
        if (data) return { expiresAt: new Date(data.expires_at), userId: data.user_id, migratedAt: data.migrated_at ? new Date(data.migrated_at) : null };
        return null;
    }
    return memSessions.get(id) || null;
}

async function sessionCreate(id, expiresAt) {
    memSessions.set(id, { expiresAt, userId: null, migratedAt: null });
    if (await dbAvailable()) {
        await supabaseAdmin.from('anonymous_sessions').insert({ id, expires_at: expiresAt.toISOString() });
    }
}

async function sessionMigrate(id, userId) {
    const s = memSessions.get(id);
    if (s) { s.userId = userId; s.migratedAt = new Date(); }
    if (await dbAvailable()) {
        await supabaseAdmin.from('anonymous_sessions').update({ user_id: userId, migrated_at: new Date().toISOString() }).eq('id', id);
    }
}

// Purge expired in-memory sessions once per hour.
// .unref() lets Jest (and any other test runner) exit without waiting for this timer.
setInterval(() => {
    const now = Date.now();
    for (const [id, s] of memSessions) {
        if (s.expiresAt.getTime() < now) memSessions.delete(id);
    }
}, 3_600_000).unref();

// ── Rate limits ───────────────────────────────────────────────────────────────
const createLimiter = rateLimit({ windowMs: 60_000, max: 5, message: { error: 'Too many session creation requests.' } });

// ── POST /api/session/create ──────────────────────────────────────────────────
router.post('/create', createLimiter, async (req, res) => {
    const id        = randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await sessionCreate(id, expiresAt);
    console.log(`[session] Created anonymous session ${id}`);
    res.json({ sessionId: id, expiresAt: expiresAt.toISOString() });
});

// ── POST /api/session/migrate ─────────────────────────────────────────────────
router.post('/migrate', async (req, res) => {
    const { sessionId, userId } = req.body || {};
    if (!sessionId || !userId) return res.status(400).json({ error: 'sessionId and userId are required.' });

    const session = await sessionGet(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found or already expired.' });
    if (session.expiresAt.getTime() < Date.now()) return res.status(410).json({ error: 'Session has expired.' });

    await sessionMigrate(sessionId, userId);
    console.log(`[session] Migrated session ${sessionId} → user ${userId}`);
    res.json({ success: true });
});

// ── GET /api/session/:sessionId ───────────────────────────────────────────────
router.get('/:sessionId', async (req, res) => {
    const session = await sessionGet(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found.' });

    const hoursLeft = Math.max(0, (session.expiresAt.getTime() - Date.now()) / 3_600_000);
    res.json({
        expiresAt:  session.expiresAt.toISOString(),
        isMigrated: !!session.userId,
        isExpired:  session.expiresAt.getTime() < Date.now(),
        hoursLeft:  Math.round(hoursLeft),
    });
});

module.exports = router;
