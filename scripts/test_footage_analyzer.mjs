// scripts/test_footage_analyzer.mjs
//
// R101 PHASE 2 & 3 — client/src/vision/FootageAnalyzer.js reads a palette and
// a subject box off a sampled video frame instead of a fixed per-tone table
// or ignoring the footage altogether. Its video/canvas/model-loading glue
// needs a real browser (same reason MatteBaker.js's bakeMatte itself has no
// unit test here), but the two PURE, DOM-free pieces that actually decide
// the answer — paletteFromPixels and bestDetectionToSubject — are split out
// precisely so they CAN be proven here with synthetic pixel/detection data,
// the same split test_matte_mirrors.mjs already uses for withMirrors.
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;
const log = console.log; console.log = () => {}; console.warn = () => {}; console.info = () => {}; console.error = () => {};

let failures = 0;
async function check(name, fn) {
    try { await fn(); log(`✓ ${name}`); }
    catch (err) { failures += 1; log(`✗ ${name}\n    ${err.message}\n${err.stack}`); }
}

const { tryMirrors, paletteFromPixels, bestDetectionToSubject, analyzeFootageFrame } = await import('../client/src/vision/FootageAnalyzer.js');

const hexToRgb = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const px = (r, g, b, n) => { const out = []; for (let i = 0; i < n; i++) out.push(r, g, b, 255); return out; };

log('\n1 · tryMirrors (same contract as MatteBaker.js\'s withMirrors)');

await check('first mirror succeeding never touches the second', async () => {
    let calls = 0;
    const result = await tryMirrors(['https://a.test/x', 'https://b.test/x'], async (url) => {
        calls += 1;
        assert.equal(url, 'https://a.test/x');
        return 'ok-from-a';
    });
    assert.equal(result, 'ok-from-a');
    assert.equal(calls, 1, 'the second mirror should never have been tried');
});

await check('a failing first mirror falls through to the second, which succeeds', async () => {
    const seen = [];
    const result = await tryMirrors(['https://cdn.jsdelivr.net/x', 'https://unpkg.com/x'], async (url) => {
        seen.push(url);
        if (url.includes('jsdelivr')) throw new Error('blocked');
        return 'ok-from-unpkg';
    });
    assert.equal(result, 'ok-from-unpkg');
    assert.deepEqual(seen, ['https://cdn.jsdelivr.net/x', 'https://unpkg.com/x']);
});

await check('every mirror failing throws one clear error naming what it was reading, and how many sources', async () => {
    await assert.rejects(
        () => tryMirrors(['https://a.test/x', 'https://b.test/x'], async () => { throw new Error('offline'); }),
        (err) => {
            assert.ok(/footage/i.test(err.message), `expected a footage-specific message, got: ${err.message}`);
            assert.ok(/2 sources/.test(err.message));
            assert.ok(err.message.includes('offline'), 'the real underlying error should still be visible');
            return true;
        },
    );
});

log('\n2 · paletteFromPixels — the footage\'s own colour, not a fixed table');

await check('a mostly-red, mid-brightness frame reads as a warm accent with dark-on-light text', () => {
    const data = new Uint8ClampedArray([...px(255, 0, 0, 3), ...px(0, 255, 0, 1)]);
    const result = paletteFromPixels(data, 4, 1);
    assert.ok(result, 'a frame with plenty of saturated pixels should produce a palette');
    const [r, g, b] = hexToRgb(result.accent);
    assert.ok(r > g + 30 && r > b + 30, `expected a red-leaning accent, got ${result.accent}`);
    // Average lightness here is 0.5 (every pixel is a pure, mid-lightness
    // hue), which is NOT "dark", so text/sub should be the bright-frame pair.
    assert.equal(result.text, '#101418');
    assert.equal(result.sub, '#3A4350');
});

await check('a dark, saturated frame reads as a cool accent with light-on-dark text', () => {
    const data = new Uint8ClampedArray(px(20, 20, 150, 6));
    const result = paletteFromPixels(data, 6, 1);
    assert.ok(result);
    const [r, g, b] = hexToRgb(result.accent);
    assert.ok(b > r && b > g, `expected a blue-leaning accent for a dark blue frame, got ${result.accent}`);
    assert.equal(result.text, '#ffffff');
    assert.equal(result.sub, '#E2E8F0');
});

await check('a near-greyscale frame has no colour of its own, so the tone\'s own palette should stand', () => {
    const data = new Uint8ClampedArray([...px(120, 120, 120, 2), ...px(200, 200, 200, 2)]);
    assert.equal(paletteFromPixels(data, 4, 1), null);
});

await check('an empty buffer is handled, not thrown on', () => {
    assert.equal(paletteFromPixels(new Uint8ClampedArray([]), 0, 0), null);
});

log('\n3 · bestDetectionToSubject — a general object box, not only a tracked face');

const FRAME = { w: 320, h: 180 };

await check('the highest-confidence box inside a sane size range wins, both too-small and too-weak boxes are ignored', () => {
    const detections = [
        { bbox: [10, 10, 20, 20], class: 'cup', score: 0.9 },      // too small to matter (area frac < 0.015)
        { bbox: [0, 0, 300, 170], class: 'background', score: 0.3 }, // below the confidence floor
        { bbox: [50, 40, 150, 100], class: 'bottle', score: 0.8 },  // the one that should win
        { bbox: [0, 0, 310, 170], class: 'person', score: 0.5 },    // valid, but lower score than the bottle
    ];
    const subject = bestDetectionToSubject(detections, FRAME.w, FRAME.h);
    assert.ok(subject, 'expected a subject to be found');
    assert.equal(subject.label, 'bottle');
    assert.equal(subject.score, 0.8);
    assert.ok(Math.abs(subject.cx - 125 / 320) < 1e-9);
    assert.ok(Math.abs(subject.cy - 90 / 180) < 1e-9);
    assert.ok(Math.abs(subject.w - 150 / 320) < 1e-9);
    assert.ok(Math.abs(subject.h - 100 / 180) < 1e-9);
});

await check('nothing confident or sized enough means no subject, not a guess', () => {
    const detections = [
        { bbox: [10, 10, 20, 20], class: 'cup', score: 0.99 },
        { bbox: [0, 0, 300, 170], class: 'wall', score: 0.1 },
    ];
    assert.equal(bestDetectionToSubject(detections, FRAME.w, FRAME.h), null);
});

await check('malformed input is handled, not thrown on', () => {
    assert.equal(bestDetectionToSubject(null, FRAME.w, FRAME.h), null);
    assert.equal(bestDetectionToSubject([{ bbox: 'nope', score: 1 }], FRAME.w, FRAME.h), null);
    assert.equal(bestDetectionToSubject([{ bbox: [0, 0, 10, 10], score: 1 }], 0, 0), null);
});

log('\n4 · analyzeFootageFrame — degrades to nothing outside a browser, never throws');

await check('with no document (this Node harness), it resolves to null rather than crashing the command', async () => {
    assert.equal(await analyzeFootageFrame({ sourceUrl: 'https://example.test/clip.mp4', atSeconds: 1 }), null);
    assert.equal(await analyzeFootageFrame({ sourceUrl: '' }), null);
});

log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL FOOTAGE-ANALYZER CHECKS PASSED');
process.exit(failures ? 1 : 0);
