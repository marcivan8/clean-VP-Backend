// R91 round 2: every intelligence follows the editing style picked under the
// chat box (Editorial Brain, Project / Story Intelligence, Director cards,
// suggestion chips, content analyser, animate and rhythm-zoom routes).
// node scripts/test_style_intelligences.mjs
import { register, createRequire } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' });
const log = console.log; console.log = () => {}; console.warn = () => {}; console.info = () => {}; console.error = () => {};

let failures = 0;
const check = async (name, fn) => {
    try { await fn(); log(`  ok  ${name}`); } catch (e) { failures++; log(`  FAIL ${name}: ${e.message}`); }
};
const read = (p) => fs.readFileSync(path.resolve(here, p), 'utf8');

// Server modules with the database and AI provider stubbed (as the other brain tests do).
const stub = (rel, exports) => {
    const p = require.resolve(path.resolve(here, rel));
    require.cache[p] = { id: p, filename: p, loaded: true, exports };
};
stub('../config/database.js', { supabaseAdmin: { from() { return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: null, error: null }; } }; } } });
stub('../services/AIProvider.js', { isAIConfigured: () => false, getAIClient: () => null, resolveModel: m => m, resolveProvider: () => 'openai' });
const S = require('../server/brain/editingStyles.js');
const { ProjectIntelligence } = require('../server/brain/ProjectIntelligence.js');
const { StoryIntelligence } = require('../server/brain/StoryIntelligence.js');
const { ContextEngine } = require('../server/brain/ContextEngine.js');
const { EditorialBrain } = require('../server/brain/EditorialBrain.js');

log('shared server rules');
await check('ids, sanitising, platform, calm and order rules', () => {
    assert.deepEqual(S.EDITING_STYLE_IDS, ['vlog', 'talking_head', 'interview', 'podcast', 'reel']);
    assert.equal(S.sanitizeEditingStyle('podcast'), 'podcast');
    assert.equal(S.sanitizeEditingStyle({ id: 'reel', guidance: 'x' }), 'reel');
    for (const bad of ['<script>', 'PODCAST', null, 42, { id: 'evil' }]) assert.equal(S.sanitizeEditingStyle(bad), null);
    assert.equal(S.platformForStyle('reel'), 'instagram_reels');
    assert.equal(S.platformForStyle('podcast'), 'podcast');
    assert.equal(S.platformForStyle('vlog'), null);
    const { PLATFORM_KNOWLEDGE } = require('../server/brain/PlatformKnowledge.js');
    assert.ok(PLATFORM_KNOWLEDGE.instagram_reels && PLATFORM_KNOWLEDGE.podcast, 'platform keys exist');
    assert.ok(S.keepsRecordedOrder('vlog') && S.keepsRecordedOrder('podcast') && !S.keepsRecordedOrder('reel'));
    assert.ok(S.isCalmStyle('interview') && !S.isCalmStyle('talking_head'));
    assert.ok(!S.expectsMusic('podcast') && S.expectsMusic('vlog') && S.expectsMusic(null));
    assert.equal(S.brainStyleSection(null), '');
    assert.ok(/Do NOT suggest b-roll/.test(S.brainStyleSection('podcast')));
    assert.deepEqual(S.rhythmZoomStyle('podcast').allowPunchIns, false);
    assert.equal(S.rhythmZoomStyle(null).promptLine, '');
});

log('project and story maps');
await check('project map: style in the prompt, and in the fingerprint only when set', () => {
    const pi = new ProjectIntelligence();
    const assets = [{ id: 'a', analysis_status: 'done' }];
    assert.equal(pi.computeFingerprint(assets, 2), pi.computeFingerprint(assets, 2, null), 'no style: unchanged hash');
    assert.notEqual(pi.computeFingerprint(assets, 2, 'podcast'), pi.computeFingerprint(assets, 2));
    const prompt = pi.buildDerivationPrompt({ assets: [{ id: 'a', name: 'x' }], clipCount: 1, platform: 'podcast', editingStyle: 'podcast' });
    assert.ok(/do NOT list missing cutaways, b-roll, music/.test(prompt));
    assert.ok(!/Editing style:/.test(pi.buildDerivationPrompt({ assets: [{ id: 'a' }] })));
});
await check('story map: vlog keeps order, reel wants the hook in 2 s', () => {
    const si = new StoryIntelligence();
    const clips = [{ id: 'c1', duration: 5 }, { id: 'c2', duration: 5 }];
    assert.equal(si.computeCutFingerprint(clips), si.computeCutFingerprint(clips, null));
    assert.notEqual(si.computeCutFingerprint(clips, 'vlog'), si.computeCutFingerprint(clips));
    assert.ok(/do NOT suggest moving a later moment to the front/.test(si.buildDerivationPrompt({ clips, editingStyle: 'vlog' })));
    assert.ok(/first 2 seconds/.test(si.buildDerivationPrompt({ clips, editingStyle: 'reel' })));
});

