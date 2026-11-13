import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const adapterPath = new URL('../client/src/revideo/EffectAdapter.js', import.meta.url);
let source = await readFile(adapterPath, 'utf8');
source = source
    .replace("import { blur, brightness, contrast, grayscale, hue, invert, saturate, sepia } from '@revideo/2d';", '')
    .replace("import { resolveEffectParameter } from '../motion/EffectTiming.js';", '')
    .replace("import { resolveTimelineEffectGraphPreview } from '../motion/TimelineVisualEffects.js';", '')
    .replace('export default { createRevideoEffectFilters, getUnsupportedRevideoEffectKinds, isRevideoEffectActive };', '');
const timingUrl = pathToFileURL(new URL('../client/src/motion/EffectTiming.js', import.meta.url).pathname).href;
const prelude = `
const filter = name => value => ({ name, value });
const blur = filter('blur'), brightness = filter('brightness'), contrast = filter('contrast');
const grayscale = filter('grayscale'), hue = filter('hue-rotate'), invert = filter('invert');
const saturate = filter('saturate'), sepia = filter('sepia');
const { resolveEffectParameter } = await import(${JSON.stringify(timingUrl)});
const resolveTimelineEffectGraphPreview = effectGraph => {
  if (!effectGraph) return {effects: [], warning: null};
  return effectGraph.__preview || {effects: [], warning: 'graph preview unavailable'};
};
`;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(prelude + source).toString('base64')}`;
const {
    createRevideoEffectFilters,
    getUnsupportedRevideoEffectKinds,
    isRevideoEffectActive,
    resolveRevideoPreviewEffects,
} = await import(moduleUrl);

let time = 10.5;
const filters = createRevideoEffectFilters([
    { kind: 'brightness', params: { amount: 1.2 } },
    { kind: 'invert', params: { amount: 0.65 } },
    { kind: 'blur_gaussian', startTime: 11, endTime: 13, params: { radius: 9 } },
], 10, 4, () => time);
assert.deepEqual(filters.map(filter => filter.name), ['brightness', 'invert', 'blur'],
    'Revideo maps the supported authored footage effects into native filters');
assert.equal(filters[0].value(), 1.2, 'Revideo retains a clip effect value');
assert.equal(filters[1].value(), 0.65, 'Revideo retains partial invert strength');
assert.equal(filters[2].value(), 0, 'effect windows neutralize filters before they start');
time = 11.5;
assert.equal(filters[2].value(), 9, 'effect windows activate native blur at the authored project time');

const animated = createRevideoEffectFilters([{
    kind: 'hue-rotate', params: { degrees: 0 }, keyframes: {
        degrees: [{ time: 10, value: 0 }, { time: 14, value: 120 }],
    },
}], 10, 4, () => 12);
assert.equal(animated[0].value(), 60, 'Revideo samples effect keyframes against project time');

const grade = createRevideoEffectFilters([{
    kind: 'color_grade', params: { brightness: 125, contrast: 90, saturation: 150, hueRotate: 18 },
}], 0, 4, () => 1);
assert.deepEqual(grade.map(filter => filter.name), ['brightness', 'contrast', 'saturate', 'hue-rotate'],
    'a color grade expands into Revideo’s native color operations');
assert.deepEqual(grade.map(filter => filter.value()), [1.25, 0.9, 1.5, 18],
    'color-grade percentages preserve their authored scale instead of clamping to 2');

assert.equal(isRevideoEffectActive({ outputWindows: [{ start: 0, end: 1 }] }, 10, 4, 10.5), true,
    'output windows are evaluated on the clip-local clock');
assert.equal(isRevideoEffectActive({ outputWindows: [{ start: 0, end: 1 }] }, 10, 4, 11), false,
    'output window end is exclusive');
assert.deepEqual(getUnsupportedRevideoEffectKinds([
    { kind: 'glow' }, { kind: 'glow' }, { kind: 'blur_gaussian' }, { kind: 'grain', enabled: false },
]), ['glow'], 'unsupported enabled effects remain detectable instead of being treated as previewed');

const linearGraph = resolveRevideoPreviewEffects({
    effects: [{ kind: 'contrast', params: { amount: 1.1 } }],
    effectGraph: { __preview: { effects: [{ kind: 'invert', params: { amount: 0.4 } }], warning: null } },
});
assert.deepEqual(linearGraph.effects.map(effect => effect.kind), ['invert', 'contrast'],
    'a preview-safe linear graph is applied before the clip’s direct effect stack');
assert.deepEqual(linearGraph.unsupportedKinds, [], 'native graph effects remain explicitly previewable');
const exportOnlyGraph = resolveRevideoPreviewEffects({
    effectGraph: { __preview: { effects: [], warning: 'This branched graph is export-only.' } },
});
assert.equal(exportOnlyGraph.warning, 'This branched graph is export-only.',
    'a graph the preview cannot reproduce keeps its explicit export-only warning');

const projectSource = await readFile(new URL('../client/src/revideo/project.tsx', import.meta.url), 'utf8');
assert.match(projectSource, /createRevideoEffectFilters.*resolveRevideoPreviewEffects.*from '\.\/EffectAdapter\.js'/,
    'the mounted Revideo project imports the footage effect adapter');
assert.equal((projectSource.match(/\.\.\.effectFilters/g) || []).length, 2,
    'the mounted Revideo project applies the effect stack to both video and image layers');
assert.equal((projectSource.match(/resolveRevideoPreviewEffects\(clip\)/g) || []).length, 2,
    'the mounted Revideo project applies preview-safe linear effect graphs to both footage types');
assert.match(projectSource, /const imageScaleX = \(\) => \{[\s\S]*?motion\.scale \* motion\.scaleX[\s\S]*?const imageScaleY = \(\) => \{[\s\S]*?motion\.scale \* motion\.scaleY/,
    'image layers preserve independent horizontal and vertical scale from the motion resolver');
assert.match(projectSource, /return centreX - fitted\.w \* imageScaleX\(\) \/ 2;[\s\S]*?return centreY - fitted\.h \* imageScaleY\(\) \/ 2;/,
    'image overlay anchoring uses the independently-scaled rendered bounds');
assert.match(projectSource, /scaleX=\{imageScaleX\}[\s\S]*?scaleY=\{imageScaleY\}/,
    'the mounted image node uses the axis-aware image scale signals');
assert.match(projectSource, /motionLayer \? 1 : \(clip\.scaleX \?\? clip\.scale \?\? 1\)/,
    'base video clips retain an authored horizontal axis scale even without an animation');
assert.match(projectSource, /motionLayer \? 1 : \(clip\.scaleY \?\? clip\.scale \?\? 1\)/,
    'base video clips retain an authored vertical axis scale even without an animation');

const layoutSource = await readFile(new URL('../client/src/layouts/IDELayout.jsx', import.meta.url), 'utf8');
assert.match(layoutSource, /resolveRevideoPreviewEffects.*from '\.\.\/revideo\/EffectAdapter\.js'/,
    'the mounted editor imports the preview compatibility status helper');
assert.match(layoutSource, /resolveTimelineEffectGraphPreview.*from '\.\.\/motion\/TimelineVisualEffects\.js'/,
    'the mounted editor also checks graph compatibility for rasterized graphic layers');
assert.match(layoutSource, /const RevideoPreviewEffectNotice[\s\S]*?getUnsupportedRevideoEffectKinds/,
    'the editor derives a visible status for unsupported active effects');
assert.match(layoutSource, /if \(clip\?\.effectGraph\)[\s\S]*?graphPreview\.warning/,
    'a graphic effect graph that cannot be faithfully previewed produces the same explicit preview notice');
assert.match(layoutSource, /<RevideoPreviewEffectNotice tracks=\{tracks\} \/>/,
    'the warning is mounted over the real Revideo preview surface');

console.log('Revideo preview effect adapter passed: native clip effects, timing, keyframes, grades, and mounted scene wiring.');
