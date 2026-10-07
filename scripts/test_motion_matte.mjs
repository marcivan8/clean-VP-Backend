// scripts/test_motion_matte.mjs
//
// R92 (round D): written motion + free background removal.
//   1. Easing: real springs, cubic-bezier, steps, safe fallbacks
//   2. MotionComposer: every verb compiles to valid animations; LLM output is sanitised
//   3. Rules director: briefs → beats (works with no AI)
//   4. compose_motion targets and the command end to end (route down → rules)
//   5. Shapes: new template kinds draw (Skia, same code as the export)
//   6. Matte settings: normalisation, alpha ramp, mask time, ffmpeg graph runs
//   7. Matte upload pack: parse + encode on the server route
//   8. Store: mask result contract, settings, layer target, one undo
//   9. Routing and static wiring (registry, LLM enum, export, Revideo fallback)
import { register, createRequire } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' });
const log = console.log; console.log = () => {}; console.warn = () => {}; console.info = () => {}; console.error = () => {};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const require = createRequire(import.meta.url);
let failures = 0;
const ok = (m) => log(`✓ ${m}`);
async function check(name, fn) {
    try { await fn(); ok(name); }
    catch (err) { failures += 1; log(`✗ ${name}\n    ${err.message}`); }
}

const E = await import('../client/src/motion/Easing.js');
const C = await import('../client/src/motion/MotionComposer.js');
const { resolveMotionAt } = await import('../client/src/motion/MotionResolver.js');
const G = await import('../client/src/motion/TemplateGraphics.js');
const M = await import('../client/src/motion/MatteSettings.js');
const T = await import('../client/src/agent/composeMotionTargets.js');
const R = await import('../client/src/agent/CommandRegistry.js');

// ── 1. Easing ────────────────────────────────────────────────────────────────
log('\n1 · Easing');
await check('springs start at 0, end exactly at 1, and the wobbly one overshoots', () => {
    for (const name of ['spring', 'springGentle', 'springWobbly', 'springStiff', 'springSlow', 'springSnappy', 'spring(300,20)']) {
        const f = E.resolveEasing(name);
        assert.equal(f(0), 0, name);
        assert.equal(f(1), 1, name);
        for (let i = 0; i <= 100; i++) assert.ok(Number.isFinite(f(i / 100)), `${name} finite`);
    }
    const w = E.resolveEasing('springWobbly');
    assert.ok(Math.max(...Array.from({ length: 101 }, (_, i) => w(i / 100))) > 1.05, 'wobbly overshoots');
    assert.notEqual(E.resolveEasing('spring'), E.EASING_FUNCTIONS.elastic, '"spring" is a real spring now, not the elastic alias');
});
await check('cubic-bezier matches the CSS "ease" curve; steps hold and jump', () => {
    const ease = E.resolveEasing('cubic-bezier(0.25, 0.1, 0.25, 1)');
    assert.ok(Math.abs(ease(0.5) - 0.8024) < 0.002, `ease(0.5)=${ease(0.5)}`);
    assert.deepEqual([0, 0.3, 0.6, 0.99, 1].map(E.resolveEasing('steps(4)')), [0, 0.25, 0.5, 0.75, 1]);
});
await check('unknown or malformed easings fall back to linear and are reported unknown', () => {
    for (const bad of ['nope', 'cubic-bezier(1,2)', 'spring(x,y)', '', null, 42]) {
        assert.equal(E.resolveEasing(bad)(0.3), 0.3);
        assert.equal(E.isKnownEasing(bad), false);
    }
    assert.ok(E.isKnownEasing('easeOutExpo') && E.isKnownEasing('ease-out-sine') && E.isKnownEasing('steps(3)'));
});
await check('the Revideo worker copy of Easing.js is in sync', () => {
    const body = read('render-worker/revideo/src/motion/Easing.js');
    assert.ok(body.includes(read('client/src/motion/Easing.js').trim()));
});

