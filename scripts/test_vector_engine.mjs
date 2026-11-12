// scripts/test_vector_engine.mjs
// Test suite for VIBED Expressive Vector Graphics & Rich Typography Engine.
// Run: node scripts/test_vector_engine.mjs

import assert from 'assert/strict';
import Canvas from '@napi-rs/canvas';
import {
    tokenizePath,
    parseSvgPath,
    drawSvgPath,
    drawRoundRect,
    drawPolygon,
    drawStar,
    drawArrow,
    drawCapsule,
    resolveGradient,
    applyTrimPath,
    vectorMatteDataUrl,
    drawVectorGraphic,
} from '../client/src/motion/VectorGraphics.js';

for (const [kind, vector, expected] of [
    ['polygon', { kind: 'polygon', sides: 6 }, '<polygon'],
    ['star', { kind: 'star', points: 7 }, '<polygon'],
    ['arrow', { kind: 'arrow' }, '<path'],
    ['custom path', { kind: 'path', pathData: 'M0 0 L100 0 L50 100 Z' }, '<path'],
]) {
    const url = vectorMatteDataUrl({ ...vector, w: 100, h: 100 });
    assert.ok(url?.startsWith('data:image/svg+xml,'), `${kind} matte returns an SVG data URL`);
    assert.ok(decodeURIComponent(url.split(',')[1]).includes(expected), `${kind} matte contains the expected SVG geometry`);
}
assert.equal(vectorMatteDataUrl({ kind: 'path', pathData: 'M0 0"/><script>alert(1)</script>' }), null,
    'invalid custom path data cannot enter a generated SVG matte');
assert.equal(vectorMatteDataUrl({ kind: 'unsupported-shape' }), null, 'unknown vector mattes fail closed');
const stalePathCanvas = Canvas.createCanvas(24, 24);
const stalePathContext = stalePathCanvas.getContext('2d');
drawVectorGraphic(stalePathContext, { kind: 'rect', x: 2, y: 2, w: 20, h: 20 });
drawVectorGraphic(stalePathContext, { kind: 'path', pathData: 'M0 0 A10 10 0 2 0 20 20', fill: '#FFFFFF' });
assert.equal(stalePathContext.getImageData(12, 12, 1, 1).data[3], 0,
    'an invalid vector path cannot fill the prior Canvas current path');
assert.deepEqual(parseSvgPath('M0 0 Z 1 2'), [{ type: 'M', args: [0, 0] }, { type: 'Z', args: [] }],
    'stray numbers after close-path are ignored instead of reusing Z indefinitely');
assert.deepEqual(parseSvgPath('M0 0 C1 2 nope 4 5 6 L7 8'), [
    { type: 'M', args: [0, 0] }, { type: 'L', args: [7, 8] },
], 'malformed or non-finite command arguments are skipped without creating invalid geometry');

import {
    normalizeRuns,
    layoutRichText,
    sampleTypographyMotion,
    drawRichText,
} from '../client/src/motion/RichTextEngine.js';

import {
    createScene,
    createNode,
    createGroup,
    NODE_TYPES,
    flattenScene,
} from '../client/src/motion/SceneSchema.js';

import {
    validateScene,
    SEVERITY,
} from '../client/src/motion/SceneValidator.js';

console.log('\n── 1. SVG Path Parser & Parametric Vector Shapes ──');

// 1.1 SVG Path Tokenization & Parsing
const svgPath = 'M 10 20 L 30 40 C 50 60, 70 80, 90 100 Q 110 120, 130 140 Z';
const parsed = parseSvgPath(svgPath);
assert.equal(parsed.length, 5, 'SVG path should parse 5 commands');
assert.equal(parsed[0].type, 'M');
assert.deepEqual(parsed[0].args, [10, 20]);
assert.equal(parsed[1].type, 'L');
assert.deepEqual(parsed[1].args, [30, 40]);
assert.equal(parsed[2].type, 'C');
assert.deepEqual(parsed[2].args, [50, 60, 70, 80, 90, 100]);
assert.equal(parsed[3].type, 'Q');
assert.deepEqual(parsed[3].args, [110, 120, 130, 140]);
assert.equal(parsed[4].type, 'Z');
console.log('✓ SVG path tokenizes and parses M, L, C, Q, Z commands accurately');

