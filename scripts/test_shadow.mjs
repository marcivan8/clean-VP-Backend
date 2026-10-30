// scripts/test_shadow.mjs
//
// R98 — generic drop shadow for stickers/icons/shapes/templates (the second
// of three missing editing features Marc picked to build, after the icon/
// emoji insert command). "add a shadow to the icon" / "remove the shadow"
// now resolve to add_shadow/remove_shadow, which toggle clip.shadow on the
// targeted overlay-track clip.
//
// This pins the feature across every layer that had to change:
//  1. The store's clip-field persistence contract (useTimelineStore.js's
//     updateClip AND TimelineStateManager.js's toLegacyTracks/
//     fromLegacyTracks) -- a NEW clip field silently drops on the floor at
//     either of those allowlists unless added to both, the exact bug class
//     this project has been bitten by before (R58/R66/R67/R88/R89/R92/R94).
//  2. The AI command pipeline: registry phrase resolution with no new
//     collisions, and MediaExecutionEngine actually placing a shadow on the
//     real timeline, as one undo.
//  3. The export compiler (CompositorCompiler.js): a shadowed overlay must
//     compile to TWO `overlay=` filter ops (a blackened/blurred shadow copy
//     drawn first, the sprite drawn on top), while every unshadowed overlay
//     keeps compiling to exactly ONE -- the non-breaking guarantee every
//     compositor test in this codebase pins.
import { register } from 'module';
import { createRequire } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;
const log = console.log; console.log = () => {}; console.warn = () => {}; console.info = () => {}; console.error = () => {};

let failures = 0;
async function check(name, fn) {
    try { await fn(); log(`✓ ${name}`); }
    catch (err) { failures += 1; log(`✗ ${name}\n    ${err.message}\n${err.stack}`); }
}

// ── 1 · The store's clip-field persistence contract ─────────────────────────
log('\n1 \xb7 shadow survives both the write mapping and the read projection');
await check('updateClip maps shadow through to the clip (write side)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'client/src/store/useTimelineStore.js'), 'utf8');
    assert.match(src, /if \(updates\.shadow !== undefined\) clipUpdates\.shadow = updates\.shadow;/);
});
await check('toLegacyTracks AND fromLegacyTracks both project shadow (read side, both directions)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'client/src/timeline/TimelineStateManager.js'), 'utf8');
    assert.match(src, /shadow: clip\.shadow \?\? null,/, 'toLegacyTracks must carry shadow or it silently drops out of state.tracks');
    assert.match(src, /shadow: legacyClip\.shadow \?\? null,/, 'fromLegacyTracks must carry shadow or a reload silently loses it');
});

// ── 2 · The AI command pipeline, end to end ─────────────────────────────────
log('\n2 \xb7 add_shadow / remove_shadow resolve, with no collisions, and actually place a shadow');
const R = await import('../client/src/agent/CommandRegistry.js');
const { default: S } = await import('../client/src/store/useTimelineStore.js');
const { MediaExecutionEngine } = await import('../client/src/agent/MediaExecutionEngine.js').catch(async () => ({ MediaExecutionEngine: (await import('../client/src/agent/MediaExecutionEngine.js')).default }));

await check('"add a shadow"/"remove the shadow" resolve to the right commands', () => {
    for (const t of ['add a shadow', 'add a drop shadow', 'give it a shadow', 'add a shadow to the icon']) {
        assert.equal(R.resolveCommand(t).match?.id, 'add_shadow', t);
    }
    for (const t of ['remove the shadow', 'clear the shadow']) {
        assert.equal(R.resolveCommand(t).match?.id, 'remove_shadow', t);
    }
});
await check('no collisions were introduced', () => {
    assert.deepEqual(R.findCollisions(), []);
});

function loadOverlayClip() {
    const tm = globalThis.timelineManager;
    tm.fromLegacyTracks([
        { id: 'track-default-video', type: 'video', name: 'V', clips: [] },
        { id: 'track-overlay-1', type: 'overlay', name: 'Overlay', clips: [
            { id: 'sticker-1', type: 'sticker', name: 'Fire', url: 'https://cdn.test/fire.png', start: 0, duration: 3, x: 78, y: 18, scale: 1 },
        ] },
    ]);
    S.setState({ tracks: tm.toLegacyTracks(), past: [], future: [], selectedClipIds: [], activeClipId: null, currentTime: 0, aspectRatio: '9:16' });
}
function engine() {
    return typeof MediaExecutionEngine === 'function' ? new MediaExecutionEngine() : MediaExecutionEngine;
}
function overlayClip() {
    return S.getState().tracks.find(t => t.type === 'overlay').clips[0];
}

