/**
 * scripts/test_edit_policy.mjs
 *
 * Guards EditPolicy — the shared decision layer.
 *
 * What this pins, and why each one is a bug that actually existed:
 *
 *  1. Prerequisite insertion. StyleAutopilot's talking-head playbook opens
 *     with "Clean up the video" on a fresh upload. Silence removal needs word
 *     timings, so the step failed and was reported as skipped. The policy must
 *     put captions first instead.
 *  2. Already-done steps are dropped. The playbook was built once, up front,
 *     so re-running Auto re-ran the whole thing.
 *  3. Style is honoured — from the server's own predicates, not a second
 *     hand-written table — but NEVER against an explicit request.
 *  4. The caller's prompt TEXT survives planning. polish_short reads its
 *     platform out of the prompt, so rewriting "Pro finish for Instagram
 *     Reels" to the id `polish_short` would silently retarget it at TikTok.
 *  5. Nothing is fabricated: an impossible goal is reported, not replaced.
 *
 * Run: node scripts/test_edit_policy.mjs
 */

import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Browser globals the client store touches at module scope.
globalThis.localStorage = {
    _m: {},
    getItem(k) { return this._m[k] ?? null; },
    setItem(k, v) { this._m[k] = String(v); },
    removeItem(k) { delete this._m[k]; },
};
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.innerWidth = 1200;
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' });

const log = console.log;
console.log = () => {}; console.warn = () => {}; console.info = () => {}; console.error = () => {};

const P = await import('../client/src/agent/EditPolicy.js');
const { COMMAND_PHRASE } = await import('../client/src/agent/commandPhrases.generated.js');
const { STYLE_POLICY } = await import('../client/src/agent/stylePolicy.generated.js');

console.log = log;

let passed = 0, failed = 0;
const check = (name, fn) => {
    try { fn(); passed++; log(`  ✓ ${name}`); }
    catch (e) { failed++; log(`  ✗ ${name}`); log(`      ${e.message}`); }
};
const section = (t) => log(`\n${t}`);

/** A project in a given state. Shapes match the real store. */
const project = (o = {}) => ({
    tracks: [
        {
            type: 'video',
            clips: (o.clips ?? 2) === 0 ? [] : Array.from({ length: o.clips ?? 2 }, (_, i) => ({
                id: 'c' + i,
                ...(o.rhythm ? { keyframes: { scale: [{ time: 0, value: 1 }] } } : {}),
                ...(o.cam ? { virtualCam: { angle: 'mid' } } : {}),
            })),
        },
        { type: 'text', clips: o.captionClips ? [{ id: 't1' }] : [] },
    ],
    assets: Array.from({ length: o.assets ?? 1 }, (_, i) => ({ id: 'a' + i, type: 'video' })),
    captions: o.transcript ? [{ word: 'hi', start: 0, end: 1 }] : [],
    speakerMap: o.diarized ? { SPEAKER_00: {}, SPEAKER_01: {} } : {},
    editHistory: (o.ops || []).map(op => ({ op })),
    editingStyle: o.style || null,
    aspectRatio: o.aspect || '16:9',
    duration: o.duration ?? 120,
    projectLUTId: o.grade ? 'lut1' : null,
});

const ids = (r) => r.steps.map(s => s.id);

// ── 1. Prerequisite insertion ────────────────────────────────────────────────
section('1. Prerequisites are inserted, not failed');

check('talking-head playbook on a fresh upload puts captions first', () => {
    const r = P.decide({
        goals: ['silence_removal', 'remove_filler_words', 'rhythm_zoom'],
        state: project({ style: 'talking_head' }),
    });
    assert.equal(ids(r)[0], 'auto_captions', `got [${ids(r)}]`);
    assert.ok(r.inserted.includes('auto_captions'));
    assert.equal(r.unreachable.length, 0, JSON.stringify(r.unreachable));
});

check('…inserted exactly once for three goals that all need it', () => {
    const r = P.decide({
        goals: ['silence_removal', 'remove_filler_words', 'rhythm_zoom'],
        state: project({ style: 'talking_head' }),
    });
    assert.equal(ids(r).filter(i => i === 'auto_captions').length, 1, `got [${ids(r)}]`);
});

