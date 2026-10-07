// scripts/test_round_c.mjs
//
// R92 round C:
//   1. Caption parity: every text clip is drawn like the preview (wrap, weight,
//      italic, align, shadow, stroke, defaults); the image renderer synthesises bold/italic
//   2. Snapping guides while dragging (centre, thirds, margins, other elements), no first-drag jump
//   3. Pro short finish: hook title with written motion, captions, camera, pops, transitions,
//      pop-out, sounds; the finisher; the AI plan; "pro finish" on the main edit
import { register, createRequire } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' });
const log = console.log; console.log = () => {}; console.warn = () => {}; console.info = () => {}; console.error = () => {};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const require = createRequire(import.meta.url);
let failures = 0;
async function check(name, fn) {
    try { await fn(); log(`✓ ${name}`); }
    catch (err) { failures += 1; log(`✗ ${name}\n    ${err.message}`); }
}

const CC = await import('../client/src/motion/CaptionCompiler.js');
const SG = await import('../client/src/motion/SnapGuides.js');
const SPo = await import('../client/src/agent/shortPolish.js');
const SF = await import('../client/src/agent/shortFinisher.js');
const PP = await import('../client/src/agent/PlatformProfiles.js');
const { resolveMotionAt } = await import('../client/src/motion/MotionResolver.js');
const { clipToMotionLayer } = await import('../client/src/motion/ClipAdapter.js');

