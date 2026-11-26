// scripts/test_big_words_r173.mjs — R173: the "Big Words" caption style. Key
// words are set ~1.7x LARGER (a real font size, the line makes room), same
// colour; default for the Reel style and for every Shorts-panel short, and
// pickable in the style cards.
//
// §1 the model (pack, emphasis look, picker card)
// §2 key words are picked when the style is applied (real store)
// §3 the export lays enlarged words out without overlap (real renderer + font)
// §4 defaults and wiring (Reel style, Shorts panel, add captions, preview)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
let pass = 0, fail = 0, skipped = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

// ── §1 ──────────────────────────────────────────────────────────────────────
console.log('\n§1 the model');
const CM = await import('../client/src/motion/CaptionModel.js');
const pack = CM.CAPTION_STYLE_PACKS['big-words'];
ok(pack && pack.uppercase && pack.wordHighlight?.mode === 'none', 'pack exists: uppercase, no spoken-word highlight competing with the size');
ok(CM.EMPHASIS_BY_PACK['big-words']?.mode === 'size' && CM.EMPHASIS_BY_PACK['big-words'].size === 1.7, 'its emphasis is a 1.7x LAYOUT size');
ok(!CM.EMPHASIS_BY_PACK['big-words'].color, 'same colour: the look sets no emphasis colour');
ok(CM.LEGACY_PACK_MOTION['big-words']?.animationPreset === 'pop', 'the picker card id has its motion half');
const fields = CM.stylePackToClipFields('big-words');
ok(fields?.captionStyle?.packId === 'big-words', 'applying the pack tags the clip, so emphasis follows it');
const look = CM.resolveEmphasis({ content: 'I MADE MONEY', emphasis: { indices: [2] }, captionStyle: { packId: 'big-words' } });
ok(look?.style?.mode === 'size' && look.indices.join() === '2', 'resolveEmphasis on a Big Words caption returns the size look');
ok(CM.packWantsKeywords('big-words') && !CM.packWantsKeywords('hormozi') && !CM.packWantsKeywords(undefined), 'only a size pack asks for key words');
const packs = await import('../client/src/components/Assistant/captionStylePacks.js');
const card = packs.packById('big-words');
ok(card && packs.captionPackUpdates(card)?.captionStyle?.packId === 'big-words', 'the style cards list it, and picking it tags the captions');
const parts = packs.sampleParts(card);
ok(parts.length === 3 && parts[2].size === 1.7 && parts[0].size === 1 && parts.map(p => p.text).join('') === card.sample, 'the card preview enlarges its own key word');
ok(packs.sampleParts(packs.packById('bold-impact')).length === 1, 'other cards preview as before');
const workerCopy = read('render-worker/revideo/src/motion/CaptionModel.js');
ok(workerCopy.includes("'big-words'") && workerCopy.includes('packWantsKeywords'), 'the render-worker copy of CaptionModel is in sync');

