// R89 (to-do A4 + A5) — transition pack and animated templates.
// Shared curves/drawing (client/src/motion) → store → assistant → FFmpeg,
// checked on decoded pixels. node scripts/test_transitions_templates.mjs
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

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FX = await import('../client/src/motion/TransitionFX.js');
const G = await import('../client/src/motion/TemplateGraphics.js');
const { default: useTimelineStore } = await import('../client/src/store/useTimelineStore.js');
const { IntentParser } = await import('../client/src/agent/IntentParser.js');
const { EditPlanner } = await import('../client/src/agent/EditPlanner.js');
const { CommandCompiler } = await import('../client/src/agent/CommandCompiler.js');
const { VideoEditorTools } = await import('../client/src/agent/VideoEditorTools.js');
const { buildCompositionPlan } = await import('../client/src/motion/Compositor.js');
const TC = require(path.join(ROOT, 'server/compositor/TransitionCompiler.js'));
const TR = require(path.join(ROOT, 'server/compositor/TemplateRenderer.js'));
const CC = require(path.join(ROOT, 'server/compositor/CompositorCompiler.js'));
let Canvas = null;
try { Canvas = require('@napi-rs/canvas'); } catch (_) { Canvas = null; }
const ffmpeg = ['ffmpeg', '/usr/bin/ffmpeg'].find(b => spawnSync(b, ['-version']).status === 0) || null;

// ── 1. Curves ─────────────────────────────────────────────────────────────
for (const type of FX.TRANSITION_TYPES) {
    for (const u of [-1, 1]) {
        const f = FX.fxAt(type, u);
        assert.ok(FX.fxIsNeutral(f) || (type === 'speed-lines' && Math.abs(f.tx) < 1e-6 && Math.abs(f.scale - 1) < 1e-6 && f.blurX < 1e-6),
            `${type} not neutral at u=${u}: ${JSON.stringify(f)}`);
    }
    const mid = FX.fxAt(type, 0);
    assert.ok(!FX.fxIsNeutral(mid), `${type} does nothing at the cut`);
    if (Math.abs(mid.tx) > 0) assert.ok(mid.scale >= 1 + 2 * Math.abs(mid.tx) - 1e-9, `${type} would show an edge`);
}
ok('every transition is neutral at its window edges, active at the cut, and never reveals the frame edge');
assert.equal(FX.normalizeTransitionType('fade'), 'dip');
assert.equal(FX.normalizeTransitionType('slide'), 'whip-left');
assert.equal(FX.normalizeTransitionType('nope'), null);
ok('old stored values (fade, crossfade, slide, zoom) map onto the pack');
const W = FX.transitionWindows([
    { id: 'a', start: 0, duration: 0.2, transition: { type: 'dip', duration: 1 } },
    { id: 'b', start: 0.2, duration: 3, transition: { type: 'flash', duration: 0.4 } },
    { id: 'c', start: 5, duration: 2 },
]);
assert.equal(W[0].before, 0.2);
assert.equal(W[0].after, 0.5);
assert.equal(W[1].after, 0);
ok('windows are clamped to short clips, and a cut into a gap only plays the outgoing half');
for (const [txt, want] of [['add a whip', 'whip-left'], ['whip right please', 'whip-right'], ['speed lines', 'speed-lines'], ['un fondu au noir', 'dip'], ['zoom', 'zoom-punch'], ['glitch', 'glitch']]) {
    assert.equal(FX.transitionFromText(txt), want, txt);
}
ok('free text resolves to the pack (EN/FR)');
{
    const src = fs.readFileSync(path.join(ROOT, 'client/src/agent/CommandCompiler.js'), 'utf8');
    const m = src.match(/const TRANSITION_PACK_DURATIONS = (\{[\s\S]*?\});/);
    const table = Function(`return ${m[1]}`)();
    assert.deepEqual(table, FX.TRANSITION_DEFAULT_DURATION);
}
ok("CommandCompiler's inline duration table matches TransitionFX");

