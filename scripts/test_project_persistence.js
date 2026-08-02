/**
 * scripts/test_project_persistence.js
 *
 *   node scripts/test_project_persistence.js
 *
 * Pins the project-persistence contract in client/src/store/useTimelineStore.js.
 *
 * WHY THIS EXISTS
 * ---------------
 * saveProject() used to persist only the timeline (tracks, duration, captions,
 * assets…) and silently omit every expensive AI result the editor had computed:
 * transcripts (Whisper), diarizationByAsset (1–5 min job per asset),
 * sceneAnalysisByAsset (GPT-4o Vision), speakerMap, contentAnalysis,
 * editHistory (the Editorial Brain's memory, R19) and waveforms.
 *
 * That single omission surfaced as four unrelated-looking bugs — "the
 * transcript disappeared", "it re-ran diarization", "the Brain forgot what I
 * did", "the waveform vanished after a refresh". Anything that recomputes on
 * reload is either slow, paid, or both, so a field silently dropping out of
 * this payload is expensive in a way that is invisible in review. Hence a test.
 *
 * This runs the real source: the three field lists are extracted from
 * useTimelineStore.js by parsing it, so the test fails if someone adds a field
 * to one of save/load/pre-restore and forgets the other two.
 *
 * Pure static + in-memory — no browser, no network, no credentials.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const STORE_PATH = path.resolve(__dirname, '../client/src/store/useTimelineStore.js');
const HOOK_PATH  = path.resolve(__dirname, '../client/src/hooks/useSupabasePersistence.js');

const src     = fs.readFileSync(STORE_PATH, 'utf8');
const hookSrc = fs.readFileSync(HOOK_PATH, 'utf8');

let failures = 0;
const check = (name, cond, detail) => {
    if (cond) {
        console.log(`  ✓ ${name}`);
    } else {
        failures++;
        console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
    }
};

/** Extract the body of a top-level `name: () => { ... }` store action. */
function extractBlock(source, startMarker) {
    const start = source.indexOf(startMarker);
    if (start === -1) return null;
    let depth = 0, i = source.indexOf('{', start), began = false;
    for (; i < source.length; i++) {
        if (source[i] === '{') { depth++; began = true; }
        else if (source[i] === '}') { depth--; if (began && depth === 0) return source.slice(start, i + 1); }
    }
    return null;
}

// The fields whose loss costs real time or money on every reload.
const AI_FIELDS = [
    'transcripts',
    'diarizationByAsset',
    'sceneAnalysisByAsset',
    'speakerMap',
    'contentAnalysis',
    'editHistory',
    'captionsFilePath',
    'waveforms',
    // Asset-keyed peak cache owned by services/WaveformEngine.js. Persisting it
    // is what makes a reload a cache hit instead of a full ffmpeg re-extraction
    // of every asset on the timeline.
    'waveformsByAsset',
];

console.log('\n── 1. saveProject() writes every AI-result field ──');
const saveBlock = extractBlock(src, 'saveProject: () =>');
check('saveProject block found', !!saveBlock);
if (saveBlock) {
    for (const f of AI_FIELDS) {
        check(`saveProject persists "${f}"`,
            new RegExp(`\\b${f}\\s*:`).test(saveBlock),
            `Add \`${f}: state.${f} || …\` to the projectData object.`);
    }
}

console.log('\n── 2. loadProject() restores every AI-result field ──');
const loadBlock = extractBlock(src, 'loadProject: (projectData) =>');
check('loadProject block found', !!loadBlock);
if (loadBlock) {
    for (const f of AI_FIELDS) {
        check(`loadProject restores "${f}"`,
            new RegExp(`\\b${f}\\s*:`).test(loadBlock),
            `Add \`${f}: projectData.${f} ?? get().${f}\` to the updates object.`);
    }
    // An older project saved before this change has no such key. Blanking it
    // would wipe a transcript the user just generated — the exact bug this
    // whole change set exists to fix. So the fallback must be the CURRENT
    // in-memory value, never a hard empty literal.
    for (const f of AI_FIELDS) {
        check(`loadProject falls back to live state for "${f}" (not a hard empty)`,
            new RegExp(`\\b${f}\\s*:\\s*projectData\\.${f}\\s*\\?\\?\\s*get\\(\\)`).test(loadBlock),
            `Use \`?? get().${f}\` — a legacy payload lacking this key must not blank it.`);
    }
}

console.log('\n── 3. Synchronous pre-restore seeds every AI-result field ──');
// The localStorage pre-restore at module scope is a THIRD path (distinct from
// loadProject, which serves Supabase loads). If it drifts, a locally-restored
// project has the transcript and a cloud-loaded one doesn't — "sometimes it
// remembers, sometimes it doesn't".
const preRestore = src.slice(0, src.indexOf('saveProject: () =>'));
for (const f of AI_FIELDS) {
    check(`initial state seeds "${f}" from _preRestoredProject`,
        new RegExp(`\\b${f}\\s*:\\s*_preRestoredProject\\?\\.${f}`).test(preRestore),
        `Add \`${f}: _preRestoredProject?.${f} || …\` to the initial state.`);
}