// ── §2 ──────────────────────────────────────────────────────────────────────
console.log('\n§2 key words are picked when the style is applied');
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
let store = null;
try { store = (await import('../client/src/store/useTimelineStore.js')).default; } catch (err) { console.log('  – store not loadable in Node:', err.message); }
if (store) {
    const seed = () => {
        store.getState().loadProject({
            tracks: [{ id: 't1', type: 'text', order: -1, clips: [
                { id: 'c1', type: 'text', start: 0, duration: 2, content: 'I made 5000 euros in one week' },
                { id: 'c2', type: 'text', start: 2, duration: 2, content: 'keep this one', emphasis: { indices: [0], source: 'user' } },
            ] }],
            duration: 4,
        });
    };
    seed();
    const pastBefore = store.getState().past.length;
    store.getState().applyCaptionStyleToAll(packs.captionPackUpdates(card));
    const clips = store.getState().tracks.find(t => t.type === 'text').clips;
    const c1 = clips.find(c => c.content.startsWith('I made'));
    const c2 = clips.find(c => c.content === 'keep this one');
    ok(c1?.emphasis?.indices?.length > 0 && c1.emphasis.source === 'auto', `a caption with no key words gets the rule pick (${c1?.emphasis?.indices})`);
    ok(c1.emphasis.indices.includes(2), 'the number is one of them');
    ok(c2?.emphasis?.indices?.join() === '0' && c2.emphasis.source === 'user', 'words the user chose are kept');
    ok(store.getState().past.length === pastBefore + 1, 'style and key words are ONE undo step');
    store.getState().undo();
    const undone = store.getState().tracks.find(t => t.type === 'text').clips.find(c => c.content.startsWith('I made'));
    ok(!undone?.emphasis && undone?.captionStyle?.packId !== 'big-words', 'one undo removes both');

    seed();
    store.getState().applyCaptionStyleToAll(packs.captionPackUpdates(packs.packById('bold-impact')));
    const plain = store.getState().tracks.find(t => t.type === 'text').clips.find(c => c.content.startsWith('I made'));
    ok(!plain?.emphasis, 'another style picks no key words (unchanged behaviour)');

    seed();
    store.getState().applyCaptionUpdate(CM.stylePackToClipFields('big-words'), { clipId: 'c1', scope: 'global' });
    const viaUpdate = store.getState().tracks.find(t => t.type === 'text').clips.find(c => c.content.startsWith('I made'));
    ok(viaUpdate?.emphasis?.indices?.length > 0, 'the recipe/short path (applyCaptionUpdate, global) seeds them too');
} else {
    skipped++;
}

// ── §3 ──────────────────────────────────────────────────────────────────────
console.log('\n§3 the export lays enlarged words out without overlap');
const R = require('../server/compositor/RasterCaptionCompiler.js');
// A fake context whose width is proportional to the font size in ctx.font.
const fakeCtx = { font: '40px "X"', measureText(t) { const px = Number(/([\d.]+)px/.exec(this.font)[1]); return { width: t.length * px * 0.6 }; } };
const fontFor = (s) => `${40 * s}px "X"`;
const tokens = ['I', 'MADE', 'MONEY', 'TODAY'];
const looks = tokens.map((_, i) => ({ size: i === 2 ? 1.7 : 1, boxed: false }));
fakeCtx.font = fontFor(1);
const lines = R.layoutLines(fakeCtx, tokens, looks, 40, 2000, 'margin', fontFor);
const items = lines[0].items;
ok(Math.abs(items[2].w - 'MONEY'.length * 40 * 1.7 * 0.6) < 0.01, 'the key word is measured in its own, 1.7x font');
ok(items.every((it, i) => i === 0 || it.x >= items[i - 1].x + items[i - 1].boxW), 'no word starts before the previous one ends');
ok(Math.abs(items[3].x - (items[2].x + items[2].boxW + 0.25 * 40 * 1.7)) < 0.01, "the big word's margin is in its own em, like the CSS span");
ok(lines[0].maxSize === 1.7, 'the line knows its tallest word');
const narrow = R.layoutLines(fakeCtx, tokens, looks, 40, 280, 'margin', fontFor);
ok(narrow.length > 1, 'the wider word can wrap the line, as it does in the preview');
ok(R.wordLook(2, { shown: 4, active: -1 }, { emphasis: { indices: [2], style: { mode: 'size', size: 1.7 } } }, '#FFFFFF').size === 1.7
    && R.wordLook(1, { shown: 4, active: -1 }, { emphasis: { indices: [2], style: { mode: 'size', size: 1.7 } } }, '#FFFFFF').size === 1, 'only the key word is enlarged');
ok(R.wordLook(2, { shown: 4, active: -1 }, { emphasis: { indices: [2], style: { mode: 'size', size: 9 } } }, '#FFFFFF').size === 3, 'a size is clamped to 3, like the preview');
ok(R.wordLook(2, { shown: 4, active: -1 }, { emphasis: { indices: [2], style: { mode: 'size', size: 1.7 } } }, '#FFFFFF').color === '#FFFFFF', 'the key word keeps the caption colour');