// ── 2. MotionComposer ────────────────────────────────────────────────────────
log('\n2 · Motion composer');
await check('every verb builds valid animations that resolve to finite values', () => {
    for (const verb of Object.keys(C.VERBS)) {
        const { animations, dropped } = C.composeMotion({ beats: [{ verb, at: 0.3, energy: 0.7 }] }, { duration: 4 });
        assert.ok(animations.length > 0, `${verb} built nothing (${dropped})`);
        assert.ok(animations.every(a => a.source === C.COMPOSED));
        for (let t = 0; t <= 4; t += 0.1) {
            const r = resolveMotionAt({ startTime: 0, duration: 4, x: 50, y: 50, scale: 1, rotation: 0, opacity: 1, animations }, t);
            for (const k of ['x', 'y', 'scale', 'rotation', 'opacity', 'blur', 'glow', 'reveal']) assert.ok(Number.isFinite(r[k]), `${verb} ${k} at ${t}`);
        }
    }
});
await check('entrances end at rest (scale 1, no offset, fully visible)', () => {
    for (const verb of Object.keys(C.VERBS).filter(v => C.VERBS[v].group === 'in')) {
        const { animations } = C.composeMotion({ beats: [{ verb }] }, { duration: 3 });
        const r = resolveMotionAt({ startTime: 0, duration: 3, x: 50, y: 50, scale: 1, rotation: 0, opacity: 1, animations }, 1.5);
        assert.ok(Math.abs(r.scale - 1) < 0.02 && Math.abs(r.x - 50) < 0.5 && Math.abs(r.y - 50) < 0.5 && r.opacity > 0.98 && r.blur < 0.5, `${verb} not at rest: ${JSON.stringify(r)}`);
    }
});
await check('exits are anchored to the end of the layer', () => {
    const { animations } = C.composeMotion({ beats: [{ verb: 'fade-in' }, { verb: 'fade-out' }] }, { duration: 5 });
    const layer = { startTime: 10, duration: 5, x: 50, y: 50, scale: 1, rotation: 0, opacity: 1, animations };
    assert.ok(resolveMotionAt(layer, 12.5).opacity > 0.99);
    assert.ok(resolveMotionAt(layer, 15).opacity < 0.02);
});
await check('LLM output is sanitised: unknown verbs dropped, values clamped, times kept in the clip', () => {
    const { animations, dropped } = C.composeMotion({
        beats: [{ verb: 'teleport' }, { verb: 'slam-in', energy: 9, at: -4, duration: 99 }],
        animations: [
            { keyframes: [{ time: 0, properties: { scale: 99, x: -999, hack: 1 } }, { time: 50, properties: { scale: 1 }, easing: 'evil()' }], easing: 'nope' },
            { keyframes: [{ time: 0, properties: {} }] },
            'garbage',
        ],
    }, { duration: 2 });
    assert.deepEqual(dropped, ['teleport']);
    for (const a of animations) {
        assert.ok(a.startTime >= 0 && a.startTime + a.duration <= 2 + 1e-6, 'inside clip');
        for (const k of a.keyframes) {
            assert.ok(k.time <= 2);
            if (k.properties.scale !== undefined) assert.ok(k.properties.scale <= 6);
            if (k.properties.x !== undefined) assert.ok(k.properties.x >= -120);
            assert.ok(!('hack' in k.properties));
        }
        assert.ok(E.isKnownEasing(a.easing));
    }
});
await check('video layers only get camera-style motion (no fades in or out)', () => {
    const { animations, dropped } = C.composeMotion({ beats: [{ verb: 'pop-in' }, { verb: 'punch', at: 1 }, { verb: 'push-in' }], animations: [{ keyframes: [{ time: 0, properties: { opacity: 0, scale: 1.2 } }, { time: 1, properties: { opacity: 1, scale: 1 } }] }] }, { duration: 3, kind: 'video' });
    assert.ok(dropped.some(d => d.startsWith('pop-in')));
    assert.ok(animations.length >= 2);
    assert.ok(animations.every(a => a.keyframes.every(k => !('opacity' in k.properties))));
});
await check('counts are capped', () => {
    const beats = Array.from({ length: 40 }, (_, i) => ({ verb: 'punch', at: i * 0.1 }));
    assert.ok(C.composeMotion({ beats }, { duration: 6 }).animations.length <= C.LIMITS.maxAnimations);
});

