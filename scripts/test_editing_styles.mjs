// R91: editing styles under the chat box (Normal / Auto), the Reel short
// picker, and the undo group that keeps a whole Auto run as one step.
// node scripts/test_editing_styles.mjs
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';
import fs from 'fs';

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' });
const log = console.log; console.log = () => {}; console.warn = () => {}; console.info = () => {}; console.error = () => {};

let failures = 0;
const check = async (name, fn) => {
    try { await fn(); log(`  ok  ${name}`); } catch (e) { failures++; log(`  FAIL ${name}: ${e.message}`); }
};
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

const { default: S } = await import('../client/src/store/useTimelineStore.js');
const ES = await import('../client/src/agent/EditingStyles.js');
const { findBestShortWindow, splitSentences, rangesOutside } = await import('../client/src/agent/shortPicker.js');
const { STYLE_RECIPES } = await import('../client/src/motion/StyleRecipes.js');
const { TRANSITION_TYPES } = await import('../client/src/motion/TransitionFX.js');
const { IntentParser } = await import('../client/src/agent/IntentParser.js');
const { EditPlanner } = await import('../client/src/agent/EditPlanner.js');
const { ContextGenerator } = await import('../client/src/agent/ContextGenerator.js');
const { runAutopilot, stopAutopilot } = await import('../client/src/agent/StyleAutopilot.js');

const tm = window.timelineManager;
function setTimeline(dur = 300, extra = {}) {
    tm.fromLegacyTracks([{ id: 'track-default-video', type: 'video', name: 'V', clips: [
        { id: 'v1', clipId: 'e1', assetId: 'a', type: 'video', name: 'IMG.MOV', start: 0, duration: dur, offset: 0, speed: 1 }] }]);
    S.setState({ tracks: tm.toLegacyTracks(), duration: dur, currentTime: 0, activeClipId: 'v1', past: [], future: [],
        uploadedFile: { name: 'IMG.MOV' }, assets: [{ id: 'a', type: 'video', name: 'IMG.MOV', duration: dur }], captions: [], ...extra });
}
const plan = async (text) => {
    const intent = await IntentParser.parse(text);
    const p = await EditPlanner.generatePlan(intent);
    return { op: intent.operation, steps: p.plan?.steps || [] };
};

log('styles');
await check('five styles, each pointing at a real recipe, transition and zoom preset', () => {
    assert.deepEqual(ES.EDITING_STYLE_IDS, ['vlog', 'talking_head', 'interview', 'podcast', 'reel']);
    for (const id of ES.EDITING_STYLE_IDS) {
        const s = ES.getEditingStyle(id);
        assert.ok(STYLE_RECIPES[s.recipeId], `${id} recipe`);
        assert.ok(TRANSITION_TYPES.includes(s.transition), `${id} transition`);
        assert.ok(['subtle', 'dynamic', 'cinematic'].includes(s.rhythmZoom), `${id} zoom`);
        assert.ok(s.guidance.length > 20 && s.guidance.length <= 300, `${id} guidance length (server caps at 300)`);
    }
    assert.equal(ES.getEditingStyle('nope'), null);
    assert.equal(ES.normalizeEditingMode('auto'), 'auto');
    assert.equal(ES.normalizeEditingMode('x'), 'normal');
});
await check('generic requests and questions', () => {
    for (const t of ['edit it', 'Edit the video', 'go', '', 'monte la vidéo', 'vas-y', 'fais le montage']) assert.ok(ES.isGenericEditRequest(t), t);
    for (const t of ['cut the intro', 'edit it but keep the jokes']) assert.ok(!ES.isGenericEditRequest(t), t);
    for (const t of ['what is this video about?', 'why did you cut that', 'pourquoi tu as coupé']) assert.ok(ES.isQuestion(t), t);
    assert.ok(!ES.isQuestion('remove silences'));
});
await check('playbooks', () => {
    const keys = (id, req = 'edit it', facts = {}) => ES.buildAutopilotSteps(id, req, facts).map(s => s.key);
    assert.deepEqual(keys('talking_head'), ['silences', 'fillers', 'captions', 'recipe']);
    assert.deepEqual(keys('vlog'), ['silences', 'captions', 'recipe']);
    assert.deepEqual(keys('podcast', 'go', { hasCaptions: true }), ['silences', 'fillers', 'audio', 'recipe']);
    assert.deepEqual(keys('interview', 'cut the intro'), ['request', 'silences', 'fillers', 'captions', 'recipe']);
    assert.deepEqual(keys('reel'), ['captions', 'short', 'vertical', 'silences', 'fillers', 'recipe']);
    assert.deepEqual(keys('reel', 'go', { hasCaptions: true }), ['short', 'vertical', 'silences', 'fillers', 'recipe']);
    assert.deepEqual(keys('nope'), []);
});