log('editorial brain');
await check('context carries the style; a podcast is complete without music', () => {
    const ce = new ContextEngine();
    const base = { tracks: [{ id: 't', type: 'video', clips: [{ id: 'c', start: 0, duration: 30 }] }], captions: [{ word: 'hi', start: 0, end: 1 }], hasCaptions: true, editHistory: ['silence_removal'] };
    const plain = ce.build(base);
    const pod = ce.build({ ...base, editingStyle: 'podcast' });
    assert.equal(pod.editingStyle, 'podcast');
    assert.equal(ce.build({ ...base, editingStyle: 'nope' }).editingStyle, null);
    assert.equal(pod.completionScore - plain.completionScore, 15, 'music points');
});
await check('system prompt: style section overrides format rules; no "choose a platform"; no impact SFX for calm styles', () => {
    const b = new EditorialBrain();
    const ctx = b.contextEngine.build({ tracks: [], editingStyle: 'interview' });
    const p = b.buildSystemPrompt(ctx, {}, null, null);
    assert.ok(/EDITING STYLE \(chosen by the user/.test(p));
    assert.ok(/Interview style/.test(p));
    assert.ok(!/advise user to choose a target platform/.test(p));
    assert.ok(/never when the EDITING STYLE is podcast or interview/.test(p));
    const none = b.buildSystemPrompt(b.contextEngine.build({ tracks: [] }), {}, null, null);
    assert.ok(!/EDITING STYLE \(chosen/.test(none), 'no section without a style');
});
await check('brain route: style sanitised, platform derived, passed to both maps and the context', () => {
    const r = read('../server/routes/brainRoutes.js');
    assert.ok(/const editingStyle = sanitizeEditingStyle\(projectState\.editingStyle\);/.test(r));
    assert.ok(/projectState\.platform \|\| platformForStyle\(editingStyle\)/.test(r));
    assert.equal((r.match(/platform,\s*editingStyle,\s*\}\);/g) || []).length, 2);
    assert.ok(/\.\.\.projectState,\s*editingStyle,\s*platform,/.test(r));
    assert.ok(/editingStyle:\s+state\.editingStyle \|\| null/.test(read('../client/src/hooks/useBrain.js')));
});

