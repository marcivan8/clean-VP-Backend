import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import Canvas from '@napi-rs/canvas';
import { renderTemplateFrames } from '../server/compositor/TemplateRenderer.js';

const require = createRequire(import.meta.url);
const { spawnSync } = require('node:child_process');
const ffmpeg = (() => {
    const staticBin = require('ffmpeg-static');
    return spawnSync(staticBin, ['-version'], { encoding: 'utf8' }).status === 0 ? staticBin
        : spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0 ? 'ffmpeg' : null;
})();
assert.ok(ffmpeg, 'FFmpeg is available for the 3D export integration check');

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
function loadCompositor() {
    const order = ['Easing', 'MotionSchema', 'MotionPresetExpansion', 'MotionResolver', 'TimeRemap', 'MotionPresets', 'MotionExpression', 'EffectTiming', 'CaptionModel', 'ClipAdapter', 'Compositor'];
    let combined = '';
    for (const name of order) {
        let source = fs.readFileSync(path.join(root, `client/src/motion/${name}.js`), 'utf8');
        source = source.replace(/^\s*import\s+[^;]+;\s*$/gm, '')
            .replace(/^\s*export\s+default\s+\{[\s\S]*?\};\s*$/gm, '')
            .replace(/^\s*export\s+default\s+[^;]+;\s*$/gm, '')
            .replace(/\bexport\s+(const|function|class|let)\b/g, '$1');
        combined += `${source}\n`;
    }
    return new Function(`${combined}\nreturn { buildCompositionPlan };`)();
}

const { buildCompositionPlan } = loadCompositor();
const { compileCompositionPlan, validateCompositionPlanShape } = require('../server/compositor/CompositorCompiler.js');
const exportProcessor = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'jobs/exportProcessor.js'), 'utf8');
assert.match(exportProcessor, /tplvideo-frames-[\s\S]*?frame-%06d\.png[\s\S]*?'-c:v', 'png'[\s\S]*?'-pix_fmt', 'rgba'/,
    '3D scene video textures are extracted as alpha-preserving PNG frames');
