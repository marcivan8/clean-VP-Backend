#!/usr/bin/env node
/**
 * scripts/test_raster_captions.js — R88 (to-do A2/A3).
 *
 * Captions with ROTATION, the active-word HIGHLIGHT or keyword EMPHASIS are
 * drawn as pre-rendered images (server/compositor/RasterCaptionCompiler.js)
 * instead of drawtext. This suite pins:
 *   1. the non-breaking guarantee (plain / R63-only captions are untouched),
 *   2. which clips the client flags `raster`, and the word states it ships,
 *   3. keyword picking and emphasis resolution (CaptionModel),
 *   4. the server layout helpers,
 *   5. a REAL render through ffmpeg, checked on decoded pixels,
 *   6. the export wiring and its fail-open fallback.
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

// The real client modules, concatenated with imports/exports stripped — the
// same loader test_caption_program.js uses, so this is the true client path.
function loadClientModules() {
    // TextCraft before CaptionCompiler: the compiler imports its highlight-ramp
    // rules, and this loader resolves imports by concatenation order.
    const order = ['Easing', 'MotionSchema', 'MotionPresetExpansion', 'MotionExpression', 'SpatialMotion', 'AudioReactive', 'MotionResolver', 'MotionPresets', 'TextCraft', 'CaptionModel', 'ClipAdapter', 'Compositor', 'CaptionCompiler'];
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
    combined += 'return { buildCaptionProgram, buildPreset, pickKeywords, scoreKeywordCandidates, resolveEmphasis, '
        + 'emphasisStyleFor, activeWordIndex, EMPHASIS_BY_PACK, CAPTION_STYLE_PACKS, LEGACY_PACK_MOTION };';
    // eslint-disable-next-line no-new-func
    return new Function(combined)();
}
const CLIENT = loadClientModules();
const R = require(path.join(ROOT, 'server/compositor/RasterCaptionCompiler.js'));

const baseTrack = (dur) => ({ id: 'v1', type: 'video', order: 0, clips: [{ id: 'base', start: 0, duration: dur, speed: 1 }] });
const textTrack = (clips) => ({ id: 't1', type: 'text', order: -1, clips });
const program = (clips, dur = 4, fps = 30) => CLIENT.buildCaptionProgram([baseTrack(dur), textTrack(clips)], baseTrack(dur).clips, { fps });
const words = (text, start, step) => text.split(' ').map((w, i) => ({ text: w, start: start + i * step, end: start + (i + 1) * step - 0.02 }));

section('1 · R92 parity: every text clip is drawn as an image, like the preview box');
{
    const p = program([{ id: 'c1', content: 'Hello world', start: 0, duration: 2 }]);
    check('a plain caption is now a raster entry (wraps, weight, align, shadow like the preview)', p.entries.length === 1 && !!p.entries[0].raster);
    check('...with the preview defaults: Inter, white', p.entries[0]?.style.fontFamily === 'Inter' && p.entries[0]?.style.color === '#ffffff');
    check('...and the preview box: 80% wide, centred', p.entries[0]?.raster.layout.widthFrac === 0.8 && p.entries[0]?.raster.layout.align === 'center');

    const r63 = program([{ id: 'c2', content: 'pop in', start: 0, duration: 2, animations: CLIENT.buildPreset('pop', { duration: 2 }) }]);
    check('an animated caption is one entry, raster too', r63.entries.length === 1 && !!r63.entries[0].raster);

    const timed = program([{ id: 'c3', content: 'just words', start: 0, duration: 2, words: words('just words', 0, 0.5) }]);
    check('word timings alone draw plain (no per-word states)', timed.entries.length === 1 && !timed.entries[0].raster.wordStates);

    const noneHl = program([{ id: 'c4', content: 'calm doc line', start: 0, duration: 2, words: words('calm doc line', 0, 0.5),
        captionStyle: { packId: 'documentary', wordHighlight: { mode: 'none', scale: 1 } } }]);
    check("a pack whose highlight mode is 'none' adds no highlight", noneHl.entries.length === 1 && !noneHl.entries[0].raster.highlight);

    const empty = program([{ id: 'c5', content: '   ', start: 0, duration: 2 }]);
    check('an empty text clip draws nothing', empty.entries.length === 0);
    check('bold and italic travel to the image renderer', program([{ id: 'c6', content: 'x', start: 0, duration: 1, fontWeight: 'bold', fontStyle: 'italic' }]).entries[0].raster.font.weight === 'bold');
}

section('2 · The client flags rotation / highlight / emphasis as raster');
{
    const procedural = [{ id: 'fps-motion', content: 'sample me', start: 0, duration: 1,
        expressions: { x: '50 + 20 * sin(2 * pi * 12 * t)' } }];
    const at30 = program(procedural, 2, 30).entries[0]?.geometry || [];
    const at60 = program(procedural, 2, 60).entries[0]?.geometry || [];
    check('procedural caption geometry samples more densely for a 60fps export', at60.length > at30.length,
        `30fps samples=${at30.length}, 60fps samples=${at60.length}`);

    const rot = program([{ id: 'r1', content: 'N°1', start: 0, duration: 2, rotation: -12 }]);
    const e = rot.entries[0];
    check('a rotated caption produces an entry', !!e);
    check('...flagged raster', !!(e && e.raster));
    check('...whose geometry carries the rotation', e && e.geometry.every(g => Math.abs(g.rotation + 12) < 0.01), JSON.stringify(e && e.geometry[0]));
    check('...rendered as plain text (no word states, space gaps)', e && e.raster.wordStates === null && e.raster.layout.wordGap === 'space');

    const hlText = 'this changed my life';
    const hl = program([{ id: 'h1', content: hlText, start: 1, duration: 2, words: words(hlText, 1, 0.5),
        captionStyle: { packId: 'mrbeast', wordHighlight: { mode: 'color', color: '#FFE500', scale: 1.12 } } }]);
    const he = hl.entries[0];
    check('an active-word highlight caption is raster', !!(he && he.raster && he.raster.highlight));
    const st = he ? he.raster.wordStates : [];
    check('word states cover the clip end to end', st.length > 0 && Math.abs(st[0].from - 1) < 1e-3 && Math.abs(st[st.length - 1].to - 3) < 1e-3, JSON.stringify(st));
    check('word states never overlap', st.every((s, i) => i === 0 || s.from >= st[i - 1].to - 1e-6));
    const mid = st.find(s => s.from <= 1.75 && s.to > 1.75);
    check('at t=1.75 the 2nd word is active and 2 words are shown (preview rule)', mid && mid.active === 1 && mid.shown === 2, JSON.stringify(mid));
    check('the states agree with activeWordIndex() at every run start',
        st.every(s => s.active === CLIENT.activeWordIndex(words(hlText, 1, 0.5), s.from + 1e-4) || s.active === -1));

    const em = program([{ id: 'e1', content: 'the secret nobody tells you', start: 0, duration: 2, emphasis: { indices: [1], source: 'auto' },
        words: words('the secret nobody tells you', 0, 0.4), captionStyle: { packId: 'documentary', wordHighlight: { mode: 'none', scale: 1 } } }]);
    const ee = em.entries[0];
    check('an emphasised caption is raster', !!(ee && ee.raster && ee.raster.emphasis));
    check('...with the pack look (documentary gold)', ee && ee.raster.emphasis.style.color === '#E8C27A', JSON.stringify(ee && ee.raster.emphasis));
    check('emphasis alone shows the WHOLE caption at once (no word-by-word reveal)',
        ee && ee.raster.wordStates.every(s => s.shown === 5), JSON.stringify(ee && ee.raster.wordStates));
    check('...and per-word gaps (inline-block margins, like CaptionWords)', ee && ee.raster.layout.wordGap === 'margin');
}

section('3 · Keyword picking and emphasis resolution');
{
    const pick = (t) => { const r = CLIENT.pickKeywords(t); return r.indices.map(i => t.split(' ')[i]).join('|'); };
    check('numbers win ("Day 14 of 30" → 14)', pick('Day 14 of 30') === '14', pick('Day 14 of 30'));
    check('prices win ("I made 15-20€ per hour")', pick('I made 15-20€ per hour') === '15-20€', pick('I made 15-20€ per hour'));
    check('emphatic words (FR) win ("Tu ne vas jamais croire ça")', pick('Tu ne vas jamais croire ça') === 'jamais', pick('Tu ne vas jamais croire ça'));
    check('fillers are never picked ("so yeah that is it")', pick('so yeah that is it') === '', pick('so yeah that is it'));
    check('long captions get two keywords', CLIENT.pickKeywords('On a visité Lisbonne en trois jours avec un budget minuscule').indices.length === 2);
    check('a close call is reported as not confident (LLM fallback candidate)', CLIENT.pickKeywords('I want to show you this').confident === false);

    check('resolveEmphasis drops indices past the end of edited text',
        JSON.stringify(CLIENT.resolveEmphasis({ content: 'two words', emphasis: { indices: [1, 5] } }).indices) === '[1]');
    check('resolveEmphasis is null without indices', CLIENT.resolveEmphasis({ content: 'x', emphasis: { indices: [] } }) === null);
    check('every style pack has an emphasis look',
        Object.keys(CLIENT.CAPTION_STYLE_PACKS).every(k => CLIENT.EMPHASIS_BY_PACK[k])
        && Object.keys(CLIENT.LEGACY_PACK_MOTION).every(k => CLIENT.EMPHASIS_BY_PACK[k]));
    check('a yellow caption without pack gets a white keyword (stays visible)',
        CLIENT.emphasisStyleFor({ color: '#FACC15' }).color === '#FFFFFF');
}

section('4 · Server helpers');
{
    const anton = path.join(ROOT, 'render-worker/revideo/src/fonts/Anton-Regular.ttf');
    const m = fs.existsSync(anton) ? R.readFontMetrics(anton) : null;
    check('reads Anton line metrics from the font file (CSS line-height: normal)', m && m.ascent > 1.1 && m.descent > 0.3, JSON.stringify(m));
    const look = R.wordLook(2, { shown: 3, active: 2 }, { highlight: { mode: 'color', color: '#FFE500', scale: 1.12 }, emphasis: { indices: [2], style: { mode: 'box', color: '#000', background: '#FFE500', scale: 1.06 } } }, '#FFF');
    check('active highlight wins over emphasis on colour, keeps the bigger scale', look.color === '#FFE500' && look.scale === 1.12 && look.boxed);
    const hidden = R.wordLook(3, { shown: 3, active: 2 }, { highlight: null, emphasis: null }, '#FFF');
    check('a word not yet revealed is transparent (keeps its space)', hidden.opacity === 0);
    check('parses every text-shadow layer', R.parseAllTextShadows('3px 3px 0 #000, -3px -3px 0 #000, 0 2px 8px rgba(0,0,0,0.5)').length === 3);
    check('compileRasterOverlays(nothing) is null', R.compileRasterOverlays([], {}) === null);
    const dummyPrep = [{ clipId: 'c1', listPath: '/tmp/c1.ffconcat', geometry: [{ t: 0, x: 50, y: 50, rotation: 0, scale: 1, opacity: 1 }], outputStart: 0, outputEnd: 2 }];
    const dummyGraph = R.compileRasterOverlays(dummyPrep, { frameWidth: 1080, frameHeight: 1920, fps: 30 });
    check('compileRasterOverlays specifies fps=30 explicitly to prevent fps:default auto-insertion', dummyGraph.filterComplex.includes('[1:v]fps=30,setpts='));
    check('compileRasterOverlays specifies eof_action=pass on overlay', dummyGraph.filterComplex.includes('eof_action=pass:enable='));
    const animatedOpacityGraph = R.compileRasterOverlays([{
        ...dummyPrep[0], geometry: [
            { t: 0, x: 50, y: 50, scale: 1, rotation: 0, opacity: 0 },
            { t: 0.5, x: 50, y: 50, scale: 1, rotation: 0, opacity: 1 },
            { t: 1, x: 50, y: 50, scale: 1, rotation: 0, opacity: 0.25 },
            { t: 1.5, x: 50, y: 50, scale: 1, rotation: 0, opacity: 1 },
        ],
    }], { frameWidth: 1080, frameHeight: 1920, fps: 30 });
    check('raster caption export evaluates the full opacity curve, including interior dips',
        /geq=r='r\(X,Y\)':g='g\(X,Y\)':b='b\(X,Y\)':a='clip\(alpha\(X,Y\)\*/.test(animatedOpacityGraph.filterComplex)
            && !animatedOpacityGraph.filterComplex.includes('fade=t=in:st=0'));
}

