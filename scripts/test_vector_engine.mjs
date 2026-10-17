// scripts/test_vector_engine.mjs
// Test suite for VIBED Expressive Vector Graphics & Rich Typography Engine.
// Run: node scripts/test_vector_engine.mjs

import assert from 'assert/strict';
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
    drawVectorGraphic,
} from '../client/src/motion/VectorGraphics.js';

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
const mockCtx = {
    beginPath: () => ops.push('beginPath'),
    moveTo: (x, y) => ops.push(`moveTo(${x},${y})`),
    lineTo: (x, y) => ops.push(`lineTo(${x},${y})`),
    bezierCurveTo: (c1x, c1y, c2x, c2y, x, y) => ops.push(`bezierCurveTo(${x},${y})`),
    quadraticCurveTo: (cx, cy, x, y) => ops.push(`quadraticCurveTo(${x},${y})`),
    arcTo: (x1, y1, x2, y2, r) => ops.push(`arcTo(${r})`),
    arc: (x, y, r, sa, ea) => ops.push(`arc(${r})`),
    closePath: () => ops.push('closePath'),
    fill: () => ops.push('fill'),
    stroke: () => ops.push('stroke'),
    save: () => ops.push('save'),
    restore: () => ops.push('restore'),
    translate: (x, y) => ops.push(`translate(${x},${y})`),
    rotate: (r) => ops.push(`rotate(${r})`),
    scale: (sx, sy) => ops.push(`scale(${sx},${sy})`),
    setLineDash: (d) => ops.push(`setLineDash([${d.join(',')}])`),
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
assert.equal(mockCtx.globalCompositeOperation, 'multiply');
console.log('✓ drawVectorGraphic coordinates transforms, blend modes, fill and stroke');

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
        blendMode: 'source-over',
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

const textPlacement = flattened.placements.find(p => p.trackType === 'text');
assert.ok(textPlacement, 'Text flattened into text track clip with runs preserved');
assert.equal(textPlacement.clip.runs.length, 2);
assert.equal(textPlacement.clip.charAnim.preset, 'slideUp');
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
