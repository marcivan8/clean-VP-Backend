import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { resampleMonoPcm } from '../client/src/engine/audioResample.js';
import {
    createTimelineRetimeMap,
    mapSourceIntervalToTimelineSegments,
    mapSourceTimeToTimeline,
    mapTimelineTimeToRate,
    mapTimelineTimeToSource,
    serializeTimelineRetimeMap,
} from '../client/src/timeline/retimeMap.js';

const require = createRequire(import.meta.url);
const { buildSpeedRetimePlan } = require('../jobs/exportProcessor.js');

const partial = createTimelineRetimeMap({
    start: 10, duration: 4, offset: 3, speed: 1.5,
    effects: [{ kind: 'speed_change', startTime: 11, endTime: 13, params: { speed: 2 } }],
});
assert.equal(mapTimelineTimeToSource(partial, 10), 3);
assert.ok(Math.abs(mapTimelineTimeToSource(partial, 11) - 4) < 2e-5);
assert.equal(mapTimelineTimeToRate(partial, 10.5), 1,
    'partial speed effect uses normal rate outside its active window, matching export');
assert.equal(mapTimelineTimeToRate(partial, 12), 2);
assert.equal(mapTimelineTimeToRate(partial, 11), 2,
    'the new speed owns the exact instant where a partial retime window starts');
assert.equal(mapTimelineTimeToRate(partial, 13), 1.5,
    'the effect end uses the rate midpoint across its bounded epsilon transition');
assert.equal(mapTimelineTimeToRate(partial, Number.NaN), 1,
    'a non-finite playhead time safely resolves to the clip start rate');
assert.equal(mapTimelineTimeToSource(partial, Number.NaN), 3,
    'a non-finite playhead time safely seeks to the source offset');
assert.equal(mapSourceTimeToTimeline(partial, Number.NaN), 10,
    'a non-finite media timestamp safely maps to the timeline start');
const emptyMap = createTimelineRetimeMap({ start: 10, duration: 0, offset: 3 });
assert.equal(mapSourceTimeToTimeline(emptyMap, Number.NaN), 10,
    'an empty retime map also falls back to its timeline origin');
assert.equal(partial.maintainPitch, true);
assert.equal(serializeTimelineRetimeMap(partial).maintainPitch, true,
    'pitch preference survives serialization to the playback engine');
assert.ok(Math.abs(mapTimelineTimeToSource(partial, 13) - 8) < 2e-5);
assert.ok(Math.abs(mapTimelineTimeToSource(partial, 14) - 9) < 2e-5);
assert.ok(Math.abs(mapSourceTimeToTimeline(partial, 7) - 12.5) < 0.01,
    'source timestamps invert into the corresponding timeline position');
const crossingAudio = mapSourceIntervalToTimelineSegments(partial, 3.95, 4.1);
assert.ok(crossingAudio.length >= 2, 'decoded audio is split where a retime boundary falls inside a packet');
for (let i = 1; i < crossingAudio.length; i++) {
    assert.ok(Math.abs(crossingAudio[i - 1].timelineEnd - crossingAudio[i].timelineStart) < 1e-9,
        'split audio intervals remain continuous on the timeline');
}
assert.equal(crossingAudio[0].rate, 1);
assert.equal(crossingAudio.at(-1).rate, 2);
const pitchShiftMap = createTimelineRetimeMap({
    start: 0, duration: 2,
    effects: [{ kind: 'speed_change', params: { speed: 1.5, maintainPitch: false } }],
});
assert.equal(pitchShiftMap.maintainPitch, false,
    'an explicit pitch-shift preference survives into the playback map');
const exportPlan = buildSpeedRetimePlan(4, [
    { time: 10, value: 1, easing: 'linear' },
    { time: 10.99999, value: 1, easing: 'linear' },
    { time: 11, value: 2, easing: 'linear' },
    { time: 13, value: 2, easing: 'linear' },
    { time: 13.00001, value: 1, easing: 'linear' },
    { time: 14, value: 1, easing: 'linear' },
], 1, 10, true);
assert.equal(partial.segments.length, exportPlan.intervals.length,
    'preview and export produce the same retime interval count');
