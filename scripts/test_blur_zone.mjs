// scripts/test_blur_zone.mjs
//
// R99 — freeform zone blur for stickers/icons/shapes/templates AND the
// footage itself (video/image clips), the third and last of the three
// missing editing features Marc picked (icon/emoji insert R97, generic
// shadows R98, this one). "blur the top left corner" / "remove the blur
// zone" now resolve to add_blur_zone/remove_blur_zone, which set/clear a
// clip.blurZone = { x, y, w, h, blur } descriptor (frame fractions, a
// STATIC rectangle -- Marc did not pick "object tracking beyond people").
//
// This pins the feature across every layer that had to change:
//  1. The store's clip-field persistence contract (useTimelineStore.js's
//     updateClip AND TimelineStateManager.js's toLegacyTracks/
//     fromLegacyTracks) -- a NEW clip field silently drops on the floor at
//     either of those allowlists unless added to both, the exact bug class
//     this project has been bitten by before (R58/R66/R67/R88/R89/R92/R94/R98).
//  2. zoneQuery.js's location-phrase parsing (a named corner/edge,
//     optionally a size word -> a frame-fraction box), with a sensible
//     default (top-right corner) for a prompt naming no location at all.
//  3. The AI command pipeline: registry phrase resolution with no new
//     collisions, and MediaExecutionEngine actually placing a blurZone on
//     the real timeline, as one undo.
//  4. The export compiler (ZoneBlur.js's zoneBlurFilterGraph, loaded by
//     jobs/exportProcessor.js the same way it already loads
//     MatteSettings.js): split + crop + blur + overlay-back, never
//     touching anything outside the zone's own box.
import { register, createRequire } from 'module';
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

// ── 1 · The store's clip-field persistence contract ────────────────────────
log('\n1 · blurZone survives both the write mapping and the read projection');
await check('updateClip maps blurZone through to the clip (write side)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'client/src/store/useTimelineStore.js'), 'utf8');
    assert.match(src, /if \(updates\.blurZone !== undefined\) clipUpdates\.blurZone = updates\.blurZone;/);
});
await check('toLegacyTracks AND fromLegacyTracks both project blurZone (read side, both directions)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'client/src/timeline/TimelineStateManager.js'), 'utf8');
    assert.match(src, /blurZone: clip\.blurZone \?\? null,/, 'toLegacyTracks must carry blurZone or it silently drops out of state.tracks');
    assert.match(src, /blurZone: legacyClip\.blurZone \?\? null,/, 'fromLegacyTracks must carry blurZone or a reload silently loses it');
});

// ── 2 · zoneQuery.js's location-phrase parsing ──────────────────────────────
log('\n2 · zoneFromText resolves the wording the registry phrases promise');
const ZQ = await import('../client/src/agent/zoneQuery.js');
await check('"blur the top left corner" resolves to the top-left box', () => {
    assert.deepEqual(ZQ.zoneFromText('blur the top left corner'), { x: 0, y: 0, w: 0.35, h: 0.35 });
});
await check('"blur the bottom right corner" resolves to the bottom-right box', () => {
    assert.deepEqual(ZQ.zoneFromText('blur the bottom right corner'), { x: 0.65, y: 0.65, w: 0.35, h: 0.35 });
});
await check('a prompt naming no location ("blur the logo") gets the default top-right corner', () => {
    assert.deepEqual(ZQ.zoneFromText('blur the logo'), { x: 0.65, y: 0, w: 0.35, h: 0.35 });
});
await check('a size word grows the box anchored to the edge it already touches', () => {
    const z = ZQ.zoneFromText('blur the large top right corner');
    assert.ok(z.w > 0.35 && z.h > 0.35, JSON.stringify(z));
    assert.ok(Math.abs((z.x + z.w) - 1) < 1e-9, `expected the box to stay anchored to the right edge, got ${JSON.stringify(z)}`);
});
await check('every box stays fully inside the frame (x+w<=1, y+h<=1)', () => {
    for (const text of ['blur the top left corner', 'blur the bottom', 'blur the left side', 'blur a huge zone in the center']) {
        const z = ZQ.zoneFromText(text);
        assert.ok(z.x + z.w <= 1 + 1e-9 && z.y + z.h <= 1 + 1e-9, `${text} -> ${JSON.stringify(z)}`);
    }
});

// ── 3 · The AI command pipeline, end to end ─────────────────────────────────
log('\n3 · add_blur_zone / remove_blur_zone resolve, with no collisions, and actually place a zone');
const R = await import('../client/src/agent/CommandRegistry.js');
const { default: S } = await import('../client/src/store/useTimelineStore.js');
const { MediaExecutionEngine } = await import('../client/src/agent/MediaExecutionEngine.js').catch(async () => ({ MediaExecutionEngine: (await import('../client/src/agent/MediaExecutionEngine.js')).default }));

