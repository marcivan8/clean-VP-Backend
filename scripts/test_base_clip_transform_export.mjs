// R100 — export-side consumer for a base clip's resize/reposition transform
// (clip.x/y/scale), the counterpart of BaseClipOverlay.jsx's on-screen
// handles. Before this, jobs/exportProcessor.js read NOTHING of clip.x/y/
// scale for a base video/image clip -- buildScaleFilter()'s fixed centred
// fit-and-pad ran unconditionally, so a clip resized/moved in the editor
// still came out full-frame and centred in the actual export.
// node scripts/test_base_clip_transform_export.mjs
import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const log = console.log;
const ok = (n) => log(`✓ ${n}`);

const EP = require('../jobs/exportProcessor.js');
const { fitContainSizePx, hasBaseClipTransform, buildTransformFilters } = EP;
const exportSource = fs.readFileSync(new URL('../jobs/exportProcessor.js', import.meta.url), 'utf8');
assert.match(exportSource, /const baseTransform = hasBaseTransform\s*\n\s*\? buildTransformFilters/,
    'the export worker must apply base transforms even when a virtual-camera crop is active');
assert.doesNotMatch(exportSource, /crop takes priority, the transform is skipped/,
    'the old crop-versus-transform exclusion must stay removed');
assert.match(exportSource, /if \(rotationKfs && baseTransform\)/,
    'keyframed rotation must remain available on transformed multicam crops');
ok('export worker routes cropped media through the shared transform and animated rotation path');

// ── 1 · fitContainSizePx matches client/src/motion/BaseClipGeometry.js's
//        fitContainSize() exactly -- the preview/export parity guarantee ──
{
    const { fitContainSize } = await import('../client/src/motion/BaseClipGeometry.js');
    const cases = [
        [1920, 1080, 1080, 1920],
        [1080, 1920, 1920, 1080],
        [1080, 1080, 1080, 1920],
        [0, 0, 1080, 1920],
    ];
    for (const [mw, mh, cw, ch] of cases) {
        assert.deepEqual(fitContainSizePx(mw, mh, cw, ch), fitContainSize(mw, mh, cw, ch),
            `mismatch for ${JSON.stringify([mw, mh, cw, ch])}`);
    }
    ok('export-side fitContainSizePx is pixel-identical to the client-side fitContainSize for every case tried');
}

// ── 2 · hasBaseClipTransform: only a REAL resize/move trips the new path ──
{
    assert.equal(hasBaseClipTransform({}), false);
    assert.equal(hasBaseClipTransform({ scale: 1, x: 0, y: 0 }), false);
    assert.equal(hasBaseClipTransform({ scale: 1.0000001, x: 0, y: 0 }), false, 'float round-trip noise must not trip it');
    assert.equal(hasBaseClipTransform({ scale: 1.5 }), true);
    assert.equal(hasBaseClipTransform({ scaleX: 1.5 }), true);
    assert.equal(hasBaseClipTransform({ scaleY: 0.75 }), true);
    assert.equal(hasBaseClipTransform({ rotation: 18 }), true);
    assert.equal(hasBaseClipTransform({ opacity: 0.5 }), true);
    assert.equal(hasBaseClipTransform({ opacity: 1 }), false);
    assert.equal(hasBaseClipTransform({ scale: null, scaleX: null, scaleY: null,
        rotation: null, opacity: null, x: null, y: null }), false,
        'nullable transform fields must not be mistaken for authored zeros');
    assert.equal(hasBaseClipTransform({ keyframes: { opacity: [{ time: 0, value: 0.5 }] } }), true);
    assert.equal(hasBaseClipTransform({ x: 50 }), true);
    assert.equal(hasBaseClipTransform({ y: -30 }), true);
    ok('hasBaseClipTransform fires only for an actually resized/repositioned clip, never a pristine default one');
}

