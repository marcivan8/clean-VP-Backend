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
const parts = [extract('rotationFromProbeStream', 'vStream'), extract('springEaseExpr', 'stiffness, damping, mass, u'), extract('sampledEaseExpr', 'samples, u'), extract('cubicBezierEaseExpr', 'x1, y1, x2, y2, u'), extract('applyRetimeEasing', 'name, progress'), extract('zoomEaseExpr', 'easing, u'), extract('keyframeExpr', 'pts, T'), extract('buildSmoothZoomFilter', 'kfs'), extract('buildAnimatedOpacityFilter', 'keyframes'), extract('buildAnimatedRotationFilter', 'keyframes')];
section('0 · helpers found in jobs/exportProcessor.js');
check('rotation, zoom, keyframe and animated opacity/rotation helpers extracted', parts.every(Boolean));
if (!parts.every(Boolean)) { console.log(`\n${passed} passed, ${failed} failed`); process.exit(1); }
// eslint-disable-next-line no-new-func
const { rotationFromProbeStream, zoomEaseExpr, buildSmoothZoomFilter, buildAnimatedOpacityFilter, buildAnimatedRotationFilter } = new Function(`${parts.join('\n')}\nreturn { rotationFromProbeStream, zoomEaseExpr, buildSmoothZoomFilter, buildAnimatedOpacityFilter, buildAnimatedRotationFilter };`)();

section('1 · rotation is read from every shape ffprobe reports');
check('export easing expressions cover canonical cubic, quartic, sine, exponential and circular curves',
    zoomEaseExpr('easeInOutCubic', 'u') === zoomEaseExpr('ease-in-out-cubic', 'u')
    && zoomEaseExpr('easeOutQuart', 'u') === zoomEaseExpr('ease-out-quart', 'u')
    && zoomEaseExpr('easeInOutSine', 'u') !== 'u'
    && zoomEaseExpr('easeInOutExpo', 'u') !== 'u'
    && zoomEaseExpr('easeInOutCirc', 'u') !== 'u');
check('zoom steps preserve all canonical jump positions',
    zoomEaseExpr('steps(4, start)', 'u').includes('floor(u*4)+1')
    && zoomEaseExpr('steps(4, jump-end)', 'u').includes('floor(u*4)+0')
    && zoomEaseExpr('steps(4, jump-both)', 'u').includes('/5')
    && zoomEaseExpr('steps(4, jump-none)', 'u').includes('/3'));
check('stepStart and stepEnd camelCase aliases preserve their discrete export behavior',
    zoomEaseExpr('stepStart', 'u') === 'if(gte(u,1),1,1)'
    && zoomEaseExpr('stepEnd', 'u') === 'if(gte(u,1),1,0)');
check('the named default spring exports its physical easing curve', zoomEaseExpr('spring', 'u').includes('exp('));
check('custom Bézier zoom easing clamps time controls but retains vertical overshoot',
    zoomEaseExpr('cubic-bezier(2,0,-1,1)', 'u') === zoomEaseExpr('cubic-bezier(1,0,0,1)', 'u')
    && zoomEaseExpr('cubic-bezier(0.2,1.4,0.8,-0.4)', 'u') !== zoomEaseExpr('cubic-bezier(0.2,0.4,0.8,0.4)', 'u'));
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
check('export routes footage opacity keyframes through the alpha compositor',
    /const opacityKfs = Array\.isArray\(clip\.keyframes\?\.opacity\)/.test(src)
    && /vFilters\.push\(buildAnimatedOpacityFilter\(opacityKfs\)\)/.test(src));
