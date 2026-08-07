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

console.log(`\n${'─'.repeat(60)}`);
console.log(`LUT export: ${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
console.log('─'.repeat(60));
process.exit(failed > 0 ? 1 : 0);
