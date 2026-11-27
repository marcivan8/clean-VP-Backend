// R171 — stacked two-speaker split screen for shorts (host top, guest bottom),
// plus the caption-size parity check of the "text behind the speaker" path.
// node scripts/test_duo_split.mjs
import { register, createRequire } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const require = createRequire(import.meta.url);
const log = console.log; console.warn = () => {};
const ok = (n) => log(`✓ ${n}`);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const DS = await import('../client/src/motion/DuoSplit.js');
const LP = await import('../client/src/motion/LayoutPresets.js');
const { buildCompositionPlan } = await import('../client/src/motion/Compositor.js');
const { buildShortTimeline, DUO_CAPTION_Y, DUO_TRACK_ID } = await import('../client/src/agent/shortTimeline.js');
const CC = require(path.join(ROOT, 'server/compositor/CompositorCompiler.js'));

const scene = {
    mode: 'duo', hostSide: 'left',
    layout: { anchors: [
        { speaker: 'A', anchor: { cx: 0.28, cy: 0.40, h: 0.18 } },
        { speaker: 'B', anchor: { cx: 0.72, cy: 0.46, h: 0.16 } },
    ] },
};
const SA = 16 / 9, FA = 9 / 16;

// ── Anchors ────────────────────────────────────────────────────────────────
{
    const a = DS.duoAnchorsFromScene(scene);
    assert.equal(a.host.cx, 0.28); assert.equal(a.guest.cx, 0.72);
    const r = DS.duoAnchorsFromScene({ ...scene, hostSide: 'right' });
    assert.equal(r.host.cx, 0.72);
    assert.equal(DS.duoAnchorsFromScene({ ...scene, mode: 'solo' }), null);
    assert.equal(DS.duoAnchorsFromScene({ ...scene, layout: { anchors: [scene.layout.anchors[0], { anchor: { cx: 0.31, cy: 0.4, h: 0.2 } }] } }), null);
    assert.equal(DS.duoAnchorsFromScene(null), null);
    ok('host follows hostSide; solo, too-close or missing anchors give no split');
}

// ── Framing maths: each face lands in the middle of its half ─────────────
const frames = DS.duoSplitFrames({ ...DS.duoAnchorsFromScene(scene), sourceAspect: SA, frameAspect: FA });
{
    assert.ok(frames.top.y === 0 && frames.bottom.y === 0.5 && frames.top.h === 0.5);
    assert.ok(frames.zoom > 1 && frames.top.zoom === frames.bottom.zoom, 'both halves share one zoom');
    // Visible source region from the export formula (cover by height, x zoom).
    const ba = FA * 2;
    const vh = 1 / frames.zoom, vw = ba / (SA * frames.zoom);
    const where = (f, a) => ({
        x: (a.cx - (1 - vw) * f.focusX) / vw,
        y: (a.cy - (1 - vh) * f.focusY) / vh,
    });
    const top = where(frames.top, scene.layout.anchors[0].anchor);
    const bot = where(frames.bottom, scene.layout.anchors[1].anchor);
    assert.ok(Math.abs(top.x - 0.5) < 0.01 && Math.abs(bot.x - 0.5) < 0.01, JSON.stringify({ top, bot }));
    assert.ok(Math.abs(top.y - 0.42) < 0.01 && Math.abs(bot.y - 0.42) < 0.01, JSON.stringify({ top, bot }));
    assert.equal(DS.duoSplitFrames({ ...DS.duoAnchorsFromScene(scene), sourceAspect: 9 / 16, frameAspect: FA }), null);
    ok('host and guest are centred, 42% down their half, at the same size; a narrow source is refused');
}

// ── Preview CSS and export filter move the picture by the same amount ────
{
    const css = LP.frameToCss(frames.bottom);
    const z = frames.bottom.zoom;
    const pct = (v) => parseFloat(v) / 100;
    assert.ok(Math.abs(pct(css.media.width) - z) < 1e-3 && css.media.position === 'absolute');
    // Box 1080x960, source 1920x1080 scaled to cover box*zoom.
    const bw = 1080, bh = 960, ew = bw * z, eh = bh * z;
    const s = Math.max(ew / 1920, eh / 1080), sw = 1920 * s;
    const fx = frames.bottom.focusX;
    const previewShift = (sw - ew) * fx + (-pct(css.media.left) * bw); // object-position + element offset
    const exportShift = (sw - bw) * fx;                                // crop x in the scaled source
    assert.ok(Math.abs(previewShift - exportShift) < 1, `${previewShift} vs ${exportShift}`);
    const plain = LP.frameToCss({ ...frames.bottom, zoom: undefined });
    assert.equal(plain.media.width, '100%'); assert.equal(plain.media.position, undefined);
    ok('preview offset equals the export crop; zoom 1 keeps the plain cover CSS');
}

