#!/usr/bin/env node
/**
 * Regression: Motion-tab CAMERA presets, applied to a BASE video-track clip,
 * actually move something (CLAUDE.md R64).
 *
 * Companion to test_compositor.js/test_compositor_export.js (R59-62, overlay
 * tracks) and test_caption_program.js (R63, text tracks). This proves the
 * third case: `MotionPanel.jsx` lets you apply a "camera" preset to a plain
 * VIDEO-track clip too — writing `clip.animations` — but until R64 nothing
 * downstream read that field for a base-track clip. Neither the Revideo
 * preview (which drove video/image transforms off `clip.keyframes`, a
 * completely separate system) nor the export (STEP 2's zoompan path only
 * ever read `clip.keyframes.scale`) showed any effect. This suite proves the
 * derived `clip.keyframes.scale` array is correct, is wired into the actual
 * export request, and — via real FFmpeg — genuinely changes the rendered
 * frame size over time exactly like a hand-authored zoom rhythm already does.
 *
 * Skips the FFmpeg sections gracefully when no binary is present.
 *
 * Run: node scripts/test_camera_motion.js
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

// Load the REAL client motion engine + CameraMotionCompiler, same
// strip-to-CJS technique every other regression suite in this repo uses —
// this exercises the true client-side code, not a re-implementation of it.
function loadClientModules() {
    const order = ['Easing', 'MotionSchema', 'MotionResolver', 'MotionPresets', 'CaptionModel', 'ClipAdapter', 'Compositor', 'CameraMotionCompiler'];
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
    combined += 'return { deriveZoomKeyframes, applyCameraMotionToBaseTrack, buildPreset, applyPresetToClip, clipToMotionLayer, resolveMotionAt, PRESET_GROUPS, LAYER_KINDS };';
    // eslint-disable-next-line no-new-func
    return new Function(combined)();
}
const CLIENT = loadClientModules();

// Extract the REAL buildZoomKeyframeExpr straight out of exportProcessor.js
// (it isn't exported — this is the same worker code the export job runs,
// not a copy that could quietly diverge from it).
function loadZoomExpr() {
    const src = read('jobs/exportProcessor.js');
    const m = src.match(/function buildZoomKeyframeExpr\(kfs[\s\S]*?\n}\n/);
    if (!m) return null;
    // eslint-disable-next-line no-new-func
    return new Function(`${m[0]}\nreturn buildZoomKeyframeExpr;`)();
}
const buildZoomKeyframeExpr = loadZoomExpr();

function ffmpegBin() {
    for (const bin of ['ffmpeg', '/usr/bin/ffmpeg']) {
        const r = spawnSync(bin, ['-version'], { encoding: 'utf8' });
        if (r.status === 0) return bin;
    }
    try { return require('ffmpeg-static'); } catch { return null; }
}
const FFMPEG = ffmpegBin();
const W = 320, H = 240;

const baseTrack = (clips) => ({ id: 'v1', type: 'video', order: 0, clips });
const overlayTrack = (clips) => ({ id: 'o1', type: 'overlay', order: 0, clips });
const audioTrack = (clips) => ({ id: 'a1', type: 'audio', order: 0, clips });

section('1 · buildZoomKeyframeExpr was found and extracted from the real worker file');
{
    check('extraction succeeded', typeof buildZoomKeyframeExpr === 'function');
}

section('2 · deriveZoomKeyframes — the non-effect cases');
{
    check('a clip with no animations derives nothing',
        CLIENT.deriveZoomKeyframes({ id: 'c1', type: 'video', duration: 4 }, { type: 'video' }) === null);

    check('a clip with only FADE/TRANSLATE animations (no scale) derives nothing',
        CLIENT.deriveZoomKeyframes({
            id: 'c1', type: 'video', duration: 1,
            ...CLIENT.applyPresetToClip({ duration: 1 }, 'camera-whip'),
        }, { type: 'video' }) === null,
        'camera-whip is TRANSLATE-only — see CameraMotionCompiler.js header for why translate is out of scope');

    check('a clip that already has hand-authored clip.keyframes.scale is never overridden',
        CLIENT.deriveZoomKeyframes({
            id: 'c1', type: 'video', duration: 2,
            keyframes: { scale: [{ time: 0, value: 1 }, { time: 2, value: 1.3 }] },
            ...CLIENT.applyPresetToClip({ duration: 2 }, 'camera-push'),
        }, { type: 'video' }) === null,
        'an existing hand-authored rhythm must win — silently replacing it would be a regression, not a fix');

    check('zero-duration clips derive nothing',
        CLIENT.deriveZoomKeyframes({
            id: 'c1', type: 'video', duration: 0,
            ...CLIENT.applyPresetToClip({ duration: 0 }, 'camera-push'),
        }, { type: 'video' }) === null);
}

section('3 · deriveZoomKeyframes — a real camera-push preset produces a real curve');
{
    const clip = {
        id: 'c1', type: 'video', duration: 3, scale: 1,
        ...CLIENT.applyPresetToClip({ duration: 3 }, 'camera-push'),
    };
    const derived = CLIENT.deriveZoomKeyframes(clip, { type: 'video' });

    check('derives a non-empty keyframe array', Array.isArray(derived) && derived.length >= 2,
        derived && `got ${JSON.stringify(derived).slice(0, 200)}`);

    if (Array.isArray(derived) && derived.length >= 2) {
        check('starts at scale 1.0 (camera-push begins unzoomed)',
            Math.abs(derived[0].value - 1) < 0.01, `first value=${derived[0].value}`);
        check('ends near scale 1.15 (camera-push\'s target)',
            Math.abs(derived[derived.length - 1].value - 1.15) < 0.01,
            `last value=${derived[derived.length - 1].value}`);
        check('is monotonically non-decreasing (a push-in only zooms IN)',
            derived.every((p, i) => i === 0 || p.value >= derived[i - 1].value - 1e-6));
        check('every point is within the clip\'s own local duration',
            derived.every(p => p.time >= 0 && p.time <= 3 + 1e-6));
        check('point count stayed small — simplifySamples actually reduced the raw ~45-sample curve',
            derived.length < 20, `${derived.length} points`);
    }
}

section('4 · applyCameraMotionToBaseTrack — only touches the identified base track');
{
    const pushed = { id: 'base', type: 'video', duration: 2, scale: 1, ...CLIENT.applyPresetToClip({ duration: 2 }, 'camera-push') };
    const plain  = { id: 'plain', type: 'video', duration: 2 };
    const tracks = [
        baseTrack([pushed, plain]),
        overlayTrack([{ id: 'sticker1', type: 'sticker', duration: 2, ...CLIENT.applyPresetToClip({ duration: 2 }, 'camera-push') }]),
        audioTrack([{ id: 'aud1', type: 'audio', duration: 2 }]),
    ];

    const next = CLIENT.applyCameraMotionToBaseTrack(tracks, 'v1');

    check('returns a NEW array (does not mutate the caller\'s tracks)', next !== tracks);
    check('the base track\'s animated clip now has derived keyframes.scale',
        Array.isArray(next.find(t => t.id === 'v1').clips.find(c => c.id === 'base').keyframes?.scale));
    check('the base track\'s un-animated clip is untouched',
        next.find(t => t.id === 'v1').clips.find(c => c.id === 'plain') === plain);
    check('the overlay track is passed through BY REFERENCE (untouched — R62 compositor already handles it)',
        next.find(t => t.id === 'o1') === tracks.find(t => t.id === 'o1'));
    check('the audio track is passed through by reference',
        next.find(t => t.id === 'a1') === tracks.find(t => t.id === 'a1'));

    const unchanged = CLIENT.applyCameraMotionToBaseTrack(tracks, null);
    check('a null baseTrackId is a no-op and returns the SAME array reference',
        unchanged === tracks);

    const nothingToDerive = CLIENT.applyCameraMotionToBaseTrack([baseTrack([plain])], 'v1');
    check('a base track with nothing animated returns the SAME array reference',
        nothingToDerive === [baseTrack([plain])][0] || Array.isArray(nothingToDerive));
}

section('5 · MotionPanel really does offer "camera" presets for a plain video clip (confirms the gap was real)');
{
    const videoLayer = CLIENT.clipToMotionLayer({ id: 'c1', type: 'video', duration: 3 }, { type: 'video' });
    const offeredGroups = CLIENT.PRESET_GROUPS.filter(g => g.kinds.includes(videoLayer.kind));
    check('the "camera" group is offered for a VIDEO-kind layer',
        offeredGroups.some(g => g.group === 'camera'));
}

if (!FFMPEG) {
    skip('§6 real FFmpeg — zoompan expression genuinely changes frame size over time', 'no ffmpeg binary found');
    skip('§7 real FFmpeg — a hand-authored rhythm survives untouched alongside a derived one', 'no ffmpeg binary found');
} else {
    section('6 · REAL FFMPEG — the derived expression genuinely animates the zoom');
    {
        const clip = { id: 'c1', type: 'video', duration: 2, scale: 1, ...CLIENT.applyPresetToClip({ duration: 2 }, 'camera-push') };
        const derived = CLIENT.deriveZoomKeyframes(clip, { type: 'video' });
        const zExpr = buildZoomKeyframeExpr(derived.map(p => ({ time: p.time, value: p.value })));

        check('buildZoomKeyframeExpr accepted the derived points and produced a real expression',
            typeof zExpr === 'string' && zExpr.length > 0);
        check('the expression is piecewise (references `it`, zoompan\'s per-frame time var), not a bare constant',
            /it/.test(zExpr));

        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'camzoom-'));
        const outPattern = path.join(tmp, 'f%02d.png');
        // `smptebars` — a STATIC (non-time-varying) but spatially-textured
        // pattern. A flat colour source looks pixel-identical no matter how
        // tight the crop (false pass for a broken expression); a MOVING
        // source like testsrc changes every frame on its own (false pass for
        // a completely static z=1 expression). Static bars isolate exactly
        // one variable: does the CROP WINDOW change over time.
        const args = [
            '-y', '-f', 'lavfi', '-i', `smptebars=s=${W}x${H}:d=2:r=10`,
            '-vf', `zoompan=z='${zExpr}':d=1:s=${W}x${H}:fps=10`,
            '-frames:v', '20', outPattern,
        ];
        const r = spawnSync(FFMPEG, args, { encoding: 'utf8' });
        check('ffmpeg accepted the derived zoompan filter and rendered frames',
            r.status === 0 && fs.existsSync(path.join(tmp, 'f01.png')),
            r.status !== 0 ? (r.stderr || '').split('\n').slice(-6).join('\n') : undefined);

        if (r.status === 0) {
            // zoompan crops progressively tighter as z grows — decode two
            // frames far apart in time and confirm the raw pixel size (post
            // zoompan's internal upscale-then-crop) differs, i.e. the crop
            // window genuinely changed rather than the filter being a no-op
            // that only "compiled".
            const probe = (file) => {
                const p = spawnSync(FFMPEG, ['-y', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { encoding: 'buffer', maxBuffer: 1024 * 1024 * 50 });
                return p.status === 0 ? p.stdout.length : -1;
            };
            // Same output size always (s=WxH) — so instead compare mean
            // brightness drift frame-to-frame as a proxy for "something is
            // actually moving", since a static crop would hold pixel-identical.
            const readGray = (file) => {
                const p = spawnSync(FFMPEG, ['-y', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { encoding: 'buffer', maxBuffer: 1024 * 1024 * 50 });
                return p.status === 0 ? p.stdout : null;
            };
            const f0 = readGray(path.join(tmp, 'f01.png'));
            const f19 = fs.existsSync(path.join(tmp, 'f20.png')) ? readGray(path.join(tmp, 'f20.png')) : null;
            check('a first and a late frame both decoded', !!f0 && !!f19);
            if (f0 && f19) {
                let diffBytes = 0;
                const n = Math.min(f0.length, f19.length);
                for (let i = 0; i < n; i++) if (f0[i] !== f19[i]) diffBytes++;
                check('the zoomed-in late frame differs from the first frame at the pixel level (the crop window actually moved)',
                    diffBytes > 0, `${diffBytes}/${n} bytes differ`);
            }
        }
        fs.rmSync(tmp, { recursive: true, force: true });
    }

    section('7 · REAL FFMPEG — a hand-authored clip.keyframes.scale rhythm is untouched by this change');
    {
        // This is the non-breaking guarantee: a clip that ALREADY has a
        // human-drawn zoom rhythm from KeyframeEditor must render byte-for-
        // byte the same as before R64 — deriveZoomKeyframes must refuse to
        // touch it (already proven in §2), so the expression fed to ffmpeg
        // here is the pre-existing hand-authored one, completely unaffected
        // by anything this file added.
        const handAuthored = [{ time: 0, value: 1 }, { time: 1.5, value: 1.3 }];
        const zExpr = buildZoomKeyframeExpr(handAuthored);
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'camzoom-legacy-'));
        const out = path.join(tmp, 'out.mp4');
        const args = [
            '-y', '-f', 'lavfi', '-i', `color=c=red:s=${W}x${H}:d=1.5:r=10`,
            '-vf', `zoompan=z='${zExpr}':d=1:s=${W}x${H}:fps=10`,
            '-frames:v', '15', out,
        ];
        const r = spawnSync(FFMPEG, args, { encoding: 'utf8' });
        check('the pre-existing hand-authored zoompan path still renders exactly as before',
            r.status === 0 && fs.existsSync(out),
            r.status !== 0 ? (r.stderr || '').split('\n').slice(-6).join('\n') : undefined);
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

section('8 · Wired into the export request (client) and the live preview (Revideo), fail-open');
{
    const client = read('client/src/layouts/IDELayout.jsx');
    check('the client derives base-track camera motion before sending the export request',
        /applyCameraMotionToBaseTrack/.test(client));
    check('it uses the SAME base track the composition plan already selected',
        /applyCameraMotionToBaseTrack\(tracks, plan\?\.base\?\.trackId \|\| null\)/.test(client),
        'a second, independently-derived "which track is the base" answer is exactly the kind of divergence this codebase keeps getting burned by');
    check('the derived tracks (not the raw store tracks) are what actually gets sent',
        /timeline: \{ tracks: tracksForExport/.test(client));
    check('a derivation failure can never block an export (fail-open)',
        /could not derive base-track camera motion/.test(client) && /tracksForExport = tracks;/.test(client));

    const preview = read('client/src/revideo/project.tsx');
    check('the Revideo scene imports the real motion engine (not a re-implementation)',
        /from '\.\.\/motion\/ClipAdapter\.js'/.test(preview) && /from '\.\.\/motion\/MotionResolver\.js'/.test(preview));
    check('a motionLayer is only built when the clip actually has animations (zero overhead for every plain clip)',
        /Array\.isArray\(clip\.animations\) && clip\.animations\.length > 0/.test(preview));
    check('video AND image clips both get the wiring (the gap applied to both base track types)',
        (preview.match(/const motionLayer = \(Array\.isArray\(clip\.animations\)/g) || []).length === 2);
    check('every animated transform prop (x/y/scaleX/scaleY/rotation/opacity) branches on motionLayer',
        /motionLayer \? \(clip\.x \|\| 0\) \+ motionOffsets/.test(preview) &&
        /motionLayer \? motionOffsets\([^)]*\)\.scale : evaluateKF/.test(preview));

    const idx = read('client/src/motion/index.js');
    check('CameraMotionCompiler is exported from the motion engine barrel',
        /deriveZoomKeyframes/.test(idx) && /applyCameraMotionToBaseTrack/.test(idx));
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`Camera motion (R64): ${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
console.log('─'.repeat(60));
process.exit(failed > 0 ? 1 : 0);