check('…and the requested order is preserved after it', () => {
    const r = P.decide({
        goals: ['silence_removal', 'rhythm_zoom'],
        state: project({ style: 'talking_head' }),
    });
    assert.deepEqual(ids(r), ['auto_captions', 'silence_removal', 'rhythm_zoom']);
});

check('a diarization-gated goal inserts detect_speakers', () => {
    const r = P.decide({ goals: ['apply_angle'], state: project({ style: 'interview' }) });
    assert.deepEqual(ids(r), ['detect_speakers', 'apply_angle'], `got [${ids(r)}]`);
});

check('an inserted step is marked as inserted, a requested one is not', () => {
    const r = P.decide({ goals: ['silence_removal'], state: project({ style: 'talking_head' }) });
    const captions = r.steps.find(s => s.id === 'auto_captions');
    const silence = r.steps.find(s => s.id === 'silence_removal');
    assert.equal(captions.inserted, true);
    assert.equal(silence.inserted, false);
});

check('nothing is inserted when the project already has what it needs', () => {
    const r = P.decide({
        goals: ['silence_removal'],
        state: project({ style: 'talking_head', transcript: true }),
    });
    assert.deepEqual(ids(r), ['silence_removal']);
    assert.equal(r.inserted.length, 0);
});

// ── 2. Already-done work is dropped ──────────────────────────────────────────
section('2. Work already done is dropped, with a reason');

check('a re-run of the same playbook keeps only what is outstanding', () => {
    const r = P.decide({
        goals: ['silence_removal', 'remove_filler_words', 'auto_captions', 'rhythm_zoom'],
        state: project({
            style: 'talking_head', transcript: true, captionClips: true,
            ops: ['silence_removal', 'remove_filler_words', 'auto_captions'],
        }),
    });
    assert.deepEqual(ids(r), ['rhythm_zoom'], `got [${ids(r)}]`);
    assert.equal(r.skipped.length, 3);
    assert.ok(r.skipped.every(s => /already done/i.test(s.reason)));
});

check('a legacy/compound operation name counts as satisfying the command', () => {
    // The ledger records `compound_clean_dynamic`, not `silence_removal`.
    const sit = P.situationOf(project({ transcript: true, ops: ['compound_clean_dynamic'] }));
    assert.equal(P.isSatisfied('silence_removal', sit), true);
    assert.equal(P.isSatisfied('rhythm_zoom', sit), true);
});

check('split_by_speaker is satisfied by its legacy `split_speakers` operation', () => {
    const sit = P.situationOf(project({ diarized: true, ops: ['split_speakers'] }));
    assert.equal(P.isSatisfied('split_by_speaker', sit), true);
});

check('coverage, not a boolean, decides partial effects', () => {
    const partial = P.situationOf(project({ clips: 4, cam: false, transcript: true }));
    assert.equal(P.isSatisfied('apply_angle', partial), false, 'no coverage → not done');
    const full = P.situationOf(project({ clips: 4, cam: true, transcript: true }));
    assert.equal(P.isSatisfied('apply_angle', full), true, 'full coverage → done');
});

check('captions need BOTH a transcript and placed caption clips', () => {
    const wordsOnly = P.situationOf(project({ transcript: true }));
    assert.equal(P.isSatisfied('auto_captions', wordsOnly), false);
    const both = P.situationOf(project({ transcript: true, captionClips: true }));
    assert.equal(P.isSatisfied('auto_captions', both), true);
});

check('skipSatisfied:false keeps the work anyway', () => {
    const r = P.decide({
        goals: ['silence_removal'],
        state: project({ transcript: true, ops: ['silence_removal'] }),
        skipSatisfied: false,
    });
    assert.deepEqual(ids(r), ['silence_removal']);
});

// ── 3. Style fit, from the server's predicates ───────────────────────────────
section('3. Editing style is honoured — but never over an explicit request');

check('podcast discourages sound effects (sfxLevel none)', () => {
    const { fit } = P.styleFit('add_sfx', 'podcast');
    assert.equal(fit, P.FIT.DISCOURAGED);
    assert.equal(STYLE_POLICY.podcast.sfxLevel, 'none', 'generated policy must agree');
});