// ── Short timeline ─────────────────────────────────────────────────────────
const mainTracks = [
    { id: 'v1', type: 'video', order: 0, clips: [{ id: 'c1', type: 'video', assetId: 'a1', start: 0, duration: 20, offset: 0, url: '/u.mp4',
        metadata: { resolution: { w: 1920, h: 1080 } }, layerMask: { maskAssetUrl: 'm' }, layerTarget: 'background' }] },
    { id: 't1', type: 'text', order: 0, clips: [{ id: 'caption-1', start: 2, duration: 2, content: 'hi', words: [{ word: 'hi', start: 2, end: 2.4 }], y: 80 }] },
    { id: 'o1', type: 'overlay', order: 0, clips: [] },
];
const short = { start: 1, end: 9, platform: 'tiktok' };
{
    const built = buildShortTimeline(mainTracks, short, { assets: [], sceneAnalysisByAsset: { a1: scene }, profile: { aspectRatio: '9:16', captionY: 72 } });
    assert.equal(built.duoSplit, 1);
    const duo = built.tracks.find(t => t.id === DUO_TRACK_ID);
    assert.ok(duo && duo.type === 'overlay' && duo.order < 0);
    assert.ok(built.tracks.indexOf(duo) < built.tracks.findIndex(t => t.id === 'o1'), 'under the other overlays');
    assert.deepEqual(duo.clips.map(c => c.duoSplit), ['top', 'bottom']);
    assert.ok(duo.clips.every(c => c.muted && c.volume === 0 && LP.hasLayoutFrame(c) && !c.virtualCam && c.offset === 0.85 && c.url === '/u.mp4'));
    const base = built.tracks.find(t => t.id === 'v1').clips[0];
    assert.ok(base.duoSplit === true && !base.layerMask && !base.layerTarget, 'base keeps the audio, loses the unused matte');
    assert.equal(built.tracks.find(t => t.id === 't1').clips[0].y, DUO_CAPTION_Y);
    assert.equal(mainTracks[0].clips[0].layerMask.maskAssetUrl, 'm', 'the main edit is not touched');

    const off = buildShortTimeline(mainTracks, short, { assets: [], sceneAnalysisByAsset: { a1: scene }, duo: false, profile: { aspectRatio: '9:16', captionY: 72 } });
    assert.ok(!off.duoSplit && !off.tracks.some(t => t.id === DUO_TRACK_ID));
    assert.equal(off.tracks.find(t => t.id === 't1').clips[0].y, 72);
    const none = buildShortTimeline(mainTracks, short, { assets: [], profile: { aspectRatio: '9:16', captionY: 72 } });
    assert.ok(!none.duoSplit);
    ok('a duo short gets host/guest halves under the graphics, captions on the seam; off or unanalysed stays single');

    // Compositor plan: both halves become cover overlays with the zoom.
    const plan = buildCompositionPlan(built.tracks, { width: 1080, height: 1920, fps: 30 });
    const halves = (plan?.overlays || []).filter(o => String(o.clipId).includes('-duo-'));
    assert.equal(halves.length, 2);
    assert.ok(halves.every(o => o.fit?.mode === 'cover' && o.fit.zoom === frames.zoom));
    ok('the export plan carries both halves with their zoom');
}

