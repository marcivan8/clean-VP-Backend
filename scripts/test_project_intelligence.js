#!/usr/bin/env node
/**
 * Regression: Project Intelligence — the persisted project map (CLAUDE.md R44).
 *
 * Almost everything here EXECUTES the real ProjectIntelligence class against a
 * stubbed OpenAI client and a stubbed Supabase client. The properties being
 * pinned are the ones invisible in the source text and expensive to get wrong:
 *
 *   1. Re-derivation is fingerprint-gated — an unchanged bin must NOT cost a
 *      model call, and a materially changed one must.
 *   2. A bin with no completed analysis produces NO map rather than a guessed
 *      one (R30: never a confident answer over analysis that never ran).
 *   3. A hallucinated asset id or an out-of-vocabulary role is dropped/clamped
 *      at normalisation, never persisted.
 *   4. A failed derivation is RECORDED as failed, not swallowed (R38/R40:
 *      empty and broken must be distinguishable).
 *   5. Persistence uses upsert, not update — an `.update()` matching zero rows
 *      is silent in PostgREST and is how media_assets stayed empty for months.
 *   6. binReady is derived from server-fetched rows, not a client field nothing
 *      writes.
 *   7. The Brain's prompt renders the map and survives a null/failed one.
 *
 * Run: node scripts/test_project_intelligence.js
 */

'use strict';

const path = require('path');
const fs   = require('fs');

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
    if (condition) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.log(`  ✗ ${name}`); if (detail) console.log(`      ${detail}`); }
}
function section(t) { console.log(`\n${t}`); }

// ── Stubs ────────────────────────────────────────────────────────────────────
const DB_PATH = require.resolve(path.resolve(__dirname, '../config/database.js'));
const PI_PATH = require.resolve(path.resolve(__dirname, '../server/brain/ProjectIntelligence.js'));

/** Records every table operation so the test can assert on WHAT was written. */
function makeSupabaseStub({ existingRow = null, failUpsert = false } = {}) {
    const calls = { upserts: [], updates: [], selects: [] };
    const stub = {
        from(table) {
            return {
                select() { return this; },
                eq()    { return this; },
                async maybeSingle() {
                    calls.selects.push(table);
                    return { data: existingRow, error: null };
                },
                // Present so the test can detect a regression to `.update()`,
                // which matches zero rows silently when none exists.
                update(row) {
                    calls.updates.push({ table, row });
                    return { eq: async () => ({ data: null, error: null }) };
                },
                upsert(row, opts) {
                    calls.upserts.push({ table, row, opts });
                    return {
                        select: () => ({
                            maybeSingle: async () => failUpsert
                                ? { data: null, error: { message: 'boom' } }
                                : { data: row, error: null },
                        }),
                    };
                },
            };
        },
    };
    return { stub, calls };
}

function loadProjectIntelligence(supabaseStub) {
    require.cache[DB_PATH] = {
        id: DB_PATH, filename: DB_PATH, loaded: true,
        exports: { supabaseAdmin: supabaseStub },
    };
    delete require.cache[PI_PATH];
    return require(PI_PATH);
}