// ── 3. Rules director ────────────────────────────────────────────────────────
log('\n3 · Rules director (no AI)');
await check('briefs map to the named motions', () => {
    const verbs = b => C.planMotionFromBrief(b, { duration: 3 }).beats.map(x => x.verb);
    assert.deepEqual(verbs('make the title slam in then shake'), ['slam-in', 'shake']);
    assert.deepEqual(verbs('slide in from the left and fly out'), ['slide-in', 'fly-out']);
    assert.deepEqual(verbs('typewriter'), ['typewriter']);
    assert.deepEqual(verbs('elegant'), ['blur-in', 'breathe', 'fade-out']);
    assert.deepEqual(verbs('animate it'), ['slam-in', 'punch', 'whip-out']);
    assert.equal(C.planMotionFromBrief('slide in from the left').beats[0].direction, 'right');
});
await check('"subtle" lowers energy and "very" raises it', () => {
    const e = b => C.planMotionFromBrief(b).beats[0].energy;
    assert.ok(e('subtle pop') < e('pop') && e('pop') < e('very big pop'));
});

// ── 4. compose_motion targets + command ──────────────────────────────────────
log('\n4 · compose_motion');
const tracks = [
    { id: 'v1', type: 'video', name: 'V', clips: [{ id: 'vid', type: 'video', name: 'v', start: 0, duration: 10 }] },
    { id: 't1', type: 'text', name: 'T', clips: [
        { id: 'title', content: 'BIG NEWS', start: 0, duration: 3 },
        { id: 'caption-1', content: 'hello there', words: [{ text: 'hello' }], start: 1, duration: 1.2 },
        { id: 'caption-2', content: 'general kenobi', words: [{ text: 'general' }], start: 2.2, duration: 1.4 },
    ] },
    { id: 'o1', type: 'overlay', name: 'O', clips: [{ id: 'tpl', type: 'template', template: { kind: 'price-pop', params: { text: '15€' } }, start: 4, duration: 2 }] },
];
await check('targets follow the words, then the selection, then titles and graphics', () => {
    const ids = r => r.layers.map(l => l.clip.id).sort();
    assert.deepEqual(ids(T.pickMotionTargets(tracks, 'animate the captions so they pop in')), ['caption-1', 'caption-2']);
    assert.deepEqual(ids(T.pickMotionTargets(tracks, 'animate the title')), ['title']);
    assert.deepEqual(ids(T.pickMotionTargets(tracks, 'make it slam in', ['tpl'])), ['tpl']);
    assert.deepEqual(ids(T.pickMotionTargets(tracks, 'make it slam in')), ['title', 'tpl']);
    assert.deepEqual(ids(T.pickMotionTargets(tracks, 'animate everything')), ['caption-1', 'caption-2', 'title', 'tpl']);
});
await check('captions go to the LLM as one group, at most 12 layers', () => {
    const layers = T.pickMotionTargets(tracks, 'animate everything').layers;
    const out = T.layersForPrompt(layers);
    assert.equal(out.filter(l => l.id === T.CAPTION_GROUP).length, 1);
    assert.equal(out.length, 3);
    const many = Array.from({ length: 30 }, (_, i) => ({ clip: { id: `t${i}`, duration: 2 }, kind: 'text' }));
    assert.ok(T.layersForPrompt(many).length <= 12);
});

const { default: S } = await import('../client/src/store/useTimelineStore.js');
const tm = globalThis.timelineManager;
function loadTracks(list) {
    tm.fromLegacyTracks(JSON.parse(JSON.stringify(list)));
    S.setState({ tracks: tm.toLegacyTracks(), past: [], future: [], selectedClipIds: [], editingStyle: null });
}
const { MediaExecutionEngine } = await import('../client/src/agent/MediaExecutionEngine.js').catch(async () => ({ MediaExecutionEngine: (await import('../client/src/agent/MediaExecutionEngine.js')).default }));
await check('the command animates the targets with the rules director when the motion route is down, as one undo', async () => {
    loadTracks(tracks);
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('offline'); };
    try {
        const engine = typeof MediaExecutionEngine === 'function' ? new MediaExecutionEngine() : MediaExecutionEngine;
        const before = S.getState().past.length;
        const res = await engine.executeStoreAction({ action: 'compose_motion', args: { brief: 'make the title slam in then shake' } }, null);
        assert.equal(res.success, true, res.message);
        assert.match(res.message, /built from the motion library/);
        const title = S.getState().tracks.find(t => t.id === 't1').clips.find(c => c.id === 'title');
        assert.ok(title.animations.length >= 2 && title.animations.every(a => a.source === 'composed'));
        assert.ok(title.animations.some(a => a.presetId === 'composed:slam-in'));
        assert.equal(S.getState().past.length - before, 1, 'one history step');
    } finally {
        globalThis.fetch = realFetch;
    }
});