await check('add_shadow puts a shadow descriptor on the targeted overlay clip, one undo', async () => {
    loadOverlayClip();
    const before = S.getState().past.length;
    const res = await engine().executeStoreAction({ action: 'add_shadow', args: {} }, {});
    assert.equal(res.success, true, res.message);
    const clip = overlayClip();
    assert.ok(clip.shadow && typeof clip.shadow === 'object', 'no shadow was set on the clip');
    assert.ok(Number.isFinite(clip.shadow.dx) && Number.isFinite(clip.shadow.dy) && Number.isFinite(clip.shadow.blur), JSON.stringify(clip.shadow));
    assert.equal(S.getState().past.length - before, 1, 'expected exactly one undo step');
});

await check('remove_shadow clears it back to null, one undo', async () => {
    loadOverlayClip();
    await engine().executeStoreAction({ action: 'add_shadow', args: {} }, {});
    const before = S.getState().past.length;
    const res = await engine().executeStoreAction({ action: 'remove_shadow', args: {} }, {});
    assert.equal(res.success, true, res.message);
    assert.equal(overlayClip().shadow, null);
    assert.equal(S.getState().past.length - before, 1, 'expected exactly one undo step');
});

await check('with nothing on the overlay track, add_shadow is an honest failure, not a silent no-op', async () => {
    const tm = globalThis.timelineManager;
    tm.fromLegacyTracks([{ id: 'track-default-video', type: 'video', name: 'V', clips: [] }]);
    S.setState({ tracks: tm.toLegacyTracks(), past: [], future: [], selectedClipIds: [], activeClipId: null, currentTime: 0 });
    const res = await engine().executeStoreAction({ action: 'add_shadow', args: {} }, {});
    assert.equal(res.success, false);
    assert.ok(/sticker|icon|shape|graphic/.test(res.message), res.message);
});

// ── 3 · Preview rendering (GraphicOverlay.jsx) ───────────────────────────────
log('\n3 \xb7 Preview: a CSS drop-shadow, following the clip\'s own silhouette');
await check('GraphicOverlay builds a CSS drop-shadow (not box-shadow) from clip.shadow, merged with any motion blur', () => {
    const src = fs.readFileSync(path.join(ROOT, 'client/src/components/Player/GraphicOverlay.jsx'), 'utf8');
    assert.match(src, /drop-shadow\(\$\{dx\}px \$\{dy\}px \$\{blur\}px rgba\(0,0,0,\$\{alpha\}\)\)/);
    assert.match(src, /function overlayFilterCss/);
});

await check('R121 -- preview scales clip.shadow by the SAME flat 1080 reference the export uses, at both call sites (preview/export parity)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'client/src/components/Player/GraphicOverlay.jsx'), 'utf8');
    // Must be a flat constant, not the aspect-aware getPlayerDimensions()
    // reference TextOverlay.jsx uses for fontSize/stroke -- a different,
    // incompatible convention from the one CompositorCompiler.js's
    // compileShadowSource uses for clip.shadow (REFERENCE_WIDTH = 1080).
    assert.match(src, /SHADOW_REFERENCE_WIDTH\s*=\s*1080/, 'the preview-side shadow reference width must be the same flat 1080 the export uses');
    assert.doesNotMatch(src, /scaleShadow\([^)]*getPlayerDimensions/, 'shadow scaling must not use the aspect-aware reference width');
    // Both overlayFilterCss call sites (the layout-frame branch and the
    // normal sticker branch) must route clip.shadow through the scale --
    // passing clip.shadow unscaled to either one reintroduces the bug.
    assert.doesNotMatch(src, /overlayFilterCss\(0,\s*clip\.shadow\)/, 'the layout-frame branch is passing clip.shadow unscaled to overlayFilterCss');
    assert.doesNotMatch(src, /overlayFilterCss\(motion\.blur,\s*clip\.shadow\)/, 'the sticker branch is passing clip.shadow unscaled to overlayFilterCss');
    assert.match(src, /overlayFilterCss\(0,\s*scaleShadow\(clip\.shadow,\s*shadowScale\)\)/, 'the layout-frame branch must scale clip.shadow before it reaches overlayFilterCss');
    assert.match(src, /overlayFilterCss\(motion\.blur,\s*scaleShadow\(clip\.shadow,\s*shadowScale\)\)/, 'the sticker branch must scale clip.shadow before it reaches overlayFilterCss');
});

