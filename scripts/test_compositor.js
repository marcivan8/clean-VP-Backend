#!/usr/bin/env node
/**
 * Regression: the compositing model (CLAUDE.md R59).
 *
 * The compositor's job is to let two things be on screen at once — which the
 * export has never been able to do, because `jobs/exportProcessor.js` flattens
 * every clip from every video track into ONE array sorted by start time, so
 * overlapping clips are played in sequence instead of layered.
 *
 * The two things most worth pinning here are not the geometry maths:
 *
 *  §1  THE NON-BREAKING GUARANTEE. Every project that renders correctly today
 *      must produce an EMPTY overlay list, so the export runs byte-for-byte as
 *      it did before. If this section ever goes red, the change stopped being
 *      additive and started being a rewrite of the export path.
 *
 *  §3  OUTPUT TIME ≠ TIMELINE TIME. The exported video concatenates base
 *      segments back-to-back with gaps removed and speed applied, so a graphic
 *      at 12s on the timeline does NOT belong at 12s in the file. Getting this
 *      wrong fails silently and beautifully: everything renders, nothing errors,
 *      every overlay is at the wrong moment.
 *
 * Run: node scripts/test_compositor.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const check = (n, c, d) => {
    if (c) { passed++; console.log(`  ✓ ${n}`); }
    else { failed++; console.log(`  ✗ ${n}`); if (d) console.log(`      ${d}`); }
};
const section = (t) => console.log(`\n${t}`);
const near = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => {
    try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
    catch (err) { console.log(`  ✗ could not read ${rel} — ${err.code || err.message}`); failed++; return ''; }
};

// Load the ESM motion modules into CJS by stripping module syntax — the same
// approach as test_motion_engine.js. Exercises the REAL source; a hand-copied
// duplicate would pass while the shipped file was broken.
function loadModules() {
    const order = ['Easing', 'MotionSchema', 'MotionPresetExpansion', 'MotionExpression', 'SpatialMotion', 'AudioReactive', 'MotionResolver', 'MotionPresets', 'EffectTiming', 'CaptionModel', 'ClipAdapter', 'Compositor'];
    let combined = '';
    for (const name of order) {
        let src = read(`client/src/motion/${name}.js`);
        src = src
            .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
            .replace(/^\s*export\s+default\s+\{[\s\S]*?\};\s*$/gm, '')
            .replace(/^\s*export\s+default\s+[^;]+;\s*$/gm, '')
            .replace(/\bexport\s+(const|function|class|let)\b/g, '$1');
        combined += `\n/* ---- ${name} ---- */\n${src}\n`;
    }
    combined += '\nreturn { buildCompositionPlan, planIsNoOp, validateCompositionPlan, buildTimeMap,'
             + ' timelineToOutputTime, resolveCompositionAt, interpolateGeometry,'
             + ' COMPOSITION_PLAN_VERSION, getVisualTrackRoles, buildPreset };\n';
    // eslint-disable-next-line no-new-func
    return new Function(combined)();
}

let M;
try { M = loadModules(); }
catch (err) { console.error('FATAL: could not load client/src/motion/*.js —', err.message); process.exit(1); }

const FRAME = { width: 1080, height: 1920, fps: 30 };

const vclip = (o) => ({
    id: o.id, type: 'video', start: o.start, duration: o.duration,
    speed: o.speed || 1, offset: o.offset || 0,
    url: o.url || `https://example/${o.id}.mp4`,
    metadata: { resolution: { w: o.w || 1080, h: o.h || 1920 } },
    ...o.extra,
});

// R62 — a sticker/logo clip, as produced by useTimelineStore.addOverlayClip().
const oclip = (o) => ({
    id: o.id, type: o.kind || 'sticker', start: o.start, duration: o.duration,
    url: o.url || `https://example/${o.id}.png`,
    x: o.x ?? 78, y: o.y ?? 18, scale: o.scale ?? 1,
    metadata: { resolution: { w: o.w || 512, h: o.h || 512 } },
});