check('export routes absolute footage rotation keyframes through FFmpeg rotation',
    /const rotationKfs = Array\.isArray\(clip\.keyframes\?\.rotation\)/.test(src)
    && /buildAnimatedRotationFilter\(rotationKfs\)/.test(src));

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
    check('the editor reconciles each video shape from its upright proxy',
        /if \(isVideo\) applyProxyDimensions\(assetId, data, ratioBeforeProxy, !e\.referenceMaterial\)/.test(ide)
        && /data\?\.width[\s\S]*data\?\.proxyUrl/.test(ide)
        && /st\.aspectRatio === ratioBefore/.test(ide));
    // R95: proxy dimensions must be reconciled per file, independent of the
    // batch-wide ratioSet flag. The helper itself protects the project ratio
    // from overwriting a change made while the proxy was being generated.
    check('proxy-shape reconciliation is per-file and protects later ratio changes',
        !/if \(isVideo && !ratioSet\) applyProxyDimensions/.test(ide)
        && /if \(isVideo\) applyProxyDimensions\(assetId, data, ratioBeforeProxy, !e\.referenceMaterial\)/.test(ide)
        && /st\.aspectRatio === ratioBefore/.test(ide));
}

function bin(name) {
    for (const b of [name, `/usr/bin/${name}`]) {
        const r = spawnSync(b, ['-version'], { encoding: 'utf8' });
        if (r.status === 0) return b;
    }
    try {
        if (name === 'ffmpeg') return require('ffmpeg-static');
        if (name === 'ffprobe') return require('@ffprobe-installer/ffprobe').path;
    } catch { /* optional local binary packages */ }
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
        const curveNames = ['easeInOutCubic', 'easeInOutQuart', 'easeInOutSine', 'easeInOutExpo', 'easeInOutCirc', 'backOut', 'backInOut', 'bounce', 'elastic', 'springGentle', 'springWobbly', 'spring(170,26,1)', 'cubic-bezier(0.42,0,0.58,1)', 'steps(6)'];
        const curveResults = curveNames.map((easing, index) => {
            const filter = buildSmoothZoomFilter([{ time: 0, value: 1.02 }, { time: 3, value: 1.08, easing }]);
            const curveOutput = path.join(tmp, `ease-${index}.mp4`);
            return { easing, result: run(['-i', srcV, '-vf', filter, '-pix_fmt', 'yuv420p', curveOutput]) };
        });
        for (const { easing, result } of curveResults) {
            check(`FFmpeg accepts ${easing} easing on a camera keyframe`, result.status === 0, (result.stderr || '').slice(-350));
        }
        const axisFilter = buildSmoothZoomFilter([{ time: 0, value: 1 }, { time: 1, value: 1.1 }], {
            scaleXKfs: [{ time: 0, value: 1 }, { time: 1, value: 1.4 }],
            scaleYKfs: [{ time: 0, value: 1 }, { time: 1, value: 1.2 }],
        });
        const xSpan = axisFilter.match(/x1='([^']+)'/)?.[1] || '';
        const ySpan = axisFilter.match(/y2='([^']+)'/)?.[1] || '';
        check('horizontal and vertical scale tracks compile to independent perspective windows',
            xSpan.includes('1.4000') && !xSpan.includes('1.2000')
            && ySpan.includes('1.2000') && !ySpan.includes('1.4000'));
        const axisInput = path.join(tmp, 'axis.mp4');
        const axisOutput = path.join(tmp, 'axis-out.mp4');
        run(['-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:d=1:r=30`, '-vf', 'drawbox=x=180:y=250:w=20:h=20:c=white:t=fill', '-pix_fmt', 'yuv420p', axisInput]);
        const axisResult = run(['-i', axisInput, '-vf', axisFilter, '-pix_fmt', 'yuv420p', axisOutput]);
        check('FFmpeg accepts animated independent X/Y perspective scale', axisResult.status === 0, (axisResult.stderr || '').slice(-400));

        const animatedPosition = buildSmoothZoomFilter(null, {
            positionX: [{ time: 0, value: 0 }, { time: 1, value: 36 }],
            positionY: [{ time: 0, value: 0 }, { time: 1, value: -64 }],
            width: 360, height: 640,
        });
        check('base clip pixel position keyframes compile into normalized X/Y pan expressions',
            !!animatedPosition && animatedPosition.includes('0.10000') && animatedPosition.includes('-0.10000'));
        const moved = path.join(tmp, 'position-keyframes.mp4');
        const moveFilter = buildSmoothZoomFilter(null, {
            positionX: [{ time: 0, value: 0 }, { time: 3, value: 54 }],
            width: W, height: H,
        });
        const movedResult = run(['-i', srcV, '-vf', moveFilter, '-pix_fmt', 'yuv420p', moved]);
        check('ffmpeg accepts animated base clip X position', movedResult.status === 0, (movedResult.stderr || '').slice(-400));
        if (movedResult.status === 0) {
            const movedFrames = gray(moved, W, H).map(f => centroid(f, W));
            check('base clip position keyframes move the rendered frame smoothly to the right',
                movedFrames.at(-1)[0] > movedFrames[0][0] + 45,
                `start=${movedFrames[0][0].toFixed(1)} end=${movedFrames.at(-1)[0].toFixed(1)}`);
        }

        const opacityTrack = [{ time: 0, value: 1 }, { time: 3, value: 0.4 }];
        const opacityFilter = buildAnimatedOpacityFilter(opacityTrack);
        check('animated footage opacity compiles to a time-varying alpha filter',
            opacityFilter.includes("alpha(X,Y)*clip((if(lt(T,0.000)") && opacityFilter.includes('0.400000'));
        const opacityOutput = path.join(tmp, 'opacity-keyframes.mp4');
        const opacityGraph = [
            `[0:v]${opacityFilter}[fg]`,
            `color=c=black:s=${W}x${H}:d=3:r=30[bg]`,
            `[bg][fg]overlay=shortest=1[out]`,
        ].join(';');
        const opacityResult = run(['-i', srcV, '-filter_complex', opacityGraph, '-map', '[out]', '-pix_fmt', 'yuv420p', opacityOutput]);
        check('ffmpeg accepts keyframed opacity on transparent footage', opacityResult.status === 0, (opacityResult.stderr || '').slice(-400));
        if (opacityResult.status === 0) {
            const frames = gray(opacityOutput, W, H);
            const marker = 100 * W + 266;
            check('keyframed opacity visibly fades footage over the render background',
                frames[0][marker] > 180 && frames.at(-1)[marker] > 50 && frames.at(-1)[marker] < frames[0][marker] * 0.65,
                `start=${frames[0][marker]} end=${frames.at(-1)[marker]}`);
        }

        const rotationTrack = [{ time: 0, value: 0 }, { time: 3, value: 24, easing: 'easeOutCubic' }];
        const rotationFilter = buildAnimatedRotationFilter(rotationTrack);
        check('animated rotation evaluates its angle over time with fixed centered alpha bounds',
            rotationFilter.includes("rotate='(if(lt(t,") && rotationFilter.includes('sqrt(iw*iw+ih*ih)'));
        const rotationInput = path.join(tmp, 'rotation-source.mp4');
        const rotationOutput = path.join(tmp, 'rotation-keyframes.mp4');
        run(['-f', 'lavfi', '-i', 'color=c=black:s=360x360:d=3:r=30', '-vf', 'drawbox=x=250:y=170:w=70:h=20:c=white:t=fill', '-pix_fmt', 'yuv420p', rotationInput]);
        const rotationGraph = [
            `[0:v]${rotationFilter}[fg]`,
            'color=c=black:s=360x360:d=3:r=30[bg]',
            '[bg][fg]overlay=shortest=1[out]',
        ].join(';');
        const rotationResult = run(['-i', rotationInput, '-filter_complex', rotationGraph, '-map', '[out]', '-pix_fmt', 'yuv420p', rotationOutput]);
        check('FFmpeg accepts an animated alpha rotation on footage', rotationResult.status === 0, (rotationResult.stderr || '').slice(-500));
        if (rotationResult.status === 0) {
            const frames = gray(rotationOutput, 360, 360);
            const first = centroid(frames[0], 360), last = centroid(frames.at(-1), 360);
            check('keyframed rotation changes footage position around its fixed center',
                Math.hypot(first[0] - last[0], first[1] - last[1]) > 10,
                `start=${first.join(',')} end=${last.join(',')}`);
        }
    }
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
process.exit(failed ? 1 : 0);