await check('R121 -- scaleShadow() itself scales dx/dy/blur proportionally and never produces a negative blur', () => {
    const src = fs.readFileSync(path.join(ROOT, 'client/src/components/Player/GraphicOverlay.jsx'), 'utf8');
    const m = src.match(/function scaleShadow\(shadow, scale\) \{[\s\S]*?\n\}/);
    assert.ok(m, 'scaleShadow function not found');
    // eslint-disable-next-line no-new-func
    const scaleShadow = new Function('Number', 'Math', `${m[0]}; return scaleShadow;`)(Number, Math);
    assert.equal(scaleShadow(null, 0.5), null, 'scaleShadow must pass through a null shadow unchanged (no shadow set)');
    const half = scaleShadow({ dx: 10, dy: -20, blur: 8, opacity: 0.6 }, 0.5);
    assert.equal(half.dx, 5);
    assert.equal(half.dy, -10);
    assert.equal(half.blur, 4);
    assert.equal(half.opacity, 0.6, 'opacity must pass through untouched -- it is not a px value');
    assert.equal(scaleShadow({ dx: 0, dy: 0, blur: -5 }, 2).blur, 0, 'blur must never go negative even from a malformed shadow');
});

// ── 4 · Export (CompositorCompiler.js): the filter graph shape ──────────────
log('\n4 \xb7 Export: a shadowed overlay compiles to TWO overlay ops; an unshadowed one still compiles to ONE');

function loadCompositor() {
    const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const order = ['Easing', 'MotionSchema', 'MotionPresetExpansion', 'MotionResolver', 'MotionPresets', 'CaptionModel', 'ClipAdapter', 'Compositor'];
    let combined = '';
    for (const name of order) {
        let s = read(`client/src/motion/${name}.js`);
        s = s
            .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
            .replace(/^\s*export\s+default\s+\{[\s\S]*?\};\s*$/gm, '')
            .replace(/^\s*export\s+default\s+[^;]+;\s*$/gm, '')
            .replace(/\bexport\s+(const|function|class|let)\b/g, '$1');
        combined += s + '\n';
    }
    combined += 'return { buildCompositionPlan, COMPOSITION_PLAN_VERSION };';
    // eslint-disable-next-line no-new-func
    return new Function(combined)();
}
const C = loadCompositor();
const { compileCompositionPlan } = require(path.join(ROOT, 'server/compositor/CompositorCompiler.js'));

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

await check('an unshadowed overlay still compiles to exactly ONE overlay= op (the non-breaking guarantee)', () => {
    const plan = planFor([vclip({ id: 'ov', start: 0.5, duration: 2, extra: { x: 50, y: 50 } })]);
    const compiled = compileCompositionPlan(plan, [{ overlayId: plan.overlays[0].id, inputIndex: 1 }]);
    const ops = (compiled.filterComplex.match(/\]overlay=/g) || []).length;
    assert.equal(ops, 1, compiled.filterComplex);
    assert.ok(compiled.filterComplex.includes('[vout]'));
});

await check('a shadowed overlay compiles to TWO overlay= ops, ending at [vout]', () => {
    const plan = planFor([vclip({ id: 'ov', start: 0.5, duration: 2, extra: { x: 50, y: 50, shadow: { dx: 4, dy: 6, blur: 10, opacity: 0.55 } } } )]);
    assert.ok(plan.overlays[0].shadow, 'Compositor.js never attached the shadow descriptor to the plan');
    const compiled = compileCompositionPlan(plan, [{ overlayId: plan.overlays[0].id, inputIndex: 1 }]);
    const ops = (compiled.filterComplex.match(/\]overlay=/g) || []).length;
    assert.equal(ops, 2, compiled.filterComplex);
    assert.ok(compiled.filterComplex.includes('[vout]'));
    assert.ok(/lutrgb=r=0:g=0:b=0/.test(compiled.filterComplex), 'the shadow copy should be blackened while keeping its alpha');
    assert.ok(/colorchannelmixer=aa=0\.55/.test(compiled.filterComplex), 'the shadow should be dimmed to the requested strength');
});

await check('the shadow is drawn BEFORE (under) the sprite, offset by dx/dy', () => {
    const plan = planFor([vclip({ id: 'ov', start: 0.5, duration: 2, extra: { x: 50, y: 50, shadow: { dx: 4, dy: 6, blur: 10, opacity: 0.55 } } })]);
    const compiled = compileCompositionPlan(plan, [{ overlayId: plan.overlays[0].id, inputIndex: 1 }]);
    const shadowOpIdx = compiled.filterComplex.indexOf(']overlay=x=\'');
    const firstOverlayStmt = compiled.filterComplex.split(';').find(s => s.includes(']overlay=x='));
    assert.ok(firstOverlayStmt.includes('ov0s'), `expected the shadow copy (ov0s) to be drawn first, got: ${firstOverlayStmt}`);
});