section('1 · THE NON-BREAKING GUARANTEE — today\'s projects composite to nothing');
{
    const single = [{ id: 'v1', type: 'video', order: 0, clips: [vclip({ id: 'a', start: 0, duration: 5 })] }];
    const plan = M.buildCompositionPlan(single, FRAME);
    check('a single video track yields ZERO overlays',
        plan.overlays.length === 0,
        'if this is ever non-zero, the export path stopped being untouched for existing projects');
    check('planIsNoOp() reports it, so the overlay pass can be skipped wholesale',
        M.planIsNoOp(plan) === true);

    const withAudioAndText = [
        { id: 'v1', type: 'video', order: 0, clips: [vclip({ id: 'a', start: 0, duration: 5 })] },
        { id: 'a1', type: 'audio', order: 1, clips: [{ id: 'aud', start: 0, duration: 5 }] },
        { id: 't1', type: 'text',  order: 2, clips: [{ id: 'cap', start: 1, duration: 2, type: 'text', content: 'hi' }] },
    ];
    const plan2 = M.buildCompositionPlan(withAudioAndText, FRAME);
    check('audio tracks never composite', M.planIsNoOp(plan2) === true);
    check('TEXT tracks never composite either',
        plan2.overlays.every(o => o.kind !== 'text' && o.kind !== 'caption'),
        'captions are burned in by their own drawtext pass — compositing them here would double-render them');

    check('an empty timeline is handled', M.planIsNoOp(M.buildCompositionPlan([], FRAME)) === true);
    check('null/garbage input does not throw', M.planIsNoOp(M.buildCompositionPlan(null, FRAME)) === true);
}

section('2 · A second video track DOES composite, bottom-to-top');
{
    const tracks = [
        { id: 'v1', type: 'video', order: 0, clips: [vclip({ id: 'base', start: 0, duration: 10 })] },
        { id: 'v2', type: 'video', order: 1, clips: [vclip({ id: 'pip', start: 2, duration: 3 })] },
        { id: 'v3', type: 'video', order: 2, clips: [vclip({ id: 'logo', start: 2, duration: 3 })] },
    ];
    const plan = M.buildCompositionPlan(tracks, FRAME);

    check('the FIRST video track is the base and is not an overlay',
        plan.base.trackId === 'v1' && plan.overlays.every(o => o.trackId !== 'v1'),
        'keeping the base untouched is what makes this additive');
    check('the two upper tracks become overlays', plan.overlays.length === 2);
    check('z-order follows track order (higher track = higher zIndex)',
        plan.overlays.find(o => o.trackId === 'v3').zIndex >
        plan.overlays.find(o => o.trackId === 'v2').zIndex);
    check('overlays carry a resolvable source',
        plan.overlays.every(o => !!o.source.url));
    check('the plan validates', M.validateCompositionPlan(plan).valid,
        M.validateCompositionPlan(plan).errors.join('; '));

    // The whole point: two things visible simultaneously.
    const visible = M.resolveCompositionAt(plan, 3);
    check('BOTH overlays are visible at the same instant', visible.length === 2,
        'this is the capability the flattened export array structurally cannot express');
    check('composition visibility includes the start and excludes the end frame',
        M.resolveCompositionAt(plan, plan.overlays[0].outputStart).some(ov => ov.id === plan.overlays[0].id)
            && !M.resolveCompositionAt(plan, plan.overlays[0].outputEnd).some(ov => ov.id === plan.overlays[0].id));
    check('resolved overlays come back back-to-front',
        visible[0].zIndex < visible[1].zIndex);
}