// 1.2 Path execution on mock canvas context
const ops = [];
let activeDash = [7, 3];
let strokeDash = null;
const mockCtx = {
    beginPath: () => ops.push('beginPath'),
    moveTo: (x, y) => ops.push(`moveTo(${x},${y})`),
    lineTo: (x, y) => ops.push(`lineTo(${x},${y})`),
    bezierCurveTo: (c1x, c1y, c2x, c2y, x, y) => ops.push(`bezierCurveTo(${x},${y})`),
    quadraticCurveTo: (cx, cy, x, y) => ops.push(`quadraticCurveTo(${x},${y})`),
    arcTo: (x1, y1, x2, y2, r) => ops.push(`arcTo(${r})`),
    arc: (x, y, r, sa, ea) => ops.push(`arc(${r})`),
    ellipse: (x, y, rx, ry, rotation, start, end, anticlockwise) => ops.push(`ellipse(${rx},${ry},${anticlockwise})`),
    closePath: () => ops.push('closePath'),
    fill: () => ops.push('fill'),
    stroke: () => { strokeDash = [...activeDash]; ops.push('stroke'); },
    save: () => ops.push('save'),
    restore: () => ops.push('restore'),
    translate: (x, y) => ops.push(`translate(${x},${y})`),
    rotate: (r) => ops.push(`rotate(${r})`),
    scale: (sx, sy) => ops.push(`scale(${sx},${sy})`),
    setLineDash: (d) => { activeDash = [...d]; ops.push(`setLineDash([${d.join(',')}])`); },
    setTransform: () => {},
    clearRect: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    shadowColor: 'transparent',
    shadowBlur: 0,
};

drawSvgPath(mockCtx, svgPath);
assert.ok(ops.includes('moveTo(10,20)'));
assert.ok(ops.includes('lineTo(30,40)'));
assert.ok(ops.includes('bezierCurveTo(90,100)'));
assert.ok(ops.includes('quadraticCurveTo(130,140)'));
assert.ok(ops.includes('closePath'));
console.log('✓ drawSvgPath executes normalized canvas drawing calls');

const gradientStops = [];
const safeGradientCtx = {
    createLinearGradient: () => ({ addColorStop: (offset, color) => {
        if (color === 'not-a-colour') throw new Error('Invalid color');
        gradientStops.push([offset, color]);
    } }),
};
const safeGradient = resolveGradient(safeGradientCtx, { type: 'linear', stops: [
    { offset: 0.8, color: '#0000FF' }, { offset: -2, color: '#FFFFFF' },
    { offset: 0.2, color: '#00FF00' }, { offset: 0.5, color: 'not-a-colour' },
] });
assert.ok(safeGradient, 'valid gradient stops survive malformed neighbors');
assert.deepEqual(gradientStops.map(([offset]) => offset), [0, 0.2, 0.8], 'gradient stops are clamped and sorted before Canvas receives them');
assert.equal(resolveGradient({ createLinearGradient: () => { throw new Error('Invalid geometry'); } }, {
    type: 'linear', color: '#123456', x0: NaN,
}), '#123456', 'invalid gradient geometry degrades to its configured solid color');
console.log('✓ Gradient stops are normalized and invalid vector gradients fail soft');

ops.length = 0;
drawSvgPath(mockCtx, 'M 0 0 A 10 6 25 0 1 24 8');
assert.ok(ops.some(op => op.startsWith('ellipse(')), 'SVG elliptical arcs must render as curves, not diagonal chords');
console.log('✓ SVG endpoint arcs render as elliptical curves');

// 1.3 Parametric Shapes
ops.length = 0;
drawRoundRect(mockCtx, 10, 10, 100, 50, [8, 8, 4, 4]);
assert.ok(ops.includes('beginPath') && ops.includes('closePath'));
console.log('✓ drawRoundRect handles per-corner radii safely');

ops.length = 0;
drawPolygon(mockCtx, 50, 50, 40, 6); // Hexagon
assert.equal(ops.filter(o => o.startsWith('lineTo')).length, 5);
console.log('✓ drawPolygon computes regular polygon vertices');

ops.length = 0;
drawStar(mockCtx, 50, 50, 20, 40, 5); // 5-pointed star
assert.equal(ops.filter(o => o.startsWith('lineTo')).length, 9);
console.log('✓ drawStar computes star vertices');

// 1.4 Trim Path math
ops.length = 0;
applyTrimPath(mockCtx, 1000, 0.25, 0.75, 0); // 50% visible, shifted by 25%
assert.ok(ops.some(o => o.includes('setLineDash([500,500])')));
console.log('✓ applyTrimPath computes stroke reveal dash & offset');

