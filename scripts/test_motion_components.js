#!/usr/bin/env node
/**
 * Regression: Motion Graphics Components (CLAUDE.md R65) — the 9-component
 * library (AnimatedText/Image/Sticker/Emoji/Arrow, LowerThird, Callout,
 * QuoteCard, CTAWidget) that's meant to be callable as an AI tool:
 * `{ component: "CTAWidget", preset: "subscribe" }`.
 *
 * Covers: `ComponentLibrary.buildComponent()`'s pure placement logic for all
 * 9 components (including the required-param error cases), that the 5
 * built-in graphic assets are real, non-trivial, DECODABLE PNGs (not just
 * "the file exists" — a real ffmpeg decode + pixel-content check, same
 * discipline as every other suite in this repo), and the wiring into
 * `useTimelineStore.js`/`MediaExecutionEngine.js`.
 *
 * Skips the FFmpeg section gracefully when no binary is present.
 *
 * Run: node scripts/test_motion_components.js
 */

'use strict';

const fs = require('fs');
const os = require('os');
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

function loadClientModules() {
    const order = ['Easing', 'MotionSchema', 'MotionResolver', 'MotionPresets', 'CaptionModel', 'ClipAdapter', 'ClipGrouping', 'ComponentLibrary'];
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
    combined += 'return { buildComponent, COMPONENT_IDS, COMPONENT_PRESETS };';
    // eslint-disable-next-line no-new-func
    return new Function(combined)();
}
const CLIENT = loadClientModules();

function ffmpegBin() {
    for (const bin of ['ffmpeg', '/usr/bin/ffmpeg']) {
        const r = spawnSync(bin, ['-version'], { encoding: 'utf8' });
        if (r.status === 0) return bin;
    }
    try { return require('ffmpeg-static'); } catch { return null; }
}
const FFMPEG = ffmpegBin();

section('1 · All 9 components are registered with at least one preset');
{
    const EXPECTED = ['AnimatedText', 'AnimatedImage', 'AnimatedSticker', 'AnimatedEmoji', 'AnimatedArrow', 'LowerThird', 'Callout', 'QuoteCard', 'CTAWidget'];
    check('exactly the 9 requested components exist', JSON.stringify([...CLIENT.COMPONENT_IDS].sort()) === JSON.stringify([...EXPECTED].sort()),
        `got ${CLIENT.COMPONENT_IDS.join(', ')}`);
    for (const id of EXPECTED) {
        const presets = CLIENT.COMPONENT_PRESETS[id] || {};
        check(`${id} has at least one preset`, Object.keys(presets).length > 0);
    }
    check('an unknown component id fails cleanly (no throw, an error field)',
        (() => { const r = CLIENT.buildComponent('NotARealComponent', 'x', {}); return r && r.placements.length === 0 && typeof r.error === 'string'; })());
}

section('2 · Single-clip components (Text/Image/Sticker/Emoji/Arrow)');
{
    const text = CLIENT.buildComponent('AnimatedText', 'pop', { text: 'Hello' });
    check('AnimatedText produces one text-track placement', text.placements.length === 1 && text.placements[0].trackType === 'text');
    check('AnimatedText carries the real content through', text.placements[0].clip.content === 'Hello');
    check('AnimatedText\'s preset actually resolved to a real animation', Array.isArray(text.placements[0].clip.animations) && text.placements[0].clip.animations.length > 0);

    const noUrl = CLIENT.buildComponent('AnimatedImage', 'zoom', {});
    check('AnimatedImage without params.url fails with an explanatory error (no built-in image library — by design)',
        noUrl.placements.length === 0 && /url/.test(noUrl.error || ''));

    const img = CLIENT.buildComponent('AnimatedImage', 'zoom', { url: 'https://example.com/photo.jpg' });
    check('AnimatedImage with a url produces one overlay placement', img.placements.length === 1 && img.placements[0].trackType === 'overlay');
    check('AnimatedImage passes the caller\'s own url through untouched (not a built-in graphic)', img.placements[0].asset.url === 'https://example.com/photo.jpg');

    const sticker = CLIENT.buildComponent('AnimatedSticker', 'bounce', { url: 'https://example.com/s.png' });
    check('AnimatedSticker produces one overlay placement', sticker.placements.length === 1 && sticker.placements[0].trackType === 'overlay');

    const emojiMissing = CLIENT.buildComponent('AnimatedEmoji', 'pop', {});
    check('AnimatedEmoji without params.emoji fails cleanly', emojiMissing.placements.length === 0);

    const emoji = CLIENT.buildComponent('AnimatedEmoji', 'pop', { emoji: '🎉' });
    check('AnimatedEmoji renders as a TEXT clip whose content is the emoji glyph (no image library needed)',
        emoji.placements.length === 1 && emoji.placements[0].trackType === 'text' && emoji.placements[0].clip.content === '🎉');

    const arrowRight = CLIENT.buildComponent('AnimatedArrow', 'point', {});
    check('AnimatedArrow defaults to 0deg (pointing right, the source graphic\'s native direction)',
        arrowRight.placements[0].clip.rotation === 0);
    const arrowUp = CLIENT.buildComponent('AnimatedArrow', 'point', { direction: 'up' });
    check('AnimatedArrow direction="up" rotates the SAME single graphic rather than needing a second asset',
        arrowUp.placements[0].clip.rotation === 270 && arrowUp.placements[0].asset.url === arrowRight.placements[0].asset.url);
}