let Canvas = null;
try { Canvas = require('@napi-rs/canvas'); } catch { Canvas = null; }
const font = path.join(ROOT, 'client/public/fonts/Montserrat-Bold.ttf');
if (!Canvas || !fs.existsSync(font)) {
    skipped++; console.log('  – real render skipped (no @napi-rs/canvas or font)');
} else {
    const CC = await import('../client/src/motion/CaptionCompiler.js');
    const base = { id: 'v1', type: 'video', order: 0, clips: [{ id: 'base', start: 0, duration: 3, speed: 1 }] };
    const prog = (emphasis) => CC.buildCaptionProgram([base, { id: 't1', type: 'text', order: -1, clips: [{
        id: 'cap', type: 'text', content: 'I MADE MONEY TODAY', start: 0, duration: 3, fontFamily: 'Montserrat', fontSize: 48,
        color: '#FFFFFF', x: 50, y: 50, captionStyle: { packId: 'big-words', wordHighlight: { mode: 'none', scale: 1 } },
        ...(emphasis ? { emphasis: { indices: [2], source: 'auto' } } : { rotation: 1 }),
    }] }], base.clips, { fps: 30 });
    const render = (emphasis) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bigwords-'));
        const p = prog(emphasis);
        const prep = R.prepareRasterCaptions(p.entries, {
            tmpDir: tmp, frameWidth: 1080, frameHeight: 1920, pxScale: 1,
            resolveFont: () => font, fallbackFontPath: font, canvasModule: Canvas,
        });
        return prep.items[0] || null;
    };
    const plain = render(false);
    const big = render(true);
    ok(big && plain, 'both captions render through the real export renderer');
    ok(big && plain && big.height > plain.height * 1.4, `the line grows to fit the 1.7x word (height ${plain?.height} → ${big?.height})`);
}

// ── §4 ──────────────────────────────────────────────────────────────────────
console.log('\n§4 defaults and wiring');
const ES = await import('../client/src/agent/EditingStyles.js');
ok(ES.getEditingStyle('reel')?.captionPack === 'big-words', 'the Reel style uses Big Words');
ok(['vlog', 'talking_head', 'interview', 'podcast'].every(id => !ES.getEditingStyle(id)?.captionPack), 'the other styles keep their recipe look');
const planner = read('client/src/agent/EditPlanner.js');
ok(/captionPack = activeStyle\?\.captionPack && recipeId === activeStyle\.recipeId/.test(planner), "the style's look is passed only when the recipe is that style's own");
const engine = read('client/src/agent/MediaExecutionEngine.js');
ok(/args\.captionPack && CAPTION_STYLE_PACKS\[args\.captionPack\]/.test(engine) && /captionPack: args\.captionPack, keywords: true/.test(engine), 'the recipe uses it and turns key words on');
ok((engine.match(/this\._applyStyleCaptionLook\(\);/g) || []).length === 3, 'every add-captions path applies the Reel look');
ok(/clips\.some\(c => c\.captionStyle\?\.packId\)\) return false/.test(engine), 'captions that already have a look are left alone');
const finisher = await import('../client/src/agent/shortFinisher.js').catch(() => null);
ok(finisher ? finisher.SHORTS_CAPTION_PACK === 'big-words' : /SHORTS_CAPTION_PACK = 'big-words'/.test(read('client/src/agent/shortFinisher.js')), 'Shorts panel shorts use Big Words');
ok(/captionPack: SHORTS_CAPTION_PACK,/.test(read('client/src/agent/shortFinisher.js')), 'whatever the platform (set on the profile handed to polishShort)');
ok(/const captionPack = referenceStyle\?\.captionPack \|\| profile\?\.captionPack/.test(read('client/src/agent/shortPolish.js')), "a reference video's own caption look still wins");
const overlay = read('client/src/components/Player/TextOverlay.jsx');
ok(/emStyle\.mode === 'size'/.test(overlay) && /style\.fontSize = `\$\{size\}em`/.test(overlay), 'the preview sets a real font size (the line reflows), not a zoom');
ok(/sampleParts\(style\)/.test(read('client/src/components/MobileCaptionSheets.jsx')) && /sampleParts\(style\)/.test(read('client/src/components/Assistant/ReasoningPanel.jsx')), 'both style pickers preview the enlarged word');

