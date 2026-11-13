import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { isEffectActiveAt } from '../render-worker/revideo/src/motion/EffectWindows.js';
import { resolveRevideoEffectParameter } from '../render-worker/revideo/src/motion/EffectParameters.js';
import { clipToLayer } from '../render-worker/revideo/src/motion/RevideoLayerAdapter.js';
import { resolveMotionAt } from '../render-worker/revideo/src/motion/MotionResolver.js';
import { clipToMotionLayer } from '../client/src/motion/ClipAdapter.js';
import { resolveMotionAt as resolveClientMotionAt } from '../client/src/motion/MotionResolver.js';

const require = createRequire(import.meta.url);
const { isRevideoTrackSupported } = require('../jobs/exportProcessor.js');

const simpleText = { type: 'text', clips: [{ id: 'title', type: 'text', content: 'Hello', start: 0, duration: 2 }] };
assert.equal(isRevideoTrackSupported(simpleText), true, 'plain text tracks use the Revideo path');
assert.equal(isRevideoTrackSupported({ type: 'overlay', clips: [{ id: 'logo', type: 'image', url: 'https://assets.test/logo.png' }] }), true,
  'static image overlays use the Revideo path');
assert.equal(isRevideoTrackSupported({ type: 'overlay', clips: [{ id: 'video', type: 'video', url: 'https://assets.test/broll.mp4' }] }), false,
  'video overlays stay on the media compositor path');
const videoOverlay = { id: 'video-overlay', type: 'video', url: '/broll.mp4', start: 0, duration: 2 };
assert.equal(clipToLayer(videoOverlay, { type: 'overlay' }).kind,
  clipToMotionLayer(videoOverlay, { type: 'overlay' }).kind,
  'worker and client adapters classify video layers identically even when another renderer owns the video pixels');
const nullableTransform = { id: 'nullable', type: 'image', position: 'bottom', x: null, y: null,
  scale: null, scaleX: null, scaleY: null, rotation: null, opacity: null, duration: 2 };
const nullableClientLayer = clipToMotionLayer(nullableTransform, { type: 'overlay' });
const nullableWorkerLayer = clipToLayer(nullableTransform, { type: 'overlay' });
assert.deepEqual([nullableClientLayer.x, nullableClientLayer.y, nullableClientLayer.scale,
  nullableClientLayer.scaleX, nullableClientLayer.scaleY, nullableClientLayer.rotation, nullableClientLayer.opacity],
  [50, 85, 1, 1, 1, 0, 1], 'nullable transforms use position and neutral transform defaults in client preview');
assert.deepEqual([nullableWorkerLayer.x, nullableWorkerLayer.y, nullableWorkerLayer.scale,
  nullableWorkerLayer.scaleX, nullableWorkerLayer.scaleY, nullableWorkerLayer.rotation, nullableWorkerLayer.opacity],
  [nullableClientLayer.x, nullableClientLayer.y, nullableClientLayer.scale, nullableClientLayer.scaleX,
    nullableClientLayer.scaleY, nullableClientLayer.rotation, nullableClientLayer.opacity],
  'nullable transforms use the same position and neutral defaults in worker export');
assert.equal(isRevideoTrackSupported({ type: 'overlay', clips: [{ id: 'logo', type: 'image', url: '/logo.png', effects: [{ kind: 'glow' }] }] }), false,
  'image effect stacks stay on the compositor path until Revideo renders them');
assert.equal(isRevideoTrackSupported({ type: 'text', clips: [{ id: 'title', type: 'text', content: 'Hello', start: 0, duration: 2,
  effects: [{ kind: 'blur_gaussian', params: { radius: 4 } }] }] }), true,
  'the Revideo path accepts the blur effect it actually renders');
assert.equal(isRevideoTrackSupported({ type: 'text', clips: [{ id: 'title', type: 'text', content: 'Hello', start: 0, duration: 2,
  effects: [{ kind: 'invert', params: { amount: 0.65 } }] }] }), true,
  'the Revideo path accepts the partial invert filter it actually renders');
assert.equal(isRevideoTrackSupported({ type: 'text', clips: [{ id: 'title', type: 'text', content: 'Hello', start: 0, duration: 2,
  effects: [{ kind: 'hue', keyframes: { degrees: [{ time: 0, value: 0 }, { time: 2, value: 90 }] } }] }] }), true,
  'supported keyframed effects can use Revideo’s animated filter adapter');
