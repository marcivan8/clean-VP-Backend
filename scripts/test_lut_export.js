#!/usr/bin/env node
/**
 * Regression: LUT colour grade reaches the EXPORT (CLAUDE.md R55).
 *
 * `projectLUTId` was stored in the timeline store and read by nobody —
 * server/lut-engine/library/LUTExportIntegration.js has always known how to
 * download a .cube and build the lut3d filter, and nothing ever called it. So
 * selecting a LUT changed no pixel anywhere. Sixth instance of the
 * built-but-never-wired pattern (R33, R37, /api/brain/organize, R46, R52).
 *
 * Unusually for this codebase, part of this is verified by RUNNING FFMPEG: the
 * filter either grades the frame or it doesn't, and that is cheap to prove.
 * Skips the ffmpeg sections gracefully when no binary is available so CI
 * without ffmpeg still runs the wiring checks.
 *
 * Run: node scripts/test_lut_export.js
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
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const exportSrc = read('jobs/exportProcessor.js');
const lutSvcSrc = read('server/lut-engine/library/LUTService.js');
const ideSrc    = read('client/src/layouts/IDELayout.jsx');

function ffmpegBin() {
    for (const bin of ['ffmpeg', '/usr/bin/ffmpeg']) {
        const r = spawnSync(bin, ['-version'], { encoding: 'utf8' });
        if (r.status === 0) return bin;
    }
    try { return require('ffmpeg-static'); } catch { return null; }
}

section('1 · The export job resolves and applies the LUT');
{
    check('the exporter imports LUTExportIntegration',
        /require\(['"]\.\.\/server\/lut-engine\/library\/LUTExportIntegration\.js['"]\)/.test(exportSrc),
        'the module existed and was called by nothing');

    check('it reads projectLUTId from settings or timeline',
        /settings\.projectLUTId \|\| timeline\?\.projectLUTId/.test(exportSrc));

    check('the filter is pushed into the per-clip chain',
        /if \(lutFilter\) vFilters\.push\(lutFilter\);/.test(exportSrc));

    // Order matters: grading before scale/pad would grade the padding bars too.
    const pushIdx  = exportSrc.indexOf('if (lutFilter) vFilters.push(lutFilter);');
    const joinIdx  = exportSrc.indexOf('cmd.videoFilters(vFilters.join(\',\'))');
    check('the LUT is appended LAST, just before the chain is applied',
        pushIdx !== -1 && joinIdx !== -1 && pushIdx < joinIdx && (joinIdx - pushIdx) < 400,
        'grading before scale/pad would tint the letterbox bars');
}

section('2 · It fails OPEN — an export must never die over a colour grade');
{
    const start = exportSrc.indexOf('let lutFilter = null;');
    const block = exportSrc.slice(start, start + 1200);

    check('the lookup is wrapped in try/catch', /catch \(lutErr\)/.test(block));
    check('a failure leaves lutFilter null', /lutFilter = null;/.test(block));
    check('the failure path is logged, not thrown',
        /exporting ungraded/.test(block),
        'an ungraded video is a far better outcome than no video');

    const integ = read('server/lut-engine/library/LUTExportIntegration.js');
    check('getLUTFilterForExport returns null rather than throwing',
        /return null;/.test(integ) && /catch \(err\)/.test(integ));
}

section('3 · The client actually sends the selection');
{
    check('projectLUTId is read from the store',
        /const \{ tracks, duration, assets, projectLUTId \} = useTimelineStore\.getState\(\)/.test(ideSrc));
    check('it is included in the export settings',
        /projectLUTId: projectLUTId \|\| null/.test(ideSrc),
        'without this the worker never learns a LUT was chosen');
}

section('4 · The filter string is well-formed');
{
    check('buildFFmpegFilter emits a bare lut3d filter',
        /return `lut3d='\$\{escaped\}'`/.test(lutSvcSrc),
        'a bare filter is required — it gets comma-joined into a filter chain');
    check('it returns null without a path', /if \(!lutPath\) return null;/.test(lutSvcSrc));
}

// ── Behavioural: does the filter actually work? ─────────────────────────────
const FFMPEG = ffmpegBin();

section('5 · FFmpeg accepts the exact chain the exporter builds');
if (!FFMPEG) {
    skip('chain executes', 'no ffmpeg binary available');
} else {
    const dir  = fs.mkdtempSync(path.join(os.tmpdir(), 'lut-test-'));
    const cube = path.join(dir, 'warm.cube');
    // 2x2x2 identity-with-a-lift: red floor raised, green/blue pulled down.
    fs.writeFileSync(cube, [
        'TITLE "Test"', 'LUT_3D_SIZE 2',
        '0.15 0.0 0.0', '1.0 0.0 0.0', '0.15 0.85 0.0', '1.0 0.85 0.0',
        '0.15 0.0 0.55', '1.0 0.0 0.55', '0.15 0.85 0.55', '1.0 0.85 0.55',
    ].join('\n'));

    // Exactly what buildScaleFilter + the LUT push produce, in order.
    const chain =
        'scale=320:180:force_original_aspect_ratio=decrease,' +
        'pad=320:180:(ow-iw)/2:(oh-ih)/2,setsar=1,' +
        `lut3d='${cube.replace(/:/g, '\\:')}'`;

    const out = path.join(dir, 'out.mp4');
    const r = spawnSync(FFMPEG, [
        '-f', 'lavfi', '-i', 'testsrc=size=320x180:duration=1:rate=10',
        '-vf', chain, '-frames:v', '3', '-y', out,
    ], { encoding: 'utf8', timeout: 60_000 });

    check('the full filter chain runs without error', r.status === 0,
        (r.stderr || '').split('\n').slice(-3).join(' | '));
    check('it produces a non-empty file',
        fs.existsSync(out) && fs.statSync(out).size > 0);

    // The point of a LUT is that pixels CHANGE. A filter that runs cleanly and
    // alters nothing would be indistinguishable from the bug being fixed.
    const plain  = path.join(dir, 'plain.png');
    const graded = path.join(dir, 'graded.png');
    spawnSync(FFMPEG, ['-f', 'lavfi', '-i', 'color=c=gray:size=64x64:duration=0.1:rate=1',
        '-frames:v', '1', '-y', plain], { timeout: 30_000 });
    spawnSync(FFMPEG, ['-f', 'lavfi', '-i', 'color=c=gray:size=64x64:duration=0.1:rate=1',
        '-vf', `lut3d='${cube.replace(/:/g, '\\:')}'`, '-frames:v', '1', '-y', graded], { timeout: 30_000 });

    const a = fs.existsSync(plain)  ? fs.readFileSync(plain)  : null;
    const b = fs.existsSync(graded) ? fs.readFileSync(graded) : null;
    check('the LUT actually changes the pixels',
        !!a && !!b && !a.equals(b),
        'a filter that runs but grades nothing is the same as no filter at all');

    fs.rmSync(dir, { recursive: true, force: true });
}

section('6 · The PREVIEW is graded too, not just the export');
{
    const player = read('client/src/components/Player/VideoPlayer.jsx');
    const hook   = read('client/src/hooks/useAudioEngine.js');

    check('applyLUT stores a CSS filter for the editor',
        /projectLUTId: lutId, projectLUTFilter: cssFilter/.test(hook));
    check('the player subscribes to it',
        /useTimelineStore\(state => state\.projectLUTFilter\)/.test(player),
        'getState() would not re-render on apply — the immediacy is the point');
    check('the canvas actually applies it',
        /filter: projectLUTFilter \|\| 'none'/.test(player),
        'the filter was stored and never used — clicking a LUT changed nothing visible');
    check('the ungraded path stays neutral',
        /\|\| 'none'/.test(player),
        "'none' is a valid CSS filter and costs nothing");
}

// ── 7 · Parameter-based LUTs (R55b) ─────────────────────────────────────────
// The seeded library has NO .cube files — the `luts` table has no gcs_path
// column at all — so lut3d can never apply to a built-in LUT. Without a
// parametric fallback every built-in grade exported ungraded while the preview
// looked correct.
section('7 · Built-in (parameter-based) LUTs still grade the export');
{
    const svcSrc = read('server/lut-engine/library/LUTService.js');
    const fnSrc  = svcSrc.slice(
        svcSrc.indexOf('buildParametricFilter(lut) {'),
        svcSrc.indexOf('buildFFmpegFilter(lutId, lutPath)'));
    const build = new Function('lut',
        fnSrc.replace('buildParametricFilter(lut) {', '').replace(/\}\s*$/, ''));

    // Real production row (the "film noir" LUT from the reported error).
    const noir = build({ warmth: -1, contrast: 3, saturation: -3, highlights: 0, shadows: -3 });
    check('a real seeded LUT produces a filter', !!noir, String(noir));
    check('it uses the editor\'s 1 + x/10 contrast mapping',
        /contrast=1\.300/.test(noir), noir);
    check('it uses the editor\'s saturation mapping',
        /saturation=0\.700/.test(noir), noir);
    check('warmth becomes a colour temperature', /colortemperature=temperature=/.test(noir));

    // LOWER Kelvin is warmer, so positive warmth must lower it from 6500.
    const warm = build({ warmth: 3, contrast: 0, saturation: 0, highlights: 0, shadows: 0 });
    const cool = build({ warmth: -3, contrast: 0, saturation: 0, highlights: 0, shadows: 0 });
    const kOf  = (f) => parseInt((f.match(/temperature=(\d+)/) || [])[1], 10);
    check('positive warmth lowers Kelvin (warmer)', kOf(warm) < 6500, String(kOf(warm)));
    check('negative warmth raises Kelvin (cooler)', kOf(cool) > 6500, String(kOf(cool)));

    // An all-neutral LUT must add NO filter — a no-op still costs a decode pass.
    check('a fully neutral LUT yields null',
        build({ warmth: 0, contrast: 0, saturation: 0, highlights: 0, shadows: 0 }) === null);
    check('null/garbage input is handled', build(null) === null);

    const integ = read('server/lut-engine/library/LUTExportIntegration.js');
    check('the export falls back to the parametric grade when there is no .cube',
        /buildParametricFilter\(lut\)/.test(integ),
        'without this every built-in LUT exports ungraded');

    if (FFMPEG) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lut-param-'));
        const out = path.join(dir, 'o.mp4');
        const chain =
            'scale=320:180:force_original_aspect_ratio=decrease,' +
            'pad=320:180:(ow-iw)/2:(oh-ih)/2,setsar=1,' + noir;
        const r = spawnSync(FFMPEG, ['-f', 'lavfi', '-i', 'testsrc=size=320x180:duration=1:rate=10',
            '-vf', chain, '-frames:v', '3', '-y', out], { encoding: 'utf8', timeout: 60_000 });
        check('the parametric chain runs in the real exporter shape', r.status === 0,
            (r.stderr || '').split('\n').slice(-3).join(' | '));

        const a = path.join(dir, 'a.png'), b = path.join(dir, 'b.png');
        spawnSync(FFMPEG, ['-f', 'lavfi', '-i', 'color=c=0x808080:size=64x64:duration=0.1:rate=1',
            '-frames:v', '1', '-y', a], { timeout: 30_000 });
        spawnSync(FFMPEG, ['-f', 'lavfi', '-i', 'color=c=0x808080:size=64x64:duration=0.1:rate=1',
            '-vf', noir, '-frames:v', '1', '-y', b], { timeout: 30_000 });
        check('the parametric grade actually changes the pixels',
            fs.existsSync(a) && fs.existsSync(b) && !fs.readFileSync(a).equals(fs.readFileSync(b)),
            'a grade that runs but changes nothing is the bug it replaced');
        fs.rmSync(dir, { recursive: true, force: true });
    } else {
        skip('parametric chain executes', 'no ffmpeg binary');
    }
}

// ── 8 · The LUT lands on the CLIPS, via the engine's real grading path ──────
// The canvas CSS filter alone was not enough. Nothing in the app had ever
// written `clip.grading`, yet VideoPlayer reads it every frame and pushes it
// into the engine's brightness/contrast/saturation/hue uniforms — a live,
// proven path sitting unused while the LUT tried to grade some other way.
section('8 · Applying a LUT grades the clips themselves');
{
    const panel      = read('client/src/components/AssetPanel.jsx');
    const player     = read('client/src/components/Player/VideoPlayer.jsx');
    // R75 — lutToGrading() moved out of AssetPanel.jsx into a shared util so
    // the manual Colour-panel path and the AI's VideoEditorTools.applyLUT()
    // path compute the identical grade from ONE formula instead of two that
    // could drift apart. The formula lives here now, not inline in the panel.
    const lutGrading = read('client/src/utils/lutGrading.js');

    check('the panel converts LUT params into a grading object',
        /lutToGrading/.test(panel));
    check('it uses the editor\'s 1 + x/10 mapping',
        /1 \+ n\(lut\.contrast\)\s*\/ 10/.test(lutGrading),
        'so preview, canvas filter and FFmpeg export all agree');
    check('grading is written onto video clips',
        /updateClip\?\.\(track\.id, clip\.id, \{ grading \}\)/.test(panel));
    check('clearing a LUT clears the grading',
        /const grading = clearing \? null :/.test(panel),
        'leaving a stale grade behind would make the LUT impossible to remove');
    check('the project id is still set for the export',
        /await applyLUT\(lut\.id\)/.test(panel),
        'the export reads projectLUTId (R55/R55b)');

    // The consuming half must stay intact or the grade goes nowhere.
    check('VideoPlayer still forwards clip.grading to the engine',
        /engineRef\.current\.setGrading\(\{/.test(player)
        && /activeClip\.grading\.contrast/.test(player));
    check('grading is part of the engine-relevant clip memo',
        /grading:\s*activeClip\.grading/.test(player),
        'excluding it would stop the engine seeing grade changes');
}

// ── 9 · The LUT grade is per-clip editable from the Colour panel (R55d) ────
// §8 wired a LUT onto clip.grading, but the Colour panel could not yet show
// or protect that per-clip. Two real gaps surfaced when actually wiring it
// up: the hueRotate slider ran 0..360 so a LUT's negative hue shift
// (lutToGrading's warmth mapping) couldn't be dragged from where it truly
// started, and applying/clearing a LUT overwrote EVERY video clip
// unconditionally — a user's manual per-clip tweak was one accidental
// re-click of the LUT card away from being wiped out project-wide.
section('9 · The Colour panel can edit a LUT grade per clip, safely');
{
    const panel      = read('client/src/components/AssetPanel.jsx');
    const ide        = read('client/src/layouts/IDELayout.jsx');
    // Same R75 move as §8 — the formula (and _lutName) now live in the
    // shared util, not inline in the panel.
    const lutGrading = read('client/src/utils/lutGrading.js');

    check('the LUT grade carries its name for the Colour panel badge',
        /_lutName:\s*lut\.name \|\| lut\.display_name \|\| null/.test(lutGrading));

    check('handleLUTApply skips clips the user has manually adjusted',
        /if \(clip\.grading\?\.\_manuallyAdjusted\) \{ skipped\+\+; continue; \}/.test(panel),
        'without this, applying/clearing a LUT wipes every per-clip tweak project-wide');

    check('a manual slider edit marks the clip as manually adjusted',
        /const newGrading = \{ \.\.\.currentGrading, \[key\]: value, _manuallyAdjusted: true \};/.test(ide));
    check('a selective-colour edit does too',
        /grading: \{ \.\.\.currentGrading, selective: newSelective, _manuallyAdjusted: true \}/.test(ide));

    check('the hue slider range covers negative values',
        /key:\s*'hueRotate'[^}]*min:\s*-180,\s*max:\s*180/.test(ide),
        "lutToGrading's warmth mapping can be negative; a 0..360 range can't reach it");

    check('the Colour panel shows which LUT a clip is based on',
        /activeClip\.grading\?\.\_lutId/.test(ide) && /colorGrading\.basedOnLut/.test(ide));

    const enLocale = JSON.parse(read('client/src/locales/en/editor.json'));
    const frLocale = JSON.parse(read('client/src/locales/fr/editor.json'));
    check('the "based on LUT" string exists in both shipped locales',
        !!enLocale?.ideLayout?.colorGrading?.basedOnLut && !!frLocale?.ideLayout?.colorGrading?.basedOnLut);
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`LUT export: ${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
console.log('─'.repeat(60));
process.exit(failed > 0 ? 1 : 0);