// ── §5 ──────────────────────────────────────────────────────────────────────
console.log('\n§5 R174: outline under the letters, and preview = export');
const rasterSrc = read('server/compositor/RasterCaptionCompiler.js');
ok(/for \(const pass of \['box', 'shadow', 'stroke', 'fill'\]\)/.test(rasterSrc), 'export paints every outline before every fill');
ok(!/pass === 'fill'[\s\S]{0,600}strokeText\(w\.tok, textX, w\.baseline\);\s*\}\s*\}\s*ctx\.restore/.test(rasterSrc.replace(/ctx\.strokeStyle = ctx\.fillStyle;\s*ctx\.strokeText\(w\.tok, textX, w\.baseline\);/g, '')), 'the fill pass no longer strokes over the letters');
ok(/paintOrder: 'stroke fill'/.test(read('client/src/components/Player/TextOverlay.jsx')), 'preview: paint-order stroke fill on the caption');
ok(/paintOrder:\s+'stroke fill'/.test(read('client/src/components/Player/CaptionOverlay.jsx')) && /paintOrder: 'stroke fill'/.test(read('client/src/components/MobileCaptionSheets.jsx')), 'the other caption previews too');
const m = R.readFontMetrics(path.join(ROOT, 'client/public/fonts/Montserrat-Bold.ttf'));
ok(m && m.weightClass >= 600 && m.italic === false, `the font file reports its own weight (Montserrat-Bold.ttf = ${m?.weightClass}, a bold cut)`);
const anton = R.readFontMetrics(path.join(ROOT, 'client/public/fonts/Anton-Regular.ttf'));
ok(!anton || anton.weightClass < 600, 'a regular cut reports a regular weight, so an 800 caption in it still gets fake bold (as in Chrome)');
ok(/const synthBold = wantsBold && \(Number\(metrics\?\.weightClass\) \|\| 400\) < 600;/.test(rasterSrc), 'fake bold only when the file is not bold, like a browser');
ok(/Math\.max\(1, Math\.round\(cssStrokeWidth \/ 2\)\)/.test(read('server/compositor/CaptionCompiler.js')) && /Math\.max\(1, Math\.round\(cssStroke \/ 2\)\)/.test(read('jobs/exportProcessor.js')), 'the drawtext fallbacks draw half the width (their border is all outside the letter)');