check('vlog/interview/podcast discourage hook-first reordering', () => {
    for (const style of ['vlog', 'interview', 'podcast']) {
        assert.equal(STYLE_POLICY[style].keepsRecordedOrder, true);
        assert.equal(P.styleFit('extract_short', style).fit, P.FIT.DISCOURAGED, style);
    }
});

check('reel allows reordering — it is the whole point of the format', () => {
    assert.equal(STYLE_POLICY.reel.keepsRecordedOrder, false);
    assert.notEqual(P.styleFit('extract_short', 'reel').fit, P.FIT.DISCOURAGED);
});

check('calm styles constrain zoom rhythm rather than banning it', () => {
    assert.equal(STYLE_POLICY.podcast.allowPunchIns, false);
    assert.equal(P.styleFit('rhythm_zoom', 'podcast').fit, P.FIT.CONSTRAINED);
});

check('talking_head allows sound effects (sfxLevel subtle, not none)', () => {
    assert.equal(STYLE_POLICY.talking_head.sfxLevel, 'subtle');
    assert.notEqual(P.styleFit('add_sfx', 'talking_head').fit, P.FIT.DISCOURAGED);
});

check('no style set → no opinion', () => {
    assert.equal(P.styleFit('add_sfx', null).fit, P.FIT.NEUTRAL);
    assert.equal(P.styleFit('extract_short', 'not_a_style').fit, P.FIT.NEUTRAL);
});

check('respectStyle:true drops off-style goals with the reason', () => {
    const r = P.decide({
        goals: ['enhance_audio', 'add_sfx', 'extract_short'],
        state: project({ style: 'podcast', transcript: true }),
        respectStyle: true,
    });
    assert.deepEqual(ids(r), ['enhance_audio'], `got [${ids(r)}]`);
    assert.equal(r.skipped.length, 2);
    assert.ok(r.skipped.some(s => /no sound effects/i.test(s.reason)));
    assert.ok(r.skipped.some(s => /recorded order/i.test(s.reason)));
});

check('respectStyle:false (the default) NEVER vetoes an explicit request', () => {
    const r = P.decide({
        goals: ['add_sfx', 'extract_short'],
        state: project({ style: 'podcast', transcript: true }),
    });
    assert.deepEqual(ids(r), ['add_sfx', 'extract_short'], `got [${ids(r)}]`);
    assert.equal(r.skipped.length, 0);
});

// ── 4. The caller's text survives planning ───────────────────────────────────
section('4. Prompt text is preserved (parameters live in it)');

check('"Pro finish for Instagram Reels" survives verbatim', () => {
    const r = P.decide({
        goals: ['Pro finish for Instagram Reels'],
        state: project({ style: 'reel' }),
    });
    assert.ok(r.prompts.includes('Pro finish for Instagram Reels'),
        `prompts were ${JSON.stringify(r.prompts)}`);
    // …while still being understood as polish_short for reasoning.
    assert.equal(ids(r)[ids(r).length - 1], 'polish_short');
});

check('…because the bare id would lose the platform', () => {
    // Documents the hazard: the id resolves, but its phrase names no platform,
    // and polish_short falls back to tiktok when the text says nothing.
    assert.equal(P.commandIdFor('Pro finish for Instagram Reels'), 'polish_short');
    assert.ok(!/instagram|reels/i.test(COMMAND_PHRASE.polish_short));
});

check('"Set the aspect ratio to 9:16" keeps its ratio', () => {
    const r = P.decide({ goals: ['Set the aspect ratio to 9:16'], state: project({ style: 'reel' }) });
    assert.ok(r.prompts.some(p => p.includes('9:16')), JSON.stringify(r.prompts));
    assert.equal(r.underspecified.length, 0);
});

check('a bare parameterised id is flagged as underspecified', () => {
    const r = P.decide({ goals: ['set_aspect_ratio', 'add_transition'], state: project({ style: 'reel' }) });
    const flagged = r.underspecified.map(u => u.id).sort();
    assert.deepEqual(flagged, ['add_transition', 'set_aspect_ratio'], JSON.stringify(r.underspecified));
    assert.ok(r.underspecified.find(u => u.id === 'set_aspect_ratio').params.includes('ratio'));
});

