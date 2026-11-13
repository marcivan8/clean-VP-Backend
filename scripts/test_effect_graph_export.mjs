import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { EffectGraph } from '../client/src/effects/EffectGraph.js';
import { EffectPipeline } from '../client/src/effects/EffectPipeline.js';

const require = createRequire(import.meta.url);
const {
    compileTimelineVisualEffectDag,
    compileTimelineVisualEffectGraph,
    renderGraphicEffectGraphSequence,
    renderOverlayEffectGraphSequence,
    compileOverlaySourcePreparation,
} = require('../jobs/exportProcessor.js');

const clip = { id: 'clip-target', start: 0, duration: 1, effects: [] };
const graph = new EffectGraph();
graph.addNode({ id: 'root', type: 'brightness', engine: 'cpu', params: { amount: 1 } });
graph.addNode({ id: 'base', type: 'brightness', engine: 'cpu', params: { amount: 0.7 } });
graph.addNode({ id: 'overlay', type: 'brightness', engine: 'cpu', params: { amount: 1.4 } });
graph.addNode({ id: 'merge', type: 'composite', params: { mode: 'screen', opacity: 0.5 } });
graph.addNode({ id: 'disabled', type: 'contrast', engine: 'cpu', enabled: false, params: { amount: 2 } });
graph.connect('root', 'base').connect('root', 'overlay')
    .connect('base', 'merge', 'base').connect('overlay', 'merge', 'overlay')
    .connect('merge', 'disabled');
const pipeline = new EffectPipeline();
pipeline.effectsByTarget.set(clip.id, graph);
const job = await pipeline.buildRenderJob({ tracks: [{ id: 'video', clips: [clip] }], duration: 1 }, '/tmp/effect-graph.mp4');
const exportedClip = job.timeline.tracks[0].clips[0];
assert.equal(exportedClip.effectGraph.nodes.length, 5, 'the render job retains disabled nodes needed by graph connections');
assert.equal(exportedClip.effectGraph.connections.length, 5, 'the render job retains every authored branch and join edge');
assert.equal(exportedClip.effects.length, 0, 'branched effects are not flattened into the linear clip effects array');

const filterGraph = compileTimelineVisualEffectDag(exportedClip.effectGraph,
    { width: 64, height: 64, duration: 1 }, '0:v', 'dag_out');
assert.ok(filterGraph.some(line => /split=2/.test(line)), 'the export graph duplicates the parent output for both branches');
assert.ok(filterGraph.some(line => line.includes('geq=r=')) && filterGraph.some(line => line.includes('hstack=inputs=2'))
    && filterGraph.some(line => line.includes('colorchannelmixer=aa=0.500000')),
    'the explicit join compiles an alpha-correct screen blend and its opacity');
assert.ok(filterGraph.some(line => /null\[dag_out\]/.test(line)), 'the DAG compiler exposes one final output label');
const wrappedGraph = compileTimelineVisualEffectGraph([`__VIBED_EFFECT_DAG__${JSON.stringify({
    graph: exportedClip.effectGraph,
    options: { width: 64, height: 64, duration: 1 },
})}`], { input: '0:v', output: 'wrapped_out' });
assert.ok(wrappedGraph.join(';').includes('[wrapped_out]'), 'the standard footage effect compiler dispatches the DAG marker');