// ── 2. Assistant chain ────────────────────────────────────────────────────
const tm = window.timelineManager;
function setup() {
    tm.fromLegacyTracks([{ id: 'track-default-video', type: 'video', name: 'V', clips: [
        { id: 'v1', clipId: 'e1', assetId: 'a', type: 'video', name: 'A', start: 0, duration: 4, offset: 0, speed: 1 },
        { id: 'v2', clipId: 'e2', assetId: 'a', type: 'video', name: 'B', start: 4, duration: 4, offset: 4, speed: 1 },
        { id: 'v3', clipId: 'e3', assetId: 'a', type: 'video', name: 'C', start: 8, duration: 4, offset: 8, speed: 1 } ] }]);
    useTimelineStore.setState({ tracks: tm.toLegacyTracks(), duration: 12, currentTime: 2, activeClipId: 'v1', aspectRatio: '9:16', assets: [{ id: 'a', type: 'video' }] });
}
setup();
{
    const intent = await IntentParser.parse('add a whip between all the clips');
    const plan = await EditPlanner.generatePlan(intent);
    const step = plan.plan.steps[0];
    assert.equal(step.type, 'whip-left');
    assert.equal(step.clip_id, '$ALL_CLIPS');
    const cmds = CommandCompiler.compile({ ...plan.plan, intent: { ...intent, confidence: 'HIGH' } }, useTimelineStore.getState()).commands;
    assert.equal(cmds[0].action, 'addTransition');
    assert.equal(cmds[0].args.duration, 0.36);
}
ok('"add a whip between all the clips" plans a whip on every cut with the pack duration');
{
    const intent = await IntentParser.parse('add a counter day 14 of 30');
    const plan = await EditPlanner.generatePlan(intent);
    assert.deepEqual(plan.plan.steps[0].args, { kind: 'counter', params: { value: 14, total: 30, label: 'DAY' } });
}
ok('"add a counter day 14 of 30" plans a counter with those values');

// ── 3. Store: templates ───────────────────────────────────────────────────
setup();
const tools = new VideoEditorTools();
let r = await tools.execute({ name: 'add_template', args: { kind: 'price-pop', params: { text: '15-20€' } } });
assert.equal(r.success, true, JSON.stringify(r));
const ovTrack = () => useTimelineStore.getState().tracks.find(t => t.type === 'overlay');
let tpl = ovTrack().clips[0];
assert.equal(tpl.type, 'template');
assert.equal(tpl.template.kind, 'price-pop');
assert.equal(tpl.template.params.text, '15-20€');
assert.equal(tpl.start, 2);
assert.ok(Math.abs(tpl.scale * 0.25 - G.TEMPLATE_WIDTH_FRACTION['price-pop']) < 1e-9);
ok('a template lands on the overlay track at the playhead, at its own width');
useTimelineStore.getState().updateTemplateParams(ovTrack().id, tpl.id, { text: '99€' });
tpl = ovTrack().clips[0];
assert.equal(tpl.template.params.text, '99€');
const saved = JSON.parse(JSON.stringify(tm.toLegacyTracks()));
tm.fromLegacyTracks(saved);
useTimelineStore.setState({ tracks: tm.toLegacyTracks() });
tpl = ovTrack().clips[0];
assert.equal(tpl.template?.params?.text, '99€');
assert.deepEqual(tpl.metadata?.resolution, G.templateSize('price-pop', tpl.template.params) && { w: 680, h: 300 });
ok('template parameters and its shape (metadata.resolution) survive a save/reload');
const plan = buildCompositionPlan(useTimelineStore.getState().tracks, { width: 1080, height: 1920, fps: 30 });
const ov = plan.overlays.find(o => o.clipId === tpl.id);
assert.equal(ov.source.type, 'template');
assert.equal(ov.source.template.params.text, '99€');
const g0 = ov.geometry[0];
assert.ok(Math.abs((g0.w * 1080) / (g0.h * 1920) - 680 / 300) < 0.01, JSON.stringify(g0));
assert.deepEqual(CC.validateCompositionPlanShape({ ...plan, overlays: [ov] }, 1080, 1920), []);
ok('the export plan carries the template, with the right box shape, and validates');

// Transitions persist
useTimelineStore.getState().addTransition('v1', 'glitch', 0.32);
tm.fromLegacyTracks(JSON.parse(JSON.stringify(tm.toLegacyTracks())));
useTimelineStore.setState({ tracks: tm.toLegacyTracks() });
assert.equal(useTimelineStore.getState().tracks.find(t => t.type === 'video').clips.find(c => c.start === 0).transition?.type, 'glitch');
ok('a transition survives a save/reload');

