#!/usr/bin/env node
/**
 * Regression: the compositor's EXPORT half (CLAUDE.md R60).
 *
 * `scripts/test_compositor.js` proves the plan is correct. This proves FFmpeg
 * actually executes it — and, unusually for this codebase, most of it is
 * verified by RUNNING FFMPEG rather than by matching source strings. The filter
 * graph either draws the overlay or it doesn't, and that is cheap to prove.
 * §4 of `test_lut_export.js` set the precedent; the reasoning is the same: a
 * graph that compiles cleanly and composites nothing is indistinguishable from
 * the bug it replaced.
 *
 * The single most important section is §5. It checks that the overlay is
 * ABSENT outside its own time window, by comparing real decoded frames. An
 * overlay that renders but never disappears looks correct in a thumbnail and is
 * wrong for the rest of the video.
 *
 * Skips the FFmpeg sections gracefully when no binary is present so CI without
 * ffmpeg still runs the compile-only checks.
 *
 * Run: node scripts/test_compositor_export.js
 */

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let passed = 0, failed = 0, skipped = 0;
const check = (n, c, d) => {
    if (c) { passed++; console.log(`  ✓ ${n}`); }
    else { failed++; console.log(`  ✗ ${n}`); if (d) console.log(`      ${d}`); }
};
const skip = (n, why) => { skipped++; console.log(`  – ${n} (skipped: ${why})`); };
const section = (t) => console.log(`\n${t}`);

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => {
    try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
    catch (err) { console.log(`  ✗ could not read ${rel} — ${err.code || err.message}`); failed++; return ''; }
};

const {
    compileCompositionPlan,
    validateCompositionPlanShape,
    buildPiecewiseExpr,
    decimate,
    SUPPORTED_PLAN_VERSION,
} = require(path.join(ROOT, 'server/compositor/CompositorCompiler.js'));
const { compileTimelineVisualEffects } = require(path.join(ROOT, 'jobs/exportProcessor.js'));

// Build plans with the REAL client Compositor, so this exercises the true
// client→worker path rather than a hand-written plan that could drift from it.
function loadCompositor() {
    const order = ['Easing', 'MotionSchema', 'MotionPresetExpansion', 'MotionExpression', 'SpatialMotion', 'AudioReactive', 'MotionResolver', 'MotionPresets', 'EffectTiming', 'CaptionModel', 'ClipAdapter', 'Compositor'];
    let combined = '';
    for (const name of order) {
        let src = read(`client/src/motion/${name}.js`);
        src = src
            .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
            .replace(/^\s*export\s+default\s+\{[\s\S]*?\};\s*$/gm, '')
            .replace(/^\s*export\s+default\s+[^;]+;\s*$/gm, '')
            .replace(/\bexport\s+(const|function|class|let)\b/g, '$1');
        combined += src + '\n';
    }
    combined += 'return { buildCompositionPlan, buildPreset, validateCompositionPlan, COMPOSITION_PLAN_VERSION };';
    // eslint-disable-next-line no-new-func
    return new Function(combined)();
}
const C = loadCompositor();

function ffmpegBin() {
    // Exercise the same renderer selected by exportProcessor. CI installs a
    // system FFmpeg for drawtext fallback, but exports prefer ffmpeg-static
    // when it is available; preferring PATH here caused runtime gblur command
    // checks to run against a different FFmpeg build than production.
    try {
        const bundled = require('ffmpeg-static');
        if (bundled) return bundled;
    } catch { /* use a system binary when the optional package is unavailable */ }
    for (const bin of ['ffmpeg', '/usr/bin/ffmpeg']) {
        const r = spawnSync(bin, ['-version'], { encoding: 'utf8' });
        if (r.status === 0) return bin;
    }
    return null;
}
const FFMPEG = ffmpegBin();

const W = 640, H = 360;
const vclip = (o) => ({
    id: o.id, type: o.type || 'video', start: o.start, duration: o.duration,
    speed: 1, offset: 0, url: `file://${o.id}`,
    metadata: { resolution: { w: o.w || 200, h: o.h || 200 } },
    ...o.extra,
});
const makeTracks = (overlayClips, baseSpeed = 1) => ([
    { id: 'v1', type: 'video', order: 0, clips: [vclip({ id: 'base', start: 0, duration: 3, w: W, h: H, extra: { speed: baseSpeed } })] },
    { id: 'v2', type: 'video', order: 1, clips: overlayClips },
]);
const planFor = (overlayClips, baseSpeed = 1) => {
    const p = C.buildCompositionPlan(makeTracks(overlayClips, baseSpeed), { width: W, height: H, fps: 15 });
    p.renderWidth = W; p.renderHeight = H;
    return p;
};

section('1 · The client and worker agree on the plan version');
{
    check('worker\'s SUPPORTED_PLAN_VERSION matches the client\'s COMPOSITION_PLAN_VERSION',
        SUPPORTED_PLAN_VERSION === C.COMPOSITION_PLAN_VERSION,
        `worker=${SUPPORTED_PLAN_VERSION} client=${C.COMPOSITION_PLAN_VERSION} — these deploy independently; a mismatch means a browser tab open across a deploy posts plans the worker silently mis-renders`);
    const stack = [{ id: 'outer-comp', type: 'composition', opacity: 0.5, blendMode: 'screen', effects: [] }];
    check('composition boundaries survive flatten-plan serialization for isolated preview/export rendering',
        JSON.stringify(planFor([vclip({ id: 'nested-child', start: 0, duration: 1, extra: { compositionStack: stack } })]).overlays[0].compositionStack) === JSON.stringify(stack));
    const procedural = planFor([vclip({ id: 'procedural-child', start: 0, duration: 1, extra: {
        x: 50, y: 50,
        compositionStack: [{ id: 'procedural-group', type: 'group', start: 0, duration: 1, opacity: 1,
            transformExpressions: { x: 'sin(t)*10', scaleX: '1+0.1*t', scaleY: '1+0.05*t' }, effects: [] }],
    } })]).overlays[0];
    check('parent transform expressions are sampled into export geometry',
        procedural.geometry.some(sample => sample.x > procedural.geometry[0].x + 0.01),
        JSON.stringify(procedural.geometry));
    check('procedural parent axis scales reach export width and height samples',
        procedural.geometry.some(sample => sample.w > procedural.geometry[0].w + 0.005)
            && procedural.geometry.some(sample => sample.h > procedural.geometry[0].h + 0.005),
        JSON.stringify(procedural.geometry));
    const motionPath = planFor([vclip({ id: 'motion-path-child', start: 0, duration: 3, extra: {
        x: 30, y: 50,
        motionPath: { points: [[0, 0], [40, 0]], duration: 3, easing: 'linear', arcLength: true },
    } })]).overlays[0];
    check('authored motion paths reach the shared export geometry plan',
        motionPath.geometry[0].x < 0.2 && motionPath.geometry.at(-1).x > 0.5,
        JSON.stringify(motionPath.geometry));
}

