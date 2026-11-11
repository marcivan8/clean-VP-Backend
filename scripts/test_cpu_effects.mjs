import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { EffectNode } from '../client/src/effects/EffectNode.js';
import { CPUEffectEngine } from '../client/src/effects/engines/CPUEffects.js';
import { EffectPipeline } from '../client/src/effects/EffectPipeline.js';
import ffmpeg from 'ffmpeg-static';

const engine = new CPUEffectEngine();
const make = (type, params, extra = {}) => new EffectNode({
  type, engine: 'cpu', params: Object.fromEntries(Object.entries(params).map(([key, value]) => [key, { value }])), ...extra,
});

const slowWithPitch = engine.compileEffect(make('speed_change', { speed: 0.25, maintainPitch: true }));
assert.equal(slowWithPitch, 'setpts=4.0000*PTS,atempo=0.5,atempo=0.5000', 'registered speed control preserves pitch across the supported atempo range');
const slowChain = engine.compileChain([make('speed_change', { speed: 0.25, maintainPitch: true })]);
assert.equal(slowChain.videoFilter, 'setpts=4.0000*PTS', 'speed change applies PTS scaling to video');
assert.equal(slowChain.audioFilter, 'atempo=0.5,atempo=0.5000', 'speed change applies pitch-preserving tempo filters to audio');
const fastWithPitch = engine.compileEffect(make('speed_change', { speed: 4, maintainPitch: true }));
assert.equal(fastWithPitch, 'setpts=0.2500*PTS,atempo=2.0,atempo=2.0000', 'high speed chains atempo stages instead of exceeding FFmpeg limits');
assert.equal(engine.compileEffect(make('speed_change', { speed: 2, maintainPitch: false })),
  'setpts=0.5000*PTS,asetrate=44100*2.0000,aresample=44100', 'disabled pitch preservation uses the pitch-shift path');

const fade = engine.compileEffect(make('fade_in', { duration: 1, color: [1, 0.25, 0] }, { startTime: 2 }));
assert.equal(fade, 'fade=t=in:st=2.000:d=1.000:color=0xff4000', 'fade color and effect start time are honored instead of the legacy registry shortcut');
const denoise = engine.compileEffect(make('audio_denoise', { amount: 0.75 }));
assert.equal(denoise, 'afftdn=nf=-35.0', 'audio denoise strength maps into FFmpeg’s legal noise floor range');

const incompleteChain = engine.compileChain([
  make('unimplemented_cpu_effect', { amount: 0.5 }),
  make('lut_apply', { intensity: 0.8 }),
  make('speed_change', { speed: 1 }),
]);
assert.deepEqual(incompleteChain.warnings.map(warning => [warning.effectType, warning.reason]), [
  ['unimplemented_cpu_effect', 'effect_not_compiled'],
  ['lut_apply', 'missing_lut_file'],
], 'unrendered CPU effects are reported, while an authored identity speed change stays a quiet no-op');
assert.equal(incompleteChain.hasVideo, false, 'a chain with only skipped effects is not reported as rendered video');