// ── 4. Drawing ────────────────────────────────────────────────────────────
if (!Canvas) {
    log('– drawing/render checks skipped (@napi-rs/canvas not installed for this platform)');
} else {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r89-'));
    for (const kind of G.TEMPLATE_KINDS) {
        const a = await TR.renderTemplateFrames({ kind, params: {} }, { durationSec: 1, fps: 10, widthPx: 400, tmpDir: tmp, name: `${kind}-a` });
        const b = await TR.renderTemplateFrames({ kind, params: {} }, { durationSec: 1, fps: 10, widthPx: 400, tmpDir: tmp, name: `${kind}-b` });
        assert.equal(a.frames, 10);
        assert.ok(a.files.every((f, i) => Buffer.compare(fs.readFileSync(f), fs.readFileSync(b.files[i])) === 0), `${kind} not deterministic`);
        const img = await Canvas.loadImage(fs.readFileSync(a.files[6]));
        const c = Canvas.createCanvas(img.width, img.height); const x = c.getContext('2d'); x.drawImage(img, 0, 0);
        const d = x.getImageData(0, 0, img.width, img.height).data;
        let opaque = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 200) opaque++;
        assert.ok(opaque > img.width * img.height * 0.03, `${kind} draws nothing`);
    }
    ok('every template draws, deterministically (same frames twice)');
    {
        // Counter ends on its value: the last frame equals a frame drawn straight at the end.
        const cv1 = Canvas.createCanvas(540, 300); G.drawTemplate(cv1.getContext('2d'), 'counter', { value: 7, total: 9, from: 1 }, 2.0, 3);
        const cv2 = Canvas.createCanvas(540, 300); G.drawTemplate(cv2.getContext('2d'), 'counter', { value: 7, total: 9, from: 6 }, 2.0, 3);
        assert.equal(Buffer.compare(cv1.toBuffer('image/png'), cv2.toBuffer('image/png')), 0);
    }
    ok('the flip counter settles on its value wherever it starts counting from');
    assert.deepEqual(Object.keys(TR.FONT_FILES).sort(), Object.values(G.TEMPLATE_FONTS).sort());
    const css = fs.readFileSync(path.join(ROOT, 'client/src/index.css'), 'utf8');
    for (const [fam, file] of Object.entries(TR.FONT_FILES)) {
        assert.ok(fs.existsSync(path.join(ROOT, 'client/public/fonts', file)), `${file} missing`);
        // index.css escapes the dot in some urls ("x\\.woff2").
        const base = file.replace(/\.[^.]+$/, '');
        assert.ok(css.includes(base) && css.includes(`'${fam}'`), `${fam} not declared with ${file} in index.css`);
    }
    ok('the export registers exactly the font files the editor loads, under the same names');

    if (!ffmpeg) {
        log('– ffmpeg checks skipped');
    } else {
        // ── 5. Transitions on pixels ──────────────────────────────────────
        const Wd = 360, Hd = 640;
        const base = path.join(tmp, 'base.mp4');
        // Clip A: vertical stripes (high horizontal detail), clip B: solid mid-grey.
        spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=0x204060:s=${Wd}x${Hd}:r=30:d=2,geq=lum='if(lt(mod(X\\,24)\\,12)\\,230\\,30)':cb=128:cr=128`,
            '-f', 'lavfi', '-i', `color=c=0x808080:s=${Wd}x${Hd}:r=30:d=2`, '-filter_complex', '[0][1]concat=n=2:v=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '1', base]);
        const FXm = await TC.loadTransitionFX();
        const render = (type) => {
            const wins = TC.outputWindows(FXm, [{ id: 'a', transition: { type, duration: 0.6 } }, { id: 'b' }], [0, 2], 4);
            const g = TC.compileTransitions(wins, { FX: FXm, width: Wd, height: Hd, fps: 30, tmpDir: tmp, canvasModule: Canvas });
            const out = path.join(tmp, `t-${type}.mp4`);
            const args = ['-y', '-loglevel', 'error', '-i', base];
            for (const i of g.inputs) args.push(...i.inputOptions, '-i', i.path);
            args.push('-filter_complex', g.filterComplex, '-map', `[${g.outputLabel}]`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '1', out);
            const rr = spawnSync(ffmpeg, args, { encoding: 'utf8' });
            assert.equal(rr.status, 0, `${type}: ${rr.stderr}`);
            return out;
        };
        const frame = (file, t) => spawnSync(ffmpeg, ['-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 26 }).stdout;
        const mean = (buf) => { let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i]; return s / buf.length; };
        const hDetail = (buf) => { let s = 0; for (let y = 100; y < Hd - 100; y += 4) for (let x = 1; x < Wd; x++) { const i = (y * Wd + x) * 3; s += Math.abs(buf[i + 1] - buf[i - 2]); } return s; };
        const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };

        const fl = render('flash');
        assert.ok(mean(frame(fl, 1.98)) > 235, 'flash not white at the cut');
        const dp = render('dip');
        assert.ok(mean(frame(dp, 1.98)) < 20, 'dip not black at the cut');
        ok('flash goes white and dip goes black at the cut');
        const wp = render('whip-left');
        const before = hDetail(frame(base, 1.85)), during = hDetail(frame(wp, 1.85));
        assert.ok(during < before * 0.6, `whip not blurred (${during} vs ${before})`);
        ok('whip smears the picture horizontally across the cut');
        const gl = render('glitch');
        {
            const f = frame(gl, 1.9); // outgoing stripes (the incoming clip is flat grey)
            // A red/blue split leaves pixels where R and B disagree on the stripes.
            let split = 0; for (let i = 0; i < f.length; i += 3) if (Math.abs(f[i] - f[i + 2]) > 60) split++;
            assert.ok(split > 500, `glitch shows no channel split (${split})`);
        }
        ok('glitch splits red and blue');
        const sl = render('speed-lines');
        {
            const f = frame(sl, 2.1);
            let bright = 0; for (let i = 0; i < f.length; i += 3) if (f[i] > 220 && f[i + 1] > 220 && f[i + 2] > 220) bright++;
            assert.ok(bright > 300, `no speed lines (${bright})`);
        }
        ok('speed lines are drawn over the cut');
        const zp = render('zoom-punch');
        assert.ok(diff(frame(zp, 1.9), frame(base, 1.9)) > 8, 'zoom punch changed nothing');
        for (const [file, t] of [[fl, 0.5], [wp, 1.0], [gl, 3.5], [zp, 0.3]]) {
            assert.ok(diff(frame(file, t), frame(base, t)) < 1.5, `${file} changed a frame outside its window`);
        }
        ok('frames outside the transition window are untouched');

        // ── 6. Template through the compositor ─────────────────────────────
        const seq = await TR.renderTemplateFrames({ kind: 'price-pop', params: { text: '42€' } }, { durationSec: 1.5, fps: 30, widthPx: 220, tmpDir: tmp, name: 'cmp' });
        const p = { version: 1, renderWidth: Wd, renderHeight: Hd, overlays: [{ id: 'o', clipId: 'o', zIndex: 1, outputStart: 1, outputEnd: 2.5, source: { type: 'template', template: { kind: 'price-pop', params: { text: '42€' } } },
            geometry: [{ t: 1, x: 0.2, y: 0.2, w: 220 / Wd, h: (220 * 300 / 680) / Hd, rotation: 0, opacity: 1, blur: 0 }] }] };
        const c = CC.compileCompositionPlan(p, [{ overlayId: 'o', inputIndex: 1 }]);
        const out = path.join(tmp, 'tpl.mp4');
        const rr = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', base, '-framerate', '30', '-start_number', '0', '-i', seq.pattern, '-filter_complex', c.filterComplex, '-map', `[${c.outputLabel}]`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out], { encoding: 'utf8' });
        assert.equal(rr.status, 0, rr.stderr);
        const yellow = (f) => { let n = 0; for (let y = Math.round(0.2 * Hd); y < Math.round(0.2 * Hd) + 97; y++) for (let x = 72; x < 72 + 220; x++) { const i = (y * Wd + x) * 3; if (f[i] > 200 && f[i + 1] > 180 && f[i + 2] < 90) n++; } return n; };
        assert.ok(yellow(frame(out, 1.8)) > 300, 'template not composited in its box');
        assert.ok(yellow(frame(out, 0.5)) < 20, 'template visible before its start');
        ok('a template composites in its box, only during its window');
    }
    fs.rmSync(tmp, { recursive: true, force: true });
}

// ── 7. Wiring ─────────────────────────────────────────────────────────────
{
    const ep = fs.readFileSync(path.join(ROOT, 'jobs/exportProcessor.js'), 'utf8');
    assert.ok(ep.indexOf('STEP 2.2: Transitions') > 0 && ep.indexOf('STEP 2.2: Transitions') < ep.indexOf('STEP 2.5: Composite overlay'));
    assert.ok(ep.includes("process.env.TRANSITIONS_DISABLED !== '1'") && ep.includes('transitionWarning'));
    assert.ok(ep.includes("ov.source?.type === 'template'") && ep.includes('renderTemplateFrames('));
    const vp = fs.readFileSync(path.join(ROOT, 'client/src/components/Player/VideoPlayer.jsx'), 'utf8');
    assert.ok(vp.includes("from '../../motion/TransitionFX.js'") && vp.includes('<TransitionLayer'));
    const go = fs.readFileSync(path.join(ROOT, 'client/src/components/Player/GraphicOverlay.jsx'), 'utf8');
    assert.ok(go.includes('<TemplateCanvas'));
    const fav = fs.readFileSync(path.join(ROOT, 'routes/favoritesRoutes.js'), 'utf8');
    for (const t of FX.TRANSITION_TYPES) assert.ok(fav.includes(`'${t}'`), `favorites refuse ${t}`);
}
ok('export, preview and favorites are wired to the shared modules');

log('\nALL TRANSITION + TEMPLATE CHECKS PASSED');