section('2 · The worker refuses plans it must not execute');
{
    const good = planFor([vclip({ id: 'ov', start: 0.5, duration: 2 })]);
    const goodGraph = compileCompositionPlan(good, [{ overlayId: good.overlays[0].id, inputIndex: 1 }]);
    check('export overlay gates use the same half-open window as preview',
        goodGraph.filterComplex.includes(`enable='(gte(t,${good.overlays[0].outputStart})*lt(t,${good.overlays[0].outputEnd}))'`)
            && !goodGraph.filterComplex.includes(`between(t,${good.overlays[0].outputStart},${good.overlays[0].outputEnd})`),
        goodGraph.filterComplex);
    check('a well-formed plan is accepted', validateCompositionPlanShape(good, W, H).length === 0,
        validateCompositionPlanShape(good, W, H).join('; '));

    check('a future plan version is refused',
        validateCompositionPlanShape({ ...good, version: 999 }, W, H).length > 0,
        'executing a plan whose shape you are guessing at produces a wrong video nothing flags');
    // 640x360 is 16:9. 1080x1920 is 9:16 — a genuinely different SHAPE, not
    // just a different size. (An earlier version of this check used 1920x1080,
    // which is the same aspect as the plan and correctly passed validation —
    // the test was wrong, not the validator.)
    check('a MISMATCHED ASPECT is refused',
        validateCompositionPlanShape(good, 1080, 1920).length > 0,
        'geometry is normalised so resolution is free, but a height fraction was derived using the authoring aspect');
    check('but a different RESOLUTION at the same aspect is fine',
        validateCompositionPlanShape(good, W * 3, H * 3).length === 0,
        'this is the payoff of normalised geometry — one plan, any resolution');
    check('an overlay with no source is refused',
        validateCompositionPlanShape({ ...good, overlays: [{ ...good.overlays[0], source: {} }] }, W, H).length > 0);
    const vector = { kind: 'path', w: 64, h: 64, pathData: 'M0 0L64 64', fill: 'none', stroke: '#fff', strokeWidth: 2 };
    const vectorPlan = planFor([vclip({ id: 'inline-vector', start: 0.5, duration: 1, extra: { type: 'vector', vector } })]);
    check('inline vector plans pass both client and worker validation without a URL',
        C.validateCompositionPlan(vectorPlan).valid && validateCompositionPlanShape(vectorPlan, W, H).length === 0,
        [...C.validateCompositionPlan(vectorPlan).errors, ...validateCompositionPlanShape(vectorPlan, W, H)].join('; '));
    const ellipsePlan = { ...vectorPlan, overlays: [{ ...vectorPlan.overlays[0], source: { type: 'vector', vector: { kind: 'ellipse', w: 120, h: 72 } } }] };
    check('ellipse vector sources supported by the renderer pass client and worker validation',
        C.validateCompositionPlan(ellipsePlan).valid && validateCompositionPlanShape(ellipsePlan, W, H).length === 0,
        [...C.validateCompositionPlan(ellipsePlan).errors, ...validateCompositionPlanShape(ellipsePlan, W, H)].join('; '));
    check('malformed inline vector path data is refused by worker validation',
        validateCompositionPlanShape({ ...vectorPlan, overlays: [{ ...vectorPlan.overlays[0], source: { type: 'vector', vector: { kind: 'path', w: 64, h: 64, pathData: '' } } }] }, W, H)
            .some(error => /resolvable source/.test(error)));
    check('non-finite export windows are refused',
        validateCompositionPlanShape({ ...good, overlays: [{ ...good.overlays[0], outputEnd: Infinity }] }, W, H).length > 0);
    check('non-finite transform geometry is refused',
        validateCompositionPlanShape({ ...good, overlays: [{ ...good.overlays[0], geometry: [{ ...good.overlays[0].geometry[0], rotation: null }] }] }, W, H).length > 0);
    check('out-of-range opacity is refused',
        validateCompositionPlanShape({ ...good, overlays: [{ ...good.overlays[0], geometry: [{ ...good.overlays[0].geometry[0], opacity: 1.5 }] }] }, W, H).length > 0);
    check('invalid nested-composition opacity and blend modes are refused',
        validateCompositionPlanShape({ ...good, overlays: [{ ...good.overlays[0], compositionStack: [{ id: 'bad', opacity: 2, blendMode: 'not-a-mode' }] }] }, W, H)
            .some(error => /composition stack/.test(error)));
    const groupGlowPlan = { ...good, overlays: [{ ...good.overlays[0], compositionStack: [{ id: 'fx', opacity: 1, effects: [{ kind: 'glow', params: { threshold: 0.55, intensity: 0.8, radius: 12, color: '#ff8844' } }] }] }] };
    check('isolated composition highlight glow is accepted and compiled into its own bloom graph',
        validateCompositionPlanShape(groupGlowPlan, W, H).length === 0
            && /split\[comp/.test(compileCompositionPlan(groupGlowPlan, [{ overlayId: groupGlowPlan.overlays[0].id, inputIndex: 1 }]).filterComplex)
            && /gblur=sigma=12/.test(compileCompositionPlan(groupGlowPlan, [{ overlayId: groupGlowPlan.overlays[0].id, inputIndex: 1 }]).filterComplex));
    const animatedGroupGlowPlan = { ...good, overlays: [{ ...good.overlays[0], compositionStack: [{ id: 'fx-glow', opacity: 1, effects: [{
        kind: 'glow', params: { threshold: 0.7, intensity: 1, radius: 8, color: '#ff8844' },
        samples: { threshold: [{ t: 0, value: 0.4 }, { t: 1, value: 0.8 }], intensity: [{ t: 0, value: 0 }, { t: 1, value: 1.5 }], radius: [{ t: 0, value: 2 }, { t: 1, value: 14 }] },
    }] }] }] };
    const animatedGroupGlowGraph = compileCompositionPlan(animatedGroupGlowPlan, [{ overlayId: animatedGroupGlowPlan.overlays[0].id, inputIndex: 1 }]);
    check('animated isolated glow validates and compiles sampled threshold, intensity, and radius tracks',
        C.validateCompositionPlan(animatedGroupGlowPlan).valid && validateCompositionPlanShape(animatedGroupGlowPlan, W, H).length === 0
            && /T/.test(animatedGroupGlowGraph.filterComplex) && /sendcmd=c=/.test(animatedGroupGlowGraph.filterComplex)
            && /gblur@comp\d+_glow_\d+=sigma=/.test(animatedGroupGlowGraph.filterComplex),
        JSON.stringify({ client: C.validateCompositionPlan(animatedGroupGlowPlan), worker: validateCompositionPlanShape(animatedGroupGlowPlan, W, H), graph: animatedGroupGlowGraph.filterComplex }));
    const animatedGroupBlurPlan = { ...good, overlays: [{ ...good.overlays[0], compositionStack: [{ id: 'fx-blur', opacity: 1, effects: [{
        kind: 'blur', samples: { radius: [{ t: 0, value: 0 }, { t: 1, value: 8 }] },
    }] }] }] };
    const animatedGroupBlurGraph = compileCompositionPlan(animatedGroupBlurPlan, [{ overlayId: animatedGroupBlurPlan.overlays[0].id, inputIndex: 1 }]);
    check('animated group blur passes client and worker validation and compiles to timed FFmpeg commands',
        C.validateCompositionPlan(animatedGroupBlurPlan).valid && validateCompositionPlanShape(animatedGroupBlurPlan, W, H).length === 0
            && /sendcmd=c=/.test(animatedGroupBlurGraph.filterComplex)
            && /gblur@comp\d+_blur=sigma=/.test(animatedGroupBlurGraph.filterComplex));
    const nestedBlurPlan = { ...good, overlays: [{ ...good.overlays[0], compositionStack: [
        { id: 'parent-blur', opacity: 1, effects: [{ kind: 'blur', samples: { radius: [{ t: 0, value: 0 }, { t: 1, value: 4 }] } }] },
        { id: 'child-blur', opacity: 1, effects: [{ kind: 'blur', samples: { radius: [{ t: 0, value: 0 }, { t: 1, value: 8 }] } }] },
    ] }] };
    const nestedBlurGraph = compileCompositionPlan(nestedBlurPlan, [{ overlayId: nestedBlurPlan.overlays[0].id, inputIndex: 1 }]);
    const blurTargets = [...nestedBlurGraph.filterComplex.matchAll(/gblur@([a-zA-Z0-9_]+)=sigma=/g)].map(match => match[1]);
    check('nested animated composition blurs receive unique runtime-command targets', blurTargets.length === 2 && blurTargets[0] !== blurTargets[1]);
    check('static composition color grading is accepted by isolated export',
        validateCompositionPlanShape({ ...good, overlays: [{ ...good.overlays[0], compositionStack: [{ id: 'grade-static', opacity: 1, effects: [{
            kind: 'color_grade', params: { brightness: 110, contrast: 105, saturation: 90 },
        }] }] }] }, W, H).length === 0);
    check('garbage never throws',
        validateCompositionPlanShape(null, W, H).length > 0 && validateCompositionPlanShape(7, W, H).length > 0);
}

section('3 · Compilation produces a sane filter graph');
{
    const plan = planFor([vclip({ id: 'ov', start: 0.5, duration: 2, extra: { x: 50, y: 50 } })]);
    const compiled = compileCompositionPlan(plan, [{ overlayId: plan.overlays[0].id, inputIndex: 1 }]);

    check('a graph is produced', !!compiled && typeof compiled.filterComplex === 'string');
    check('it ends at the documented output label', compiled.outputLabel === 'vout'
        && compiled.filterComplex.includes('[vout]'));
    check('the overlay is time-gated with enable=',
        /enable='\(gte\(t,[^)]+\)\*lt\(t,[^)]+\)\)'/.test(compiled.filterComplex),
        'without it the overlay\'s last frame sticks for the rest of the video');
    check('the overlay stream is shifted onto output time with setpts',
        /setpts=PTS-STARTPTS\+/.test(compiled.filterComplex));
    check('alpha is established before compositing',
        compiled.filterComplex.includes('format=yuva420p'));
    check('a static overlay compiles to plain numbers, not an expression',
        !/scale=w='/.test(compiled.filterComplex),
        'a static overlay should not pay for per-frame expression evaluation');

    const mirrorPlan = planFor([vclip({ id: 'mirrored-static', start: 0.5, duration: 1,
        extra: { scaleX: -1, scaleY: 1 } })]);
    const mirrorGraph = compileCompositionPlan(mirrorPlan, [{ overlayId: mirrorPlan.overlays[0].id, inputIndex: 1 }]);
    check('a static negative scale exports as a horizontal flip with positive geometry',
        mirrorPlan.overlays[0].geometry[0].flipH === 1
            && mirrorPlan.overlays[0].geometry[0].w > 0
            && /,hflip(?:,|\[)/.test(mirrorGraph.filterComplex),
        mirrorGraph.filterComplex);

    const animatedMirror = planFor([vclip({ id: 'mirrored-animated', start: 0.5, duration: 1 })]);
    const mirrorOverlay = animatedMirror.overlays[0];
    const firstMirrorSample = mirrorOverlay.geometry[0];
    mirrorOverlay.geometry = [
        { ...firstMirrorSample, t: mirrorOverlay.outputStart, flipH: 0 },
        { ...firstMirrorSample, t: mirrorOverlay.outputStart + 0.5, flipH: 1 },
        { ...firstMirrorSample, t: mirrorOverlay.outputEnd, flipH: 1 },
    ];
    const animatedMirrorGraph = compileCompositionPlan(animatedMirror,
        [{ overlayId: mirrorOverlay.id, inputIndex: 1 }]);
    check('animated scale crossing zero exports a time-sampled mirror channel',
        /hflip=enable='gte\(if\(lt\(t,/.test(animatedMirrorGraph.filterComplex),
        animatedMirrorGraph.filterComplex);

    // Nothing to draw must yield null, not an empty-but-valid graph.
    check('an overlay whose source was never fetched is dropped',
        compileCompositionPlan(plan, []) === null,
        'one unreachable sticker must not cost the user the whole export');
    check('a no-op plan compiles to null',
        compileCompositionPlan({ version: 1, overlays: [] }, [{ overlayId: 'x', inputIndex: 1 }]) === null);

    // Expression shape.
    const samples = [{ t: 0, x: 0 }, { t: 1, x: 10 }, { t: 2, x: 20 }];
    check('piecewise expressions use the proven nested-if shape',
        /^if\(lt\(t,/.test(buildPiecewiseExpr(samples, 'x')));
    check('a single sample compiles to a bare number',
        buildPiecewiseExpr([{ t: 0, x: 5 }], 'x') === '5');
    check('the scale multiplier is applied',
        buildPiecewiseExpr([{ t: 0, x: 0.5 }], 'x', 640) === '320',
        'normalised units become pixels here and nowhere else');

    // Sample reduction backstop: preserve authored motion events rather than
    // selecting evenly spaced points that may skip brief reversals.
    const many = Array.from({ length: 500 }, (_, i) => ({
        t: i * 0.1, x: i / 500, y: i === 103 || i === 323 ? 0.2 : 0,
        w: 0.2, h: 0.2, opacity: 1, rotation: 0, blur: 0,
    }));
    const reduced = decimate(many, 60);
    check('runaway sample counts are bounded by the expression budget', reduced.length <= 60,
        'each sample nests another if() — an unbounded expression fails at render time, on a real export');
    check('sample reduction keeps both endpoints',
        reduced[0] === many[0] && reduced.at(-1) === many.at(-1));
    check('sample reduction preserves brief authored motion reversals',
        reduced.includes(many[103]) && reduced.includes(many[323]),
        'uniform thinning skipped narrow path excursions despite available expression budget');
    const linear = Array.from({ length: 500 }, (_, i) => ({ t: i * 0.1, x: i / 500, y: i / 500 }));
    check('collinear motion collapses to its endpoints',
        decimate(linear, 60).length === 2,
        'linear motion should not spend expression budget on redundant samples');

    const narrowPeak = 10.32;
    const longBase = vclip({ id: 'long-effect-base', start: 0, duration: 20, w: W, h: H });
    const longOverlay = vclip({ id: 'long-effect-overlay', start: 0, duration: 20, extra: {
        effects: [{ kind: 'brightness', params: { amount: { value: 1 } }, keyframes: { amount: [
            { time: 0, value: 1 }, { time: 10.31, value: 1 }, { time: narrowPeak, value: 4 },
            { time: 10.33, value: 1 }, { time: 20, value: 1 },
        ] } }],
    } });
    const longPlan = C.buildCompositionPlan([
        { id: 'long-base-track', type: 'video', order: 0, clips: [longBase] },
        { id: 'long-overlay-track', type: 'video', order: 1, clips: [longOverlay] },
    ], { width: W, height: H, fps: 15 });
    const longSamples = longPlan.overlays[0].effects[0].samples.amount;
    check('long keyed effect sampling stays within the FFmpeg expression budget', longSamples.length <= 60,
        `sample count=${longSamples.length}`);
    check('long keyed effect sampling retains brief authored keyframe peaks',
        longSamples.some(sample => Math.abs(sample.t - narrowPeak) < 0.0001 && Math.abs(sample.value - 4) < 0.0001),
        `peak at ${narrowPeak}s is missing from ${longSamples.length} exported samples`);
    const overBudgetKeyframes = Array.from({ length: 62 }, (_, index) => ({ time: index / 3, value: 1 + (index % 2) }));
    const overBudgetPlan = C.buildCompositionPlan([
        { id: 'over-budget-base', type: 'video', order: 0, clips: [longBase] },
        { id: 'over-budget-overlay', type: 'video', order: 1, clips: [vclip({ id: 'over-budget-effect', start: 0, duration: 20, extra: {
            effects: [{ kind: 'brightness', params: { amount: { value: 1 } }, keyframes: { amount: overBudgetKeyframes } }],
        } })] },
    ], { width: W, height: H, fps: 15 });
    check('over-budget authored effect keyframes are surfaced instead of silently discarded',
        overBudgetPlan.overlays[0].effects[0].samples.amount.length > 60
        && validateCompositionPlanShape(overBudgetPlan, W, H).some(error => /effect samples/.test(error)),
        `samples=${overBudgetPlan.overlays[0].effects[0].samples.amount.length}`);
    const unsupportedEffectPlan = planFor([vclip({ id: 'unsupported-effect', start: 0.5, duration: 2, extra: {
        effects: [{ kind: 'imaginary-effect', enabled: true, params: {} }],
    } })]);
    check('worker refuses enabled effects that its renderer would otherwise silently drop',
        validateCompositionPlanShape(unsupportedEffectPlan, W, H).some(error => /unsupported enabled effect imaginary-effect/.test(error)));
    const videoGlowPlan = planFor([vclip({ id: 'video-glow', start: 0.5, duration: 2, extra: {
        effects: [{ kind: 'glow', params: { threshold: 0.7, intensity: 1, radius: 12, color: [0, 1, 1] } }],
    } })]);
    const videoGlowGraph = compileCompositionPlan(videoGlowPlan, [{ overlayId: videoGlowPlan.overlays[0].id, inputIndex: 1 }]);
    check('video glow passes worker validation and reaches the dedicated top-effect compiler',
        validateCompositionPlanShape(videoGlowPlan, W, H).length === 0
            && /gblur=sigma=/.test(videoGlowGraph.filterComplex),
        JSON.stringify({ errors: validateCompositionPlanShape(videoGlowPlan, W, H), graph: videoGlowGraph.filterComplex }));
    const imageShadowPlan = planFor([vclip({ id: 'image-shadow', type: 'image', start: 0.5, duration: 2, extra: {
        effects: [{ kind: 'shadow', params: { x: 8, y: 10, blur: 12, opacity: 0.6, color: '#000000' } }],
    } })]);
    const imageShadowGraph = compileCompositionPlan(imageShadowPlan, [{ overlayId: imageShadowPlan.overlays[0].id, inputIndex: 1 }]);
    check('image shadow passes worker validation and reaches the dedicated alpha-effect compiler',
        validateCompositionPlanShape(imageShadowPlan, W, H).length === 0
            && /gblur=sigma=/.test(imageShadowGraph.filterComplex)
            && /overlay=x=/.test(imageShadowGraph.filterComplex),
        JSON.stringify({ errors: validateCompositionPlanShape(imageShadowPlan, W, H), graph: imageShadowGraph.filterComplex }));
    const imageStrokePlan = planFor([vclip({ id: 'image-stroke', type: 'image', start: 0.5, duration: 2, extra: {
        effects: [{ kind: 'stroke', params: { width: 3, color: '#ffffff', opacity: 1 } }],
    } })]);
    check('image stroke passes worker validation and reaches the dedicated silhouette compiler',
        validateCompositionPlanShape(imageStrokePlan, W, H).length === 0
            && /dilation=coordinates=255/.test(compileCompositionPlan(imageStrokePlan, [{ overlayId: imageStrokePlan.overlays[0].id, inputIndex: 1 }]).filterComplex),
        validateCompositionPlanShape(imageStrokePlan, W, H).join('; '));
    const videoStrokePlan = planFor([vclip({ id: 'video-stroke', start: 0.5, duration: 2, extra: {
        effects: [{ kind: 'stroke', params: { width: 3, color: '#ffffff', opacity: 1 } }],
    } })]);
    check('worker rejects video stroke because its silhouette compiler only supports image and sticker sources',
        validateCompositionPlanShape(videoStrokePlan, W, H).some(error => /cannot apply stroke to source type video/.test(error)));
    const disabledUnknownEffectPlan = planFor([vclip({ id: 'disabled-unknown-effect', start: 0.5, duration: 2, extra: {
        effects: [{ kind: 'imaginary-effect', enabled: false, params: {} }],
    } })]);
    check('disabled unknown effects do not block export', validateCompositionPlanShape(disabledUnknownEffectPlan, W, H).length === 0,
        validateCompositionPlanShape(disabledUnknownEffectPlan, W, H).join('; '));
}

section('3a · Shape masks compile through the shared scene plan');
{
    for (const shape of ['circle', 'rounded-rectangle', 'capsule', 'callout', 'polygon', 'star', 'arrow']) {
        const plan = planFor([vclip({ id: `mask-${shape}`, start: 0.5, duration: 2, extra: {
            x: 50, y: 50, sceneMask: { kind: 'shape', shape, radius: 0.2, sides: 5, points: 5, inset: 0.1,
                x: shape === 'circle' ? 0.1 : null, y: shape === 'circle' ? 0.1 : null,
                w: shape === 'circle' ? 0.8 : null, h: shape === 'circle' ? 0.6 : null,
                feather: shape === 'circle' ? 0.04 : 0 },
        } })]);
        const compiled = compileCompositionPlan(plan, [{ overlayId: plan.overlays[0].id, inputIndex: 1 }]);
        check(`${shape} mask is accepted by worker validation`, validateCompositionPlanShape(plan, W, H).length === 0);
        check(`${shape} mask compiles to an alpha expression`, compiled.filterComplex.includes("a='if(")
            && (shape === 'circle' ? compiled.filterComplex.includes('pow((X-W*')
                : shape === 'rounded-rectangle' || shape === 'capsule' || shape === 'callout' ? compiled.filterComplex.includes('sqrt(pow(max(')
                    : compiled.filterComplex.includes('mod(')));
        if (shape === 'circle') {
            check('circle masks use equal horizontal and vertical radii inside non-square bounds',
                compiled.filterComplex.includes('pow((X-W*0.5)/(W*0.3),2)+pow((Y-H*0.4)/(H*0.3),2)'));
        }
        if (shape === 'circle') {
            check('feathered shape mask compiles to alpha-only blur', compiled.filterComplex.includes('gblur=sigma=')
                && compiled.filterComplex.includes(':planes=8'));
            const invalidFeather = JSON.parse(JSON.stringify(plan));
            invalidFeather.overlays[0].sceneMask.feather = 0.26;
            check('worker rejects feather values outside the authored range', validateCompositionPlanShape(invalidFeather, W, H)
                .some(error => /shape mask feather outside/.test(error)));
        }
        if (FFMPEG) {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), `comp-mask-${shape}-`));
            makeSources(dir);
            const { r, out } = runGraph(dir, compiled, `${shape}.mp4`);
            check(`${shape} mask filter graph executes in FFmpeg`, r.status === 0,
                (r.stderr || '').split('\n').slice(-4).join(' | '));
            if (shape === 'polygon' || shape === 'star' || shape === 'arrow') {
                const centre = regionColor(out, 1, { x: 315, y: 175, w: 10, h: 10 });
                const corner = regionColor(out, 1, { x: 240, y: 100, w: 10, h: 10 });
                check(`${shape} mask preserves its centre and cuts away its corners`,
                    colorDist(centre, 'ff0000') < 45 && colorDist(corner, '808080') < 35,
                    `centre=${centre}, corner=${corner}`);
            }
            if (shape === 'circle') {
                const hardPlan = JSON.parse(JSON.stringify(plan));
                hardPlan.overlays[0].sceneMask.feather = 0;
                const hardGraph = compileCompositionPlan(hardPlan, [{ overlayId: hardPlan.overlays[0].id, inputIndex: 1 }]);
                const hard = runGraph(dir, hardGraph, 'circle-hard.mp4');
                const partialPixels = video => {
                    const pixels = framePixels(video, 1);
                    if (!pixels) return 0;
                    let count = 0;
                    for (let offset = 0; offset < pixels.length; offset += 3) {
                        const color = pixels.subarray(offset, offset + 3).toString('hex');
                        if (colorDist(color, '808080') > 24 && colorDist(color, 'ff0000') > 24) count++;
                    }
                    return count;
                };
                const softCount = partialPixels(out), hardCount = partialPixels(hard.out);
                check('feather produces a wider visible alpha transition than a hard mask', hard.r.status === 0 && softCount > hardCount + 100,
                    `soft transition pixels=${softCount}, hard-mask edge pixels=${hardCount}`);
            }
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
}

section('3b · Image track mattes use source alpha through export');
if (!FFMPEG) {
    skip('image track matte export', 'no ffmpeg binary available');
} else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comp-layer-matte-'));
    makeSources(dir);
    const maskPath = path.join(dir, 'circle-matte.png');
    const maskResult = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
        "color=c=white@0:s=200x200:d=1,format=rgba,geq=r=255:g=255:b=255:a='if(lte(pow(X-100,2)+pow(Y-100,2),6400),255,0)'",
        '-frames:v', '1', '-y', maskPath], { encoding: 'utf8', timeout: 60_000 });
    check('transparent image matte fixture is generated', maskResult.status === 0, maskResult.stderr);
    const tracks = [
        { id: 'base-track', type: 'video', order: 0, clips: [vclip({ id: 'base', start: 0, duration: 3, w: W, h: H })] },
        { id: 'overlay-track', type: 'overlay', order: 0, clips: [
            vclip({ id: 'target-node', type: 'video', start: 0.5, duration: 2, extra: {
                sceneId: 'matte-scene', sceneNodeId: 'target-node', sceneMask: { kind: 'layer', nodeId: 'matte-node' },
            } }),
            vclip({ id: 'matte-node', type: 'image', start: 0.5, duration: 2, extra: {
                sceneId: 'matte-scene', sceneNodeId: 'matte-node', url: `file://${maskPath}`,
            } }),
        ] },
    ];
    const plan = C.buildCompositionPlan(tracks, { width: W, height: H, fps: 15 });
    plan.renderWidth = W; plan.renderHeight = H;
    const target = plan.overlays.find(ov => ov.sceneNodeId === 'target-node');
    const matte = plan.overlays.find(ov => ov.sceneNodeId === 'matte-node');
    check('the scene-node reference resolves to an explicit matte-only source',
        target?.sceneMask?.sourceOverlayId === matte?.id && matte?.matteOnly === true);
    const errors = validateCompositionPlanShape(plan, W, H);
    check('the export worker accepts the linked matte plan', errors.length === 0, errors.join('; '));
    const compiled = compileCompositionPlan(plan, [
        { overlayId: target.id, inputIndex: 1 }, { overlayId: matte.id, inputIndex: 2 },
    ]);
    check('the export graph combines target alpha with the matte alpha',
        compiled.filterComplex.includes('alphaextract') && compiled.filterComplex.includes('all_mode=multiply')
        && compiled.filterComplex.includes('alphamerge'));
    const output = path.join(dir, 'matte-output.mp4');
    const render = spawnSync(FFMPEG, [
        '-hide_banner', '-loglevel', 'error', '-i', path.join(dir, 'base.mp4'), '-i', path.join(dir, 'ov.mp4'),
        '-loop', '1', '-t', '3', '-i', maskPath, '-filter_complex', compiled.filterComplex,
        '-map', `[${compiled.outputLabel}]`, '-frames:v', '45', '-pix_fmt', 'yuv420p', '-y', output,
    ], { encoding: 'utf8', timeout: 120_000 });
    check('FFmpeg executes the image track matte graph', render.status === 0,
        (render.stderr || '').split('\n').slice(-5).join(' | '));
    const outside = regionColor(output, 1, { x: 244, y: 104, w: 12, h: 12 });
    const inside = regionColor(output, 1, { x: 314, y: 174, w: 12, h: 12 });
    check('the matte removes pixels outside its alpha silhouette', colorDist(outside, '808080') < 25,
        `outside=${outside}`);
    check('the matte preserves pixels inside its alpha silhouette', colorDist(inside, 'ff0000') < 40,
        `inside=${inside}`);

    target.sceneMask.mode = 'luminance';
    const lumaCompiled = compileCompositionPlan(plan, [
        { overlayId: target.id, inputIndex: 1 }, { overlayId: matte.id, inputIndex: 2 },
    ]);
    check('luminance mode derives matte values from source brightness and preserves its alpha',
        lumaCompiled.filterComplex.includes('format=gray') && lumaCompiled.filterComplex.includes('sourceAlpha')
        && lumaCompiled.filterComplex.includes('lumaAlpha'));
    const lumaOutput = path.join(dir, 'luma-matte-output.mp4');
    const lumaRender = spawnSync(FFMPEG, [
        '-hide_banner', '-loglevel', 'error', '-i', path.join(dir, 'base.mp4'), '-i', path.join(dir, 'ov.mp4'),
        '-loop', '1', '-t', '3', '-i', maskPath, '-filter_complex', lumaCompiled.filterComplex,
        '-map', `[${lumaCompiled.outputLabel}]`, '-frames:v', '45', '-pix_fmt', 'yuv420p', '-y', lumaOutput,
    ], { encoding: 'utf8', timeout: 120_000 });
    check('FFmpeg executes the luminance matte graph', lumaRender.status === 0,
        (lumaRender.stderr || '').split('\n').slice(-5).join(' | '));
    check('luminance matte retains the bright opaque region',
        colorDist(regionColor(lumaOutput, 1, { x: 314, y: 174, w: 12, h: 12 }), 'ff0000') < 40);
    check('luminance matte keeps transparent matte pixels transparent',
        colorDist(regionColor(lumaOutput, 1, { x: 244, y: 104, w: 12, h: 12 }), '808080') < 25);
    target.sceneMask.invert = true;
    const invertedLumaCompiled = compileCompositionPlan(plan, [
        { overlayId: target.id, inputIndex: 1 }, { overlayId: matte.id, inputIndex: 2 },
    ]);
    const invertedLumaOutput = path.join(dir, 'luma-matte-inverted-output.mp4');
    const invertedLumaRender = spawnSync(FFMPEG, [
        '-hide_banner', '-loglevel', 'error', '-i', path.join(dir, 'base.mp4'), '-i', path.join(dir, 'ov.mp4'),
        '-loop', '1', '-t', '3', '-i', maskPath, '-filter_complex', invertedLumaCompiled.filterComplex,
        '-map', `[${invertedLumaCompiled.outputLabel}]`, '-frames:v', '45', '-pix_fmt', 'yuv420p', '-y', invertedLumaOutput,
    ], { encoding: 'utf8', timeout: 120_000 });
    check('inverted luminance matte renders cleanly', invertedLumaRender.status === 0,
        (invertedLumaRender.stderr || '').split('\n').slice(-5).join(' | '));
    check('inverted luminance matte reverses bright and transparent coverage',
        colorDist(regionColor(invertedLumaOutput, 1, { x: 314, y: 174, w: 12, h: 12 }), '808080') < 25
        && colorDist(regionColor(invertedLumaOutput, 1, { x: 244, y: 104, w: 12, h: 12 }), 'ff0000') < 40);

    target.sceneMask.invert = false;
    target.sceneMask.mode = 'alpha';
    target.motionBlur = { enabled: true, samples: 5, shutterAngle: 180, frameRate: 15 };
    target.geometry = [
        { t: 0, x: 0.25, y: 0.25, w: 0.5, h: 0.5, opacity: 1, rotation: 0, blur: 0 },
        { t: 3, x: 0.4, y: 0.25, w: 0.5, h: 0.5, opacity: 1, rotation: 0, blur: 0 },
    ];
    const blurredMatteErrors = validateCompositionPlanShape(plan, W, H);
    const blurredMatte = compileCompositionPlan(plan, [
        { overlayId: target.id, inputIndex: 1 }, { overlayId: matte.id, inputIndex: 2 },
    ]);
    check('transform motion blur and a layer matte compile together', blurredMatteErrors.length === 0
        && (blurredMatte.filterComplex.match(/alphamerge/g) || []).length >= 5,
        blurredMatteErrors.join('; '));
    const blurredMatteOutput = path.join(dir, 'matte-motion-blur-output.mp4');
    const blurredMatteRender = spawnSync(FFMPEG, [
        '-hide_banner', '-loglevel', 'error', '-i', path.join(dir, 'base.mp4'), '-i', path.join(dir, 'ov.mp4'),
        '-loop', '1', '-t', '3', '-i', maskPath, '-filter_complex', blurredMatte.filterComplex,
        '-map', `[${blurredMatte.outputLabel}]`, '-frames:v', '45', '-pix_fmt', 'yuv420p', '-y', blurredMatteOutput,
    ], { encoding: 'utf8', timeout: 120_000 });
    check('FFmpeg executes transform-blurred layer matte compositing', blurredMatteRender.status === 0,
        (blurredMatteRender.stderr || '').split('\n').slice(-5).join(' | '));
    check('the moving shutter samples remain clipped outside the layer matte', blurredMatteRender.status === 0
        && colorDist(regionColor(blurredMatteOutput, 1, { x: 244, y: 104, w: 12, h: 12 }), '808080') < 30);
    const blurredInside = blurredMatteRender.status === 0
        ? regionColor(blurredMatteOutput, 1, { x: 314, y: 174, w: 12, h: 12 }) : null;
    check('the moving shutter samples retain footage inside the layer matte', blurredInside
        && parseInt(blurredInside.slice(0, 2), 16) > parseInt(blurredInside.slice(2, 4), 16) + 25,
        `inside=${blurredInside}`);

    target.geometry = [
        { t: 0, x: 0.25, y: 0.25, w: 0.5, h: 0.5, opacity: 1, rotation: 0, blur: 0 },
        { t: 3, x: 0.26, y: 0.25, w: 0.5, h: 0.5, opacity: 1, rotation: 0, blur: 0 },
    ];
    matte.geometry = [
        { t: 0, x: 0.1, y: 0.25, w: 0.5, h: 0.5, opacity: 1, rotation: 0, blur: 0 },
        { t: 3, x: 0.55, y: 0.25, w: 0.5, h: 0.5, opacity: 1, rotation: 0, blur: 0 },
    ];
    const animatedMatteGraph = compileCompositionPlan(plan, [
        { overlayId: target.id, inputIndex: 1 }, { overlayId: matte.id, inputIndex: 2 },
    ]);
    check('animated matte transforms are sampled at every shutter offset',
        /matte\d+mf\d+/.test(animatedMatteGraph.filterComplex)
        && (animatedMatteGraph.filterComplex.match(/ov\d+mask\d+s\d+/g) || []).length >= 5
        && animatedMatteGraph.filterComplex.includes('min(max((t+'),
        'each shutter sample should receive an independently positioned matte frame');
    const animatedMatteOutput = path.join(dir, 'animated-matte-motion-blur-output.mp4');
    const animatedMatteRender = spawnSync(FFMPEG, [
        '-hide_banner', '-loglevel', 'error', '-i', path.join(dir, 'base.mp4'), '-i', path.join(dir, 'ov.mp4'),
        '-loop', '1', '-t', '3', '-i', maskPath, '-filter_complex', animatedMatteGraph.filterComplex,
        '-map', `[${animatedMatteGraph.outputLabel}]`, '-frames:v', '45', '-pix_fmt', 'yuv420p', '-y', animatedMatteOutput,
    ], { encoding: 'utf8', timeout: 120_000 });
    check('FFmpeg renders motion-blurred footage through an animated layer matte', animatedMatteRender.status === 0,
        (animatedMatteRender.stderr || '').split('\n').slice(-5).join(' | '));
    const matteEarly = animatedMatteRender.status === 0
        ? regionColor(animatedMatteOutput, 1, { x: 245, y: 174, w: 12, h: 12 }) : null;
    const matteLate = animatedMatteRender.status === 0
        ? regionColor(animatedMatteOutput, 2.5, { x: 245, y: 174, w: 12, h: 12 }) : null;
    check('animated matte position changes actual exported coverage over time',
        matteEarly && matteLate
        && parseInt(matteEarly.slice(0, 2), 16) > parseInt(matteEarly.slice(2, 4), 16) + 35
        && colorDist(matteLate, '808080') < 30,
        `early=${matteEarly} late=${matteLate}`);
    fs.rmSync(dir, { recursive: true, force: true });
}