// ── Render on real pixels ──────────────────────────────────────────────────
let bundled = null;
try { bundled = require('ffmpeg-static'); } catch { /* optional */ }
const ffmpeg = ['ffmpeg', '/usr/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg', bundled].filter(Boolean).find(b => spawnSync(b, ['-version']).status === 0);
if (!ffmpeg) {
    log('– render check skipped (no ffmpeg)');
} else {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-'));
    // 640x360 grey source: a red "face" where the host sits, a blue one for the guest.
    const src = path.join(tmp, 'src.png');
    const box = (a, c) => `drawbox=x=${Math.round(a.cx * 640 - 20)}:y=${Math.round(a.cy * 360 - 20)}:w=40:h=40:color=${c}:t=fill`;
    let r = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=640x360',
        '-vf', `${box(scene.layout.anchors[0].anchor, 'red')},${box(scene.layout.anchors[1].anchor, 'blue')}`, '-frames:v', '1', src]);
    assert.equal(r.status, 0);
    const baseV = path.join(tmp, 'b.mp4');
    spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=360x640:r=30:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', baseV]);
    const ov = (id, f) => ({ id, clipId: id, zIndex: 1, outputStart: 0, outputEnd: 1, source: { url: 'x', type: 'image' },
        fit: { mode: 'cover', focusX: f.focusX, focusY: f.focusY, zoom: f.zoom },
        geometry: [{ t: 0, x: f.x, y: f.y, w: f.w, h: f.h, rotation: 0, opacity: 1, blur: 0 }] });
    const plan = { version: 1, renderWidth: 360, renderHeight: 640, overlays: [ov('top', frames.top), ov('bot', frames.bottom)] };
    const c = CC.compileCompositionPlan(plan, [{ overlayId: 'top', inputIndex: 1 }, { overlayId: 'bot', inputIndex: 2 }]);
    const out = path.join(tmp, 'o.mp4');
    r = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', baseV, '-loop', '1', '-t', '1', '-i', src, '-loop', '1', '-t', '1', '-i', src,
        '-filter_complex', c.filterComplex, '-map', `[${c.outputLabel}]`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const f = spawnSync(ffmpeg, ['-loglevel', 'error', '-ss', '0.5', '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 26 }).stdout;
    const px = (x, y) => { const i = (y * 360 + x) * 3; return [f[i], f[i + 1], f[i + 2]]; };
    const isRed = ([R, G, B]) => R > 150 && B < 90 && G < 90;
    const isBlue = ([R, G, B]) => B > 150 && R < 90 && G < 90;
    // Expected face centres: middle of each half, 42% down it.
    assert.ok(isRed(px(180, Math.round(320 * 0.42))), `top: ${px(180, Math.round(320 * 0.42))}`);
    assert.ok(isBlue(px(180, 320 + Math.round(320 * 0.42))), `bottom: ${px(180, 320 + Math.round(320 * 0.42))}`);
    let black = 0;
    for (let y = 2; y < 638; y += 4) for (let x = 2; x < 358; x += 4) { const p = px(x, y); if (p[0] < 30 && p[1] < 30 && p[2] < 30) black++; }
    assert.ok(black < 20, `black base showing through: ${black}`);
    ok('exported frame: host face centred in the top half, guest in the bottom half, no gaps');
    fs.rmSync(tmp, { recursive: true, force: true });
}

// ── Wiring ────────────────────────────────────────────────────────────────
{
    const panel = read('client/src/components/ShortsPanel.jsx');
    // R176b: the three actions share one helper, which passes duo; a shorts
    // agent run gets it from the same toggles.
    assert.match(panel, /const opts = \{ polish, popOut, sfx, duo \};/, 'the shared finish helper passes duo');
    assert.equal((panel.match(/await finished\(short/g) || []).length, 3, 'preview, export and open-as-project all use it');
    assert.match(panel, /finish: \{ polish, sfx, duo, popOut \}/, 'an agent run is started with the same duo setting');
    assert.match(panel, /useState\(true\);[^\n]*\n?/);
    assert.match(read('client/src/agent/shortFinisher.js'), /sceneAnalysisByAsset: state\.sceneAnalysisByAsset/);
    assert.match(read('client/src/agent/shortFinisher.js'), /captionY: DUO_CAPTION_Y/);
    assert.match(read('client/src/agent/shortPolish.js'), /if \(c\.duoSplit\) continue;/);
    for (const lang of ['en', 'fr']) {
        const j = JSON.parse(read(`client/src/locales/${lang}/editor.json`));
        assert.ok(j.shortsPanel?.duoSplit && j.shortsPanel?.duoSplitHint, lang);
    }
    // Framed overlay videos honour the cover/zoom style in the preview.
    const go = read('client/src/components/Player/GraphicOverlay.jsx');
    assert.match(go, /\.\.\.\(frameFit \|\| \{\}\), pointerEvents: 'none'/);
    ok('Shorts panel, finisher, polish, locales and preview overlay are wired');
}

// ── Caption size: text behind the speaker uses the shared scale ──────────
{
    const ep = read('jobs/exportProcessor.js');
    assert.ok(!/fontSize\) \|\| 48\) \* \(targetWidth \/ 1080\)/.test(ep), 'no width/1080 caption scaling left');
    assert.match(ep, /\(Number\(sClip\.fontSize\) \|\| 48\) \* \(Number\(sClip\.scale\) \|\| 1\) \* captionScaleFactor/);
    ok('behind-the-speaker text sizes like the other caption paths (fontSize x scale x captionScaleFactor)');
}

log('\nALL DUO SPLIT CHECKS PASSED');