await check('"blur this zone"/"remove the blur zone" resolve to the right commands, and never to remove_background', () => {
    for (const t of ['blur this zone', 'add a blur zone', 'blur the top right corner', 'blur the logo', 'blur the watermark']) {
        assert.equal(R.resolveCommand(t).match?.id, 'add_blur_zone', t);
    }
    for (const t of ['remove the blur zone', 'clear the blur zone', 'remove the pixelation']) {
        assert.equal(R.resolveCommand(t).match?.id, 'remove_blur_zone', t);
    }
    // These must stay routed to the R92 background-removal command, not the new one.
    for (const t of ['blur the background', 'background blur']) {
        assert.equal(R.resolveCommand(t).match?.id, 'remove_background', t);
    }
});
await check('no collisions were introduced', () => {
    assert.deepEqual(R.findCollisions(), []);
});

function loadVideoClip() {
    const tm = globalThis.timelineManager;
    tm.fromLegacyTracks([
        { id: 'track-default-video', type: 'video', name: 'V', clips: [
            { id: 'clip-1', type: 'video', name: 'Interview', url: 'https://cdn.test/interview.mp4', start: 0, duration: 5, offset: 0, speed: 1 },
        ] },
    ]);
    S.setState({ tracks: tm.toLegacyTracks(), past: [], future: [], selectedClipIds: [], activeClipId: null, currentTime: 0, aspectRatio: '9:16' });
}
function engine() {
    return typeof MediaExecutionEngine === 'function' ? new MediaExecutionEngine() : MediaExecutionEngine;
}
function videoClip() {
    return S.getState().tracks.find(t => t.type === 'video').clips[0];
}

await check('add_blur_zone puts a normalized blurZone on the targeted clip, one undo', async () => {
    loadVideoClip();
    const before = S.getState().past.length;
    const res = await engine().executeStoreAction({ action: 'add_blur_zone', args: { zone: ZQ.zoneFromText('blur the top left corner') } }, {});
    assert.equal(res.success, true, res.message);
    const clip = videoClip();
    assert.ok(clip.blurZone && typeof clip.blurZone === 'object', 'no blurZone was set on the clip');
    assert.ok(['x', 'y', 'w', 'h', 'blur'].every(k => Number.isFinite(clip.blurZone[k])), JSON.stringify(clip.blurZone));
    assert.equal(clip.blurZone.x, 0);
    assert.equal(S.getState().past.length - before, 1, 'expected exactly one undo step');
});

await check('a bare add_blur_zone (no zone args) still places the default corner rather than failing', async () => {
    loadVideoClip();
    const res = await engine().executeStoreAction({ action: 'add_blur_zone', args: {} }, {});
    assert.equal(res.success, true, res.message);
    assert.ok(videoClip().blurZone, 'expected a default blurZone when no zone was supplied');
});

await check('remove_blur_zone clears it back to null, one undo', async () => {
    loadVideoClip();
    await engine().executeStoreAction({ action: 'add_blur_zone', args: { zone: ZQ.zoneFromText('blur the logo') } }, {});
    const before = S.getState().past.length;
    const res = await engine().executeStoreAction({ action: 'remove_blur_zone', args: {} }, {});
    assert.equal(res.success, true, res.message);
    assert.equal(videoClip().blurZone, null);
    assert.equal(S.getState().past.length - before, 1, 'expected exactly one undo step');
});

await check('with no clips on the timeline, add_blur_zone is an honest failure, not a silent no-op', async () => {
    const tm = globalThis.timelineManager;
    tm.fromLegacyTracks([{ id: 'track-default-video', type: 'video', name: 'V', clips: [] }]);
    S.setState({ tracks: tm.toLegacyTracks(), past: [], future: [], selectedClipIds: [], activeClipId: null, currentTime: 0 });
    const res = await engine().executeStoreAction({ action: 'add_blur_zone', args: {} }, {});
    assert.equal(res.success, false);
    assert.ok(/clip/.test(res.message), res.message);
});