assert.equal(isRevideoTrackSupported({ type: 'overlay', clips: [{ id: 'shadow-opacity', type: 'image', url: '/logo.png', start: 0, duration: 2,
  effects: [{ kind: 'shadow', params: { color: '#000000', opacity: 0.5 }, keyframes: {
    opacity: [{ time: 0, value: 0 }, { time: 2, value: 1 }],
  } }] }] }), true,
  'keyframed shadow opacity stays on Revideo because its shadow color alpha is animated');
assert.equal(isRevideoTrackSupported({ type: 'text', clips: [{ id: 'title', type: 'text', content: 'Hello', start: 0, duration: 2,
  effects: [{ kind: 'shadow', params: { color: '#000000', blur: 8, x: 1, y: 2 }, keyframes: {
    blur: [{ time: 0, value: 2 }, { time: 2, value: 12 }],
  } }] }] }), true,
  'drop shadows and supported animated shadow controls use the Revideo node-shadow path');
assert.equal(isRevideoTrackSupported({ type: 'text', clips: [{ id: 'title', type: 'text', content: 'Hello', start: 0, duration: 2,
  effects: [
    { kind: 'shadow', params: { color: '#000000', blur: 4, x: 1, y: 1 } },
    { kind: 'drop-shadow', params: { color: '#ff0000', blur: 12, x: 4, y: 8 } },
  ] }] }), false,
  'multiple shadows retain their independent color, blur and offset on the full compositor path instead of being collapsed into one Revideo shadow');
assert.equal(isRevideoTrackSupported({ type: 'text', clips: [{ id: 'title', type: 'text', content: 'Hello', start: 0, duration: 2,
  effects: [
    { kind: 'shadow', params: { color: '#000000', blur: 4 } },
    { kind: 'drop-shadow', enabled: false, params: { color: '#ff0000', blur: 12 } },
  ] }] }), true,
  'disabled extra shadows do not force a capable clip off the Revideo path');
assert.equal(isRevideoTrackSupported({ type: 'text', clips: [{ id: 'title', type: 'text', content: 'Hello', start: 0, duration: 2,
  effects: [{ kind: 'shadow', params: { color: '#000000' }, keyframes: {
    color: [{ time: 0, value: '#000000' }, { time: 2, value: '#ffffff' }],
  } }] }] }), false,
  'animated shadow colors stay on the compositor path until color interpolation is implemented');
assert.equal(isRevideoTrackSupported({ type: 'text', clips: [{ id: 'title', type: 'text', content: 'Hello', start: 4, duration: 4,
  effects: [{ kind: 'blur_gaussian', startTime: 4, endTime: 8, outputWindows: [{ start: 0, end: 1 }, { start: 3, end: 4 }] }] }] }), true,
  'supported effects with valid retimed output windows can use Revideo');
assert.equal(isRevideoTrackSupported({ type: 'text', clips: [{ id: 'title', type: 'text', content: 'Hello', start: 4, duration: 4,
  effects: [{ kind: 'blur_gaussian', outputWindows: [{ start: 3, end: 2 }] }] }] }), false,
  'malformed output windows stay on the complete compositor path');
const retimedEffect = { kind: 'blur_gaussian', outputWindows: [{ start: 0, end: 1 }, { start: 3, end: 4 }] };
assert.equal(isEffectActiveAt(retimedEffect, 4, 4, 4.5), true, 'output windows are evaluated against local clip time');
assert.equal(isEffectActiveAt(retimedEffect, 4, 4, 5.5), false, 'retimed gaps do not carry effects across removed source ranges');
assert.equal(resolveRevideoEffectParameter({ params: { amount: { value: 0.5, expression: 'value + 0.25*t' } } }, 'amount', 1, 10, 12, 4), 1,
  'effect expressions receive clip-local time and the current base or keyframed value');
assert.equal(resolveRevideoEffectParameter({ keyframes: { amount: [{ time: 10, value: 0 }, { time: 14, value: 1 }] } }, 'amount', 0.25, 10, 12, 4), 0.5,
  'Revideo effect keyframes are sampled on the clip-local clock');
assert.equal(isRevideoTrackSupported({ type: 'text', clips: [{ id: 'title', type: 'text', content: 'Hello', start: 0, duration: 2,
  effects: [{ kind: 'glow' }, { kind: 'blur', enabled: false }] }] }), false,
  'an unsupported enabled effect keeps the track on the complete compositor path');
assert.equal(isRevideoTrackSupported({ type: 'text', clips: [{ id: 'title', type: 'text', content: 'Hello', start: 0, duration: 2,
  effects: [{ kind: 'glow', enabled: false }] }] }), true,
  'disabled effects do not block a renderer that can handle the active stack');