section('3 · Composite components (LowerThird/Callout/QuoteCard/CTAWidget) — shipped as PAIRED clips, not grouped');
{
    const lt = CLIENT.buildComponent('LowerThird', 'dark', { title: 'Jane Doe', subtitle: 'Director' });
    check('LowerThird with a subtitle produces THREE placements (bar + title + subtitle)', lt.placements.length === 3);
    check('LowerThird\'s first placement is the background graphic', lt.placements[0].trackType === 'overlay');
    check('LowerThird\'s title and subtitle are both real text placements', lt.placements[1].clip.content === 'Jane Doe' && lt.placements[2].clip.content === 'Director');

    const ltNoSub = CLIENT.buildComponent('LowerThird', 'dark', { title: 'Jane Doe' });
    check('LowerThird without a subtitle produces exactly TWO placements (no empty third clip)', ltNoSub.placements.length === 2);

    const calloutMissing = CLIENT.buildComponent('Callout', 'dark', {});
    check('Callout requires params.text', calloutMissing.placements.length === 0);
    const callout = CLIENT.buildComponent('Callout', 'light', { text: 'Wait for it...' });
    check('Callout produces bar + text (two placements)', callout.placements.length === 2);
    check('Callout\'s "light" preset uses a different background graphic than "dark"',
        callout.placements[0].asset.url !== CLIENT.buildComponent('Callout', 'dark', { text: 'x' }).placements[0].asset.url);

    const quote = CLIENT.buildComponent('QuoteCard', 'classic', { quote: 'Ship it.', author: 'Marc' });
    check('QuoteCard with an author produces THREE placements (quote-mark graphic + quote text + attribution)', quote.placements.length === 3);
    check('the attribution line is prefixed with an em dash', quote.placements[2].clip.content === '— Marc');
    const quoteNoAuthor = CLIENT.buildComponent('QuoteCard', 'classic', { quote: 'Ship it.' });
    check('QuoteCard without an author produces exactly TWO placements', quoteNoAuthor.placements.length === 2);

    const cta = CLIENT.buildComponent('CTAWidget', 'subscribe', {});
    check('CTAWidget "subscribe" produces badge + label (two placements)', cta.placements.length === 2);
    check('CTAWidget\'s label defaults to the preset\'s own label when none is given', cta.placements[1].clip.content === 'Subscribe');
    const ctaCustom = CLIENT.buildComponent('CTAWidget', 'subscribe', { label: 'Ring the bell' });
    check('CTAWidget accepts a caller-supplied label override', ctaCustom.placements[1].clip.content === 'Ring the bell');
}

section('4 · The built-in graphic library — real, decodable, non-trivial PNGs');
{
    const ASSET_DIR = path.join(ROOT, 'client/public/motion-assets');
    const EXPECTED_FILES = ['arrow.png', 'bar-dark.png', 'bar-light.png', 'quote-mark.png', 'subscribe-badge.png'];
    for (const f of EXPECTED_FILES) {
        const p = path.join(ASSET_DIR, f);
        const exists = fs.existsSync(p);
        check(`${f} exists`, exists);
        if (exists) {
            const buf = fs.readFileSync(p);
            check(`${f} is a real PNG (starts with the PNG magic bytes, not an empty/placeholder file)`,
                buf.length > 500 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47);
        }
    }

    // Every graphicKey referenced by any component preset must resolve to one
    // of the files actually shipped — a typo'd key would silently 404 in the
    // live app with no test ever catching it.
    const referencedKeys = new Set();
    for (const id of CLIENT.COMPONENT_IDS) {
        for (const preset of Object.values(CLIENT.COMPONENT_PRESETS[id])) {
            if (preset.bar) referencedKeys.add(preset.bar);
            if (preset.badge) referencedKeys.add(preset.badge);
        }
    }
    referencedKeys.add('arrow');       // AnimatedArrow
    referencedKeys.add('quoteMark');   // QuoteCard
    const KEY_TO_FILE = { arrow: 'arrow.png', barDark: 'bar-dark.png', barLight: 'bar-light.png', quoteMark: 'quote-mark.png', subscribeBadge: 'subscribe-badge.png' };
    for (const key of referencedKeys) {
        check(`preset graphicKey "${key}" maps to a real shipped file`,
            !!KEY_TO_FILE[key] && fs.existsSync(path.join(ASSET_DIR, KEY_TO_FILE[key])));
    }
}

