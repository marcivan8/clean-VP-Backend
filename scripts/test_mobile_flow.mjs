// scripts/test_mobile_flow.mjs
//
// R145 — the guided mobile flow: many assets in, one question, then the edit
// narrated while it runs.
//
// Two things these protect.
//
// The handoff is a LIST now. A short is usually several clips and a couple of
// stills, and the old path carried exactly one File from the dashboard to the
// editor — the second thing you picked was silently dropped. Dropping media a
// user chose is the kind of bug nobody reports; they just think it is broken.
//
// The flow must open ONLY on a phone arriving with fresh media. Opening it on
// an existing project would put a "what are you making?" sheet in front of
// work someone already did.
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.innerWidth = 390;

const realLog = console.log;
console.log = () => {}; console.warn = () => {}; console.error = () => {};

let n = 0;
const check = (name, fn) => { fn(); n++; realLog(`  ok  ${name}`); };

realLog('\nmobile flow\n');

// ── the handoff carries everything ───────────────────────────────────────────
const pnv = await import('../client/src/utils/pendingNewVideo.js');

check('several files survive the dashboard to editor hop', () => {
    const files = [{ name: 'a.mp4' }, { name: 'b.mp4' }, { name: 'c.jpg' }];
    pnv.setPendingNewVideo('p1', files);
    assert.deepEqual(pnv.takePendingNewVideoFiles('p1'), files);
});

check('the files are handed over exactly once', () => {
    pnv.setPendingNewVideo('p2', [{ name: 'a.mp4' }]);
    assert.equal(pnv.takePendingNewVideoFiles('p2').length, 1);
    assert.deepEqual(pnv.takePendingNewVideoFiles('p2'), [], 'a second take must be empty');
});

check('one file still works, as a list of one', () => {
    pnv.setPendingNewVideo('p3', { name: 'solo.mp4' });
    assert.deepEqual(pnv.takePendingNewVideoFiles('p3'), [{ name: 'solo.mp4' }]);
});

check('a FileList-shaped object is accepted', () => {
    const fileList = { 0: { name: 'x.mp4' }, 1: { name: 'y.mp4' }, length: 2 };
    pnv.setPendingNewVideo('p4', fileList);
    assert.equal(pnv.takePendingNewVideoFiles('p4').length, 2);
});

check('nothing in means nothing out, and no throw', () => {
    pnv.setPendingNewVideo('p5', []);
    pnv.setPendingNewVideo('p5', null);
    pnv.setPendingNewVideo(null, [{ name: 'a' }]);
    assert.deepEqual(pnv.takePendingNewVideoFiles('p5'), []);
    assert.deepEqual(pnv.takePendingNewVideoFiles(null), []);
});

check('takePendingNewVideo still returns a single file for old callers', () => {
    pnv.setPendingNewVideo('p6', [{ name: 'first.mp4' }, { name: 'second.mp4' }]);
    assert.deepEqual(pnv.takePendingNewVideo('p6'), { name: 'first.mp4' });
});

// ── the pieces that feed it ──────────────────────────────────────────────────
const home = read('client/src/components/MobileHome.jsx');
const dash = read('client/src/pages/DashboardPage.jsx');
const ide  = read('client/src/layouts/IDELayout.jsx');

check('the library picker takes many files and accepts stills', () => {
    assert.ok(/multiple=\{!capture\}/.test(home), 'the picker must be multi-select');
    assert.ok(/accept="video\/\*,image\/\*"/.test(home), 'photos belong in a short too');
});

check('the camera stays single — a take is one take', () => {
    assert.ok(/multiple=\{!capture\}/.test(home),
        'multiple must be suppressed when capture is set, or the camera row lies about what it does');
});