log('client');
const { default: Store } = await import('../client/src/store/useTimelineStore.js');
const { buildProposals } = await import('../client/src/agent/DirectorIntelligence.js');
const { getNextActions, deriveFacts, contradictsStyle } = await import('../client/src/agent/SuggestionEngine.js');
const { applyStyleToAnalysis, ContentAnalyzer } = await import('../client/src/agent/ContentAnalyzer.js');
const storyMap = { status: 'ok', hook_at_sec: 40, hook_strength: 'weak', hook_note: 'late', delivers_through_line: false, sag_windows: [], issues: [] };
const projectMap = { status: 'ok', coverage_gaps: [{ gap: 'No b-roll cutaways', severity: 'medium' }, { gap: 'No outro', severity: 'low' }] };
await check('director: no hook-first reorder for vlog/interview/podcast; reel and no style keep it', () => {
    const ids = (style) => buildProposals({ storyMap, projectMap, editingStyle: style }).proposals.map(p => p.id);
    for (const s of ['interview', 'podcast']) {
        const x = ids(s);
        assert.ok(!x.includes('hook_buried') && !x.includes('through_line_buried'), s);
    }
    assert.ok(ids('vlog').includes('hook_weak') && !ids('vlog').includes('hook_buried'));
    assert.ok(ids('reel').includes('hook_buried'));
    assert.ok(ids(null).includes('hook_buried') && ids(null).includes('through_line_buried'), 'unchanged without a style');
    const gaps = (style) => buildProposals({ projectMap, editingStyle: style }).proposals.map(p => p.title);
    assert.deepEqual(gaps('podcast'), ['No outro']);
    assert.equal(gaps(null).length, 2);
});
const tm = window.timelineManager;
const setup = (style, extra = {}) => {
    tm.fromLegacyTracks([
        { id: 'v', type: 'video', name: 'V', clips: [{ id: 'c1', clipId: 'e1', assetId: 'a', type: 'video', name: 'A', start: 0, duration: 200, offset: 0, speed: 1 }] },
        { id: 'tx', type: 'text', name: 'T', clips: [{ id: 'caption-1', clipId: 'caption-1', type: 'text', start: 0, duration: 2, text: 'hi' }] },
    ]);
    Store.setState({ tracks: tm.toLegacyTracks(), duration: 200, aspectRatio: '16:9', captions: [{ word: 'hi', start: 0, end: 1 }], assets: [{ id: 'a', type: 'video', name: 'A' }], editHistory: [{ op: 'silence_removal' }], projectLUTId: null, editingStyle: style, ...extra });
};
const chips = () => getNextActions({ limit: 12 }).map(a => `${a.id}|${a.label}|${a.prompt}`);
await check('chips: reel short + vertical + TikTok export; podcast no music and gentle zooms; vlog silences only', () => {
    setup('reel', { editHistory: [] });
    let c = chips().join('\n');
    assert.ok(/reel_short\|Extract a short\|Extract a short of 60 seconds/.test(c), c);
    assert.ok(/reel_vertical\|Make it vertical/.test(c));
    setup('reel');
    c = chips().join('\n');
    assert.ok(/export\|Export\|Export for TikTok/.test(c), c);
    assert.ok(/style_recipe\|Apply my style\|Apply the punchy style recipe/.test(c));
    setup('podcast');
    c = chips().join('\n');
    assert.ok(!/music\|/.test(c), 'no music chip for a podcast');
    assert.equal(deriveFacts().style, 'podcast');
    // Two clips so the zoom rule can fire: the label says what will happen.
    tm.fromLegacyTracks([{ id: 'v', type: 'video', name: 'V', clips: [
        { id: 'c1', clipId: 'e1', assetId: 'a', type: 'video', name: 'A', start: 0, duration: 100, offset: 0, speed: 1 },
        { id: 'c2', clipId: 'e2', assetId: 'a', type: 'video', name: 'A', start: 100, duration: 100, offset: 120, speed: 1 }] }]);
    Store.setState({ tracks: tm.toLegacyTracks() });
    assert.ok(/rhythm\|Add gentle zooms\|Make it more dynamic/.test(chips().join('\n')), chips().join('\n'));
    setup('vlog', { editHistory: [] });
    assert.ok(/cleanup\|Clean it up\|Remove silences$/m.test(chips().join('\n')));
    setup(null, { editHistory: [] });
    assert.ok(/cleanup\|Clean it up\|Remove silences and filler words/.test(chips().join('\n')), 'unchanged without a style');
    assert.ok(!/reel_|style_recipe/.test(chips().join('\n')));
});
await check('chips: brain suggestions that contradict the style are dropped', () => {
    assert.ok(contradictsStyle({ label: 'Add b-roll reaction shots' }, { style: 'podcast' }));
    assert.ok(contradictsStyle({ label: 'Move the hook to the front' }, { style: 'vlog' }));
    assert.ok(!contradictsStyle({ label: 'Move the hook to the front' }, { style: 'reel' }));
    assert.ok(!contradictsStyle({ label: 'Add background music' }, { style: 'vlog' }));
    assert.ok(!contradictsStyle({ label: 'Add b-roll' }, { style: null }));
    setup('podcast');
    const out = getNextActions({ limit: 10, brainSuggestions: ['Add impact sound effects', 'Normalize the audio'] }).map(a => a.label);
    assert.ok(!out.includes('Add impact sound effects') && out.includes('Normalize the audio'));
});
await check('content analyser: style decides type and mode, detection kept; cached reads follow the style', () => {
    const detected = { contentType: 'long_form_raw', editMode: 'FULL_BUILD', editPlan: { editMode: 'FULL_BUILD' }, summary: {} };
    const r = applyStyleToAnalysis(detected, 'podcast');
    assert.equal(r.contentType, 'podcast'); assert.equal(r.editMode, 'CLEAN_EDIT'); assert.equal(r.editPlan.editMode, 'CLEAN_EDIT');
    assert.equal(r.detectedEditMode, 'FULL_BUILD');
    assert.equal(applyStyleToAnalysis(detected, 'vlog'), detected, 'vlog keeps detection');
    assert.equal(applyStyleToAnalysis(detected, null), detected);
    assert.equal(applyStyleToAnalysis(null, 'podcast'), null);
    Store.setState({ contentAnalysis: detected, editingStyle: 'reel' });
    assert.equal(ContentAnalyzer.getCachedAnalysis().contentType, 'short_form');
    assert.equal(ContentAnalyzer._selectEditModeLocal('youtube_long', 400, 'Podcast'), 'CLEAN_EDIT', 'capitalised platform matches now');
});
await check('LLM context: no detected FULL_BUILD next to a chosen podcast', async () => {
    const { ContextGenerator } = await import('../client/src/agent/ContextGenerator.js');
    Store.setState({ contentAnalysis: { contentType: 'long_form_raw', editMode: 'FULL_BUILD' }, editingStyle: 'podcast' });
    const ctx = ContextGenerator.getStructuredContext();
    assert.equal(ctx.LongFormContext.editMode, 'CLEAN_EDIT');
});