// ── Behavioural: does FFmpeg actually composite? ────────────────────────────

function makeSources(dir) {
    // Base: grey. Overlay: saturated red, so any compositing is unmistakable.
    spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
        '-i', `color=c=0x808080:size=${W}x${H}:duration=3:rate=15`, '-frames:v', '45', '-y',
        path.join(dir, 'base.mp4')], { timeout: 60_000 });
    spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
        '-i', 'color=c=red:size=200x200:duration=3:rate=15', '-frames:v', '45', '-y',
        path.join(dir, 'ov.mp4')], { timeout: 60_000 });
}

function runGraph(dir, compiled, outName) {
    const out = path.join(dir, outName);
    const r = spawnSync(FFMPEG, [
        '-hide_banner', '-loglevel', 'error',
        '-i', path.join(dir, 'base.mp4'),
        '-i', path.join(dir, 'ov.mp4'),
        '-filter_complex', compiled.filterComplex,
        '-map', `[${compiled.outputLabel}]`,
        '-frames:v', '45', '-pix_fmt', 'yuv420p', '-y', out,
    ], { encoding: 'utf8', timeout: 120_000 });
    return { r, out };
}

/** Extract one frame as PNG so frames can be compared. */
function frameAt(dir, video, t, name) {
    const out = path.join(dir, name);
    spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-ss', String(t),
        '-i', video, '-frames:v', '1', '-y', out], { timeout: 60_000 });
    return fs.existsSync(out) ? fs.readFileSync(out) : null;
}

/**
 * Average colour of a region, as `rrggbb`.
 *
 * Byte-comparing whole PNG frames is the obvious way to ask "is the overlay
 * gone?" and it is WRONG: the composited video is re-encoded, so a frame with
 * identical content can still differ by a bit or two of encoder noise once the
 * inter-frame history diverges. That produced a false failure here — the pixels
 * were provably correct (grey → red → grey) while the bytes were not equal.
 * Sampling the region the overlay actually occupies asks the real question.
 */
function regionColor(video, t, crop) {
    const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-ss', String(t),
        '-i', video, '-frames:v', '1',
        '-vf', `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},scale=1:1`,
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { timeout: 60_000, encoding: 'buffer' });
    if (r.status !== 0 || !r.stdout || r.stdout.length < 3) return null;
    return Buffer.from(r.stdout.slice(0, 3)).toString('hex');
}

function framePixels(video, t) {
    const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', video,
        '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { timeout: 60_000, encoding: 'buffer' });
    return r.status === 0 && r.stdout?.length ? Buffer.from(r.stdout) : null;
}

