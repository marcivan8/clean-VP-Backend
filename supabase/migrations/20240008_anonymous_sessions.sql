-- ============================================================
-- Migration: 20240008_anonymous_sessions.sql
-- Anonymous session persistence (tech-debt TD2)
--
-- WHY THIS EXISTS
-- routes/sessionRoutes.js already prefers Supabase over its in-memory Map
-- whenever the `anonymous_sessions` table is reachable — dbAvailable() probes
-- it once per process and caches the result, and every read/write path
-- (sessionGet/sessionCreate/sessionMigrate) branches on that flag. But the
-- table itself was never migrated anywhere in this repo, so on a real
-- deployment dbAvailable()'s probe query fails (relation does not exist),
-- caches to `false`, and the Supabase-primary code has never actually run.
-- Every anonymous session has been living only in the Node process's memory:
-- a Railway restart or redeploy silently loses every in-progress anonymous
-- session — and, worse, any session that was mid-way through migrating to a
-- real account — with no error surfaced to the user. This migration is the
-- missing half of a fix whose application code was otherwise already written.
--
-- Columns and index match the schema sessionRoutes.js's own header comment has
-- documented (informally) since the Supabase-primary code was added.
-- ============================================================

CREATE TABLE IF NOT EXISTS anonymous_sessions (
    id           text        PRIMARY KEY,          -- randomUUID() from sessionRoutes.js
    created_at   timestamptz DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    user_id      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
    migrated_at  timestamptz
);

-- sessionGet()/sessionMigrate() look up by `id` (the primary key, already
-- indexed). The hourly in-memory purge sweep in sessionRoutes.js has no
-- Supabase equivalent yet — this index is what makes a future "DELETE FROM
-- anonymous_sessions WHERE expires_at < now()" cheap if one is added later.
CREATE INDEX IF NOT EXISTS anon_sessions_expires_idx ON anonymous_sessions (expires_at);

-- RLS: unlike every user-owned table elsewhere in this schema, this table has
-- no authenticated owner at row-creation time — a session exists BEFORE the
-- user has an account, which is the entire point of progressive auth. There is
-- therefore no meaningful `user_id = auth.uid()` policy to write (user_id is
-- null until sessionMigrate() runs). The backend writes exclusively via
-- supabaseAdmin (service_role), which bypasses RLS regardless of policies —
-- same pattern as 20240002_asset_engine.sql's "Backend (service_role) bypasses
-- RLS — no additional policies needed" tables. Enabling RLS with zero policies
-- denies every anon/authenticated client outright, which is the correct
-- default here: nothing outside the backend should read or write this table
-- directly.
ALTER TABLE anonymous_sessions ENABLE ROW LEVEL SECURITY;