// ── 5 · FFmpeg actually darkens a region behind the sprite (skipped without a binary) ──
function ffmpegBin() {
    for (const bin of ['ffmpeg', '/usr/bin/ffmpeg']) {
        const r = spawnSync(bin, ['-version'], { encoding: 'utf8' });
        if (r.status === 0) return bin;
    }
    try { return require('ffmpeg-static'); } catch { return null; }
}
const FFMPEG = ffmpegBin();

if (!FFMPEG) {
    log('\n5 \xb7 FFmpeg behavioural check -- skipped (no ffmpeg binary available)');
} else {
    log('\n5 \xb7 FFmpeg actually draws a darker shadow region behind the sprite');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-'));
    spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
        '-i', `color=c=0x808080:size=${W}x${H}:duration=3:rate=15`, '-frames:v', '45', '-y', path.join(dir, 'base.mp4')], { timeout: 60_000 });
    spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
        '-i', 'color=c=red:size=200x200:duration=3:rate=15', '-frames:v', '45', '-y', path.join(dir, 'ov.mp4')], { timeout: 60_000 });

    function runGraph(compiled, outName) {
        const out = path.join(dir, outName);
        const r = spawnSync(FFMPEG, [
            '-hide_banner', '-loglevel', 'error',
            '-i', path.join(dir, 'base.mp4'), '-i', path.join(dir, 'ov.mp4'),
            '-filter_complex', compiled.filterComplex, '-map', `[${compiled.outputLabel}]`,
            '-frames:v', '45', '-pix_fmt', 'yuv420p', '-y', out,
        ], { encoding: 'utf8', timeout: 120_000 });
        return { r, out };
    }
    function regionColor(video, t, crop) {
        const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', video, '-frames:v', '1',
            '-vf', `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},scale=1:1`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
            { timeout: 60_000, encoding: 'buffer' });
        if (r.status !== 0 || !r.stdout || r.stdout.length < 3) return null;
        return Buffer.from(r.stdout.slice(0, 3)).toString('hex');
    }
    const colorDist = (a, b) => {
        if (!a || !b) return Infinity;
        let d = 0;
        for (let i = 0; i < 3; i++) d = Math.max(d, Math.abs(parseInt(a.substr(i * 2, 2), 16) - parseInt(b.substr(i * 2, 2), 16)));
        return d;
    };

    await check('the shadow render runs and produces a file', () => {
        const shadowDx = 40, shadowDy = 40; // exaggerated in test units so the sampled region is unambiguous
        const plan = planFor([vclip({ id: 'ov', start: 0.5, duration: 2, extra: { x: 50, y: 50, shadow: { dx: shadowDx, dy: shadowDy, blur: 4, opacity: 0.9 } } })]);
        const compiled = compileCompositionPlan(plan, [{ overlayId: plan.overlays[0].id, inputIndex: 1 }]);
        const { r, out } = runGraph(compiled, 'shadowed.mp4');
        assert.equal(r.status, 0, (r.stderr || '').split('\n').slice(-4).join(' | '));
        assert.ok(fs.existsSync(out) && fs.statSync(out).size > 0);
        globalThis.__shadowOut = out;
        globalThis.__plan = plan;
    });

    await check('a region offset from the sprite by dx/dy, where ONLY the shadow should reach, is darker than base grey', () => {
        const out = globalThis.__shadowOut;
        const plan = globalThis.__plan;
        const g = plan.overlays[0].geometry[0];
        // The sprite occupies [x, x+w] x [y, y+h] of the frame (fractions).
        // Its shadow is offset by dx/dy PIXELS at REFERENCE_WIDTH=1080,
        // scaled by frame.width/1080 inside the compiler -- sample just
        // outside the sprite's own footprint, in the direction of the
        // offset, so only the shadow (not the sprite itself) can be there.
        const scale = W / 1080;
        const spriteRight = Math.round((g.x + g.w) * W);
        const spriteBottom = Math.round((g.y + g.h) * H);
        const sampleX = spriteRight + Math.round(20 * scale);
        const sampleY = spriteBottom + Math.round(20 * scale);
        const crop = { w: 16, h: 16, x: Math.max(0, sampleX - 8), y: Math.max(0, sampleY - 8) };
        const GREY = '808080';
        const during = regionColor(out, 1.5, crop);
        assert.ok(colorDist(during, GREY) > 20, `expected the shadow to darken this region, got ${during} vs base ${GREY}`);
    });

    fs.rmSync(dir, { recursive: true, force: true });
}

log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL SHADOW CHECKS PASSED');
process.exit(failures ? 1 : 0);