/** Rough colour distance, 0-255 per channel. */
function colorDist(a, b) {
    if (!a || !b) return Infinity;
    let d = 0;
    for (let i = 0; i < 3; i++) {
        d = Math.max(d, Math.abs(parseInt(a.substr(i * 2, 2), 16) - parseInt(b.substr(i * 2, 2), 16)));
    }
    return d;
}

section('4 · FFmpeg executes the graph and the overlay CHANGES PIXELS');
if (!FFMPEG) {
    skip('static overlay renders', 'no ffmpeg binary available');
} else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comp-'));
    makeSources(dir);

    const plan = planFor([vclip({ id: 'ov', start: 0.5, duration: 2, extra: { x: 50, y: 50 } })]);
    const compiled = compileCompositionPlan(plan, [{ overlayId: plan.overlays[0].id, inputIndex: 1 }]);
    const { r, out } = runGraph(dir, compiled, 'static.mp4');

    check('the graph runs without error', r.status === 0,
        (r.stderr || '').split('\n').slice(-4).join(' | '));
    check('it produces a non-empty file', fs.existsSync(out) && fs.statSync(out).size > 0);

    const baseMid = frameAt(dir, path.join(dir, 'base.mp4'), 1.5, 'b-mid.png');
    const compMid = frameAt(dir, out, 1.5, 'c-mid.png');
    check('the composited frame DIFFERS from the base inside the overlay window',
        !!baseMid && !!compMid && !baseMid.equals(compMid),
        'a graph that runs and composites nothing is the same as no compositor at all');

    const pattern = path.join(dir, 'mirror-pattern.mp4');
    const patternResult = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
        'color=c=blue:size=200x200:duration=3:rate=15,drawbox=x=0:y=0:w=100:h=200:color=red:t=fill',
        '-frames:v', '45', '-y', pattern], { encoding: 'utf8', timeout: 60_000 });
    const mirrorPlan = planFor([vclip({ id: 'mirror-pixels', start: 0.5, duration: 2, extra: { x: 50, y: 50, scaleX: -1 } })]);
    const mirrorGraph = compileCompositionPlan(mirrorPlan, [{ overlayId: mirrorPlan.overlays[0].id, inputIndex: 1 }]);
    const mirrorOutput = path.join(dir, 'mirror-pixels.mp4');
    const mirrorRender = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', path.join(dir, 'base.mp4'),
        '-i', pattern, '-filter_complex', mirrorGraph.filterComplex, '-map', `[${mirrorGraph.outputLabel}]`,
        '-frames:v', '45', '-pix_fmt', 'yuv420p', '-y', mirrorOutput], { encoding: 'utf8', timeout: 120_000 });
    check('FFmpeg renders a horizontally mirrored footage layer', patternResult.status === 0 && mirrorRender.status === 0,
        (mirrorRender.stderr || patternResult.stderr || '').split('\n').slice(-4).join(' | '));
    check('negative scale reverses the source halves in the exported pixels',
        colorDist(regionColor(mirrorOutput, 1.5, { x: 250, y: 170, w: 12, h: 12 }), '0000ff') < 45
            && colorDist(regionColor(mirrorOutput, 1.5, { x: 378, y: 170, w: 12, h: 12 }), 'ff0000') < 45,
        'the left source half is blue after mirroring and the right source half is red');

    fs.rmSync(dir, { recursive: true, force: true });
}

section('4a · Authored motion paths move footage overlays in the rendered export');
if (!FFMPEG) {
    skip('motion-path overlay render', 'no ffmpeg binary available');
} else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comp-motion-path-'));
    makeSources(dir);
    const plan = planFor([vclip({ id: 'path-ov', start: 0, duration: 3, extra: {
        x: 30, y: 50,
        motionPath: { points: [[0, 0], [40, 0]], duration: 3, easing: 'linear', arcLength: true },
    } })]);
    const graph = compileCompositionPlan(plan, [{ overlayId: plan.overlays[0].id, inputIndex: 1 }]);
    const { r, out } = runGraph(dir, graph, 'motion-path.mp4');
    check('the motion-path composition renders successfully', r.status === 0,
        (r.stderr || '').split('\n').slice(-4).join(' | '));
    const startPosition = regionColor(out, 0.1, { x: 120, y: 175, w: 12, h: 12 });
    const endPosition = regionColor(out, 2.9, { x: 500, y: 175, w: 12, h: 12 });
    check('the exported layer leaves its starting position and reaches its path endpoint',
        colorDist(startPosition, 'ff0000') < 35 && colorDist(endPosition, 'ff0000') < 35,
        `expected red overlay near the start then endpoint, got ${startPosition} / ${endPosition}`);
    fs.rmSync(dir, { recursive: true, force: true });
}

section('4b · Nested composition opacity is applied once to the isolated group');
if (!FFMPEG) {
    skip('isolated composition opacity', 'no ffmpeg binary available');
} else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comp-isolated-opacity-'));
    makeSources(dir);
    const stack = [{ id: 'opacity-comp', type: 'composition', opacity: 0.5, blendMode: 'source-over', effects: [{ kind: 'contrast', params: { amount: 1.5 } }] }];
    const plan = planFor([
        vclip({ id: 'group-child-a', start: 0, duration: 3, extra: { x: 50, y: 50, opacity: 0.5, compositionStack: stack } }),
        vclip({ id: 'group-child-b', start: 0, duration: 3, extra: { x: 50, y: 50, opacity: 0.5, compositionStack: stack } }),
    ]);
    const compiled = compileCompositionPlan(plan, plan.overlays.map((overlay, index) => ({ overlayId: overlay.id, inputIndex: index + 1 })));
    check('container opacity is removed from each flattened child sample',
        plan.overlays.every(overlay => Math.abs(overlay.geometry[0].opacity - 1) < 0.001));
    check('both overlapping children enter the same isolated group buffer',
        compiled.filterComplex.includes('comp0canvas') && compiled.filterComplex.includes('colorchannelmixer=aa=0.5')
            && compiled.filterComplex.includes('eq=contrast=1.5'));
    const out = path.join(dir, 'isolated-opacity.mp4');
    const render = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error',
        '-i', path.join(dir, 'base.mp4'), '-i', path.join(dir, 'ov.mp4'), '-i', path.join(dir, 'ov.mp4'),
        '-filter_complex', compiled.filterComplex, '-map', `[${compiled.outputLabel}]`,
        '-frames:v', '45', '-pix_fmt', 'yuv420p', '-y', out,
    ], { encoding: 'utf8', timeout: 120_000 });
    check('FFmpeg renders the isolated group', render.status === 0,
        (render.stderr || '').split('\n').slice(-5).join(' | '));
    const pixel = regionColor(out, 1.5, { x: 315, y: 175, w: 12, h: 12 });
    check('overlapping opaque children receive group opacity once, not once per child',
        colorDist(pixel, 'c04040') < 24, `expected ~c04040, got ${pixel}`);

    const glowStack = [{ id: 'glow-comp', type: 'composition', opacity: 1, blendMode: 'source-over', effects: [{
        kind: 'glow', params: { threshold: 0.01, intensity: 1, radius: 20, color: '#00ff00' },
    }] }];
    const glowPlan = planFor([vclip({ id: 'glow-child', start: 0, duration: 3,
        extra: { x: 50, y: 50, compositionStack: glowStack } })]);
    const glowGraph = compileCompositionPlan(glowPlan, [{ overlayId: glowPlan.overlays[0].id, inputIndex: 1 }]);
    const glowOut = path.join(dir, 'isolated-glow.mp4');
    const glowRender = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error',
        '-i', path.join(dir, 'base.mp4'), '-i', path.join(dir, 'ov.mp4'),
        '-filter_complex', glowGraph.filterComplex, '-map', `[${glowGraph.outputLabel}]`,
        '-frames:v', '45', '-pix_fmt', 'yuv420p', '-y', glowOut,
    ], { encoding: 'utf8', timeout: 120_000 });
    check('FFmpeg executes isolated composition glow', glowRender.status === 0,
        (glowRender.stderr || '').split('\n').slice(-5).join(' | '));
    const glowOutside = regionColor(glowOut, 1.5, { x: 414, y: 175, w: 8, h: 8 });
    check('composition glow blooms beyond the child layer bounds', !!glowOutside && colorDist(glowOutside, '808080') > 5,
        `expected a tinted bloom outside the layer, got ${glowOutside}`);
    const animatedGlowStack = [{ id: 'animated-glow-comp', type: 'composition', opacity: 1, blendMode: 'source-over', effects: [{
        kind: 'glow', params: { threshold: 0.7, intensity: 1, radius: 8, color: '#ff8844' },
        samples: { threshold: [{ t: 0, value: 0.01 }, { t: 2, value: 0.2 }], intensity: [{ t: 0, value: 0 }, { t: 2, value: 2.5 }], radius: [{ t: 0, value: 2 }, { t: 2, value: 25 }] },
    }] }];
    const animatedGlowPlan = planFor([vclip({ id: 'animated-glow-child', start: 0, duration: 3,
        extra: { x: 50, y: 50, compositionStack: animatedGlowStack } })]);
    const animatedGlowGraph = compileCompositionPlan(animatedGlowPlan, [{ overlayId: animatedGlowPlan.overlays[0].id, inputIndex: 1 }]);
    const animatedGlowOut = path.join(dir, 'animated-isolated-glow.mp4');
    const animatedGlowRender = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error',
        '-i', path.join(dir, 'base.mp4'), '-i', path.join(dir, 'ov.mp4'),
        '-filter_complex', animatedGlowGraph.filterComplex, '-map', `[${animatedGlowGraph.outputLabel}]`,
        '-frames:v', '45', '-pix_fmt', 'yuv420p', '-y', animatedGlowOut,
    ], { encoding: 'utf8', timeout: 120_000 });
    check('FFmpeg renders animated isolated glow with sampled threshold, intensity, and radius', animatedGlowRender.status === 0,
        (animatedGlowRender.stderr || '').split('\n').slice(-5).join(' | '));

    const blurSource = path.join(dir, 'animated-blur-source.mp4');
    const blurFixture = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
        '-i', `color=c=black:size=200x200:duration=3:rate=15,drawbox=x=80:y=80:w=40:h=40:color=white:t=fill`,
        '-frames:v', '45', '-pix_fmt', 'yuv420p', '-y', blurSource], { encoding: 'utf8', timeout: 60_000 });
    const blurStack = [{ id: 'animated-blur-comp', type: 'composition', opacity: 1, blendMode: 'source-over', effects: [{
        kind: 'blur', samples: { radius: [{ t: 0, value: 0 }, { t: 2, value: 20 }] },
    }] }];
    const blurPlan = planFor([vclip({ id: 'animated-blur-child', start: 0, duration: 3,
        extra: { x: 50, y: 50, compositionStack: blurStack } })]);
    const blurGraph = compileCompositionPlan(blurPlan, [{ overlayId: blurPlan.overlays[0].id, inputIndex: 1 }]);
    const animatedBlurOut = path.join(dir, 'isolated-blur-animated.mp4');
    const blurRender = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error',
        '-i', path.join(dir, 'base.mp4'), '-i', blurSource,
        '-filter_complex', blurGraph.filterComplex, '-map', `[${blurGraph.outputLabel}]`,
        '-frames:v', '45', '-pix_fmt', 'yuv420p', '-y', animatedBlurOut,
    ], { encoding: 'utf8', timeout: 120_000 });
    check('animated group blur fixture and FFmpeg render succeed', blurFixture.status === 0 && blurRender.status === 0,
        (blurFixture.stderr || blurRender.stderr || '').split('\n').slice(-5).join(' | '));
    const sharpEdge = regionColor(animatedBlurOut, 0.2, { x: 338, y: 178, w: 6, h: 6 });
    const softEdge = regionColor(animatedBlurOut, 2.5, { x: 338, y: 178, w: 6, h: 6 });
    check('animated group blur visibly increases as sampled radius advances', !!sharpEdge && !!softEdge && colorDist(sharpEdge, softEdge) > 5,
        `expected an edge change, got ${sharpEdge} -> ${softEdge}`);

    const animatedLayerBlurPlan = planFor([vclip({ id: 'animated-layer-blur', start: 0, duration: 3, extra: {
        x: 50, y: 50,
        animations: [{ type: 'blur', duration: 2, keyframes: [
            { time: 0, properties: { blur: 0 } }, { time: 2, properties: { blur: 20 } },
        ] }],
    } })]);
    const animatedLayerBlurGraph = compileCompositionPlan(animatedLayerBlurPlan,
        [{ overlayId: animatedLayerBlurPlan.overlays[0].id, inputIndex: 1 }]);
    const animatedLayerBlurOut = path.join(dir, 'animated-layer-blur.mp4');
    const animatedLayerBlurRender = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error',
        '-i', path.join(dir, 'base.mp4'), '-i', blurSource,
        '-filter_complex', animatedLayerBlurGraph.filterComplex, '-map', `[${animatedLayerBlurGraph.outputLabel}]`,
        '-frames:v', '45', '-pix_fmt', 'yuv420p', '-y', animatedLayerBlurOut,
    ], { encoding: 'utf8', timeout: 120_000 });
    check('animated layer blur renders with FFmpeg runtime commands', animatedLayerBlurRender.status === 0,
        (animatedLayerBlurRender.stderr || '').split('\n').slice(-5).join(' | '));
    const layerBlurEarly = regionColor(animatedLayerBlurOut, 0.2, { x: 338, y: 178, w: 6, h: 6 });
    const layerBlurLate = regionColor(animatedLayerBlurOut, 2.5, { x: 338, y: 178, w: 6, h: 6 });
    check('animated layer blur visibly increases instead of freezing at its first sample',
        !!layerBlurEarly && !!layerBlurLate && colorDist(layerBlurEarly, layerBlurLate) > 5,
        `expected a softened edge, got ${layerBlurEarly} -> ${layerBlurLate}`);

    const animatedStack = [{ id: 'fade-comp', type: 'composition', opacity: 1, blendMode: 'source-over', effects: [],
        start: 0, duration: 3, opacitySamples: [{ t: 0, value: 0 }, { t: 3, value: 1 }] }];
    const animatedPlan = planFor([vclip({ id: 'fade-child', start: 0, duration: 3,
        extra: { x: 50, y: 50, opacity: 1, compositionStack: animatedStack } })]);
    check('animated composition opacity samples pass worker validation', validateCompositionPlanShape(animatedPlan, W, H).length === 0,
        validateCompositionPlanShape(animatedPlan, W, H).join('; '));
    const animatedGraph = compileCompositionPlan(animatedPlan, [{ overlayId: animatedPlan.overlays[0].id, inputIndex: 1 }]);
    check('animated opacity is applied at the isolated group boundary', animatedGraph.filterComplex.includes('geq=r=')
        && animatedGraph.filterComplex.includes('alpha(X,Y)*('));
    const animatedOutput = path.join(dir, 'isolated-opacity-animated.mp4');
    const animatedRender = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error',
        '-i', path.join(dir, 'base.mp4'), '-i', path.join(dir, 'ov.mp4'),
        '-filter_complex', animatedGraph.filterComplex, '-map', `[${animatedGraph.outputLabel}]`,
        '-frames:v', '45', '-pix_fmt', 'yuv420p', '-y', animatedOutput,
    ], { encoding: 'utf8', timeout: 120_000 });
    check('FFmpeg renders animated composition opacity', animatedRender.status === 0,
        (animatedRender.stderr || '').split('\n').slice(-5).join(' | '));
    const earlyFade = regionColor(animatedOutput, 0.2, { x: 315, y: 175, w: 12, h: 12 });
    const lateFade = regionColor(animatedOutput, 2.5, { x: 315, y: 175, w: 12, h: 12 });
    check('composition opacity fades from the base toward the isolated overlay',
        colorDist(earlyFade, '808080') < 18 && colorDist(lateFade, 'ff0000') < 28,
        `expected grey then red, got ${earlyFade} then ${lateFade}`);

    const animatedHueStack = [{ id: 'hue-comp', type: 'composition', opacity: 1, blendMode: 'source-over', start: 0, duration: 3,
        effects: [{ kind: 'hue', params: { degrees: { value: 0 } }, keyframes: { degrees: [
            { time: 0, value: 0 }, { time: 3, value: 120 },
        ] } }] }];
    const animatedHuePlan = planFor([vclip({ id: 'hue-child', start: 0, duration: 3,
        extra: { x: 50, y: 50, compositionStack: animatedHueStack } })]);
    check('animated composition hue samples pass client and worker validation', validateCompositionPlanShape(animatedHuePlan, W, H).length === 0,
        validateCompositionPlanShape(animatedHuePlan, W, H).join('; '));
    const animatedHueGraph = compileCompositionPlan(animatedHuePlan, [{ overlayId: animatedHuePlan.overlays[0].id, inputIndex: 1 }]);
    check('the isolated group graph evaluates its sampled hue angle on the FFmpeg hue timeline', /hue=h='/.test(animatedHueGraph.filterComplex));
    const animatedHueOutput = path.join(dir, 'isolated-hue-animated.mp4');
    const animatedHueRender = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error',
        '-i', path.join(dir, 'base.mp4'), '-i', path.join(dir, 'ov.mp4'),
        '-filter_complex', animatedHueGraph.filterComplex, '-map', `[${animatedHueGraph.outputLabel}]`,
        '-frames:v', '45', '-pix_fmt', 'yuv420p', '-y', animatedHueOutput,
    ], { encoding: 'utf8', timeout: 120_000 });
    check('FFmpeg renders animated isolated composition hue', animatedHueRender.status === 0,
        (animatedHueRender.stderr || '').split('\n').slice(-5).join(' | '));
    const originalHue = regionColor(animatedHueOutput, 0.2, { x: 315, y: 175, w: 12, h: 12 });
    const shiftedHue = regionColor(animatedHueOutput, 2.5, { x: 315, y: 175, w: 12, h: 12 });
    check('animated composition hue changes the exported pixels over time',
        !!originalHue && !!shiftedHue && colorDist(originalHue, shiftedHue) > 35,
        `expected visibly different hue values, got ${originalHue} then ${shiftedHue}`);

    const animatedFootageHuePlan = planFor([vclip({ id: 'footage-grade-hue', start: 0, duration: 3, extra: {
        x: 50, y: 50, effects: [{ kind: 'color_grade', params: {
            brightness: 100, contrast: 100, saturation: 100, hueRotate: 0,
        }, keyframes: { hueRotate: [
            { time: 0, value: 0 }, { time: 3, value: 120 },
        ] } }],
    } })]);
    const animatedFootageHueGraph = compileCompositionPlan(animatedFootageHuePlan, [{ overlayId: animatedFootageHuePlan.overlays[0].id, inputIndex: 1 }]);
    check('animated footage color-grade hue uses the FFmpeg hue expression interface', /hue=h='/.test(animatedFootageHueGraph.filterComplex)
        && !/hue=h='[^']*':eval=frame/.test(animatedFootageHueGraph.filterComplex));
    const animatedFootageHueOutput = path.join(dir, 'footage-grade-hue-animated.mp4');
    const animatedFootageHueRender = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error',
        '-i', path.join(dir, 'base.mp4'), '-i', path.join(dir, 'ov.mp4'),
        '-filter_complex', animatedFootageHueGraph.filterComplex, '-map', `[${animatedFootageHueGraph.outputLabel}]`,
        '-frames:v', '45', '-pix_fmt', 'yuv420p', '-y', animatedFootageHueOutput,
    ], { encoding: 'utf8', timeout: 120_000 });
    check('FFmpeg renders animated footage color-grade hue', animatedFootageHueRender.status === 0,
        (animatedFootageHueRender.stderr || '').split('\n').slice(-5).join(' | '));
    const originalFootageHue = regionColor(animatedFootageHueOutput, 0.2, { x: 315, y: 175, w: 12, h: 12 });
    const shiftedFootageHue = regionColor(animatedFootageHueOutput, 2.5, { x: 315, y: 175, w: 12, h: 12 });
    check('animated footage color-grade hue changes the exported pixels over time',
        !!originalFootageHue && !!shiftedFootageHue && colorDist(originalFootageHue, shiftedFootageHue) > 35,
        `expected visibly different hue values, got ${originalFootageHue} then ${shiftedFootageHue}`);

    const animatedEffectStack = [{ id: 'grade-comp', type: 'composition', opacity: 1, blendMode: 'source-over', start: 0, duration: 3,
        effects: [{ kind: 'color_grade', params: { brightness: { value: 100 }, contrast: { value: 100 }, saturation: { value: 100 } }, keyframes: {
            brightness: [{ time: 0, value: 50 }, { time: 3, value: 150 }],
            contrast: [{ time: 0, value: 80 }, { time: 3, value: 120 }],
            saturation: [{ time: 0, value: 70 }, { time: 3, value: 130 }],
            temperature: [{ time: 0, value: -60 }, { time: 3, value: 60 }],
            tint: [{ time: 0, value: -40 }, { time: 3, value: 40 }],
        } }] }];
    const animatedEffectPlan = planFor([vclip({ id: 'grade-child', start: 0, duration: 3,
        extra: { x: 50, y: 50, compositionStack: animatedEffectStack } })]);
    check('animated group color-grade controls are sampled onto output time and accepted',
        validateCompositionPlanShape(animatedEffectPlan, W, H).length === 0,
        validateCompositionPlanShape(animatedEffectPlan, W, H).join('; '));
    const animatedEffectGraph = compileCompositionPlan(animatedEffectPlan, [{ overlayId: animatedEffectPlan.overlays[0].id, inputIndex: 1 }]);
    check('the isolated group graph evaluates sampled brightness, contrast, and saturation per frame',
        animatedEffectGraph.filterComplex.includes('eq=brightness=') && animatedEffectGraph.filterComplex.includes(':eval=frame')
        && animatedEffectGraph.filterComplex.includes(':contrast=') && animatedEffectGraph.filterComplex.includes(':saturation='));
    check('the isolated group graph preserves animated temperature and tint with preview-matched RGB offsets',
        animatedEffectGraph.filterComplex.includes("geq=r='clip(r(X,Y)+(")
        && animatedEffectGraph.filterComplex.includes("g='clip(g(X,Y)+(")
        && animatedEffectGraph.filterComplex.includes("b='clip(b(X,Y)-("));
    const animatedEffectOutput = path.join(dir, 'isolated-effect-animated.mp4');
    const animatedEffectRender = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error',
        '-i', path.join(dir, 'base.mp4'), '-i', path.join(dir, 'ov.mp4'),
        '-filter_complex', animatedEffectGraph.filterComplex, '-map', `[${animatedEffectGraph.outputLabel}]`,
        '-frames:v', '45', '-pix_fmt', 'yuv420p', '-y', animatedEffectOutput,
    ], { encoding: 'utf8', timeout: 120_000 });
    check('FFmpeg renders animated isolated composition color effects', animatedEffectRender.status === 0,
        (animatedEffectRender.stderr || '').split('\n').slice(-5).join(' | '));
    const darkGrade = regionColor(animatedEffectOutput, 0.2, { x: 315, y: 175, w: 12, h: 12 });
    const brightGrade = regionColor(animatedEffectOutput, 2.5, { x: 315, y: 175, w: 12, h: 12 });
    check('animated composition brightness changes the exported pixels over time',
        !!darkGrade && !!brightGrade && colorDist(darkGrade, brightGrade) > 35,
        `expected a visible grade change, got ${darkGrade} then ${brightGrade}`);


    fs.rmSync(dir, { recursive: true, force: true });
}

