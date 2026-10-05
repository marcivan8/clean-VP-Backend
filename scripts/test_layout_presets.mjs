// R88 (to-do A1) — layout presets: split screen, full-screen cutaway, PiP.
// Store action → composition plan → FFmpeg, checked on decoded pixels.
// node scripts/test_layout_presets.mjs
import { register, createRequire } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const require = createRequire(import.meta.url);
globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' });
const log = console.log; console.log = () => {}; console.warn = () => {}; console.info = () => {};
const ok = (n) => log(`✓ ${n}`);

const { default: useTimelineStore } = await import('../client/src/store/useTimelineStore.js');
const LP = await import('../client/src/motion/LayoutPresets.js');
const { buildCompositionPlan } = await import('../client/src/motion/Compositor.js');
const { VideoEditorTools } = await import('../client/src/agent/VideoEditorTools.js');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CC = require(path.join(ROOT, 'server/compositor/CompositorCompiler.js'));

// ── Pure maths ────────────────────────────────────────────────────────────
{
    const f = LP.frameForPreset('split', { frameAspect: 9 / 16 });
    assert.deepEqual([f.x, f.y, f.w, f.h], [0, 0.5, 1, 0.5]);
    ok('split puts the content in the bottom half');
    const pip = LP.frameForPreset('pip', { frameAspect: 9 / 16, sourceAspect: 16 / 9 });
    assert.ok(pip.x + pip.w <= 1 && pip.y >= 0.05 && Math.abs((pip.w * 1080) / (pip.h * 1920) - 16 / 9) < 0.01);
    ok('PiP keeps the media shape and stays inside the frame');

    const noFace = LP.splitSpeakerCrop({ sourceAspect: 16 / 9, frameAspect: 9 / 16 });
    const c = noFace.crop;
    assert.ok(Math.abs((c.cropW * 16 / 9) / c.cropH - 9 / 16) < 0.01, JSON.stringify(c));
    assert.equal(noFace.faceAware, false);
    ok('split speaker crop has the frame shape (no bars) and falls back without detection');

    const bbox = [{ t: 0, cx: 0.44, cy: 0.62, w: 0.4, h: 0.6 }, { t: 1, cx: 0.46, cy: 0.6, w: 0.4, h: 0.6 }];
    const face = LP.splitSpeakerCrop({ bboxTrack: bbox, sourceAspect: 9 / 16, frameAspect: 9 / 16, sourceStart: 0, duration: 2 });
    const headY = (0.61 - 0.3) + 0.2 * 0.6; // median cy - h/2 + 20% of h
    const headInFrame = (headY - face.crop.cropY) / face.crop.cropH;
    assert.equal(face.faceAware, true);
    assert.ok(Math.abs(headInFrame - 0.25) < 0.03, `head at ${headInFrame}`);
    assert.ok(Math.abs((0.45 - face.crop.cropX) / face.crop.cropW - 0.5) < 0.05);
    ok('face-aware split crop puts the head in the middle of the top half');
}