log('animate, rhythm zoom and organize routes (static: need the server)');
await check('animate: calm styles get half intensity, no secondary preset, no SFX', () => {
    const r = read('../server/routes/audioEngineRoutes.js');
    assert.ok(/const calm = isCalmStyle\(sanitizeEditingStyle\(req\.body\?\.editingStyle \?\? projectState\?\.editingStyle\)\);/.test(r));
    assert.ok(/calm \? Math\.round\(rawIntensity \* 0\.5/.test(r));
    assert.ok(/calm \? null : pickSecondaryPreset/.test(r) && /calm \? \[\] : sfxIntentsForEventType/.test(r));
});
await check('rhythm zoom: style line in the prompt, no punch-ins for calm styles', () => {
    const r = read('../routes/interviewRoutes.js');
    assert.ok(/rhythmZoomStyle\(sanitizeEditingStyle\(req\.body\?\.editingStyle\)\)/.test(r));
    assert.ok(/STYLE OVERRIDE: \$\{zoomStyle\.promptLine\}/.test(r));
    assert.ok(/if \(emphasisWord && zoomStyle\.allowPunchIns\)/.test(r));
});
await check('organize: no stored hook-first reorder for vlog / interview / podcast', () => {
    assert.ok(/if \(!storyHints && !keepOrder && projectId/.test(read('../routes/interviewRoutes.js')));
});
await check('client sends the style to animate (both calls), rhythm zoom, organize, and re-reads the Brain on change', () => {
    const e = read('../client/src/agent/MediaExecutionEngine.js');
    assert.equal((e.match(/editingStyle: (st|aaStore)\.editingStyle \|\| null/g) || []).length, 2);
    assert.ok(/style: rzStyle, editingStyle: useTimelineStore\.getState\(\)\.editingStyle \|\| null/.test(e));
    assert.ok(/editingStyle: ocStore\.editingStyle \|\| null/.test(e));
    const rp = read('../client/src/components/Assistant/ReasoningPanel.jsx');
    assert.ok(/analyzeProject\('edit_applied'\)\)\.catch/.test(rp) && /editingStyle: useTimelineStore\.getState\(\)\.editingStyle \|\| null/.test(rp));
});

log(failures ? `\n${failures} FAILURES` : '\nALL STYLE INTELLIGENCE TESTS PASSED');
process.exit(failures ? 1 : 0);