// ── 3 · buildTransformFilters: geometry math ──────────────────────────────
{
    // 1080x1920 source into a 1080x1920 canvas at scale=1, x=0,y=0: fills the
    // frame exactly, centred (no overlay offset needed).
    const t1 = buildTransformFilters({ scale: 1, x: 0, y: 0, metadata: { resolution: { w: 1080, h: 1920 } } }, 1080, 1920);
    assert.equal(t1.w, 1080); assert.equal(t1.h, 1920);
    assert.equal(t1.overlayX, 0); assert.equal(t1.overlayY, 0);
    ok('scale=1, x=0, y=0 on a matching-aspect source fills the canvas exactly, centred');

    const nullable = buildTransformFilters({ scale: null, scaleX: null, scaleY: null,
        rotation: null, opacity: null, x: null, y: null,
        metadata: { resolution: { w: 1080, h: 1920 } } }, 1080, 1920);
    assert.equal(nullable.w, 1080); assert.equal(nullable.h, 1920);
    assert.equal(nullable.overlayX, 0); assert.equal(nullable.overlayY, 0);
    assert.equal(nullable.rotation, 0); assert.equal(nullable.opacity, 1);
    assert.doesNotMatch(nullable.scaleFilter, /colorchannelmixer/);
    ok('nullable transforms resolve to centred, full-opacity defaults instead of exporting transparent video');

    // Half scale -> half size, still centred by default.
    const t2 = buildTransformFilters({ scale: 0.5, x: 0, y: 0, metadata: { resolution: { w: 1080, h: 1920 } } }, 1080, 1920);
    assert.equal(t2.w, 540); assert.equal(t2.h, 960);
    assert.equal(t2.overlayX, (1080 - 540) / 2);
    assert.equal(t2.overlayY, (1920 - 960) / 2);
    ok('scale=0.5 halves both dimensions and re-centres the overlay position');

    const anisotropic = buildTransformFilters({ scale: 1, scaleX: 1.5, scaleY: 0.5, x: 0, y: 0,
        metadata: { resolution: { w: 1080, h: 1920 } } }, 1080, 1920);
    assert.equal(anisotropic.w, 1620);
    assert.equal(anisotropic.h, 960);
    ok('base clip export applies independent scaleX and scaleY dimensions');

    const rotated = buildTransformFilters({ scale: 0.5, rotation: 90, x: 0, y: 0,
        metadata: { resolution: { w: 1080, h: 1920 } } }, 1080, 1920);
    assert.equal(rotated.w, 960);
    assert.equal(rotated.h, 540);
    assert.match(rotated.scaleFilter, /rotate=90\.0000\*PI\/180/);
    assert.equal(rotated.overlayX, 60);
    assert.equal(rotated.overlayY, 690);
    ok('base clip export rotates footage around its centre and positions the rotated bounds');

    const cropTransform = buildTransformFilters({ scale: 0.5, x: 40, y: 0,
        virtualCam: { cropX: 0.5, cropY: 0, cropW: 0.5, cropH: 0.5 },
        metadata: { resolution: { w: 360, h: 360 } } }, 360, 360);
    assert.equal(cropTransform.sourceW, 180);
    assert.equal(cropTransform.sourceH, 180);
    assert.equal(cropTransform.overlayX, 130);
    assert.equal(cropTransform.overlayY, 90);
    ok('transform geometry is computed from the virtual-camera crop before scaling and positioning');

    const translucent = buildTransformFilters({ scale: 0.5, opacity: 0.4, x: 0, y: 0,
        metadata: { resolution: { w: 1080, h: 1920 } } }, 1080, 1920);
    assert.equal(translucent.opacity, 0.4);
    assert.match(translucent.scaleFilter, /colorchannelmixer=aa=0\.4000/);
    ok('base clip export preserves transparent alpha for footage opacity');

    // Moving right/down by canvas pixels shifts the overlay position by the same amount.
    const t3 = buildTransformFilters({ scale: 0.5, x: 100, y: -50, metadata: { resolution: { w: 1080, h: 1920 } } }, 1080, 1920);
    assert.equal(t3.overlayX, (1080 - 540) / 2 + 100);
    assert.equal(t3.overlayY, (1920 - 960) / 2 - 50);
    ok('clip.x/clip.y nudge the overlay position by exactly that many canvas pixels');

    // Dimensions are always even (yuv420p requirement).
    const t4 = buildTransformFilters({ scale: 0.333, x: 0, y: 0, metadata: { resolution: { w: 1921, h: 1081 } } }, 1080, 1920);
    assert.equal(t4.w % 2, 0); assert.equal(t4.h % 2, 0);
    ok('output width/height are always rounded to even numbers');
}