log('every playbook prompt reaches its command');
setTimeline();
const EXPECT = { captions: 'auto_captions', short: 'extract_short', vertical: 'set_aspect_ratio', silences: 'silence_removal', fillers: 'remove_filler_words', audio: 'normalize_audio', recipe: 'apply_style_recipe' };
const seen = new Map();
for (const id of ES.EDITING_STYLE_IDS) for (const s of ES.buildAutopilotSteps(id, 'go', {})) if (EXPECT[s.key]) seen.set(s.prompt, EXPECT[s.key]);
for (const [prompt, op] of seen) {
    await check(`"${prompt}" → ${op}`, async () => {
        const r = await plan(prompt);
        assert.equal(r.op, op);
        assert.ok(r.steps.length > 0, 'planned');
    });
}

log('short picker');
const W = (list) => list.map(([word, start, end]) => ({ word, start, end: end ?? start + 0.3 }));
function talk() {
    // 0-40 s: filler talk; 40-95 s: strong part with events; 95-150 s: more talk.
    const out = [];
    let t = 0;
    const sentence = (words, gapAfter = 0.9) => { for (const w of words) { out.push([w, t, t + 0.3]); t += 0.35; } out[out.length - 1][0] += '.'; t += gapAfter; };
    while (t < 40) sentence(['and', 'then', 'we', 'went', 'to', 'the', 'shop', 'again']);
    sentence(['here\'s', 'the', 'secret', 'nobody', 'tells', 'you', 'about', 'pricing']);
    while (t < 95) sentence(['charge', 'more', 'because', 'value', 'matters', 'more', 'than', 'cost']);
    while (t < 150) sentence(['so', 'anyway', 'we', 'packed', 'up', 'and', 'left', 'home']);
    return W(out);
}
const words = talk();
const events = [{ eventType: 'REVEAL', timelineTime: 41 }, { eventType: 'PUNCHLINE_DETECTED', timelineTime: 70 }, { eventType: 'EMPHASIS_MOMENT', timelineTime: 85 }];
await check('sentences split on pauses and punctuation', () => {
    const s = splitSentences(words);
    assert.ok(s.length > 10);
    assert.ok(s.every(x => x.end > x.start));
    assert.deepEqual(splitSentences(null), []);
});
await check('picks the hook window with the events, within bounds', () => {
    const w = findBestShortWindow(words, { events, target: 60 });
    assert.ok(w, 'found');
    const d = w.end - w.start;
    assert.ok(d >= 15 && d <= 60, `duration ${d}`);
    assert.ok(Math.abs(w.start - 40) < 2.5, `starts at the hook, got ${w.start}`);
    assert.equal(w.hookEvent, 'REVEAL');
    assert.ok(/secret/.test(w.text));
});
await check('never starts on a connector when a clean start exists', () => {
    const w = findBestShortWindow(words, { target: 30 });
    assert.ok(!/^(and|so)\b/i.test(w.text), w.text);
});
await check('too short a talk gives no window', () => {
    assert.equal(findBestShortWindow(W([['hi.', 0], ['bye.', 2]]), { target: 60 }), null);
    assert.equal(findBestShortWindow([], {}), null);
});
await check('rangesOutside keeps the window, padded', () => {
    const r = rangesOutside({ start: 40, end: 90 }, 150);
    assert.equal(r.length, 2);
    assert.ok(Math.abs(r[0][0] - 90.3) < 1e-9 && r[0][1] === 150);
    assert.ok(r[1][0] === 0 && Math.abs(r[1][1] - 39.85) < 1e-9);
    assert.deepEqual(rangesOutside({ start: 0, end: 149.9 }, 150), []);
    assert.deepEqual(rangesOutside(null, 100), []);
});