// ── 5. Shapes ────────────────────────────────────────────────────────────────
log('\n5 · Shapes');
await check('shape kinds are registered with defaults, sizes and widths', () => {
    for (const k of G.SHAPE_KINDS) {
        assert.ok(G.TEMPLATE_KINDS.includes(k));
        assert.ok(G.TEMPLATE_DEFAULTS[k] && G.TEMPLATE_WIDTH_FRACTION[k] > 0);
        const s = G.templateSize(k, {});
        assert.ok(s.w > 0 && s.h > 0);
    }
});
await check('requests name the right shape (and counters still work)', () => {
    const k = t => G.templateFromText(t)?.kind;
    assert.equal(k('add a bar chart 20, 45, 80'), 'bar-chart');
    assert.equal(G.templateFromText('add a bar chart 20, 45, 80').params.values, '20,45,80');
    assert.equal(G.templateFromText('add an arrow pointing down').params.direction, 'down');
    assert.equal(G.templateFromText('progress bar 80%').params.value, 80);
    assert.equal(k('circle it'), 'circle-callout');
    assert.equal(k('add a counter day 14 of 30'), 'counter');
    assert.equal(k('price pop 15€'), 'price-pop');
    assert.equal(k('a paragraph of text'), undefined);
});
let Canvas = null;
try { Canvas = require('@napi-rs/canvas'); } catch { /* optional */ }
await check('every shape draws pixels that change over time (Skia, the export renderer)', () => {
    if (!Canvas) { log('    (skipped: @napi-rs/canvas not installed here)'); return; }
    for (const k of G.SHAPE_KINDS) {
        const { w, h } = G.templateSize(k, {});
        const frame = t => { const c = Canvas.createCanvas(w, h); G.drawTemplate(c.getContext('2d'), k, {}, t, 3); return c.getContext('2d').getImageData(0, 0, w, h).data; };
        const a = frame(0.1), b = frame(1.2);
        let lit = 0, diff = 0;
        for (let i = 3; i < b.length; i += 4) { if (b[i] > 100) lit++; if (Math.abs(a[i] - b[i]) > 40) diff++; }
        assert.ok(lit > 50, `${k} draws nothing`);
        assert.ok(diff > 20, `${k} does not animate`);
        const end = frame(3);
        let endLit = 0; for (let i = 3; i < end.length; i += 4) if (end[i] > 100) endLit++;
        assert.equal(endLit, 0, `${k} should be gone at the end`);
    }
});