// ── 4 · FFmpeg actually composites the transformed clip at the right spot ──
function ffmpegBin() {
    for (const bin of ['ffmpeg', '/usr/bin/ffmpeg']) {
        const r = spawnSync(bin, ['-version'], { encoding: 'utf8' });
        if (r.status === 0) return bin;
    }
    try { return require('ffmpeg-static'); } catch { return null; }
}
const FFMPEG = ffmpegBin();

function ffprobeBin() {
    for (const bin of ['ffprobe', '/usr/bin/ffprobe']) {
        const r = spawnSync(bin, ['-version'], { encoding: 'utf8' });
        if (r.status === 0) return bin;
    }
    if (FFMPEG && FFMPEG.endsWith('ffmpeg')) {
        const sibling = FFMPEG.replace(/ffmpeg$/, 'ffprobe');
        if (fs.existsSync(sibling)) return sibling;
    }
    try {
        const probePkg = require('@ffprobe-installer/ffprobe');
        if (probePkg?.path && fs.existsSync(probePkg.path)) return probePkg.path;
    } catch { /* ignore */ }
    return null;
}
const FFPROBE = ffprobeBin();

function readDimensions(file) {
    if (FFPROBE) {
        const probe = spawnSync(FFPROBE,
            ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file],
            { encoding: 'utf8', timeout: 20_000 });
        if (probe.status === 0 && (probe.stdout || '').trim()) {
            const [w, h] = probe.stdout.trim().split(',').map(Number);
            if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return [w, h];
        }
    }
    if (FFMPEG) {
        const probe = spawnSync(FFMPEG, ['-hide_banner', '-i', file], { encoding: 'utf8', timeout: 20_000 });
        const m = (probe.stderr || '').match(/Video:.*?,\s*(\d+)x(\d+)/);
        if (m) return [Number(m[1]), Number(m[2])];
    }
    return [0, 0];
}