// 1.5 High-level vector graphic dispatcher
ops.length = 0;
drawVectorGraphic(mockCtx, {
    kind: 'rect',
    x: 0, y: 0, w: 200, h: 100,
    radii: 12,
    fill: '#FFE500',
    stroke: '#000000',
    strokeWidth: 4,
    blendMode: 'multiply',
});
assert.ok(ops.includes('fill') && ops.includes('stroke'));
assert.deepEqual(strokeDash, [], 'ordinary vector strokes clear inherited dash state before drawing');
assert.equal(mockCtx.globalCompositeOperation, 'multiply');
console.log('✓ drawVectorGraphic coordinates transforms, blend modes, fill and stroke');

const additiveCanvas = Canvas.createCanvas(8, 8);
const additiveCtx = additiveCanvas.getContext('2d');
additiveCtx.fillStyle = '#808080';
additiveCtx.fillRect(0, 0, 8, 8);
drawVectorGraphic(additiveCtx, {
    kind: 'rect', x: 0, y: 0, w: 8, h: 8, fill: '#808080', opacity: 0.75, blendMode: 'addition',
});
const additivePixel = additiveCtx.getImageData(4, 4, 1, 1).data;
assert.ok(additivePixel[0] >= 210 && additivePixel[1] >= 210 && additivePixel[2] >= 210,
    `addition blend mode performs additive vector compositing in Canvas preview (pixel ${[...additivePixel].join(',')})`);
console.log('✓ vector addition blend mode maps to Canvas lighter compositing');

console.log('\n── 2. Advanced Typography & Multi-Run Rich Text ──');

// 2.1 Multi-run normalization
const rawRuns = [
    { text: 'BUILDING ', fontFamily: 'Inter', fontWeight: '400', fontSize: 40, color: '#FFFFFF' },
    { text: 'THE FUTURE', fontFamily: 'Anton', fontWeight: '700', fontSize: 64, color: '#FFE500', textTransform: 'uppercase' },
];
const norm = normalizeRuns(rawRuns);
assert.equal(norm.length, 2);
assert.equal(norm[0].fontFamily, 'Inter');
assert.equal(norm[1].fontFamily, 'Anton');
assert.equal(norm[1].text, 'THE FUTURE');
console.log('✓ normalizeRuns validates mixed-font, mixed-weight text runs');

// 2.2 Text Layout & Wrapping
const layout = layoutRichText(norm, {
    maxWidth: 500,
    lineHeightMultiplier: 1.3,
    align: 'center',
    valign: 'middle',
});
assert.ok(layout.lines.length >= 1, 'Layout should contain formatted lines');
assert.ok(layout.words.length >= 3, 'Words should be broken into distinct word objects');
assert.ok(layout.glyphs.length > 10, 'Glyphs should be measured individually');
assert.ok(layout.totalWidth > 0 && layout.totalHeight > 0);
console.log(`✓ layoutRichText formats ${layout.lines.length} lines, ${layout.words.length} words, ${layout.glyphs.length} glyphs`);

// 2.3 Responsive Shrink-to-Fit
const constrainedLayout = layoutRichText(norm, {
    maxWidth: 250,
    maxHeight: 80,
    shrinkToFit: true,
});
assert.ok(constrainedLayout.totalWidth <= 280, 'Shrink-to-fit scaled font down to fit box width');
console.log('✓ layoutRichText shrinkToFit scales typography within container bounds');

// 2.4 Word- & Character-Level Motion
const charMotion = sampleTypographyMotion(layout, {
    preset: 'slideUp',
    unit: 'char',
    stagger: 0.05,
    duration: 0.3,
}, 0.15); // At 150ms: early chars are animating in, later chars not yet
assert.ok(charMotion.size > 0, 'Character motion samples generated');
const firstChar = charMotion.get(0);
const lastChar = charMotion.get(layout.glyphs.length - 1);
assert.ok(firstChar.opacity > lastChar.opacity, 'Earlier character is further along in entrance motion');
console.log('✓ sampleTypographyMotion computes staggered character transforms');

// 2.5 Drawing rich text to canvas
const drawOps = [];
const textCtx = {
    save: () => drawOps.push('save'),
    restore: () => drawOps.push('restore'),
    translate: () => drawOps.push('translate'),
    scale: () => drawOps.push('scale'),
    fillText: (txt) => drawOps.push(`fillText(${txt})`),
    strokeText: (txt) => drawOps.push(`strokeText(${txt})`),
    globalAlpha: 1,
};
drawRichText(textCtx, layout, { motionMap: charMotion, unit: 'word' });
assert.ok(drawOps.some(o => o.includes('fillText(BUILDING)')));
assert.ok(drawOps.some(o => o.includes('fillText(FUTURE)')));
console.log('✓ drawRichText renders multi-run typography with motion transforms');