// ── 4 · Preview rendering (BlurZoneOverlay.jsx) ────────────────────────────
log('\n4 · Preview: a CSS backdrop-filter, not a box drawn over the frame');
await check('BlurZoneOverlay builds a backdrop-filter blur (blurs what\'s BEHIND it) from clip.blurZone', () => {
    const src = fs.readFileSync(path.join(ROOT, 'client/src/components/Player/BlurZoneOverlay.jsx'), 'utf8');
    assert.match(src, /backdropFilter: `blur\(\$\{blurPx\}px\)`/);
    assert.match(src, /WebkitBackdropFilter/);
    assert.match(src, /hasBlurZone\(c\)/);
});
await check('BlurZoneOverlay is mounted in the editor, below the front text/graphics overlays', () => {
    const src = fs.readFileSync(path.join(ROOT, 'client/src/layouts/IDELayout.jsx'), 'utf8');
    const blurIdx = src.indexOf('<BlurZoneOverlay');
    const textIdx = src.indexOf('<TextOverlay placementFilter="front"');
    assert.ok(blurIdx > -1, 'BlurZoneOverlay is not mounted in IDELayout.jsx');
    assert.ok(blurIdx < textIdx, 'BlurZoneOverlay must be mounted BEFORE (i.e. visually below) the front text overlay');
});

// ── 5 · Export (ZoneBlur.js + jobs/exportProcessor.js wiring) ───────────────
log('\n5 · Export: the filter graph shape, and the export job actually calling it');
const ZB = await import('../client/src/motion/ZoneBlur.js');

