import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { isEffectActiveAt } from '../render-worker/revideo/src/motion/EffectWindows.js';
import { resolveRevideoEffectParameter } from '../render-worker/revideo/src/motion/EffectParameters.js';

const require = createRequire(import.meta.url);
const { isRevideoTrackSupported } = require('../jobs/exportProcessor.js');

const simpleText = { type: 'text', clips: [{ id: 'title', type: 'text', content: 'Hello', start: 0, duration: 2 }] };
assert.equal(isRevideoTrackSupported(simpleText), true, 'plain text tracks use the Revideo path');
assert.equal(isRevideoTrackSupported({ type: 'overlay', clips: [{ id: 'logo', type: 'image', url: 'https://assets.test/logo.png' }] }), true,
  'static image overlays use the Revideo path');
assert.equal(isRevideoTrackSupported({ type: 'overlay', clips: [{ id: 'video', type: 'video', url: 'https://assets.test/broll.mp4' }] }), false,
  'video overlays stay on the media compositor path');
assert.equal(isRevideoTrackSupported({ type: 'overlay', clips: [{ id: 'logo', type: 'image', url: '/logo.png', effects: [{ kind: 'glow' }] }] }), false,
  'image effect stacks stay on the compositor path until Revideo renders them');
assert.equal(isRevideoTrackSupported({ type: 'text', clips: [{ id: 'title', type: 'text', content: 'Hello', start: 0, duration: 2,
  effects: [{ kind: 'blur_gaussian', params: { radius: 4 } }] }] }), true,
  'the Revideo path accepts the blur effect it actually renders');
assert.equal(isRevideoTrackSupported({ type: 'text', clips: [{ id: 'title', type: 'text', content: 'Hello', start: 0, duration: 2,
  effects: [{ kind: 'hue', keyframes: { degrees: [{ time: 0, value: 0 }, { time: 2, value: 90 }] } }] }] }), true,
  'supported keyframed effects can use Revideo’s animated filter adapter');
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
assert.equal(isRevideoTrackSupported({ type: 'overlay', clips: [{ id: 'logo', type: 'image', url: '/logo.png', sceneMask: { kind: 'shape' } }] }), false,
  'masked overlays stay on the compositor path');
assert.equal(isRevideoTrackSupported({ type: 'overlay', clips: [{ id: 'logo', type: 'image', url: '/logo.png', keyframes: { scale: [{ time: 0, value: 1 }, { time: 1, value: 1.5 }] } }] }), false,
  'legacy clip keyframes stay on the compositor path until the worker adapter translates them');
assert.equal(isRevideoTrackSupported({ type: 'overlay', clips: [{ id: 'logo', type: 'image', url: '/logo.png', compositionStack: [{ id: 'group', transformExpressions: { x: 't' } }] }] }), false,
  'nested-composition transforms stay on the compositor path until the worker adapter preserves the stack');
assert.equal(isRevideoTrackSupported({ type: 'overlay', clips: [{ id: 'logo', type: 'image', url: '/logo.png', blendMode: 'screen' }] }), false,
  'non-default blend modes stay on the compositor path');
assert.equal(isRevideoTrackSupported({ type: 'overlay', clips: [{ id: 'logo', type: 'image', url: '/logo.png', animations: [{ keyframes: [{ time: 0, properties: { glow: 4 } }] }] }] }), false,
  'unrendered motion channels stay on the compositor path');
assert.equal(isRevideoTrackSupported({ type: 'overlay', clips: [{ id: 'logo', type: 'image', url: '/logo.png', expressions: { x: '50+sin(t)' } }] }), true,
  'supported procedural transform expressions survive worker export');

console.log('Revideo track capability checks passed: unsupported visual features retain the complete compositor path.');
