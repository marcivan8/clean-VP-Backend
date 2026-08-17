#!/usr/bin/env node
/**
 * Regression: TD2 — anonymous sessions were lost on every Railway restart
 * because routes/sessionRoutes.js's Supabase-primary code depended on an
 * `anonymous_sessions` table that was never actually migrated anywhere in
 * this repo (it only existed as a comment). dbAvailable()'s probe query would
 * fail on a real deployment, cache to `false`, and silently fall back to the
 * in-memory Map forever — so the "primary: Supabase" code path had never run.
 *
 * This checks: the migration now exists with the right shape, RLS is enabled
 * with the documented no-policy-needed rationale (service_role only), and
 * sessionRoutes.js's header no longer duplicates the schema inline (a second
 * copy of a schema is exactly the drift hazard this codebase's other
 * migrations warn against — see 20240004_media_assets.sql).
 *
 * Run: node scripts/test_anonymous_sessions_persistence.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const check = (n, c, d) => {
    if (c) { passed++; console.log(`  ✓ ${n}`); }
    else { failed++; console.log(`  ✗ ${n}`); if (d) console.log(`      ${d}`); }
};
const section = (t) => console.log(`\n${t}`);

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => {
    try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
    catch (err) { console.log(`  ✗ could not read ${rel} — ${err.code || err.message}`); failed++; return ''; }
};

const MIGRATION_PATH = 'supabase/migrations/20240008_anonymous_sessions.sql';

section('1 · The migration exists and defines the table sessionRoutes.js already expects');
{
    check('migration file exists', fs.existsSync(path.join(ROOT, MIGRATION_PATH)));
    const sql = read(MIGRATION_PATH);
    check('creates anonymous_sessions', /CREATE TABLE IF NOT EXISTS anonymous_sessions/.test(sql));
    check('id is the primary key (text — matches randomUUID() as a string)',
        /id\s+text\s+PRIMARY KEY/.test(sql));
    check('expires_at is NOT NULL (sessionGet/sessionMigrate both dereference it unconditionally)',
        /expires_at\s+timestamptz\s+NOT NULL/.test(sql));
    check('user_id references auth.users and clears (not cascades) on delete',
        /user_id\s+uuid\s+REFERENCES auth\.users\(id\) ON DELETE SET NULL/.test(sql));
    check('migrated_at column exists (sessionMigrate() sets it)',
        /migrated_at\s+timestamptz/.test(sql));
    check('an index on expires_at exists (for the eventual Supabase-side purge)',
        /CREATE INDEX IF NOT EXISTS anon_sessions_expires_idx ON anonymous_sessions \(expires_at\)/.test(sql));
}

section('2 · RLS: enabled, no policies — service_role only, matching this table\'s actual access pattern');
{
    const sql = read(MIGRATION_PATH);
    check('RLS is enabled on the table',
        /ALTER TABLE anonymous_sessions ENABLE ROW LEVEL SECURITY/.test(sql));
    check('no CREATE POLICY statements — the table has no authenticated owner at row-creation time',
        !/CREATE POLICY/i.test(sql));
}

section('3 · sessionRoutes.js — schema is documented ONCE (the migration), not duplicated inline');
{
    const routes = read('routes/sessionRoutes.js');
    check('header no longer embeds a second CREATE TABLE (the drift hazard this fix removes)',
        !/CREATE TABLE anonymous_sessions/.test(routes));
    check('header points at the real migration file',
        /supabase\/migrations\/20240008_anonymous_sessions\.sql/.test(routes));
    check('storage is now documented as Supabase-primary, not "in-memory (zero migration needed)"',
        /Supabase `anonymous_sessions` table is PRIMARY/.test(routes)
        && !/in-memory Map \(fast, zero migration needed\)/.test(routes));
}

section('4 · sessionRoutes.js — the Supabase-primary application code itself is untouched and intact');
{
    const routes = read('routes/sessionRoutes.js');
    check('dbAvailable() probes the real table and caches the result per process',
        /async function dbAvailable\(\)/.test(routes) && /_useSupabase = !error;/.test(routes));
    check('sessionGet() reads from Supabase first when available',
        /async function sessionGet\(id\) \{\s*\n\s*if \(await dbAvailable\(\)\)/.test(routes));
    check('sessionCreate() writes through to Supabase when available',
        /async function sessionCreate\(id, expiresAt\) \{[\s\S]{0,200}if \(await dbAvailable\(\)\)/.test(routes));
    check('sessionMigrate() updates Supabase when available (this is the write a lost session would silently drop)',
        /async function sessionMigrate\(id, userId\) \{[\s\S]{0,200}if \(await dbAvailable\(\)\)/.test(routes));
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