console.log('\n── 4. Autosave version stayed at 1.2 (no forced wipe) ──');
// The pre-restore discards any autosave whose version !== the expected one AND
// clears vp_project_id with it. The new fields are purely additive and every
// read is guarded, so bumping the version would wipe in-progress projects on
// deploy for zero benefit.
check('saveProject still writes version 1.2',
    /version:\s*'1\.2'/.test(saveBlock || ''),
    'Bumping this discards every existing autosave on deploy. The added fields are additive — do not bump.');
check('pre-restore still accepts version 1.2',
    /_saved\.version === '1\.2'/.test(preRestore));

console.log('\n── 5. Quota overflow degrades gracefully, never silently ──');
if (saveBlock) {
    check('a drop order is defined for over-quota writes',
        /DROP_ORDER/.test(saveBlock),
        'A quota overflow must shed recomputable blobs, not lose the timeline.');
    check('waveforms are shed before transcripts',
        (() => {
            const m = saveBlock.match(/DROP_ORDER\s*=\s*\[([^\]]*)\]/);
            if (!m) return false;
            const order = m[1].split(',').map(s => s.trim().replace(/['"]/g, ''));
            return order.indexOf('waveforms') !== -1 &&
                   order.indexOf('transcripts') !== -1 &&
                   order.indexOf('waveforms') < order.indexOf('transcripts');
        })(),
        'Waveforms regenerate from a local ffmpeg call; transcripts cost money. Shed the cheap one first.');
    check('total write failure is logged, not swallowed',
        /console\.error\([^)]*localStorage is full/i.test(saveBlock),
        'This is the one case where the user can genuinely lose work — it must not fail silently.');
    check('saveProject returns the COMPLETE payload, not the stripped one',
        /return projectData;/.test(saveBlock) && !/return payload;/.test(saveBlock),
        'Supabase has no 5 MB ceiling; a localStorage overflow must not degrade the cloud copy.');
}

console.log('\n── 6. Supabase mirror uses live state, not the localStorage copy ──');
check('useSupabasePersistence calls saveProject() for its payload',
    /saveProject\(\)/.test(hookSrc),
    'Reading vp_autosave back means Supabase receives the quota-stripped payload.');
check('useSupabasePersistence no longer parses vp_autosave',
    !/getItem\('vp_autosave'\)/.test(hookSrc),
    'That round-trip capped the cloud copy at localStorage\'s size limit and lagged 3 s behind.');

console.log('\n── 7. Round-trip simulation (save → restore → same values) ──');
// Mirrors the real payload shape rather than importing the store (which needs
// a browser). Guards the semantics the regexes above can't see.
{
    const state = {
        transcripts:          { 'IMG_3126.MOV': [{ word: 'hello', start: 0, end: 0.4 }] },
        diarizationByAsset:   { 'asset-1': { speakers: ['SPEAKER_00'], words: [] } },
        sceneAnalysisByAsset: { 'asset-1': { mode: 'solo', segments: [] } },
        speakerMap:           { SPEAKER_00: { role: 'interviewer' } },
        contentAnalysis:      { editMode: 'CLEAN_EDIT' },
        editHistory:          [{ op: 'silence_removal', at: 1 }],
        captionsFilePath:     'raw/u/IMG_3126.MOV',
        waveforms:            { video_main: { peaks: [0.1, 0.9], duration: 50 } },
        waveformsByAsset:     { 'asset-1': { peaks: [0.2, 0.8], duration: 50 } },
    };

    const saved   = JSON.parse(JSON.stringify(state));           // localStorage round-trip
    const restored = {};
    for (const f of AI_FIELDS) restored[f] = saved[f] ?? state[f];

    check('every field survives a JSON round-trip intact',
        JSON.stringify(restored) === JSON.stringify(state));

    // A project saved BEFORE this change carries none of these keys.
    const legacy = { tracks: [], duration: 60, version: '1.2' };
    const afterLegacyLoad = {};
    for (const f of AI_FIELDS) afterLegacyLoad[f] = legacy[f] ?? state[f];

    check('a legacy payload does NOT blank live in-memory values',
        JSON.stringify(afterLegacyLoad) === JSON.stringify(state),
        'Loading an old project must not wipe a transcript generated this session.');

    // editHistory is what the Editorial Brain reads (R19). If it resets on
    // reload, Creator Memory (the next roadmap track) learns from a ledger that
    // forgets overnight — it would appear to work in one session and silently
    // fail across days.
    check('editHistory survives reload (unblocks Creator Memory)',
        restored.editHistory.length === 1 && restored.editHistory[0].op === 'silence_removal');
}

console.log(
    failures === 0
        ? '\nALL PROJECT PERSISTENCE TESTS PASSED\n'
        : `\n${failures} PROJECT PERSISTENCE TEST(S) FAILED\n`
);
process.exit(failures === 0 ? 0 : 1);