let puppeteer = null;
try { puppeteer = require('puppeteer'); } catch { puppeteer = null; }
if (!puppeteer || !Canvas || !fs.existsSync(font)) {
    skipped++; console.log('  – Chrome comparison skipped (no puppeteer / canvas / font)');
} else {
    let browser = null;
    try { browser = await puppeteer.launch({ headless: true }); } catch (err) { browser = null; console.log('  – Chrome comparison skipped:', err.message.split('\n')[0]); skipped++; }
    if (browser) {
        const BG = [58, 90, 122];
        const text = 'I MADE 5000 EUROS IN ONE WEEK';
        const big = [2, 3];
        const CC = await import('../client/src/motion/CaptionCompiler.js');
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bigwords-chrome-'));
        const base = { id: 'v1', type: 'video', order: 0, clips: [{ id: 'base', start: 0, duration: 3, speed: 1 }] };
        const p = CC.buildCaptionProgram([base, { id: 't1', type: 'text', order: -1, clips: [{
            id: 'cap', type: 'text', content: text, start: 0, duration: 3, fontFamily: 'Montserrat', fontWeight: 800, fontSize: 46,
            color: '#FFFFFF', stroke: { width: 3, color: '#000000' }, x: 50, y: 50,
            captionStyle: { packId: 'big-words', wordHighlight: { mode: 'none', scale: 1 } }, emphasis: { indices: big, source: 'auto' },
        }] }], base.clips, { fps: 30 });
        const prep = R.prepareRasterCaptions(p.entries, { tmpDir: tmp, frameWidth: 1080, frameHeight: 1920, pxScale: 1, resolveFont: () => font, fallbackFontPath: font, canvasModule: Canvas });
        const pngPath = /file '([^']+\.png)'/.exec(fs.readFileSync(prep.items[0].listPath, 'utf8'))[1];
        const img = await Canvas.loadImage(pngPath);
        const W = img.width, H = img.height;
        const pixels = (source) => { const c = Canvas.createCanvas(W, H); const x = c.getContext('2d'); x.fillStyle = `rgb(${BG})`; x.fillRect(0, 0, W, H); x.drawImage(source, 0, 0); return x.getImageData(0, 0, W, H).data; };
        const exportPx = pixels(img);
        const pad = (W - 864) / 2;
        // The preview's DOM: TextOverlay's word spans (inline-block, 0.25em
        // margin, 1.7em for a Big Words key word), 80% box, same font file.
        const chrome = async (paintOrder) => {
            const spans = text.split(' ').map((w, i) => `<span style="display:inline-block;margin-right:0.25em;${big.includes(i) ? 'font-size:1.7em;' : ''}">${w}</span>`).join('');
            const html = `<html><head><style>@font-face{font-family:Montserrat;src:url(file://${font});font-weight:800;}body{margin:0;background:rgb(${BG})}</style></head><body><div style="position:absolute;left:${pad}px;top:0;width:864px;padding-top:${pad}px;text-align:center;font-family:Montserrat,sans-serif;font-weight:800;font-size:46px;color:#fff;-webkit-text-stroke:3px #000;${paintOrder ? 'paint-order:stroke fill;' : ''}white-space:pre-wrap">${spans}</div></body></html>`;
            const file = path.join(tmp, `p${paintOrder ? 1 : 0}.html`);
            fs.writeFileSync(file, html);
            const page = await browser.newPage();
            await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
            await page.goto('file://' + file);
            await page.evaluate(() => document.fonts.ready);
            const shot = path.join(tmp, `c${paintOrder ? 1 : 0}.png`);
            await page.screenshot({ path: shot, clip: { x: 0, y: 0, width: W, height: H } });
            await page.close();
            return pixels(await Canvas.loadImage(shot));
        };
        const ink = (d) => { const b = [W, H, 0, 0]; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; if (Math.abs(d[i] - BG[0]) + Math.abs(d[i + 1] - BG[1]) + Math.abs(d[i + 2] - BG[2]) > 60) { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); } } return b; };
        const diff = (a, ba, b, bb) => { const dx = bb[0] - ba[0], dy = bb[1] - ba[1]; let sum = 0, n = 0; for (let y = ba[1]; y <= ba[3]; y++) for (let x = ba[0]; x <= ba[2]; x++) { const i = (y * W + x) * 4, j = ((y + dy) * W + x + dx) * 4; if (j < 0 || j >= b.length) continue; sum += Math.abs(a[i] - b[j]) + Math.abs(a[i + 1] - b[j + 1]) + Math.abs(a[i + 2] - b[j + 2]); n++; } return sum / n / 3; };
        const preview = await chrome(true);
        const previewOld = await chrome(false);
        await browser.close();
        const be = ink(exportPx), bp = ink(preview);
        ok(Math.abs((be[2] - be[0]) - (bp[2] - bp[0])) <= 3 && Math.abs((be[3] - be[1]) - (bp[3] - bp[1])) <= 3,
            `export and Chrome preview occupy the same box (${be[2] - be[0]}x${be[3] - be[1]} vs ${bp[2] - bp[0]}x${bp[3] - bp[1]})`);
        ok(Math.abs(be[0] - bp[0]) <= 2 && Math.abs(be[1] - bp[1]) <= 2, 'and sit at the same place (within 2px)');
        const dNow = diff(exportPx, be, preview, bp);
        const dOld = diff(exportPx, be, previewOld, ink(previewOld));
        ok(dNow < 12, `pixel difference export vs preview is small (${dNow.toFixed(1)}/255 per channel)`);
        ok(dOld > dNow + 6, `without paint-order the preview draws the inner outline marks (${dOld.toFixed(1)} vs ${dNow.toFixed(1)})`);
    }
}

console.log(`\n${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''}`);
if (fail) process.exit(1);
console.log('ALL BIG WORDS CHECKS PASSED');
