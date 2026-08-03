/**
 * services/DataHealthProbe.js
 *
 * Reports whether the Supabase tables Vibed's features depend on actually
 * contain data.
 *
 * WHY THIS EXISTS
 * ---------------
 * Four separate rules in CLAUDE.md describe the same failure class:
 *   R12 — the SFX/LUT/preset tables are empty until someone runs seeder.js by
 *         hand; asset search returned "No results" on prod and looked like a
 *         broken search engine.
 *   R21 — media_assets had no migration, so the analysis job wrote nowhere.
 *   R37 — the profile learning hook was orphaned by an unrelated (correct) fix;
 *         profiles silently stopped accumulating.
 *   R38 — nothing ever INSERTed into media_assets, so every `.update()` matched
 *         zero rows. PostgREST reports NO error for that, so the job logged
 *         "✓ analyzed" while writing nothing, for months.
 *
 * The common thread: **a write that silently affects nothing is
 * indistinguishable from a working feature.** Every one of these was found by
 * a human reading code, not by anything the system reported. This probe makes
 * the cheapest version of that check automatic — it counts rows and says which
 * dependency tables are empty.
 *
 * WHAT THIS IS NOT: it does not prove writes work, only that data EXISTS. A
 * table with rows can still have a broken write path. It's a smoke alarm, not
 * a correctness proof — deliberately cheap enough to run on every boot.
 *
 * Safety: never throws, never blocks boot, uses head-only count queries so no
 * row data is transferred.
 */

'use strict';

const { supabaseAdmin } = require('../config/database');

/**
 * Tables whose emptiness means something, and what it means.
 *
 * `expect` is deliberately tiered so this doesn't cry wolf on a fresh install:
 *   'seeded'      — shipped/reference data. Empty is ALWAYS wrong; someone
 *                   skipped a seeding step and a whole feature is dark.
 *   'accumulating'— grows from real usage. Empty is only SUSPICIOUS: it's
 *                   expected on a brand-new deployment, and a genuine bug on
 *                   one that's been serving traffic. Reported as a warning with
 *                   that ambiguity stated, never as a hard failure.
 */
const DEPENDENCIES = [
    {
        table:   'assets',
        expect:  'seeded',
        feature: 'Asset panel search (SFX / LUTs / presets)',
        fix:     'node server/audio-engine/library/seeder.js  (see CLAUDE.md R12)',
    },
    {
        table:   'sound_effects',
        expect:  'seeded',
        feature: 'SFX tab search results',
        fix:     'node server/audio-engine/library/seeder.js  (see CLAUDE.md R12/R13)',
    },
    {
        table:   'luts',
        expect:  'seeded',
        feature: 'Color tab / LUT recommendations',
        fix:     'node server/audio-engine/library/seeder.js  (see CLAUDE.md R12)',
    },
    {
        table:   'presets',
        expect:  'seeded',
        feature: 'Presets tab',
        fix:     'node server/audio-engine/library/seeder.js  (see CLAUDE.md R12)',
    },
    {
        table:   'media_assets',
        expect:  'accumulating',
        feature: 'Footage-aware Brain advice (scene type, framing, subject count)',
        fix:     'Upload a clip and check the asset-analysis worker logs. This table '
               + 'sat at 0 rows for months because nothing INSERTed into it — see CLAUDE.md R38.',
    },
    {
        table:   'user_editing_profiles',
        expect:  'accumulating',
        feature: 'Creator Memory / "Your Style" page',
        fix:     'Run any AI edit command; WorkflowController should POST /api/brain/observe-command '
               + '(see CLAUDE.md R37).',
    },
    {
        table:   'editing_sessions',
        expect:  'accumulating',
        feature: 'Editing history ledger the profile learns from',
        fix:     'Written by PatternLearner.persistAsync and /api/brain/observe-command (CLAUDE.md R37).',
    },
];

/**
 * Count rows in one table without transferring any.
 * Resolves to a number, or null when the count could not be obtained.
 */
async function countRows(table) {
    try {
        const { count, error } = await supabaseAdmin
            .from(table)
            .select('*', { count: 'exact', head: true });

        if (error) {
            return { count: null, error: error.message };
        }
        return { count: count ?? 0, error: null };
    } catch (err) {
        return { count: null, error: err.message };
    }
}

/**
 * Probe every declared dependency table.
 *
 * @returns {Promise<{
 *   status: 'ok'|'degraded'|'unknown',
 *   checkedAt: string,
 *   checks: Array<{table:string, rows:number|null, expect:string, ok:boolean, feature:string, error:string|null}>,
 *   problems: string[],
 *   warnings: string[],
 * }>}
 */
async function checkDataHealth() {
    const checkedAt = new Date().toISOString();

    let results;
    try {
        results = await Promise.all(
            DEPENDENCIES.map(async (dep) => {
                const { count, error } = await countRows(dep.table);
                return { dep, count, error };
            })
        );
    } catch (err) {
        // Promise.all shouldn't reject (countRows never throws) — belt and braces.
        return {
            status:    'unknown',
            checkedAt,
            checks:    [],
            problems:  [`Data health probe failed entirely: ${err.message}`],
            warnings:  [],
        };
    }

    const checks   = [];
    const problems = [];
    const warnings = [];

    for (const { dep, count, error } of results) {
        // A table we can't read at all (missing table, RLS, credentials) is a
        // different failure from an empty one — don't conflate them.
        if (error) {
            checks.push({
                table: dep.table, rows: null, expect: dep.expect,
                ok: false, feature: dep.feature, error,
            });
            problems.push(`${dep.table}: cannot be read (${error}) — ${dep.feature} is broken. ${dep.fix}`);
            continue;
        }

        const isEmpty = count === 0;
        const ok = !isEmpty;

        checks.push({
            table: dep.table, rows: count, expect: dep.expect,
            ok, feature: dep.feature, error: null,
        });

        if (!isEmpty) continue;

        if (dep.expect === 'seeded') {
            problems.push(`${dep.table} is EMPTY — ${dep.feature} cannot work. ${dep.fix}`);
        } else {
            warnings.push(
                `${dep.table} is empty — expected on a fresh deployment, but a broken write path `
                + `on one that's been in use. ${dep.feature}. ${dep.fix}`
            );
        }
    }

    const status = problems.length > 0 ? 'degraded' : 'ok';
    return { status, checkedAt, checks, problems, warnings };
}

/**
 * Run the probe and log the outcome. Fire-and-forget: intended to be called
 * once at boot, and must never delay or crash startup.
 *
 * Deliberately quiet when everything is fine — one line — so the noisy case
 * stands out in Railway logs.
 */
async function logDataHealth() {
    try {
        const { status, checks, problems, warnings } = await checkDataHealth();

        if (status === 'ok' && warnings.length === 0) {
            console.log(`[DataHealth] ✅ all ${checks.length} dependency tables have data`);
            return;
        }

        for (const p of problems) console.error(`[DataHealth] ❌ ${p}`);
        for (const w of warnings) console.warn(`[DataHealth] ⚠️  ${w}`);

        const summary = checks
            .map(c => `${c.table}=${c.rows === null ? 'ERR' : c.rows}`)
            .join(' ');
        console.log(`[DataHealth] row counts: ${summary}`);
    } catch (err) {
        // Never let diagnostics break boot.
        console.error('[DataHealth] probe failed (non-critical):', err.message);
    }
}

module.exports = { checkDataHealth, logDataHealth, DEPENDENCIES };