const width = 640, height = 360, fps = 4;
const scene = {
    camera: { z: 7, fov: 780 }, ambient: 1, shadows: { enabled: false },
    objects: [{ id: 'export-cube', type: 'box', position: { x: 0, y: 0, z: 0 },
        size: { x: 2.5, y: 2.5, z: 2 }, color: '#FF2020', castsShadow: false }],
};
const template = { kind: '3d-scene', params: { scene, w: 1080, h: 760 } };
const plan = buildCompositionPlan([
    { id: 'base-track', type: 'video', order: 0, clips: [{ id: 'base', type: 'video', start: 0, duration: 2,
        url: 'base.mp4', metadata: { resolution: { w: width, h: height } } }] },
    { id: 'overlay-track', type: 'overlay', order: 0, clips: [{ id: 'scene-3d', type: 'template', start: 0.25,
        duration: 1, template }] },
], { width, height, fps });
plan.renderWidth = width;
plan.renderHeight = height;
const overlay = plan.overlays[0];
assert.equal(overlay.source.type, 'template', 'the client plan keeps 3D scenes on the worker-rendered template path');
assert.deepEqual(overlay.source.template, template, 'the complete 3D scene reaches the export plan');
assert.deepEqual(validateCompositionPlanShape(plan, width, height), [], 'the export worker accepts the generated 3D plan');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), '3d-template-export-'));
try {
    // Prove the exact texture extraction format retains source-video alpha.
    // This catches regressions where a JPEG intermediate makes transparent
    // video textures render as black/opaque cards in the 3D scene.
    const alphaSequenceDir = path.join(tmp, 'alpha-input');
    const alphaFramesDir = path.join(tmp, 'alpha-extracted');
    fs.mkdirSync(alphaSequenceDir, { recursive: true });
    fs.mkdirSync(alphaFramesDir, { recursive: true });
    for (let index = 0; index < 2; index++) {
        const canvas = Canvas.createCanvas(32, 32);
        const context = canvas.getContext('2d');
        // Distinct frames prove the decoded texture changes with scene time,
        // rather than merely proving that FFmpeg can write PNG files.
        context.fillStyle = index === 0 ? '#ff2020' : '#20e040';
        context.fillRect(8, 8, 16, 16);
        fs.writeFileSync(path.join(alphaSequenceDir, `source-${String(index + 1).padStart(2, '0')}.png`), canvas.toBuffer('image/png'));
    }
    const alphaVideo = path.join(tmp, 'alpha-texture.mov');
    const alphaEncode = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-framerate', String(fps),
        '-i', path.join(alphaSequenceDir, 'source-%02d.png'), '-frames:v', '2', '-c:v', 'qtrle', '-pix_fmt', 'argb', '-y', alphaVideo],
    { encoding: 'utf8', timeout: 60_000 });
    assert.equal(alphaEncode.status, 0, `alpha video fixture encodes: ${alphaEncode.stderr}`);
    const alphaPattern = path.join(alphaFramesDir, 'frame-%06d.png');
    const alphaExtract = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', alphaVideo,
        '-vf', `setpts=PTS-STARTPTS,fps=${fps},scale=960:-2:flags=lanczos,format=rgba`, '-frames:v', '2',
        '-c:v', 'png', '-pix_fmt', 'rgba', '-compression_level', '3', '-y', alphaPattern],
    { encoding: 'utf8', timeout: 60_000 });
    assert.equal(alphaExtract.status, 0, `alpha video texture extracts to PNG: ${alphaExtract.stderr}`);
    const alphaFrame = await Canvas.loadImage(path.join(alphaFramesDir, 'frame-000001.png'));
    const alphaCanvas = Canvas.createCanvas(alphaFrame.width, alphaFrame.height);
    const alphaContext = alphaCanvas.getContext('2d');
    alphaContext.drawImage(alphaFrame, 0, 0);
    assert.equal(alphaContext.getImageData(2, 2, 1, 1).data[3], 0, 'transparent source-video pixels stay transparent in extracted frames');
    const extractedOpaquePixel = [...alphaContext.getImageData(480, 240, 1, 1).data];
    assert.ok(extractedOpaquePixel[3] > 100, `source-video content remains visible in extracted frames: ${extractedOpaquePixel} (${alphaFrame.width}x${alphaFrame.height})`);

    const videoTextureTemplate = {
        kind: '3d-scene',
        params: {
            w: 360, h: 360,
            scene: {
                camera: { z: 7, fov: 780 }, ambient: 1, shadows: { enabled: false },
                objects: [{ id: 'decoded-video-plane', type: 'video', videoTextureKey: 'decoded-video',
                    size: { x: 4, y: 4, z: 0.1 }, videoStart: 0, videoSpeed: 1, videoLoop: false,
                    castsShadow: false }],
            },
        },
    };
    const renderedVideoTexture = await renderTemplateFrames(videoTextureTemplate, {
        durationSec: 0.5, fps, widthPx: 360, tmpDir: path.join(tmp, 'video-texture-render'), name: 'video-texture',
        videoFrameFiles: { 'decoded-video': { frames: [
            path.join(alphaFramesDir, 'frame-000001.png'), path.join(alphaFramesDir, 'frame-000002.png'),
        ], startTime: 0 } },
    });
    assert.equal(renderedVideoTexture.frames, 2, 'video-textured 3D scene renders each timeline frame');
    const videoTextureSamples = [];
    for (const framePath of renderedVideoTexture.files) {
        const frameImage = await Canvas.loadImage(framePath);
        const frameCanvas = Canvas.createCanvas(frameImage.width, frameImage.height);
        const frameContext = frameCanvas.getContext('2d');
        frameContext.drawImage(frameImage, 0, 0);
        videoTextureSamples.push([...frameContext.getImageData(frameImage.width / 2, frameImage.height / 2, 1, 1).data]);
    }
    assert.ok(videoTextureSamples[0][0] > videoTextureSamples[0][1] * 1.5,
        `the first 3D texture frame displays its red source frame: ${videoTextureSamples[0]}`);
    assert.ok(videoTextureSamples[1][1] > videoTextureSamples[1][0] * 1.5,
        `the next 3D texture frame displays its green source frame: ${videoTextureSamples[1]}`);

    const frames = await renderTemplateFrames(overlay.source.template, {
        durationSec: overlay.outputEnd - overlay.outputStart,
        fps,
        widthPx: Math.round(Math.max(...overlay.geometry.map(sample => sample.w)) * width),
        tmpDir: tmp,
        name: overlay.id,
    });
    assert.equal(frames.frames, fps, 'the 3D template renderer emits one frame per output tick');
    assert.ok(fs.existsSync(frames.files[0]), 'the worker produces a real rendered 3D frame');

    // Exercise the production template frame renderer with asset-keyed audio
    // data, rather than only checking that waveform JSON survives planning.
    const reactiveTemplate = {
        ...overlay.source.template,
        params: {
            ...overlay.source.template.params,
            scene: {
                ...overlay.source.template.params.scene,
                objects: overlay.source.template.params.scene.objects.map(object => ({
                    ...object,
                    audioReactive: { assetId: 'music-bed', target: 'scale', amount: 1 },
                })),
            },
        },
    };
    const withWaveform = peaks => ({
        ...reactiveTemplate,
        params: {
            ...reactiveTemplate.params,
            scene: { ...reactiveTemplate.params.scene,
                audioWaveformsByAsset: { 'music-bed': { peaks, duration: 1 } } },
        },
    });
    const quietReactiveFrames = await renderTemplateFrames(withWaveform([0, 0]), {
        durationSec: 1, fps: 1, widthPx: 360, tmpDir: path.join(tmp, 'quiet'), name: 'reactive-quiet',
    });
    const loudReactiveFrames = await renderTemplateFrames(withWaveform([1, 1]), {
        durationSec: 1, fps: 1, widthPx: 360, tmpDir: path.join(tmp, 'loud'), name: 'reactive-loud',
    });
    assert.notDeepEqual(fs.readFileSync(quietReactiveFrames.files[0]), fs.readFileSync(loudReactiveFrames.files[0]),
        'the production 3D export renderer applies audio-reactive object motion to rendered frame pixels');

    const base = path.join(tmp, 'base.mp4');
    const baseResult = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
        `color=c=0x808080:s=${width}x${height}:r=${fps}:d=2`, '-pix_fmt', 'yuv420p', '-y', base],
    { encoding: 'utf8', timeout: 60_000 });
    assert.equal(baseResult.status, 0, baseResult.stderr);

    const compiled = compileCompositionPlan(plan, [{ overlayId: overlay.id, inputIndex: 1 }]);
    const output = path.join(tmp, '3d-composite.mp4');
    const rendered = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', base,
        '-framerate', String(fps), '-i', frames.pattern,
        '-filter_complex', compiled.filterComplex, '-map', `[${compiled.outputLabel}]`,
        '-frames:v', '8', '-pix_fmt', 'yuv420p', '-y', output],
    { encoding: 'utf8', timeout: 120_000 });
    assert.equal(rendered.status, 0, rendered.stderr);

    function pixelAt(frameIndex, x, y) {
        const frame = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', output,
            '-vf', `select=eq(n\\,${frameIndex})`, '-vsync', '0', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
        { encoding: 'buffer', timeout: 30_000 });
        assert.equal(frame.status, 0, frame.stderr?.toString());
        assert.equal(frame.stdout.length, width * height * 3, `decoded frame ${frameIndex} has full dimensions`);
        const offset = (y * width + x) * 3;
        return Array.from(frame.stdout.subarray(offset, offset + 3));
    }
    const before = pixelAt(0, width / 2, height / 2);
    const during = pixelAt(2, width / 2, height / 2);
    const after = pixelAt(6, width / 2, height / 2);
    const distance = (a, b) => Math.max(...a.map((channel, index) => Math.abs(channel - b[index])));
    assert.ok(distance(before, [128, 128, 128]) < 20, `3D overlay is absent before its window (${before})`);
    assert.ok(during[0] > 200 && during[1] < 90 && during[2] < 90, `3D scene changes the final exported pixels (${during})`);
    assert.ok(distance(after, [128, 128, 128]) < 20, `3D overlay is absent after its window (${after})`);
    console.log('3D template export passed: client plan, worker validation, rendered scene frames, FFmpeg composite, and timeline gating.');
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}