// Compositor.js inlines hasLayoutFrame (its test harnesses concatenate a
// fixed module list); the two copies must agree.
{
    const src = fs.readFileSync(path.join(ROOT, 'client/src/motion/Compositor.js'), 'utf8');
    const m = src.match(/const LAYOUT_FRAME_PRESETS = (\[[^\]]*\]);/);
    assert.ok(m, 'inline preset list found');
    assert.deepEqual(JSON.parse(m[1].replace(/'/g, '"')), LP.LAYOUT_PRESETS);
    assert.ok(src.includes('[f.x, f.y, f.w, f.h].every(Number.isFinite) && f.w > 0 && f.h > 0'));
    ok("Compositor's inline hasLayoutFrame matches LayoutPresets'");
}

// ── Store: applyLayout / clearLayout ─────────────────────────────────────
const tm = window.timelineManager;
function setup(withBbox) {
    tm.fromLegacyTracks([
        { id: 'track-default-video', type: 'video', name: 'V', clips: [
            { id: 'v1', clipId: 'ev1', assetId: 'a', type: 'video', name: 'TALK.MOV', start: 0, duration: 10, offset: 2, speed: 1,
              virtualCam: null, keyframes: { scale: [{ time: 0, value: 1 }, { time: 1, value: 1.2 }] },
              layerMask: withBbox ? { maskAssetUrl: 'm', bboxTrack: [{ t: 3, cx: 0.5, cy: 0.6, w: 0.5, h: 0.7 }, { t: 9, cx: 0.5, cy: 0.6, w: 0.5, h: 0.7 }], sourceWidth: 1080, sourceHeight: 1920, status: 'ready' } : null } ] },
        { id: 'ov', type: 'overlay', name: 'Overlay', clips: [
            { id: 'b1', clipId: 'eb1', assetId: 'b', type: 'video', name: 'SCREEN.MP4', start: 3, duration: 4, offset: 5, speed: 1, url: 'https://x/screen.mp4', x: 78, y: 18, scale: 1, metadata: { resolution: { w: 1920, h: 1080 } } } ] },
    ]);
    useTimelineStore.setState({ tracks: tm.toLegacyTracks(), duration: 10, aspectRatio: '9:16', currentTime: 4, activeClipId: null,
        assets: [{ id: 'a', type: 'video', resolution: { w: 1080, h: 1920 } }, { id: 'b', type: 'video', resolution: { w: 1920, h: 1080 } }] });
}
const st = () => useTimelineStore.getState();
const base = () => st().tracks.find(t => t.type === 'video').clips.slice().sort((a, b) => a.start - b.start);
const ovClip = () => st().tracks.find(t => t.type === 'overlay').clips[0];

setup(true);
let r = st().applyLayout('ov', 'b1', 'split');
assert.equal(r.success, true, JSON.stringify(r));
assert.equal(r.faceAware, true);
let pieces = base();
assert.deepEqual(pieces.map(p => [p.start, p.duration]), [[0, 3], [3, 4], [7, 3]]);
ok('split cuts the speaker clip into before / under / after the content');
assert.deepEqual(pieces.map(p => p.offset), [2, 5, 9]);
ok('...with the right source in-points (no jump in the speaker video)');
assert.ok(!pieces[0].virtualCam && pieces[1].virtualCam && !pieces[2].virtualCam);
assert.equal(pieces[1].layoutBase.overlayClipId, ovClip().id);
ok('only the piece under the content is reframed');
assert.ok(pieces[0].keyframes && !pieces[1].keyframes && !pieces[2].keyframes);
ok('zoom keyframes stay on the first piece only (they are timed from its start)');
assert.equal(ovClip().frame.preset, 'split');

const plan = buildCompositionPlan(st().tracks, { width: 1080, height: 1920, fps: 30 });
const ovPlan = plan.overlays.find(o => o.clipId === ovClip().id);
assert.ok(ovPlan && ovPlan.fit && ovPlan.fit.mode === 'cover');
assert.deepEqual([ovPlan.geometry[0].x, ovPlan.geometry[0].y, ovPlan.geometry[0].w, ovPlan.geometry[0].h], [0, 0.5, 1, 0.5]);
assert.equal(ovPlan.sourceOffset, 5);
ok('the export plan carries the box, the cover fit and the in-point');

r = st().applyLayout('ov', ovClip().id, 'pip');
pieces = base();
assert.ok(pieces.every(p => !p.virtualCam && !p.layoutBase));
assert.equal(ovClip().frame.preset, 'pip');
ok('switching to PiP restores the speaker framing');

st().applyLayout('ov', ovClip().id, 'split');
r = st().clearLayout('ov', ovClip().id);
assert.equal(r.success, true);
assert.ok(!ovClip().frame && base().every(p => !p.virtualCam));
ok('removing the layout frees the clip and restores the speaker');

// Persistence
st().applyLayout('ov', ovClip().id, 'fullscreen');
const saved = JSON.parse(JSON.stringify(tm.toLegacyTracks()));
tm.fromLegacyTracks(saved);
useTimelineStore.setState({ tracks: tm.toLegacyTracks() });
assert.equal(ovClip().frame?.preset, 'fullscreen');
ok('a layout survives a project save/reload');

// Undo is one step
setup(false);
const before = JSON.stringify(base().map(c => [c.start, c.duration]));
st().applyLayout('ov', 'b1', 'split');
st().undo?.();
assert.equal(JSON.stringify(base().map(c => [c.start, c.duration])), before);
assert.ok(!ovClip().frame);
ok('one undo reverts the whole split (cut + reframe + box)');

// Assistant command
setup(false);
const tools = new VideoEditorTools();
r = await tools.execute({ name: 'layout_split_screen', args: {} });
assert.equal(r.success, true, JSON.stringify(r));
assert.match(r.message, /centre/);
ok('"split screen" from the assistant lays out the clip under the playhead, and says framing was centred');
useTimelineStore.setState({ currentTime: 9.5, activeClipId: null });
r = await tools.execute({ name: 'layout_picture_in_picture', args: {} });
assert.equal(r.success, false);
ok('with no b-roll under the playhead it refuses instead of guessing (R30)');

// ── Export: cover crop on real pixels ────────────────────────────────────
const ffmpeg = ['ffmpeg', '/usr/bin/ffmpeg'].find(b => spawnSync(b, ['-version']).status === 0);
if (!ffmpeg) {
    log('– render checks skipped (no ffmpeg)');
} else {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-'));
    // A 16:9 source: left half red, right half blue.
    const src = path.join(tmp, 'src.png');
    spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x360', '-f', 'lavfi', '-i', 'color=c=blue:s=320x360', '-filter_complex', 'hstack', '-frames:v', '1', src]);
    const baseV = path.join(tmp, 'b.mp4');
    spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=360x640:r=30:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', baseV]);
    const run = (fit) => {
        const p = { version: 1, renderWidth: 360, renderHeight: 640, overlays: [{ id: 'o', clipId: 'o', zIndex: 1, outputStart: 0, outputEnd: 1, source: { url: 'x', type: 'image' }, fit,
            geometry: [{ t: 0, x: 0, y: 0.5, w: 1, h: 0.5, rotation: 0, opacity: 1, blur: 0 }] }] };
        const c = CC.compileCompositionPlan(p, [{ overlayId: 'o', inputIndex: 1 }]);
        const out = path.join(tmp, `o${Math.random().toString(36).slice(2)}.mp4`);
        const rr = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', baseV, '-loop', '1', '-t', '1', '-i', src, '-filter_complex', c.filterComplex, '-map', `[${c.outputLabel}]`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out], { encoding: 'utf8' });
        assert.equal(rr.status, 0, rr.stderr);
        const f = spawnSync(ffmpeg, ['-loglevel', 'error', '-ss', '0.5', '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 26 }).stdout;
        let red = 0, blue = 0, blackBottom = 0;
        for (let y = 330; y < 630; y++) for (let x = 5; x < 355; x++) {
            const i = (y * 360 + x) * 3;
            if (f[i] > 150 && f[i + 2] < 90) red++;
            else if (f[i + 2] > 150 && f[i] < 90) blue++;
            else if (f[i] < 40 && f[i + 1] < 40 && f[i + 2] < 40) blackBottom++;
        }
        return { red, blue, blackBottom };
    };
    const centred = run({ mode: 'cover', focusX: 0.5, focusY: 0.5 });
    assert.ok(centred.blackBottom < 500, JSON.stringify(centred));
    assert.ok(Math.abs(centred.red - centred.blue) / (centred.red + centred.blue) < 0.1, JSON.stringify(centred));
    ok('cover fills the bottom half with no bars, centred (equal red/blue)');
    const left = run({ mode: 'cover', focusX: 0, focusY: 0.5 });
    assert.ok(left.red > left.blue * 1.5, JSON.stringify(left));
    ok('focusX 0 shows the left of the picture (same as CSS object-position 0%)');
    fs.rmSync(tmp, { recursive: true, force: true });
}

log('\nALL LAYOUT PRESET CHECKS PASSED');