/** OpenAI stub that counts calls and returns a canned JSON body. */
function makeOpenAIStub(body, { throwOnCall = false, malformed = false } = {}) {
    const state = { calls: 0, lastPrompt: null };
    return {
        state,
        client: {
            chat: {
                completions: {
                    create: async ({ messages }) => {
                        state.calls++;
                        state.lastPrompt = messages[0].content;
                        if (throwOnCall) throw new Error('model unavailable');
                        return {
                            choices: [{
                                message: { content: malformed ? 'not json at all' : JSON.stringify(body) },
                            }],
                        };
                    },
                },
            },
        },
    };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
const ASSET_A = {
    id: 'asset-A', name: 'interview.mp4', analysis_status: 'done',
    scene_type: 'talking_head', camera_angle: 'medium', subject_count: 1,
    has_main_speaker: true, content_description: 'Founder explaining the product.',
    transcript_text: 'So the reason we built this was...',
};
const ASSET_B = {
    id: 'asset-B', name: 'broll.mp4', analysis_status: 'done',
    scene_type: 'b_roll', is_broll: true, has_spoken_word: false,
    content_description: 'Close-ups of the product on a desk.',
};
const ASSET_PENDING = { id: 'asset-C', name: 'new.mp4', analysis_status: 'processing' };

const GOOD_RESPONSE = {
    project_type: 'product_demo',
    through_line: 'A founder explains why the product exists.',
    target_audience: 'prospective customers',
    tone: 'conversational',
    asset_roles: [
        { assetId: 'asset-A', role: 'a_roll', serves: null },
        { assetId: 'asset-B', role: 'b_roll', serves: 'asset-A' },
    ],
    coverage_gaps: [
        { gap: 'No outro or call to action', severity: 'high', suggestion: 'Record a short closing line' },
    ],
};

async function main() {

    // ── 1 · Fingerprint ──────────────────────────────────────────────────────
    section('1 · Fingerprint captures exactly the derivation inputs');
    {
        const { ProjectIntelligence } = loadProjectIntelligence(makeSupabaseStub().stub);
        const pi = new ProjectIntelligence({ openai: makeOpenAIStub(GOOD_RESPONSE).client });

        const base = pi.computeFingerprint([ASSET_A, ASSET_B], 2);

        check('order-independent',
            base === pi.computeFingerprint([ASSET_B, ASSET_A], 2));
        check('clip count changes it',
            base !== pi.computeFingerprint([ASSET_A, ASSET_B], 3));
        check('removing an asset changes it',
            base !== pi.computeFingerprint([ASSET_A], 2));
        // The subtle one: same assets, but one has finished analysing since.
        // That is materially different input — a map built before it completed
        // must not survive.
        check('an asset\'s analysis_status changes it',
            base !== pi.computeFingerprint(
                [ASSET_A, { ...ASSET_B, analysis_status: 'processing' }], 2),
            'a map derived from a half-analysed bin would outlive the rest completing');
    }

    // ── 2 · Unchanged fingerprint ⇒ no work ──────────────────────────────────
    section('2 · An unchanged bin costs no model call and no write');
    {
        const probe = new (loadProjectIntelligence(makeSupabaseStub().stub).ProjectIntelligence)();
        const fp = probe.computeFingerprint([ASSET_A, ASSET_B], 2);

        const { stub, calls } = makeSupabaseStub({
            existingRow: {
                project_id: 'p1', user_id: 'u1', fingerprint: fp, status: 'ok',
                project_type: 'product_demo', asset_roles: [], coverage_gaps: [],
            },
        });
        const { ProjectIntelligence } = loadProjectIntelligence(stub);
        const ai = makeOpenAIStub(GOOD_RESPONSE);
        const pi = new ProjectIntelligence({ openai: ai.client });

        const map = await pi.ensureMap({
            projectId: 'p1', userId: 'u1', assets: [ASSET_A, ASSET_B], clipCount: 2,
        });

        check('the stored map is returned', !!map && map.fingerprint === fp);
        check('no model call was made', ai.state.calls === 0, `${ai.state.calls} call(s)`);
        check('nothing was written', calls.upserts.length === 0, `${calls.upserts.length} upsert(s)`);
    }

    section('2b · A changed bin DOES re-derive');
    {
        const { stub, calls } = makeSupabaseStub({
            existingRow: {
                project_id: 'p1', user_id: 'u1', fingerprint: 'stale-hash', status: 'ok',
                project_type: 'vlog', asset_roles: [], coverage_gaps: [],
            },
        });
        const { ProjectIntelligence } = loadProjectIntelligence(stub);
        const ai = makeOpenAIStub(GOOD_RESPONSE);
        const pi = new ProjectIntelligence({ openai: ai.client });

        const map = await pi.ensureMap({
            projectId: 'p1', userId: 'u1', assets: [ASSET_A, ASSET_B], clipCount: 2,
        });

        check('a model call was made', ai.state.calls === 1, `${ai.state.calls} call(s)`);
        check('the new map was persisted', calls.upserts.length === 1);
        check('the persisted map replaces the stale type',
            map && map.project_type === 'product_demo', map && map.project_type);
        check('the new fingerprint was stored',
            calls.upserts[0].row.fingerprint !== 'stale-hash');
    }

    // ── 3 · No analysed footage ⇒ no guessed map ─────────────────────────────
    section('3 · An unanalysed bin produces no map (R30)');
    {
        const { stub, calls } = makeSupabaseStub();
        const { ProjectIntelligence } = loadProjectIntelligence(stub);
        const ai = makeOpenAIStub(GOOD_RESPONSE);
        const pi = new ProjectIntelligence({ openai: ai.client });

        const map = await pi.ensureMap({
            projectId: 'p1', userId: 'u1', assets: [ASSET_PENDING], clipCount: 1,
        });

        check('no map is returned', map === null, JSON.stringify(map));
        check('no model call was made', ai.state.calls === 0,
            'it would be describing footage nobody has analysed');
        check('nothing was written', calls.upserts.length === 0);
    }

    // ── 4 · Normalisation contains a wrong answer ────────────────────────────
    section('4 · Normalisation clamps and drops rather than trusting the model');
    {
        const { ProjectIntelligence } = loadProjectIntelligence(makeSupabaseStub().stub);
        const pi = new ProjectIntelligence({ openai: makeOpenAIStub({}).client });

        const norm = pi.normalizeMap({
            project_type: 'documentary_epic',              // not in the vocabulary
            through_line: '  A founder explains.  ',
            target_audience: '',                            // empty ⇒ null
            asset_roles: [
                { assetId: 'asset-A', role: 'a_roll', serves: null },
                { assetId: 'asset-GHOST', role: 'a_roll' },  // hallucinated id
                { assetId: 'asset-B', role: 'protagonist' }, // invalid role
            ],
            coverage_gaps: [
                { gap: 'No outro', severity: 'catastrophic' }, // invalid severity
                { gap: '', severity: 'high' },                 // empty gap
            ],
        }, [ASSET_A, ASSET_B]);

        check('unknown project_type falls back to "unknown"',
            norm.project_type === 'unknown', norm.project_type);
        check('through_line is trimmed', norm.through_line === 'A founder explains.');
        check('empty audience becomes null', norm.target_audience === null);
        check('a hallucinated asset id is dropped',
            !norm.asset_roles.some(r => r.assetId === 'asset-GHOST'),
            JSON.stringify(norm.asset_roles.map(r => r.assetId)));
        check('two real assets survive', norm.asset_roles.length === 2, `${norm.asset_roles.length}`);
        check('an invalid role is clamped to "supporting"',
            norm.asset_roles.find(r => r.assetId === 'asset-B').role === 'supporting');
        check('asset name is attached from the bin',
            norm.asset_roles.find(r => r.assetId === 'asset-A').name === 'interview.mp4');
        check('an invalid severity is clamped to "medium"',
            norm.coverage_gaps[0].severity === 'medium');
        check('a gap with no text is dropped',
            norm.coverage_gaps.length === 1, `${norm.coverage_gaps.length}`);
    }

    section('4b · Missing fields degrade to safe empties, never undefined');
    {
        const { ProjectIntelligence } = loadProjectIntelligence(makeSupabaseStub().stub);
        const pi = new ProjectIntelligence({ openai: makeOpenAIStub({}).client });

        for (const [label, input] of [['null', null], ['empty object', {}]]) {
            const n = pi.normalizeMap(input, []);
            check(`${label} response yields an array of roles`, Array.isArray(n.asset_roles));
            check(`${label} response yields an array of gaps`, Array.isArray(n.coverage_gaps));
            check(`${label} response yields project_type "unknown"`, n.project_type === 'unknown');
        }
    }

    // ── 5 · Failure is recorded ──────────────────────────────────────────────
    section('5 · A failed derivation is recorded, not swallowed (R38/R40)');
    {
        const { stub, calls } = makeSupabaseStub();
        const { ProjectIntelligence } = loadProjectIntelligence(stub);
        const ai = makeOpenAIStub(null, { throwOnCall: true });
        const pi = new ProjectIntelligence({ openai: ai.client });

        const map = await pi.ensureMap({
            projectId: 'p1', userId: 'u1', assets: [ASSET_A, ASSET_B], clipCount: 2,
        });

        check('ensureMap does not throw', true);
        check('null is returned when there was no previous map', map === null);
        check('a row was still written', calls.upserts.length === 1,
            'a persistently failing map must be visible, not absent');
        check('it is written with status "failed"',
            calls.upserts[0].row.status === 'failed', calls.upserts[0].row.status);
    }

    section('5b · Malformed model JSON is a failure, not a half-map');
    {
        const { stub, calls } = makeSupabaseStub();
        const { ProjectIntelligence } = loadProjectIntelligence(stub);
        const pi = new ProjectIntelligence({ openai: makeOpenAIStub({}, { malformed: true }).client });

        await pi.ensureMap({ projectId: 'p1', userId: 'u1', assets: [ASSET_A], clipCount: 1 });
        check('status "failed" is recorded for malformed JSON',
            calls.upserts.length === 1 && calls.upserts[0].row.status === 'failed');
    }

    // ── 6 · Persistence shape ────────────────────────────────────────────────
    section('6 · Persistence uses upsert, never a silent update (R38)');
    {
        const { stub, calls } = makeSupabaseStub();
        const { ProjectIntelligence } = loadProjectIntelligence(stub);
        const pi = new ProjectIntelligence({ openai: makeOpenAIStub(GOOD_RESPONSE).client });

        await pi.ensureMap({ projectId: 'p1', userId: 'u1', assets: [ASSET_A, ASSET_B], clipCount: 2 });

        check('exactly one upsert', calls.upserts.length === 1);
        check('no .update() was used', calls.updates.length === 0,
            'an update matching zero rows reports no error and writes nothing');
        const { row, opts, table } = calls.upserts[0];
        check('written to project_intelligence', table === 'project_intelligence', table);
        check('conflict target is project_id', opts && opts.onConflict === 'project_id');
        check('user_id is stored', row.user_id === 'u1');
        check('asset_count reflects analysed assets only', row.asset_count === 2, `${row.asset_count}`);
    }

    section('6b · Only analysed assets feed the derivation');
    {
        const { stub, calls } = makeSupabaseStub();
        const { ProjectIntelligence } = loadProjectIntelligence(stub);
        const ai = makeOpenAIStub(GOOD_RESPONSE);
        const pi = new ProjectIntelligence({ openai: ai.client });

        await pi.ensureMap({
            projectId: 'p1', userId: 'u1',
            assets: [ASSET_A, ASSET_B, ASSET_PENDING], clipCount: 3,
        });

        check('asset_count excludes the still-processing asset',
            calls.upserts[0].row.asset_count === 2, `${calls.upserts[0].row.asset_count}`);
        check('the pending asset is absent from the prompt',
            !ai.state.lastPrompt.includes('asset-C'),
            'an unanalysed asset would be described from its filename alone');
        check('analysed assets are present in the prompt',
            ai.state.lastPrompt.includes('asset-A') && ai.state.lastPrompt.includes('asset-B'));
    }

    // ── 7 · Prompt honesty ───────────────────────────────────────────────────
    section('7 · The derivation prompt forbids invention');
    {
        const { ProjectIntelligence } = loadProjectIntelligence(makeSupabaseStub().stub);
        const pi = new ProjectIntelligence({ openai: makeOpenAIStub({}).client });
        const prompt = pi.buildDerivationPrompt({ assets: [ASSET_A, ASSET_B], clipCount: 2 });

        check('tells the model to return null rather than guess',
            /null for it rather than guessing/i.test(prompt));
        check('tells the model not to invent coverage gaps',
            /do not invent gaps/i.test(prompt));
        check('asks it to reason about assets together',
            /TOGETHER/.test(prompt));
        check('includes the asset descriptions', prompt.includes('Founder explaining the product.'));
    }

    // ── 8 · binReady comes from server-side rows ─────────────────────────────
    section('8 · binReady is derived from real analysis rows (R44)');
    {
        const CE_PATH = require.resolve(path.resolve(__dirname, '../server/brain/ContextEngine.js'));
        delete require.cache[CE_PATH];
        const { ContextEngine } = require(CE_PATH);
        const engine = new ContextEngine();

        const mediaBin = [{ id: 'asset-A', name: 'a.mp4', type: 'video', duration: 10 },
                          { id: 'asset-B', name: 'b.mp4', type: 'video', duration: 5 }];

        const notReady = engine.build({ mediaBin, tracks: [], assetIntelligence: [ASSET_A] });
        check('binReady is false when one asset has no row', notReady.binReady === false);
        check('analyzedAssets counts the completed ones', notReady.analyzedAssets === 1,
            `${notReady.analyzedAssets}`);

        const ready = engine.build({ mediaBin, tracks: [], assetIntelligence: [ASSET_A, ASSET_B] });
        check('binReady is true when every asset is done', ready.binReady === true,
            'this was permanently false before R44 — it read a client field nothing writes');

        const pending = engine.build({
            mediaBin, tracks: [],
            assetIntelligence: [ASSET_A, { ...ASSET_B, analysis_status: 'processing' }],
        });
        check('a processing asset does not count as ready', pending.binReady === false);

        // The regression that started this: the client sends analysis_status,
        // but nothing ever populates it. binReady must not depend on it.
        const clientClaims = engine.build({
            mediaBin: mediaBin.map(a => ({ ...a, analysis_status: 'done' })),
            tracks: [], assetIntelligence: [],
        });
        check('a client-supplied analysis_status cannot fake readiness',
            clientClaims.binReady === false,
            'binReady is trusting client input again');

        check('projectMap passes through', engine.build({
            mediaBin: [], tracks: [], projectMap: { project_type: 'vlog' },
        }).projectMap.project_type === 'vlog');
        check('a missing projectMap is null, not undefined',
            engine.build({ mediaBin: [], tracks: [] }).projectMap === null);
    }

    // ── 9 · The Brain renders the map ────────────────────────────────────────
    section('9 · EditorialBrain renders the map and survives its absence');
    {
        const brainSrc = fs.readFileSync(
            path.resolve(__dirname, '../server/brain/EditorialBrain.js'), 'utf8');

        check('prompt has a PROJECT MAP section', /PROJECT MAP/.test(brainSrc));
        check('there are rules, not just a rendered block',
            /PROJECT MAP RULES/.test(brainSrc),
            'a field the model is shown but told nothing about is inert (R39)');
        check('the not-established case is handled',
            /not established yet/.test(brainSrc));
        check('a failed map is treated as absent',
            /status === 'failed'/.test(brainSrc));
        check('an empty gap list is explicitly not an invitation to invent',
            /do NOT invent a gap/i.test(brainSrc));
        check('binReady no longer prints a bare "still processing"',
            /analysed so far/.test(brainSrc));
    }

    // ── Summary ──────────────────────────────────────────────────────────────
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Project Intelligence: ${passed} passed, ${failed} failed`);
    console.log('─'.repeat(60));
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('\nTest harness crashed:', err);
    process.exit(1);
});
