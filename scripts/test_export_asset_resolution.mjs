// scripts/test_export_asset_resolution.mjs
//
// R104 — three ways the EXPORT silently lost work the editor had already done.
//
// All three were reported from one render, and none of them is a motion-engine
// bug: the timeline was correct, the preview was correct, and the renderer
// threw the result away on the way out.
//
//   1. EVERY generated sound effect was dropped. The SFX library ships as
//      static files beside the SPA build, so a cue's `preview_url` is a
//      ROOT-RELATIVE `/sfx-library/<file>` path. `fetchClipSource` matched
//      none of its five branches against that shape — no asset row, no GCS
//      object, step 4 needs `startsWith('http')`, step 5 needs `/api/proxy/`
//      — so it returned null and the export reported "Could not find:
//      Cinematic Impact, Metal Impact, ...". routes/waveformRoutes.js had
//      already solved exactly this for the same clips.
//
//   2. ONE unregisterable font lost EVERY raster caption. The font
//      pre-registration loop in prepareRasterCaptions ran OUTSIDE the
//      per-entry try/catch, so a single bad file threw past the `skipped`
//      mechanism that exists precisely to let one caption fail alone. With
//      PARITY_ALL_TEXT = true that is the whole look of the video.
//
//   3. The reason was swallowed. When the raster FFmpeg pass failed, the user
//      was told "Rotated/highlighted captions were exported as plain text."
//      with no cause at all — the actual error stopped in a worker log.
import assert from 'assert/strict';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

let failures = 0;
const log = console.log;
function check(name, fn) {
    try { fn(); log(`  ✓ ${name}`); }
    catch (err) { failures += 1; log(`  ✗ ${name}\n      ${err.message}`); }
}

const WP = require_('../utils/waveformPath.js');

log('\n── 1. Bundled sound effects resolve on the render worker ──');

check('the /sfx-library/ URL shape is recognised, and nothing else is', () => {
    assert.equal(WP.resolveStaticAudioPath('/sfx-library/bass-drop-01.mp3'), 'sfx-library/bass-drop-01.mp3');
    assert.equal(WP.resolveStaticAudioPath('/sfx-library/Whoosh%201.mp3?v=2'), 'sfx-library/Whoosh 1.mp3');
    for (const bad of [null, undefined, 42, '', 'https://cdn.example.com/a.mp3', '/uploads/a.mp3',
        '/sfx-library/../secret', '/sfx-library/%2e%2e%2fsecret', '/sfx-library/a/b.mp3', '/sfx-library/.env']) {
        assert.equal(WP.resolveStaticAudioPath(bad), null, `${JSON.stringify(bad)} was accepted`);
    }
});

check('every file actually in the library resolves to a real path on disk', () => {
    const dir = path.join(ROOT, 'client/public/sfx-library');
    const names = existsSync(dir) ? readdirSync(dir).filter(n => /\.(mp3|wav|m4a|ogg)$/i.test(n)) : [];
    assert.ok(names.length > 0, 'the bundled SFX library is empty — nothing to resolve');
    const unresolved = names.filter(n => !WP.resolveStaticAudioFile(WP.resolveStaticAudioPath(`/sfx-library/${encodeURIComponent(n)}`)));
    assert.deepEqual(unresolved, [], `${unresolved.length} library file(s) did not resolve: ${unresolved.slice(0, 3).join(', ')}`);
});

check('a missing file is null, not a path that does not exist', () => {
    assert.equal(WP.resolveStaticAudioFile('sfx-library/definitely-not-here-9f3a.mp3'), null);
    assert.equal(WP.resolveStaticAudioFile(null), null);
});

