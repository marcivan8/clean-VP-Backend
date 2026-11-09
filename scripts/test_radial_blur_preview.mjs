import assert from 'node:assert/strict';
import Canvas from '@napi-rs/canvas';
import { drawRadialBlur, previewCanvasSize } from '../client/src/motion/RadialBlurPreview.js';

const source = Canvas.createCanvas(100, 100);
const sourceContext = source.getContext('2d');
sourceContext.fillStyle = '#000000';
sourceContext.fillRect(0, 0, 100, 100);
sourceContext.fillStyle = '#ffffff';
sourceContext.fillRect(72, 48, 4, 4);

const plain = Canvas.createCanvas(100, 100);
plain.getContext('2d').drawImage(source, 0, 0);
const blurred = Canvas.createCanvas(100, 100);
drawRadialBlur(blurred.getContext('2d'), source, 100, 100, {
  intensity: 1, centerX: 0.5, centerY: 0.5, samples: 10,
});
const plainPixels = plain.getContext('2d').getImageData(0, 0, 100, 100).data;
const blurredPixels = blurred.getContext('2d').getImageData(0, 0, 100, 100).data;
const pixelIndex = (x, y) => (y * 100 + x) * 4;
const center = pixelIndex(50, 50);
const edge = pixelIndex(90, 50);
assert.deepEqual([...blurredPixels.slice(center, center + 4)], [...plainPixels.slice(center, center + 4)],
  'the chosen blur center stays anchored while surrounding pixels move toward it');
assert.ok(blurredPixels[edge] > plainPixels[edge],
  'zoom samples carry detail outward from a nearby highlight instead of applying a uniform Gaussian blur');
assert.deepEqual(previewCanvasSize(1920, 1080), { width: 512, height: 288 },
  'overlay preview work stays bounded on large source footage');
console.log('Radial overlay preview checks passed: center-directed sampling, fixed center, and bounded preview resolution.');