log('undo group');
await check('cuts inside a group: one undo restores timeline AND captions', () => {
    setTimeline(150, { captions: words });
    S.getState().addTemplateClip('counter', {}, { start: 1, select: false }); // an older history entry
    const beforePast = S.getState().past.length;
    const capsBefore = S.getState().captions;
    S.getState().beginHistoryGroup();
    try {
        S.getState().cutTimelineRanges([[100, 150], [0, 30]]);
        S.getState().cutTimelineRanges([[500, 600]]); // nothing to cut: drops its own snapshot
    } finally { S.getState().endHistoryGroup(); }
    assert.equal(S.getState().past.length, beforePast + 1, 'one step');
    const len = () => S.getState().tracks.find(t => t.type === 'video').clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
    assert.ok(len() < 80, `cut to ${len()}`);
    S.getState().undo();
    assert.ok(Math.abs(len() - 150) < 0.01, `restored ${len()}`);
    assert.equal(S.getState().captions, capsBefore, 'captions restored');
    assert.equal(S.getState().past.length, beforePast, 'the older entry is still there');
});
await check('a group that changes nothing adds no undo step', () => {
    const n = S.getState().past.length;
    S.getState().beginHistoryGroup(); S.getState().endHistoryGroup();
    assert.equal(S.getState().past.length, n);
    assert.equal(S.getState()._historyGroupBase, null);
});

log('store: style saved per project, mode never saved');
await check('save / load / new project', () => {
    setTimeline();
    S.getState().setEditingStyle('podcast');
    S.getState().setEditingMode('auto');
    const saved = S.getState().saveProject();
    assert.equal(saved.editingStyle, 'podcast');
    assert.equal('editingMode' in saved, false);
    S.getState().loadProject({ tracks: saved.tracks });
    assert.equal(S.getState().editingStyle, null, 'a project saved without a style opens with none');
    assert.equal(S.getState().editingMode, 'normal');
    S.getState().loadProject(saved);
    assert.equal(S.getState().editingStyle, 'podcast');
    S.getState().setEditingMode('weird');
    assert.equal(S.getState().editingMode, 'normal');
});

log('normal mode: the style fills what the request leaves open');
await check('defaults follow the style, explicit requests win', async () => {
    setTimeline();
    S.getState().setEditingStyle('reel');
    let r = await plan('make a short');
    assert.equal(r.steps[0].args.target, 60);
    r = await plan('make a 30 second short');
    assert.equal(r.steps[0].args.target, 30);
    r = await plan('apply the style recipe');
    assert.equal(r.steps[0].args.recipeId, 'punchy');
    r = await plan('apply the podcast style recipe');
    assert.equal(r.steps[0].args.recipeId, 'podcast');
    S.getState().setEditingStyle('podcast');
    r = await plan('make it punchy');
    assert.equal(r.steps[0].style, 'subtle');
    r = await plan('add a transition between all the clips');
    assert.equal(r.steps[0].type, 'dip');
    r = await plan('add a whip transition between all the clips');
    assert.equal(r.steps[0].type, 'whip-left');
    S.getState().setEditingStyle(null);
    r = await plan('make it punchy');
    assert.equal(r.steps[0].style, 'dynamic', 'unchanged without a style');
});
await check('LLM context carries the style', () => {
    S.getState().setEditingStyle('interview');
    const ctx = ContextGenerator.getStructuredContext();
    assert.equal(ctx.ProjectContext.editingStyle.id, 'interview');
    assert.ok(ctx.ProjectContext.editingStyle.guidance.includes('Interview'));
    S.getState().setEditingStyle(null);
    assert.equal(ContextGenerator.getStructuredContext().ProjectContext.editingStyle, null);
});