section('3 · OUTPUT TIME ≠ TIMELINE TIME (the silent-failure trap)');
{
    // A gap between base clips: 0-4s, then 10-14s. The output is 8s long, and
    // the second clip starts at 4s in the file, not 10s.
    const baseClips = [
        vclip({ id: 'b1', start: 0,  duration: 4 }),
        vclip({ id: 'b2', start: 10, duration: 4 }),
    ];
    const map = M.buildTimeMap(baseClips);
    check('gaps are removed — total output is 8s, not 14s', near(map.totalDuration, 8));
    check('a time in the first segment maps 1:1', near(M.timelineToOutputTime(map, 2), 2));
    check('a time in the SECOND segment is shifted back by the gap',
        near(M.timelineToOutputTime(map, 11), 5),
        'timeline 11s is output 5s — an overlay placed at 11s must be drawn at 5s or it lands on the wrong shot');
    check('a time inside the gap snaps to the next segment',
        near(M.timelineToOutputTime(map, 7), 4));
    check('before the start clamps to 0', near(M.timelineToOutputTime(map, -3), 0));
    check('past the end clamps to the total', near(M.timelineToOutputTime(map, 99), 8));

    // A clip's duration is already its TIMELINE length (setClipSpeed made a
    // 10 s clip 5 s long at 2×), so speed must not shorten it a second time.
    const fast = M.buildTimeMap([vclip({ id: 'f', start: 0, duration: 5, speed: 2 })]);
    check('a 2× clip lasts its timeline duration in the output (no double speed-up)', near(fast.totalDuration, 5));
    check('and timeline times inside it map 1:1', near(M.timelineToOutputTime(fast, 4), 4));

    // End to end: the overlay window must be expressed in OUTPUT time.
    const tracks = [
        { id: 'v1', type: 'video', order: 0, clips: baseClips },
        { id: 'v2', type: 'video', order: 1, clips: [vclip({ id: 'ov', start: 11, duration: 2 })] },
    ];
    const plan = M.buildCompositionPlan(tracks, FRAME);
    check('an overlay authored at timeline 11s is planned at output 5s',
        near(plan.overlays[0].outputStart, 5),
        'the single most consequential number in the whole plan');
    check('its end is remapped too', near(plan.overlays[0].outputEnd, 7));
}

section('4 · Geometry: centre-percent in, NORMALISED top-left out');
{
    // x/y are PERCENT naming the element CENTRE (TextOverlay convention);
    // ffmpeg overlay wants the TOP-LEFT corner.
    const tracks = [
        { id: 'v1', type: 'video', order: 0, clips: [vclip({ id: 'base', start: 0, duration: 10 })] },
        { id: 'v2', type: 'video', order: 1, clips: [
            vclip({ id: 'ov', start: 0, duration: 4, w: 400, h: 400,
                    extra: { x: 50, y: 50, scale: 1 } }),
        ] },
    ];
    const plan = M.buildCompositionPlan(tracks, FRAME);
    const g = plan.overlays[0].geometry[0];

    check('geometry is NORMALISED (0..1), not pixels',
        g.w > 0 && g.w <= 1 && g.h > 0 && g.h <= 1,
        `w=${g.w} h=${g.h} — pixels would tie the plan to one export resolution and force a duplicated preset table`);
    check('a centred overlay is horizontally centred as a top-left coordinate',
        near(g.x + g.w / 2, 0.5, 0.005),
        `x=${g.x} w=${g.w} — dropping the centring term is what pushed captions off-frame before`);
    check('and vertically centred',
        near(g.y + g.h / 2, 0.5, 0.005));
    check('the overlay preserves its source aspect ratio',
        near((g.w * FRAME.width) / (g.h * FRAME.height), 400 / 400, 0.02),
        'a square source must not come out stretched by the frame aspect');
    const anisotropic = M.buildCompositionPlan([
        { id: 'v1', type: 'video', order: 0, clips: [vclip({ id: 'base', start: 0, duration: 10 })] },
        { id: 'v2', type: 'video', order: 1, clips: [vclip({ id: 'stretch', start: 0, duration: 4, w: 400, h: 400,
            extra: { x: 50, y: 50, scale: 1, scaleX: 2, scaleY: 0.5 } })] },
    ], FRAME).overlays[0].geometry[0];
    check('independent scaleX and scaleY change overlay width and height independently',
        near(anisotropic.w, g.w * 2) && near(anisotropic.h, g.h * 0.5),
        `base=${g.w}x${g.h}; anisotropic=${anisotropic.w}x${anisotropic.h}`);
    const mirrored = M.buildCompositionPlan([
        { id: 'v1', type: 'video', order: 0, clips: [vclip({ id: 'base', start: 0, duration: 10 })] },
        { id: 'v2', type: 'video', order: 1, clips: [vclip({ id: 'mirror', start: 0, duration: 2, w: 400, h: 400,
            extra: { x: 50, y: 50, scale: 1, scaleX: -1, scaleY: -0.5 } })] },
    ], FRAME).overlays[0].geometry[0];
    check('negative axis scales preserve positive centered bounds and carry mirror flags',
        near(mirrored.w, g.w) && near(mirrored.h, g.h * 0.5)
            && near(mirrored.x + mirrored.w / 2, 0.5) && mirrored.flipH === 1 && mirrored.flipV === 1,
        JSON.stringify(mirrored));
    const collapsed = M.buildCompositionPlan([
        { id: 'v1', type: 'video', order: 0, clips: [vclip({ id: 'base', start: 0, duration: 10 })] },
        { id: 'v2', type: 'video', order: 1, clips: [vclip({ id: 'collapsed', start: 0, duration: 2, w: 400, h: 400,
            extra: { scale: 0 } })] },
    ], FRAME).overlays[0].geometry[0];
    check('zero scale resolves to a transparent collapsed overlay', collapsed.opacity === 0,
        JSON.stringify(collapsed));
    check('a static overlay collapses to a single geometry sample',
        plan.overlays[0].geometry.length === 1 && plan.overlays[0].animated === false,
        'a static overlay should compile to a plain overlay=x=N:y=M, not an expression');

    // Off-centre placement.
    const offset = M.buildCompositionPlan([
        { id: 'v1', type: 'video', order: 0, clips: [vclip({ id: 'base', start: 0, duration: 10 })] },
        { id: 'v2', type: 'video', order: 1, clips: [
            vclip({ id: 'ov', start: 0, duration: 2, w: 200, h: 200, extra: { x: 25, y: 75 } }),
        ] },
    ], FRAME);
    const og = offset.overlays[0].geometry[0];
    check('x=25% puts the overlay centre a quarter across',
        near(og.x + og.w / 2, 0.25, 0.005));
    check('y=75% puts it three-quarters down',
        near(og.y + og.h / 2, 0.75, 0.005));

    // Resolution independence is the payoff of normalising.
    const at720 = M.buildCompositionPlan(tracks, { width: 720, height: 1280, fps: 30 });
    const at4k  = M.buildCompositionPlan(tracks, { width: 2160, height: 3840, fps: 30 });
    check('the SAME plan geometry results at 720p and 4K',
        near(at720.overlays[0].geometry[0].x, at4k.overlays[0].geometry[0].x, 1e-4)
        && near(at720.overlays[0].geometry[0].w, at4k.overlays[0].geometry[0].w, 1e-4),
        'one plan must export correctly at any resolution — that is why geometry is normalised');
}

