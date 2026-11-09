import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { EffectPipeline } from '../client/src/effects/EffectPipeline.js';
import { EffectRenderer } from '../client/src/effects/EffectRenderer.js';
import { EffectNode } from '../client/src/effects/EffectNode.js';
import { EffectGraph } from '../client/src/effects/EffectGraph.js';
import { resolveTimelineEffectTransform } from '../client/src/motion/TimelineVisualEffects.js';

const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static');
const { buildSmoothZoomFilter, compileTimelineVisualEffects, collectTimelineEffectWarnings } = require('../jobs/exportProcessor.js');
assert.deepEqual(compileTimelineVisualEffects([{ kind: 'imaginary-effect', enabled: true, params: {} }]), [],
    'unsupported footage effects do not create pretend render filters');
assert.match(collectTimelineEffectWarnings([{ name: 'Primary', start: 0, duration: 2,
    effects: [{ kind: 'imaginary-effect', enabled: true, params: {} }] }])[0], /not supported in export and was skipped/,
    'the partial export report identifies footage effects the renderer skipped');
assert.throws(() => compileTimelineVisualEffects([{ id: 'imaginary-preset', enabled: true }]),
    /unsupported footage effect preset: imaginary-preset/,
    'primary-footage export refuses an enabled preset it cannot render');
assert.deepEqual(compileTimelineVisualEffects([{ kind: 'imaginary-effect', enabled: false, params: {} }]), [],
    'disabled unknown effects do not block primary-footage export');
globalThis.localStorage = { getItem: () => null };
const originalFetch = globalThis.fetch;
const requests = [];
globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === '/api/render') {
        return new Response(JSON.stringify({ jobId: 'export-test-1' }), { status: 200 });
    }
    if (url === '/api/jobs/export-test-1/status') {
        return new Response(JSON.stringify({
            state: 'completed', progress: 100,
            result: { success: true, url: '/exports/test.mp4', filename: 'test.mp4' }
        }), { status: 200 });
    }
    throw new Error(`Unexpected request: ${url}`);
};

