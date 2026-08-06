#!/usr/bin/env node
/**
 * Regression: Story Intelligence — narrative reading of the assembled cut (R51).
 *
 * Executes the real class against a stubbed OpenAI + Supabase. The properties
 * pinned here are the ones invisible in source text:
 *
 *   1. The fingerprint tracks the CUT, not the bin — clip ORDER and DURATION
 *      change it; nothing else should. Sharing the project map's fingerprint
 *      would make the story map stale after every reorder.
 *   2. A cut with no transcript produces NO story map. Beats are a claim about
 *      meaning; inferring them from durations is R30 exactly.
 *   3. Normalisation drops hallucinated clip ids and out-of-range timestamps
 *      rather than storing them as fact (R44).
 *   4. Insufficient data is RECORDED as such, not left absent (R38/R40).
 *   5. Persistence is upsert, never a silent .update().
 *
 * Run: node scripts/test_story_intelligence.js
 */

'use strict';

const path = require('path');
const fs   = require('fs');

let passed = 0, failed = 0;
const check = (n, c, d) => {
    if (c) { passed++; console.log(`  ✓ ${n}`); }
    else { failed++; console.log(`  ✗ ${n}`); if (d) console.log(`      ${d}`); }
};
const section = (t) => console.log(`\n${t}`);

const DB_PATH = require.resolve(path.resolve(__dirname, '../config/database.js'));
const AI_PATH = require.resolve(path.resolve(__dirname, '../services/AIProvider.js'));
const SI_PATH = require.resolve(path.resolve(__dirname, '../server/brain/StoryIntelligence.js'));

function makeSupabaseStub({ existingRow = null } = {}) {
    const calls = { upserts: [], updates: [] };
    const stub = {
        from() {
            return {
                select() { return this; },
                eq()    { return this; },
                async maybeSingle() { return { data: existingRow, error: null }; },
                update(row) {
                    calls.updates.push(row);
                    return { eq: async () => ({ data: null, error: null }) };
                },
                upsert(row, opts) {
                    calls.upserts.push({ row, opts });
                    return { select: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) };
                },
            };
        },
    };
    return { stub, calls };
}

function load(supabaseStub, { body = null, throwOnCall = false } = {}) {
    const state = { calls: 0, lastPrompt: null };

    require.cache[DB_PATH] = {
        id: DB_PATH, filename: DB_PATH, loaded: true,
        exports: { supabaseAdmin: supabaseStub },
    };
    require.cache[AI_PATH] = {
        id: AI_PATH, filename: AI_PATH, loaded: true,
        exports: {
            isAIConfigured: () => true,
            getAIClient: () => ({
                chat: { completions: { create: async ({ messages }) => {
                    state.calls++;
                    state.lastPrompt = messages[0].content;
                    if (throwOnCall) throw new Error('model unavailable');
                    return { choices: [{ message: { content: JSON.stringify(body) } }] };
                } } },
            }),
        },
    };
    delete require.cache[SI_PATH];
    return { mod: require(SI_PATH), state };
}

const CUT = [
    { id: 'c1', name: 'intro.mp4',  start: 0,  duration: 10, transcript: 'So the reason we built this was to solve a real problem people have.' },
    { id: 'c2', name: 'demo.mp4',   start: 10, duration: 20, transcript: 'Here it is running end to end, you can see the whole flow working.' },
    { id: 'c3', name: 'outro.mp4',  start: 30, duration: 8,  transcript: 'That is the product, try it out and let us know what you think.' },
];

const GOOD = {
    beats: [
        { beat: 'setup',  startSec: 0,  endSec: 10, clipIds: ['c1'], summary: 'Framing the problem' },
        { beat: 'payoff', startSec: 10, endSec: 30, clipIds: ['c2'], summary: 'The demo' },
    ],
    hook: { atSec: 12, strength: 'weak', note: 'the strongest moment is inside the demo' },
    sagWindows: [{ startSec: 0, endSec: 10, reason: 'preamble before anything happens', severity: 'medium' }],
    deliversThroughLine: false,
    throughLineNote: 'the point arrives after most viewers would leave',
    issues: [{ issue: 'hook is buried', severity: 'high', suggestion: 'lead with the demo', atSec: 12 }],
};