if (ffmpegPath) {
    const rendered = spawnSync(ffmpegPath, [
        '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=64x64:d=1',
        '-filter_complex', wrappedGraph.join(';'), '-map', '[wrapped_out]', '-frames:v', '1',
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
    ], { encoding: null, maxBuffer: 1024 * 1024 });
    assert.equal(rendered.status, 0, `FFmpeg must execute the branch and composite graph: ${String(rendered.stderr || '')}`);
    assert.equal(rendered.stdout.length, 64 * 64 * 3, 'FFmpeg emits one complete composited frame');
    const baseFrame = spawnSync(ffmpegPath, [
        '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=64x64:d=1',
        '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
    ], { encoding: null, maxBuffer: 1024 * 1024 });
    assert.equal(baseFrame.status, 0, `FFmpeg must create the comparison frame: ${String(baseFrame.stderr || '')}`);
    const mean = frame => frame.reduce((sum, value) => sum + value, 0) / frame.length;
    assert.ok(mean(rendered.stdout) > mean(baseFrame.stdout) + 2,
        'the branch effects and screen join change the rendered pixels');

    const animatedDag = structuredClone(exportedClip.effectGraph);
    const animatedMerge = animatedDag.nodes.find(node => node.id === 'merge');
    animatedMerge.params.mode = 'normal';
    animatedMerge.keyframes.opacity = [
        { time: 0, value: 0, easing: 'linear' }, { time: 1, value: 1, easing: 'linear' },
    ];
    const animatedGraph = compileTimelineVisualEffectGraph([`__VIBED_EFFECT_DAG__${JSON.stringify({
        graph: animatedDag,
        options: { width: 64, height: 64, duration: 1 },
    })}`], { input: '0:v', output: 'animated_out' });
    const animated = spawnSync(ffmpegPath, [
        '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=64x64:r=10:d=1',
        '-filter_complex', animatedGraph.join(';'), '-map', '[animated_out]', '-frames:v', '10',
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
    ], { encoding: null, maxBuffer: 2 * 1024 * 1024 });
    assert.equal(animated.status, 0, `FFmpeg must execute animated composite opacity: ${String(animated.stderr || '')}`);
    const frameSize = 64 * 64 * 3;
    assert.equal(animated.stdout.length, frameSize * 10, 'FFmpeg emits all frames for the animated composite');
    const early = animated.stdout.subarray(0, frameSize);
    const late = animated.stdout.subarray(frameSize * 8, frameSize * 9);
    assert.ok(Math.abs(mean(late) - mean(early)) > 2, 'animated composite opacity changes rendered pixels over time');

    const animatedScreenDag = structuredClone(exportedClip.effectGraph);
    const animatedScreenMerge = animatedScreenDag.nodes.find(node => node.id === 'merge');
    animatedScreenMerge.params.mode = 'screen';
    animatedScreenMerge.keyframes.opacity = [
        { time: 0, value: 0, easing: 'linear' }, { time: 1, value: 1, easing: 'linear' },
    ];
    const animatedScreenGraph = compileTimelineVisualEffectGraph([`__VIBED_EFFECT_DAG__${JSON.stringify({
        graph: animatedScreenDag,
        options: { width: 64, height: 64, duration: 1 },
    })}`], { input: '0:v', output: 'animated_screen_out' });
    assert.ok(animatedScreenGraph.some(line => line.includes("alpha(X,Y)*clip((") && line.includes('geq=r=')),
        'animated non-normal composites apply frame-evaluated opacity to overlay alpha');
    const animatedScreen = spawnSync(ffmpegPath, [
        '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=64x64:r=10:d=1',
        '-filter_complex', animatedScreenGraph.join(';'), '-map', '[animated_screen_out]', '-frames:v', '10',
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
    ], { encoding: null, maxBuffer: 2 * 1024 * 1024 });
    assert.equal(animatedScreen.status, 0, `FFmpeg must execute animated screen opacity: ${String(animatedScreen.stderr || '')}`);
    assert.equal(animatedScreen.stdout.length, frameSize * 10, 'FFmpeg emits every frame for animated screen opacity');
    const screenEarly = animatedScreen.stdout.subarray(0, frameSize);
    const screenLate = animatedScreen.stdout.subarray(frameSize * 8, frameSize * 9);
    assert.ok(Math.abs(mean(screenLate) - mean(screenEarly)) > 2,
        'animated screen opacity changes rendered pixels over time');

    const windowedDag = structuredClone(exportedClip.effectGraph);
    const windowedMerge = windowedDag.nodes.find(node => node.id === 'merge');
    windowedMerge.params.mode = 'difference';
    windowedMerge.startTime = 0.5;
    windowedMerge.endTime = 0.9;
    const windowedGraph = compileTimelineVisualEffectGraph([`__VIBED_EFFECT_DAG__${JSON.stringify({
        graph: windowedDag,
        options: { width: 64, height: 64, duration: 1 },
    })}`], { input: '0:v', output: 'windowed_out' });
    const windowed = spawnSync(ffmpegPath, [
        '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=64x64:r=10:d=1',
        '-filter_complex', windowedGraph.join(';'), '-map', '[windowed_out]', '-frames:v', '10',
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
    ], { encoding: null, maxBuffer: 2 * 1024 * 1024 });
    assert.equal(windowed.status, 0, `FFmpeg executes windowed branch blend opacity: ${String(windowed.stderr || '')}`);
    const windowFrameSize = 64 * 64 * 3;
    const beforeWindow = windowed.stdout.subarray(0, windowFrameSize);
    const insideWindow = windowed.stdout.subarray(windowFrameSize * 6, windowFrameSize * 7);
    assert.ok(Math.abs(mean(insideWindow) - mean(beforeWindow)) > 0.5,
        'a non-normal branch composite activates at its authored timeline start');

    const supportedBlendModes = ['multiply', 'screen', 'darken', 'lighten', 'difference', 'addition', 'overlay',
        'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];
    for (const mode of supportedBlendModes) {
        const blendDag = structuredClone(exportedClip.effectGraph);
        blendDag.nodes.find(node => node.id === 'merge').params.mode = mode;
        const blendGraph = compileTimelineVisualEffectDag(blendDag,
            { width: 64, height: 64, duration: 1 }, '0:v', `blend_${mode.replace(/-/g, '_')}`);
        assert.ok(blendGraph.some(line => line.includes('hstack=inputs=2')) && blendGraph.some(line => line.includes('geq=r=')),
            `the ${mode} scene blend mode compiles through the alpha-correct export path`);
        const blendRender = spawnSync(ffmpegPath, [
            '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=64x64:d=1',
            '-filter_complex', blendGraph.join(';'), '-map', `[blend_${mode.replace(/-/g, '_')}]`, '-frames:v', '1',
            '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
        ], { encoding: null, maxBuffer: 1024 * 1024 });
        assert.equal(blendRender.status, 0, `FFmpeg renders the ${mode} branch composite: ${String(blendRender.stderr || '')}`);
        assert.equal(blendRender.stdout.length, frameSize, `the ${mode} composite emits one full frame`);
    }

    // Generated template/vector layers arrive at the compositor as local PNG
    // sequences. A branch graph must be evaluated against that RGBA sequence
    // before layer geometry and masks, not flattened into its linear stack.
    const graphicTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vibed-graphic-dag-'));
    try {
        const sourceDir = path.join(graphicTmp, 'source');
        fs.mkdirSync(sourceDir, { recursive: true });
        const sourcePattern = path.join(sourceDir, 'f%05d.png');
        const graphicSource = spawnSync(ffmpegPath, [
            '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=64x64:r=10:d=0.3',
            '-frames:v', '3', '-start_number', '0', '-c:v', 'png', '-pix_fmt', 'rgba', '-y', sourcePattern,
        ], { encoding: null, maxBuffer: 1024 * 1024 });
        assert.equal(graphicSource.status, 0, `FFmpeg creates the RGBA graphic sequence: ${String(graphicSource.stderr || '')}`);
        const graphicResult = await renderGraphicEffectGraphSequence({
            pattern: sourcePattern, frames: 3, width: 64, height: 64,
        }, exportedClip.effectGraph, {
            tmpDir: graphicTmp, name: 'branched', fps: 10, duration: 0.3, clipStart: 4,
        });
        assert.equal(graphicResult.files.length, 3, 'the graphic DAG pass preserves the rendered sequence frame count');
        assert.ok(graphicResult.files.every(file => fs.existsSync(file)), 'the graphic DAG pass writes every RGBA frame');
        assert.ok(!fs.readFileSync(sourcePattern.replace('%05d', '00000')).equals(fs.readFileSync(graphicResult.files[0])),
            'the branched graph changes generated graphic pixels before composition');

        const windowedGraphicDag = structuredClone(exportedClip.effectGraph);
        const graphRoot = windowedGraphicDag.nodes.find(node => node.id === 'root');
        graphRoot.startTime = 4.1;
        graphRoot.endTime = 4.2;
        await renderGraphicEffectGraphSequence({
            pattern: sourcePattern, frames: 3, width: 64, height: 64,
        }, windowedGraphicDag, {
            tmpDir: graphicTmp, name: 'timeline-clock', fps: 10, duration: 0.3, clipStart: 4,
        });
        const localGraphScript = fs.readFileSync(path.join(graphicTmp, 'graphic-effect-graph-timeline-clock', 'effect-graph.txt'), 'utf8');
        assert.match(localGraphScript, /gte\(t,0\.100000\).*lt\(t,0\.200000\)/,
            'generated graphic effect windows are converted from project time to their local PNG-sequence clock');

        // Uploaded raster media takes the same true-DAG path. It must be
        // processed after source timing but before any composition geometry;
        // a PNG sequence preserves alpha for the normal layer compiler.
        const imageOverlay = {
            id: 'uploaded-image-dag', source: { type: 'image' }, effectGraph: exportedClip.effectGraph,
            sourceOffset: 0, speed: 1,
        };
        const imageResult = await renderOverlayEffectGraphSequence(sourcePattern.replace('%05d', '00000'), imageOverlay, {
            tmpDir: graphicTmp, name: 'uploaded-image', fps: 10, duration: 0.3, clipStart: 4,
        });
        assert.equal(imageResult.files.length, 3, 'an uploaded image DAG produces one local RGBA frame per output frame');
        assert.ok(!fs.readFileSync(sourcePattern.replace('%05d', '00000')).equals(fs.readFileSync(imageResult.files[0])),
            'the branch graph changes uploaded image pixels before composition');

        const sourceVideo = path.join(graphicTmp, 'source-video.mp4');
        const videoSource = spawnSync(ffmpegPath, [
            '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=64x64:r=10:d=1',
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', sourceVideo,
        ], { encoding: null, maxBuffer: 1024 * 1024 });
        assert.equal(videoSource.status, 0, `FFmpeg creates the overlay video source: ${String(videoSource.stderr || '')}`);
        const videoOverlay = {
            id: 'uploaded-video-dag', source: { type: 'video' }, effectGraph: exportedClip.effectGraph,
            sourceOffset: 0, speed: 2,
        };
        const videoResult = await renderOverlayEffectGraphSequence(sourceVideo, videoOverlay, {
            tmpDir: graphicTmp, name: 'uploaded-video', fps: 10, duration: 0.3, clipStart: 4,
        });
        assert.equal(videoResult.files.length, 3, 'an uploaded video DAG preserves the requested local frame count');
        assert.ok(!fs.readFileSync(videoResult.files[0]).equals(fs.readFileSync(sourcePattern.replace('%05d', '00000'))),
            'the branch graph is applied to uploaded video before composition');
        assert.ok(compileOverlaySourcePreparation({ source: { type: 'video' }, speed: 2 }).join(',').includes('/2.000000'),
            'uploaded-media prepass honors authored overlay speed');
        assert.ok(compileOverlaySourcePreparation({
            source: { type: 'video' }, sourceTimeMap: [{ source: 0.8, output: 0 }, { source: 0.2, output: 0.3 }],
        }).join(',').includes('reverse'), 'uploaded-media prepass honors reverse source-time maps');
        const reverseResult = await renderOverlayEffectGraphSequence(sourceVideo, {
            ...videoOverlay,
            id: 'uploaded-video-reverse-dag',
            sourceTimeMap: [{ source: 0.8, output: 0 }, { source: 0.2, output: 0.3 }],
        }, {
            tmpDir: graphicTmp, name: 'uploaded-video-reverse', fps: 10, duration: 0.3, clipStart: 4,
        });
        assert.equal(reverseResult.files.length, 3,
            'the uploaded-media DAG prepass renders every requested frame through a reverse source-time map');
    } finally {
        fs.rmSync(graphicTmp, { recursive: true, force: true });
    }
} else {
    console.log('FFmpeg pixel render skipped: ffmpeg-static is unavailable');
}

assert.throws(() => compileTimelineVisualEffectDag({
    nodes: [{ id: 'unsupported', type: 'unknown_visual_effect', engine: 'gpu', enabled: true }],
    connections: [],
}, { width: 64, height: 64, duration: 1 }, '0:v', 'out'), /no visual export implementation/,
'unsupported active branch effects fail clearly instead of disappearing from export');
const unsupportedBlendDag = structuredClone(exportedClip.effectGraph);
unsupportedBlendDag.nodes.find(node => node.id === 'merge').params.mode = 'plus-lighter';
assert.throws(() => compileTimelineVisualEffectDag(unsupportedBlendDag,
    { width: 64, height: 64, duration: 1 }, '0:v', 'unsupported_blend_out'), /unsupported composite blend mode/,
'unsupported blend names fail clearly instead of being exported with a different blend');
assert.throws(() => compileTimelineVisualEffectDag({
    nodes: [
        { id: 'source', type: 'brightness', engine: 'cpu', enabled: true, params: { amount: 1 } },
        { id: 'a', type: 'brightness', engine: 'cpu', enabled: true, params: { amount: 1 } },
        { id: 'b', type: 'brightness', engine: 'cpu', enabled: true, params: { amount: 1 } },
        { id: 'join', type: 'contrast', engine: 'cpu', enabled: true, params: { amount: 1 } },
    ],
    connections: [
        { from: 'source', to: 'a' }, { from: 'source', to: 'b' },
        { from: 'a', to: 'join', port: 'base' }, { from: 'b', to: 'join', port: 'overlay' },
    ],
}, { width: 64, height: 64, duration: 1 }, '0:v', 'out'), /needs base and overlay inputs on a composite node/,
'ambiguous joins are rejected instead of guessing their merge semantics');

console.log('Effect graph export: payload, branch topology, blend render, and unsupported-effect guard passed');
