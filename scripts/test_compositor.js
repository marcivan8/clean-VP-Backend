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
    const order = ['Easing', 'MotionSchema', 'MotionResolver', 'MotionPresets', 'CaptionModel', 'ClipAdapter', 'Compositor'];
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
             + ' COMPOSITION_PLAN_VERSION, buildPreset };\n';
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

    // Speed compresses output time.
    const fast = M.buildTimeMap([vclip({ id: 'f', start: 0, duration: 10, speed: 2 })]);
    check('a 2× clip occupies half the output duration', near(fast.totalDuration, 5));
    check('and times inside it are compressed', near(M.timelineToOutputTime(fast, 10), 5));

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
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`Compositor: ${passed} passed, ${failed} failed`);
console.log('─'.repeat(60));
process.exit(failed > 0 ? 1 : 0);