log('auto mode');
await check('runs the playbook in order as ONE undo step and reports skips', async () => {
    setTimeline(150, { captions: words });
    S.getState().setEditingStyle('talking_head');
    const prompts = [];
    const before = S.getState().past.length;
    const r = await runAutopilot('edit it', { run: async (p) => {
        prompts.push(p);
        if (p === 'Remove silences') { S.getState().cutTimelineRanges([[140, 150]]); return { success: true, jobId: 'j1' }; }
        if (p === 'Remove filler words') return { success: false, message: 'no fillers found' };
        S.getState().addTemplateClip('counter', {}, { start: 2, select: false });
        return { success: true, jobId: 'j2' };
    } });
    assert.deepEqual(prompts, ['Remove silences', 'Remove filler words', 'Apply the punchy style recipe']);
    assert.equal(r.success, true); assert.equal(r.operation, 'auto_edit');
    assert.match(r.message, /Talking head/); assert.match(r.message, /no fillers found/);
    assert.equal(S.getState().past.length, before + 1);
    assert.equal(S.getState()._historyGroupDepth, 0);
});
await check('no style picked: Talking head, said so; clarifications skipped; a throw does not stop the run', async () => {
    setTimeline(150, { captions: [] });
    S.getState().setEditingStyle(null);
    const prompts = [];
    const r = await runAutopilot('go', { run: async (p) => {
        prompts.push(p);
        if (p === 'Add captions') return { success: false, requiresClarification: true, jobId: 'x' };
        if (p === 'Remove filler words') throw new Error('boom');
        return { success: true };
    } });
    assert.equal(prompts.length, 4);
    assert.match(r.message, /No style picked/);
    assert.match(r.message, /needed a clarification/);
    assert.match(r.message, /boom/);
});
await check('stop ends the run after the current step', async () => {
    const prompts = [];
    const r = await runAutopilot('go', { styleId: 'vlog', run: async (p) => { prompts.push(p); stopAutopilot(); return { success: true }; } });
    assert.equal(prompts.length, 1);
    assert.match(r.message, /stopped/);
});
await check('nothing applied → success false', async () => {
    const r = await runAutopilot('go', { styleId: 'vlog', run: async () => ({ success: false, message: 'nope' }) });
    assert.equal(r.success, false);
});

log('wiring (static: these need the browser or the server)');
await check('Auto mode is routed in the workflow, questions excluded, Stop and timeout stop it', () => {
    const wc = read('../client/src/agent/WorkflowController.js');
    assert.ok(/editingMode === 'auto' && !isQuestion\(userPrompt\)/.test(wc));
    assert.ok(/runAutopilot\(userPrompt\)/.test(wc));
    assert.ok(/cancelCurrentJob\(\) \{\s*stopAutopilot\(\)/.test(wc));
    assert.ok(/phase: 'prompt' \}\);\s*stopAutopilot\(\)/.test(wc));
});
await check('only Auto jobs skip the approval gate', () => {
    const ej = read('../client/src/agent/EditJobManager.js');
    assert.ok(/if \(options\?\.autoApprove\) this\.autoApproveJobs\.add\(jobId\)/.test(ej));
    assert.ok(/if \(!autoApproved && \(planResult\.plan\?\.requiresApproval \|\| planFirst\)\)/.test(ej));
    assert.ok(!/processEditRequest\([^)]*autoApprove/.test(read('../client/src/components/Assistant/ReasoningPanel.jsx')));
});
await check('server keeps only a known style id and a capped guidance', () => {
    const c = read('../controllers/aiAgentController.js');
    assert.ok(/EDITING_STYLE_IDS\.includes\(proj\.editingStyle\.id\)/.test(c));
    assert.ok(/\.slice\(0, 300\)/.test(c));
});
await check('engine extract_short cuts outside the picked window', () => {
    const e = read('../client/src/agent/MediaExecutionEngine.js');
    const i = e.indexOf("case 'extract_short'");
    assert.ok(i > 0);
    const body = e.slice(i, i + 2500);
    assert.ok(/findBestShortWindow\(words/.test(body) && /cutTimelineRanges\(ranges\)/.test(body));
});
await check('picker is in the desktop chat box, style syncs to the cloud', () => {
    const rp = read('../client/src/components/Assistant/ReasoningPanel.jsx');
    assert.ok(/hidden md:block">\s*<EditingStylePicker/.test(rp));
    assert.ok(/\[state\.tracks, state\.editingStyle\]/.test(read('../client/src/hooks/useSupabasePersistence.js')));
    for (const lang of ['en', 'fr']) {
        const j = JSON.parse(read(`../client/src/locales/${lang}/editor.json`)).editingStyles;
        for (const id of ES.EDITING_STYLE_IDS) assert.ok(j.names[id] && j.hints[id], `${lang} ${id}`);
        assert.ok(j.hints.none && j.autoPlaceholder && !/—/.test(JSON.stringify(j)), `${lang} copy`);
    }
});

log(failures ? `\n${failures} FAILURES` : '\nALL EDITING STYLE TESTS PASSED');
process.exit(failures ? 1 : 0);