section('5 · Real render through ffmpeg (decoded pixels)');
{
    let Canvas = null;
    try { Canvas = require('@napi-rs/canvas'); } catch (_) { Canvas = null; }
    const ffmpeg = [
        process.env.FFMPEG_PATH,
        '/opt/homebrew/bin/ffmpeg',
        '/usr/local/bin/ffmpeg',
        'ffmpeg',
        '/usr/bin/ffmpeg',
        (() => { try { return require('@ffmpeg-installer/ffmpeg').path; } catch (_) { return null; } })(),
    ].find(b => b && fs.existsSync(b) && spawnSync(b, ['-version']).status === 0) || null;
    const font = path.join(ROOT, 'render-worker/revideo/src/fonts/Anton-Regular.ttf');
    if (!Canvas || !ffmpeg || !fs.existsSync(font)) {
        skip('render checks', !Canvas ? '@napi-rs/canvas not installed for this platform' : !ffmpeg ? 'no ffmpeg' : 'no font');
    } else {
        const W = 540, H = 960;
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rastercap-'));
        const base = path.join(tmp, 'base.mp4');
        spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=0x203040:s=${W}x${H}:r=30:d=3`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', base]);

        const hlText = 'THIS CHANGED MY LIFE';
        const p = program([
            { id: 'a', content: hlText, start: 0, duration: 1.5, fontFamily: 'Anton', fontSize: 64, color: '#FFFFFF',
              words: words(hlText, 0, 0.375), x: 50, y: 30,
              captionStyle: { packId: 'mrbeast', wordHighlight: { mode: 'color', color: '#FFE500', scale: 1.12 } } },
            { id: 'b', content: 'TILTED TAG', start: 1.5, duration: 1.5, fontFamily: 'Anton', fontSize: 80, color: '#FFFFFF', rotation: -20, x: 50, y: 70 },
        ], 3);
        const prep = R.prepareRasterCaptions(p.entries, {
            tmpDir: tmp, frameWidth: W, frameHeight: H, pxScale: 0.5,
            resolveFont: () => font, fallbackFontPath: font, canvasModule: Canvas,
        });
        check('both captions prepared, none skipped', prep.items.length === 2 && prep.skipped.length === 0, JSON.stringify(prep.skipped));
        check('one image per distinct word state for the highlight caption', prep.items[0] && prep.items[0].images >= 4, prep.items[0] && prep.items[0].images);

        const g = R.compileRasterOverlays(prep.items, { frameWidth: W, frameHeight: H, fps: 30 });
        const out = path.join(tmp, 'out.mp4');
        const args = ['-y', '-loglevel', 'error', '-i', base];
        for (const inp of g.inputs) args.push(...inp.inputOptions, '-i', inp.path);
        args.push('-filter_complex', g.filterComplex, '-map', `[${g.outputLabel}]`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out);
        const run = spawnSync(ffmpeg, args, { encoding: 'utf8' });
        check('ffmpeg accepts the graph and renders', run.status === 0, (run.stderr || '').slice(-400));

        const frame = (t) => {
            const r = spawnSync(ffmpeg, ['-loglevel', 'error', '-ss', String(t), '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 << 20 });
            return r.status === 0 ? r.stdout : null;
        };
        const stats = (buf, y0, y1) => {
            let yellow = 0, white = 0, minX = W, maxX = 0, minY = H, maxY = 0;
            for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) {
                const i = (y * W + x) * 3, r = buf[i], gr = buf[i + 1], b = buf[i + 2];
                if (r > 200 && gr > 180 && b < 90) yellow++;
                if (r > 200 && gr > 200 && b > 200) { white++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
            }
            return { yellow, white, w: maxX - minX, h: maxY - minY };
        };
        const f1 = frame(0.5), f2 = frame(2.2);
        if (f1 && f2) {
            const s1 = stats(f1, 0, H / 2);
            check('the spoken word is drawn yellow (highlight reached the export)', s1.yellow > 200, JSON.stringify(s1));
            check('the rest of the caption is white', s1.white > 500, JSON.stringify(s1));
            const s2 = stats(f2, H / 2, H);
            // A -20° tilt makes a one-line tag much taller than its glyph height (~0.45 of its width).
            check('the tag is visibly rotated (its box is tall for a single line)', s2.white > 300 && s2.h > s2.w * 0.25, JSON.stringify(s2));
            const s3 = stats(f2, 0, H / 2);
            check('the first caption is gone after its window', s3.white < 50 && s3.yellow < 20, JSON.stringify(s3));
        } else {
            check('frames decode', false);
        }
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* temp */ }
    }
}

section('6 · Export wiring and fail-open fallback');
{
    const ep = read('jobs/exportProcessor.js');
    check('raster prep runs before the drawtext program compile', ep.indexOf('prepareRasterCaptions(wanted') > 0 && ep.indexOf('prepareRasterCaptions(wanted') < ep.indexOf('compiledCaptionProgram = compileCaptionProgram(drawtextProgram'));
    check('prepared entries are removed from the drawtext program', /entries: scaledCaptionProgram\.entries\.filter\(e => !rasterIds\.has\(e\.clipId\)\)/.test(ep));
    check('RASTER_CAPTIONS_DISABLED kill switch', ep.includes("process.env.RASTER_CAPTIONS_DISABLED !== '1'"));
    check('overlay pass failure falls back to drawtext for the same entries', ep.includes('entries: rasterProgramEntries') && ep.includes('raster_fallback_filters.txt'));
    check('a failed caption program also clears the raster state', /programClipIds\.clear\(\);[\s\S]{0,200}rasterPrepared = null;/.test(ep));
    const pkg = JSON.parse(read('package.json') || '{}');
    check('@napi-rs/canvas is a runtime dependency', !!(pkg.dependencies && pkg.dependencies['@napi-rs/canvas']));
    const lock = JSON.parse(read('package-lock.json') || '{}');
    check('...locked, including the Linux x64 binary the Docker image needs', !!(lock.packages && lock.packages['node_modules/@napi-rs/canvas-linux-x64-gnu']));
}

section('7 · Sticker rotation in the compositor: centred, and animated');
{
    const C = require(path.join(ROOT, 'server/compositor/CompositorCompiler.js'));
    const ffmpeg = [
        process.env.FFMPEG_PATH,
        '/opt/homebrew/bin/ffmpeg',
        '/usr/local/bin/ffmpeg',
        'ffmpeg',
        '/usr/bin/ffmpeg',
        (() => { try { return require('@ffmpeg-installer/ffmpeg').path; } catch (_) { return null; } })(),
    ].find(b => b && fs.existsSync(b) && spawnSync(b, ['-version']).status === 0) || null;
    const geo = (rotA, rotB) => [
        { t: 0, x: 0.4, y: 0.4, w: 0.2, h: 0.2 * (540 / 960), rotation: rotA, opacity: 1, blur: 0 },
        { t: 2, x: 0.4, y: 0.4, w: 0.2, h: 0.2 * (540 / 960), rotation: rotB, opacity: 1, blur: 0 },
    ];
    const plan = (g) => ({ version: 1, renderWidth: 540, renderHeight: 960, overlays: [{ id: 'o', clipId: 'o', zIndex: 1, outputStart: 0, outputEnd: 2, source: { url: 'x' }, geometry: g }] });
    const unrot = C.compileCompositionPlan(plan(geo(0, 0)), [{ overlayId: 'o', inputIndex: 1 }]);
    check('an unrotated sticker keeps the exact old chain (no rotate, top-left placement)',
        !unrot.filterComplex.includes('rotate') && !unrot.filterComplex.includes('overlay_w'));
    const stat = C.compileCompositionPlan(plan(geo(30, 30)), [{ overlayId: 'o', inputIndex: 1 }]);
    check('a rotated sticker is placed by its centre', stat.filterComplex.includes('overlay_w/2') && stat.filterComplex.includes('rotw('));
    const anim = C.compileCompositionPlan(plan(geo(0, 90)), [{ overlayId: 'o', inputIndex: 1 }]);
    check('an animated spin uses a per-frame angle on a fixed diagonal box', /rotate=a='if\(/.test(anim.filterComplex) && anim.filterComplex.includes('hypot(iw,ih)'));

    if (!ffmpeg) {
        skip('sticker render checks', 'no ffmpeg');
    } else {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rotsticker-'));
        const png = path.join(tmp, 's.png');
        spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=200x200', '-frames:v', '1', png]);
        const base = path.join(tmp, 'b.mp4');
        spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=540x960:r=30:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', base]);
        const centreOfRed = (compiled, t) => {
            const out = path.join(tmp, `o${Math.random().toString(36).slice(2)}.mp4`);
            const r = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', base, '-loop', '1', '-t', '2', '-i', png,
                '-filter_complex', compiled.filterComplex, '-map', `[${compiled.outputLabel}]`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out], { encoding: 'utf8' });
            if (r.status !== 0) return { error: (r.stderr || '').slice(-300) };
            const f = spawnSync(ffmpeg, ['-loglevel', 'error', '-ss', String(t), '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 << 20 });
            let n = 0, sx = 0, sy = 0, minY = 960, maxY = 0;
            for (let y = 0; y < 960; y++) for (let x = 0; x < 540; x++) {
                const i = (y * 540 + x) * 3;
                if (f.stdout[i] > 150 && f.stdout[i + 1] < 80) { n++; sx += x; sy += y; minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
            }
            return n ? { cx: sx / n, cy: sy / n, n, h: maxY - minY } : { n: 0 };
        };
        // Geometry box: x 0.4..0.6 of 540, y 0.4.. of 960 → centre (270, 384 + h/2).
        const expected = { cx: 0.5 * 540, cy: 0.4 * 960 + (0.2 * 540) / 2 };
        const a = centreOfRed(unrot, 1);
        const b = centreOfRed(stat, 1);
        check('unrotated sticker lands on its box centre', a.n && Math.abs(a.cx - expected.cx) < 3 && Math.abs(a.cy - expected.cy) < 3, JSON.stringify(a));
        check('a 30° sticker stays on the SAME centre (was shifted before R88)', b.n && Math.abs(b.cx - expected.cx) < 3 && Math.abs(b.cy - expected.cy) < 3, JSON.stringify(b));
        const c0 = centreOfRed(anim, 0.05), c1 = centreOfRed(anim, 1.0);
        check('an animated spin stays centred while turning', c1.n && Math.abs(c1.cx - expected.cx) < 4 && Math.abs(c1.cy - expected.cy) < 4, JSON.stringify(c1));
        check('...and is actually turning (45° makes the square taller)', c0.n && c1.n && c1.h > c0.h * 1.25, JSON.stringify({ c0, c1 }));
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* temp */ }
    }
}

section('8 · Text-layer effect stack reaches the raster overlay');
{
    const source = read('client/src/motion/CaptionCompiler.js');
    const compiler = require(path.join(ROOT, 'server/compositor/RasterCaptionCompiler.js'));
    const compiled = compiler.compileRasterOverlays([{
        clipId: 'caption-effects', listPath: '/tmp/caption.ffconcat',
        outputStart: 1, outputEnd: 3,
        geometry: [{ t: 1, x: 50, y: 50, scale: 1, opacity: 1, rotation: 0 }],
        effects: [
            { kind: 'blur', params: { radius: 2 } },
            { kind: 'brightness', params: { amount: 1.2 } },
            { kind: 'contrast', params: { amount: 1.1 } },
            { kind: 'saturation', params: { amount: 0.8 } },
            { kind: 'hue', params: { degrees: 12 } },
            { kind: 'glitch', params: { amount: 10 }, enabled: false },
        ],
    }], { frameWidth: 1080, frameHeight: 1920, fps: 30 });
    check('client caption program preserves and samples text layer effects',
        source.includes('const effectSamples') && source.includes('effects: effectSamples'));
    const animatedProgram = CLIENT.buildCaptionProgram([textTrack([{
        id: 'effect-keyframed-caption', content: 'sampled', start: 10, duration: 2,
        effects: [
            { type: 'brightness', params: { amount: 1 }, keyframes: { amount: [
                { time: 0, value: 1 }, { time: 2, value: 2, easing: 'ease-in' },
            ] } },
            { type: 'blur', params: { radius: 0 }, keyframes: { radius: [
                { time: 0, value: 0 }, { time: 2, value: 8, easing: 'ease-in' },
            ] } },
        ],
    }])], [
        { id: 'base-a', start: 0, duration: 2 },
        { id: 'base-b', start: 10, duration: 2 },
    ]);
    const effectTrack = animatedProgram.entries[0]?.raster?.effects?.[0]?.samples?.amount || [];
    const midpoint = effectTrack.find(point => Math.abs(point.t - 3) < 1e-4);
    const blurTrack = animatedProgram.entries[0]?.raster?.effects?.[1]?.samples?.radius || [];
    check('effect samples follow clip-local eased keyframes through the cut time map',
        animatedProgram.entries[0]?.outputStart === 2 && midpoint?.value === 1.25);
    check('animated blur samples at frame cadence on short text clips', blurTrack.length >= 60
        && blurTrack[0]?.t === 2 && blurTrack.at(-1)?.t === 4);
    check('raster text effects compile on the isolated caption stream',
        compiled.filterComplex.includes('gblur=sigma=2')
        && compiled.filterComplex.includes('eq=brightness=0.2')
        && compiled.filterComplex.includes('eq=contrast=1.1')
        && compiled.filterComplex.includes('eq=saturation=0.8')
        && compiled.filterComplex.includes('hue=h=12')
        && !compiled.filterComplex.includes('glitch'));
    const animated = compiler.compileRasterOverlays([{
        clipId: 'animated-caption-effects', listPath: '/tmp/caption-animated.ffconcat',
        outputStart: 2, outputEnd: 4,
        geometry: [{ t: 2, x: 50, y: 50, scale: 1, opacity: 1, rotation: 0 }],
        effects: [
            { kind: 'contrast', params: { amount: 1 }, samples: {
                amount: [{ t: 2, value: 1 }, { t: 3, value: 2 }, { t: 4, value: 1.5 }],
            } },
            { kind: 'blur', params: { radius: 0 }, samples: {
                radius: [{ t: 2, value: 0 }, { t: 3, value: 4 }, { t: 4, value: 1 }],
            } },
            { kind: 'grain', params: { amount: 4 }, samples: {
                amount: [{ t: 2, value: 4 }, { t: 3, value: 10 }, { t: 4, value: 6 }],
            } },
            { kind: 'chromatic-aberration', params: { amount: 2 } },
            { kind: 'rgb_split', params: { amount: 4, angle: 90, centerX: 0.2, centerY: 0.7 } },
            { kind: 'distortion', params: { amount: 0.03 } },
            { kind: 'color_grade', params: { brightness: 110, contrast: 120, saturation: 90, hueRotate: 8, temperature: 12, tint: -4 }, samples: {
                brightness: [{ t: 2, value: 100 }, { t: 3, value: 110 }, { t: 4, value: 100 }],
            } },
        ],
    }], { frameWidth: 1080, frameHeight: 1920, fps: 30 });
    check('animated text effect samples compile to output-time FFmpeg expressions',
        animated.filterComplex.includes("eq=contrast='clip(if(lt(t,3)")
        && animated.filterComplex.includes('eval=frame'));
    check('animated text blur compiles time-gated Gaussian blur intervals',
        animated.filterComplex.includes("gblur=sigma=4:enable='gte(t,3)*lt(t,4)"));
    check('grain, chromatic shift, and distortion are included in raster text effects',
        animated.filterComplex.includes('noise=c0s=')
        && animated.filterComplex.includes('chromashift=cbh=-2:crh=2')
        && animated.filterComplex.includes("geq=r='r(clip(X+(0)*(sqrt(pow(X/W-0.2,2)+pow(Y/H-0.7,2)))")
        && animated.filterComplex.includes("clip(Y+(4)*(sqrt(pow(X/W-0.2,2)+pow(Y/H-0.7,2)))")
        && animated.filterComplex.includes('lenscorrection=cx=0.5:cy=0.5:k1=0.03')
        && animated.filterComplex.includes("colorchannelmixer=rr=1.1:gg=1.1:bb=1.1:enable='gte(t,3)*lt(t,4)'")
        && animated.filterComplex.includes('colorbalance=rs=0.036:bs=-0.036:gs=-0.012')
        && animated.filterComplex.includes("contrast='clip((120)/100,0,2)'"));
    const ffmpegPath = (() => { try { return require('ffmpeg-static'); } catch (_) { return null; } })();
    if (ffmpegPath && fs.existsSync(ffmpegPath)) {
        const render = spawnSync(ffmpegPath, [
            '-y', '-hide_banner', '-loglevel', 'error',
            '-f', 'lavfi', '-i', 'color=c=black:s=1080x1920:r=30:d=5',
            '-f', 'lavfi', '-i', 'color=c=white:s=100x100:r=30:d=3',
            '-filter_complex', animated.filterComplex, '-map', '[rcout]', '-t', '5', '-f', 'null', '-',
        ], { encoding: 'utf8' });
        check('FFmpeg renders the animated text-effect expression', render.status === 0, render.stderr);

        const blurOnly = compiler.compileRasterOverlays([{
            clipId: 'blur-proof', listPath: '/tmp/caption-blur.ffconcat', outputStart: 0, outputEnd: 3,
            geometry: [{ t: 0, x: 50, y: 50, scale: 1, opacity: 1, rotation: 0 }],
            effects: [{ kind: 'blur', params: { radius: 0 }, samples: { radius: [
                { t: 0, value: 0 }, { t: 1, value: 0 }, { t: 2, value: 8 }, { t: 3, value: 8 },
            ] } }],
        }], { frameWidth: 1080, frameHeight: 1920, fps: 1 });
        const blurRender = spawnSync(ffmpegPath, [
            '-hide_banner', '-loglevel', 'error',
            '-f', 'lavfi', '-i', 'color=c=black:s=1080x1920:r=1:d=3',
            '-f', 'lavfi', '-i', 'testsrc2=s=100x100:r=1:d=3',
            '-filter_complex', blurOnly.filterComplex, '-map', '[rcout]', '-frames:v', '3',
            '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-',
        ], { maxBuffer: 64 * 1024 * 1024 });
        const variance = frame => {
            const offset = frame * 1080 * 1920 * 3;
            let sum = 0, squares = 0, count = 0;
            for (let y = 910; y < 1010; y++) for (let x = 490; x < 590; x++) {
                const i = offset + (y * 1080 + x) * 3;
                const value = (blurRender.stdout[i] + blurRender.stdout[i + 1] + blurRender.stdout[i + 2]) / 3;
                sum += value; squares += value * value; count++;
            }
            return squares / count - (sum / count) ** 2;
        };
        check('animated blur changes decoded caption pixels at its sampled time',
            blurRender.status === 0 && blurRender.stdout.length === 1080 * 1920 * 3 * 3
            && variance(2) < variance(0) * 0.7,
            blurRender.stderr?.toString());
    } else skip('animated effect FFmpeg render', 'ffmpeg-static unavailable');
}

console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
process.exit(failed > 0 ? 1 : 0);