// ── 1. Caption parity ────────────────────────────────────────────────────────
log('\n1 · Caption parity');
const base = { id: 'v', type: 'video', clips: [{ id: 'b', start: 0, duration: 4, offset: 0 }] };
await check('a plain caption is drawn by the image renderer with the preview\'s box and defaults', () => {
    const p = CC.buildCaptionProgram([base, { id: 't', type: 'text', clips: [{ id: 'c', content: 'Hello there world', start: 0, duration: 2 }] }], base.clips);
    assert.equal(p.entries.length, 1);
    const e = p.entries[0];
    assert.ok(e.raster, 'raster');
    assert.equal(e.style.color, '#ffffff');
    assert.equal(e.style.fontFamily, 'Inter');
    assert.equal(e.raster.layout.widthFrac, 0.8);
});
await check('weight, italic, alignment and the full shadow travel to the export', () => {
    const p = CC.buildCaptionProgram([base, { id: 't', type: 'text', clips: [{ id: 'c', content: 'Hi', start: 0, duration: 2, fontWeight: 800, fontStyle: 'italic', textAlign: 'left', textShadow: '0 2px 4px #000, 0 0 12px #f0f' }] }], base.clips);
    const r = p.entries[0].raster;
    assert.equal(r.font.weight, 800);
    assert.equal(r.font.style, 'italic');
    assert.equal(r.layout.align, 'left');
    assert.match(r.textShadow, /12px #f0f/);
});
await check('the image renderer synthesises bold and italic, white by default', () => {
    const src = read('server/compositor/RasterCaptionCompiler.js');
    assert.match(src, /const synthBold = weight === 'bold' \|\| weight === 'bolder' \|\| Number\(weight\) >= 600;/);
    assert.match(src, /ctx\.transform\(1, 0, -0\.21, 1, 0\.21 \* w\.baseline, 0\)/);
    assert.match(src, /const baseColor = cssColor\(entry\.style\.color, '#FFFFFF'\)/);
});
let Canvas = null;
try { Canvas = require('@napi-rs/canvas'); } catch { /* optional */ }
await check('bold and italic actually change the rendered pixels (Skia)', () => {
    if (!Canvas) { log('    (skipped: @napi-rs/canvas not installed here)'); return; }
    const R = require(path.join(ROOT, 'server/compositor/RasterCaptionCompiler.js'));
    const fontsDir = path.join(ROOT, 'client/public/fonts');
    const render = (extra) => {
        const p = CC.buildCaptionProgram([base, { id: 't', type: 'text', clips: [{ id: 'c', content: 'Parity test', start: 0, duration: 2, fontSize: 64, fontFamily: 'Inter', ...extra }] }], base.clips);
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r92c-'));
        const res = R.prepareRasterCaptions(R.rasterEntries(p), { tmpDir: tmp, frameWidth: 1080, frameHeight: 1920, pxScale: 1,
            fallbackFontPath: path.join(fontsDir, 'Anton-Regular.ttf'), resolveFont: () => path.join(fontsDir, 'Inter-Regular.ttf') });
        const png = fs.readdirSync(tmp).find(f => f.endsWith('.png'));
        assert.ok(png && res.items.length === 1, 'rendered');
        return fs.readFileSync(path.join(tmp, png));
    };
    const plain = render({});
    assert.notEqual(Buffer.compare(plain, render({ fontWeight: 'bold' })), 0, 'bold differs');
    assert.notEqual(Buffer.compare(plain, render({ fontStyle: 'italic' })), 0, 'italic differs');
});

// ── 2. Snapping ──────────────────────────────────────────────────────────────
log('\n2 · Snapping guides');
await check('snaps to the frame centre within a few pixels, not beyond', () => {
    const near = SG.computeSnap({ x: 50.6, y: 30, w: 20, h: 5 }, { frameW: 600, frameH: 1000, aspectRatio: '9:16' });
    assert.equal(near.x, 50);
    assert.ok(near.guides.some(g => g.axis === 'x' && g.kind === 'center'));
    const far = SG.computeSnap({ x: 53, y: 30, w: 20, h: 5 }, { frameW: 600, frameH: 1000, aspectRatio: '9:16' });
    assert.equal(far.x, 53);
});
await check('an edge lines up with another element\'s edge', () => {
    const r = SG.computeSnap({ x: 40.5, y: 70, w: 20, h: 4 }, { frameW: 600, frameH: 1000, others: [{ id: 'o', x: 60, y: 20, w: 40, h: 6 }] });
    // left edge 30.5 → other's left edge 40? no; right edge 50.5 → frame centre 50 or other's... expect a snap on x
    assert.ok(r.guides.some(g => g.axis === 'x'));
    const r2 = SG.computeSnap({ x: 30.4, y: 70, w: 20, h: 4 }, { frameW: 600, frameH: 1000, others: [{ id: 'o', x: 50, y: 20, w: 40, h: 6 }] });
    assert.equal(r2.x, 30, 'left edge 20.4 snaps to the other element\'s left edge 30 - 10');
    assert.equal(r2.guides.find(g => g.axis === 'x').kind, 'element');
});
await check('vertical frames snap to the platform safe zone; Alt disables snapping', () => {
    assert.equal(SG.computeSnap({ x: 50, y: 72.4, w: 10, h: 0 }, { frameW: 600, frameH: 1000, aspectRatio: '9:16' }).y, 72);
    const off = SG.computeSnap({ x: 50.6, y: 72.4 }, { frameW: 600, frameH: 1000, aspectRatio: '9:16', disabled: true });
    assert.deepEqual([off.x, off.y, off.guides.length], [50.6, 72.4, 0]);
});
await check('the drag starts where the element is drawn ("bottom" caption at 85 %), so it never jumps', () => {
    assert.deepEqual(SG.startPosition({ position: 'bottom' }), { x: 50, y: 85 });
    assert.deepEqual(SG.startPosition({ position: 'top' }), { x: 50, y: 12 });
    assert.deepEqual(SG.startPosition({ x: 20, y: 30 }), { x: 20, y: 30 });
    assert.deepEqual(SG.startPosition({ x: 20 }), { x: 50, y: 50 }, 'one axis only: same rule as the preview');
    const layer = clipToMotionLayer({ id: 'c', position: 'bottom', start: 0, duration: 1 }, { type: 'text' });
    assert.equal(layer.y, SG.startPosition({ position: 'bottom' }).y, 'matches what the preview draws');
});
await check('text and graphic drags snap, show guides, clear them on release; guides layer mounted', () => {
    for (const f of ['client/src/components/Player/TextOverlay.jsx', 'client/src/components/Player/GraphicOverlay.jsx']) {
        const src = read(f);
        assert.match(src, /computeSnap\(/, f);
        assert.match(src, /useSnapGuides\.getState\(\)\.setGuides/, f);
        assert.match(src, /useSnapGuides\.getState\(\)\.clear\(\)/, f);
        assert.match(src, /data-snap-id=\{clip\.id\}/, f);
        assert.match(src, /disabled: e\.altKey/, f);
    }
    assert.match(read('client/src/components/Player/TextOverlay.jsx'), /const startPos {6}= startPosition\(clip\);/);
    assert.match(read('client/src/layouts/IDELayout.jsx'), /<SnapGuidesLayer \/>/);
});

// ── 3. Pro short finish ──────────────────────────────────────────────────────
log('\n3 · Pro short finish');
const W = (text, step = 0.4, t0 = 0) => text.split(' ').map((w, i) => ({ word: w, start: t0 + i * step, end: t0 + i * step + 0.3 }));
await check('headlines, numbers and key words', () => {
    assert.equal(SPo.headlineFromText('so the reason most people fail at saving money is simple'), 'REASON MOST PEOPLE FAIL AT SAVING');
    assert.deepEqual(SPo.spokenNumbers(W('we went from 200 dollars to 45 percent in 2 months and then 900 more', 1)).map(n => n.text), ['$200', '900']);
    assert.deepEqual(SPo.emphasisIndices('we grew revenue by 300% this year with automation'), [2, 4]);
    assert.deepEqual(SPo.emphasisIndices('it is so so', ['so']), [], 'stop words are never emphasised');
});
const SHORT = { duration: 20, aspectRatio: '9:16', tracks: [
    { id: 'v', type: 'video', clips: [
        { id: 'a', type: 'video', start: 0, duration: 8, offset: 0, layerMask: { maskAssetPath: 'masks/u/m.mp4', sourceStart: 0, sourceDuration: 60 } },
        { id: 'b', type: 'video', start: 8, duration: 12, offset: 30 },
    ] },
    { id: 't', type: 'text', clips: [{ id: 'caption-1', content: 'we grew revenue by 300% this year', start: 1, duration: 2, words: [{ word: 'we', start: 1, end: 1.2 }] }] },
] };
const WORDS = W('here is how we grew revenue by 300 percent in one year with one simple change', 0.45);
await check('every layer is added, tuned per platform, and the input is not changed', () => {
    const before = JSON.stringify(SHORT);
    const r = SPo.polishShort(SHORT, PP.PLATFORM_PROFILES.tiktok, { words: WORDS, events: [{ eventType: 'REVEAL', timelineTime: 5 }], popOut: true });
    assert.equal(JSON.stringify(SHORT), before, 'input untouched');
    assert.deepEqual(r.applied.map(a => a.split(' (')[0]), ['hook title', 'captions', 'camera moves', 'number pops', 'transitions', 'speaker pop-out']);
    const title = r.tracks.find(t => t.id === 'track-short-title').clips[0];
    assert.equal(title.content, 'HOW WE GREW REVENUE BY 300');
    assert.ok(title.animations.some(a => a.presetId === 'composed:slam-in') && title.animations.some(a => a.anchor === 'out'));
    assert.ok(title.y > PP.PLATFORM_PROFILES.tiktok.safeZone.top * 100, 'title below the top UI');
    const gfx = r.tracks.find(t => t.id === 'track-short-graphics').clips;
    assert.ok(gfx.some(c => c.template.kind === 'underline') && gfx.some(c => c.template.kind === 'price-pop'));
    const cap = r.tracks.find(t => t.id === 't').clips[0];
    assert.equal(cap.y, PP.PLATFORM_PROFILES.tiktok.captionY);
    assert.deepEqual(cap.emphasis.indices, [2, 4]);
    const vids = r.tracks.find(t => t.id === 'v').clips;
    assert.ok(vids.every(c => c.animations?.some(a => a.presetId === 'composed:push-in')));
    assert.ok(vids[0].animations.some(a => a.presetId === 'composed:punch'), 'punch-in on the reveal at 5 s');
    assert.ok(vids.every(c => c.animations.every(a => a.keyframes.every(k => !('opacity' in k.properties)))), 'camera never fades the video');
    assert.equal(vids[0].transition?.type ? 1 : 0 + (vids[1].transition ? 1 : 0), 1, 'the cut gets a transition, the last clip none');
    assert.equal(vids[0].layerTarget, 'background');
    assert.equal(vids[0].layerMask.settings.mode, 'dim');
    assert.ok(!vids[1].layerTarget, 'no mask → no pop-out');
});
await check('the look differs per platform; an AI headline and keywords win', () => {
    const reels = SPo.polishShort(SHORT, PP.PLATFORM_PROFILES.reels, { words: WORDS, plan: { headline: 'The one change that tripled us', keywords: ['year'] } });
    const title = reels.tracks.find(t => t.id === 'track-short-title').clips[0];
    assert.equal(title.content, 'The one change that tripled us', 'Reels keeps sentence case');
    assert.equal(title.fontFamily, 'Montserrat');
    assert.ok(title.animations.some(a => a.presetId === 'composed:blur-in'));
    assert.ok(reels.tracks.find(t => t.id === 't').clips[0].emphasis.indices.includes(5), '"year" from the AI keywords');
});
await check('the title\'s motion resolves cleanly over its life', () => {
    const r = SPo.polishShort(SHORT, PP.PLATFORM_PROFILES.shorts, { words: WORDS });
    const title = r.tracks.find(t => t.id === 'track-short-title').clips[0];
    const layer = clipToMotionLayer(title, { type: 'text' });
    const mid = resolveMotionAt(layer, title.duration * 0.4);
    assert.ok(mid.opacity > 0.95 && Math.abs(mid.scale - 1) < 0.3, JSON.stringify(mid));
    assert.ok(resolveMotionAt(layer, title.duration).opacity < 0.05, 'gone at the end');
});
await check('layers can be switched off', () => {
    const r = SPo.polishShort(SHORT, PP.PLATFORM_PROFILES.tiktok, { words: WORDS, layers: { title: false, numbers: false, camera: false, cuts: false } });
    assert.deepEqual(r.applied.map(a => a.split(' (')[0]), ['captions']);
});

const { default: S } = await import('../client/src/store/useTimelineStore.js');
const tm = globalThis.timelineManager;
function loadTracks(list, extra = {}) {
    tm.fromLegacyTracks(JSON.parse(JSON.stringify(list)));
    S.setState({ tracks: tm.toLegacyTracks(), past: [], future: [], selectedClipIds: [], editingStyle: null, currentTime: 0, shorts: [],
        uploadedFile: { name: 'IMG.MOV' }, assets: [{ id: 'a', type: 'video', name: 'IMG.MOV', duration: 120, resolution: { w: 1920, h: 1080 } }], captions: [], ...extra });
}
const MAIN = [
    { id: 'track-default-video', type: 'video', name: 'V', clips: [{ id: 'v1', assetId: 'a', type: 'video', name: 'IMG.MOV', start: 0, duration: 120, offset: 0, speed: 1 }] },
    { id: 'track-text', type: 'text', name: 'Captions', clips: [{ id: 'caption-9', content: 'we grew revenue by 300 percent', start: 40, duration: 2, words: [{ word: 'we', start: 40, end: 40.3 }] }] },
];
const LONG_WORDS = W('here is how we grew revenue by 300 percent in one year with one simple change and you can do it too', 0.45, 38);
await check('the finisher: own 9:16 timeline, AI plan, polish and sounds on the short only', async () => {
    loadTracks(MAIN, { captions: LONG_WORDS });
    const before = JSON.stringify(S.getState().tracks);
    const asset = { id: 's', name: 'whoosh', preview_url: 'https://cdn.example/w.mp3', duration: 0.6, recommended_volume: 0.8 };
    const r = await SF.finishShort(S.getState(), { id: 's1', platform: 'tiktok', start: 38, end: 62, events: [{ eventType: 'REVEAL', timelineTime: 45 }] },
        { fetchPlan: async () => ({ headline: 'How we tripled revenue', keywords: ['revenue'] }), fetchAsset: async () => asset });
    assert.equal(JSON.stringify(S.getState().tracks), before, 'main edit untouched');
    assert.equal(r.aspectRatio, '9:16');
    assert.ok(r.applied[0] === 'AI headline' && r.applied.some(a => a.startsWith('sound effects')));
    assert.equal(r.tracks.find(t => t.id === 'track-short-title').clips[0].content, 'HOW WE TRIPLED REVENUE');
    const v = r.tracks.find(t => t.id === 'track-default-video').clips[0];
    assert.ok(v.virtualCam?.reframe === '9:16', '9:16 speaker crop');
    assert.ok(v.animations.some(a => a.presetId === 'composed:punch'), 'punch on the reveal (moved into short time)');
    assert.equal(r.words[0].start, 0.15, 'words moved into short time (0.15 s lead-in pad)');
    const sfx = r.tracks.find(t => t.id === 'track-short-sfx').clips;
    assert.ok(sfx.length >= 2 && sfx.every(c => c.isSFX && c.url));
});
await check('the finisher with polish off is just the clean 9:16 cut', async () => {
    loadTracks(MAIN, { captions: LONG_WORDS });
    const r = await SF.finishShort(S.getState(), { id: 's1', platform: 'reels', start: 38, end: 62 }, { polish: false });
    assert.deepEqual(r.applied, []);
    assert.ok(!r.tracks.some(t => t.id === 'track-short-title'));
});
const { MediaExecutionEngine } = await import('../client/src/agent/MediaExecutionEngine.js');
const engine = new MediaExecutionEngine();
await check('"pro finish" on the main edit: one undo, a re-run replaces instead of stacking', async () => {
    loadTracks(MAIN, { captions: LONG_WORDS, editingStyle: 'reel' });
    const before = S.getState().past.length;
    const r = await engine.executeStoreAction({ action: 'polish_short', args: { brief: 'pro finish' } }, null);
    assert.equal(r.success, true, r.message);
    assert.match(r.message, /Finished for Instagram Reels/);
    const count = () => S.getState().tracks.flatMap(t => t.clips).filter(c => String(c.clipId || c.id).startsWith('short-')).length;
    const n1 = count();
    assert.ok(n1 >= 2, `title + underline added (${n1})`);
    assert.ok(S.getState().past.length > before);
    await engine.executeStoreAction({ action: 'polish_short', args: { brief: 'pro finish for tiktok' } }, null);
    assert.equal(count(), n1, 'replaced, not stacked');
    const vid = S.getState().tracks.find(t => t.type === 'video').clips[0];
    assert.ok(vid.animations.some(a => a.presetId === 'composed:push-in'));
});
const R = await import('../client/src/agent/CommandRegistry.js');
await check('"pro finish" / "add a hook title" reach the command; Reel Auto ends with it', async () => {
    for (const t of ['pro finish', 'add a hook title', 'make it look professional', 'finish it for tiktok', 'finition pro']) assert.equal(R.resolveCommand(t).match?.id, 'polish_short', t);
    const ES = await import('../client/src/agent/EditingStyles.js');
    assert.equal(ES.buildAutopilotSteps('reel', 'edit it', { hasTranscript: true }).at(-1).prompt, 'Pro finish');
});
await check('the AI short plan: prompt and clean-up', () => {
    const stub = (rel, exp) => { const p = require.resolve(path.join(ROOT, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exp }; };
    stub('middleware/auth.js', { authenticateUser: (q, s, n) => n(), optionalAuth: (q, s, n) => n() });
    stub('services/AIProvider.js', { getAIClient: () => { throw new Error('x'); }, isAIConfigured: () => false, resolveModel: m => m, resolveProvider: () => 'mock' });
    const M = require(path.join(ROOT, 'server/routes/motionRoutes.js'));
    const p = M.buildShortPlanPrompt({ text: 'hello world', platform: 'TikTok', duration: 28 });
    assert.match(p, /3 to 7 words/);
    assert.match(p, /"headline"/);
    assert.deepEqual(M.cleanShortPlan({ headline: '"How we 3x\'d revenue" #growth 🚀', keywords: ['revenue growth', 'x'.repeat(50)] }),
        { headline: "How we 3x'd revenue growth", keywords: ['revenue', 'x'.repeat(30)], titleBrief: '' });
    assert.equal(M.cleanShortPlan({ headline: 'Hi' }), null, 'one word is not a headline');
});
await check('Shorts tab: finish toggles, open as project, user copy without em dashes', () => {
    const panel = read('client/src/components/ShortsPanel.jsx');
    assert.match(panel, /createProject\(name, data\)/);
    assert.match(panel, /navigate\(`\/editor\/\$\{id\}`\)/);
    assert.match(panel, /await ensureMattesFor\(short\)/);
    for (const lang of ['en', 'fr']) assert.doesNotMatch(JSON.stringify(JSON.parse(read(`client/src/locales/${lang}/editor.json`)).shortsPanel), /—/);
});

log(failures ? `\n${failures} FAILURE(S)` : '\nALL ROUND C CHECKS PASSED');
process.exit(failures ? 1 : 0);
