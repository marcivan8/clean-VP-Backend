// R124 — FULL_BUILD and YOUTUBE_OPTIMIZED never generated captions at all
// before this, regardless of the user's request. This pins that both modes
// now end their atomic plan with auto_captions → apply_caption_style →
// emphasize_keywords, using the style resolved from the parsed captionBrief
// (or the clean-modern default when none was given), and that CLEAN_EDIT
// (a "just clean up my audio" request) is left untouched — this is a
// deliberate, scoped change to the two from-scratch creative-build modes
// only, not a blanket "always add captions" behavior change.
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;

const realLog = console.log;
console.log = () => {}; console.warn = () => {}; console.info = () => {};

const { LongFormEditPlanner } = await import('../client/src/agent/LongFormEditPlanner.js');
const { default: useTimelineStore } = await import('../client/src/store/useTimelineStore.js');

console.log = realLog;
const ok = (name) => realLog(`✓ ${name}`);

const baseAnalysis = {
    success: true,
    editMode: 'FULL_BUILD',
    editPlan: { actions: [] },
    segments: [],
    structure: {},
    contentType: 'rushes',
};

// 1. FULL_BUILD with a resolved style preset from the brief.
{
    const plan = LongFormEditPlanner.generatePlan(baseAnalysis, {
        captionBrief: { wantsCaptions: true, wantsKeywordEmphasis: true, stylePresetId: 'bold-impact', keepClearOfFace: true, safeMargins: false },
    });
    const actions = plan.steps.map(s => s.action);
    // R125 added place_contextual_broll/animate_automatically AFTER the
    // caption steps (keyword-emphasis detection needs caption clips to
    // already exist) — so these three are consecutive, but no longer
    // necessarily the LAST three in the plan. Check relative order instead
    // of exact trailing position.
    const capI = actions.indexOf('auto_captions');
    const styleI = actions.indexOf('apply_caption_style');
    const empI = actions.indexOf('emphasize_keywords');
    assert.ok(capI !== -1 && styleI !== -1 && empI !== -1, 'all three caption steps must be present');
    assert.ok(capI < styleI && styleI < empI, 'caption steps run in order: generate → style → emphasize');
    const captionStep = plan.steps.find(s => s.action === 'auto_captions');
    const styleStep = plan.steps.find(s => s.action === 'apply_caption_style');
    assert.equal(captionStep.style, 'bold-impact');
    assert.equal(styleStep.styleId, 'bold-impact');
    ok('FULL_BUILD runs auto_captions → apply_caption_style → emphasize_keywords in order, using the brief\'s resolved style');
}

// 2. FULL_BUILD with NO brief at all (e.g. a short "edit this for me" request,
// or any path that never threaded a captionBrief) still gets captions, with
// a sensible default style rather than silently skipping captions.
{
    const plan = LongFormEditPlanner.generatePlan(baseAnalysis, {});
    const styleStep = plan.steps.find(s => s.action === 'apply_caption_style');
    assert.ok(styleStep, 'apply_caption_style step must exist even with no brief');
    assert.equal(styleStep.styleId, 'clean-modern');
    ok('FULL_BUILD with no captionBrief at all still gets captions, defaulting to the clean-modern style');
}

// 3. YOUTUBE_OPTIMIZED gets the same treatment.
{
    const plan = LongFormEditPlanner.generatePlan({ ...baseAnalysis, editMode: 'YOUTUBE_OPTIMIZED' }, {
        captionBrief: { wantsCaptions: true, wantsKeywordEmphasis: true, stylePresetId: 'cinematic', keepClearOfFace: false, safeMargins: false },
    });
    const actions = plan.steps.map(s => s.action);
    assert.ok(actions.includes('auto_captions') && actions.includes('apply_caption_style') && actions.includes('emphasize_keywords'));
    const styleStep = plan.steps.find(s => s.action === 'apply_caption_style');
    assert.equal(styleStep.styleId, 'cinematic');
    ok('YOUTUBE_OPTIMIZED also gets styled captions + emphasis');
}

// 4. CLEAN_EDIT must NOT be affected — this is a "clean up my podcast audio"
// request, not a from-scratch creative build, and must not start adding
// captions no one asked for. (CLEAN_EDIT has its own direct-path short-circuit
// in EditPlanner.planLongFormEdit, but LongFormEditPlanner._buildAtomicSteps
// is exercised too, e.g. via the cached-analysis path in VideoEditorTools.)
{
    const plan = LongFormEditPlanner.generatePlan({ ...baseAnalysis, editMode: 'CLEAN_EDIT' }, {
        captionBrief: { wantsCaptions: true, wantsKeywordEmphasis: true, stylePresetId: 'bold-impact', keepClearOfFace: false, safeMargins: false },
    });
    const actions = plan.steps.map(s => s.action);
    assert.ok(!actions.includes('auto_captions'), 'CLEAN_EDIT must not gain an unrequested auto_captions step');
    assert.ok(!actions.includes('apply_caption_style'));
    assert.ok(!actions.includes('emphasize_keywords'));
    ok('CLEAN_EDIT is untouched — no captions added to a plain cleanup request');
}

realLog('\nALL LONG-FORM CAPTION STEPS TESTS PASSED');