assert.equal(isRevideoTrackSupported({ type: 'text', clips: [{ id: 'title', type: 'text', content: 'Hello', start: 0, duration: 2,
  effects: [{ kind: 'brightness', params: { amount: { value: 1, expression: '0.5 + 0.5*t' } } }] }] }), true,
  'supported effect expressions are handled by the Revideo effect adapter');
assert.equal(isRevideoTrackSupported({ type: 'text', clips: [{ id: 'title', type: 'text', content: 'Hello', start: 0, duration: 2,
  effects: [{ kind: 'brightness', keyframes: { unsupportedControl: [{ time: 0, value: 1 }] } }] }] }), false,
  'unsupported animated controls stay on the complete compositor path');
assert.equal(isRevideoTrackSupported({ type: 'text', clips: [{ id: 'title', type: 'text', content: 'Hello', start: 0, duration: 2,
  captionStyle: { wordHighlight: { mode: 'box' } } }] }), false,
  'box word highlights stay on the caption compositor path');
assert.equal(isRevideoTrackSupported({ type: 'text', clips: [{ id: 'title', type: 'text', content: 'Hello', start: 0, duration: 2,
  textShadow: '0 2px 8px rgba(0,0,0,.5)' }] }), false,
  'text shadows stay on the caption compositor path');
assert.equal(isRevideoTrackSupported({ type: 'text', clips: [{ id: 'title', type: 'text', content: 'Hello', start: 0, duration: 2,
  textAlign: 'left' }] }), false,
  'non-centred text alignment stays on the caption compositor path');
for (const [field, value] of [
  ['letterSpacing', 2], ['tracking', 0.05], ['lineHeight', 1.4], ['textTransform', 'uppercase'],
  ['strokeWidth', 2],
]) {
  assert.equal(isRevideoTrackSupported({ type: 'text', clips: [{ id: 'title', type: 'text', content: 'Hello', [field]: value }] }), false,
    `${field} typography stays on the complete compositor path`);
}
for (const [field, value] of [
  ['letterSpacing', 2], ['tracking', 0.05], ['lineHeight', 1.4], ['textTransform', 'uppercase'],
  ['strokeWidth', 2], ['backgroundColor', '#000000'],
]) {
  assert.equal(isRevideoTrackSupported({ type: 'text', clips: [{ id: 'title', type: 'text', content: 'Hello', captionStyle: { [field]: value } }] }), false,
    `captionStyle.${field} typography stays on the complete compositor path`);
}
assert.equal(isRevideoTrackSupported({ type: 'overlay', clips: [{ id: 'logo', type: 'image', url: '/logo.png', sceneMask: { kind: 'shape' } }] }), false,
  'masked overlays stay on the compositor path');
assert.equal(isRevideoTrackSupported({ type: 'text', clips: [{ id: 'title', type: 'text', content: 'Hello', keyframes: {
  x: [{ time: 0, value: 20 }, { time: 1, value: 60 }],
  scale: [{ time: 0, value: 1 }, { time: 1, value: 1.5 }],
  opacity: [{ time: 0, value: 0 }, { time: 1, value: 1 }],
} }] }), true,
  'Revideo text layers evaluate supported legacy clip transform keyframes');
const animatedOverlay = { type: 'overlay', clips: [{ id: 'logo', type: 'image', url: '/logo.png', start: 2, duration: 2, x: 20, y: 50, keyframes: {
  x: [{ time: 0, value: 20 }, { time: 2, value: 60 }],
  scale: [{ time: 0, value: 1 }, { time: 1, value: 1.5 }],
  opacity: [{ time: 0, value: 0 }, { time: 2, value: 1 }],
} }] };
assert.equal(isRevideoTrackSupported(animatedOverlay), true,
  'image overlays with supported legacy transform tracks use Revideo');
const animatedOverlayLayer = clipToLayer(animatedOverlay.clips[0], animatedOverlay);
const sampledOverlay = resolveMotionAt(animatedOverlayLayer, 2.5);
assert.deepEqual([sampledOverlay.x, sampledOverlay.scale, sampledOverlay.opacity], [30, 1.25, 0.25],
  'Revideo samples legacy overlay transform tracks on the clip-local clock');
const clientOverlayLayer = clipToMotionLayer(animatedOverlay.clips[0], animatedOverlay);
const clientSampledOverlay = resolveClientMotionAt(clientOverlayLayer, 2.5);
assert.deepEqual([clientSampledOverlay.x, clientSampledOverlay.scale, clientSampledOverlay.opacity],
  [sampledOverlay.x, sampledOverlay.scale, sampledOverlay.opacity],
  'browser overlay preview and Revideo worker resolve identical legacy keyframes');
