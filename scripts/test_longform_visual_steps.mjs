// Pins: FULL_BUILD wires contextual b-roll, illustrations, motion graphics,
// and automatic animation after captions; color grading only happens when
// the brief uses mood/color language; YOUTUBE_OPTIMIZED remains opt-in;
// complete edits do not extract redundant full-frame highlight clips onto
// another video track.
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;

const realLog = console.log;
console.log = () => {}; console.warn = () => {}; console.info = () => {};

const { LongFormEditPlanner } = await import('../client/src/agent/LongFormEditPlanner.js');
const { default: useTimelineStore } = await import('../client/src/store/useTimelineStore.js');
const { MediaExecutionEngine, ENGINE_TYPES } = await import('../client/src/agent/MediaExecutionEngine.js');

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

// `$ALL_CLIPS` is a fan-out marker only for store actions that implement it.
// A long-form per-clip tool must receive a real clip ID after the source is
// split into multiple timeline clips.
{
    const tm = window.timelineManager;
    tm.fromLegacyTracks([{ id: 'track-default-video', type: 'video', name: 'Video', clips: [
        { id: 'v1', type: 'video', start: 0, duration: 5 },
        { id: 'v2', type: 'video', start: 5, duration: 5 },
    ] }]);
    useTimelineStore.setState({ tracks: tm.toLegacyTracks(), activeClipId: null });
    const engine = new MediaExecutionEngine();
    const perClip = engine.resolveSymbolicRefs({
        engine: ENGINE_TYPES.STORE,
        action: 'reorderSegment',
        args: { clipId: '$first_clip', trackId: '$track_of($first_clip)' },
    });
    assert.equal(perClip.args.clipId, 'v1', 'per-clip operation leaked the bulk marker');
    assert.equal(perClip.args.trackId, 'track-default-video');
    const fanOut = engine.resolveSymbolicRefs({
        engine: ENGINE_TYPES.STORE,
        action: 'addTransition',
        args: { clipId: '$first_clip' },
    });
    assert.equal(fanOut.args.clipId, '$ALL_CLIPS', 'bulk transition lost its fan-out behavior');
    ok('per-clip symbolic references resolve to a real clip while bulk actions retain fan-out');
}

// 1. FULL_BUILD always gets b-roll, illustrations, graphics and animation, AFTER captions.
{
    const plan = LongFormEditPlanner.generatePlan(baseAnalysis, {});
    const actions = plan.steps.map(s => s.action);
    const capIdx = actions.indexOf('auto_captions');
    const brollIdx = actions.indexOf('place_contextual_broll');
    const illustrationsIdx = actions.indexOf('place_contextual_illustrations');
    const storyboardIdx = actions.indexOf('storyboard_video');
    const animIdx = actions.indexOf('animate_automatically');
    assert.ok(capIdx !== -1 && brollIdx !== -1 && illustrationsIdx !== -1 && storyboardIdx !== -1 && animIdx !== -1, 'all creative steps must be present');
    assert.ok(capIdx < brollIdx, 'captions must be generated before b-roll/motion graphics run');
    assert.ok(brollIdx < illustrationsIdx && illustrationsIdx < storyboardIdx, 'contextual assets should be placed before storyboard motion');
    assert.ok(brollIdx < animIdx, 'b-roll placed before animate_automatically (order in _visualSteps)');
    ok('FULL_BUILD unconditionally gets contextual b-roll, vector illustrations, storyboard graphics and animation after captions');
}

// A detected motion-graphics request must storyboard graphics across the
// transcript before automatic animation runs.
{
    const plan = LongFormEditPlanner.generatePlan(baseAnalysis, {
        visualBrief: { wantsContextualBroll: true, wantsMotionGraphics: true },
    });
    const actions = plan.steps.map(s => s.action);
    const graphicsIdx = actions.indexOf('storyboard_video');
    const animateIdx = actions.indexOf('animate_automatically');
    const graphics = plan.steps[graphicsIdx];
    assert.ok(graphicsIdx !== -1, 'motion graphics must create a storyboard step');
    assert.equal(graphics.args.dryRun, false, 'the storyboard step must place the graphics');
    assert.ok(graphicsIdx < animateIdx, 'graphics must be placed before automatic animation');
    ok('explicit motion-graphics requests create a storyboard before automatic animation');
}

// 2. No color grading without mood language in the brief.
{
    const plan = LongFormEditPlanner.generatePlan(baseAnalysis, { visualBrief: { wantsContextualBroll: true, wantsMotionGraphics: true, colorMoodQuery: null } });
    assert.ok(!plan.steps.some(s => s.action === 'apply_lut'), 'no apply_lut step without mood language');
    ok('no color grade is applied when the brief never used mood/color language');
}

