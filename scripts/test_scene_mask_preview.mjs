import assert from 'node:assert/strict';
import { sceneMaskCss } from '../client/src/motion/SceneMask.js';

const shapes = ['ellipse', 'circle', 'rectangle', 'rounded-rectangle', 'capsule', 'callout', 'polygon', 'star', 'arrow'];
for (const shape of shapes) {
    const css = sceneMaskCss({ kind: 'shape', shape, x: 0.15, y: 0.1, w: 0.7, h: 0.8, feather: 0.04, sides: 6, points: 6 });
    assert.ok(css.maskImage?.includes('data:image/svg+xml,'), `${shape} feathered mask uses an SVG alpha source`);
    assert.equal(css.maskSize, '100% 100%', `${shape} mask keeps bounds in the source silhouette, not CSS rescaling`);
    const uri = css.maskImage.match(/url\("(data:image\/svg\+xml,[^"]+)"\)/)?.[1];
    assert.ok(uri, `${shape} source is embedded as a valid data URL`);
    const svg = decodeURIComponent(uri.split(',')[1]);
    assert.match(svg, /feGaussianBlur stdDeviation="40"/, `${shape} feather maps the authored fraction into the SVG source`);
    assert.match(svg, /matte-feather/, `${shape} blur filter is present`);
    assert.match(svg, /<filter /, `${shape} declares its blur filter`);
    assert.match(svg, /<(ellipse|rect|polygon|path)\b/, `${shape} has actual silhouette geometry`);
    if (shape === 'capsule') assert.match(svg, /<rect x="150" y="100" width="700" height="800" rx="350"/, 'capsule mask uses a full half-height corner radius');
}

const calloutUri = sceneMaskCss({ kind: 'shape', shape: 'callout', x: 0.15, y: 0.1, w: 0.7, h: 0.8, tailSize: 0.2, radius: 0.12 })
    .maskImage.match(/url\("(data:image\/svg\+xml,[^"]+)"\)/)[1];
const calloutSvg = decodeURIComponent(calloutUri.slice('data:image/svg+xml,'.length));
assert.match(calloutSvg, /Q 850 100 850 176\.8/, 'callout corner radius uses the same relative radius as export');
assert.match(calloutSvg, /H 434 L 346 900 L 258 740/, 'callout tail dimensions use the mask bounds, matching export');

const arrowUri = sceneMaskCss({ kind: 'shape', shape: 'arrow', x: 0.15, y: 0.1, w: 0.7, h: 0.8, feather: 0.01 })
    .maskImage.match(/url\("(data:image\/svg\+xml,[^"]+)"\)/)[1];
const arrowSvg = decodeURIComponent(arrowUri.slice('data:image/svg+xml,'.length));
assert.match(arrowSvg, /M 150 372 H 556 V 372 L 850 500 L 556 628 V 628 H 150/, 'arrow head and shaft proportions match export geometry');

const starUri = sceneMaskCss({ kind: 'shape', shape: 'star', x: 0.1, y: 0.2, w: 0.8, h: 0.6, radius: 0.4 })
    .maskImage.match(/url\("(data:image\/svg\+xml,[^"]+)"\)/)[1];
const starSvg = decodeURIComponent(starUri.slice('data:image/svg+xml,'.length));
assert.match(starSvg, /<polygon points="500,260 570\.534\d*,402\.917\d*/, 'star inner radius defaults to half the authored outer radius, matching export');

const ellipseUri = sceneMaskCss({ kind: 'shape', shape: 'ellipse', x: 0.2, y: 0.1, w: 0.6, h: 0.8, feather: 0.02 })
    .maskImage.match(/url\("(data:image\/svg\+xml,[^"]+)"\)/)[1];
const ellipseSvg = decodeURIComponent(ellipseUri.slice('data:image/svg+xml,'.length));
assert.match(ellipseSvg, /<ellipse cx="500" cy="500" rx="300" ry="400"/, 'preview preserves a non-full-frame elliptical mask box');

const circleUri = sceneMaskCss({ kind: 'shape', shape: 'circle', x: 0.1, y: 0.1, w: 0.8, h: 0.6 })
    .maskImage.match(/url\("(data:image\/svg\+xml,[^"]+)"\)/)[1];
const circleSvg = decodeURIComponent(circleUri.slice('data:image/svg+xml,'.length));
assert.match(circleSvg, /<ellipse cx="500" cy="400" rx="300" ry="300"/, 'circle mask remains circular inside non-square bounds');

const inverse = sceneMaskCss({ kind: 'shape', shape: 'star', feather: 0.03, invert: true, points: 5 });
assert.equal(inverse.WebkitMaskComposite, 'xor', 'inverted vector masks exclude the shape from the full layer');
assert.equal(inverse.maskSize, '100% 100%, 100% 100%', 'inverted mask layers share the exact source bounds');

const hardEllipse = sceneMaskCss({ kind: 'shape', shape: 'ellipse', x: 0.2, y: 0.1, w: 0.6, h: 0.8 });
assert.match(hardEllipse.clipPath, /^ellipse\(/, 'hard-edge basic masks retain the lightweight CSS clip path');
assert.deepEqual(sceneMaskCss({ kind: 'shape', shape: 'unknown' }), {}, 'unsupported mask kinds fail closed');
console.log('Scene mask preview passed: all shape silhouettes, bounds, inversion, and feather settings are compiled into CSS masks.');