for (let i = 0; i < partial.segments.length; i++) {
    const preview = partial.segments[i];
    const exported = exportPlan.intervals[i];
    assert.ok(Math.abs(preview.start - exported.start) < 1e-9);
    assert.ok(Math.abs(preview.end - exported.end) < 1e-9);
    assert.ok(Math.abs(preview.rate - exported.speed) < 1e-9);
    assert.ok(Math.abs(preview.sourceStart - 3 - exported.sourceStart) < 1e-9);
    assert.ok(Math.abs(preview.sourceEnd - 3 - exported.sourceEnd) < 1e-9);
}

const animated = createTimelineRetimeMap({
    start: 2, duration: 3, offset: 5,
    effects: [{
        kind: 'speed_change', params: { speed: 1 },
        keyframes: { speed: [
            { time: 2, value: 1 },
            { time: 5, value: 3, easing: 'easeInOutCubic' },
        ] },
    }],
});
assert.ok(mapTimelineTimeToRate(animated, 3.5) > 1.8 && mapTimelineTimeToRate(animated, 3.5) < 2.2,
    'speed keyframe easing determines the local playback rate');
const stepped = createTimelineRetimeMap({
    start: 0, duration: 2,
    effects: [{ kind: 'speed_change', params: { speed: 0.1 }, keyframes: { speed: [
        { time: 0, value: 0.1 }, { time: 2, value: 4, easing: 'steps(2, end)' },
    ] } }],
});
assert.ok(Math.abs(stepped.sourceDuration - 2.15) < 1e-8,
    'step-eased speed curves hold each discrete rate instead of being integrated as ramps');
assert.deepEqual([...new Set(stepped.segments.map(segment => Number(segment.rate.toFixed(6))))], [0.1, 2.05],
    'step boundaries split preview retiming at the exact authored rate changes');
assert.equal(mapTimelineTimeToRate(stepped, 0.75), 0.1);
assert.equal(mapTimelineTimeToRate(stepped, 1.25), 2.05);
for (const easing of ['steps(4, start)', 'steps(4, end)', 'steps(4, jump-none)', 'steps(4, jump-both)']) {
    const preview = createTimelineRetimeMap({
        start: 0, duration: 2,
        effects: [{ kind: 'speed_change', params: { speed: 0.1 }, keyframes: { speed: [
            { time: 0, value: 0.1 }, { time: 2, value: 4, easing },
        ] } }],
    });
    const exported = buildSpeedRetimePlan(2, [
        { time: 0, value: 0.1 }, { time: 2, value: 4, easing },
    ]);
    assert.ok(exported, `${easing} is representable in export`);
    for (const time of [0.13, 0.38, 0.63, 0.88, 1.13, 1.38, 1.63, 1.88]) {
        const exportSegment = exported.intervals.find(segment => time >= segment.start && time < segment.end);
        assert.ok(Math.abs(mapTimelineTimeToRate(preview, time) - exportSegment.speed) < 1e-8,
            `${easing} preview and export agree at ${time}s`);
    }
    assert.ok(Math.abs(preview.sourceDuration - exported.sourceDuration) < 1e-8,
        `${easing} preview and export integrate the same source duration`);
}
assert.equal(buildSpeedRetimePlan(2, [
    { time: 0, value: 0.1 }, { time: 2, value: 4, easing: 'steps(1000, end)' },
]), null, 'unrepresentable dense step curves are refused instead of silently truncated');
const densePreview = createTimelineRetimeMap({
    start: 0, duration: 2,
    effects: [{ kind: 'speed_change', params: { speed: 0.1 }, keyframes: { speed: [
        { time: 0, value: 0.1 }, { time: 2, value: 4, easing: 'steps(1000000, end)' },
    ] } }],
});
assert.ok(densePreview.segments.length < 300, 'dense preview easing does not allocate one segment per step');
assert.ok(densePreview.precisionWarning, 'the retime map reports when dense step easing is sampled approximately');
assert.equal(serializeTimelineRetimeMap(densePreview).precisionWarning, densePreview.precisionWarning,
    'dense-step precision warnings survive serialization to the player');
assert.ok(Math.abs(densePreview.sourceDuration - 4.1) < 0.03,
    'bounded dense-step preview remains close to the analytically integrated source duration');
