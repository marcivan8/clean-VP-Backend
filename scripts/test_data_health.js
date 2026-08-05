/**
 * scripts/test_data_health.js
 *
 *   node scripts/test_data_health.js
 *
 * EXECUTES services/DataHealthProbe.js against a stubbed Supabase client.
 *
 * WHY THIS EXISTS
 * ---------------
 * The probe is the safety net for the failure class that has now produced FOUR
 * separate rules in CLAUDE.md (R12 empty seed tables, R21 missing migration,
 * R37 orphaned learning hook, R38 update-that-inserts-nothing). Its whole job is
 * to notice a silently empty table before a human has to find it by reading
 * code. A safety net that breaks quietly is worse than none at all — you'd
 * believe you had coverage you didn't — so its behaviour is pinned here.
 *
 * These are behavioural tests (stubbed client, real module), not static
 * analysis: the classification tiers and the empty-vs-unreadable distinction
 * are logic, and logic has to be run to be trusted.
 */

'use strict';

const path = require('path');

let failures = 0;
const check = (name, cond, detail) => {
    if (cond) {
        console.log(`  ✓ ${name}`);
    } else {
        failures++;
        console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
    }
};

const DB_PATH    = require.resolve(path.resolve(__dirname, '../config/database.js'));
const PROBE_PATH = require.resolve(path.resolve(__dirname, '../services/DataHealthProbe.js'));

/**
 * Load a fresh copy of the probe with a stubbed supabaseAdmin.
 * `counts` maps table -> row count; a table absent from the map is treated as
 * unreadable (the "migration never applied" case).
 */
function loadProbeWith(counts, { throwOnAccess = false } = {}) {
    delete require.cache[PROBE_PATH];

    require.cache[DB_PATH] = {
        id: DB_PATH, filename: DB_PATH, loaded: true,
        exports: {
            supabaseAdmin: {
                from(table) {
                    if (throwOnAccess) throw new Error('connection refused');
                    return {
                        select: async () => (
                            table in counts
                                ? { count: counts[table], error: null }
                                : { count: null, error: { message: `relation "${table}" does not exist` } }
                        ),
                    };
                },
            },
        },
    };

    return require(PROBE_PATH);
}

// Every table in DataHealthProbe's DEPENDENCIES registry must appear here.
// The "a check is emitted for every declared dependency" assertion below is
// deliberately keyed off this object's size, so adding a dependency without
// adding it here fails loudly rather than leaving it silently untested.
const HEALTHY = {
    assets: 109, sound_effects: 91, luts: 10, presets: 8,
    media_assets: 42, user_editing_profiles: 7, editing_sessions: 96,
    project_intelligence: 12,
};

