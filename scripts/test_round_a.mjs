// scripts/test_round_a.mjs
//
// R92 round A: command wiring and sound effects.
//   1. "remove repetitions" in every phrasing reaches the real retake detector
//   2. "clean up" = silences + filler words + repetition + voice enhancement (no zoom)
//   3. Auto mode: a specific command ("animate") runs alone
//   4. Sound effects: cues, levels per style, "add sound effects" / "add a whoosh",
//      recipes and animate respect the level
//   5. Server: enhance route + worker chain, style SFX level
import { register, createRequire } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' });
const log = console.log; console.log = () => {}; console.warn = () => {}; console.info = () => {}; console.error = () => {};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const require = createRequire(import.meta.url);
let failures = 0;
async function check(name, fn) {
    try { await fn(); log(`✓ ${name}`); }
    catch (err) { failures += 1; log(`✗ ${name}\n    ${err.message}`); }
}

const { default: S } = await import('../client/src/store/useTimelineStore.js');
const { IntentParser } = await import('../client/src/agent/IntentParser.js');
const { EditPlanner } = await import('../client/src/agent/EditPlanner.js');
const R = await import('../client/src/agent/CommandRegistry.js');
const ES = await import('../client/src/agent/EditingStyles.js');
const X = await import('../client/src/agent/sfxCues.js');
const CC = await import('../client/src/agent/CommandCompiler.js');

const tm = globalThis.timelineManager;
function loadTracks(list, extra = {}) {
    tm.fromLegacyTracks(JSON.parse(JSON.stringify(list)));
    S.setState({ tracks: tm.toLegacyTracks(), past: [], future: [], selectedClipIds: [], editingStyle: null, currentTime: 0,
        uploadedFile: { name: 'IMG.MOV' }, assets: [{ id: 'a', type: 'video', name: 'IMG.MOV', duration: 60 }], captions: [], ...extra });
}
loadTracks([{ id: 'track-default-video', type: 'video', name: 'V', clips: [{ id: 'v1', assetId: 'a', type: 'video', name: 'IMG.MOV', start: 0, duration: 60, offset: 0, speed: 1 }] }]);
const plan = async (text) => {
    const intent = await IntentParser.parse(text);
    const p = await EditPlanner.generatePlan(intent);
    return { op: intent.operation, steps: p.plan?.steps || [], intent };
};

// ── 1. Repetition ────────────────────────────────────────────────────────────
log('\n1 · Remove repetitions');
for (const t of ['remove repetitions', 'remove the repetitions', 'cut repetitions', 'remove repeats', 'remove retakes',
    'remove false starts', 'clean up repetitions', 'remove repetition', 'supprime les répétitions']) {
    await check(`"${t}" → retake detector`, async () => {
        const r = await plan(t);
        assert.equal(r.op, 'remove_repetition');
        assert.deepEqual(r.steps.map(s => s.action), ['remove_repeated_takes']);
    });
}
await check('a legacy remove_repetition step (server plans) compiles to the real detector', () => {
    const fn = CC.compileStep || CC.default?.compileStep;
    const out = fn ? fn({ step_id: 's1', action: 'remove_repetition' }, {}) : null;
    if (out) {
        const cmds = out.commands || out.value || [];
        assert.ok(JSON.stringify(cmds).includes('/api/ai/detect-repeated-takes'), JSON.stringify(out).slice(0, 200));
    } else {
        assert.match(read('client/src/agent/CommandCompiler.js'), /\['remove_repetition', \{ compiler: compileRemoveRepeatedTakes \}\]/);
    }
});