check('the dashboard hands the whole selection to the named draft project', () => {
    assert.ok(/const draft = draftVideoProject/.test(dash), 'selected media reuses the project created by the naming step');
    assert.ok(/setPendingNewVideo\(draft\.id, files\)/.test(dash));
    assert.ok(/setDraftVideoProject\(\{ id, name, skeleton \}\)/.test(dash), 'mobile project creation retains its ID and name for media selection');
    assert.ok(/Array\.isArray\(picked\)/.test(dash), 'a single file must still be accepted');
});

check('the editor imports every file it was handed', () => {
    assert.ok(/takePendingNewVideoFiles\(projectId\)/.test(ide));
    assert.ok(/handleFileImport\(\{ target: \{ files \} \}\)/.test(ide),
        'the whole list goes to the importer, not files[0]');
});

check('the flow opens only on a phone, and only with fresh media', () => {
    const effect = ide.slice(ide.indexOf('takePendingNewVideoFiles(projectId)'));
    const body = effect.slice(0, effect.indexOf('}, [projectId, sessionChecked]'));
    assert.ok(/if \(!files\.length\) return;/.test(body), 'no media means no flow');
    assert.ok(/if \(isMobile\) useMobileFlowStore/.test(body), 'desktop must never see the flow');
});

check('the flow is mounted in the mobile tree', () => {
    // props change; being mounted behind isMobile is the invariant
    assert.ok(/\{isMobile && <MobileFlow[\s/>]/.test(ide));
});

// ── the flow's own state ─────────────────────────────────────────────────────
const { default: useMobileFlowStore } = await import('../client/src/store/useMobileFlowStore.js');
const F = () => useMobileFlowStore.getState();

check('it draws nothing until it is opened', () => {
    assert.equal(F().active, false);
});

check('opening starts at the question', () => {
    F().open();
    assert.equal(F().active, true);
    assert.equal(F().step, 'outcome');
    assert.equal(F().outcomeId, null);
});

check('choosing an outcome moves to the edit', () => {
    F().choose('reel');
    assert.equal(F().step, 'working');
    assert.equal(F().outcomeId, 'reel');
});

check('a failure before anything exists returns to the question', () => {
    F().open();                       // open() clears outcomeId: nothing made yet
    F().failed('No transcript yet.');
    assert.equal(F().step, 'outcome');
    assert.equal(F().error, 'No transcript yet.');
    assert.equal(F().active, true, 'a failure must not silently close the flow');
});

check('a failure AFTER a short exists returns to that short, not to an empty editor', () => {
    F().open();
    F().choose('reel');
    F().finished();
    F().failed('That change did not work.');
    assert.equal(F().step, 'result', 'the user still has a short; show it');
    assert.equal(F().error, 'That change did not work.');
    F().close();
});

check('a finished run lands on the result instead of vanishing', () => {
    F().open();
    F().choose('vlog');
    F().finished();
    assert.equal(F().step, 'result');
    assert.equal(F().active, true, 'the flow must not close itself and strand the user in the editor');
});

check('the result leads to a change and back', () => {
    F().toChange();
    assert.equal(F().step, 'change');
    F().toResult();
    assert.equal(F().step, 'result');
    assert.equal(F().error, null);
    F().close();
});

check('skip leaves the flow and clears the error', () => {
    F().close();
    assert.equal(F().active, false);
    assert.equal(F().error, null);
});

check('a typed request is carried with the choice', () => {
    F().open();
    F().choose('talking_head', 'keep only the pricing part');
    assert.equal(F().request, 'keep only the pricing part');
    F().close();
});

// ── the working screen reads the real steps ──────────────────────────────────
const flow = read('client/src/components/MobileFlow.jsx');

check('the working screen is driven by the engine, not by a timer', () => {
    assert.ok(/useEditStepsStore/.test(flow), 'the steps must come from the engine');
    assert.ok(!/setInterval|setTimeout\(\s*\(\)\s*=>\s*set/.test(flow.replace(/setTimeout\(close/, '')),
        'no faked progress');
});

check("each finished step shows the sentence the handler reported", () => {
    assert.ok(/\{s\.message && s\.state !== 'running'/.test(flow),
        'the numbers come from the message, and only once the step is done');
});

check('the step list is announced to a screen reader', () => {
    assert.ok(/aria-live="polite"/.test(flow));
});

check('the user can always leave, running or not', () => {
    assert.ok(/mobileFlow\.editWhileWaiting/.test(flow));
    assert.ok(/mobileFlow\.skip/.test(flow));
});


// ── the result and change screens ────────────────────────────────────────────

check('the flow sits BELOW the sheets that open on top of it', () => {
    const z = flow.match(/const Z = (\d+);/);
    assert.ok(z, 'the flow must state its stacking explicitly');
    const sheetZ = read('client/src/components/MobileSheet.jsx').match(/zIndex: (\d+)/);
    assert.ok(sheetZ, 'MobileSheet must state one too');
    assert.ok(Number(z[1]) < Number(sheetZ[1]),
        'the plan-first approval and the export sheet are MobileSheets: hiding an Apply button behind the flow would strand a run');
});

check('a change goes through the normal pipeline, approval gate and all', () => {
    assert.ok(/editJobManager\.processEditRequest\(text\)/.test(flow));
    assert.ok(!/processEditRequest\([^)]*autoApprove/.test(flow),
        'plan-first was a deliberate decision (planFirst.js); the flow does not get to skip it');
});

check('every change chip has copy in both languages', () => {
    const ids = [...flow.matchAll(/\{ id: '([a-z]+)', prompt:/g)].map(m => m[1]);
    assert.ok(ids.length >= 6, 'expected the six plain-language changes');
    for (const lang of ['en', 'fr']) {
        const dict = JSON.parse(read(`client/src/locales/${lang}/editor.json`)).mobileFlow;
        for (const id of ids) {
            assert.ok(dict.changes?.[id], `${lang} is missing mobileFlow.changes.${id}`);
        }
    }
});

check('the result offers all three ways out', () => {
    for (const key of ['mobileFlow.share', 'mobileFlow.change', 'mobileFlow.byHand']) {
        assert.ok(flow.includes(key), `the result screen must offer ${key}`);
    }
});

check('Share opens the export sheet the app already has', () => {
    assert.ok(/<MobileFlow onShare=\{\(\) => setShowMobileExport\(true\)\} \/>/.test(ide),
        'sharing must reuse MobileExportSheet, not a second export path');
});

check('the result does not rebuild the player', () => {
    assert.ok(!/<Player/.test(flow),
        "the editor's preview is already behind the sheet; a second player means duplicating its derived project");
});

check('the typed request cannot submit empty', () => {
    assert.ok(/disabled=\{!typed\.trim\(\)\}/.test(flow));
    assert.ok(/if \(!text\) return;/.test(flow));
});

check('every mobileFlow string used in the component exists in both locales', () => {
    const used = [...flow.matchAll(/t\('mobileFlow\.([a-zA-Z.]+)'/g)].map(m => m[1])
        .filter(k => !k.startsWith('outcome.') && !k.startsWith('changes.'));
    // i18next resolves a counted string through _one/_other suffixes (this
    // repo's convention: projectsBody_one, applied_other), so the bare key is
    // not what lands in the file.
    const resolves = (dict, k) => {
        const get = (key) => key.split('.').reduce((o, part) => o?.[part], dict);
        return [k, `${k}_one`, `${k}_other`, `${k}_zero`, `${k}_many`].some(x => get(x) !== undefined);
    };
    for (const lang of ['en', 'fr']) {
        const dict = JSON.parse(read(`client/src/locales/${lang}/editor.json`)).mobileFlow;
        for (const k of used) {
            assert.ok(resolves(dict, k), `${lang} is missing mobileFlow.${k}`);
        }
    }
});

check('a counted string carries both plural forms in both languages', () => {
    for (const lang of ['en', 'fr']) {
        const dict = JSON.parse(read(`client/src/locales/${lang}/editor.json`)).mobileFlow;
        assert.ok(dict.versionsCount_one && dict.versionsCount_other,
            `${lang} needs both forms, or "1 versions" ships`);
    }
});


// ── versions ─────────────────────────────────────────────────────────────────

const { default: useVersionsStore } = await import('../client/src/agent/projectVersions.js');
const V = () => useVersionsStore.getState();

check('a version is recorded with the words that produced it', () => {
    V().clear();
    const v = V().capture('Talking head');
    assert.equal(V().versions.length, 1);
    assert.equal(V().versions[0].label, 'Talking head');
    assert.equal(V().currentId, v.id, 'the one just made is the current one');
});

check('the newest is first, so the list reads top down', () => {
    V().capture('Shorter');
    V().capture('Bigger captions');
    assert.deepEqual(V().versions.map(v => v.label), ['Bigger captions', 'Shorter', 'Talking head']);
});

check('a blank label never reaches the screen', () => {
    V().clear();
    assert.equal(V().capture('   ').label, 'Edit');
    assert.equal(V().capture(null).label, 'Edit');
});

check('the list is capped, oldest dropped', () => {
    V().clear();
    for (let i = 0; i < 20; i++) V().capture(`v${i}`);
    assert.equal(V().versions.length, 12);
    assert.equal(V().versions[0].label, 'v19', 'the newest survives');
    assert.ok(!V().versions.some(v => v.label === 'v0'), 'the oldest is gone');
});

check('restoring an unknown version changes nothing and says so', () => {
    assert.equal(V().restore('nope'), false);
});

check('a new project starts with no history of its own', () => {
    V().clear();
    assert.deepEqual(V().versions, []);
    assert.equal(V().currentId, null);
});

check('versions are NOT built on the API that emits into the void', () => {
    const src = read('client/src/agent/projectVersions.js');
    // Comments explaining the decision mention those names on purpose; what
    // must not appear is a CALL to them.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/\.loadVersion\(|\.listVersions\(|\.createVersion\(/.test(code),
        'TimelineHistory.loadVersion updates its own copy and nothing listens to VERSION_LOADED, so a restore built on it would not change what the user sees');
    assert.ok(/_timelineState/.test(code) && /LOAD_STATE/.test(code),
        "restore must use the snapshot shape the store's own undo round-trips");
});

check('the dead version API really is dead — if that changes, revisit this', () => {
    // The moment something listens to VERSION_LOADED, TimelineHistory becomes a
    // real option and this module is worth reconsidering.
    const listeners = ['client/src/store/useTimelineStore.js', 'client/src/layouts/IDELayout.jsx']
        .map(f => read(f)).join('\n');
    assert.ok(!/VERSION_LOADED/.test(listeners),
        'something now listens to VERSION_LOADED: the two history systems can disagree, pick one');
});

check('going back is undoable, not a trapdoor', () => {
    const src = read('client/src/agent/projectVersions.js');
    const restore = src.slice(src.indexOf('restore: (id)'));
    assert.ok(/saveToHistory\(\)/.test(restore.slice(0, restore.indexOf('set({ currentId'))),
        'the state being left must go on the undo stack before it is replaced');
});

check('every finished run records a version', () => {
    const caps = flow.match(/useVersionsStore\.getState\(\)\.capture\(/g) || [];
    assert.equal(caps.length, 2, 'the first run and every change');
});

check('the way into versions only appears once there is a choice to make', () => {
    assert.ok(/versionCount > 1 &&/.test(flow),
        'one version is not a history worth showing');
});


// ── going back actually goes back ────────────────────────────────────────────
//
// Everything above this point checks the SHAPE of the code. These run it: a
// version that records the wrong state, or a restore that updates one store and
// not the other, would pass every source assertion and still do nothing on
// screen. That is the failure mode worth paying for a real run to catch.

const { timelineManager, ACTION_TYPES } = await import('../client/src/timeline/TimelineStateManager.js');
const { default: useTimelineStore } = await import('../client/src/store/useTimelineStore.js');
const layerCount = () => timelineManager.toLegacyTracks().length;
const addLayer = (name) => {
    timelineManager.dispatch({ type: ACTION_TYPES.LAYER_ADD, payload: { layer: { type: 'video', name } } });
    useTimelineStore.setState({ tracks: timelineManager.toLegacyTracks() });
};

check('going back really puts the timeline back', () => {
    V().clear();
    const before = layerCount();
    const v1 = V().capture('First edit');

    addLayer('added after the capture');
    assert.equal(layerCount(), before + 1, 'premise: the timeline changed');

    assert.equal(V().restore(v1.id), true);
    assert.equal(layerCount(), before, 'the timeline did not come back');
    assert.equal(useTimelineStore.getState().tracks.length, before,
        'the engine went back but the store the UI reads did not: the screen would still show the newer edit');
});

check('the snapshot is not a live reference to the state it was taken from', () => {
    V().clear();
    const v = V().capture('Pinned');
    const at = layerCount();
    addLayer('later');
    addLayer('later again');
    // if capture() had aliased the manager's state, these would have leaked in
    assert.equal(Object.keys(v.snap._timelineState.entities.layers).length, at,
        'the captured state moved with the project, so going back would restore the present');
    V().restore(v.id);
    assert.equal(layerCount(), at);
});

check('with several versions, it goes back to the one asked for', () => {
    V().clear();
    const base = layerCount();
    const v1 = V().capture('one');
    addLayer('a');
    const v2 = V().capture('two');
    addLayer('b');
    V().capture('three');
    assert.equal(layerCount(), base + 2);

    V().restore(v2.id);
    assert.equal(layerCount(), base + 1, 'restored the wrong version');
    V().restore(v1.id);
    assert.equal(layerCount(), base, 'restored the wrong version');
});

check('undo after going back returns to where you were', () => {
    V().clear();
    const base = layerCount();
    const v1 = V().capture('start');
    addLayer('work in progress');
    const after = layerCount();

    V().restore(v1.id);
    assert.equal(layerCount(), base);

    useTimelineStore.getState().undo();
    assert.equal(layerCount(), after,
        'going back must be an ordinary undoable step, not a one-way door');
});

check('restoring marks that version as the current one', () => {
    V().clear();
    const v1 = V().capture('one');
    addLayer('a');
    V().capture('two');
    V().restore(v1.id);
    assert.equal(V().currentId, v1.id, 'the list would show the wrong NOW badge');
});

/* ── R148: out of free Auto edits ─────────────────────────────────────────── */

realLog('\n  out of free Auto edits\n');

const FLOW = (await import('../client/src/store/useMobileFlowStore.js')).default;

check('a quota refusal becomes a step of the flow, not a modal over it', () => {
    FLOW.getState().open();
    FLOW.getState().choose('reel');
    assert.equal(FLOW.getState().step, 'working');
    FLOW.getState().limited({ reason: 'auto_trial', message: 'spent', upgradeRequired: 'creator' });
    assert.equal(FLOW.getState().step, 'limit');
    assert.equal(FLOW.getState().limitInfo.reason, 'auto_trial');
    assert.equal(FLOW.getState().limitInfo.upgradeRequired, 'creator');
});

check('a refusal with no detail still lands somewhere actionable', () => {
    FLOW.getState().open();
    FLOW.getState().limited({});
    assert.equal(FLOW.getState().step, 'limit');
    assert.equal(FLOW.getState().limitInfo.reason, 'ai_ops');
    assert.equal(FLOW.getState().limitInfo.upgradeRequired, 'creator');
});

check('the generic failure that follows a 402 cannot overwrite the quota message', () => {
    // The same refusal surfaces twice: once on the QUOTA_EXCEEDED channel and
    // again as a thrown error further down the pipeline. If the second one won,
    // a user who is out of edits would read "Something went wrong."
    FLOW.getState().open();
    FLOW.getState().choose('reel');
    FLOW.getState().limited({ reason: 'auto_trial' });
    FLOW.getState().failed('Something went wrong.');
    assert.equal(FLOW.getState().step, 'limit', 'the quota step must survive');
    assert.equal(FLOW.getState().error, null, 'and must not pick up a generic error string');
});

check('a normal failure still routes as it did', () => {
    FLOW.getState().open();
    FLOW.getState().choose('reel');
    FLOW.getState().failed('nope');
    assert.equal(FLOW.getState().step, 'result');
    assert.equal(FLOW.getState().error, 'nope');
});

check('opening a new flow clears a previous refusal', () => {
    FLOW.getState().limited({ reason: 'auto_trial' });
    FLOW.getState().open();
    assert.equal(FLOW.getState().limitInfo, null);
    assert.equal(FLOW.getState().step, 'outcome');
});

check('the flow renders the limit step and listens on the shared quota channel', () => {
    const src = read('client/src/components/MobileFlow.jsx');
    assert.match(src, /step === 'limit'/, 'the step must be routed or it can never show');
    assert.match(src, /EVENT_TYPES\.QUOTA_EXCEEDED/, 'it listens on the shared channel rather than a second one');
    // Reuse, not a rebuild: PlanSheet already carries the real checkout.
    assert.match(src, /<PlanSheet/, 'the existing plan sheet is reused');
    assert.ok(!/checkout\/create/.test(src), 'the flow must not grow its own checkout path');
});

check('the editor stands down so one refusal is not two upgrade prompts', () => {
    const src = read('client/src/layouts/IDELayout.jsx');
    const listener = src.slice(src.indexOf('EVENT_TYPES.QUOTA_EXCEEDED'));
    const body = listener.slice(0, 900);
    assert.match(body, /useMobileFlowStore\.getState\(\)\.active/, 'it must check whether the flow is open');
    // The AI bar state has to update either way, so the early return must come
    // after it, not before.
    assert.ok(body.indexOf('setAiOpsExhausted') < body.indexOf('useMobileFlowStore.getState().active'),
        'the AI bar must still be marked exhausted before standing down');
});

check('a spent trial is told apart from a spent month', () => {
    const src = read('client/src/lib/quotaReason.js');
    assert.match(src, /AUTO_TRIAL_SPENT/);
    assert.match(src, /auto_trial/);
    // Waiting for the month to roll over fixes one and never fixes the other.
    for (const f of ['client/src/agent/MediaExecutionEngine.js', 'client/src/agent/TranscriptionManager.js']) {
        const c = read(f);
        assert.match(c, /quotaReason\(/, `${f} must classify the refusal`);
        assert.ok(!/reason: 'ai_ops',\n\s*message: (body|errorData)/.test(c), `${f} must not hardcode ai_ops`);
    }
});

check('the plan sheet has copy for a spent trial, in both languages', () => {
    const sheet = read('client/src/components/PlanSheet.jsx');
    assert.match(sheet, /reason === 'auto_trial'/);
    assert.match(sheet, /planSheet\.autoTrialTitle/);
    for (const lang of ['en', 'fr']) {
        const j = JSON.parse(read(`client/src/locales/${lang}/common.json`));
        const ps = j.planSheet;
        for (const k of ['autoTrialTitle', 'autoTrialBody']) {
            assert.ok(ps[k], `${lang} ${k} missing`);
            assert.ok(!/\u2014/.test(ps[k]), `${lang} ${k} has an em dash`);
        }
        assert.match(ps.autoTrialBody, /\{\{total\}\}/, `${lang} body must interpolate the count`);
        // `count` would make i18next look for autoTrialBody_one/_other.
        assert.ok(!/\{\{count\}\}/.test(ps.autoTrialBody), `${lang} must not use count, which triggers pluralisation`);
    }
});

realLog(`\n${n} checks passed\n`);