async function main() {

    section('1 · The fingerprint tracks the CUT, not the bin');
    {
        const { mod } = load(makeSupabaseStub().stub);
        const si = new mod.StoryIntelligence();

        const base = si.computeCutFingerprint(CUT);

        // Reordering the same clips IS a different cut — this is the whole
        // difference from the project map's bin-level hash.
        const reordered = [CUT[1], CUT[0], CUT[2]];
        check('reordering the same clips changes it',
            base !== si.computeCutFingerprint(reordered),
            'a reorder is exactly the edit a story map must notice');

        check('trimming a clip changes it',
            base !== si.computeCutFingerprint(
                CUT.map(c => c.id === 'c2' ? { ...c, duration: 15 } : c)));

        check('removing a clip changes it',
            base !== si.computeCutFingerprint(CUT.slice(0, 2)));

        check('gaining a transcript changes it',
            base !== si.computeCutFingerprint(
                CUT.map(c => c.id === 'c3' ? { ...c, transcript: '' } : c)),
            'a map derived without meaning must not survive the transcript arriving');

        check('an identical cut is stable',
            base === si.computeCutFingerprint(CUT.map(c => ({ ...c }))));
    }

    section('2 · An unchanged cut costs no model call');
    {
        const probe = new (load(makeSupabaseStub().stub).mod.StoryIntelligence)();
        const fp = probe.computeCutFingerprint(CUT);

        const { stub, calls } = makeSupabaseStub({
            existingRow: { project_id: 'p1', user_id: 'u1', fingerprint: fp, status: 'ok', beats: [] },
        });
        const { mod, state } = load(stub, { body: GOOD });
        const si = new mod.StoryIntelligence();

        const map = await si.ensureMap({ projectId: 'p1', userId: 'u1', clips: CUT });
        check('the stored map is returned', !!map && map.fingerprint === fp);
        check('no model call', state.calls === 0, `${state.calls}`);
        check('nothing written', calls.upserts.length === 0);
    }

    section('3 · No transcript ⇒ no story map (R30)');
    {
        const { stub, calls } = makeSupabaseStub();
        const { mod, state } = load(stub, { body: GOOD });
        const si = new mod.StoryIntelligence();

        const silent = CUT.map(c => ({ ...c, transcript: '' }));
        const map = await si.ensureMap({ projectId: 'p1', userId: 'u1', clips: silent });

        check('no model call was made', state.calls === 0,
            'beats from durations alone would be a confident guess about meaning');
        check('status insufficient_data is RECORDED',
            calls.upserts.length === 1 && calls.upserts[0].row.status === 'insufficient_data',
            'absent and unreadable must be distinguishable (R38/R40)');
        check('the row explains why',
            /transcript/.test(calls.upserts[0].row.through_line_note || ''));
        check('no beats are invented',
            (map.beats || []).length === 0);
    }

    section('3b · A single clip is not a sequence');
    {
        const { stub, calls } = makeSupabaseStub();
        const { mod, state } = load(stub, { body: GOOD });
        const si = new mod.StoryIntelligence();

        await si.ensureMap({ projectId: 'p1', userId: 'u1', clips: [CUT[0]] });
        check('one clip does not get a story reading', state.calls === 0);
        check('the reason names the clip count',
            /1 clip\(s\)/.test(calls.upserts[0].row.through_line_note || ''),
            calls.upserts[0].row.through_line_note);
    }

    section('4 · Normalisation contains a wrong answer');
    {
        const { mod } = load(makeSupabaseStub().stub);
        const si = new mod.StoryIntelligence();

        const n = si.normalizeMap({
            beats: [
                { beat: 'hook',      startSec: 0,   endSec: 5,  clipIds: ['c1', 'GHOST'] },
                { beat: 'crescendo', startSec: 5,   endSec: 10, clipIds: ['c2'] },  // not a beat
            ],
            hook: { atSec: 9999, strength: 'incandescent', note: '  spaced  ' },
            sagWindows: [
                { startSec: 3, endSec: 8, reason: 'flat', severity: 'apocalyptic' },
                { startSec: 1, endSec: 2 },                       // no reason
            ],
            deliversThroughLine: 'maybe',                          // not a boolean
            issues: [{ issue: 'x', severity: 'high', atSec: 12 }, { severity: 'low' }],
        }, CUT);

        check('a hallucinated clip id is dropped',
            !n.beats[0].clipIds.includes('GHOST'), JSON.stringify(n.beats[0].clipIds));
        check('a real clip id survives', n.beats[0].clipIds.includes('c1'));
        check('an out-of-vocabulary beat is dropped',
            n.beats.length === 1 && n.beats[0].beat === 'hook', `${n.beats.length}`);
        check('a timestamp past the end of the cut becomes null',
            n.hook_at_sec === null, String(n.hook_at_sec),
        );
        check('an invalid hook strength falls back to absent',
            n.hook_strength === 'absent', n.hook_strength);
        check('note is trimmed', n.hook_note === 'spaced');
        check('an invalid severity is clamped', n.sag_windows[0].severity === 'medium');
        check('a sag with no reason is dropped', n.sag_windows.length === 1);
        check('a non-boolean deliversThroughLine becomes null',
            n.delivers_through_line === null);
        check('an issue with no text is dropped', n.issues.length === 1);
    }

    section('4b · Missing fields degrade to safe empties');
    {
        const { mod } = load(makeSupabaseStub().stub);
        const si = new mod.StoryIntelligence();
        for (const [label, input] of [['null', null], ['empty', {}]]) {
            const n = si.normalizeMap(input, CUT);
            check(`${label} → arrays not undefined`,
                Array.isArray(n.beats) && Array.isArray(n.sag_windows) && Array.isArray(n.issues));
            check(`${label} → hook_strength defaults to absent`, n.hook_strength === 'absent');
        }
    }

    section('5 · Persistence and failure handling');
    {
        const { stub, calls } = makeSupabaseStub();
        const { mod } = load(stub, { body: GOOD });
        const si = new mod.StoryIntelligence();

        const map = await si.ensureMap({ projectId: 'p1', userId: 'u1', clips: CUT });

        check('exactly one upsert', calls.upserts.length === 1);
        check('no .update() used', calls.updates.length === 0,
            'an update matching zero rows is silent in PostgREST (R38)');
        check('conflict target is project_id', calls.upserts[0].opts?.onConflict === 'project_id');
        check('clip_count is stored', calls.upserts[0].row.clip_count === 3);
        check('analysed_sec is stored', calls.upserts[0].row.analysed_sec === 38);
        check('the derived hook survives', map.hook_strength === 'weak');
        check('through-line failure is preserved',
            map.delivers_through_line === false);
    }
    {
        const { stub, calls } = makeSupabaseStub();
        const { mod } = load(stub, { throwOnCall: true });
        const si = new mod.StoryIntelligence();

        let threw = false;
        try { await si.ensureMap({ projectId: 'p1', userId: 'u1', clips: CUT }); }
        catch { threw = true; }

        check('ensureMap does not throw on model failure', !threw);
        check('status failed is recorded',
            calls.upserts.length === 1 && calls.upserts[0].row.status === 'failed');
    }

    section('6 · The prompt forbids inventing what it cannot see');
    {
        const { mod } = load(makeSupabaseStub().stub);
        const si = new mod.StoryIntelligence();
        const prompt = si.buildDerivationPrompt({
            clips: [...CUT, { id: 'c4', name: 'silent.mp4', start: 38, duration: 5, transcript: '' }],
            projectMap: { through_line: 'why we built it', project_type: 'product_demo' },
        });

        check('clips are presented in play order with timestamps',
            /1\. \[0s–10s\]/.test(prompt), prompt.split('\n').find(l => l.startsWith('1.')));
        check('a transcript-less clip is marked as such',
            /\(no transcript for this clip\)/.test(prompt));
        // The prompt wraps, so match across whitespace rather than assuming the
        // sentence sits on one line.
        check('it forbids characterising unseen clips',
            /do\s+NOT\s+characterise\s+what\s+it\s+says\s+or\s+shows/i.test(prompt));
        check('it forbids manufacturing issues',
            /Do not\s*\n?\s*manufacture problems/i.test(prompt));
        check('the through-line is included', /why we built it/.test(prompt));
        check('it demands real timestamps', /Give real start\/end seconds/.test(prompt));
    }

    section('7 · The Brain renders it and survives its absence');
    {
        const src = fs.readFileSync(
            path.resolve(__dirname, '../server/brain/EditorialBrain.js'), 'utf8');

        check('there is a cut section', /THE CUT AS ASSEMBLED/.test(src));
        check('there are rules, not just a rendered block', /CUT RULES/.test(src),
            'a field shown but not explained is inert (R39)');
        check('the not-read case is handled', /not read yet/.test(src));
        check('insufficient_data is handled', /insufficient_data/.test(src));
        check('an empty issue list is not an invitation',
            /do NOT invent one to fill this space/i.test(src));
        check('it requires citing the time', /Always cite the TIME/.test(src));
    }

    section('8 · The client sends the cut in play order');
    {
        const src = fs.readFileSync(
            path.resolve(__dirname, '../client/src/hooks/useBrain.js'), 'utf8');
        check('a cut field is sent', /^\s*cut: \(\(\) =>/m.test(src));
        check('it is sorted by timeline position',
            /sort\(\(a, b\) => \(a\.start \?\? 0\) - \(b\.start \?\? 0\)\)/.test(src));
        check('per-clip transcript is sliced from the source window',
            /w\.start \?\? 0\) >= from/.test(src));
    }

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Story Intelligence: ${passed} passed, ${failed} failed`);
    console.log('─'.repeat(60));
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('\nHarness crashed:', e); process.exit(1); });