console.log('\n── 3. Scene Schema & Validation Integration ──');

// 3.1 Create Scene with Vector and Rich Text Nodes
const scene = createScene({
    name: 'Advanced Motion Scene',
    duration: 5,
    aspectRatio: '16:9',
});

const vectorNode = createNode(NODE_TYPES.SHAPE, {
    name: 'Badge Container',
    duration: 4.5,
    mask: { kind: 'shape', shape: 'ellipse', x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
    vector: {
        kind: 'capsule',
        w: 360,
        h: 90,
        fill: {
            type: 'linear',
            angle: 45,
            stops: [{ offset: 0, color: '#1E293B' }, { offset: 1, color: '#0F172A' }],
        },
        stroke: '#FFE500',
        strokeWidth: 3,
        blendMode: 'multiply',
    },
});

const textNode = createNode(NODE_TYPES.TEXT, {
    name: 'Headline',
    duration: 4.5,
    runs: [
        { text: 'NEW: ', fontFamily: 'Montserrat', fontWeight: '800', fontSize: 44, color: '#FFE500' },
        { text: 'Motion Engine', fontFamily: 'Inter', fontWeight: '600', fontSize: 44, color: '#FFFFFF' },
    ],
    charAnim: {
        preset: 'slideUp',
        stagger: 0.04,
    },
});

scene.nodes.push(vectorNode, textNode);

// 3.2 Validate Scene
const report = validateScene(scene);
const errors = report.issues.filter(i => i.severity === SEVERITY.ERROR);
assert.equal(errors.length, 0, 'Vector and multi-run nodes pass SceneValidator with 0 errors');
console.log('✓ Scene with vector shape and multi-run text validates cleanly');

// 3.3 Flatten Scene to Timeline Placements
const flattened = flattenScene(scene);
assert.equal(flattened.placements.length, 2);

const vectorPlacement = flattened.placements.find(p => p.clip.type === 'vector');
assert.ok(vectorPlacement, 'Vector shape flattened into overlay track clip with type="vector"');
assert.equal(vectorPlacement.clip.vector.kind, 'capsule');
assert.deepEqual(vectorPlacement.clip.sceneMask, vectorNode.mask, 'vector shape masks survive scene flattening for preview and export');
assert.equal(vectorPlacement.clip.blendMode, 'multiply', 'vector blend mode reaches the shared compositor layer');

const textPlacement = flattened.placements.find(p => p.clip.template?.kind === 'rich-text');
assert.ok(textPlacement, 'Animated multi-run text flattened into the shared rich-text renderer');
assert.equal(textPlacement.clip.template.params.runs.length, 2);
assert.equal(textPlacement.clip.template.params.charAnim.preset, 'slideUp');
console.log('✓ flattenScene preserves vector specs and rich text runs for renderers');

console.log('\n── 4. Server-Side Export Parity (TemplateRenderer) ──');
const { renderVectorFrames } = await import('../server/compositor/TemplateRenderer.js');
assert.equal(typeof renderVectorFrames, 'function', 'renderVectorFrames exported by TemplateRenderer.js');

// Test renderVectorFrames with mock canvasModule
let serverFramesRendered = 0;
const mockServerCanvas = {
    createCanvas: (w, h) => ({
        getContext: () => mockCtx,
        toBuffer: () => { serverFramesRendered++; return Buffer.from('mock-png'); },
    }),
};

import os from 'os';
import path from 'path';
import fs from 'fs';

const tmpDir = path.join(os.tmpdir(), `test-vec-${Date.now()}`);
fs.mkdirSync(tmpDir, { recursive: true });

try {
    const res = await renderVectorFrames(vectorPlacement.clip.vector, {
        durationSec: 0.5,
        fps: 10,
        widthPx: 360,
        tmpDir,
        canvasModule: mockServerCanvas,
    });
    assert.equal(res.frames, 5, 'Rendered 5 frames for 0.5s at 10fps');
    assert.equal(serverFramesRendered, 5);
    console.log('✓ renderVectorFrames renders vector specs via Skia/Canvas engine on the server');
} finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

console.log('\nALL VECTOR & TYPOGRAPHY CHECKS PASSED\n');
process.exit(0);