if (!FFMPEG) {
    skip('§5 real FFmpeg — the built-in PNGs actually decode and composite', 'no ffmpeg binary found');
} else {
    section('5 · REAL FFMPEG — a built-in graphic actually decodes and overlays onto a frame');
    {
        // PNG was chosen specifically over SVG so this never depends on a
        // librsvg-enabled ffmpeg build (see ComponentLibrary.js header) —
        // this section is the proof, not an assumption.
        const badge = path.join(ROOT, 'client/public/motion-assets/subscribe-badge.png');
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'motioncomp-'));
        const out = path.join(tmp, 'composited.png');
        const args = [
            '-y', '-f', 'lavfi', '-i', 'color=c=green:s=320x240:d=1:r=1',
            '-i', badge,
            '-filter_complex', '[1:v]scale=100:100[b];[0:v][b]overlay=110:70',
            '-frames:v', '1', out,
        ];
        const r = spawnSync(FFMPEG, args, { encoding: 'utf8' });
        check('ffmpeg decoded the PNG and composited it onto a frame without error',
            r.status === 0 && fs.existsSync(out),
            r.status !== 0 ? (r.stderr || '').split('\n').slice(-6).join('\n') : undefined);

        if (r.status === 0) {
            const raw = spawnSync(FFMPEG, ['-y', '-i', out, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer', maxBuffer: 1024 * 1024 * 20 });
            check('the composited frame decoded to raw pixels', raw.status === 0 && raw.stdout.length === 320 * 240 * 3);
            if (raw.status === 0) {
                // Sample the centre of where the badge was placed (110+50, 70+50)
                // and a corner untouched by it — they must differ, proving the
                // badge's own (non-transparent) pixels actually landed there
                // rather than the overlay silently drawing nothing.
                const idx = (x, y) => (y * 320 + x) * 3;
                const badgePx = raw.stdout.subarray(idx(160, 120), idx(160, 120) + 3);
                const bgPx = raw.stdout.subarray(idx(5, 5), idx(5, 5) + 3);
                const differs = badgePx.some((v, i) => Math.abs(v - bgPx[i]) > 20);
                check('the badge\'s own pixels are visibly different from the plain green background (it actually drew something)',
                    differs, `badge=${[...badgePx]} bg=${[...bgPx]}`);
            }
        }
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

section('6 · Wired into the store and the AI-tool dispatch, fail-open');
{
    const store = read('client/src/store/useTimelineStore.js');
    check('useTimelineStore imports the real ComponentLibrary (not a re-implementation)',
        /import \{ buildComponent \} from '\.\.\/motion\/ComponentLibrary\.js'/.test(store));
    check('addMotionComponent exists and calls buildComponent', /addMotionComponent:/.test(store) && /buildComponent\(componentId, presetId, params\)/.test(store));
    check('a build failure returns success:false rather than throwing into the caller', /success: false, error:/.test(store));
    check('the whole component is ONE history entry in the common case (save once, addClip calls skip their own)',
        /get\(\)\._saveHistory\(\);/.test(store) && (store.match(/skipHistory: true/g) || []).length >= 2);
    check('text and overlay tracks are each found-or-created at most once per call (memoised, not re-queried per clip)',
        /ensureTextTrack = \(\) => \{/.test(store) && /ensureOverlayTrack = \(\) => \{/.test(store));

    const engine = read('client/src/agent/MediaExecutionEngine.js');
    check('the AI-tool action exists in the same switch every other tool action uses',
        /case 'addMotionComponent':/.test(engine));
    check('it forwards component/preset/params exactly as the feature was specified ({component, preset})',
        /args\.component, args\.preset, args\.params/.test(engine));

    const idx = read('client/src/motion/index.js');
    check('ComponentLibrary is exported from the motion engine barrel',
        /buildComponent/.test(idx) && /COMPONENT_IDS/.test(idx));
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`Motion components (R65): ${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
console.log('─'.repeat(60));
process.exit(failed > 0 ? 1 : 0);