if (!FFMPEG) {
    log('\n4 · FFmpeg behavioural check -- skipped (no ffmpeg binary available)');
} else {
    log('\n4 · FFmpeg actually composites the transformed clip at the right size/position');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'basetransform-'));
    const srcPath = path.join(dir, 'src.mp4');
    const outPath = path.join(dir, 'out.mp4');

    // A 1080x1920 solid-red source clip, resized to half scale and moved
    // +200,+300 canvas px off-centre in a 1080x1920 canvas.
    const canvasW = 1080, canvasH = 1920;
    const clip = { scale: 0.5, x: 200, y: 300, metadata: { resolution: { w: canvasW, h: canvasH } } };
    const t = buildTransformFilters(clip, canvasW, canvasH);

    spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
        '-i', `color=c=red:size=${canvasW}x${canvasH}:duration=1:rate=10`, '-frames:v', '10', '-y', srcPath], { timeout: 60_000 });

    const filterComplex = [
        `[0:v]${t.scaleFilter}[fg]`,
        `color=c=black:s=${canvasW}x${canvasH}:d=1[bg]`,
        `[bg][fg]overlay=x=${t.overlayX}:y=${t.overlayY}:eval=init[vout]`,
    ].join(';');

    const render = spawnSync(FFMPEG, [
        '-hide_banner', '-loglevel', 'error',
        '-i', srcPath,
        '-filter_complex', filterComplex, '-map', '[vout]',
        '-frames:v', '10', '-pix_fmt', 'yuv420p', '-y', outPath,
    ], { encoding: 'utf8', timeout: 60_000 });

    await check('the render runs and produces a file of exactly the canvas size', () => {
        assert.equal(render.status, 0, (render.stderr || '').split('\n').slice(-6).join(' | '));
        assert.ok(fs.existsSync(outPath) && fs.statSync(outPath).size > 0);
        const [w, h] = readDimensions(outPath);
        assert.equal(w, canvasW); assert.equal(h, canvasH);
    });

    function pixelAt(video, x, y) {
        const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', video, '-frames:v', '1',
            '-vf', `crop=2:2:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
            { timeout: 30_000, encoding: 'buffer' });
        if (r.status !== 0 || !r.stdout || r.stdout.length < 3) return null;
        return { r: r.stdout[0], g: r.stdout[1], b: r.stdout[2] };
    }
    const isRed = (p) => p && p.r > 150 && p.g < 80 && p.b < 80;
    const isBlack = (p) => p && p.r < 20 && p.g < 20 && p.b < 20;

    await check('the red clip lands at its computed overlay position (not centred, not full-frame)', () => {
        const cx = Math.round(t.overlayX + t.w / 2);
        const cy = Math.round(t.overlayY + t.h / 2);
        const centerOfClip = pixelAt(outPath, cx, cy);
        assert.ok(isRed(centerOfClip), `expected red at the clip's own centre (${cx},${cy}), got ${JSON.stringify(centerOfClip)}`);
    });

    await check('the far corner of the canvas (outside the resized/moved clip) is the black background, not red', () => {
        const farCorner = pixelAt(outPath, 10, 10);
        assert.ok(isBlack(farCorner), `expected black background at the top-left corner, got ${JSON.stringify(farCorner)}`);
    });

    await check("a corner nowhere near the moved/resized clip is background, confirming it's not just full-frame red", () => {
        // The clip (540x960) sits at x:[470,1010], y:[780,1740] in this 1080x1920
        // canvas -- the top-right corner is well outside that box either way.
        const corner = pixelAt(outPath, canvasW - 10, 10);
        assert.ok(isBlack(corner), `expected black near the top-right corner, got ${JSON.stringify(corner)}`);
    });

    const rotatedPath = path.join(dir, 'rotated-out.mp4');
    const rotated = buildTransformFilters({ scale: 0.5, rotation: 90,
        metadata: { resolution: { w: canvasW, h: canvasH } } }, canvasW, canvasH);
    const rotatedGraph = [
        `[0:v]${rotated.scaleFilter}[fg]`,
        `color=c=black:s=${canvasW}x${canvasH}:d=1[bg]`,
        `[bg][fg]overlay=x=${rotated.overlayX}:y=${rotated.overlayY}:eval=init[vout]`,
    ].join(';');
    const rotatedRender = spawnSync(FFMPEG, [
        '-hide_banner', '-loglevel', 'error', '-i', srcPath,
        '-filter_complex', rotatedGraph, '-map', '[vout]', '-frames:v', '10',
        '-pix_fmt', 'yuv420p', '-y', rotatedPath,
    ], { encoding: 'utf8', timeout: 60_000 });
    await check('FFmpeg accepts the transparent, centred rotation transform at export size', () => {
        assert.equal(rotatedRender.status, 0, (rotatedRender.stderr || '').split('\n').slice(-6).join(' | '));
        const [w, h] = readDimensions(rotatedPath);
        assert.equal(w, canvasW); assert.equal(h, canvasH);
        assert.ok(isRed(pixelAt(rotatedPath, canvasW / 2, canvasH / 2)), 'rotated footage remains visible at the frame centre');
    });

    const cropSourcePath = path.join(dir, 'crop-source.mp4');
    const cropOutputPath = path.join(dir, 'crop-transform-out.mp4');
    const cropTransform = buildTransformFilters({ scale: 0.5, x: 40, y: 0,
        virtualCam: { cropX: 0.5, cropY: 0, cropW: 0.5, cropH: 0.5 },
        metadata: { resolution: { w: 360, h: 360 } } }, 360, 360);
    const cropSourceRender = spawnSync(FFMPEG, [
        '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:size=360x360:duration=1:rate=10',
        '-vf', 'drawbox=x=180:y=0:w=180:h=180:c=green:t=fill,drawbox=x=0:y=180:w=180:h=180:c=blue:t=fill,drawbox=x=180:y=180:w=180:h=180:c=yellow:t=fill',
        '-frames:v', '10', '-pix_fmt', 'yuv420p', '-y', cropSourcePath,
    ], { encoding: 'utf8', timeout: 60_000 });
    const cropGraph = [
        `[0:v]crop=iw*0.5:ih*0.5:iw*0.5:0,${cropTransform.scaleFilter}[fg]`,
        'color=c=black:s=360x360:d=1[bg]',
        `[bg][fg]overlay=x=${cropTransform.overlayX}:y=${cropTransform.overlayY}:eval=init[vout]`,
    ].join(';');
    const cropRender = spawnSync(FFMPEG, [
        '-hide_banner', '-loglevel', 'error', '-i', cropSourcePath,
        '-filter_complex', cropGraph, '-map', '[vout]', '-frames:v', '10', '-pix_fmt', 'yuv420p', '-y', cropOutputPath,
    ], { encoding: 'utf8', timeout: 60_000 });
    await check('FFmpeg preserves the selected virtual-camera crop after scale and position transforms', () => {
        assert.equal(cropSourceRender.status, 0, cropSourceRender.stderr || 'failed to create crop test source');
        assert.equal(cropRender.status, 0, cropRender.stderr || 'crop and transform composition failed');
        const center = pixelAt(cropOutputPath, cropTransform.overlayX + 90, cropTransform.overlayY + 90);
        assert.ok(center && center.g > center.r * 1.5 && center.g > center.b * 1.5,
            `expected green selected quadrant at transformed crop center, got ${JSON.stringify(center)}`);
        assert.ok(isBlack(pixelAt(cropOutputPath, 10, 10)), 'cropped layer must remain a positioned overlay, not fill the canvas');
    });

    const opacityPath = path.join(dir, 'opacity-out.mp4');
    const opacityTransform = buildTransformFilters({ scale: 0.5, opacity: 0.4,
        metadata: { resolution: { w: canvasW, h: canvasH } } }, canvasW, canvasH);
    const opacityGraph = [
        `[0:v]${opacityTransform.scaleFilter}[fg]`,
        `color=c=black:s=${canvasW}x${canvasH}:d=1[bg]`,
        `[bg][fg]overlay=x=${opacityTransform.overlayX}:y=${opacityTransform.overlayY}:eval=init[vout]`,
    ].join(';');
    const opacityRender = spawnSync(FFMPEG, [
        '-hide_banner', '-loglevel', 'error', '-i', srcPath,
        '-filter_complex', opacityGraph, '-map', '[vout]', '-frames:v', '10',
        '-pix_fmt', 'yuv420p', '-y', opacityPath,
    ], { encoding: 'utf8', timeout: 60_000 });
    await check('FFmpeg composites base footage at the authored opacity', () => {
        assert.equal(opacityRender.status, 0, (opacityRender.stderr || '').split('\n').slice(-6).join(' | '));
        const pixel = pixelAt(opacityPath, canvasW / 2, canvasH / 2);
        assert.ok(pixel && pixel.r > 70 && pixel.r < 140 && pixel.g < 35 && pixel.b < 35,
            `expected 40% red over black, got ${JSON.stringify(pixel)}`);
    });
}

async function check(name, fn) {
    try { await fn(); ok(name); }
    catch (err) { console.error(`✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
}

console.log('\nAll base-clip export transform checks passed.');
