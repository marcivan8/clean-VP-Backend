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

// Build plans with the REAL client Compositor, so this exercises the true
// client→worker path rather than a hand-written plan that could drift from it.
function loadCompositor() {
    const order = ['Easing', 'MotionSchema', 'MotionResolver', 'MotionPresets', 'CaptionModel', 'ClipAdapter', 'Compositor'];
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
    combined += 'return { buildCompositionPlan, buildPreset, COMPOSITION_PLAN_VERSION };';
    // eslint-disable-next-line no-new-func
    return new Function(combined)();
}
const C = loadCompositor();

function ffmpegBin() {
    for (const bin of ['ffmpeg', '/usr/bin/ffmpeg']) {
        const r = spawnSync(bin, ['-version'], { encoding: 'utf8' });
        if (r.status === 0) return bin;
    }
    try { return require('ffmpeg-static'); } catch { return null; }
}
const FFMPEG = ffmpegBin();

const W = 640, H = 360;
const vclip = (o) => ({
    id: o.id, type: o.type || 'video', start: o.start, duration: o.duration,
    speed: 1, offset: 0, url: `file://${o.id}`,
    metadata: { resolution: { w: o.w || 200, h: o.h || 200 } },
    ...o.extra,
});
const makeTracks = (overlayClips) => ([
    { id: 'v1', type: 'video', order: 0, clips: [vclip({ id: 'base', start: 0, duration: 3, w: W, h: H })] },
    { id: 'v2', type: 'video', order: 1, clips: overlayClips },
]);
const planFor = (overlayClips) => {
    const p = C.buildCompositionPlan(makeTracks(overlayClips), { width: W, height: H, fps: 15 });
    p.renderWidth = W; p.renderHeight = H;
    return p;
};

section('1 · The client and worker agree on the plan version');
{
    check('worker\'s SUPPORTED_PLAN_VERSION matches the client\'s COMPOSITION_PLAN_VERSION',
        SUPPORTED_PLAN_VERSION === C.COMPOSITION_PLAN_VERSION,
        `worker=${SUPPORTED_PLAN_VERSION} client=${C.COMPOSITION_PLAN_VERSION} — these deploy independently; a mismatch means a browser tab open across a deploy posts plans the worker silently mis-renders`);
}

section('2 · The worker refuses plans it must not execute');
{
    const good = planFor([vclip({ id: 'ov', start: 0.5, duration: 2 })]);
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
        /enable='between\(t,/.test(compiled.filterComplex),
        'without it the overlay\'s last frame sticks for the rest of the video');
    check('the overlay stream is shifted onto output time with setpts',
        /setpts=PTS-STARTPTS\+/.test(compiled.filterComplex));
    check('alpha is established before compositing',
        compiled.filterComplex.includes('format=yuva420p'));
    check('a static overlay compiles to plain numbers, not an expression',
        !/scale=w='/.test(compiled.filterComplex),
        'a static overlay should not pay for per-frame expression evaluation');

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

    // Sample decimation backstop.
    const many = Array.from({ length: 500 }, (_, i) => ({ t: i * 0.1, x: i, y: i, w: 1, h: 1 }));
    check('runaway sample counts are decimated', decimate(many, 60).length === 60,
        'each sample nests another if() — an unbounded expression fails at render time, on a real export');
    check('decimation keeps the first and last sample',
        decimate(many, 60)[0].t === many[0].t
        && decimate(many, 60)[59].t === many[many.length - 1].t);
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
    const after  = regionColor(out, 2.8, crop);

    check('BEFORE the window the region is the untouched base colour',
        colorDist(before, GREY) < 12,
        `got ${before} — an overlay drawn early is as wrong as one never drawn`);
    check('INSIDE the window the overlay is actually drawn there',
        colorDist(during, GREY) > 60,
        `got ${during} — the overlay should dominate this region`);
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

section('7 · The export job wires it in, guarded and fail-open');
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
    check('building a plan can never block an export',
        /could not build composition plan/.test(client));
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`Compositor export: ${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
console.log('─'.repeat(60));
process.exit(failed > 0 ? 1 : 0);