section('5 · The overlay is ABSENT outside its own time window');
if (!FFMPEG) {
    skip('enable= gating', 'no ffmpeg binary available');
} else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comp-gate-'));
    makeSources(dir);

    // Visible only from 1.0s to 2.0s of a 3s video.
    const plan = planFor([vclip({ id: 'ov', start: 1.0, duration: 1.0, extra: { x: 50, y: 50 } })]);
    const compiled = compileCompositionPlan(plan, [{ overlayId: plan.overlays[0].id, inputIndex: 1 }]);
    const { r, out } = runGraph(dir, compiled, 'gated.mp4');
    check('the gated graph runs', r.status === 0, (r.stderr || '').split('\n').slice(-4).join(' | '));

    // Sample the middle of wherever the plan says the overlay sits, derived
    // from the plan itself rather than hardcoded — if the geometry maths
    // changes, this test follows it instead of silently testing empty space.
    const g = plan.overlays[0].geometry[0];
    const crop = {
        w: 20, h: 20,
        x: Math.round((g.x + g.w / 2) * W) - 10,
        y: Math.round((g.y + g.h / 2) * H) - 10,
    };

    const GREY = '808080';
    const before = regionColor(out, 0.2, crop);
    const during = regionColor(out, 1.5, crop);
    const atEnd = regionColor(out, 2.0, crop);
    const after  = regionColor(out, 2.8, crop);

    check('BEFORE the window the region is the untouched base colour',
        colorDist(before, GREY) < 12,
        `got ${before} — an overlay drawn early is as wrong as one never drawn`);
    check('INSIDE the window the overlay is actually drawn there',
        colorDist(during, GREY) > 60,
        `got ${during} — the overlay should dominate this region`);
    check('AT the end boundary the overlay is already absent',
        colorDist(atEnd, GREY) < 12,
        `got ${atEnd} — the end frame belongs to the next timeline interval`);
    check('AFTER the window the region returns to the base colour',
        colorDist(after, GREY) < 12,
        `got ${after} — without enable= the overlay's last frame sticks for the rest of the video, which looks fine in a thumbnail and is wrong everywhere else`);

    fs.rmSync(dir, { recursive: true, force: true });
}

section('6 · Animated overlays render (position, size and fade)');
if (!FFMPEG) {
    skip('animated overlay renders', 'no ffmpeg binary available');
} else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comp-anim-'));
    makeSources(dir);

    for (const presetId of ['float', 'pulse', 'sticker-pop', 'fade']) {
        const anims = C.buildPreset(presetId, { duration: 2 });
        const plan = planFor([vclip({ id: 'ov', start: 0.5, duration: 2, extra: { x: 50, y: 50, animations: anims } })]);
        const compiled = compileCompositionPlan(plan, [{ overlayId: plan.overlays[0].id, inputIndex: 1 }]);
        if (!compiled) { check(`${presetId}: compiles`, false, 'no graph produced'); continue; }

        const { r, out } = runGraph(dir, compiled, `${presetId}.mp4`);
        check(`${presetId}: renders without error`, r.status === 0,
            (r.stderr || '').split('\n').slice(-4).join(' | '));
        check(`${presetId}: produces a non-empty file`,
            fs.existsSync(out) && fs.statSync(out).size > 0);

        // The animation must actually move something between two instants.
        const f1 = frameAt(dir, out, 0.8, `${presetId}-a.png`);
        const f2 = frameAt(dir, out, 1.8, `${presetId}-b.png`);
        check(`${presetId}: the frame CHANGES over the animation`,
            !!f1 && !!f2 && !f1.equals(f2),
            'an animation that compiles but renders identically every frame was simplified away');
    }

    fs.rmSync(dir, { recursive: true, force: true });
}

section('6a · Arbitrary overlay opacity keyframes survive export');
{
    const plan = planFor([vclip({ id: 'opacity-curve', start: 0.5, duration: 2, extra: { x: 50, y: 50 } })]);
    const overlay = plan.overlays[0];
    const geometry = overlay.geometry[0];
    overlay.geometry = [
        { ...geometry, t: 0.5, opacity: 0 },
        { ...geometry, t: 1, opacity: 1 },
        { ...geometry, t: 1.5, opacity: 0.25 },
        { ...geometry, t: 2, opacity: 1 },
        { ...geometry, t: 2.5, opacity: 0.25 },
    ];
    const compiled = compileCompositionPlan(plan, [{ overlayId: overlay.id, inputIndex: 1 }]);
    check('animated opacity compiles the full sampled curve through alpha',
        /geq=r='r\(X,Y\)':g='g\(X,Y\)':b='b\(X,Y\)':a='clip\(alpha\(X,Y\)\*/.test(compiled.filterComplex)
            && !compiled.filterComplex.includes('fade=t=in:st=0.5'));

    if (!FFMPEG) {
        skip('animated opacity curve pixels', 'no ffmpeg binary available');
    } else {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comp-opacity-curve-'));
        makeSources(dir);
        const { r, out } = runGraph(dir, compiled, 'opacity-curve.mp4');
        check('FFmpeg renders arbitrary opacity keyframes', r.status === 0,
            (r.stderr || '').split('\n').slice(-4).join(' | '));
        const full = regionColor(out, 1, { x: 275, y: 155, w: 90, h: 50 });
        const quarter = regionColor(out, 1.5, { x: 275, y: 155, w: 90, h: 50 });
        const fullAgain = regionColor(out, 2, { x: 275, y: 155, w: 90, h: 50 });
        check('opacity rises, dips, then rises again at authored keyframes',
            colorDist(full, quarter) > 70 && colorDist(fullAgain, quarter) > 70
                && colorDist(full, fullAgain) < 25,
            `full=${full} quarter=${quarter} fullAgain=${fullAgain}`);
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

section('6b · Animated effect parameters reach the overlay render');
if (!FFMPEG) {
    skip('animated overlay brightness', 'no ffmpeg binary available');
} else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comp-fx-'));
    makeSources(dir);
    const plan = planFor([vclip({ id: 'fx', start: 0.5, duration: 2, extra: {
        x: 50, y: 50,
        effects: [{ kind: 'brightness', params: { amount: 1 }, keyframes: { amount: [
            { time: 0.5, value: 0.2 }, { time: 2.3, value: 1.8, easing: 'linear' },
        ] } }],
    } })]);
    const compiled = compileCompositionPlan(plan, [{ overlayId: plan.overlays[0].id, inputIndex: 1 }]);
    check('the filter graph uses per-frame effect values', /eq=brightness=.*eval=frame/.test(compiled.filterComplex));
    const { r, out } = runGraph(dir, compiled, 'animated-effect.mp4');
    check('FFmpeg renders the keyed overlay effect', r.status === 0, (r.stderr || '').split('\n').slice(-4).join(' | '));
    const early = regionColor(out, 0.65, { x: 275, y: 155, w: 90, h: 50 });
    const late = regionColor(out, 2.1, { x: 275, y: 155, w: 90, h: 50 });
    check('the overlay visibly changes as its brightness keyframes advance', colorDist(early, late) > 35,
        `early=${early} late=${late}`);
    fs.rmSync(dir, { recursive: true, force: true });
}

section('6b.1 · Gradient fill renders over video overlays');
if (!FFMPEG) {
    skip('video gradient fill pixels', 'no ffmpeg binary available');
} else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comp-video-gradient-'));
    makeSources(dir);
    const plan = planFor([vclip({ id: 'video-gradient', start: 0.5, duration: 2, extra: {
        x: 50, y: 50,
        effects: [{ kind: 'gradient-fill', params: { colors: ['#FF0000', '#0000FF'], angle: 0, opacity: 1 } }],
    } })]);
    const compiled = compileCompositionPlan(plan, [{ overlayId: plan.overlays[0].id, inputIndex: 1 }]);
    check('the video gradient effect compiles to a color-channel transform', /geq=r=/.test(compiled.filterComplex));
    const { r, out } = runGraph(dir, compiled, 'video-gradient.mp4');
    check('FFmpeg renders a video gradient overlay', r.status === 0,
        (r.stderr || '').split('\n').slice(-4).join(' | '));
    const left = regionColor(out, 1, { x: 230, y: 155, w: 30, h: 50 });
    const right = regionColor(out, 1, { x: 390, y: 155, w: 30, h: 50 });
    const channels = hex => hex ? hex.match(/../g).map(value => parseInt(value, 16)) : null;
    const leftRgb = channels(left), rightRgb = channels(right);
    check('the exported video gradient visibly changes across the layer', !!leftRgb && !!rightRgb && leftRgb[0] > leftRgb[2] + 60 && rightRgb[2] > rightRgb[0] + 60,
        `left=${left} right=${right}`);
    fs.rmSync(dir, { recursive: true, force: true });
}