try {
    const movedEffectPipeline = new EffectPipeline();
    movedEffectPipeline.addEffect({ id: 'move-me', type: 'brightness', targetId: 'clip-before', params: { amount: 0.8 } });
    movedEffectPipeline.addEffect({ id: 'move-me', type: 'contrast', targetId: 'clip-after', params: { amount: 1.2 } });
    assert.equal(movedEffectPipeline.getEffectsForTarget('clip-before').length, 0,
        'editing an effect target removes its previous graph membership');
    assert.equal(movedEffectPipeline.getEffectsForTarget('clip-after').length, 1,
        'editing an effect target adds exactly one replacement graph node');
    assert.equal(movedEffectPipeline.getEffectsForTarget('clip-after')[0].type, 'contrast',
        'the target graph holds the latest effect definition');
    movedEffectPipeline.addEffect({ id: 'move-me', type: 'saturation', targetId: 'clip-after', params: { amount: 0.5 } });
    assert.equal(movedEffectPipeline.getEffectsForTarget('clip-after').length, 1,
        'editing an effect in place replaces rather than duplicates its graph node');
    assert.equal(movedEffectPipeline.getEffectsForTarget('clip-after')[0].type, 'saturation',
        'in-place effect edits are reflected in preview/export graph state');
    const movedJob = await movedEffectPipeline.buildRenderJob({
        tracks: [{ id: 'video-track', clips: [
            { id: 'clip-before', duration: 1 },
            { id: 'clip-after', duration: 1 },
        ] }],
        assets: [],
    });
    assert.equal(movedJob.timeline.tracks[0].clips[0].effects.length, 0,
        'export no longer applies a moved effect to its previous clip');
    assert.equal(movedJob.timeline.tracks[0].clips[1].effects[0].kind, 'saturation',
        'export applies the edited effect only to its current target');

    const updatedEffectPipeline = new EffectPipeline();
    updatedEffectPipeline.addEffect({ id: 'update-target', type: 'brightness', targetId: 'clip-old', params: { amount: 0.7 } });
    updatedEffectPipeline.updateEffect('update-target', { targetId: 'clip-new' });
    assert.equal(updatedEffectPipeline.getEffectsForTarget('clip-old').length, 0,
        'updateEffect removes an effect from its previous target graph');
    assert.equal(updatedEffectPipeline.getEffectsForTarget('clip-new').length, 1,
        'updateEffect adds the existing node to the new target graph');
    updatedEffectPipeline.updateEffect('update-target', { targetId: null });
    assert.equal(updatedEffectPipeline.getEffectsForTarget('clip-new').length, 0,
        'clearing targetId detaches the effect from preview graph membership');
    const detachedJob = await updatedEffectPipeline.buildRenderJob({
        tracks: [{ id: 'video-track', clips: [{ id: 'clip-old', duration: 1 }, { id: 'clip-new', duration: 1 }] }],
        assets: [],
    });
    assert.deepEqual(detachedJob.timeline.tracks[0].clips.map(clip => clip.effects.length), [0, 0],
        'a detached effect cannot leak into export on either prior target');

    const chainedPipeline = new EffectPipeline();
    const chainNodes = ['chain-a', 'chain-b', 'chain-c', 'dest-a', 'dest-b'].map((id, index) =>
        chainedPipeline.addEffect({ id, type: 'brightness', targetId: index < 3 ? 'chain-source' : 'chain-destination', order: index % 3 }));
    chainedPipeline.effectsByTarget.set('chain-source', EffectGraph.fromLinearChain(chainNodes.slice(0, 3)));
    chainedPipeline.effectsByTarget.set('chain-destination', EffectGraph.fromLinearChain(chainNodes.slice(3)));
    chainedPipeline.updateEffect('chain-b', { targetId: 'chain-destination' });
    assert.deepEqual(chainedPipeline.getGraphForTarget('chain-source').getExecutionOrder().map(node => node.id), ['chain-a', 'chain-c'],
        'moving a middle effect splices its old connected chain back together');
    assert.deepEqual(chainedPipeline.getGraphForTarget('chain-destination').getExecutionOrder().map(node => node.id), ['dest-a', 'dest-b', 'chain-b'],
        'moving an effect into a connected stack inserts it as an executable chain node');
    assert.equal(chainedPipeline.getGraphForTarget('chain-source').validate().valid, true,
        'the source graph remains valid after a chain move');
    assert.equal(chainedPipeline.getGraphForTarget('chain-destination').validate().valid, true,
        'the destination graph remains valid after a chain move');
    chainedPipeline.removeEffect('dest-a');
    assert.deepEqual(chainedPipeline.getGraphForTarget('chain-destination').getExecutionOrder().map(node => node.id), ['dest-b', 'chain-b'],
        'removing a connected effect also splices the remaining stack');

    const validGraph = EffectGraph.fromLinearChain([
        new EffectNode({ id: 'graph-a', type: 'brightness' }),
        new EffectNode({ id: 'graph-b', type: 'contrast' }),
    ]);
    assert.equal(validGraph.validate().valid, true, 'a supported linear effect graph validates');
    const branchingGraph = new EffectGraph();
    for (const id of ['branch-a', 'branch-b', 'branch-c']) branchingGraph.addNode(new EffectNode({ id, type: 'brightness' }));
    branchingGraph.connect('branch-a', 'branch-b').connect('branch-a', 'branch-c');
    assert.equal(branchingGraph.validate().valid, false, 'validation rejects unsupported effect branches before execution');
    const disconnectedGraph = new EffectGraph();
    for (const id of ['connected-a', 'connected-b', 'orphan']) disconnectedGraph.addNode(new EffectNode({ id, type: 'brightness' }));
    disconnectedGraph.connect('connected-a', 'connected-b');
    assert.match(disconnectedGraph.validate().errors.join(' '), /disconnected nodes/, 'validation identifies orphan effect nodes distinctly');

    const guardedNode = new EffectNode({ type: 'brightness', params: { amount: 1 } });
    assert.equal(guardedNode.setParam('amount', Number.NaN), false, 'effect controls reject non-finite parameter writes');
    assert.equal(guardedNode.getParam('amount'), 1, 'a rejected parameter write preserves the last valid value');
    assert.equal(guardedNode.addKeyframe('amount', -1, 0), false, 'effect keyframes reject negative times');
    assert.equal(guardedNode.addKeyframe('amount', 1, Number.POSITIVE_INFINITY), false, 'effect keyframes reject non-finite values');
    assert.equal(guardedNode.getParamAt('amount', 2), 1, 'malformed persisted keyframes fall back to the valid base parameter');
    assert.equal(guardedNode.addKeyframe('tint', 0, [0, 0.5, 1]), true, 'finite vector keyframes remain supported');

    const pipeline = new EffectPipeline();
    pipeline.addEffect({ id: 'effect-brightness', type: 'brightness', engine: 'cpu', targetId: 'clip-1', params: { amount: 1.2 } });
    const renderer = new EffectRenderer({ pipeline });
    const result = await renderer.renderFinal({
        tracks: [{ id: 'video-track', type: 'video', clips: [{ id: 'clip-1', duration: 4, effects: [
            { id: 'effect-brightness', kind: 'brightness', enabled: true, params: { amount: 0.8 } }
        ] }] }],
        duration: 4,
        assets: []
    }, null, { settings: { resolution: '1080p' } });

    assert.equal(result.url, '/exports/test.mp4');
    assert.equal(requests.length, 2, 'enqueue export and poll canonical job status');
    assert.equal(requests[0].url, '/api/render');
    assert.equal(requests[1].url, '/api/jobs/export-test-1/status');
    const payload = JSON.parse(requests[0].options.body);
    assert.equal(payload.settings.resolution, '1080p');
    assert.equal(payload.timeline.tracks[0].clips[0].effects[0].kind, 'brightness');
    assert.equal(payload.timeline.tracks[0].clips[0].effects[0].params.amount, 1.2);
    assert.equal(payload.timeline.tracks[0].clips[0].effects.length, 1, 'pipeline compilation replaces the matching timeline effect instead of applying it twice');

    const orderedPipeline = new EffectPipeline();
    orderedPipeline.addEffect({ id: 'effect-a', type: 'brightness', engine: 'cpu', targetId: 'clip-order', order: 20, params: { amount: 1.1 } });
    orderedPipeline.addEffect({ id: 'effect-b', type: 'contrast', engine: 'cpu', targetId: 'clip-order', order: 0, params: { amount: 1.2 } });
    orderedPipeline.effectsByTarget.get('clip-order').connect('effect-a', 'effect-b');
    const orderedJob = await orderedPipeline.buildRenderJob({
        tracks: [{ id: 'video-track', clips: [{ id: 'clip-order', duration: 2 }] }],
        assets: []
    });
    assert.deepEqual(orderedJob.timeline.tracks[0].clips[0].effects.map(effect => [effect.id, effect.order]), [
        ['effect-a', 0], ['effect-b', 1]
    ], 'export serializes connected graph order, even when authored order fields disagree');

    const mergedPipeline = new EffectPipeline();
    mergedPipeline.addEffect({ id: 'graph-first', type: 'contrast', engine: 'cpu', targetId: 'clip-merged', params: { amount: 1.2 } });
    mergedPipeline.addEffect({ id: 'graph-second', type: 'brightness', engine: 'cpu', targetId: 'clip-merged', params: { amount: 1.3 } });
    mergedPipeline.effectsByTarget.get('clip-merged').connect('graph-first', 'graph-second');
    const mergedJob = await mergedPipeline.buildRenderJob({
        tracks: [{ id: 'video-track', clips: [{ id: 'clip-merged', duration: 2, effects: [
            { id: 'native-saturation', kind: 'saturation', enabled: true, order: 4, params: { amount: 1.1 } },
            { id: 'native-hue', kind: 'hue', enabled: true, order: 1, params: { degrees: 12 } }
        ] }] }],
        assets: []
    });
    assert.deepEqual(mergedJob.timeline.tracks[0].clips[0].effects.map(effect => [effect.id, effect.order]), [
        ['native-hue', 0], ['native-saturation', 1], ['graph-first', 2], ['graph-second', 3]
    ], 'native clip effects and connected graph effects merge with a deterministic unique order');
    assert.deepEqual(mergedJob.timeline.tracks[0].clips[0].effects.map(effect => effect.kind), [
        'hue', 'saturation', 'contrast', 'brightness'
    ], 'the canonical export payload preserves merged effect execution order');
    const mergedFilters = compileTimelineVisualEffects(mergedJob.timeline.tracks[0].clips[0].effects).join(',');
    assert.ok(mergedFilters.indexOf('hue=') < mergedFilters.indexOf('eq=saturation='), 'native hue runs before native saturation in the rendered chain');
    assert.ok(mergedFilters.indexOf('eq=saturation=') < mergedFilters.indexOf('eq=contrast='), 'native clip effects run before the appended effect graph');
    assert.ok(mergedFilters.indexOf('eq=contrast=') < mergedFilters.indexOf('colorchannelmixer='), 'the graph itself keeps its connected execution order through FFmpeg compilation');

    const analyzedPipeline = new EffectPipeline({
        aiEngine: {
            async preAnalyzeChain(effects, context) {
                assert.equal(context.startTime, 10, 'AI analyzes the clip source in-point');
                assert.equal(context.endTime, 14, 'AI analyzes only the visible source range');
                return Object.fromEntries(effects.map(effect => [effect.id, {
                    success: true,
                    keyframes: [
                        { time: 10, x: 0.5, y: 0.4, scale: 1, easing: 'linear' },
                        { time: 14, x: 0.6, y: 0.35, scale: 1.6, easing: 'easeInOut' }
                    ]
                }]));
            }
        }
    });
    analyzedPipeline.addEffect({ type: 'smart_zoom', targetId: 'clip-ai', params: { zoomLevel: 1.6 } });
    const analyzedJob = await analyzedPipeline.buildRenderJob({
        tracks: [{ id: 'video-track', type: 'video', clips: [{ id: 'clip-ai', start: 5, offset: 10, duration: 4, sourceUrl: '/media/source.mp4' }] }],
        assets: []
    });
    const analyzedClip = analyzedJob.timeline.tracks[0].clips[0];
    assert.deepEqual(analyzedClip.keyframes.scale.map(frame => [frame.time, frame.value]), [[0, 1], [4, 1.6]],
        'AI smart zoom analysis becomes executable clip scale keyframes');
    assert.deepEqual(analyzedClip.keyframes.panX.map(frame => frame.time), [0, 4],
        'AI subject framing becomes executable horizontal pan keyframes');
    assert.ok(Math.abs(analyzedClip.keyframes.panX[1].value + 0.1) < 1e-9,
        'AI framing converts subject coordinates into the expected image pan');
    const smartZoomEffect = analyzedPipeline.getEffectsByEngine('ai').find(effect => effect.type === 'smart_zoom');
    assert.equal(analyzedClip.metadata.aiEffectAnalysis[smartZoomEffect.id].success, true,
        'analysis provenance remains attached to the clip after the AI directive is compiled into native framing keyframes');
    const aiZoomFilter = buildSmoothZoomFilter(analyzedClip.keyframes.scale, {
        fps: 24, panX: analyzedClip.keyframes.panX, panY: analyzedClip.keyframes.panY
    });
    const aiZoomRender = spawnSync(ffmpeg, [
        '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=24:duration=0.5',
        '-vf', aiZoomFilter, '-f', 'null', '-'
    ], { encoding: 'utf8', timeout: 20000 });
    assert.equal(aiZoomRender.status, 0, `FFmpeg renders analyzed smart-zoom keyframes: ${aiZoomRender.stderr || aiZoomRender.error?.message || ''}`);

    const framingPipeline = new EffectPipeline({
        aiEngine: {
            async preAnalyzeChain(effects) {
                return Object.fromEntries(effects.map(effect => [effect.id, {
                    segments: [
                        { startTime: 2, endTime: 4, framing: { x: 0.35, y: 0.3, scale: 1.25 } },
                        { startTime: 4, endTime: 6, framing: { x: 0.65, y: 0.4, scale: 1.5 } }
                    ]
                }]));
            }
        }
    });
    framingPipeline.addEffect({ type: 'emotion_frame', targetId: 'clip-frame', params: { transitionSpeed: 0.5 } });
    const framingJob = await framingPipeline.buildRenderJob({
        tracks: [{ id: 'video-track', type: 'video', clips: [{ id: 'clip-frame', offset: 2, duration: 4, sourceUrl: '/media/source.mp4' }] }],
        assets: []
    });
    const framingClip = framingJob.timeline.tracks[0].clips[0];
    assert.deepEqual(framingClip.keyframes.scale.map(frame => [frame.time, frame.value]), [
        [0, 1], [0.5, 1.25], [2, 1.25], [2.5, 1.5], [4, 1.5]
    ], 'emotion framing eases between segment compositions instead of jumping');
    const framingFilter = buildSmoothZoomFilter(framingClip.keyframes.scale, {
        fps: 24, panX: framingClip.keyframes.panX, panY: framingClip.keyframes.panY
    });
    const framingRender = spawnSync(ffmpeg, [
        '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=24:duration=0.5',
        '-vf', framingFilter, '-f', 'null', '-'
    ], { encoding: 'utf8', timeout: 20000 });
    assert.equal(framingRender.status, 0, `FFmpeg renders smoothed emotion framing: ${framingRender.stderr || framingRender.error?.message || ''}`);

    const beatPipeline = new EffectPipeline({
        aiEngine: {
            async preAnalyzeChain(effects) {
                return Object.fromEntries(effects.map(effect => [effect.id, {
                    effectKeyframes: [{ time: 1, brightness: 35 }, { time: 1.2, brightness: 0 }]
                }]));
            }
        }
    });
    beatPipeline.addEffect({ type: 'beat_sync', targetId: 'clip-beat', params: { effectType: 'flash' } });
    const beatJob = await beatPipeline.buildRenderJob({
        tracks: [{ id: 'video-track', type: 'video', clips: [{ id: 'clip-beat', duration: 3, sourceUrl: '/media/source.mp4' }] }],
        assets: []
    });
    const flashEffect = beatJob.timeline.tracks[0].clips[0].effects.find(effect => effect.id.endsWith('-generated-flash'));
    assert.ok(flashEffect, 'beat flash creates a supported footage brightness effect');
    assert.deepEqual(flashEffect.keyframes.amount.map(frame => [frame.time, frame.value]), [[1, 0.35], [1.2, 0]],
        'beat flash analysis becomes executable brightness keyframes');

    const beatShakePipeline = new EffectPipeline({
        aiEngine: {
            async preAnalyzeChain(effects) {
                return Object.fromEntries(effects.map(effect => [effect.id, {
                    effectKeyframes: [{ time: 2.5, intensity: 8 }, { time: 2.8, intensity: 0 }]
                }]));
            }
        }
    });
    beatShakePipeline.addEffect({ type: 'beat_sync', targetId: 'clip-beat-shake', params: { effectType: 'shake', intensity: 0.6 } });
    const beatShakeJob = await beatShakePipeline.buildRenderJob({
        tracks: [{ id: 'video-track', type: 'video', clips: [{ id: 'clip-beat-shake', start: 5, offset: 2, duration: 3, sourceUrl: '/media/source.mp4' }] }],
        assets: []
    });
    const beatShakeClip = beatShakeJob.timeline.tracks[0].clips[0];
    const generatedShake = beatShakeClip.effects.find(effect => effect.id.endsWith('-generated-shake'));
    assert.ok(generatedShake, 'beat shake analysis becomes an executable footage effect');
    assert.deepEqual(generatedShake.keyframes.intensity.map(frame => [frame.time, frame.value]), [[5.5, 8], [5.58, 0]],
        'beat shake converts source analysis timestamps into project-time intensity keyframes');
    assert.deepEqual(generatedShake.keyframes.rotationAmount.map(frame => [frame.time, frame.value]), [[5.5, 0.4], [5.58, 0]],
        'beat shake rotation follows the same beat envelope instead of rotating continuously');
    const previewBeatShake = resolveTimelineEffectTransform([generatedShake], 0.5, 1080, 5.5, { clipStart: 5, clipDuration: 3 });
    const previewReleasedShake = resolveTimelineEffectTransform([generatedShake], 0.7, 1080, 5.7, { clipStart: 5, clipDuration: 3 });
    assert.match(previewBeatShake, /translate\(/, 'preview applies the generated beat envelope at its analyzed beat');
    assert.equal(previewReleasedShake, '', 'preview returns to a still frame after the generated shake pulse');
    assert.deepEqual(collectTimelineEffectWarnings([{ ...beatShakeClip, name: 'Beat shake' }]), [],
        'verified beat shake analysis is no longer reported as skipped');
    const beatShakeFilters = compileTimelineVisualEffects(beatShakeClip.effects, {
        width: 320, height: 180, duration: 3, clipStart: 5
    });
    assert.ok(beatShakeFilters.some(filter => filter.includes('sin(t*16*2*PI') && filter.includes('if(lt(t,0.580000)'))
        && beatShakeFilters.some(filter => filter.includes('rotate=a=') && filter.includes('if(lt(t,0.580000)')),
        'primary-footage shake position and rotation use the generated per-frame beat envelope');
    const beatShakeRender = spawnSync(ffmpeg, [
        '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24:duration=3',
        '-vf', beatShakeFilters.join(','), '-f', 'null', '-'
    ], { encoding: 'utf8', timeout: 20000 });
    assert.equal(beatShakeRender.status, 0,
        `FFmpeg renders beat-driven shake keyframes: ${beatShakeRender.stderr || beatShakeRender.error?.message || ''}`);
    const beatShakePixels = spawnSync(ffmpeg, [
        '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24:duration=1',
        '-vf', beatShakeFilters.join(','), '-frames:v', '24', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'
    ], { encoding: null, timeout: 20000, maxBuffer: 8 * 1024 * 1024 });
    assert.equal(beatShakePixels.status, 0,
        `FFmpeg renders beat shake frames for pixel comparison: ${beatShakePixels.stderr?.toString() || beatShakePixels.error?.message || ''}`);
    const beatFrameSize = 320 * 180 * 3;
    const beatFrame = beatShakePixels.stdout.subarray(12 * beatFrameSize, 13 * beatFrameSize);
    const recoveredFrame = beatShakePixels.stdout.subarray(20 * beatFrameSize, 21 * beatFrameSize);
    assert.notDeepEqual(beatFrame, recoveredFrame,
        'beat-driven shake visibly changes pixels during the pulse and releases back to the unshaken framing');

    const analyzedSources = [];
    const analyzedRanges = [];
    const trackAI = new EffectPipeline({
        aiEngine: {
            async preAnalyzeChain(effects, context) {
                analyzedSources.push(context.videoUrl);
                analyzedRanges.push([effects[0].startTime, effects[0].endTime]);
                return Object.fromEntries(effects.map(effect => [effect.id, {
                    keyframes: [{ time: 0, x: 0.5, y: 0.3, scale: 1 }]
                }]));
            }
        }
    });
    trackAI.addEffect({ type: 'smart_zoom', targetId: 'video-track', startTime: 5.5, endTime: 6.5, params: { zoomLevel: 1.4 } });
    await trackAI.buildRenderJob({
        tracks: [{ id: 'video-track', type: 'video', clips: [
            { id: 'clip-a', start: 5, offset: 10, speed: 2, duration: 2, sourceUrl: '/media/a.mp4' },
            { id: 'clip-b', start: 5, offset: 10, speed: 2, duration: 2, assetId: 'asset-b' }
        ] }],
        assets: [{ id: 'asset-b', sourceUrl: '/media/b.mp4' }]
    }, null, { getVideoUrl: id => id === 'clip-a' ? '/resolved/a.mp4' : null });
    assert.deepEqual(analyzedSources, ['/resolved/a.mp4', '/media/b.mp4'],
        'track-targeted AI analysis resolves the source URL separately for each clip, including asset manifest fallback');
    assert.deepEqual(analyzedRanges, [[11, 13], [11, 13]],
        'timeline-scoped AI effects map their range into each clip’s source time, accounting for clip offset and playback speed');

    let activeExecutions = 0;
    let maxConcurrentExecutions = 0;
    let renderExecutions = 0;
    const completedJobs = [];
    const reportedErrors = [];
    const reportedProgress = [];
    const cancellationRenderer = new EffectRenderer({
        pipeline: { async buildRenderJob() { return { timeline: {}, settings: {} }; } },
        onComplete: job => completedJobs.push(job),
        onError: error => reportedErrors.push(error),
        onProgress: progress => reportedProgress.push(progress),
    });
    cancellationRenderer._executeRender = (_data, _onProgress, signal) => {
        renderExecutions++;
        activeExecutions++;
        maxConcurrentExecutions = Math.max(maxConcurrentExecutions, activeExecutions);
        if (renderExecutions === 1) {
            return new Promise((resolve, reject) => signal.addEventListener('abort', () => {
                activeExecutions--;
                const error = new Error('Polling cancelled');
                error.name = 'AbortError';
                reject(error);
            }, { once: true }));
        }
        activeExecutions--;
        return Promise.resolve({ url: '/exports/second.mp4' });
    };
    const firstQueuedId = cancellationRenderer.queueRender({ timeline: { tracks: [] }, outputPath: '/exports/first.mp4' });
    for (let attempt = 0; attempt < 20 && renderExecutions === 0; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    assert.equal(renderExecutions, 1, 'the first queued export starts before cancellation');
    assert.equal(cancellationRenderer.getStatus().currentJob.id, firstQueuedId,
        'the queued export ID is retained by the active render lifecycle');
    const cancelledQueuedJob = cancellationRenderer.getStatus().currentJob;
    await assert.rejects(
        cancellationRenderer.renderFinal({ tracks: [] }, '/exports/direct.mp4'),
        /A render is already in progress/,
        'direct final-render calls cannot bypass the single-render queue guard',
    );
    assert.equal(cancellationRenderer.cancelRender(), true, 'an active export can be cancelled');
    assert.equal(cancellationRenderer.getStatus().isRendering, true,
        'cancellation keeps the renderer busy until the active request settles');
    const secondQueuedId = cancellationRenderer.queueRender({ timeline: { tracks: [] }, outputPath: '/exports/second.mp4' });
    assert.equal(renderExecutions, 1, 'a replacement export waits while the cancelled request is settling');
    for (let attempt = 0; attempt < 100 && (cancellationRenderer.getStatus().isRendering || cancellationRenderer.getStatus().queueLength); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    assert.equal(renderExecutions, 2, 'the next queued export starts after cancellation cleanup');
    assert.equal(maxConcurrentExecutions, 1, 'cancelling one export never overlaps it with the next export');
    assert.equal(cancellationRenderer.getStatus().isRendering, false, 'the queue returns to idle after the next export completes');
    assert.equal(completedJobs.length, 1, 'the successfully rendered queued job reports completion');
    assert.equal(cancelledQueuedJob.status, 'cancelled', 'the original queued record retains its terminal cancelled status');
    assert.equal(completedJobs[0].id, secondQueuedId, 'completion reports the ID returned when the queued export was created');
    assert.equal(cancellationRenderer.getRenderJob(firstQueuedId).status, 'cancelled',
        'cancelled exports remain queryable by the ID returned at enqueue time');
    assert.equal(cancellationRenderer.getRenderJob(secondQueuedId).status, 'complete',
        'completed exports remain queryable after leaving the active render slot');
    assert.equal(cancellationRenderer.getRenderJob(secondQueuedId).result.url, '/exports/second.mp4',
        'render history retains the verified output result');
    assert.ok(reportedProgress.some(progress => progress.jobId === secondQueuedId),
        'progress updates use the same queued export ID returned to the caller');
    assert.equal(reportedErrors.length, 0, 'an expected cancellation is not reported as a render failure');
    cancellationRenderer.destroy();

    const queueClearRenderer = new EffectRenderer();
    queueClearRenderer.isRendering = true;
    const removedIds = [
        queueClearRenderer.queueRender({ timeline: {}, outputPath: '/exports/removed-a.mp4' }),
        queueClearRenderer.queueRender({ timeline: {}, outputPath: '/exports/removed-b.mp4' }),
    ];
    assert.equal(queueClearRenderer.clearQueue(), 2, 'clearQueue reports how many pending renders were removed');
    assert.deepEqual(removedIds.map(id => queueClearRenderer.getRenderJob(id).status), ['cancelled', 'cancelled'],
        'clearing pending renders records a terminal status instead of leaving jobs stuck as queued');
    queueClearRenderer.isRendering = false;
    queueClearRenderer.destroy();
    console.log('✅ Effect renderer uses canonical export API, polls completion, and includes targeted effects');
} finally {
    globalThis.fetch = originalFetch;
    delete globalThis.localStorage;
}
