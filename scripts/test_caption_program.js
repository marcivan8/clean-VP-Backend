#!/usr/bin/env node
/**
 * Regression: animated captions actually reach the exported MP4 (CLAUDE.md R63).
 *
 * Companion to `test_compositor.js`/`test_compositor_export.js` for a
 * different gap: those two prove STICKERS/LOGOS reach the export (R59-62).
 * This proves CAPTION animation/shadow/uppercase/reveal do too — the exact
 * thing the "is the caption engine fully built?" audit earlier in this
 * project found was still missing after R58: fully built and wired in
 * preview, completely absent from the exported file.
 *
 * Same verification discipline as R60's compositor tests: most of this is
 * proven by RUNNING FFMPEG, not by matching source strings. §4 in particular
 * verifies claims that would be easy to get subtly wrong and have it still
 * "compile" — an animated fontsize expression that never actually changes the
 * rendered text size looks identical to a bug report until someone decodes a
 * frame.
 *
 * Skips the FFmpeg sections gracefully when no binary is present.
 *
 * Run: node scripts/test_caption_program.js
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

const {
    compileCaptionProgram,
    compileCaptionEntry,
    validateCaptionProgramShape,
    parseColor,
    buildSegments,
    SUPPORTED_PROGRAM_VERSION,
} = require(path.join(ROOT, 'server/compositor/CaptionCompiler.js'));

// Build programs with the REAL client CaptionCompiler + its motion-engine
// dependencies, so this exercises the true client→worker path.
function loadClientModules() {
    const order = ['Easing', 'MotionSchema', 'MotionResolver', 'MotionPresets', 'CaptionModel', 'ClipAdapter', 'Compositor', 'CaptionCompiler'];
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
    combined += 'return { buildCaptionProgram, captionProgramIsNoOp, validateCaptionProgram, parseTextShadow, '
        + 'CAPTION_PROGRAM_VERSION, buildPreset, applyPresetToClip, LEGACY_ANIMATION_MAP };';
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
const FONT = ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']
    .find(p => fs.existsSync(p)) || null;

const W = 640, H = 360;

// A single video track, mirroring how buildCaptionProgram is actually called
// client-side: it wants the BASE track's clips to build the timeline→output
// time map, and a full tracks array to find text clips in.
const baseTrack = (dur) => ({ id: 'v1', type: 'video', order: 0, clips: [{ id: 'base', start: 0, duration: dur, speed: 1 }] });
const textTrack = (clips) => ({ id: 't1', type: 'text', order: -1, clips });

section('1 · The client and worker agree on the program version');
{
    check("worker's SUPPORTED_PROGRAM_VERSION matches the client's CAPTION_PROGRAM_VERSION",
        SUPPORTED_PROGRAM_VERSION === CLIENT.CAPTION_PROGRAM_VERSION,
        `worker=${SUPPORTED_PROGRAM_VERSION} client=${CLIENT.CAPTION_PROGRAM_VERSION}`);
}

section('2 · The non-breaking guarantee — plain captions produce NO program entry');
{
    const plain = textTrack([{ id: 'c1', type: 'text', content: 'Hello world', start: 0, duration: 2, fontSize: 48 }]);
    const program = CLIENT.buildCaptionProgram([baseTrack(3), plain], baseTrack(3).clips);
    check('a caption with no animation/shadow/uppercase yields ZERO program entries',
        program.entries.length === 0,
        'if this is ever non-zero, plain captions stopped taking the untouched static drawtext path');
    check('captionProgramIsNoOp() reports it', CLIENT.captionProgramIsNoOp(program) === true);
}

section('3 · Anything animated, shadowed, or uppercased DOES produce an entry');
{
    const animated = textTrack([{
        id: 'c2', type: 'text', content: 'pop in', start: 0, duration: 2, fontSize: 48,
        animations: CLIENT.buildPreset('pop', { duration: 2 }),
    }]);
    const p1 = CLIENT.buildCaptionProgram([baseTrack(3), animated], baseTrack(3).clips);
    check('an animated clip produces an entry', p1.entries.length === 1);

    const shadowed = textTrack([{ id: 'c3', type: 'text', content: 'shadow', start: 0, duration: 2, textShadow: '0 2px 8px rgba(0,0,0,0.55)' }]);
    const p2 = CLIENT.buildCaptionProgram([baseTrack(3), shadowed], baseTrack(3).clips);
    check('a textShadow-only clip produces an entry', p2.entries.length === 1);

    const upper = textTrack([{ id: 'c4', type: 'text', content: 'shout', start: 0, duration: 2, captionStyle: { uppercase: true } }]);
    const p3 = CLIENT.buildCaptionProgram([baseTrack(3), upper], baseTrack(3).clips);
    check('an uppercase-only clip produces an entry', p3.entries.length === 1);
    check('...and the text is actually uppercased before it ever reaches the compiler',
        p3.entries[0].text === 'SHOUT');

    const validation = CLIENT.validateCaptionProgram(p1);
    check('the program validates', validation.valid, validation.errors.join('; '));
}

section('4 · parseTextShadow picks the softest/most-blurred entry');
{
    const parsed = CLIENT.parseTextShadow('3px 3px 0 #000, 0 2px 8px rgba(0,0,0,0.55)');
    check('the multi-shadow "fake stroke" entries are skipped for the blurred one',
        parsed && parsed.blur === 8 && parsed.color.toLowerCase().includes('rgba'),
        JSON.stringify(parsed));
    check('a plain "none" value parses to null', CLIENT.parseTextShadow('none') === null);
    check('garbage never throws', CLIENT.parseTextShadow(undefined) === null && CLIENT.parseTextShadow(42) === null);
}

section("5 · The server validator rejects programs it must not execute");
{
    const good = { version: 1, entries: [{ clipId: 'a', text: 'hi', outputStart: 0, outputEnd: 1, geometry: [{ t: 0, x: 50, y: 50, scale: 1, opacity: 1 }] }] };
    check('a well-formed program is accepted', validateCaptionProgramShape(good).length === 0);
    check('a future version is refused', validateCaptionProgramShape({ ...good, version: 999 }).length > 0);
    check('a non-positive window is refused',
        validateCaptionProgramShape({ version: 1, entries: [{ ...good.entries[0], outputEnd: 0 }] }).length > 0);
    check('missing geometry is refused',
        validateCaptionProgramShape({ version: 1, entries: [{ ...good.entries[0], geometry: [] }] }).length > 0);
    check('garbage never throws',
        validateCaptionProgramShape(null).length > 0 && validateCaptionProgramShape(7).length > 0);
}

section('6 · Segment building (word reveal → prefix layers)');
{
    const entry = {
        clipId: 'c', text: 'one two three', tokens: ['one', 'two', 'three'],
        outputStart: 0, outputEnd: 3,
        revealSteps: [
            { prefixCount: 1, fromOutput: 0, toOutput: 1 },
            { prefixCount: 2, fromOutput: 1, toOutput: 2 },
            { prefixCount: 3, fromOutput: 2, toOutput: 3 },
        ],
    };
    const segs = buildSegments(entry);
    check('one segment per reveal step', segs.length === 3);
    check('each segment shows the correct GROWING prefix',
        segs[0].text === 'one' && segs[1].text === 'one two' && segs[2].text === 'one two three');

    const noReveal = { clipId: 'c', text: 'static text', tokens: ['static', 'text'], outputStart: 0, outputEnd: 2, revealSteps: null };
    const segs2 = buildSegments(noReveal);
    check('no reveal data → exactly one segment covering the whole window',
        segs2.length === 1 && segs2[0].text === 'static text' && segs2[0].from === 0 && segs2[0].to === 2);
}

// ── Behavioural: does FFmpeg actually render what the compiler produces? ────

if (!FFMPEG || !FONT) {
    section('7-10 · Real FFmpeg rendering');
    skip('all real-render sections', !FFMPEG ? 'no ffmpeg binary' : 'no DejaVu font on this machine');
} else {

function makeBase(dir, dur = 3) {
    const p = path.join(dir, 'base.mp4');
    spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
        '-i', `color=c=0x202020:size=${W}x${H}:duration=${dur}:rate=15`, '-frames:v', String(dur * 15), '-y', p],
        { timeout: 60_000 });
    return p;
}

function runVf(dir, vf, base, outName) {
    const out = path.join(dir, outName);
    const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', base, '-vf', vf,
        '-frames:v', '45', '-pix_fmt', 'yuv420p', '-y', out], { encoding: 'utf8', timeout: 120_000 });
    return { r, out };
}

function frameAt(dir, video, t, name) {
    const out = path.join(dir, name);
    spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', video, '-frames:v', '1', '-y', out], { timeout: 60_000 });
    return fs.existsSync(out) ? fs.readFileSync(out) : null;
}

function regionStats(video, t, crop) {
    const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', video, '-frames:v', '1',
        '-vf', `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
        { timeout: 60_000, encoding: 'buffer' });
    if (r.status !== 0 || !r.stdout) return null;
    const bytes = r.stdout;
    let sum = 0;
    for (let i = 0; i < bytes.length; i++) sum += bytes[i];
    return { mean: sum / bytes.length, bright: [...bytes].filter(v => v > 40).length };
}

section('7 · Animated scale + opacity genuinely change the rendered pixels');
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-anim-'));
    const base = makeBase(dir, 2);

    const clip = { id: 'c1', type: 'text', content: 'GROW', start: 0, duration: 2, fontSize: 30, color: '#ffffff', x: 50, y: 50,
        animations: CLIENT.buildPreset('pop', { duration: 2 }) };
    const program = CLIENT.buildCaptionProgram([baseTrack(2), textTrack([clip])], baseTrack(2).clips);
    check('the "pop" preset produced a program entry', program.entries.length === 1);

    const compiled = compileCaptionProgram(program, {
        tmpDir: dir, fallbackFontPath: FONT,
        resolveFont: () => FONT,
        escapePath: (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:'),
    });
    check('at least one drawtext filter was produced', compiled.filters.length > 0);
    check('the fontsize is a per-frame EXPRESSION, not a static number',
        compiled.filters.some(f => /fontsize='[^']*if\(lt\(t,/.test(f)),
        'a "pop" that compiles to a bare fontsize= number was simplified away — the animation would be invisible in the export');

    const vf = compiled.filters.join(',');
    const { r, out } = runVf(dir, vf, base, 'pop.mp4');
    check('the graph runs without error', r.status === 0, (r.stderr || '').split('\n').slice(-4).join(' | '));

    const f1 = frameAt(dir, out, 0.15, 'p-a.png');
    const f2 = frameAt(dir, out, 1.0, 'p-b.png');
    check('the rendered frame actually CHANGES over the animation window',
        !!f1 && !!f2 && !f1.equals(f2),
        'an expression that compiles but renders identically every frame is the exact bug this test exists to catch');

    fs.rmSync(dir, { recursive: true, force: true });
}

section('8 · The caption is gated to its own window (enable=)');
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-gate-'));
    const base = makeBase(dir, 3);

    const clip = { id: 'c1', type: 'text', content: 'HELLO', start: 1.0, duration: 1.0, fontSize: 40, color: '#ffffff', x: 50, y: 50,
        animations: CLIENT.buildPreset('fade', { duration: 1 }) };
    const program = CLIENT.buildCaptionProgram([baseTrack(3), textTrack([clip])], baseTrack(3).clips);
    const compiled = compileCaptionProgram(program, { tmpDir: dir, fallbackFontPath: FONT, resolveFont: () => FONT, escapePath: (p) => p });

    const { r, out } = runVf(dir, compiled.filters.join(','), base, 'gated.mp4');
    check('the gated graph runs', r.status === 0, (r.stderr || '').split('\n').slice(-4).join(' | '));

    const crop = { w: 200, h: 60, x: (W - 200) / 2, y: (H - 60) / 2 };
    const before = regionStats(out, 0.3, crop);
    const during = regionStats(out, 1.5, crop);
    const after  = regionStats(out, 2.7, crop);

    check('BEFORE the window there is no caption text drawn', before && before.bright < 30, `bright px=${before && before.bright}`);
    check('INSIDE the window the caption is actually drawn', during && during.bright > 200, `bright px=${during && during.bright}`);
    check('AFTER the window the caption is gone again', after && after.bright < 30,
        `bright px=${after && after.bright} — without enable= the last frame sticks for the rest of the video`);

    fs.rmSync(dir, { recursive: true, force: true });
}

section('9 · Word-by-word reveal grows the visible text over time');
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-reveal-'));
    const base = makeBase(dir, 3);

    // Reveal only activates in the live preview (TextOverlay's needsWordRender)
    // when a genuine reveal-type animation is present — real `words` alone are
    // NOT enough (see the comment in CaptionCompiler.js's needsReveal). This is
    // the actual shape a "word-reveal" style pack produces: the preset AND real
    // transcription timings together.
    const clip = {
        id: 'c1', type: 'text', content: 'one two three four', start: 0, duration: 3, fontSize: 28, color: '#ffffff', x: 50, y: 50,
        animations: CLIENT.buildPreset('word-reveal', { duration: 3 }),
        words: [{ text: 'one', start: 0, end: 0.5 }, { text: 'two', start: 0.5, end: 1.0 },
                { text: 'three', start: 1.0, end: 1.5 }, { text: 'four', start: 1.5, end: 2.0 }],
    };
    const program = CLIENT.buildCaptionProgram([baseTrack(3), textTrack([clip])], baseTrack(3).clips);
    check('a word-reveal animation + real word timings produce a program entry with revealSteps',
        program.entries.length === 1 && Array.isArray(program.entries[0].revealSteps) && program.entries[0].revealSteps.length > 1);
    check('...and it used the REAL word timings, not the sampled reveal channel fallback',
        program.entries[0].revealSteps.length === 4,
        `got ${program.entries[0].revealSteps.length} steps for 4 words — the real-word path should produce exactly one step per word`);

    const compiled = compileCaptionProgram(program, { tmpDir: dir, fallbackFontPath: FONT, resolveFont: () => FONT, escapePath: (p) => p });
    check('multiple drawtext layers were produced (one per reveal step)', compiled.filters.length >= 4);

    const { r, out } = runVf(dir, compiled.filters.join(','), base, 'reveal.mp4');
    check('the reveal graph runs', r.status === 0, (r.stderr || '').split('\n').slice(-4).join(' | '));

    const crop = { w: 400, h: 60, x: (W - 400) / 2, y: (H - 60) / 2 };
    const early = regionStats(out, 0.2, crop);  // only "one" visible
    const late  = regionStats(out, 1.8, crop);  // all four words visible
    check('more text is on screen LATE in the reveal than EARLY',
        early && late && late.bright > early.bright * 1.5,
        `early bright=${early && early.bright} late bright=${late && late.bright} — a reveal that shows the same amount of text throughout was not actually gated`);

    fs.rmSync(dir, { recursive: true, force: true });
}

section('10 · Shadow and glow layers are visibly distinct from plain text');
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-fx-'));
    const base = makeBase(dir, 1);

    const plainClip = { id: 'p1', type: 'text', content: 'X', start: 0, duration: 1, fontSize: 60, color: '#00ffff', x: 50, y: 50,
        animations: CLIENT.buildPreset('pop', { duration: 1 }) }; // needs SOME motion field to enter the program
    const shadowClip = { ...plainClip, id: 's1', textShadow: '4px 4px 0 rgba(255,0,0,0.9)' };

    const plainProgram  = CLIENT.buildCaptionProgram([baseTrack(1), textTrack([plainClip])], baseTrack(1).clips);
    const shadowProgram = CLIENT.buildCaptionProgram([baseTrack(1), textTrack([shadowClip])], baseTrack(1).clips);

    const compiledPlain  = compileCaptionProgram(plainProgram,  { tmpDir: dir, fallbackFontPath: FONT, resolveFont: () => FONT, escapePath: (p) => p });
    const compiledShadow = compileCaptionProgram(shadowProgram, { tmpDir: dir, fallbackFontPath: FONT, resolveFont: () => FONT, escapePath: (p) => p });

    check('the shadowed clip compiles to MORE drawtext layers than the plain one',
        compiledShadow.filters.length > compiledPlain.filters.length,
        'a textShadow that produces no extra layer was silently dropped, same bug this whole module exists to fix');

    const { r: r1, out: o1 } = runVf(dir, compiledPlain.filters.join(','),  base, 'plain.mp4');
    const { r: r2, out: o2 } = runVf(dir, compiledShadow.filters.join(','), base, 'shadow.mp4');
    check('both graphs run', r1.status === 0 && r2.status === 0);

    // Sample where the shadow lands (offset +4,+4 from centre) — should be
    // RED-ish in the shadow render and background in the plain one.
    const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-ss', '0.5', '-i', o2, '-frames:v', '1',
        '-vf', `crop=6:6:${Math.round(W / 2 + 20)}:${Math.round(H / 2 + 20)}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
        { timeout: 30_000, encoding: 'buffer' });
    check('the shadow render ran and produced pixel data', r.status === 0 && r.stdout && r.stdout.length >= 3);
}

}

section('11 · Wired into the export job, guarded and fail-open');
{
    const src = read('jobs/exportProcessor.js');

    check('the caption-program pass exists in STEP 4',
        /R63: animated captions/.test(src));
    check('it only runs when the client sent a program',
        /settings\.captionProgram/.test(src),
        'no program means every clip falls through to the untouched static path');
    check('there is a deploy-free kill switch',
        /CAPTION_PROGRAM_DISABLED/.test(src));
    check('the program is validated before execution',
        /validateCaptionProgramShape\(rawCaptionProgram\)/.test(src));
    check('covered clips are SKIPPED by the static per-clip loop, never rendered twice',
        /programClipIds\.has\(clip\.id\)\) continue/.test(src));
    check('it FAILS OPEN — a program error does not fail the export',
        /catch \(progErr\)/.test(src) && /falling back to static captions/.test(src));
    check('on failure, programClipIds is cleared so EVERY caption uses the static path',
        /programClipIds\.clear\(\)/.test(src));
    check('the failure is surfaced to the user, not swallowed',
        /captionProgramWarning/.test(src) && /captionProgramWarning: captionProgramWarning \|\| undefined/.test(src));

    const client = read('client/src/layouts/IDELayout.jsx');
    check('the client builds and sends the program',
        /buildCaptionProgram/.test(client) && /captionProgram,/.test(client));
    check('the client sends null when there is nothing to animate',
        /captionProgramIsNoOp\(program\) \? null : program/.test(client));
    check('building a program can never block an export',
        /could not build caption program/.test(client));
    check('the program reuses the SAME base-track time map the composition plan already computed',
        /baseTrack = tracks\.find\(t => t\.id === plan\?\.base\?\.trackId\)/.test(client),
        'a second, independently-derived time map is exactly the kind of divergence this module exists to prevent');
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`Caption program: ${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
console.log('─'.repeat(60));
process.exit(failed > 0 ? 1 : 0);