const baseVideoLayer = clipToMotionLayer({ ...animatedOverlay.clips[0], type: 'video' }, { type: 'video' });
assert.equal(resolveClientMotionAt(baseVideoLayer, 2.5).scale, 1,
  'base-video camera keyframes remain owned by VideoPlayer and are not applied twice');
assert.equal(isRevideoTrackSupported({ type: 'overlay', clips: [{ id: 'logo', type: 'image', url: '/logo.png', keyframes: {
  unsupportedChannel: [{ time: 0, value: 1 }],
} }] }), false,
  'unknown legacy overlay channels stay on the compositor path');
assert.equal(isRevideoTrackSupported({ type: 'text', clips: [{ id: 'title', type: 'text', content: 'Hello', keyframes: {
  unknownChannel: [{ time: 0, value: 1 }],
} }] }), false,
  'unknown legacy text channels stay on the compositor path');
assert.equal(isRevideoTrackSupported({ type: 'text', clips: [{ id: 'title', type: 'text', content: 'Hello', keyframes: {
  scale: [{ time: 0, value: Number.NaN }],
} }] }), false,
  'malformed legacy text keyframes stay on the compositor path');
assert.equal(isRevideoTrackSupported({ type: 'overlay', clips: [{ id: 'logo', type: 'image', url: '/logo.png', compositionStack: [{ id: 'group', transformExpressions: { x: 't' } }] }] }), false,
  'nested-composition transforms stay on the compositor path until the worker adapter preserves the stack');
assert.equal(isRevideoTrackSupported({ type: 'overlay', clips: [{ id: 'logo', type: 'image', url: '/logo.png', blendMode: 'screen' }] }), false,
  'non-default blend modes stay on the compositor path');
assert.equal(isRevideoTrackSupported({ type: 'overlay', clips: [{ id: 'logo', type: 'image', url: '/logo.png', animations: [{ keyframes: [{ time: 0, properties: { glow: 4 } }] }] }] }), false,
  'unrendered motion channels stay on the compositor path');
assert.equal(isRevideoTrackSupported({ type: 'overlay', clips: [{ id: 'logo', type: 'image', url: '/logo.png', expressions: { x: '50+sin(t)' } }] }), true,
  'supported procedural transform expressions survive worker export');
const audioReactiveTrack = { type: 'text', clips: [{ id: 'title', type: 'text', content: 'Beat', start: 0, duration: 2,
  audioReactive: { assetId: 'music-1', parameter: 'scale' } }] };
assert.equal(isRevideoTrackSupported(audioReactiveTrack), false,
  'audio reactive layers without analyzed waveform data stay on a renderer that can resolve the missing signal');
assert.equal(isRevideoTrackSupported(audioReactiveTrack, { 'music-1': { peaks: [0.1, 0.5, 0.2], duration: 2 } }), true,
  'audio reactive layers use Revideo when the required waveform samples are available');
assert.equal(isRevideoTrackSupported(audioReactiveTrack, { 'music-1': [0.1, 0.5, 0.2] }), true,
  'audio reactive layers accept the supported raw peak-array waveform representation');
const reactiveGlowTrack = { type: 'text', clips: [{ id: 'title-glow', type: 'text', content: 'Beat glow', start: 0, duration: 2,
  audioReactive: { assetId: 'music-1', target: 'glow', amount: 8 } }] };
assert.equal(isRevideoTrackSupported(reactiveGlowTrack, { 'music-1': { peaks: [0.1, 0.5, 0.2], duration: 2 } }), false,
  'audio-reactive glow stays on the complete renderer because Revideo does not apply the resolved glow channel');
const reactiveBlurTrack = { type: 'overlay', clips: [{ id: 'logo-blur', type: 'image', url: '/logo.png', start: 0, duration: 2,
  audioReactive: { assetId: 'music-1', target: 'blur', amount: 8 } }] };
assert.equal(isRevideoTrackSupported(reactiveBlurTrack, { 'music-1': { peaks: [0.1, 0.5, 0.2], duration: 2 } }), false,
  'audio-reactive blur stays on the compositor path because Revideo does not apply the resolved blur channel');
assert.equal(isRevideoTrackSupported({ type: 'text', clips: [{ id: 'title-opacity', type: 'text', content: 'Beat', start: 0, duration: 2,
  audioReactive: { assetId: 'music-1', target: 'opacity', amount: -0.4 } }] }, { 'music-1': { peaks: [0.1, 0.5, 0.2], duration: 2 } }), true,
  'audio-reactive opacity remains eligible because Revideo consumes the resolved opacity channel');

console.log('Revideo track capability checks passed: unsupported visual features retain the complete compositor path.');