check('a bare id with no parameters is not flagged', () => {
    const r = P.decide({ goals: ['auto_captions'], state: project({}) });
    assert.equal(r.underspecified.length, 0);
});

check('inserted prerequisites take no parameters, so insertion is always safe', () => {
    for (const id of ['auto_captions', 'detect_speakers', 'detect_scene']) {
        const r = P.decide({ goals: [id], state: project({}) });
        assert.equal(r.underspecified.length, 0, id);
    }
});

check('an inserted step gets a phrase verified to route to it', () => {
    const r = P.decide({ goals: ['silence_removal'], state: project({}) });
    const inserted = r.steps.find(s => s.inserted);
    assert.equal(inserted.prompt, COMMAND_PHRASE.auto_captions);
});

check('unresolvable free text passes through untouched, keeping its place', () => {
    const r = P.decide({
        goals: ['auto_captions', 'do something the registry has never heard of'],
        state: project({}),
    });
    assert.ok(r.prompts.includes('do something the registry has never heard of'));
    assert.equal(r.steps[r.steps.length - 1].id, null);
});

check('a low-confidence match is NOT acted on', () => {
    // commandIdFor only accepts a high-confidence registry resolution; an
    // ambiguous phrase must stay text for the full parser to handle.
    assert.equal(P.commandIdFor(''), null);
    assert.equal(P.commandIdFor(null), null);
    assert.equal(P.commandIdFor('xyzzy nonsense words'), null);
});

// ── 5. Nothing is fabricated ─────────────────────────────────────────────────
section('5. Impossible goals are reported, never replaced');

check('an empty project flags every goal as blocked, and drops none', () => {
    const r = P.decide({ goals: ['silence_removal', 'auto_captions'], state: project({ clips: 0, assets: 0 }) });
    // Kept, not dropped: a blocked step behaves exactly as it does today (it
    // runs and reports its own failure), so the policy can never make Auto
    // silently do less than it used to. The caller decides.
    assert.deepEqual(ids(r), ['silence_removal', 'auto_captions'], `got [${ids(r)}]`);
    assert.ok(r.steps.every(st => st.blocked === true), 'all steps blocked');
    assert.ok(r.steps.every(st => st.missing.includes('clips')));
    assert.ok(r.unreachable.every(u => u.missing.includes('clips')));
});

check('…and a cautious runner gets an empty runnable list for it', () => {
    const r = P.decide({ goals: ['silence_removal', 'auto_captions'], state: project({ clips: 0, assets: 0 }) });
    assert.deepEqual(r.runnablePrompts, [], JSON.stringify(r.runnablePrompts));
    assert.equal(r.prompts.length, 2, 'but nothing was lost from prompts');
});

check('a block is marked untrusted once an opaque step precedes it', () => {
    // The montage step provides clips but does not resolve through the
    // registry, so a later "needs clips" block may not be real.
    const r = P.decide({
        goals: ['Create a video from the uploaded images and event footage', 'auto_captions'],
        state: project({ clips: 0, assets: 3 }),
    });
    const captions = r.steps.find(st => st.id === 'auto_captions');
    assert.equal(captions.blocked, true);
    assert.equal(captions.blockedTrusted, false, 'must not be trusted after an opaque step');
    assert.ok(r.runnablePrompts.includes(COMMAND_PHRASE.auto_captions),
        'an untrusted block must stay runnable');
});

check('…and never inserts a command that would invent content', () => {
    const r = P.decide({ goals: ['silence_removal'], state: project({ clips: 0, assets: 0 }) });
    assert.ok(!r.inserted.includes('create_video_from_script'));
    assert.ok(!r.inserted.includes('create_video_from_assets'));
    assert.ok(!ids(r).includes('create_video_from_script'));
});

check('clear_lut with no grade applied is blocked on colorGrade', () => {
    const r = P.decide({ goals: ['clear_lut'], state: project({}) });
    assert.deepEqual(ids(r), ['clear_lut']);
    assert.equal(r.steps[0].blocked, true);
    assert.ok(r.steps[0].missing.includes('colorGrade'));
    assert.deepEqual(r.runnablePrompts, []);
    assert.ok(r.unreachable.some(u => u.missing.includes('colorGrade')));
});