section('5 · Animated overlays sample into piecewise-linear geometry');
{
    const anims = M.buildPreset('float', { duration: 4 });
    const tracks = [
        { id: 'v1', type: 'video', order: 0, clips: [vclip({ id: 'base', start: 0, duration: 10 })] },
        { id: 'v2', type: 'video', order: 1, clips: [
            vclip({ id: 'ov', start: 0, duration: 4, w: 300, h: 300,
                    extra: { x: 50, y: 50, animations: anims } }),
        ] },
    ];
    const plan = M.buildCompositionPlan(tracks, FRAME);
    const ov = plan.overlays[0];

    check('an animated overlay produces multiple samples', ov.geometry.length > 1 && ov.animated === true);
    check('samples are ordered in output time',
        ov.geometry.every((g, i, a) => i === 0 || g.t >= a[i - 1].t));
    check('every sample is finite and positive-sized',
        ov.geometry.every(g => [g.x, g.y, g.w, g.h, g.t].every(Number.isFinite) && g.w > 0 && g.h > 0));
    check('the float preset actually moves the overlay vertically',
        new Set(ov.geometry.map(g => g.y)).size > 1,
        'a preset that samples to a constant would mean the animation never reached the plan');

    // Pins the Douglas-Peucker fix. A neighbour-by-neighbour simplifier drops
    // every point of a smooth arc one at a time and flattens it to its
    // endpoints — the overlay would then export completely STATIC while the
    // preview animated correctly. Silent, and exactly the divergence class this
    // module exists to prevent.
    const ys = ov.geometry.map(g => g.y);
    const amplitude = Math.max(...ys) - Math.min(...ys);
    check('sample simplification preserves the CURVE, not just its endpoints',
        amplitude > 0.005,
        `y amplitude ${amplitude} — a flattened curve means the animation was simplified away`);
    check('and the first and last samples are always retained',
        near(ov.geometry[0].t, ov.outputStart, 0.05)
        && near(ov.geometry[ov.geometry.length - 1].t, ov.outputEnd, 0.05));

    const mid = M.interpolateGeometry(ov.geometry, (ov.outputStart + ov.outputEnd) / 2);
    check('geometry interpolates between samples', mid && Number.isFinite(mid.y));
    check('interpolation clamps before the first sample',
        M.interpolateGeometry(ov.geometry, -10).t === ov.geometry[0].t);
    check('and after the last',
        M.interpolateGeometry(ov.geometry, 1e6).t === ov.geometry[ov.geometry.length - 1].t);
}

