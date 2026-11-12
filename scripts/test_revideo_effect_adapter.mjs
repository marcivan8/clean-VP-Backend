import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const adapterPath = new URL('../render-worker/revideo/src/motion/EffectAdapter.js', import.meta.url);
let source = await readFile(adapterPath, 'utf8');
source = source
  .replace("import { blur, brightness, contrast, grayscale, hue, saturate, sepia } from '@revideo/2d';", '')
  .replace("import { isEffectActiveAt } from './EffectWindows.js';", '')
  .replace("import { resolveRevideoEffectParameter } from './EffectParameters.js';", '')
  .replace('export default { createRevideoEffectFilters, createRevideoEffectShadowProps };', '');

const windowsUrl = pathToFileURL(new URL('../render-worker/revideo/src/motion/EffectWindows.js', import.meta.url).pathname).href;
const parametersUrl = pathToFileURL(new URL('../render-worker/revideo/src/motion/EffectParameters.js', import.meta.url).pathname).href;
const prelude = `
const filter = name => value => ({ name, value });
const blur = filter('blur'), brightness = filter('brightness'), contrast = filter('contrast');
const grayscale = filter('grayscale'), hue = filter('hue'), saturate = filter('saturate'), sepia = filter('sepia');
const { isEffectActiveAt } = await import(${JSON.stringify(windowsUrl)});
const { resolveRevideoEffectParameter } = await import(${JSON.stringify(parametersUrl)});
`;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(prelude + source).toString('base64')}`;
const { createRevideoEffectFilters, createRevideoEffectShadowProps } = await import(moduleUrl);
const timelineSource = await readFile(new URL('../render-worker/revideo/src/scenes/timeline.tsx', import.meta.url), 'utf8');
assert.match(timelineSource, /createRevideoEffectShadowProps\(clip\.effects, clip\.start, clip\.duration/,
  'timeline scene builds effect shadow properties from the clip effect stack');
assert.equal((timelineSource.match(/\{\.\.\.effectShadow\}/g) || []).length, 2,
  'both text and image nodes receive the resolved shadow properties');

let time = 10.5;
const effects = [
  {
    kind: 'shadow', startTime: 11, endTime: 13,
    params: { color: { value: '#112233' }, blur: 4, opacity: 0.4, x: 1, y: -2 },
    keyframes: {
      blur: [{ time: 11, value: 4 }, { time: 13, value: 20 }],
      x: [{ time: 11, value: 0 }, { time: 13, value: 10 }],
    },
  },
  { type: 'drop-shadow', startTime: 11, endTime: 13, params: { color: '#445566', blur: 8, opacity: 0.25, x: -2, y: 3 } },
];
const shadow = createRevideoEffectShadowProps(effects, 10, 4, () => time);
assert.equal(shadow.shadowColor(), 'rgba(0, 0, 0, 0)', 'windowed shadow is transparent before its effect window');
assert.equal(shadow.shadowBlur(), 0, 'windowed shadow has no blur before its effect window');
assert.equal(shadow.shadowOffsetX(), 0, 'windowed shadow has no offset before its effect window');

time = 11.5;
assert.equal(shadow.shadowColor(), 'rgba(68, 85, 102, 0.25)', 'last active shadow color includes its authored opacity');
assert.equal(shadow.shadowBlur(), 8, 'stacked shadows retain the strongest blur');
assert.equal(shadow.shadowOffsetX(), 0.5, 'animated and static horizontal offsets compose');
assert.equal(shadow.shadowOffsetY(), 1, 'stacked vertical offsets compose');

time = 13;
assert.equal(shadow.shadowColor(), 'rgba(0, 0, 0, 0)', 'effect end is exclusive');
assert.equal(shadow.shadowBlur(), 0, 'stack clears after the effect window');

const opacityTrackShadow = createRevideoEffectShadowProps([{
  kind: 'shadow', params: { color: '#ff8000', opacity: 0.2 },
  keyframes: { opacity: [{ time: 0, value: 0.2 }, { time: 2, value: 0.8 }] },
}], 0, 2, () => 1);
assert.equal(opacityTrackShadow.shadowColor(), 'rgba(255, 128, 0, 0.5)',
  'shadow opacity keyframes are reflected in the Revideo color alpha');

const disabledEffects = [
  { kind: 'blur_gaussian', enabled: false, params: { radius: 20 } },
  { kind: 'shadow', enabled: false, params: { color: '#ff0000', blur: 30, x: 40, y: 50 } },
  { kind: 'brightness', enabled: true, params: { amount: 1.2 } },
];
assert.equal(createRevideoEffectFilters(disabledEffects, 0, 4, () => 1).length, 1,
  'disabled filters are retained in the project but omitted from rendered output');
const disabledShadow = createRevideoEffectShadowProps(disabledEffects, 0, 4, () => 1);
assert.deepEqual(disabledShadow, {}, 'disabled shadows do not add shadow properties to the export node');

console.log('Revideo effect adapter checks passed: disabled-effect gating, animated drop shadows, effect windows, and stacked shadow composition.');