// ── 2. Clean up ──────────────────────────────────────────────────────────────
log('\n2 · Clean up');
for (const t of ['clean up', 'clean it up', 'clean up the video', 'clean my video', 'full cleanup', 'clean and polish']) {
    await check(`"${t}" → silences, fillers, repetition, then voice enhancement (no zoom)`, async () => {
        const r = await plan(t);
        assert.equal(r.op, 'long_form_edit', `op ${r.op}`);
        const acts = r.steps.map(s => s.action);
        assert.ok(acts.includes('silence_removal') && acts.includes('remove_filler_words') && acts.includes('remove_repeated_takes'), acts.join(','));
        assert.equal(acts[acts.length - 1], 'enhance_audio', 'voice enhancement runs last, after every cut');
        assert.equal(r.steps[r.steps.length - 1].optional, true);
        assert.ok(!acts.includes('rhythm_zoom') && !acts.includes('auto_captions'), 'nothing beyond the four');
    });
}
await check('"remove silences and filler words" stays exactly those two (no enhancement)', async () => {
    const r = await plan('remove silences and filler words');
    const acts = r.steps.map(s => s.action);
    assert.ok(acts.includes('silence_removal') && acts.includes('remove_filler_words'));
    assert.ok(!acts.includes('enhance_audio') && !acts.includes('remove_repeated_takes'), acts.join(','));
});
await check('"clean it up and make it dynamic" still adds the zoom rhythm (asked for)', async () => {
    const r = await plan('clean it up and make it dynamic');
    assert.equal(r.op, 'compound_clean_dynamic');
});
for (const t of ['enhance the audio', 'improve the audio', 'clean up the audio', 'make the voice clearer', 'améliore le son']) {
    await check(`"${t}" → enhance_audio`, async () => {
        const r = await plan(t);
        assert.equal(r.op, 'enhance_audio');
        assert.deepEqual(r.steps.map(s => s.action), ['enhance_audio']);
    });
}
await check('"remove background noise" is still plain denoise', async () => {
    assert.equal((await plan('remove background noise')).op, 'denoise_audio');
});
await check('enhance compiles to one API call (not denoise then normalize from the original file)', () => {
    const src = read('client/src/agent/CommandCompiler.js');
    assert.match(src, /cmd\(ENGINE\.API, 'audioEnhance', \{\s*endpoint: '\/api\/audio\/enhance'/);
    assert.match(read('client/src/agent/MediaExecutionEngine.js'), /command\.action === 'audioEnhance'\) && result\?\.url/);
    assert.match(read('client/src/agent/MediaExecutionEngine.js'), /if \(command\.args\?\.optional\) \{\s*console\.warn\(`\[MediaExecutionEngine\] optional step skipped/);
});

// ── 3. Auto mode ─────────────────────────────────────────────────────────────
log('\n3 · Auto mode');
await check('"animate" in Auto mode runs only the animation, for every style', () => {
    for (const id of ES.EDITING_STYLE_IDS) {
        assert.deepEqual(ES.buildAutopilotSteps(id, 'animate it', {}).map(s => s.prompt), ['animate it'], id);
    }
});
await check('Auto playbooks: animation only for Reel, Vlog and Talking head; calm styles none', () => {
    const has = id => ES.buildAutopilotSteps(id, 'edit it', { hasTranscript: true }).some(s => s.key === 'animate' || s.key === 'finish');
    assert.ok(has('reel') && has('vlog') && has('talking_head'));
    assert.ok(!has('podcast') && !has('interview'));
});
await check('Auto mode takes the AI retake picks instead of waiting on a dialog', () => {
    assert.match(read('client/src/agent/MediaExecutionEngine.js'), /isAutopilotRunning\(\) \? true : await this\._reviewRetakes/);
});

// ── 4. Sound effects ─────────────────────────────────────────────────────────
log('\n4 · Sound effects');
await check('levels: Reel/Vlog full, Talking head soft, Podcast/Interview none; recipe when no style', () => {
    assert.equal(X.sfxLevel('reel'), 'full');
    assert.equal(X.sfxLevel('vlog'), 'full');
    assert.equal(X.sfxLevel('talking_head'), 'subtle');
    assert.equal(X.sfxLevel('podcast'), 'none');
    assert.equal(X.sfxLevel('interview'), 'none');
    assert.equal(X.sfxLevel(null, 'podcast'), 'none');
    assert.equal(X.sfxLevel(null, 'explainer'), 'subtle');
    assert.equal(X.sfxLevel(null, null), 'full');
    assert.equal(X.sfxVolume(0.8, 'subtle'), 0.36);
    assert.equal(X.sfxVolume(undefined, 'full'), 0.8);
});
const sfxTracks = [
    { id: 'v', type: 'video', clips: [
        { id: 'c1', start: 0, duration: 4, transition: { type: 'whip', duration: 0.3 } },
        { id: 'c2', start: 4, duration: 4.2 },
        { id: 'c3', start: 8.2, duration: 3, transition: { type: 'flash' } },
    ] },
    { id: 'o', type: 'overlay', clips: [
        { id: 'p1', type: 'template', start: 6, duration: 1.6 },
        { id: 'p2', type: 'template', start: 6.2, duration: 1.6 },
        { id: 'img', type: 'image', start: 2, duration: 2 },
    ] },
    { id: 't', type: 'text', clips: [{ id: 'title', start: 1, duration: 3, animations: [{ presetId: 'composed:slam-in', startTime: 0, duration: 0.5 }] }] },
];
await check('cues: whoosh before each transition, pop on templates, impact on a slam; spaced', () => {
    const cues = X.collectSfxCues(sfxTracks, { level: 'full' });
    assert.deepEqual(cues.map(c => c.kind), ['impact', 'whoosh', 'pop', 'whoosh']);
    assert.ok(Math.abs(cues[1].t - (4 - 0.18)) < 1e-6, 'whoosh leads the cut');
    const soft = X.collectSfxCues(sfxTracks, { level: 'subtle' });
    assert.ok(!soft.some(c => c.kind === 'impact'), 'no impacts when soft');
    assert.deepEqual(X.collectSfxCues(sfxTracks, { level: 'none' }), []);
});
await check('named sounds vs "sound effects" in general', () => {
    assert.equal(X.sfxQueryFromText('add a whoosh'), 'whoosh');
    assert.equal(X.sfxQueryFromText('put a pop sound here'), 'pop');
    assert.equal(X.sfxQueryFromText('add sound effects'), null);
});
for (const [t, step] of [['add sound effects', 'auto_sfx'], ['add some sound effects', 'auto_sfx'], ['ajoute des effets sonores', 'auto_sfx'], ['add a whoosh', 'place_sfx'], ['add a ding', 'place_sfx']]) {
    await check(`"${t}" → ${step}`, async () => {
        const r = await plan(t);
        assert.equal(r.op, 'add_sfx');
        assert.deepEqual(r.steps.map(s => s.action), [step]);
    });
}

const { MediaExecutionEngine } = await import('../client/src/agent/MediaExecutionEngine.js');
const engine = new MediaExecutionEngine();
const LIB = { results: [{ asset: { id: 'sfx1', name: 'Whoosh 1', preview_url: 'https://cdn.example/whoosh.mp3', duration: 0.8, recommended_volume: 0.7 } }] };
function withLibrary(fn) {
    return async () => {
        const real = globalThis.fetch;
        globalThis.fetch = async (url) => (String(url).includes('/api/audio/search')
            ? { ok: true, status: 200, json: async () => LIB, text: async () => '' }
            : { ok: false, status: 503, json: async () => ({}), text: async () => '' });
        try { await fn(); } finally { globalThis.fetch = real; }
    };
}
const sfxClips = () => (S.getState().tracks.find(t => t.type === 'audio' && t.name === 'SFX')?.clips || []);
await check('"add sound effects" places cues on the SFX track, as one undo; a re-run replaces them', withLibrary(async () => {
    loadTracks(sfxTracks.map(t => ({ ...t, name: t.id })), { editingStyle: 'reel' });
    const before = S.getState().past.length;
    const r = await engine.executeStoreAction({ action: 'auto_sfx', args: {} }, null);
    assert.equal(r.success, true, r.message);
    assert.equal(sfxClips().length, 4);
    assert.ok(S.getState().past.length > before);
    await engine.executeStoreAction({ action: 'auto_sfx', args: {} }, null);
    assert.equal(sfxClips().length, 4, 'replaced, not stacked');
    S.getState().undo();
    assert.equal(sfxClips().length, 4, 'one undo goes back to the first run');
    S.getState().undo();
    assert.equal(sfxClips().length, 0, 'one more undo removes every sound');
}));
await check('Talking head: soft volume, no impact; Podcast: nothing added', withLibrary(async () => {
    loadTracks(sfxTracks.map(t => ({ ...t, name: t.id })), { editingStyle: 'talking_head' });
    await engine.executeStoreAction({ action: 'auto_sfx', args: {} }, null);
    assert.equal(sfxClips().length, 3);
    assert.ok(sfxClips().every(c => c.volume <= 0.32 + 1e-9), sfxClips().map(c => c.volume).join(','));
    loadTracks(sfxTracks.map(t => ({ ...t, name: t.id })), { editingStyle: 'podcast' });
    const r = await engine.executeStoreAction({ action: 'auto_sfx', args: {} }, null);
    assert.equal(r.success, true);
    assert.equal(sfxClips().length, 0);
}));
await check('"add a whoosh" places one sound at the playhead', withLibrary(async () => {
    loadTracks(sfxTracks.map(t => ({ ...t, name: t.id })), { currentTime: 3.5 });
    const r = await engine.executeStoreAction({ action: 'place_sfx', args: { query: 'whoosh' } }, null);
    assert.equal(r.success, true, r.message);
    assert.equal(sfxClips().length, 1);
    assert.equal(sfxClips()[0].start, 3.5);
}));
await check('no library match → honest failure, nothing added', async () => {
    loadTracks(sfxTracks.map(t => ({ ...t, name: t.id })));
    const r = await engine.executeStoreAction({ action: 'place_sfx', args: { query: 'whoosh' } }, null);
    assert.equal(r.success, false);
    assert.equal(sfxClips().length, 0);
});
await check('style recipes and "animate" follow the same level', () => {
    const mee = read('client/src/agent/MediaExecutionEngine.js');
    assert.match(mee, /const lvl = sfxLevel\(useTimelineStore\.getState\(\)\.editingStyle, recipe\.id\)/);
    assert.match(mee, /const aaSfxLevel = sfxLevel\(aaStore\.editingStyle\)/);
    assert.match(mee, /volume:\s+sfxVolume\(topSfx\.recommended_volume, aaSfxLevel\)/);
    assert.doesNotMatch(mee, /zero manual picks/, 'no em dash in that user message');
});

// ── 5. Server ────────────────────────────────────────────────────────────────
log('\n5 · Server');
const ESrv = require(path.join(ROOT, 'server/brain/editingStyles.js'));
await check('server style SFX level matches the client', () => {
    for (const id of [...ESrv.EDITING_STYLE_IDS, null]) assert.equal(ESrv.sfxLevel(id), X.sfxLevel(id), String(id));
});
await check('animate route: soft styles drop impact and zoom-punch sounds', () => {
    const src = read('server/routes/audioEngineRoutes.js');
    assert.match(src, /const soft = sfxLevel\(/);
    assert.match(src, /filter\(i => !\(soft && HARD_INTENTS\.has\(String\(i\)\)\)\)/);
});
await check('POST /api/audio/enhance queues the "enhance" action', () => {
    const src = read('routes/audioRoutes.js');
    assert.match(src, /router\.post\('\/enhance', optionalAuth/);
    assert.match(src, /action: 'enhance'/);
    assert.match(read('jobs/audioProcessor.js'), /case 'enhance': \{[\s\S]{0,600}audioFilters\(ENHANCE_VOICE_FILTERS\)/);
});
let hasFfmpeg = false;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); hasFfmpeg = true; } catch { /* optional */ }
await check('the enhancement chain runs in ffmpeg and lands near -16 LUFS', () => {
    if (!hasFfmpeg) { log('    (skipped: ffmpeg not installed here)'); return; }
    const m = read('jobs/audioProcessor.js').match(/const ENHANCE_VOICE_FILTERS = \[([\s\S]*?)\];/);
    const chain = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]).join(',');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r92a-'));
    const src = path.join(tmp, 'in.wav'), out = path.join(tmp, 'out.wav');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=f=220:d=4', '-f', 'lavfi', '-i', 'anoisesrc=d=4:a=0.02', '-filter_complex', 'amix=inputs=2,volume=0.2', src]);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-af', chain, out]);
    const all = execFileSync('sh', ['-c', `ffmpeg -hide_banner -nostats -i "${out}" -af ebur128 -f null - 2>&1 | tail -12`]).toString();
    const lufs = Number((all.match(/I:\s+(-?\d+\.\d) LUFS/g) || []).pop()?.match(/-?\d+\.\d/)[0]);
    assert.ok(Number.isFinite(lufs) && lufs > -19 && lufs < -13, `integrated ${lufs} LUFS`);
    fs.rmSync(tmp, { recursive: true, force: true });
});

log(failures ? `\n${failures} FAILURE(S)` : '\nALL ROUND A CHECKS PASSED');
process.exit(failures ? 1 : 0);