section('5b · Procedural geometry sampling follows the output frame rate');
{
    const tracks = [
        { id: 'v1', type: 'video', order: 0, clips: [vclip({ id: 'base', start: 0, duration: 2 })] },
        { id: 'v2', type: 'video', order: 1, clips: [
            vclip({ id: 'procedural', start: 0, duration: 1, w: 200, h: 200, extra: {
                x: 50, y: 50, expressions: { x: '50 + 20 * sin(2 * pi * 12 * t)' },
            } }),
        ] },
    ];
    const plan = M.buildCompositionPlan(tracks, { ...FRAME, fps: 30 });
    const geometry = plan.overlays[0].geometry;
    const frameTime = 1 / 30;
    const frameSample = geometry.find(sample => near(sample.t, frameTime, 1e-4));
    const expectedCenterX = (50 + 20 * Math.sin(2 * Math.PI * 12 * frameTime)) / 100;
    check('30fps output retains a sample at the first output-frame time', !!frameSample,
        'procedural animation must use an output-rate-aware sampling clock');
    check('fast procedural position matches its evaluated value at that frame',
        !!frameSample && near(frameSample.x + frameSample.w / 2, expectedCenterX, 0.002));
}

section('5c · Asset-keyed audio motion reaches the export geometry plan');
{
    const fractional = M.interpolateGeometry([
        { t: 0, x: 0.1, y: 0.2, w: 0.25, h: 0.5, rotation: 0, opacity: 1, blur: 0 },
        { t: 1, x: 0.3, y: 0.4, w: 0.35, h: 0.7, rotation: 0, opacity: 1, blur: 0 },
    ], 0.5);
    check('normalized geometry interpolation preserves frame fractions', near(fractional.x, 0.2) && near(fractional.w, 0.3));
    const tracks = [
        { id: 'v1', type: 'video', order: 0, clips: [vclip({ id: 'base', start: 0, duration: 1 })] },
        { id: 'v2', type: 'video', order: 1, clips: [vclip({ id: 'reactive', start: 0, duration: 1, extra: {
            audioReactive: { assetId: 'music', target: 'scale', amount: 0.5 },
        } })] },
    ];
    const plan = M.buildCompositionPlan(tracks, {
        ...FRAME, audioWaveformsByAsset: { music: { peaks: [0, 1], duration: 1 } },
    });
    const middle = M.interpolateGeometry(plan.overlays[0]?.geometry || [], 0.5);
    check('2D layer audio reactivity is sampled into export geometry', !!middle && near(middle.w, 0.3125, 0.002),
        `midpoint geometry: ${JSON.stringify(middle)}; samples=${plan.overlays[0]?.geometry?.length}`);
}

section('5d · Effect keyframes stay on project timeline time');
{
    const tracks = [
        { id: 'v1', type: 'video', order: 0, clips: [vclip({ id: 'base', start: 0, duration: 8 })] },
        { id: 'v2', type: 'video', order: 1, clips: [vclip({ id: 'effect-overlay', start: 2, duration: 4, extra: {
            effects: [{ kind: 'brightness', params: { amount: 1 }, keyframes: { amount: [
                { time: 2, value: 0.2 }, { time: 6, value: 1.8, easing: 'linear' },
            ] } }],
        } })] },
    ];
    const plan = M.buildCompositionPlan(tracks, FRAME);
    const samples = plan.overlays[0].effects[0].samples.amount;
    const start = samples.find(sample => near(sample.t, 2));
    const middle = samples.find(sample => near(sample.t, 4));
    const end = samples.find(sample => near(sample.t, 6));
    check('the first effect keyframe aligns with the overlay start', !!start && near(start.value, 0.2));
    check('a project-time keyframe interpolates at its timeline position', !!middle && near(middle.value, 1));
    check('the last effect keyframe aligns with the overlay end', !!end && near(end.value, 1.8));
}