section('6c · Vignette intensity animates during overlay export');
if (!FFMPEG) {
    skip('animated overlay vignette', 'no ffmpeg binary available');
} else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comp-vignette-'));
    makeSources(dir);
    const plan = planFor([vclip({ id: 'vignette-fx', start: 0.5, duration: 2, extra: {
        x: 50, y: 50,
        effects: [{ kind: 'vignette', params: { intensity: 0, radius: 0.3, softness: 0.2, color: [0, 0, 1] }, keyframes: { intensity: [
            { time: 0.5, value: 0 }, { time: 2.3, value: 1, easing: 'linear' },
        ] } }],
    } })]);
    const compiled = compileCompositionPlan(plan, [{ overlayId: plan.overlays[0].id, inputIndex: 1 }]);
    check('the filter graph evaluates keyed vignette strength and edge controls per frame', /geq=.*T.*alpha\(X,Y\)/.test(compiled.filterComplex));
    check('vignette radius, softness, and color reach the export expression', /0\.3-0\.2/.test(compiled.filterComplex) && /255\*/.test(compiled.filterComplex));
    const { r, out } = runGraph(dir, compiled, 'animated-vignette.mp4');
    check('FFmpeg renders keyed vignette intensity', r.status === 0, (r.stderr || '').split('\n').slice(-4).join(' | '));
    const early = frameAt(dir, out, 0.65, 'vignette-a.png');
    const late = frameAt(dir, out, 2.1, 'vignette-b.png');
    check('the exported image changes as vignette intensity advances', !!early && !!late && !early.equals(late));
    fs.rmSync(dir, { recursive: true, force: true });
}

section('6d · Timed effects match the preview active window');
if (!FFMPEG) {
    skip('timed overlay effect', 'no ffmpeg binary available');
} else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comp-fx-window-'));
    makeSources(dir);
    const plan = planFor([vclip({ id: 'window-fx', start: 0.5, duration: 2, extra: {
        x: 50, y: 50,
        effects: [{ kind: 'brightness', startTime: 0.8, endTime: 1.4, params: { amount: 0.2 } }],
    } })]);
    const effect = plan.overlays[0].effects[0];
    check('the authoring window maps to output time', JSON.stringify(effect.outputWindows) === JSON.stringify([{ start: 0.8, end: 1.4 }]), JSON.stringify(effect.outputWindows));
    const compiled = compileCompositionPlan(plan, [{ overlayId: plan.overlays[0].id, inputIndex: 1 }]);
    check('the effect filter is gated to its output window', /enable='gte\(t,0\.8\)\*lt\(t,1\.4\)'/.test(compiled.filterComplex));
    const { r, out } = runGraph(dir, compiled, 'timed-effect.mp4');
    check('FFmpeg renders a timed effect', r.status === 0, (r.stderr || '').split('\n').slice(-4).join(' | '));
    const before = regionColor(out, 0.65, { x: 275, y: 155, w: 90, h: 50 });
    const active = regionColor(out, 1.0, { x: 275, y: 155, w: 90, h: 50 });
    const after = regionColor(out, 1.6, { x: 275, y: 155, w: 90, h: 50 });
    check('the effect applies only inside its authored time window', colorDist(before, active) > 35 && colorDist(before, after) < 12,
        `before=${before} active=${active} after=${after}`);
    fs.rmSync(dir, { recursive: true, force: true });
}

section('6d.2 · Empty effect boundaries remain unset on export');
{
    const plan = planFor([vclip({ id: 'window-fx-empty', start: 0.5, duration: 2, extra: {
        x: 50, y: 50,
        effects: [{ kind: 'brightness', startTime: '', endTime: '', params: { amount: 0.2 } }],
    } })]);
    const effect = plan.overlays[0].effects[0];
    check('empty boundaries do not create a zero-length effect window', effect.outputWindows === undefined, JSON.stringify(effect.outputWindows));
    const compiled = compileCompositionPlan(plan, [{ overlayId: plan.overlays[0].id, inputIndex: 1 }]);
    check('the full-clip effect remains in the graph without an effect-specific zero-time gate', /colorchannelmixer=rr=0\.2/.test(compiled.filterComplex) && !/enable='gte\(t,0\).*lt\(t,0\)/.test(compiled.filterComplex));
}

section('6d.1 · Timed effects keep their authored output window on sped-up footage');
{
    const plan = planFor([vclip({ id: 'window-fx-fast-base', start: 0.5, duration: 2, extra: {
        x: 50, y: 50,
        effects: [{ kind: 'brightness', startTime: 0.8, endTime: 1.4, params: { amount: 0.2 } }],
    } })], 2);
    const effect = plan.overlays[0].effects[0];
    check('speed-adjusted source playback does not compress effect timing a second time',
        JSON.stringify(effect.outputWindows) === JSON.stringify([{ start: 0.8, end: 1.4 }]), JSON.stringify(effect.outputWindows));
}

section('6e · Registry fade effects render on visual overlays');
if (!FFMPEG) {
    skip('overlay fade effects', 'no ffmpeg binary available');
} else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comp-fade-fx-'));
    makeSources(dir);
    const plan = planFor([vclip({ id: 'fade-fx', start: 0.5, duration: 2, extra: {
        x: 50, y: 50,
        effects: [{ kind: 'fade_in', params: { duration: 0.8, color: [0, 0, 0] } }],
    } })]);
    const compiled = compileCompositionPlan(plan, [{ overlayId: plan.overlays[0].id, inputIndex: 1 }]);
    check('fade-in begins at the overlay output start', /fade=t=in:st=0\.5:d=0\.8:color=0x000000/.test(compiled.filterComplex));
    const fadeOutPlan = planFor([vclip({ id: 'fade-out-fx', start: 0.5, duration: 2, extra: {
        x: 50, y: 50, effects: [{ kind: 'fade_out', params: { duration: 0.5 } }],
    } })]);
    const fadeOutGraph = compileCompositionPlan(fadeOutPlan, [{ overlayId: fadeOutPlan.overlays[0].id, inputIndex: 1 }]).filterComplex;
    check('fade-out ends at the overlay output end', /fade=t=out:st=2:d=0\.5:color=0x000000/.test(fadeOutGraph));
    const { r, out } = runGraph(dir, compiled, 'overlay-fade-in.mp4');
    check('FFmpeg renders the fade-in effect', r.status === 0, (r.stderr || '').split('\n').slice(-4).join(' | '));
    const early = regionColor(out, 0.65, { x: 275, y: 155, w: 90, h: 50 });
    const settled = regionColor(out, 1.5, { x: 275, y: 155, w: 90, h: 50 });
    check('fade-in moves the overlay from its fade color to full source color', colorDist(early, settled) > 35,
        `early=${early} settled=${settled}`);
    fs.rmSync(dir, { recursive: true, force: true });
}

section('6f · Camera shake on a footage overlay reaches export');
if (!FFMPEG) {
    skip('overlay camera shake', 'no ffmpeg binary available');
} else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comp-shake-fx-'));
    makeSources(dir);
    const plan = planFor([vclip({ id: 'shake-fx', start: 0.5, duration: 2, extra: {
        x: 50, y: 50,
        effects: [{ kind: 'shake', startTime: 0.7, endTime: 1.4, params: { intensity: 40, frequency: 2, randomSeed: 0, rotationAmount: 8 } }],
    } })]);
    const compiled = compileCompositionPlan(plan, [{ overlayId: plan.overlays[0].id, inputIndex: 1 }]);
    check('shake adds deterministic per-frame x, y, and rotation', /sin\(2\*PI\*t\*2/.test(compiled.filterComplex) && /cos\(2\*PI\*t\*1\.66/.test(compiled.filterComplex) && /rotate=a='if\(\(gte\(t,0\.7\)\*lt\(t,1\.4\)\),sin\(2\*PI\*t\*1\.66/.test(compiled.filterComplex));
    const { r, out } = runGraph(dir, compiled, 'overlay-shake.mp4');
    check('FFmpeg renders the shake effect', r.status === 0, (r.stderr || '').split('\n').slice(-4).join(' | '));
    const shifted = framePixels(out, 0.75);
    const neutral = framePixels(out, 1.0);
    check('the overlay visibly shifts at the authored shake frequency', shifted && neutral && !shifted.equals(neutral),
        `shifted frame bytes=${shifted?.length} neutral frame bytes=${neutral?.length}`);
    const animatedPlan = planFor([vclip({ id: 'animated-shake-fx', start: 0.5, duration: 2, extra: {
        x: 50, y: 50,
        effects: [{ kind: 'shake', params: { intensity: 0, frequency: 2, randomSeed: 3, rotationAmount: 0 }, keyframes: {
            intensity: [{ time: 0.5, value: 0 }, { time: 2.5, value: 40 }],
            frequency: [{ time: 0.5, value: 2 }, { time: 2.5, value: 8 }],
            rotationAmount: [{ time: 0.5, value: 0 }, { time: 2.5, value: 8 }],
        } }],
    } })]);
    const animatedCompiled = compileCompositionPlan(animatedPlan, [{ overlayId: animatedPlan.overlays[0].id, inputIndex: 1 }]);
    const sampledShake = animatedPlan.overlays[0].effects[0].samples;
    check('keyframed shake intensity and frequency reach overlay position and rotation expressions',
        sampledShake.intensity.at(-1)?.value === 40 && sampledShake.frequency.at(-1)?.value === 8
            && sampledShake.rotationAmount.at(-1)?.value === 8
            && animatedCompiled.filterComplex.includes("sin(2*PI*t*(if(lt(t,")
            && animatedCompiled.filterComplex.includes("rotate=a='if((gte(t,0.5)")
            && animatedCompiled.filterComplex.includes(')*PI/180,0)'),
        JSON.stringify({ samples: Object.fromEntries(Object.entries(sampledShake).map(([key, points]) => [key, points.at(-1)?.value])),
            dynamicPosition: animatedCompiled.filterComplex.includes("sin(2*PI*t*(if(lt(t,"),
            dynamicRotation: animatedCompiled.filterComplex.includes("rotate=a='if((gte(t,0.5)") }));
    const animatedShakeResult = runGraph(dir, animatedCompiled, 'overlay-shake-keyframed.mp4');
    check('FFmpeg renders keyframed overlay shake intensity, frequency, and rotation', animatedShakeResult.r.status === 0,
        (animatedShakeResult.r.stderr || '').split('\n').slice(-4).join(' | '));
    const earlyAnimatedShake = framePixels(animatedShakeResult.out, 0.75);
    const lateAnimatedShake = framePixels(animatedShakeResult.out, 2.25);
    check('keyframed shake changes the rendered overlay over time', earlyAnimatedShake && lateAnimatedShake && !earlyAnimatedShake.equals(lateAnimatedShake),
        `early frame bytes=${earlyAnimatedShake?.length} late frame bytes=${lateAnimatedShake?.length}`);
    fs.rmSync(dir, { recursive: true, force: true });
}

section('6f.1 · Transform shutter samples reach moving overlay geometry');
if (!FFMPEG) {
    skip('transform motion blur', 'no ffmpeg binary available');
} else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comp-transform-blur-'));
    makeSources(dir);
    const renderTransform = (id, motionBlur) => {
        const plan = planFor([vclip({ id, start: 0.5, duration: 1, extra: {
            x: 50, y: 50, motionPath: { points: [[-35, 0], [35, 0]], duration: 1, easing: 'linear' },
            ...(motionBlur ? { motionBlur } : {}),
        } })]);
        const compiled = compileCompositionPlan(plan, [{ overlayId: plan.overlays[0].id, inputIndex: 1 }]);
        return { plan, compiled, ...runGraph(dir, compiled, `${id}.mp4`) };
    };
    const sharp = renderTransform('transform-sharp', null);
    const blurred = renderTransform('transform-blur', { enabled: true, samples: 7, shutterAngle: 360, frameRate: 5 });
    const zeroShutter = renderTransform('transform-zero-shutter', { enabled: true, samples: 7, shutterAngle: 0, frameRate: 5 });
    const staticBlurPlan = planFor([vclip({ id: 'transform-static', start: 0.5, duration: 1, extra: {
        x: 50, y: 50, motionBlur: { enabled: true, samples: 7, shutterAngle: 360, frameRate: 5 },
    } })]);
    const staticBlurGraph = compileCompositionPlan(staticBlurPlan, [{ overlayId: staticBlurPlan.overlays[0].id, inputIndex: 1 }]).filterComplex;
    check('the plan carries normalized shutter settings into export', blurred.plan.overlays[0].motionBlur?.samples === 7);
    check('each transform sample gets its own prepared source and compositing pass',
        /split=7\[ov0mbsrc0\]/.test(blurred.compiled.filterComplex)
            && (blurred.compiled.filterComplex.match(/overlay=x=/g) || []).length >= 7);
    check('FFmpeg renders the moving layer with transform shutter samples', blurred.r.status === 0,
        (blurred.r.stderr || '').split('\n').slice(-5).join(' | '));
    const sharpFrame = framePixels(sharp.out, 0.95);
    const blurredFrame = framePixels(blurred.out, 0.95);
    check('transform shutter samples visibly change the rendered moving layer',
        sharpFrame && blurredFrame && !sharpFrame.equals(blurredFrame));
    check('a zero degree shutter keeps one sharp source without dimming it',
        !/split=7\[ov0mbsrc0\]/.test(zeroShutter.compiled.filterComplex)
            && !/colorchannelmixer=aa=0\.1429/.test(zeroShutter.compiled.filterComplex));
    check('a static layer with content blur is not duplicated or dimmed by transform blur',
        !/split=7\[ov0mbsrc0\]/.test(staticBlurGraph) && !/colorchannelmixer=aa=0\.1429/.test(staticBlurGraph));
    fs.rmSync(dir, { recursive: true, force: true });
}

section('6g · Directional motion blur preserves its angle in export');
if (!FFMPEG) {
    skip('directional motion blur', 'no ffmpeg binary available');
} else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comp-direction-blur-'));
    makeSources(dir);
    const renderAngle = angle => {
        const plan = planFor([vclip({ id: `blur-${angle}`, start: 0.5, duration: 2, extra: {
            x: 50, y: 50, effects: [{ kind: 'blur_motion', params: { intensity: 0.8, angle, samples: 32 } }],
        } })]);
        const compiled = compileCompositionPlan(plan, [{ overlayId: plan.overlays[0].id, inputIndex: 1 }]);
        return { compiled, ...runGraph(dir, compiled, `direction-${angle}.mp4`) };
    };
    const horizontal = renderAngle(0);
    const diagonal = renderAngle(45);
    check('motion blur export uses an angle-aligned spatial blur', /gblur=sigma=.*:sigmaV=0/.test(horizontal.compiled.filterComplex) && /rotate=-0\.7854/.test(diagonal.compiled.filterComplex));
    check('FFmpeg renders horizontal and diagonal blur', horizontal.r.status === 0 && diagonal.r.status === 0,
        `${horizontal.r.stderr || ''} ${diagonal.r.stderr || ''}`.trim().slice(-500));
    const horizontalFrame = framePixels(horizontal.out, 1.0);
    const diagonalFrame = framePixels(diagonal.out, 1.0);
    check('changing the blur angle changes the rendered pixels', horizontalFrame && diagonalFrame && !horizontalFrame.equals(diagonalFrame));
    fs.rmSync(dir, { recursive: true, force: true });
}