await check('zoneBlurFilterGraph produces a split -> crop+blur -> overlay-back chain ending at the output label', () => {
    const lines = ZB.zoneBlurFilterGraph({ x: 0.1, y: 0.1, w: 0.3, h: 0.3, blur: 20 }, { width: 1080, height: 1920, inLabel: 'vbase', outLabel: 'vout' });
    const joined = lines.join(';');
    assert.match(joined, /\[vbase\]split\[zb_a\]\[zb_b\]/);
    assert.match(joined, /\[zb_a\]crop=\d+:\d+:\d+:\d+,gblur=sigma=[\d.]+\[zb_blur\]/);
    assert.match(joined, /\[zb_b\]\[zb_blur\]overlay=\d+:\d+\[vout\]/);
});
await check('the blur sigma scales with frame width (same reference-1080 rule as clip.shadow)', () => {
    const small = ZB.zoneBlurFilterGraph({ x: 0, y: 0, w: 0.3, h: 0.3, blur: 24 }, { width: 1080, height: 1920, inLabel: 'a', outLabel: 'b' });
    const large = ZB.zoneBlurFilterGraph({ x: 0, y: 0, w: 0.3, h: 0.3, blur: 24 }, { width: 2160, height: 3840, inLabel: 'a', outLabel: 'b' });
    const sigmaOf = (lines) => Number(lines.join(';').match(/gblur=sigma=([\d.]+)/)[1]);
    assert.ok(sigmaOf(large) > sigmaOf(small) * 1.5, `expected a visibly larger sigma at 4x the resolution: ${sigmaOf(small)} -> ${sigmaOf(large)}`);
});
await check('normalizeZone never lets the box run off the right/bottom edge of the frame', () => {
    const z = ZB.normalizeZone({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 });
    assert.ok(z.x + z.w <= 1 + 1e-9 && z.y + z.h <= 1 + 1e-9, JSON.stringify(z));
});
await check('jobs/exportProcessor.js loads ZoneBlur.js and branches to complexFilter only for a zoned clip', () => {
    const src = fs.readFileSync(path.join(ROOT, 'jobs/exportProcessor.js'), 'utf8');
    assert.match(src, /loadZoneBlur/);
    assert.match(src, /zb\.zoneBlurFilterGraph\(clip\.blurZone/);
    assert.match(src, /cmd\.videoFilters\(vFilters\.join\(','\)\);/, 'an unzoned clip must still go through the original plain videoFilters() path');
});

// ── 6 · FFmpeg actually blurs only inside the zone (skipped without a binary) ──
function ffmpegBin() {
    for (const bin of ['ffmpeg', '/usr/bin/ffmpeg']) {
        const r = spawnSync(bin, ['-version'], { encoding: 'utf8' });
        if (r.status === 0) return bin;
    }
    try { return require('ffmpeg-static'); } catch { return null; }
}
const FFMPEG = ffmpegBin();

if (!FFMPEG) {
    log('\n6 · FFmpeg behavioural check -- skipped (no ffmpeg binary available)');
} else {
    log('\n6 · FFmpeg actually blurs the inside of the zone and leaves the rest of the frame untouched');
    const W = 640, H = 360;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blurzone-'));
    const out = path.join(dir, 'out.mp4');

    // A hard red|blue vertical split, with the blur zone straddling the
    // boundary at the frame's horizontal center -- a blurred boundary reads
    // as a blended color at the seam, a sharp one does not.
    const zone = { x: 0.4, y: 0.1, w: 0.2, h: 0.8, blur: 40 };
    const zb = ZB.zoneBlurFilterGraph(zone, { width: W, height: H, inLabel: 'vbase', outLabel: 'vout' });
    const graph = [
        `color=c=red:size=${W / 2}x${H}:duration=1:rate=10[left]`,
        `color=c=blue:size=${W / 2}x${H}:duration=1:rate=10[right]`,
        `[left][right]hstack=inputs=2[vbase]`,
        ...zb,
    ].join(';');

    await check('the render runs and produces a file', () => {
        // No `-i` at all: both sources in the graph are self-contained lavfi
        // generators (`color=...`), not stream references like `[0:v]`.
        const r = spawnSync(FFMPEG, [
            '-hide_banner', '-loglevel', 'error',
            '-filter_complex', graph, '-map', '[vout]', '-frames:v', '1', '-pix_fmt', 'yuv420p', '-y', out,
        ], { encoding: 'utf8', timeout: 60_000 });
        assert.equal(r.status, 0, (r.stderr || '').split('\n').slice(-6).join(' | '));
        assert.ok(fs.existsSync(out) && fs.statSync(out).size > 0);
    });

    // A 1x1 `crop` is invalid on yuv420p output: 4:2:0 chroma planes are
    // subsampled by 2 in each direction, so ffmpeg's crop filter rejects any
    // odd/sub-2px box with "Invalid too big or non positive size for width
    // '0' or height '0'" -- confirmed by sweeping crop=1:1 at many x
    // coordinates against this exact pipeline's own output, all of which
    // failed identically. A 4x4 box is safely >= the 2x2 chroma block and
    // still small enough that, against this test's large flat-color
    // regions, every pixel in it is the same color -- so sampling its
    // top-left corner is equivalent to sampling a single pixel.
    function pixelAt(x, y) {
        const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', out, '-frames:v', '1',
            '-vf', `crop=4:4:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
            { timeout: 30_000, encoding: 'buffer' });
        if (r.status !== 0 || !r.stdout || r.stdout.length < 3) {
            throw new Error(`pixelAt(${x},${y}) failed to extract a pixel: ${(r.stderr || '').toString().split('\n').slice(-3).join(' | ')}`);
        }
        return Buffer.from(r.stdout.slice(0, 3)).toString('hex');
    }
    // Deliberately does NOT special-case null/undefined inputs: pixelAt now
    // throws rather than returning null on a failed extraction, so a bad
    // read surfaces as a hard failure instead of colorDist(null, X) silently
    // returning Infinity and letting a `> threshold` assertion pass for the
    // wrong reason (the bug that was masking this very crop failure).
    const colorDist = (a, b) => {
        let d = 0;
        for (let i = 0; i < 3; i++) d = Math.max(d, Math.abs(parseInt(a.substr(i * 2, 2), 16) - parseInt(b.substr(i * 2, 2), 16)));
        return d;
    };
    const RED = 'ff0000', BLUE = '0000ff';

    await check('right at the red|blue seam (inside the zone), the pixel is a blend, not pure red or blue', () => {
        const seam = pixelAt(W / 2, H / 2);
        assert.ok(colorDist(seam, RED) > 25 && colorDist(seam, BLUE) > 25, `expected a blended color at the seam, got ${seam}`);
    });
    await check('well outside the zone, the frame is untouched -- still pure red on the far left', () => {
        const farLeft = pixelAt(10, H / 2);
        assert.ok(colorDist(farLeft, RED) < 10, `expected the untouched copy to stay pure red far from the zone, got ${farLeft}`);
    });

    // ── 7 · A zoned clip's export still has real, audible audio ──────────────
    // jobs/exportProcessor.js switches a zoned clip from cmd.videoFilters() to
    // cmd.complexFilter() (R99), which -- unlike videoFilters() -- does NOT
    // auto-map audio, so an explicit '-map' output option was added for both
    // branches (isImage: '-map','1:a' for the lavfi silence input; otherwise
    // '-map','0:a?' for the source's own audio, mirroring renderMattedSegment's
    // R92 precedent). Section 6 above proves the VIDEO graph only blurs the
    // zone; this proves the audio '-map' wiring actually survives against a
    // REAL single-file source with both streams in input 0 -- a two-input
    // lavfi test (video-only + audio-only sources) would hide this exact bug,
    // since '-map 0:a?' would silently match nothing and ffmpeg would still
    // exit 0 with a muted video, the one way this could fail "quietly".
    log('\n7 · A zoned clip\'s export keeps a real, audible audio track (both branches)');
    const fixtureSrc = path.join(dir, 'fixture_src.mp4');
    const fixtureImage = path.join(dir, 'fixture_src.png');
    await check('fixture: a real file with BOTH video and audio in stream 0 (not two lavfi inputs)', () => {
        const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y',
            '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10:duration=2',
            '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=2',
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', fixtureSrc,
        ], { encoding: 'utf8', timeout: 30_000 });
        assert.equal(r.status, 0, (r.stderr || '').split('\n').slice(-6).join(' | '));
    });
    await check('fixture: a real still image -- \'-loop 1\' (the isImage branch) is only valid on an actual image input, never on a video file', () => {
        const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y',
            '-f', 'lavfi', '-i', 'testsrc=size=320x240', '-frames:v', '1', fixtureImage,
        ], { encoding: 'utf8', timeout: 30_000 });
        assert.equal(r.status, 0, (r.stderr || '').split('\n').slice(-6).join(' | '));
    });

    function renderZonedSegment({ asImage }) {
        const segOut = path.join(dir, asImage ? 'seg_image.mp4' : 'seg_video.mp4');
        const zone2 = { x: 0.1, y: 0.1, w: 0.3, h: 0.3, blur: 20 };
        const zbGraph2 = ZB.zoneBlurFilterGraph(zone2, { width: 320, height: 240, inLabel: 'vbase', outLabel: 'vout' });
        const complexFilterArg = ['[0:v]null[vbase]', ...zbGraph2].join(';');
        const args = asImage
            // Mirrors the isImage branch exactly: '-loop 1' on a REAL still
            // image input (never a video file -- ffmpeg rejects '-loop' on
            // non-image demuxers with "Option loop not found", which is a
            // test-fixture bug, not a jobs/exportProcessor.js bug, if hit
            // here), plus a separate lavfi silence input mapped with
            // '-map','1:a' (the silence IS the clip's only possible audio).
            ? ['-hide_banner', '-loglevel', 'error', '-y',
               '-loop', '1', '-i', fixtureImage, '-t', '2',
               '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
               '-filter_complex', complexFilterArg, '-map', '[vout]', '-map', '1:a',
               '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', segOut]
            // Mirrors the non-image branch: one real input, '-map','0:a?'
            // pulls that same input's own audio stream.
            : ['-hide_banner', '-loglevel', 'error', '-y',
               '-i', fixtureSrc,
               '-filter_complex', complexFilterArg, '-map', '[vout]', '-map', '0:a?',
               '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', segOut];
        const r = spawnSync(FFMPEG, args, { encoding: 'utf8', timeout: 30_000 });
        return { r, segOut };
    }

    function streamTypes(file) {
        const p = spawnSync(FFMPEG.endsWith('ffmpeg') ? FFMPEG.replace(/ffmpeg$/, 'ffprobe') : 'ffprobe',
            ['-v', 'error', '-show_entries', 'stream=codec_type,duration', '-of', 'json', file],
            { encoding: 'utf8', timeout: 15_000 });
        if (p.status !== 0) return null;
        try { return JSON.parse(p.stdout).streams; } catch { return null; }
    }

    function meanVolumeDb(file) {
        const r = spawnSync(FFMPEG, ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'],
            { encoding: 'utf8', timeout: 15_000 });
        const m = (r.stderr || '').match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
        return m ? Number(m[1]) : null;
    }

    for (const asImage of [false, true]) {
        const label = asImage ? 'isImage branch (\'-map\',\'1:a\')' : 'video branch (\'-map\',\'0:a?\')';
        await check(`${label}: the render runs and produces both a video and an audio stream`, () => {
            const { r, segOut } = renderZonedSegment({ asImage });
            assert.equal(r.status, 0, (r.stderr || '').split('\n').slice(-6).join(' | '));
            const streams = streamTypes(segOut);
            assert.ok(streams, 'ffprobe could not read the output');
            assert.ok(streams.some(s => s.codec_type === 'video'), 'no video stream in the output');
            assert.ok(streams.some(s => s.codec_type === 'audio'), 'no audio stream in the output -- the \'-map\' wiring silently dropped it');
        });
    }
    await check('video branch: the mapped audio is the source\'s real track, not silence', () => {
        const { segOut } = renderZonedSegment({ asImage: false });
        const db = meanVolumeDb(segOut);
        assert.ok(db !== null, 'could not read mean_volume from the output');
        assert.ok(db > -50, `expected an audible track (sine @ 440Hz), got mean_volume ${db} dB -- looks silent`);
    });

    fs.rmSync(dir, { recursive: true, force: true });
}

log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL BLUR ZONE CHECKS PASSED');
process.exit(failures ? 1 : 0);