// ── 6. Matte settings ────────────────────────────────────────────────────────
log('\n6 · Matte settings');
await check('settings are normalised and image mode without an image falls back to blur', () => {
    const n = M.normalizeMatte({ mode: 'image', blur: 999, feather: -3, threshold: 2, color: 'red' });
    assert.equal(n.mode, 'blur');
    assert.equal(n.blur, 60);
    assert.equal(n.feather, 0);
    assert.equal(n.threshold, 0.95);
    assert.equal(n.color, M.MATTE_DEFAULTS.color);
    assert.equal(M.normalizeMatte(null).mode, 'blur');
});
await check('the alpha ramp is monotonic and spans 0..255', () => {
    const ramp = M.alphaRamp({ threshold: 0.5, softness: 0.4 });
    let prev = -1;
    for (let l = 0; l < 256; l++) { const a = M.lumaToAlpha(l, ramp); assert.ok(a >= prev); prev = a; }
    assert.equal(M.lumaToAlpha(0, ramp), 0);
    assert.equal(M.lumaToAlpha(255, ramp), 255);
});
await check('mask time follows trim and speed', () => {
    const clip = { start: 10, offset: 4, speed: 2, layerMask: { sourceStart: 3 } };
    assert.equal(M.maskTimeFor(clip, 10), 1);
    assert.equal(M.maskTimeFor(clip, 11), 3);
});
let hasFfmpeg = false;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); hasFfmpeg = true; } catch { /* optional */ }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r92-'));
await check('the export filter graph runs in ffmpeg for every mode, with speed', () => {
    if (!hasFfmpeg) { log('    (skipped: ffmpeg not installed here)'); return; }
    const src = path.join(tmp, 'src.mp4'), mask = path.join(tmp, 'mask.mp4'), img = path.join(tmp, 'bg.png');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:d=2:r=15', '-pix_fmt', 'yuv420p', src]);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', "color=c=black:s=160x90:d=1:r=15,geq=lum='if(lt(hypot(X-80\\,Y-45)\\,30)\\,255\\,0)':cb=128:cr=128", '-pix_fmt', 'yuv420p', mask]);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x36:d=1', '-frames:v', '1', img]);
    for (const mode of M.MATTE_MODES) {
        const graph = M.matteFilterGraph({ mode, imageUrl: 'x' }, { width: 320, height: 180, speed: mode === 'dim' ? 1.5 : 1 }).join(';');
        const out = path.join(tmp, `out-${mode}.mp4`);
        const args = ['-y', '-loglevel', 'error', '-i', src, '-i', mask];
        if (mode === 'image') args.push('-loop', '1', '-i', img);
        args.push('-filter_complex', graph, '-map', '[outv]', '-t', '1.5', out);
        execFileSync('ffmpeg', args);
        const frames = Number(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', out]).toString().trim());
        // The mask is only 1 s long; tpad holds its last frame, so the picture is not cut short.
        assert.ok(frames >= 20, `${mode}: only ${frames} frames`);
    }
});

