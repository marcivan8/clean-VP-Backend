import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import Canvas from '@napi-rs/canvas';
import { renderVectorFrames } from '../server/compositor/TemplateRenderer.js';

const require = createRequire(import.meta.url);
const { compileCompositionPlan, validateCompositionPlanShape } = require('../server/compositor/CompositorCompiler.js');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0 ? 'ffmpeg' : require('ffmpeg-static');
assert.ok(ffmpeg, 'FFmpeg is available for the export integration check');

function loadCompositor() {
    const order = ['Easing', 'MotionSchema', 'MotionPresetExpansion', 'MotionResolver', 'TimeRemap', 'MotionPresets', 'MotionExpression', 'EffectTiming', 'CaptionModel', 'ClipAdapter', 'Compositor'];
    let combined = '';
    for (const name of order) {
        let source = fs.readFileSync(path.join(root, `client/src/motion/${name}.js`), 'utf8');
        source = source
            .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
            .replace(/^\s*export\s+default\s+\{[\s\S]*?\};\s*$/gm, '')
            .replace(/^\s*export\s+default\s+[^;]+;\s*$/gm, '')
            .replace(/\bexport\s+(const|function|class|let)\b/g, '$1');
        combined += `${source}\n`;
    }
    return new Function(`${combined}\nreturn { buildCompositionPlan };`)();
}

const { buildCompositionPlan } = loadCompositor();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-track-matte-'));
try {
    const targetClip = { id: 'footage', type: 'video', start: 0.5, duration: 2, url: 'file://footage',
        metadata: { resolution: { w: 200, h: 200 } }, sceneId: 'scene', sceneNodeId: 'footage' };
    const matteVector = { kind: 'star', w: 200, h: 200, points: 5, outerRadius: 92, innerRadius: 42,
        fill: '#FFFFFF', rotation: 0 };
    const matteClip = { id: 'vector-matte', type: 'vector', start: 0.5, duration: 2, vector: matteVector,
        sceneId: 'scene', sceneNodeId: 'matte' };
    targetClip.sceneMask = { kind: 'layer', nodeId: 'matte', mode: 'alpha' };
    const plan = buildCompositionPlan([
        { id: 'base-track', type: 'video', order: 0, clips: [{ id: 'base', type: 'video', start: 0, duration: 3,
            url: 'file://base', metadata: { resolution: { w: 640, h: 360 } } }] },
        { id: 'overlay-track', type: 'overlay', order: 0, clips: [targetClip, matteClip] },
    ], { width: 640, height: 360, fps: 15 });
    plan.renderWidth = 640;
    plan.renderHeight = 360;
    const target = plan.overlays.find(overlay => overlay.sceneNodeId === 'footage');
    const matte = plan.overlays.find(overlay => overlay.sceneNodeId === 'matte');
    assert.equal(target.sceneMask.sourceOverlayId, matte.id, 'the scene graph resolves the vector node as its matte');
    assert.equal(matte.matteOnly, true, 'the matte vector is hidden from visible composition output');
    assert.deepEqual(matte.source.vector, matteVector, 'the vector matte payload survives composition-plan creation');
    assert.deepEqual(validateCompositionPlanShape(plan, 640, 360), [], 'the worker accepts the generated vector matte plan');

    const vectorFrames = await renderVectorFrames(matte.source.vector, {
        durationSec: 2, fps: 15, widthPx: 200, tmpDir: tmp, name: 'matte',
    });
    const inputs = [{ overlayId: target.id, inputIndex: 1 }, { overlayId: matte.id, inputIndex: 2 }];
    const compiled = compileCompositionPlan(plan, inputs);
    assert.match(compiled.filterComplex, /alphaextract/, 'the export graph extracts matte alpha');
    assert.match(compiled.filterComplex, /alphamerge/, 'the export graph merges matte alpha into footage');

    const base = path.join(tmp, 'base.mp4');
    const footage = path.join(tmp, 'footage.mp4');
    for (const [file, color, size] of [[base, '0x808080', '640x360'], [footage, 'red', '200x200']]) {
        const made = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
            `color=c=${color}:s=${size}:r=15:d=3`, '-pix_fmt', 'yuv420p', '-y', file], { encoding: 'utf8', timeout: 60_000 });
        assert.equal(made.status, 0, made.stderr);
    }
    const output = path.join(tmp, 'composite.mp4');
    const rendered = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', base, '-i', footage,
        '-framerate', '15', '-i', vectorFrames.pattern, '-filter_complex', compiled.filterComplex,
        '-map', `[${compiled.outputLabel}]`, '-frames:v', '45', '-pix_fmt', 'yuv420p', '-y', output],
    { encoding: 'utf8', timeout: 120_000 });
    assert.equal(rendered.status, 0, rendered.stderr);

    const frame = path.join(tmp, 'frame.png');
    const extracted = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', '1', '-i', output,
        '-frames:v', '1', '-y', frame], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(extracted.status, 0, extracted.stderr);
    const image = await Canvas.loadImage(frame);
    const canvas = Canvas.createCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const pixel = (x, y) => Array.from(context.getImageData(x, y, 1, 1).data.slice(0, 3));
    const center = pixel(320, 180);
    const corner = pixel(253, 113);
    const dist = (rgb, value) => Math.hypot(rgb[0] - value[0], rgb[1] - value[1], rgb[2] - value[2]);
    assert.ok(dist(center, [255, 0, 0]) < 45, `vector matte keeps the center of the footage visible (${center})`);
    assert.ok(dist(corner, [128, 128, 128]) < 35, `vector matte removes footage outside the star (${corner})`);
    console.log('Vector track matte export passed: scene-node resolution, vector rendering, FFmpeg alpha compositing, and visible pixel checks.');
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}