section('6h · Video glow blooms highlights instead of blurring the frame matte');
if (!FFMPEG) {
    skip('video highlight glow', 'no ffmpeg binary available');
} else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comp-footage-glow-'));
    makeSources(dir);
    const source = path.join(dir, 'ov.mp4');
    const sourceResult = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
        `color=c=black:size=200x200:duration=3:rate=15,drawbox=x=90:y=90:w=20:h=20:color=white:t=fill`,
        '-frames:v', '45', '-pix_fmt', 'yuv420p', '-y', source], { encoding: 'utf8', timeout: 60_000 });
    check('highlight test footage is generated', sourceResult.status === 0, sourceResult.stderr);
    const plan = planFor([vclip({ id: 'footage-glow', start: 0.5, duration: 2, extra: {
        x: 50, y: 50, effects: [{ kind: 'glow', params: { threshold: 0.7, intensity: 1, radius: 12, color: [0, 1, 1] } }],
    } })]);
    const compiled = compileCompositionPlan(plan, [{ overlayId: plan.overlays[0].id, inputIndex: 1 }]);
    check('video glow thresholds highlights into a tinted alpha bloom', /geq=.*gte\(max\(max\(r\(X,Y\),g\(X,Y\)\),b\(X,Y\)\),178\.5\)/.test(compiled.filterComplex) && /gblur=sigma=.*colorchannelmixer=aa=/.test(compiled.filterComplex), compiled.filterComplex);
    const { r, out } = runGraph(dir, compiled, 'footage-glow.mp4');
    check('FFmpeg renders the footage glow', r.status === 0, (r.stderr || '').split('\n').slice(-4).join(' | '));
    const glowFrame = framePixels(out, 1.0);
    const noGlowPlan = planFor([vclip({ id: 'footage-no-glow', start: 0.5, duration: 2, extra: { x: 50, y: 50 } })]);
    const noGlowGraph = compileCompositionPlan(noGlowPlan, [{ overlayId: noGlowPlan.overlays[0].id, inputIndex: 1 }]);
    const plain = runGraph(dir, noGlowGraph, 'footage-no-glow.mp4');
    const plainFrame = framePixels(plain.out, 1.0);
    check('unmodified and glowing footage have different pixels', plain.r.status === 0 && glowFrame && plainFrame && !glowFrame.equals(plainFrame),
        `glow=${glowFrame?.length} plain=${plainFrame?.length} equal=${glowFrame?.equals(plainFrame)} graph=${compiled.filterComplex}`);
    const animatedPlan = planFor([vclip({ id: 'footage-glow-animated', start: 0, duration: 3, extra: {
        x: 50, y: 50,
        effects: [{ kind: 'glow', params: { threshold: 0.7, intensity: 0, radius: 2, color: [0, 1, 1] }, samples: {
            threshold: [{ t: 0, value: 0.1 }, { t: 2, value: 0.9 }],
            intensity: [{ t: 0, value: 0 }, { t: 2, value: 1.4 }],
            radius: [{ t: 0, value: 2 }, { t: 2, value: 24 }],
        } }],
    } })]);
    const animatedGraph = compileCompositionPlan(animatedPlan,
        [{ overlayId: animatedPlan.overlays[0].id, inputIndex: 1 }]);
    check('animated footage glow compiles sampled threshold, intensity and radius controls',
        animatedGraph.filterComplex.includes('_radius sigma')
            && animatedGraph.filterComplex.includes('gte(max(max(r(X,Y),g(X,Y)),b(X,Y)),(if(lt(T')
            && animatedGraph.filterComplex.includes("alpha(X,Y)*(clip((if(lt(T"), animatedGraph.filterComplex);
    const animatedOut = runGraph(dir, animatedGraph, 'footage-glow-animated.mp4');
    check('FFmpeg renders animated footage glow controls', animatedOut.r.status === 0,
        (animatedOut.r.stderr || '').split('\n').slice(-4).join(' | '));
    const quietGlowFrame = framePixels(animatedOut.out, 0.2);
    const brightGlowFrame = framePixels(animatedOut.out, 2.5);
    check('sampled footage glow controls visibly change the halo over time',
        !!quietGlowFrame && !!brightGlowFrame && !quietGlowFrame.equals(brightGlowFrame),
        `frames=${quietGlowFrame?.length} -> ${brightGlowFrame?.length}`);
    const animatedShadowPlan = planFor([vclip({ id: 'animated-image-shadow', type: 'image', start: 0, duration: 3, extra: {
        x: 50, y: 50,
        effects: [{ kind: 'shadow', params: { blur: 2, opacity: 0.1, color: '#ff0000', x: -24, y: 0 }, samples: {
            blur: [{ t: 0, value: 2 }, { t: 2, value: 24 }],
            opacity: [{ t: 0, value: 0.1 }, { t: 2, value: 1 }],
            x: [{ t: 0, value: -24 }, { t: 2, value: 24 }],
        } }],
    } })]);
    const animatedShadowGraph = compileCompositionPlan(animatedShadowPlan,
        [{ overlayId: animatedShadowPlan.overlays[0].id, inputIndex: 1 }]);
    check('animated image shadow compiles sampled blur and opacity',
        animatedShadowGraph.filterComplex.includes('_radius sigma')
            && animatedShadowGraph.filterComplex.includes('alpha(X,Y)*(if(lt(T')
            && animatedShadowGraph.filterComplex.includes("+(if(lt(t,2),-14.2222+(28.4444)*(t-0)/2,14.2222))"), animatedShadowGraph.filterComplex);
    const wideShadowPlan = planFor([vclip({ id: 'wide-animated-image-shadow', type: 'image', start: 0, duration: 3, extra: {
        effects: [{ kind: 'shadow', params: { blur: 2, opacity: 0.5, x: -150, y: 150 }, samples: {
            x: [{ t: 0, value: -150 }, { t: 2, value: 150 }],
            y: [{ t: 0, value: 150 }, { t: 2, value: -150 }],
        } }],
    } })]);
    const wideShadowGraph = compileCompositionPlan(wideShadowPlan,
        [{ overlayId: wideShadowPlan.overlays[0].id, inputIndex: 1 }]);
    check('animated image shadow keeps the preview-supported ±200px offset range in export',
        wideShadowGraph.filterComplex.includes('-88.8889') && wideShadowGraph.filterComplex.includes('88.8889'),
        wideShadowGraph.filterComplex);
    const animatedShadowOut = runGraph(dir, animatedShadowGraph, 'footage-shadow-animated.mp4');
    check('FFmpeg renders animated image shadow controls', animatedShadowOut.r.status === 0,
        (animatedShadowOut.r.stderr || '').split('\n').slice(-4).join(' | '));
    const faintShadow = framePixels(animatedShadowOut.out, 0.2);
    const strongShadow = framePixels(animatedShadowOut.out, 2.5);
    check('sampled image shadow controls visibly change the rendered composite',
        !!faintShadow && !!strongShadow && !faintShadow.equals(strongShadow),
        `frames=${faintShadow?.length} -> ${strongShadow?.length}`);
    const leftShadowEarly = regionColor(animatedShadowOut.out, 0.2, { x: 230, y: 180, w: 6, h: 6 });
    const leftShadowLate = regionColor(animatedShadowOut.out, 2.5, { x: 230, y: 180, w: 6, h: 6 });
    const rightShadowEarly = regionColor(animatedShadowOut.out, 0.2, { x: 410, y: 180, w: 6, h: 6 });
    const rightShadowLate = regionColor(animatedShadowOut.out, 2.5, { x: 410, y: 180, w: 6, h: 6 });
    check('animated image shadow offset moves from the left edge to the right edge',
        !!leftShadowEarly && !!leftShadowLate && !!rightShadowEarly && !!rightShadowLate
            && colorDist(leftShadowEarly, leftShadowLate) > 5
            && colorDist(rightShadowEarly, rightShadowLate) > 5,
        `${leftShadowEarly} -> ${leftShadowLate}; ${rightShadowEarly} -> ${rightShadowLate}`);
    fs.rmSync(dir, { recursive: true, force: true });
}

section('6i · Distortion export uses the preview displacement model');
if (!FFMPEG) {
    skip('footage distortion', 'no ffmpeg binary available');
} else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comp-distortion-'));
    makeSources(dir);
    const source = path.join(dir, 'ov.mp4');
    const sourceResult = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
        'testsrc2=size=200x200:duration=3:rate=15', '-frames:v', '45', '-pix_fmt', 'yuv420p', '-y', source],
        { encoding: 'utf8', timeout: 60_000 });
    check('patterned test footage is generated', sourceResult.status === 0, sourceResult.stderr);
    const plan = planFor([vclip({ id: 'distortion-fx', start: 0.5, duration: 2, extra: {
        x: 50, y: 50, effects: [{ kind: 'distortion', params: { amount: 0.08, phase: 0.4 } }],
    } })]);
    const compiled = compileCompositionPlan(plan, [{ overlayId: plan.overlays[0].id, inputIndex: 1 }]);
    check('distortion compiles to the same bounded sine displacement as preview', /geq=.*sin\(Y\*0\.045\+\(?0\.4\)?\).*sin\(X\*0\.04\)/.test(compiled.filterComplex));
    const distorted = runGraph(dir, compiled, 'distorted.mp4');
    const plainPlan = planFor([vclip({ id: 'distortion-plain', start: 0.5, duration: 2, extra: { x: 50, y: 50 } })]);
    const plainGraph = compileCompositionPlan(plainPlan, [{ overlayId: plainPlan.overlays[0].id, inputIndex: 1 }]);
    const plain = runGraph(dir, plainGraph, 'undistorted.mp4');
    check('FFmpeg renders distorted and original patterned footage', distorted.r.status === 0 && plain.r.status === 0,
        `${distorted.r.stderr || ''} ${plain.r.stderr || ''}`.trim().slice(-500));
    const distortedFrame = framePixels(distorted.out, 1.0);
    const plainFrame = framePixels(plain.out, 1.0);
    check('the displacement changes the exported pixels', distortedFrame && plainFrame && !distortedFrame.equals(plainFrame));
    fs.rmSync(dir, { recursive: true, force: true });
}