const pipeline = new EffectPipeline();
pipeline.addEffect(make('unimplemented_cpu_effect', { amount: 0.5 }, { targetId: 'clip-1' }));
const finalPlan = await pipeline.processFinal('input.mp4', 'clip-1', 'output.mp4');
assert.equal(finalPlan.warnings[0]?.reason, 'effect_not_compiled', 'the final pipeline carries skipped-effect warnings to its caller');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibed-cpu-fx-'));
try {
  const speedRender = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=8:duration=0.5',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5', '-vf', slowChain.videoFilter, '-af', slowChain.audioFilter,
    '-shortest', '-f', 'null', '-',
  ], { encoding: 'utf8', timeout: 20000 });
  assert.equal(speedRender.status, 0, `FFmpeg renders video and pitch-preserving speed filters together: ${speedRender.stderr || speedRender.error?.message || ''}`);
  const lutPath = path.join(tempDir, 'identity.cube');
  fs.writeFileSync(lutPath, [
    'TITLE "Identity"', 'LUT_3D_SIZE 2',
    '0 0 0', '1 0 0', '0 1 0', '1 1 0', '0 0 1', '1 0 1', '0 1 1', '1 1 1', '',
  ].join('\n'));
  const lut = make('lut_apply', { lutFile: lutPath, intensity: 0.4 });
  const chain = engine.compileChain([make('fade_in', { duration: 0.5 }, { startTime: 0 }), lut]);
  assert.equal(chain.videoFilterComplex, true, 'partial LUT intensity selects a real FFmpeg filter graph');
  assert.match(chain.filterComplex, /split=2\[lutbase1\]\[lutinput1\]/, 'the source is preserved alongside the graded branch');
  assert.match(chain.filterComplex, /blend=all_opacity=0\.400/, 'partial LUT strength is blended at the requested opacity');
  const render = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=8:duration=0.5',
    '-filter_complex', chain.filterComplex, '-map', '[vout]', '-f', 'null', '-',
  ], { encoding: 'utf8', timeout: 20000 });
  assert.equal(render.status, 0, `FFmpeg renders the partial-intensity LUT graph: ${render.stderr || render.error?.message || ''}`);
  const args = engine.buildCommand('in.mp4', 'out.mp4', [lut]);
  assert.ok(args.includes('-filter_complex') && args.includes('-map') && args.includes('[vout]'), 'export command maps the filter-graph result instead of passing graph syntax to -vf');
  const multiInput = engine.buildFilterComplex([{}, { position: { x: 5, y: 7 } }], [lut]);
  assert.match(multiInput.filterComplex, /\[v0\]split=2/, 'the LUT graph attaches after the multi-input composite');
  const multiRender = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=8:duration=0.5',
    '-f', 'lavfi', '-i', 'color=blue:size=16x16:rate=8:duration=0.5',
    '-filter_complex', multiInput.filterComplex, '-map', multiInput.outputMap, '-f', 'null', '-',
  ], { encoding: 'utf8', timeout: 20000 });
  assert.equal(multiRender.status, 0, `FFmpeg renders a multi-input composite followed by a partial LUT: ${multiRender.stderr || multiRender.error?.message || ''}`);

  const plainComposite = engine.buildFilterComplex([{}, { position: { x: 5, y: 7 } }], []);
  assert.match(plainComposite.filterComplex, /\[v0\]null\[vout\]$/, 'multi-input video always creates the declared terminal output label');
  const plainRender = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=8:duration=0.5',
    '-f', 'lavfi', '-i', 'color=blue:size=16x16:rate=8:duration=0.5',
    '-filter_complex', plainComposite.filterComplex, '-map', plainComposite.outputMap, '-f', 'null', '-',
  ], { encoding: 'utf8', timeout: 20000 });
  assert.equal(plainRender.status, 0, `FFmpeg renders a multi-input composite without additional video effects: ${plainRender.stderr || plainRender.error?.message || ''}`);

  const audioEffect = make('audio_normalize', { targetLevel: -8 });
  const audioComposite = engine.buildFilterComplex([{}, { position: { x: 5, y: 7 } }], [audioEffect], { audioInputIndex: 2 });
  assert.equal(audioComposite.audioMap, '[aout]', 'multi-input composition exposes the processed base-audio stream');
  const audioRender = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=8:duration=0.5',
    '-f', 'lavfi', '-i', 'color=blue:size=16x16:rate=8:duration=0.5', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5',
    '-filter_complex', audioComposite.filterComplex, '-map', audioComposite.outputMap, '-map', audioComposite.audioMap, '-f', 'null', '-',
  ], { encoding: 'utf8', timeout: 20000 });
  assert.equal(audioRender.status, 0, `FFmpeg renders a multi-input composition with a processed base audio stream: ${audioRender.stderr || audioRender.error?.message || ''}`);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('CPU effects passed: pitch-preserving speed ranges, fade colors/timing, denoise strength, and a rendered partial-intensity LUT graph.');