// ── 7. Matte upload pack ─────────────────────────────────────────────────────
log('\n7 · Matte upload');
function stubModule(rel, exportsObj) {
    const p = require.resolve(path.join(ROOT, rel));
    require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj };
}
stubModule('middleware/auth.js', { authenticateUser: (q, s, n) => n(), optionalAuth: (q, s, n) => n() });
stubModule('middleware/usageGate.js', { aiGate: (q, s, n) => n() });
stubModule('config/storage.js', { bucket: null, useLocalStorage: true });
stubModule('queue/queues.js', { visionQueue: { add: async () => ({ id: 1 }) } });
stubModule('services/ReplicateSAM2Service.js', function ReplicateSAM2Service() {});
stubModule('services/AIProvider.js', { getAIClient: () => { throw new Error('no ai'); }, isAIConfigured: () => false, resolveModel: m => m, resolveProvider: () => 'mock' });
const vision = require(path.join(ROOT, 'routes/objectIntelligenceRoutes.js'));
function pack({ w = 32, h = 18, fps = 10, frames = 5, bad } = {}) {
    const header = Buffer.from(JSON.stringify({ v: 1, width: w, height: h, fps, frames, sourceStart: 2, sourceDuration: frames / fps }));
    const len = Buffer.alloc(4); len.writeUInt32LE(header.length, 0);
    const body = Buffer.alloc(w * h * frames, 200);
    return zlib.gzipSync(Buffer.concat([len, header, bad ? body.subarray(1) : body]));
}
await check('a valid pack parses; bad packs are refused with a clear message', () => {
    const p = vision.parseMattePack(pack());
    assert.equal(p.width, 32); assert.equal(p.frames, 5); assert.equal(p.sourceStart, 2);
    assert.throws(() => vision.parseMattePack(Buffer.from('nope')), /gzip/);
    assert.throws(() => vision.parseMattePack(pack({ bad: true })), /do not match/);
    assert.throws(() => vision.parseMattePack(pack({ w: 33 })), /even/);
    assert.throws(() => vision.parseMattePack(pack({ fps: 0 })), /fps/);
});
await check('the pack encodes to a playable mask video', async () => {
    if (!hasFfmpeg) { log('    (skipped: ffmpeg not installed here)'); return; }
    const out = path.join(tmp, 'mask-enc.mp4');
    const ffmpeg = require('fluent-ffmpeg');
    ffmpeg.setFfmpegPath('ffmpeg');
    await vision.encodeMaskVideo(vision.parseMattePack(pack({ w: 64, h: 36, frames: 10 })), out);
    const n = Number(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', out]).toString().trim());
    assert.equal(n, 10);
});
const motion = require(path.join(ROOT, 'server/routes/motionRoutes.js'));
await check('the motion prompt carries the vocabulary, the limits and the calm-style rule', async () => {
    const composer = await motion.loadComposer();
    const layers = motion.cleanLayers([{ id: 'a', kind: 'text', duration: 2, content: 'HELLO' }, { kind: 'text' }, { id: 'b', kind: 'weird', duration: 9999 }]);
    assert.equal(layers.length, 2);
    assert.equal(layers[1].kind, 'text');
    assert.equal(layers[1].duration, 600);
    const p = motion.buildMotionPrompt({ brief: 'punchy', layers, catalog: composer.verbCatalog(), editingStyle: 'podcast' });
    for (const v of Object.keys(composer.VERBS)) assert.ok(p.includes(`- ${v} (`), v);
    assert.match(p, /restrained/);
    assert.match(p, /springSnappy/);
    assert.doesNotMatch(motion.buildMotionPrompt({ brief: 'x', layers, catalog: [], editingStyle: 'reel' }), /restrained/);
});

// ── 8. Store ─────────────────────────────────────────────────────────────────
log('\n8 · Store');
await check('the mask result is accepted under both names, with its path, range and settings', () => {
    loadTracks([{ id: 'v1', type: 'video', name: 'V', clips: [{ id: 'c1', type: 'video', name: 'c', start: 0, duration: 5, offset: 1 }] }]);
    const st = S.getState();
    assert.equal(st.applyLayerSeparation('v1', 'c1', {}).success, false);
    assert.equal(st.applyLayerSeparation('v1', 'c1', { maskSignedUrl: 'https://x/m.mp4', bboxTrack: [{ t: 1, cx: 0.5, cy: 0.5, w: 0.3, h: 0.6 }] }).success, true, 'SAM2 result shape now applies');
    assert.equal(S.getState().applyLayerSeparation('v1', 'c1', { maskAssetPath: 'masks/u/m.mp4', maskAssetUrl: 'https://x/m2.mp4', sourceStart: 1, sourceDuration: 5, fps: 12, bboxTrack: [] }).success, true);
    const lm = S.getState().tracks[0].clips[0].layerMask;
    assert.equal(lm.maskAssetPath, 'masks/u/m.mp4');
    assert.equal(lm.sourceStart, 1);
    assert.equal(lm.settings.mode, 'blur');
});
await check('settings change in one step and the layer target needs a mask', () => {
    const st = S.getState();
    assert.equal(st.setLayerTarget('v1', 'c1', 'background').success, true);
    const r = S.getState().setMatteSettings('v1', 'c1', { mode: 'color', color: '#00b140', blur: 500 });
    assert.equal(r.success, true);
    assert.equal(S.getState().tracks[0].clips[0].layerMask.settings.color, '#00b140');
    assert.equal(S.getState().tracks[0].clips[0].layerMask.settings.blur, 60);
    loadTracks([{ id: 'v1', type: 'video', name: 'V', clips: [{ id: 'c2', type: 'video', name: 'c', start: 0, duration: 5 }] }]);
    assert.equal(S.getState().setLayerTarget('v1', 'c2', 'background').success, false);
    assert.equal(S.getState().setMatteSettings('v1', 'c2', { mode: 'dim' }).success, false);
});
await check('layerMask (with settings) survives save and reload', () => {
    const tsm = read('client/src/timeline/TimelineStateManager.js');
    assert.match(tsm, /layerMask: clip\.layerMask \?\? null/);
    assert.match(tsm, /layerMask: legacyClip\.layerMask \?\? null/);
});

// ── 9. Routing + wiring ──────────────────────────────────────────────────────
log('\n9 · Routing and wiring');
await check('chat phrases reach the new commands and "animate it" still auto-animates', () => {
    const id = t => R.resolveCommand(t).match?.id;
    assert.equal(id('animate it'), 'animate_automatically');
    assert.equal(id('animate'), 'animate_automatically');
    assert.equal(id('animate the title so it slams in'), 'compose_motion');
    assert.equal(id('elegant animation on the text'), 'compose_motion');
    assert.equal(id('make the title fade in'), 'compose_motion');
    assert.equal(id('fade out'), 'add_transition');
    assert.equal(id('remove the background'), 'remove_background');
    assert.equal(id('blur the background'), 'remove_background');
    assert.equal(id('remove the background music'), undefined);
    assert.equal(id('zoom to the speaker'), 'zoom_speaker');
    assert.equal(id('track the speaker'), 'track_speaker');
    assert.equal(id('add a bar chart'), 'add_template');
});
const { backgroundFromText } = await import('../client/src/agent/EditPlanner.js');
await check('the background look comes from the words', () => {
    assert.deepEqual(backgroundFromText('blur the background'), { mode: 'blur', all: false });
    assert.equal(backgroundFromText('replace the background with black').color, '#000000');
    assert.equal(backgroundFromText('green screen').color, '#00b140');
    assert.equal(backgroundFromText('dim the background').mode, 'dim');
    assert.equal(backgroundFromText('remove the background on all clips').all, true);
    assert.equal(backgroundFromText('remove the background').mode, 'color');
});
await check('engine, compiler, planner, LLM enum and UI are wired', () => {
    const mee = read('client/src/agent/MediaExecutionEngine.js');
    for (const c of ['compose_motion', 'remove_background', 'separate_speaker', 'zoom_speaker', 'track_speaker', 'blur_background']) assert.ok(mee.includes(`case '${c}'`), c);
    assert.match(mee, /case 'separate_speaker'[\s\S]{0,400}_ensureMatte/);
    assert.doesNotMatch(mee, /\/api\/vision\/separate-speaker/, 'the paid SAM2 path is no longer called');
    const comp = read('client/src/agent/CommandCompiler.js');
    for (const c of ['compose_motion', 'remove_background', 'zoom_speaker', 'track_speaker']) assert.ok(comp.includes(`['${c}'`), c);
    const ai = read('controllers/aiAgentController.js');
    assert.match(ai, /"compose_motion", "remove_background"/);
    assert.match(read('index.js'), /app\.use\('\/api\/motion', aiLimiter, require\('\.\/server\/routes\/motionRoutes'\)\)/);
    assert.match(read('client/src/components/MotionPanel.jsx'), /<MotionDirectorPanel/);
    assert.match(read('client/src/components/MotionPanel.jsx'), /<BackgroundPanel/);
});
await check('export uses the stored mask, the shared graph, and fails open', () => {
    const exp = read('jobs/exportProcessor.js');
    assert.match(exp, /async function renderMattedSegment/);
    assert.match(exp, /matteFilterGraph/);
    assert.match(exp, /fetchMaskToLocal\(clip\.layerMask/);
    assert.match(exp, /offset - \(Number\(clip\.layerMask\?\.sourceStart\) \|\| 0\)/);
    assert.match(exp, /exporting it unchanged/);
});
await check('Revideo: health is checked first and captions fall back instead of disappearing', () => {
    const exp = read('jobs/exportProcessor.js');
    assert.match(exp, /useRevideo && !\(await revideoWorkerHealthy\(\)\)/);
    assert.match(exp, /textTracks\.length > 0 && !revideoSucceeded/);
});
await check('user-facing copy has no em dashes', () => {
    for (const lang of ['en', 'fr']) {
        const d = JSON.parse(read(`client/src/locales/${lang}/editor.json`));
        const text = JSON.stringify([d.motionDirector, d.backgroundPanel, d.templates]);
        assert.doesNotMatch(text, /—/, lang);
    }
});

fs.rmSync(tmp, { recursive: true, force: true });
log(failures ? `\n${failures} FAILURE(S)` : '\nALL MOTION + MATTE CHECKS PASSED');
process.exit(failures ? 1 : 0);