section('6 · The plan is safe to hand to a worker');
{
    const tracks = [
        { id: 'v1', type: 'video', order: 0, clips: [vclip({ id: 'base', start: 0, duration: 6 })] },
        { id: 'v2', type: 'video', order: 1, clips: [vclip({ id: 'ov', start: 1, duration: 2 })] },
    ];
    const plan = M.buildCompositionPlan(tracks, FRAME);

    check('the plan survives a JSON round-trip',
        JSON.stringify(JSON.parse(JSON.stringify(plan))) === JSON.stringify(plan),
        'it is shipped to the render worker in the export settings, exactly as projectLUTId is');
    check('it is versioned so a worker can reject one it cannot execute',
        plan.version === M.COMPOSITION_PLAN_VERSION);

    check('a plan from the future is rejected',
        M.validateCompositionPlan({ ...plan, version: 999 }).valid === false);
    check('an overlay with no source is rejected',
        M.validateCompositionPlan({ ...plan,
            overlays: [{ ...plan.overlays[0], source: {} }] }).valid === false,
        'the worker cannot fetch a layer that names no file');
    check('a zero-length overlay window is rejected',
        M.validateCompositionPlan({ ...plan,
            overlays: [{ ...plan.overlays[0], outputEnd: plan.overlays[0].outputStart }] }).valid === false);
    check('non-finite overlay timing is rejected',
        M.validateCompositionPlan({ ...plan,
            overlays: [{ ...plan.overlays[0], outputEnd: Infinity }] }).valid === false);
    check('invalid transform samples are rejected before render',
        M.validateCompositionPlan({ ...plan,
            overlays: [{ ...plan.overlays[0], geometry: [{ ...plan.overlays[0].geometry[0], rotation: null }] }] }).valid === false);
    check('opacity outside the compositing range is rejected',
        M.validateCompositionPlan({ ...plan,
            overlays: [{ ...plan.overlays[0], geometry: [{ ...plan.overlays[0].geometry[0], opacity: 1.5 }] }] }).valid === false);
    check('a zero-width ellipse matte is rejected before export compilation',
        M.validateCompositionPlan({ ...plan, overlays: [{ ...plan.overlays[0], sceneMask: {
            kind: 'shape', shape: 'ellipse', x: 0.2, y: 0.2, w: 0, h: 0.6,
        } }] }).valid === false);
    check('a matte extending beyond the overlay bounds is rejected',
        M.validateCompositionPlan({ ...plan, overlays: [{ ...plan.overlays[0], sceneMask: {
            kind: 'shape', shape: 'rectangle', x: 0.8, y: 0.1, w: 0.3, h: 0.5,
        } }] }).valid === false);
    check('omitted or null mask bounds fall back to the configured inset',
        M.validateCompositionPlan({ ...plan, overlays: [{ ...plan.overlays[0], sceneMask: {
            kind: 'shape', shape: 'rectangle', inset: 0.1, x: null, y: null, w: null, h: null,
        } }] }).valid === true);
    for (const shape of ['capsule', 'callout']) {
        check(`${shape} masks supported by preview and export pass client plan validation`,
            M.validateCompositionPlan({ ...plan, overlays: [{ ...plan.overlays[0], sceneMask: {
                kind: 'shape', shape, inset: 0.1, x: null, y: null, w: null, h: null,
            } }] }).valid === true);
    }
    check('duplicate zIndex is rejected',
        M.validateCompositionPlan({ ...plan,
            overlays: [{ ...plan.overlays[0], zIndex: 1 }, { ...plan.overlays[0], id: 'x', zIndex: 1 }] }).valid === false,
        '"on top of" is undefined without a strict order');
    check('validation never throws on garbage',
        M.validateCompositionPlan(null).valid === false && M.validateCompositionPlan(42).valid === false);
}