// 3. Color mood language DOES add an apply_lut step with the resolved query.
{
    const plan = LongFormEditPlanner.generatePlan(baseAnalysis, { visualBrief: { wantsContextualBroll: true, wantsMotionGraphics: true, colorMoodQuery: 'cinematic moody dramatic' } });
    const lutStep = plan.steps.find(s => s.action === 'apply_lut');
    assert.ok(lutStep, 'apply_lut step must exist');
    assert.equal(lutStep.query, 'cinematic moody dramatic');
    assert.equal(lutStep.applyToAll, true);
    ok('mood/color language in the brief adds an apply_lut step with the resolved query, applied to all clips');
}

// 4. YOUTUBE_OPTIMIZED is opt-in — a plain "optimize this for YouTube"
// request (no visualBrief, or one with nothing set) must NOT gain graphics.
{
    const ytAnalysis = { ...baseAnalysis, editMode: 'YOUTUBE_OPTIMIZED' };
    const planNoBrief = LongFormEditPlanner.generatePlan(ytAnalysis, {});
    assert.ok(!planNoBrief.steps.some(s => s.action === 'place_contextual_broll'));
    assert.ok(!planNoBrief.steps.some(s => s.action === 'animate_automatically'));
    ok('YOUTUBE_OPTIMIZED with no visual brief does not gain b-roll/motion graphics');

    const planWithBrief = LongFormEditPlanner.generatePlan(ytAnalysis, { visualBrief: { wantsContextualBroll: true, wantsMotionGraphics: false, colorMoodQuery: null } });
    assert.ok(planWithBrief.steps.some(s => s.action === 'place_contextual_broll'));
    assert.ok(planWithBrief.steps.some(s => s.action === 'animate_automatically'));
    ok('YOUTUBE_OPTIMIZED DOES gain them when the brief explicitly asked for b-roll/cutaways');
}

// 5. CLEAN_EDIT does not gain the FULL_BUILD visual extras or duplicate footage.
{
    const plan = LongFormEditPlanner.generatePlan({ ...baseAnalysis, editMode: 'CLEAN_EDIT' }, {
        visualBrief: { wantsContextualBroll: true, wantsMotionGraphics: true, colorMoodQuery: 'cinematic moody dramatic' },
    });
    const actions = plan.steps.map(s => s.action);
    assert.ok(!actions.includes('place_contextual_broll') && !actions.includes('animate_automatically') && !actions.includes('apply_lut'));
    assert.ok(!actions.includes('identify_quotable_moments'), 'cleanup must not add duplicate footage to a Highlights track');
    ok('CLEAN_EDIT does not add visual extras or duplicate highlight footage');
}

// 5b. FULL_BUILD edits the source timeline directly; standalone highlight
// extraction stays available as an explicitly requested operation.
{
    const plan = LongFormEditPlanner.generatePlan(baseAnalysis, {});
    assert.ok(!plan.steps.some(s => s.action === 'identify_quotable_moments'), 'a full build must not overlay extracted copies of source footage');
    ok('FULL_BUILD does not add automatic highlight duplicates');
}


// 6. An explicit brand/accent color in the brief adds a set_brand_kit step
// BEFORE the graphics steps, so everything placed afterward takes it.
{
    const plan = LongFormEditPlanner.generatePlan(baseAnalysis, {
        visualBrief: { wantsContextualBroll: true, wantsMotionGraphics: true, colorMoodQuery: null, accentColorHex: '#0d9488' },
    });
    const actions = plan.steps.map(s => s.action);
    const brandI = actions.indexOf('set_brand_kit');
    const brollI = actions.indexOf('place_contextual_broll');
    assert.ok(brandI !== -1, 'set_brand_kit step must exist when an accent color was named');
    const brandStep = plan.steps.find(s => s.action === 'set_brand_kit');
    assert.equal(brandStep.args.accent, '#0d9488');
    assert.ok(brandI < brollI, 'brand kit must be set before graphics are placed, so they pick it up immediately');
    ok('an explicit accent color adds set_brand_kit before place_contextual_broll');
}

// 7. No accent color named → no set_brand_kit step (never force a color
// nobody asked for).
{
    const plan = LongFormEditPlanner.generatePlan(baseAnalysis, {
        visualBrief: { wantsContextualBroll: true, wantsMotionGraphics: true, colorMoodQuery: null, accentColorHex: null },
    });
    assert.ok(!plan.steps.some(s => s.action === 'set_brand_kit'));
    ok('no set_brand_kit step when the brief never named a specific brand/accent color');
}

// 8. R126 — place_contextual_broll gets autoLayout:true in its step args,
// so an automatically-placed cutaway can vary its layout per clip instead of
// always defaulting to a full-frame cutaway for its whole duration.
{
    const plan = LongFormEditPlanner.generatePlan(baseAnalysis, {});
    const brollStep = plan.steps.find(s => s.action === 'place_contextual_broll');
    assert.ok(brollStep, 'place_contextual_broll step must exist');
    assert.equal(brollStep.args?.autoLayout, true, 'place_contextual_broll must opt into automatic layout variety');
    ok('place_contextual_broll step carries args.autoLayout = true for FULL_BUILD');
}

realLog('\nALL LONG-FORM VISUAL STEPS TESTS PASSED');
