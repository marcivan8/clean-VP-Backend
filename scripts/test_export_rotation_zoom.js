#!/usr/bin/env node
/**
 * Export: phone rotation and smooth zoom.
 *
 * 1. rotationFromProbeStream reads every shape ffprobe/fluent-ffmpeg reports a
 *    rotation in. The old probe missed fluent's flattened `stream.rotation`, so
 *    every modern iPhone portrait clip exported as a 1920x1080 frame with the
 *    speaker pillarboxed in the middle (and the captions burned on that frame).
 * 2. The segment encode never passes -noautorotate (it copied the rotation
 *    matrix onto the output, which is what turned 1080x1920 into 1920x1080).
 * 3. Real ffmpeg: a rotated portrait clip through the same filter chain shape
 *    comes out 1080x1920, upright, with no rotation matrix.
 * 4. Real ffmpeg: buildSmoothZoomFilter zooms smoothly (no back-and-forth),
 *    lands where the anchor says, and honours easeOutCubic.
 *
 * Run: node scripts/test_export_rotation_zoom.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let passed = 0, failed = 0, skipped = 0;
const check = (n, c, d) => { if (c) { passed++; console.log(`  ✓ ${n}`); } else { failed++; console.log(`  ✗ ${n}`); if (d) console.log(`      ${d}`); } };
const skip = (n, why) => { skipped++; console.log(`  – ${n} (skipped: ${why})`); };
const section = (t) => console.log(`\n${t}`);

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'jobs/exportProcessor.js'), 'utf8');

// Load the pure helpers straight out of the worker file (no module side effects).
function extract(name, sig) {
    const m = src.match(new RegExp(`function ${name}\\(${sig}[\\s\\S]*?\\n}\\n`));
    return m ? m[0] : null;
}
const parts = [extract('rotationFromProbeStream', 'vStream'), extract('zoomEaseExpr', 'easing, u'), extract('keyframeExpr', 'pts, T'), extract('buildSmoothZoomFilter', 'kfs')];
section('0 · helpers found in jobs/exportProcessor.js');
check('rotationFromProbeStream, zoomEaseExpr, keyframeExpr and buildSmoothZoomFilter extracted', parts.every(Boolean));
if (!parts.every(Boolean)) { console.log(`\n${passed} passed, ${failed} failed`); process.exit(1); }
// eslint-disable-next-line no-new-func
const { rotationFromProbeStream, buildSmoothZoomFilter } = new Function(`${parts.join('\n')}\nreturn { rotationFromProbeStream, buildSmoothZoomFilter };`)();

section('1 · rotation is read from every shape ffprobe reports');
check('fluent-ffmpeg flattened stream.rotation = -90 (iPhone portrait) → 90', rotationFromProbeStream({ rotation: -90 }) === 90);
check('stream.rotation as a string "-90" → 90', rotationFromProbeStream({ rotation: '-90' }) === 90);
check('side_data_list [{rotation:-90}] → 90', rotationFromProbeStream({ side_data_list: [{ side_data_type: 'Display Matrix', rotation: -90 }] }) === 90);
check('tags.rotate "90" (ffmpeg 4) → 90', rotationFromProbeStream({ tags: { rotate: '90' } }) === 90);
check('rotation 90 (stored counter-clockwise) → 270', rotationFromProbeStream({ rotation: 90 }) === 270);
check('rotation 180 / -180 → 180', rotationFromProbeStream({ rotation: 180 }) === 180 && rotationFromProbeStream({ rotation: -180 }) === 180);
check('no rotation anywhere → 0', rotationFromProbeStream({ tags: {} }) === 0 && rotationFromProbeStream(null) === 0);

section('2 · segment encode lets ffmpeg autorotate');
const code = src.split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
check('no -noautorotate input option (it copied the rotation matrix onto the segment)', !/['"]-noautorotate['"]/.test(code));
check('no manual transpose left in the per-clip chain', !/transpose=1/.test(code));
check('no zoompan left (pixel-snapped zoom shook)', !/zoompan=/.test(code));
check('metadata.resolution reports the rendered file, not the request', /renderedDims \? `\$\{renderedDims\.width\}x\$\{renderedDims\.height\}`/.test(src));

section('2b · speed audio and the proxy size');
{
    const a = src.match(/function atempoChain\(speed\)[\s\S]*?\n}\n/);
    check('atempoChain found', !!a);
    if (a) {
        // eslint-disable-next-line no-new-func
        const atempoChain = new Function(`${a[0]}\nreturn atempoChain;`)();
        check('4x audio = atempo 2 × 2 (it used to clamp to 2x and drift)', atempoChain(4).join(',') === 'atempo=2.0000,atempo=2.0000');
        check('0.25x audio = atempo 0.5 × 0.5', atempoChain(0.25).join(',') === 'atempo=0.5000,atempo=0.5000');
        check('1.5x audio = one atempo', atempoChain(1.5).join(',') === 'atempo=1.5000');
    }
    const vp = fs.readFileSync(path.join(ROOT, 'jobs/videoProcessor.js'), 'utf8');
    check('the proxy job reports the upright proxy size (for the iPhone shape fallback)',
        /const dims = await probeDimensions\(mp4Path\)/.test(vp) && /width:\s+dims\?\.width/.test(vp));
    const ide = fs.readFileSync(path.join(ROOT, 'client/src/layouts/IDELayout.jsx'), 'utf8');
    check('the editor sets the shape from the proxy when the file probe gave up',
        /if \(ratioFromProxy\) applyProxyDimensions\(assetId, data, ratioBeforeProxy\)/.test(ide)
        && /st\.aspectRatio === ratioBefore/.test(ide));
}

function bin(name) {
    for (const b of [name, `/usr/bin/${name}`]) {
        const r = spawnSync(b, ['-version'], { encoding: 'utf8' });
        if (r.status === 0) return b;
    }
    return null;
}
const FFMPEG = bin('ffmpeg');
const FFPROBE = bin('ffprobe');
const run = (args) => spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
const probe = (file) => {
    const r = spawnSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_streams', '-of', 'json', file], { encoding: 'utf8' });
    try { return JSON.parse(r.stdout).streams[0]; } catch { return null; }
};
const gray = (file, w, h) => {
    const r = spawnSync(FFMPEG, ['-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 30 });
    const n = Math.floor(r.stdout.length / (w * h));
    return Array.from({ length: n }, (_, i) => r.stdout.subarray(i * w * h, (i + 1) * w * h));
};
const centroid = (fr, w) => {
    let sx = 0, sy = 0, s = 0;
    for (let i = 0; i < fr.length; i++) { const v = fr[i]; if (v > 40) { sx += (i % w) * v; sy += Math.floor(i / w) * v; s += v; } }
    return s ? [sx / s, sy / s] : [NaN, NaN];
};

if (!FFMPEG || !FFPROBE) {
    skip('§3 rotated phone clip comes out 1080x1920 upright', 'no ffmpeg/ffprobe');
    skip('§4 smooth zoom', 'no ffmpeg/ffprobe');
} else {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-rot-'));
    section('3 · REAL FFMPEG — iPhone-style rotated portrait clip');
    {
        // Portrait 360x640 content stored as landscape 640x360 + a rotation
        // matrix that turns it upright (like an iPhone clip). ffmpeg versions
        // disagree on which way a written matrix points, so the coded frame is
        // turned to match whatever matrix this ffmpeg writes.
        const make = (transpose, rotArgs, name) => {
            const coded = path.join(tmp, `coded-${name}.mp4`);
            const phone = path.join(tmp, `phone-${name}.mp4`);
            let r = run(['-f', 'lavfi', '-i', 'color=c=black:s=360x640:d=1:r=10', '-vf', `drawbox=x=150:y=40:w=60:h=60:c=white:t=fill,transpose=${transpose}`, '-pix_fmt', 'yuv420p', coded]);
            if (r.status === 0) r = run([...rotArgs.pre, '-i', coded, '-c', 'copy', ...rotArgs.post, phone]);
            return r.status === 0 ? phone : null;
        };
        const variants = [{ pre: ['-display_rotation', '-90'], post: [] }, { pre: [], post: ['-metadata:s:v:0', 'rotate=90'] }];
        let phone = null, p = null, rot = 0;
        for (const v of variants) {
            phone = make(2, v, 'a');
            p = phone && probe(phone);
            rot = p ? rotationFromProbeStream(p) : 0;
            if (rot === 270) { phone = make(1, v, 'b'); p = phone && probe(phone); rot = p ? rotationFromProbeStream(p) : 0; }
            if (rot === 90 || rot === 270) break;
        }
        let r = { status: phone ? 0 : 1 };
        if (r.status !== 0 || !p || !(rot === 90 || rot === 270)) {
            skip('rotated test clip', 'this ffmpeg cannot write a rotation matrix');
        } else {
            check('test clip is stored landscape with a rotation matrix', p.width === 640 && p.height === 360, JSON.stringify({ w: p.width, h: p.height, rot }));
            // Same shape as the worker's segment encode: no -noautorotate, scale/pad to the 9:16 target.
            const seg = path.join(tmp, 'seg.mp4');
            r = run(['-i', phone, '-vf', 'scale=360:640:force_original_aspect_ratio=decrease,pad=360:640:(ow-iw)/2:(oh-ih)/2,setsar=1', '-pix_fmt', 'yuv420p', seg]);
            const s = probe(seg);
            check('segment is 360x640 portrait', s && s.width === 360 && s.height === 640, JSON.stringify(s));
            check('segment carries no rotation matrix (players show it as encoded)', s && rotationFromProbeStream(s) === 0, JSON.stringify(s));
            const [cx, cy] = centroid(gray(seg, 360, 640)[0], 360);
            check('content is upright and fills the frame (marker near the top, where it was drawn)', Math.abs(cx - 180) < 8 && Math.abs(cy - 70) < 8, `marker at ${cx.toFixed(0)},${cy.toFixed(0)}`);
        }
    }

    section('4 · REAL FFMPEG — smooth zoom');
    {
        const W = 360, H = 640;
        const srcV = path.join(tmp, 'dot.mp4');
        run(['-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:d=3:r=30`, '-vf', 'drawbox=x=262:y=96:w=8:h=8:c=white:t=fill', '-pix_fmt', 'yuv420p', srcV]);
        const kf = [{ time: 0, value: 1.05 }, { time: 3, value: 1.1, easing: 'linear' }];
        const zoom = buildSmoothZoomFilter(kf, { fps: 30, anchor: { mode: 'fixed', x: 0.5, y: 0.28 } });
        const out = path.join(tmp, 'zoom.mp4');
        const r = run(['-i', srcV, '-vf', zoom, '-pix_fmt', 'yuv420p', out]);
        check('ffmpeg accepts the zoom filter', r.status === 0, (r.stderr || '').slice(-400));
        if (r.status === 0) {
            const pts = gray(out, W, H).map(f => centroid(f, W));
            const dx = pts.slice(1).map((p, i) => p[0] - pts[i][0]);
            const back = dx.filter(d => d < -0.05).length;
            check(`zoom only moves one way (${back} backward steps over ${dx.length} frames)`, back === 0);
            const last = pts[pts.length - 1];
            const ex = W / 2 + (266 - W / 2) * 1.1, ey = 0.28 * H + (100 - 0.28 * H) * 1.1;
            check('ends where the anchor (0.5, 0.28) puts it at 1.10x', Math.abs(last[0] - ex) < 1.5 && Math.abs(last[1] - ey) < 1.5, `got ${last.map(v => v.toFixed(1))} expected ${ex.toFixed(1)},${ey.toFixed(1)}`);
        }
        check('nothing to draw when the zoom never goes above 1', buildSmoothZoomFilter([{ time: 0, value: 1 }]) === null);
        const eased = buildSmoothZoomFilter([{ time: 0, value: 1 }, { time: 1, value: 1.2, easing: 'easeOutCubic' }]);
        check('easeOutCubic segments are eased, not linear', /pow\(1-/.test(eased));
        const centred = buildSmoothZoomFilter([{ time: 0, value: 2 }], { anchor: { mode: 'center', x: 0.9, y: 0.1 }, maxZoom: 8 });
        check('multicam (centre) anchor keeps the window inside the frame', /clip\(W\*0\.9000/.test(centred) && /clip\(H\*0\.1000/.test(centred));
    }
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
process.exit(failed ? 1 : 0);