section('7 · Purity — the plan is computed once and shared, not reimplemented');
{
    const src = read('client/src/motion/Compositor.js');
    const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const code = stripComments(src);

    check('the compositor has no React/DOM/store dependency',
        !/^\s*import\s[^;]*from\s*['"]react['"]/m.test(code)
        && !/useTimelineStore/.test(code)
        && !/\bdocument\s*\./.test(code)
        && !/\bwindow\s*\./.test(code),
        'the same plan must be usable by the preview AND serialisable to the worker');

    const externalImports = (code.match(/^\s*import\s[^;]*from\s*['"]([^'"]+)['"]/gm) || [])
        .map(l => (l.match(/from\s*['"]([^'"]+)['"]/) || [])[1])
        .filter(p => p && !p.startsWith('./'));
    check('it imports nothing outside motion/', externalImports.length === 0, externalImports.join(', '));

    check('it is exported from the motion barrel',
        /buildCompositionPlan/.test(read('client/src/motion/index.js')));

    // The remap must exist in exactly one place. If the worker grows its own
    // copy, this is the check that should start failing.
    check('the compositor owns the timeline→output remap',
        /function timelineToOutputTime/.test(code) && /function buildTimeMap/.test(code),
        'exportProcessor has vibedToOutputTime for captions; overlays must not grow a second, drifting copy');
}

section('8 · R62 — the "overlay" graphics track composites without becoming the base');
{
    // The dangerous case: an overlay track and the video track BOTH land on
    // order 0 (addTrack() assigns order per-type — "lowest order among tracks
    // of MY type" — so the first track of any two different types both get 0).
    // If the base were chosen by raw `order` alone, this would be a coin flip
    // decided by object-iteration order. It must not be.
    const tracks = [
        { id: 'ov1', type: 'overlay', order: 0, clips: [oclip({ id: 'logo', start: 0, duration: 10 })] },
        { id: 'v1',  type: 'video',   order: 0, clips: [vclip({ id: 'base', start: 0, duration: 10 })] },
    ];
    const plan = M.buildCompositionPlan(tracks, FRAME);

    check('the video track is the base even though it is SECOND in the array and TIES on order',
        plan.base.trackId === 'v1',
        `got base.trackId="${plan.base.trackId}" — an overlay track became the base, which means it would be segmented/concatenated as if it were the main footage`);
    check('the overlay track composites as an overlay, not as base',
        plan.overlays.length === 1 && plan.overlays[0].trackId === 'ov1');
    check('the overlay carries its clip kind through (sticker)',
        plan.overlays[0].kind === 'sticker');
    check('the plan validates', M.validateCompositionPlan(plan).valid,
        M.validateCompositionPlan(plan).errors.join('; '));

    // Same scenario, tracks in the OTHER array order — result must be identical.
    // (This is the actual regression the priority-sort fix targets: without
    // it, swapping array order could flip which track becomes base.)
    const swapped = [tracks[1], tracks[0]];
    const planSwapped = M.buildCompositionPlan(swapped, FRAME);
    check('base selection is independent of array order',
        planSwapped.base.trackId === 'v1' && planSwapped.overlays[0].trackId === 'ov1');

    const stackedVideoTracks = [
        { id: 'main-video', type: 'video', order: 0, clips: [vclip({ id: 'main', start: 0, duration: 5 })] },
        { id: 'broll-video', type: 'video', order: 1, clips: [vclip({ id: 'broll', start: 1, duration: 2 })] },
        { id: 'graphics', type: 'overlay', order: 2, clips: [oclip({ id: 'title', start: 1, duration: 2 })] },
    ];
    const roles = M.getVisualTrackRoles(stackedVideoTracks);
    const stackedPlan = M.buildCompositionPlan(stackedVideoTracks, FRAME);
    check('shared visual track roles keep the first video as base and expose higher video tracks as layers',
        roles.baseTrack?.id === 'main-video' && roles.overlayTracks.map(track => track.id).join(',') === 'broll-video,graphics');
    check('export plan composites higher video tracks in front-to-back track order',
        stackedPlan.base.trackId === 'main-video'
        && stackedPlan.overlays.map(layer => layer.trackId).join(',') === 'broll-video,graphics');
    const previewSource = read('client/src/components/Player/GraphicOverlay.jsx');
    check('preview uses the shared base/layer track roles instead of filtering to explicit overlay tracks',
        /getVisualTrackRoles\(tracks\)/.test(previewSource)
        && !/tracks\.filter\(t\s*=>\s*t\.type\s*===\s*'overlay'\)/.test(previewSource));
    check('preview keeps the source track type when rendering a video or image layer',
        /trackType:\s*track\.type/.test(previewSource)
        && /\(clip\.type\s*\|\|\s*trackType\)\s*===\s*'video'/.test(previewSource));
    const playerSource = read('client/src/components/Player/VideoPlayer.jsx');
    check('main preview prefers the shared base track and falls back only across a base gap',
        /const \{ baseTrack \} = getVisualTrackRoles\(tracks\)/.test(playerSource)
        && /\(videoTrack\?\.clips \|\| \[\]\)\.find\(isPlayableClip\)\s*\|\|\s*videoTracks\.filter/.test(playerSource));

    // A project with NO video track at all — an overlay-only project should
    // not crash; the "base" is simply empty rather than the overlay track
    // silently being promoted into that role.
    const overlayOnly = [{ id: 'ov2', type: 'overlay', order: 0, clips: [oclip({ id: 'watermark', start: 0, duration: 5 })] }];
    const planOverlayOnly = M.buildCompositionPlan(overlayOnly, FRAME);
    check('an overlay-only project (no video track) does not crash and has no base',
        planOverlayOnly.base.trackId === null,
        `expected null, got "${planOverlayOnly.base.trackId}"`);
    check('...and the sticker itself is dropped rather than rendered against an empty timeline',
        planOverlayOnly.overlays.length === 0,
        'with no base segments there is no output-time position for it to occupy — this is unreachable from the app today (exportProcessor requires a video track before STEP 2.5 runs at all), pinned here so buildCompositionPlan stays safe as a standalone function');

    const vectorPayload = {
        kind: 'path', w: 400, h: 220,
        pathData: 'M 20 110 L 380 110', fill: 'none', stroke: '#2785FF', strokeWidth: 14,
        motion: { preset: 'draw', duration: 0.8, easing: 'easeOutCubic' },
    };
    const vectorPlan = M.buildCompositionPlan([
        { id: 'v1', type: 'video', order: 0, clips: [vclip({ id: 'base', start: 0, duration: 5 })] },
        { id: 'graphics', type: 'overlay', order: 1, clips: [{
            id: 'vector-title', start: 1, duration: 2, vector: vectorPayload,
        }] },
    ], FRAME);
    check('inline vector payload is preserved and normalized to a renderable vector source',
        vectorPlan.overlays[0]?.source?.type === 'vector'
        && JSON.stringify(vectorPlan.overlays[0]?.source?.vector) === JSON.stringify(vectorPayload));
    check('vector-only composition plans pass client validation without a URL or asset id',
        M.validateCompositionPlan(vectorPlan).valid,
        M.validateCompositionPlan(vectorPlan).errors.join('; '));
    check('ellipse vector sources supported by the renderer pass client validation',
        M.validateCompositionPlan({ ...vectorPlan, overlays: [{ ...vectorPlan.overlays[0], source: { type: 'vector', vector: { kind: 'ellipse', w: 120, h: 72 } } }] }).valid);
    check('malformed inline vector payloads are rejected by client validation',
        !M.validateCompositionPlan({ ...vectorPlan, overlays: [{ ...vectorPlan.overlays[0], source: { type: 'vector', vector: { kind: 'path', pathData: '' } } }] }).valid);

    const effectsPlan = M.buildCompositionPlan([
        { id: 'v1', type: 'video', order: 0, clips: [vclip({ id: 'base', start: 0, duration: 10 })] },
        { id: 'v2', type: 'video', order: 1, clips: [vclip({
            id: 'fx-overlay', start: 0, duration: 2,
            extra: { effects: [{ type: 'blur_gaussian', params: { radius: { value: 4 } }, enabled: true, startTime: 0.25, endTime: 1.5,
                keyframes: { radius: [{ time: 0, value: 2 }, { time: 1, value: 8, easing: 'ease-in-out' }] } }] },
        })] },
    ], FRAME);
    check('overlay footage effects accept EffectRegistry type/value params in the export plan',
        effectsPlan.overlays[0]?.effects?.[0]?.kind === 'blur_gaussian'
        && effectsPlan.overlays[0]?.effects?.[0]?.params?.radius === 4
        && effectsPlan.overlays[0]?.effects?.[0]?.startTime === 0.25
        && effectsPlan.overlays[0]?.effects?.[0]?.endTime === 1.5
        && effectsPlan.overlays[0]?.effects?.[0]?.keyframes?.radius?.length === 2
        && effectsPlan.overlays[0]?.effects?.[0]?.samples?.radius?.length > 1);
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`Compositor: ${passed} passed, ${failed} failed`);
console.log('─'.repeat(60));
process.exit(failed > 0 ? 1 : 0);
