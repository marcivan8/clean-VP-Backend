/**
 * routes/sessionRoutes.js — Anonymous session management
 *
 * Implements progressive authentication:
 *   POST /api/session/create  → create anonymous session, return { sessionId, expiresAt }
 *   POST /api/session/migrate → link sessionId to a verified user account
 *   GET  /api/session/:id     → return status (expiresAt, isMigrated, hoursLeft)
 *
 * Storage: Supabase `anonymous_sessions` table is PRIMARY (survives Railway
 * restarts/redeploys); an in-memory Map is the fallback, used only when that
 * table isn't reachable (e.g. local dev against a project that hasn't run the
 * migration yet). The table is defined in
 * `supabase/migrations/20240008_anonymous_sessions.sql` — apply it once per
 * Supabase project. Previously this schema lived only as a comment here (never
 * actually migrated anywhere), which meant the Supabase-primary code below had
 * never run in production and every anonymous session was silently lost on
 * every restart. Don't re-embed the CREATE TABLE here — the migration file is
 * the single source of truth; a second copy is exactly the kind of drift this
 * codebase's other migrations (see 20240004_media_assets.sql's header) warn
 * against.
 */

const express        = require('express');
const { randomUUID } = require('crypto');
const rateLimit      = require('express-rate-limit');

const router = express.Router();

// ── Persistence layer ─────────────────────────────────────────────────────────
// Primary: Supabase `anonymous_sessions` table (survives Railway restarts) —
// see supabase/migrations/20240008_anonymous_sessions.sql for the schema and
// apply it once per Supabase project.
// Fallback: in-memory Map, used only when that table isn't reachable yet
// (dbAvailable() below probes it once per process and caches the result).

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

// Purge expired in-memory sessions once per hour
const purgeInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, s] of memSessions) {
        if (s.expiresAt.getTime() < now) memSessions.delete(id);
    }
}, 3_600_000);
purgeInterval.unref();

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