check('the exporter resolves them, through the SAME helper as the waveform route', () => {
    // Two copies of "where the library lives" is the drift class this codebase
    // keeps counting — and it is what made the waveform route work while the
    // exporter dropped the very same clips.
    const exp = read('jobs/exportProcessor.js');
    assert.match(exp, /require\('\.\.\/utils\/waveformPath'\)/, 'the exporter does not use the shared resolver');
    assert.match(exp, /resolveStaticAudioPath\(candidateUrl\)/, 'the exporter never tries the /sfx-library/ shape');
    assert.match(exp, /resolveStaticAudioFile\(staticRel\)/, 'the exporter never reads the file from disk');

    const route = read('routes/waveformRoutes.js');
    assert.match(route, /resolveStaticAudioFile/, 'the waveform route lost its resolution');
    assert.ok(!/const STATIC_AUDIO_ROOTS = \[/.test(route), 'the route still defines its own copy of the roots');
});

check('the resolution happens before the exporter gives up', () => {
    // Order is the whole bug: every earlier branch already failed for this URL
    // shape, so a branch added after the final `return null` would change
    // nothing at all.
    const exp = read('jobs/exportProcessor.js');
    const resolveAt = exp.indexOf('resolveStaticAudioPath(candidateUrl)');
    const giveUpAt = exp.indexOf('Cannot resolve source for clip');
    assert.ok(resolveAt > 0 && giveUpAt > 0, 'could not locate both points');
    assert.ok(resolveAt < giveUpAt, 'the static-audio branch sits after the exporter has already given up');
});

log('\n── 2. One bad font no longer loses every caption ──');

const RC = require_('../server/compositor/RasterCaptionCompiler.js');
const { mkdtempSync, writeFileSync } = await import('fs');
const os = await import('os');

const GOOD_FONT = path.join(ROOT, 'client/public/fonts/Anton-Regular.ttf');
const rasterEntry = (clipId, fontFamily) => ({
    clipId,
    text: 'Voici une technique',
    tokens: ['Voici', 'une', 'technique'],
    outputStart: 0,
    outputEnd: 2,
    style: { fontFamily, fontSize: 64, color: '#ffffff' },
    geometry: [
        { t: 0, x: 50, y: 50, scale: 1, opacity: 1, rotation: 0 },
        { t: 2, x: 50, y: 50, scale: 1, opacity: 1, rotation: 0 },
    ],
    raster: {
        layout: { widthFrac: 0.8, align: 'center' },
        font: { weight: '700' },
        textShadow: null, highlight: null, emphasis: null, wordStates: null,
    },
});

check('a font that will not register skips its own caption and no other', () => {
    // The defect: `aliasFor()` was called in a pre-registration loop OUTSIDE
    // the per-entry try/catch, so this threw straight out of
    // prepareRasterCaptions. exportProcessor caught it, set rasterPrepared to
    // null, and EVERY caption — nineteen of them in the reported export —
    // fell back to one unwrapped drawtext line.
    assert.ok(existsSync(GOOD_FONT), 'the test needs a real font file');
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'rcap-'));
    const bad = path.join(tmp, 'not-a-font.ttf');
    writeFileSync(bad, 'this is not a font at all');

    const out = RC.prepareRasterCaptions(
        [rasterEntry('a', 'Good'), rasterEntry('b', 'Broken'), rasterEntry('c', 'Good')],
        {
            tmpDir: tmp, frameWidth: 1080, frameHeight: 1920, pxScale: 1, fallbackFontPath: null,
            resolveFont: (f) => (f === 'Good' ? GOOD_FONT : (f === 'Broken' ? bad : null)),
        },
    );
    assert.deepEqual(out.items.map(i => i.clipId), ['a', 'c'], 'the good captions did not survive the bad one');
    assert.equal(out.skipped.length, 1, `skipped ${JSON.stringify(out.skipped)}`);
    assert.equal(out.skipped[0].clipId, 'b');
    assert.match(out.skipped[0].reason, /font could not be loaded/, 'the skip gives no usable reason');
});