(async () => {
    // ── 1. Everything populated ─────────────────────────────────────────────
    console.log('\n── a fully populated database reports ok ──');
    {
        const { checkDataHealth } = loadProbeWith(HEALTHY);
        const r = await checkDataHealth();

        check('status is ok', r.status === 'ok');
        check('no problems', r.problems.length === 0);
        check('no warnings', r.warnings.length === 0);
        check('every table is marked ok', r.checks.every(c => c.ok));
        check('a check is emitted for every declared dependency',
            r.checks.length === Object.keys(HEALTHY).length,
            `Expected ${Object.keys(HEALTHY).length} checks, got ${r.checks.length} — `
            + 'a dependency added to the registry but not counted here means untested coverage.');
        check('row counts are reported', r.checks.find(c => c.table === 'assets')?.rows === 109);
    }

    // ── 2. The R12 scenario: seeder never run ───────────────────────────────
    console.log('\n── empty SEEDED tables are hard problems ──');
    {
        const { checkDataHealth } = loadProbeWith({
            ...HEALTHY, assets: 0, sound_effects: 0, luts: 0, presets: 0,
        });
        const r = await checkDataHealth();

        check('status is degraded', r.status === 'degraded',
            'Shipped reference data being absent is never acceptable.');
        check('one problem per empty seeded table', r.problems.length === 4);
        check('the problem names the fix', r.problems.every(p => p.includes('seeder.js')),
            'A diagnostic that does not say what to do is only half useful.');
        check('accumulating tables are untouched', r.warnings.length === 0);
    }

    // ── 3. Empty accumulating table = warning, not failure ──────────────────
    // This is the real production state for media_assets, and the reason the
    // tiering exists: on a brand-new deployment it is CORRECT for this to be
    // empty, so it must not read as a hard failure and must not block anything.
    console.log('\n── an empty ACCUMULATING table warns without failing ──');
    {
        const { checkDataHealth } = loadProbeWith({ ...HEALTHY, media_assets: 0 });
        const r = await checkDataHealth();

        check('status stays ok', r.status === 'ok',
            'A fresh deployment legitimately has no usage data yet.');
        check('no hard problem raised', r.problems.length === 0);
        check('exactly one warning', r.warnings.length === 1);
        check('the warning states the ambiguity',
            /fresh deployment/.test(r.warnings[0]) && /broken write path/.test(r.warnings[0]),
            'It could be either; saying so is what makes the warning actionable rather than alarming.');
        check('the table is still flagged not-ok in checks',
            r.checks.find(c => c.table === 'media_assets')?.ok === false);
    }

    // ── 4. Unreadable != empty ──────────────────────────────────────────────
    console.log('\n── a missing/unreadable table is distinguished from an empty one ──');
    {
        const counts = { ...HEALTHY };
        delete counts.media_assets;               // simulates "relation does not exist"
        const { checkDataHealth } = loadProbeWith(counts);
        const r = await checkDataHealth();

        check('status is degraded', r.status === 'degraded',
            'A table we cannot read at all is a harder failure than an empty one.');
        check('reported as unreadable, not empty',
            r.problems.some(p => p.includes('cannot be read')),
            'Conflating the two sends you to the wrong fix (seed data vs. run the migration).');
        check('rows is null rather than 0',
            r.checks.find(c => c.table === 'media_assets')?.rows === null,
            'Reporting 0 would imply the table exists and is empty.');
    }

    // ── 5. The probe must never break boot ──────────────────────────────────
    console.log('\n── a dead database client cannot crash startup ──');
    {
        const { checkDataHealth, logDataHealth } = loadProbeWith({}, { throwOnAccess: true });

        let threw = false;
        let report = null;
        try { report = await checkDataHealth(); } catch { threw = true; }

        check('checkDataHealth does not throw', !threw,
            'index.js calls this during app.listen — a throw here would take down the server.');
        check('it still returns a usable report', !!report && Array.isArray(report.problems));

        let logThrew = false;
        try { await logDataHealth(); } catch { logThrew = true; }
        check('logDataHealth does not throw', !logThrew);
    }

    // ── 6. The registry is coherent ─────────────────────────────────────────
    console.log('\n── the dependency registry is well-formed ──');
    {
        const { DEPENDENCIES } = loadProbeWith(HEALTHY);

        check('every entry declares a table', DEPENDENCIES.every(d => typeof d.table === 'string' && d.table));
        check('every entry declares a valid tier',
            DEPENDENCIES.every(d => d.expect === 'seeded' || d.expect === 'accumulating'),
            'An unknown tier would silently fall through to the warning branch.');
        check('every entry explains the affected feature',
            DEPENDENCIES.every(d => typeof d.feature === 'string' && d.feature.length > 5));
        check('every entry offers a fix hint',
            DEPENDENCIES.every(d => typeof d.fix === 'string' && d.fix.length > 5));
        check('no duplicate tables',
            new Set(DEPENDENCIES.map(d => d.table)).size === DEPENDENCIES.length);
    }

    console.log(
        failures === 0
            ? '\nALL DATA HEALTH TESTS PASSED\n'
            : `\n${failures} DATA HEALTH TEST(S) FAILED\n`
    );
    process.exit(failures === 0 ? 0 : 1);
})();