check('…and reachable once a grade exists', () => {
    const r = P.decide({ goals: ['clear_lut'], state: project({ grade: true }) });
    assert.deepEqual(ids(r), ['clear_lut']);
});

// ── 5b. Compound operations (IntentParser-level, not in the registry) ───────
section('5b. Compound operations');

check('"Clean up the video" is understood as long_form_edit', () => {
    assert.equal(P.commandIdFor('Clean up the video'), 'long_form_edit');
    assert.equal(P.commandIdFor('clean it up'), 'long_form_edit');
    assert.equal(P.commandIdFor('full cleanup'), 'long_form_edit');
});

check('…so captions are inserted before it on a fresh upload', () => {
    const r = P.decide({ goals: ['Clean up the video'], state: project({ style: 'talking_head' }) });
    assert.deepEqual(ids(r), ['auto_captions', 'long_form_edit'], `got [${ids(r)}]`);
    assert.equal(r.steps[0].inserted, true);
    assert.equal(r.steps[1].prompt, 'Clean up the video', 'the caller text must survive');
});

check('…and nothing is inserted once a transcript exists', () => {
    const r = P.decide({
        goals: ['Clean up the video'],
        state: project({ style: 'talking_head', transcript: true }),
    });
    assert.deepEqual(ids(r), ['long_form_edit']);
    assert.equal(r.inserted.length, 0);
});

check('a completed long_form_edit is recognised as done', () => {
    const sit = P.situationOf(project({ transcript: true, ops: ['long_form_edit'] }));
    assert.equal(P.isSatisfied('long_form_edit', sit), true);
});

check('the real talking-head playbook comes out captions-first, order intact', () => {
    const r = P.decide({
        goals: ['Clean up the video', 'Add captions', 'Apply the punchy style recipe'],
        state: project({ style: 'talking_head' }),
    });
    assert.deepEqual(r.prompts,
        ['Add captions', 'Clean up the video', 'Apply the punchy style recipe'],
        JSON.stringify(r.prompts));
});

check('the longest matching trigger wins', () => {
    // Both 'clean up' and 'clean up the video' are triggers; the specific one
    // must not be shadowed by the generic.
    assert.equal(P.commandIdFor('please clean up the video for me'), 'long_form_edit');
});