const playerSource = await readFile(new URL('../client/src/components/Player/VideoPlayer.jsx', import.meta.url), 'utf8');
assert.match(playerSource, /retimeMap\?\.precisionWarning[\s\S]*retime_precision_approximation/,
    'the player surfaces dense-step preview approximations through its accessible warning banner');
for (let t = 2; t <= 5; t += 0.1) {
    const recovered = mapSourceTimeToTimeline(animated, mapTimelineTimeToSource(animated, t));
    assert.ok(Math.abs(recovered - t) < 0.002, `retime map round-trips at ${t.toFixed(1)}s`);
}

const workletSource = await readFile(new URL('../client/public/AudioProcessor.js', import.meta.url), 'utf8');
const sandbox = {
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage() {}, onmessage: null }; } },
    registerProcessor() {}, Float32Array, Math, sampleRate: 48000, console: { log() {} },
};
vm.runInNewContext(`${workletSource}\nglobalThis.RingBufferForTest = RingBuffer; globalThis.AudioProcessorForTest = AudioProcessor;`, sandbox);
const buffer = new sandbox.RingBufferForTest(16);
buffer.push(Float32Array.from([0, 1, 2, 3, 4, 5]));
const accelerated = new Float32Array(3);
buffer.mixInto(accelerated, 3, 1, 2);
assert.deepEqual(Array.from(accelerated), [0, 2, 4], 'audio worklet consumes source samples at the requested rate');
assert.equal(buffer.available, 0);
assert.equal(resampleMonoPcm(Float32Array.from([0, 1, 0]), 24000, 48000).length, 6,
    'decoded source audio is converted to the output AudioContext rate before speed adjustment');

function renderRetimedTone(maintainPitch, rate = 1.5, frequency = 440) {
    const processor = new sandbox.AudioProcessorForTest();
    processor.handleMessage({ data: { type: 'INIT_TRACK', payload: { trackId: 'voice', bufferSize: 48000 } } });
    const track = processor.tracks.get('voice');
    const source = Float32Array.from({ length: 48000 }, (_, index) => Math.sin(2 * Math.PI * frequency * index / 48000));
    track.buffer.push(source);
    processor.handleMessage({ data: { type: 'SET_PLAYBACK_RATE', payload: { trackId: 'voice', rate, maintainPitch } } });
    const rendered = new Float32Array(9600);
    for (let offset = 0; offset < rendered.length; offset += 128) {
        const left = new Float32Array(128);
        processor.process([], [[left, new Float32Array(128)]], {});
        rendered.set(left, offset);
    }
    return rendered;
}

function estimateToneFrequency(samples, startSample = 1200) {
    let crossings = 0;
    for (let i = startSample + 1; i < samples.length; i++) {
        if (samples[i - 1] <= 0 && samples[i] > 0) crossings++;
    }
    return crossings * 48000 / (samples.length - startSample);
}

for (const rate of [0.5, 1.5, 2, 4]) {
    const preserved = estimateToneFrequency(renderRetimedTone(true, rate));
    assert.ok(Math.abs(preserved - 440) < 45,
        `pitch-preserving WSOLA stays near the input tone at ${rate}x (measured ${preserved.toFixed(1)} Hz)`);
}
const pitchShifted = estimateToneFrequency(renderRetimedTone(false, 1.5));
assert.ok(Math.abs(pitchShifted - 660) < 40,
    `explicit pitch-shift mode follows playback rate (measured ${pitchShifted.toFixed(1)} Hz)`);
const resetProcessor = new sandbox.AudioProcessorForTest();
resetProcessor.handleMessage({ data: { type: 'INIT_TRACK', payload: { trackId: 'voice', bufferSize: 1024 } } });
resetProcessor.tracks.get('voice').pitchStretch = { stale: true };
resetProcessor.handleMessage({ data: { type: 'CLEAR_BUFFERS' } });
assert.equal(resetProcessor.tracks.get('voice').pitchStretch, null,
    'seeking clears WSOLA overlap state so prior audio cannot leak into the new position');

console.log('Preview retiming passed: partial windows, source offsets, easing, inverse timestamp mapping, rate-boundary audio, pitch preservation at 0.5x–4x, and pitch-shift mode.');
