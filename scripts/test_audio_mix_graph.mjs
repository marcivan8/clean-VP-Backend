// scripts/test_audio_mix_graph.mjs
//
// R104b — the export died with
// `ffmpeg exited with code 234: Error binding filtergraph inputs/outputs:
// Invalid argument` as soon as sound effects started resolving.
//
// TWO separate defects in STEP 3's audio mix, both verified against a real
// ffmpeg before this test was written:
//
//   1. `[0:a]` ON A SILENT BASE KILLS THE WHOLE EXPORT. It is not an empty
//      mix — ffmpeg refuses the entire filtergraph ("Stream specifier ':a'
//      matches no streams" → "Error initializing complex filters: Invalid
//      argument", which is the same class the reported export showed). This
//      hid for a long time because every bundled sound effect was dropped by
//      fetchClipSource before reaching here (R104 §1), so with no segments
//      the step never ran. Fixing that resolution made the step run, and it
//      took the export down with it.
//
//   2. THE OUTPUT HAD NO VIDEO. `complexFilter(fc, 'aout')` emits only
//      `-map [aout]`, and ANY `-map` turns off ffmpeg's default stream
//      selection — so `.videoCodec('copy')` was silently a no-op and the
//      mixed file came out audio-only. Measured: `streams=audio` with a
//      base that had both. Every project that ever reached this step — a
//      music track, a voice-over — lost its picture.
//
// Both were confirmed by running the exact argument list fluent-ffmpeg
// generates, before and after:
//   before, silent base   → Invalid argument, no output
//   before, base w/ audio → streams=audio          (picture gone)
//   after,  both cases    → streams=video+audio    (correct duration)
import assert from 'assert/strict';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
process.env.SUPABASE_URL ||= 'http://localhost';
process.env.SUPABASE_SERVICE_KEY ||= 'test';
process.env.SUPABASE_ANON_KEY ||= 'test';

const log = console.log;
console.log = () => {}; console.warn = () => {}; console.error = () => {};
const EP = require_('../jobs/exportProcessor.js');
console.log = log;

let failures = 0;
function check(name, fn) {
    try { fn(); log(`  ✓ ${name}`); }
    catch (err) { failures += 1; log(`  ✗ ${name}\n      ${err.message}`); }
}

const { buildAudioMixGraph } = EP;
const seg = (startTime) => ({ path: `/tmp/a-${startTime}.aac`, startTime });

log('\n── The audio-mix filtergraph ──');

check('it is exported at all', () => {
    assert.equal(typeof buildAudioMixGraph, 'function', 'the graph is still inline and untestable');
});

check('a silent base never references [0:a]', () => {
    // THE crash. Any mention of input 0's audio on a base that has none makes
    // ffmpeg reject the whole graph and fail the export outright.
    const g = buildAudioMixGraph([seg(0), seg(1.25)], false);
    assert.ok(!g.includes('[0:a]'), `the silent-base graph still reads input 0's audio:\n${g}`);
    assert.ok(!g.includes('[va]'), 'it still builds a base-audio label');
    assert.match(g, /amix=inputs=2:/, `expected 2 inputs (the segments alone), got:\n${g}`);
});

check('a base WITH audio still mixes against it, unchanged', () => {
    const g = buildAudioMixGraph([seg(0), seg(1.25)], true);
    assert.ok(g.startsWith('[0:a]volume=1[va];'), `base audio is no longer the anchor:\n${g}`);
    assert.match(g, /\[va\]\[da0\]\[da1\]amix=inputs=3:duration=first:dropout_transition=0\[aout\]/, g);
});

check('each segment is delayed to its own start, in milliseconds', () => {
    const g = buildAudioMixGraph([seg(0), seg(1.25), seg(12.4567)], true);
    assert.match(g, /\[1:a\]adelay=0\|0\[da0\]/, g);
    assert.match(g, /\[2:a\]adelay=1250\|1250\[da1\]/, g);
    // Rounded, not truncated and not left as a float — adelay rejects decimals.
    assert.match(g, /\[3:a\]adelay=12457\|12457\[da2\]/, g);
    assert.ok(!/adelay=\d+\.\d/.test(g), `a fractional delay would be rejected by adelay:\n${g}`);
});

check('the input count always matches the labels fed to amix', () => {
    // A mismatch here is the other way to get "Invalid argument".
    for (const n of [1, 2, 5, 12]) {
        for (const baseHasAudio of [true, false]) {
            const g = buildAudioMixGraph(Array.from({ length: n }, (_, i) => seg(i * 0.5)), baseHasAudio);
            const declared = Number(/amix=inputs=(\d+)/.exec(g)[1]);
            // Each [daN] appears exactly twice: once defined by adelay, once
            // consumed by amix.
            const labels = (g.match(/\[da\d+\]/g) || []).length / 2;
            assert.equal(labels, n, `${n} segment(s) produced ${labels} delay label(s)`);
            assert.equal(declared, baseHasAudio ? n + 1 : n,
                `amix declares ${declared} input(s) for ${n} segment(s), baseHasAudio=${baseHasAudio}`);
        }
    }
});

check('one segment on a silent base is still a valid graph', () => {
    // amix=inputs=1 is legal, and this is the common Reel case: a handful of
    // sound effects over a base whose audio was already flattened away.
    const g = buildAudioMixGraph([seg(0.4)], false);
    assert.equal(g, '[1:a]adelay=400|400[da0];[da0]amix=inputs=1:duration=longest:dropout_transition=0[aout]');
});

check('duration is anchored so a late sound effect cannot extend the video', () => {
    assert.match(buildAudioMixGraph([seg(0)], true), /duration=first/, 'with base audio the base must govern');
    assert.match(buildAudioMixGraph([seg(0)], false), /duration=longest/, 'with no base audio the segments are all there is');
});

log('\n── The maps: the picture has to be kept ──');

check('both streams are mapped explicitly, video first', () => {
    // `complexFilter(fc, "aout")` emits ONLY `-map [aout]`, and any -map
    // disables default stream selection — so the mixed file came out
    // audio-only while `.videoCodec("copy")` sat there doing nothing.
    const src = require_('fs').readFileSync(new URL('../jobs/exportProcessor.js', import.meta.url), 'utf8');
    const at = src.indexOf('buildAudioMixGraph(audioSegments');
    assert.ok(at > 0, 'the mix step no longer builds its graph here');
    const block = src.slice(at, at + 1800);
    assert.match(block, /'-map',\s*'0:v',\s*'-map',\s*'\[aout\]'/, `the video stream is not mapped:\n${block.slice(0, 400)}`);
    assert.ok(!/\.complexFilter\(filterComplex,\s*'aout'\)/.test(block),
        'complexFilter still passes its own map, which emits only -map [aout]');
});

check('the base is probed before the graph is chosen', () => {
    const src = require_('fs').readFileSync(new URL('../jobs/exportProcessor.js', import.meta.url), 'utf8');
    assert.match(src, /function hasAudioStream\(/, 'nothing probes for an audio stream');
    const probeAt = src.indexOf('const baseHasAudio = await hasAudioStream(');
    const buildAt = src.indexOf('buildAudioMixGraph(audioSegments');
    assert.ok(probeAt > 0 && buildAt > probeAt, 'the graph is chosen before the base is probed');
});

log(failures === 0 ? '\n✅ audio mix graph: all checks passed\n' : `\n❌ ${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