check('every compound trigger still exists in IntentParser NLP_MAP.cleanEdit', () => {
    // Pins the compound vocabulary to its real source so this cannot become a
    // second, disagreeing definition of what "clean up" means.
    const src = readFileSync(
        new URL('../client/src/agent/IntentParser.js', import.meta.url), 'utf8');
    const block = src.match(/cleanEdit:\s*\[([\s\S]*?)\]/);
    assert.ok(block, 'NLP_MAP.cleanEdit not found in IntentParser.js');
    const declared = new Set(
        [...block[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(m => m[1].replace(/\\'/g, "'").toLowerCase()));
    const missing = P.COMPOUND_OPERATIONS.long_form_edit.triggers
        .filter(t => !declared.has(t.toLowerCase()));
    assert.equal(missing.length, 0,
        `triggers no longer in IntentParser NLP_MAP.cleanEdit: ${missing.join(', ')}`);
});

// ── 6. Ranking ───────────────────────────────────────────────────────────────
section('6. Ranking explains itself');

check('captions top the ranking on a fresh upload (they unlock the most)', () => {
    const top = P.rank({ state: project({ style: 'talking_head' }), limit: 1 })[0];
    assert.equal(top.id, 'auto_captions', `got ${top.id}`);
    assert.ok(top.unlocks.length >= 5, `unlocks ${top.unlocks.length}`);
});

check('an ineligible command sinks below every runnable one', () => {
    const all = P.rank({ state: project({ style: 'talking_head' }) });
    const firstIneligible = all.findIndex(s => !s.eligible);
    const lastEligible = all.map(s => s.eligible).lastIndexOf(true);
    assert.ok(firstIneligible > lastEligible, 'eligible must all rank above ineligible');
});

check('an already-done command sinks too', () => {
    const scored = P.scoreOf('silence_removal', P.situationOf(
        project({ transcript: true, ops: ['silence_removal'] })));
    assert.equal(scored.satisfied, true);
    assert.ok(scored.score < 0, `score ${scored.score}`);
});

check('an off-style command ranks below a neutral one', () => {
    const sit = P.situationOf(project({ style: 'podcast', transcript: true }));
    const sfx = P.scoreOf('add_sfx', sit);
    const neutral = P.scoreOf('add_text_overlay', sit);
    assert.ok(sfx.score < neutral.score, `${sfx.score} should be < ${neutral.score}`);
});

check('read-only analysis is preferred over a destructive route to the same resource', () => {
    const sit = P.situationOf(project({}));
    assert.ok(P.scoreOf('detect_speakers', sit).score > P.scoreOf('macro_multicam', sit).score);
});

check('every score carries reasons, and explain() renders them', () => {
    const sit = P.situationOf(project({ style: 'podcast', transcript: true }));
    for (const id of ['auto_captions', 'add_sfx', 'clear_lut']) {
        const s = P.scoreOf(id, sit);
        assert.ok(s.reasons.length > 0, `${id} had no reasons`);
        assert.ok(P.explain(s).startsWith(id));
    }
    assert.equal(P.explain(null), '');
});

check('an unknown command scores -Infinity rather than throwing', () => {
    const s = P.scoreOf('not_a_command', P.situationOf(project({})));
    assert.equal(s.score, -Infinity);
    assert.equal(s.eligible, false);
});

// ── 7. Robustness ────────────────────────────────────────────────────────────
section('7. Robustness');

check('decide() tolerates no arguments', () => {
    const r = P.decide();
    assert.deepEqual(r.steps, []);
    assert.deepEqual(r.prompts, []);
});

check('situationOf tolerates a null/empty state', () => {
    for (const st of [null, {}, { tracks: null, assets: null }]) {
        const sit = P.situationOf(st);
        assert.ok(sit.resources instanceof Set);
        assert.ok(sit.facts);
    }
});

check('a style the generator does not know is ignored, not crashed on', () => {
    const r = P.decide({ goals: ['add_sfx'], state: project({ style: 'bogus' }), respectStyle: true });
    assert.deepEqual(ids(r), ['add_sfx']);
});

check('duplicate goals are planned once', () => {
    const r = P.decide({ goals: ['auto_captions', 'auto_captions'], state: project({}) });
    assert.deepEqual(ids(r), ['auto_captions']);
});

check('every generated phrase exists for every command the policy can plan', () => {
    const missing = Object.keys(COMMAND_PHRASE).filter(id => !COMMAND_PHRASE[id]);
    assert.equal(missing.length, 0, missing.join(', '));
});

// ── 8. StyleAutopilot integration (Auto mode is state-aware) ────────────────
section('8. Auto mode uses the policy');

const { default: Store } = await import('../client/src/store/useTimelineStore.js');
const { runAutopilot } = await import('../client/src/agent/StyleAutopilot.js');

/** Put the store into a known state. */
const setStore = (o = {}) => {
    Store.setState({
        tracks: project(o).tracks,
        assets: project(o).assets,
        captions: project(o).captions,
        speakerMap: project(o).speakerMap,
        editHistory: project(o).editHistory,
        editingStyle: o.style || 'talking_head',
        editingMode: 'auto',
        aspectRatio: o.aspect || '16:9',
        duration: o.duration ?? 120,
        projectLUTId: o.grade ? 'lut1' : null,
    });
};

const runCapture = async (o = {}) => {
    setStore(o);
    const prompts = [];
    const res = await runAutopilot('edit it', {
        styleId: o.style || 'talking_head',
        run: async (prompt) => { prompts.push(prompt); return { success: true, message: 'ok' }; },
    });
    return { prompts, res };
};

await (async () => {
    const name = 'Auto on a fresh upload runs captions BEFORE the cleanup step';
    try {
        const { prompts } = await runCapture({ style: 'talking_head' });
        const captions = prompts.findIndex(p => /captions/i.test(p));
        const cleanup = prompts.findIndex(p => /clean up/i.test(p));
        assert.ok(captions >= 0, `no captions step in ${JSON.stringify(prompts)}`);
        assert.ok(cleanup >= 0, `no cleanup step in ${JSON.stringify(prompts)}`);
        assert.ok(captions < cleanup,
            `captions (${captions}) must precede cleanup (${cleanup}): ${JSON.stringify(prompts)}`);
        passed++; log(`  ✓ ${name}`);
    } catch (e) { failed++; log(`  ✗ ${name}`); log(`      ${e.message}`); }
})();

await (async () => {
    const name = 'Auto preserves the reel playbook\'s own prompt text (platform survives)';
    try {
        const { prompts } = await runCapture({ style: 'reel', duration: 240 });
        assert.ok(prompts.some(p => /Instagram Reels/i.test(p)),
            `platform lost from ${JSON.stringify(prompts)}`);
        assert.ok(prompts.some(p => /9:16/.test(p)),
            `aspect target lost from ${JSON.stringify(prompts)}`);
        passed++; log(`  ✓ ${name}`);
    } catch (e) { failed++; log(`  ✗ ${name}`); log(`      ${e.message}`); }
})();

await (async () => {
    const name = 'Auto does not redo work the ledger shows is already applied';
    try {
        const { prompts } = await runCapture({
            style: 'vlog', transcript: true, captionClips: true,
            ops: ['silence_removal', 'enhance_audio', 'auto_captions'],
        });
        assert.ok(!prompts.some(p => /^Remove silences$/i.test(p)),
            `silence removal was re-run: ${JSON.stringify(prompts)}`);
        assert.ok(!prompts.some(p => /^Enhance the audio$/i.test(p)),
            `audio enhance was re-run: ${JSON.stringify(prompts)}`);
        passed++; log(`  ✓ ${name}`);
    } catch (e) { failed++; log(`  ✗ ${name}`); log(`      ${e.message}`); }
})();

await (async () => {
    const name = 'an all-already-done playbook reports a no-op, not a failure';
    try {
        setStore({
            style: 'vlog', transcript: true, captionClips: true,
            ops: ['silence_removal', 'enhance_audio', 'auto_captions', 'apply_style_recipe'],
        });
        const res = await runAutopilot('edit it', {
            styleId: 'vlog',
            run: async () => ({ success: true, message: 'ok' }),
        });
        // Either it genuinely had nothing left (success + "already applied"),
        // or it still found work. Both are fine; claiming failure is not.
        if (/could not apply anything/i.test(res.message)) {
            assert.fail(`reported failure for an already-complete project: ${res.message}`);
        }
        assert.equal(res.success, true, res.message);
        passed++; log(`  ✓ ${name}`);
    } catch (e) { failed++; log(`  ✗ ${name}`); log(`      ${e.message}`); }
})();

await (async () => {
    const name = 'Auto still runs the full playbook when nothing can be skipped';
    try {
        const { prompts } = await runCapture({ style: 'vlog', transcript: true });
        for (const expected of [/Remove silences/i, /Enhance the audio/i, /style recipe/i]) {
            assert.ok(prompts.some(p => expected.test(p)),
                `${expected} missing from ${JSON.stringify(prompts)}`);
        }
        passed++; log(`  ✓ ${name}`);
    } catch (e) { failed++; log(`  ✗ ${name}`); log(`      ${e.message}`); }
})();

await (async () => {
    const name = 'a policy fault falls back to the raw playbook instead of blocking Auto';
    try {
        const src = readFileSync(
            new URL('../client/src/agent/StyleAutopilot.js', import.meta.url), 'utf8');
        assert.ok(/catch \(err\) \{[\s\S]{0,400}steps = originalSteps;/.test(src),
            'StyleAutopilot must restore the original playbook on a planning error');
        assert.ok(/if \(steps\.length === 0\) steps = originalSteps;/.test(src),
            'an empty refinement must fall back to the playbook');
        assert.ok(/respectStyle: false/.test(src),
            'Auto must not let the policy veto a playbook step on style grounds');
        passed++; log(`  ✓ ${name}`);
    } catch (e) { failed++; log(`  ✗ ${name}`); log(`      ${e.message}`); }
})();

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
log('ALL EDIT POLICY TESTS PASSED');