check('an entry with no font at all is skipped the same way', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'rcap-'));
    const out = RC.prepareRasterCaptions(
        [rasterEntry('a', 'Good'), rasterEntry('b', 'Missing')],
        {
            tmpDir: tmp, frameWidth: 1080, frameHeight: 1920, pxScale: 1, fallbackFontPath: null,
            resolveFont: (f) => (f === 'Good' ? GOOD_FONT : null),
        },
    );
    assert.deepEqual(out.items.map(i => i.clipId), ['a']);
    assert.deepEqual(out.skipped, [{ clipId: 'b', reason: 'no font' }]);
});

check('the per-entry skip list is reported to the user, not only to the log', () => {
    // A skipped entry still ships — as one unwrapped line with no highlight
    // and no rotation. That difference is immediately visible, and the user
    // had no way to know it was expected.
    const exp = read('jobs/exportProcessor.js');
    const at = exp.indexOf('rasterPrepared.skipped.length > 0');
    assert.ok(at > 0, 'the skip branch is gone');
    const block = exp.slice(at, at + 1200);
    assert.match(block, /captionProgramWarning\s*=/, 'the skipped captions are still only logged');
});

log('\n── 3. A failure says why ──');

const exportSrc = read('jobs/exportProcessor.js');
const firstFfmpegError = (() => {
    const m = /function firstFfmpegError\(message\)[\s\S]*?\n}/.exec(exportSrc);
    assert.ok(m, 'firstFfmpegError is missing');
    // eslint-disable-next-line no-eval
    return eval(`(${m[0].replace('function firstFfmpegError', 'function')})`);
})();

check('the diagnosis is picked out of the ffmpeg banner', () => {
    const stderr = [
        'ffmpeg version 6.0 Copyright (c) 2000-2023',
        '  built with gcc 12',
        '  configuration: --enable-gpl',
        'Input #0, mov,mp4,m4a',
        '  Duration: 00:00:14.02',
        '  Stream #0:0(und): Video: h264',
        '[concat @ 0x55f] Impossible to open \'/tmp/x/rcap-3.png\'',
        'Conversion failed!',
    ].join('\n');
    assert.match(firstFfmpegError(stderr), /Impossible to open/, 'it reported the banner or the generic trailer');
});

check('"Conversion failed!" is the last resort, never the first answer', () => {
    // It is the trailer ffmpeg prints AFTER the line that explains the
    // failure, so reporting it is the same dead end as reporting nothing.
    assert.match(firstFfmpegError('ffmpeg version 6.0\nToo many inputs specified\nConversion failed!'), /Too many inputs/);
    assert.equal(firstFfmpegError('ffmpeg version 6.0\nConversion failed!'), 'Conversion failed!');
});

check('nothing useful still answers something, and never throws', () => {
    for (const junk of ['', null, undefined, '   ', 'spawn ENOENT']) {
        const got = firstFfmpegError(junk);
        assert.equal(typeof got, 'string');
        assert.ok(got.length > 0, `${JSON.stringify(junk)} produced an empty reason`);
    }
    assert.ok(firstFfmpegError('x'.repeat(5000)).length <= 300, 'the reason is not capped');
});

check('the raster-pass warning carries the reason', () => {
    // It used to be exactly 'Rotated/highlighted captions were exported as
    // plain text.' — a full stop where the cause should have been. That is
    // the message the reported export showed, and it is why the cause had to
    // be reconstructed from the source rather than read off the screen.
    assert.ok(
        !/captionProgramWarning = 'Rotated\/highlighted captions were exported as plain text\.';/.test(exportSrc),
        'the reasonless warning is still there',
    );
    const at = exportSrc.indexOf('raster caption pass failed');
    assert.ok(at > 0, 'the raster-pass catch is gone');
    const block = exportSrc.slice(at, at + 1400);
    assert.match(block, /firstFfmpegError\(rasterErr\.message\)/, 'the catch does not surface the ffmpeg reason');
});

log(failures === 0 ? '\n✅ export asset resolution: all checks passed\n' : `\n❌ ${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
