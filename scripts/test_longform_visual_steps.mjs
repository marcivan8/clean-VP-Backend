// R125 — FULL_BUILD never placed contextual b-roll or ran automatic motion
// graphics at all before this, regardless of the brief's explicit "do not
// simply add subtitles, make the video visually communicate the ideas"
// instruction. Pins: FULL_BUILD always gets place_contextual_broll +
// animate_automatically (after captions, so keyword-emphasis detection has
// text clips to read); color grading only happens when the brief actually
// used mood/color language; YOUTUBE_OPTIMIZED is opt-in, not unconditional;
// CLEAN_EDIT is untouched.
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;

const realLog = console.log;
console.log = () => {}; console.warn = () => {}; console.info = () => {};

const { LongFormEditPlanner } = await import('../client/src/agent/LongFormEditPlanner.js');

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

// 1. FULL_BUILD always gets b-roll + motion graphics, AFTER captions.
{
    const plan = LongFormEditPlanner.generatePlan(baseAnalysis, {});
    const actions = plan.steps.map(s => s.action);
    const capIdx = actions.indexOf('auto_captions');
    const brollIdx = actions.indexOf('place_contextual_broll');
    const animIdx = actions.indexOf('animate_automatically');
    assert.ok(capIdx !== -1 && brollIdx !== -1 && animIdx !== -1, 'all three steps must be present');
    assert.ok(capIdx < brollIdx, 'captions must be generated before b-roll/motion graphics run');
    assert.ok(brollIdx < animIdx, 'b-roll placed before animate_automatically (order in _visualSteps)');
    ok('FULL_BUILD unconditionally gets place_contextual_broll + animate_automatically, after captions');
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

// 5. CLEAN_EDIT is completely untouched.
{
    const plan = LongFormEditPlanner.generatePlan({ ...baseAnalysis, editMode: 'CLEAN_EDIT' }, {
        visualBrief: { wantsContextualBroll: true, wantsMotionGraphics: true, colorMoodQuery: 'cinematic moody dramatic' },
    });
    const actions = plan.steps.map(s => s.action);
    assert.ok(!actions.includes('place_contextual_broll') && !actions.includes('animate_automatically') && !actions.includes('apply_lut'));
    ok('CLEAN_EDIT is untouched regardless of what the visual brief says');
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