section('6i.1 · RGB split on media overlays honors angle and origin');
if (!FFMPEG) {
    skip('RGB split overlay export', 'no ffmpeg binary available');
} else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comp-rgb-split-'));
    makeSources(dir);
    const pattern = path.join(dir, 'rgb-pattern.mp4');
    const sourceResult = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
        'testsrc2=size=200x200:duration=3:rate=15', '-frames:v', '45', '-pix_fmt', 'yuv420p', '-y', pattern],
    { encoding: 'utf8', timeout: 60_000 });
    check('RGB split pattern source is generated', sourceResult.status === 0, sourceResult.stderr);

    const renderAngle = angle => {
        const plan = planFor([vclip({ id: `rgb-${angle}`, start: 0.5, duration: 2, extra: {
            x: 50, y: 50, effects: [{ kind: 'rgb_split', enabled: true, params: {
                amount: 30, angle, centerX: 0.15, centerY: 0.75,
            } }],
        } })]);
        const compiled = compileCompositionPlan(plan, [{ overlayId: plan.overlays[0].id, inputIndex: 1 }]);
        const output = path.join(dir, `rgb-${angle}.mp4`);
        const rendered = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', path.join(dir, 'base.mp4'),
            '-i', pattern, '-filter_complex', compiled.filterComplex, '-map', `[${compiled.outputLabel}]`,
            '-frames:v', '45', '-pix_fmt', 'yuv420p', '-y', output], { encoding: 'utf8', timeout: 120_000 });
        return { compiled, output, rendered };
    };
    const horizontal = renderAngle(0);
    const vertical = renderAngle(90);
    check('RGB split compiles to radial per-channel sampling, not fixed chromashift',
        horizontal.compiled.filterComplex.includes("geq=r='r(clip(X+")
            && horizontal.compiled.filterComplex.includes('pow(X/W-(0.15),2)')
            && !horizontal.compiled.filterComplex.includes('chromashift='));
    check('angled RGB split overlay filters render in FFmpeg', horizontal.rendered.status === 0 && vertical.rendered.status === 0,
        `${horizontal.rendered.stderr || ''} ${vertical.rendered.stderr || ''}`.trim());
    const a = framePixels(horizontal.output, 1), b = framePixels(vertical.output, 1);
    const difference = a && b && a.length === b.length
        ? a.reduce((sum, channel, index) => sum + Math.abs(channel - b[index]), 0)
        : 0;
    check('changing the RGB split angle changes rendered overlay pixels', difference > 1000,
        `summed frame-channel difference=${difference}`);

    const animatedEffects = [{ kind: 'rgb_split', enabled: true,
        params: { amount: 0, angle: 0, centerX: 0.5, centerY: 0.5 },
        samples: {
            amount: [{ t: 0.5, value: 0 }, { t: 2.5, value: 42 }],
            angle: [{ t: 0.5, value: 0 }, { t: 2.5, value: 90 }],
        } }];
    const animatedPlan = planFor([vclip({ id: 'rgb-animated', start: 0.5, duration: 2, extra: { x: 50, y: 50, effects: animatedEffects } })]);
    const plainPlan = planFor([vclip({ id: 'rgb-plain', start: 0.5, duration: 2, extra: { x: 50, y: 50 } })]);
    const animatedCompiled = compileCompositionPlan(animatedPlan, [{ overlayId: animatedPlan.overlays[0].id, inputIndex: 1 }]);
    const plainCompiled = compileCompositionPlan(plainPlan, [{ overlayId: plainPlan.overlays[0].id, inputIndex: 1 }]);
    const renderPlan = (compiled, name) => {
        const output = path.join(dir, `${name}.mp4`);
        const rendered = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', path.join(dir, 'base.mp4'),
            '-i', pattern, '-filter_complex', compiled.filterComplex, '-map', `[${compiled.outputLabel}]`,
            '-frames:v', '45', '-pix_fmt', 'yuv420p', '-y', output], { encoding: 'utf8', timeout: 120_000 });
        return { output, rendered };
    };
    const animatedOutput = renderPlan(animatedCompiled, 'rgb-animated');
    const plainOutput = renderPlan(plainCompiled, 'rgb-plain');
    check('overlay RGB split keyframes compile into frame-evaluated channel offsets',
        animatedCompiled.filterComplex.includes('cos(((if(lt(T')
        && animatedCompiled.filterComplex.includes('sin(((if(lt(T'));
    check('FFmpeg renders the animated overlay RGB split', animatedOutput.rendered.status === 0,
        (animatedOutput.rendered.stderr || '').split('\n').slice(-4).join(' | '));
    const frameDifference = (a, b) => a && b && a.length === b.length
        ? a.reduce((sum, channel, index) => sum + Math.abs(channel - b[index]), 0) : 0;
    const earlyDelta = frameDifference(framePixels(animatedOutput.output, 0.75), framePixels(plainOutput.output, 0.75));
    const lateDelta = frameDifference(framePixels(animatedOutput.output, 2.25), framePixels(plainOutput.output, 2.25));
    check('keyframed overlay RGB split grows from its zero setting in the exported pixels',
        animatedOutput.rendered.status === 0 && lateDelta > earlyDelta + 500,
        `early delta=${earlyDelta}, late delta=${lateDelta}`);

    const chromaticPlan = planFor([vclip({ id: 'chromatic-animated', start: 0.5, duration: 2, extra: {
        x: 50, y: 50, effects: [{ kind: 'chromatic-aberration', enabled: true, params: { amount: 0 },
            samples: { amount: [{ t: 0.5, value: 0 }, { t: 2.5, value: 10 }] } }],
    } })]);
    const chromaticPlainPlan = planFor([vclip({ id: 'chromatic-plain', start: 0.5, duration: 2, extra: { x: 50, y: 50 } })]);
    const chromaticGraph = compileCompositionPlan(chromaticPlan, [{ overlayId: chromaticPlan.overlays[0].id, inputIndex: 1 }]);
    const chromaticPlainGraph = compileCompositionPlan(chromaticPlainPlan, [{ overlayId: chromaticPlainPlan.overlays[0].id, inputIndex: 1 }]);
    const chromaticOutput = renderPlan(chromaticGraph, 'chromatic-animated');
    const chromaticPlainOutput = renderPlan(chromaticPlainGraph, 'chromatic-plain');
    check('chromatic aberration compiles its sampled amount into horizontal channel offsets',
        chromaticGraph.filterComplex.includes('round(if(lt(T'));
    check('FFmpeg renders keyframed chromatic aberration on a media overlay', chromaticOutput.rendered.status === 0,
        (chromaticOutput.rendered.stderr || '').split('\n').slice(-4).join(' | '));
    const chromaticEarlyDelta = frameDifference(framePixels(chromaticOutput.output, 0.75), framePixels(chromaticPlainOutput.output, 0.75));
    const chromaticLateDelta = frameDifference(framePixels(chromaticOutput.output, 2.25), framePixels(chromaticPlainOutput.output, 2.25));
    check('keyframed chromatic aberration grows in the exported pixels',
        chromaticOutput.rendered.status === 0 && chromaticLateDelta > chromaticEarlyDelta + 300,
        `early delta=${chromaticEarlyDelta}, late delta=${chromaticLateDelta}`);
    fs.rmSync(dir, { recursive: true, force: true });
}

section('6i.2 · RGB split keyframes and glitch controls survive export');
if (!FFMPEG) {
    skip('animated RGB split and glitch export', 'no ffmpeg binary available');
} else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comp-glitch-controls-'));
    makeSources(dir);
    const pattern = path.join(dir, 'glitch-pattern.mp4');
    const sourceResult = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
        'testsrc2=size=200x200:duration=3:rate=15', '-frames:v', '45', '-pix_fmt', 'yuv420p', '-y', pattern],
    { encoding: 'utf8', timeout: 60_000 });
    check('glitch pattern source is generated', sourceResult.status === 0, sourceResult.stderr);
    const render = (name, effect) => {
        const filters = compileTimelineVisualEffects([effect], { width: 200, height: 200, duration: 3, clipStart: 0 });
        const filter = filters.join(',');
        const output = path.join(dir, `${name}.mp4`);
        const rendered = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', pattern,
            '-vf', filter, '-frames:v', '45', '-pix_fmt', 'yuv420p', '-y', output],
        { encoding: 'utf8', timeout: 120_000 });
        return { filter, filters, output, rendered };
    };
    const stylized = render('glitch-stylized', { kind: 'glitch', enabled: true,
        params: { intensity: 0.9, blockSize: 8, colorShift: true, scanlines: true } });
    const restrained = render('glitch-restrained', { kind: 'glitch', enabled: true,
        params: { intensity: 0.9, blockSize: 128, colorShift: false, scanlines: false },
        keyframes: { intensity: [{ time: 0, value: 0.2, easing: 'linear' }, { time: 3, value: 0.9, easing: 'linear' }] } });
    check('glitch export uses authored block size, color separation and scanlines',
        /floor\(X\/8\.0000\)/.test(stylized.filter)
            && /sin\(Y\*PI\)/.test(stylized.filter)
            && /floor\(X\/128\.0000\)/.test(restrained.filter)
            && !/sin\(Y\*PI\)/.test(restrained.filter)
            && stylized.filter !== restrained.filter);
    const animatedRgb = compileTimelineVisualEffects([{ kind: 'rgb_split', enabled: true,
        params: { amount: 8, angle: 0, centerX: 0.5, centerY: 0.5 },
        keyframes: { amount: [{ time: 0, value: 8 }, { time: 3, value: 35 }], angle: [{ time: 0, value: 0 }, { time: 3, value: 90 }] },
    }], { width: 200, height: 200, duration: 3, clipStart: 0 }).join(',');
    check('animated RGB split intensity and angle are compiled as frame expressions', /cos\(\(mod\(\(if\(lt\(T/.test(animatedRgb)
        && /sin\(\(mod\(\(if\(lt\(T/.test(animatedRgb));
    check('both glitch variants render in FFmpeg', stylized.rendered.status === 0 && restrained.rendered.status === 0,
        `${stylized.rendered.stderr || ''} ${restrained.rendered.stderr || ''}`.trim().slice(-600));
    const stylizedFrame = framePixels(stylized.output, 1), restrainedFrame = framePixels(restrained.output, 1);
    const difference = stylizedFrame && restrainedFrame && stylizedFrame.length === restrainedFrame.length
        ? stylizedFrame.reduce((sum, channel, index) => sum + Math.abs(channel - restrainedFrame[index]), 0)
        : 0;
    check('glitch control choices produce visibly different exported pixels', difference > 1000,
        `summed frame-channel difference=${difference}`);
    fs.rmSync(dir, { recursive: true, force: true });
}

section('6j · Blend modes change the actual exported composite');
if (!FFMPEG) {
    skip('exported blend modes', 'no ffmpeg binary available');
} else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comp-blend-modes-'));
    makeSources(dir);
    const renderMode = mode => {
        const plan = planFor([vclip({ id: `blend-${mode}`, start: 0.5, duration: 2, extra: {
            x: 50, y: 50, blendMode: mode,
        } })]);
        const compiled = compileCompositionPlan(plan, [{ overlayId: plan.overlays[0].id, inputIndex: 1 }]);
        const rendered = runGraph(dir, compiled, `${mode}.mp4`);
        return { ...rendered, color: regionColor(rendered.out, 1, { x: 315, y: 175, w: 10, h: 10 }) };
    };
    const modes = ['multiply', 'screen', 'darken', 'lighten', 'difference', 'addition', 'overlay', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];
    const renderedModes = Object.fromEntries(modes.map(mode => [mode, renderMode(mode)]));
    const sourceOver = renderMode('source-over');
    const multiply = renderedModes.multiply;
    const screen = renderedModes.screen;
    const parse = value => value ? [0, 2, 4].map(index => parseInt(value.slice(index, index + 2), 16)) : null;
    const mul = parse(multiply.color), scr = parse(screen.color);
    const failedModes = modes.filter(mode => renderedModes[mode].r.status !== 0);
    check('all 16 advertised blend modes execute in FFmpeg', failedModes.length === 0,
        failedModes.map(mode => `${mode}: ${renderedModes[mode].r.stderr || renderedModes[mode].r.error?.message || 'failed'}`).join('\n').slice(-1200));
    check('multiply mixes the red overlay with the grey base', !!mul && mul[0] > 105 && mul[0] < 150 && mul[1] < 20 && mul[2] < 20,
        `rgb=${multiply.color}`);
    check('screen produces a lighter composite than multiply', !!mul && !!scr && scr[0] > 235 && scr[1] > 105 && scr[1] < 155 && scr[2] > 105 && scr[2] < 155,
        `multiply=${multiply.color} screen=${screen.color}`);
    check('non-separable HSL blend modes produce rendered pixels', ['hue', 'saturation', 'color', 'luminosity'].every(mode =>
        renderedModes[mode].r.status === 0 && !!renderedModes[mode].color),
        ['hue', 'saturation', 'color', 'luminosity'].map(mode => `${mode}=${renderedModes[mode].color}`).join(' '));
    check('HSL blend modes visibly differ from normal alpha compositing', sourceOver.r.status === 0
        && ['hue', 'saturation', 'color', 'luminosity'].every(mode => renderedModes[mode].color !== sourceOver.color),
        `normal=${sourceOver.color}; ${['hue', 'saturation', 'color', 'luminosity'].map(mode => `${mode}=${renderedModes[mode].color}`).join(' ')}`);
    fs.rmSync(dir, { recursive: true, force: true });
}

section('7 · The export job wires it in and reports missing overlays');
{
    const src = read('jobs/exportProcessor.js');

    check('the compositor pass exists in the export job',
        /STEP 2\.5: Composite overlay layers/.test(src));
    check('it only runs when the client sent a plan',
        /settings\.compositionPlan/.test(src),
        'no plan means the original pipeline runs completely untouched');
    check('there is a deploy-free kill switch',
        /COMPOSITOR_DISABLED/.test(src));
    check('the plan is validated before execution',
        /validateCompositionPlanShape\(rawPlan, targetWidth, targetHeight\)/.test(src));
    check('the render resolution is injected for the pixel conversion',
        /rawPlan\.renderWidth\s*=\s*targetWidth/.test(src));
    check('inline vector overlays are rendered to frame sequences before compositor input',
        /ov\.source\?\.type === 'vector' && ov\.source\.vector/.test(src)
        && /renderVectorFrames\(ov\.source\.vector/.test(src)
        && /sequenceFps:\s*targetFps/.test(src));
    check('skipped overlays leave a bounded partial-result warning on successful exports',
        /skippedOverlayWarnings\.push/.test(src)
        && /compositorWarning\s*=\s*`\$\{shown\.join\('; '\)\}/.test(src)
        && /remainder > 0/.test(src));
    check('3D scene texture failures are reported on otherwise successful exports',
        /partialOverlayWarnings\.push\(`3D image texture/.test(src)
        && /partialOverlayWarnings\.push\(`3D video texture/.test(src)
        && /const detail = `\$\{shown\.join\('; '\)\}/.test(src)
        && /compositorWarning = \[compositorWarning, detail\]\.filter\(Boolean\)\.join\(' '\)/.test(src));
    check('3D renderer truncation limits are reported on otherwise successful exports',
        /getScene3DRenderLimitWarnings\(templateParams\.scene\)/.test(src)
        && /getScene3DCompatibilityWarnings\(templateParams\.scene\)/.test(src)
        && /sceneLimitWarnings\.push\(`3D scene layer/.test(src)
        && /sceneLimitWarnings\.length/.test(src));
    check('when all overlay inputs fail, the export warning retains the layer-specific cause',
        /no drawable overlay layers after source resolution\$\{detail \? `: \$\{detail\}/.test(src));
    check('it FAILS OPEN — a compositor error does not fail the export',
        /catch \(compErr\)/.test(src) && /exporting without overlays/.test(src),
        'a video missing its stickers is a far better outcome than no video (same rule as the LUT lookup)');
    check('the failure is surfaced to the user, not swallowed',
        /compositorWarning/.test(src) && /compositorWarning: compositorWarning \|\| undefined/.test(src));
    check('audio is left for the existing mix step',
        /\.audioCodec\('copy'\)[\s\S]{0,400}composited\.mp4|composited\.mp4[\s\S]{0,400}/.test(src));

    // The pass must sit AFTER concat and BEFORE the audio mix, or it would
    // either composite per-segment or clobber the mixed audio.
    const concatIdx = src.indexOf('STEP 2: Concatenate');
    const compIdx   = src.indexOf('STEP 2.5: Composite');
    const audioIdx  = src.indexOf('STEP 3: Mix audio');
    check('it is ordered after concat and before the audio mix',
        concatIdx !== -1 && compIdx > concatIdx && audioIdx > compIdx);

    const client = read('client/src/layouts/IDELayout.jsx');
    check('the client builds and sends the plan',
        /buildCompositionPlan/.test(client) && /compositionPlan,/.test(client));
    check('the client sends null when there is nothing to composite',
        /planIsNoOp\(plan\) \? null : plan/.test(client),
        'that null is what keeps the worker on its original path for existing projects');
    check('a composition-plan build error blocks an incomplete export',
        /throw new Error\(`Could not prepare motion graphics for export: \$\{planErr\.message\}`\)/.test(client)
            && !/exporting without overlays/.test(client));
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`Compositor export: ${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
console.log('─'.repeat(60));
process.exit(failed > 0 ? 1 : 0);
