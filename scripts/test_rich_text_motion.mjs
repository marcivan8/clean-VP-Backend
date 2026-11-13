import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Canvas from '@napi-rs/canvas';
import { createNode, createScene, flattenScene, nodeFromClip, sceneFromPlacements, NODE_TYPES } from '../client/src/motion/SceneSchema.js';
import { drawRichTextFrame, layoutRichText, sampleTypographyMotion } from '../client/src/motion/RichTextEngine.js';
import { renderTemplateFrames, registerFonts } from '../server/compositor/TemplateRenderer.js';

// Ensure fonts are registered in @napi-rs/canvas for headless environments (e.g. CI Linux)
registerFonts(Canvas);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FONT_DIR = path.join(ROOT, 'client', 'public', 'fonts');
if (Canvas?.GlobalFonts?.registerFromPath && fs.existsSync(FONT_DIR)) {
    const FONT_MAP = {
        'Inter': 'Inter-Regular.ttf',
        'Anton': 'Anton-Regular.ttf',
        'Bebas Neue': 'BebasNeue-Regular.ttf',
        'Montserrat': 'Montserrat-Bold.ttf',
        'Oswald': 'Oswald-Regular.ttf',
        'Poppins': 'Poppins-Regular.ttf',
        'Roboto': 'Roboto-Regular.ttf',
        'JetBrains Mono': 'JetBrainsMono-Regular.ttf',
    };
    for (const [family, file] of Object.entries(FONT_MAP)) {
        const p = path.join(FONT_DIR, file);
        if (fs.existsSync(p)) {
            try { Canvas.GlobalFonts.registerFromPath(p, family); } catch { }
        }
    }
}

const graphic = {
    w: 800,
    h: 360,
    text: 'MAKE IT MOVE',
    style: { fontFamily: 'Inter', fontSize: 120, fontWeight: 800, color: '#FFFFFF', textAlign: 'center' },
    charAnim: { preset: 'pop', unit: 'char', stagger: 0.03, duration: 0.25, easing: 'easeOutBack' },
};

const scene = createScene({
    frame: { aspectRatio: '9:16', w: 1080, h: 1920 },
    duration: 2,
    nodes: [createNode(NODE_TYPES.TEXT, {
        id: 'kinetic-headline', name: 'Kinetic headline', content: graphic.text,
        start: 0, duration: 2, transform: { x: 50, y: 46 }, size: { w: graphic.w, h: graphic.h },
        style: graphic.style, charAnim: graphic.charAnim,
    })],
});
const [placement] = flattenScene(scene).placements;
assert.equal(placement.trackType, 'overlay');
assert.equal(placement.clip.template.kind, 'rich-text');
assert.equal(placement.clip.template.params.charAnim.preset, 'pop');

const captionScene = createScene({ frame: { aspectRatio: '16:9', w: 1920, h: 1080 }, duration: 4, nodes: [
    createNode(NODE_TYPES.COMPOSITION, { id: 'caption-precomp', start: 0, duration: 4,
        effects: [{ kind: 'blur', params: { radius: 2 } }], children: [
            createNode(NODE_TYPES.CAPTION, { id: 'timed-caption', content: 'MAKE THIS CLEAR', start: 1, duration: 2,
                size: { w: 800, h: 200 }, transform: { x: 50, y: 50 },
                style: { fontFamily: 'Inter', fontSize: 72, fontWeight: 700, color: '#FFFFFF', captionStyle: { wordHighlight: { mode: 'color', color: '#FFE500' } } },
                words: [{ text: 'MAKE', start: 1, end: 1.3 }, { text: 'THIS', start: 1.3, end: 1.6 }, { text: 'CLEAR', start: 1.6, end: 2 }],
            }),
        ],
    }),
] });
const [captionPlacement] = flattenScene(captionScene).placements;
assert.equal(captionPlacement.trackType, 'overlay', 'timed captions in isolated compositions join the compositor group');
assert.equal(captionPlacement.clip.template.kind, 'rich-text');
assert.equal(captionPlacement.clip.template.params.captionMode, true);
assert.equal(captionPlacement.clip.template.params.captionWords.length, 3, 'caption word timing survives the route change');
const captionFrame = time => {
    const canvas = Canvas.createCanvas(800, 200);
    drawRichTextFrame(canvas.getContext('2d'), captionPlacement.clip.template.params, time - captionPlacement.clip.start,
        { width: 800, height: 200, globalTime: time });
    return canvas.toBuffer('image/png');
};
assert.notDeepEqual(captionFrame(1.1), captionFrame(1.4), 'active timed-word highlighting changes the caption graphic frame');
const plainCaptionStyle = { ...captionPlacement.clip.template.params, captionStyle: { wordHighlight: { mode: 'none' } } };
const plainCaptionCanvas = Canvas.createCanvas(800, 200);
drawRichTextFrame(plainCaptionCanvas.getContext('2d'), plainCaptionStyle, 0.1, { width: 800, height: 200, globalTime: 1.1 });
const plainCaptionPixels = plainCaptionCanvas.toBuffer('image/png');
for (const mode of ['vox-marker', 'bounce-box', 'terminal-cursor', 'neon-glow']) {
    const modeCanvas = Canvas.createCanvas(800, 200);
    const params = { ...captionPlacement.clip.template.params, captionStyle: { wordHighlight: { mode, color: '#00E5FF', background: '#FFE500', glowColor: '#00E5FF', cursor: '█' } } };
    drawRichTextFrame(modeCanvas.getContext('2d'), params, 0.1, { width: 800, height: 200, globalTime: 1.1 });
    assert.notDeepEqual(modeCanvas.toBuffer('image/png'), plainCaptionPixels, `${mode} caption style must render a visible treatment`);
}
const boxedCaptionCanvas = Canvas.createCanvas(800, 200);
drawRichTextFrame(boxedCaptionCanvas.getContext('2d'), {
    ...plainCaptionStyle,
    style: { ...plainCaptionStyle.style, backgroundColor: '#F7F5F0', backgroundPadding: 0.16 },
}, 0.1, { width: 800, height: 200, globalTime: 1.1 });
assert.notDeepEqual(boxedCaptionCanvas.toBuffer('image/png'), plainCaptionPixels, 'editorial caption background panel survives composition isolation');

function draw(time) {
    const canvas = Canvas.createCanvas(graphic.w, graphic.h);
    const layout = drawRichTextFrame(canvas.getContext('2d'), graphic, time, { width: graphic.w, height: graphic.h });
    return { pixels: canvas.toBuffer('image/png'), glyphCount: layout.glyphs.length };
}
const entrance = draw(0.04);
const settled = draw(0.8);
assert.equal(entrance.glyphCount, graphic.text.length);
assert.notDeepEqual(entrance.pixels, settled.pixels, 'glyph animation should change the rendered frame over time');

const pathGraphic = {
    ...graphic,
    text: 'FOLLOW THE CURVE',
    charAnim: { preset: 'typewriter', unit: 'char', stagger: 0.12, duration: 0.01 },
    textPath: { data: 'M 40 250 C 180 30 620 30 760 250', align: 'center', side: 'left', offset: 0 },
};
const pathFrame = time => {
    const canvas = Canvas.createCanvas(pathGraphic.w, pathGraphic.h);
    drawRichTextFrame(canvas.getContext('2d'), pathGraphic, time, { width: pathGraphic.w, height: pathGraphic.h });
    return canvas.toBuffer('image/png');
};
assert.notDeepEqual(pathFrame(0.1), pathFrame(1), 'text-on-path preserves per-character animation');
const flatPathFrame = (() => {
    const canvas = Canvas.createCanvas(pathGraphic.w, pathGraphic.h);
    drawRichTextFrame(canvas.getContext('2d'), { ...pathGraphic, textPath: null, charAnim: null }, 1,
        { width: pathGraphic.w, height: pathGraphic.h });
    return canvas.toBuffer('image/png');
})();
assert.notDeepEqual(pathFrame(1), flatPathFrame, 'glyph baselines follow the authored cubic SVG path');

const pathScene = createScene({ frame: { aspectRatio: '16:9', w: 1920, h: 1080 }, duration: 2, nodes: [
    createNode(NODE_TYPES.TEXT, { id: 'path-title', content: pathGraphic.text, start: 0, duration: 2,
        size: { w: pathGraphic.w, h: pathGraphic.h }, transform: { x: 50, y: 50 }, style: pathGraphic.style,
        charAnim: pathGraphic.charAnim, textPath: pathGraphic.textPath }),
] });
const [pathPlacement] = flattenScene(pathScene).placements;
assert.equal(pathPlacement.clip.template.params.textPath.data, pathGraphic.textPath.data,
    'scene flattening forwards the text path into the shared graphics renderer');
const [roundTrippedPathNode] = sceneFromPlacements([pathPlacement], { aspectRatio: '16:9' }).nodes[0].children;
assert.equal(roundTrippedPathNode.textPath.data, pathGraphic.textPath.data,
    'text path survives lifting a rich-text graphic from the timeline');

const lifecycleLayout = layoutRichText('VIBED', { fontSize: 84, fontFamily: 'Inter', maxWidth: 600, maxHeight: 160 });
const lifecycle = { preset: 'fade', unit: 'char', duration: 0.1, exit: { preset: 'shrink', duration: 0.3 }, emphasis: [{ preset: 'pulse', start: 0.5, duration: 0.5 }] };
const beforeExit = sampleTypographyMotion(lifecycleLayout, lifecycle, 1, 2).get(0);
const duringExit = sampleTypographyMotion(lifecycleLayout, lifecycle, 1.85, 2).get(0);
const duringEmphasis = sampleTypographyMotion(lifecycleLayout, lifecycle, 0.625, 2).get(0);
assert.ok(duringExit.opacity < beforeExit.opacity, 'exit motion animates glyphs out before the clip ends');
assert.ok(duringEmphasis.scale > 1, 'emphasis beats layer a pulse on top of the settled entrance');

const authoredLayout = layoutRichText('MOVE', { fontSize: 84, fontFamily: 'Inter', maxWidth: 600, maxHeight: 160 });
const authoredMotion = {
    preset: 'fade', unit: 'char', stagger: 0.1, duration: 0.5, easing: 'linear',
    order: 'reverse', startDelay: 0.1,
    from: { opacity: 0, rotation: -90, translateY: 24, scale: 0.5 },
    to: { opacity: 1, rotation: 0, translateY: 0, scale: 1 },
};
const reverseFirst = sampleTypographyMotion(authoredLayout, authoredMotion, 0.1).get(3);
const reverseMid = sampleTypographyMotion(authoredLayout, authoredMotion, 0.35).get(3);
assert.equal(reverseFirst.rotation, -90, 'reverse range starts on the last glyph with authored rotation');
assert.equal(reverseFirst.opacity, 0, 'authored opacity overrides the named fade preset');
assert.ok(Math.abs(reverseMid.rotation + 45) < 1e-9, 'rotation endpoints interpolate over eased progress');
assert.ok(Math.abs(reverseMid.translateY - 12) < 1e-9, 'translation endpoints interpolate per glyph');
assert.ok(Math.abs(reverseMid.scale - 0.75) < 1e-9, 'scale endpoints interpolate per glyph');
const presetIndependent = sampleTypographyMotion(authoredLayout, {
    unit: 'word', duration: 1, easing: 'linear',
    from: { rotation: -20 }, to: { rotation: 20 },
}, 0.5).get(0);
assert.equal(presetIndependent.rotation, 0, 'authored transform endpoints work without a named entrance preset');
const customOnlyScene = createScene({ frame: { aspectRatio: '16:9', w: 1920, h: 1080 }, duration: 2, nodes: [
    createNode(NODE_TYPES.TEXT, { id: 'custom-only-title', content: 'MOVE', start: 0, duration: 2,
        size: { w: 600, h: 160 }, transform: { x: 50, y: 50 }, style: { fontSize: 84 },
        charAnim: { unit: 'char', duration: 1, from: { rotation: -20 }, to: { rotation: 20 } } }),
] });
assert.equal(flattenScene(customOnlyScene).placements[0].clip.template.kind, 'rich-text',
    'custom-only text animators route through the shared renderer without a named preset');
const customOnlyGraphic = {
    text: 'MOVE', w: 600, h: 160, duration: 1,
    style: { fontSize: 84, fontFamily: 'Inter', color: '#FFFFFF' },
    charAnim: { unit: 'char', duration: 1, easing: 'linear', from: { rotation: -20 }, to: { rotation: 20 } },
};
const customOnlyFrame = time => {
    const canvas = Canvas.createCanvas(customOnlyGraphic.w, customOnlyGraphic.h);
    drawRichTextFrame(canvas.getContext('2d'), customOnlyGraphic, time, { width: customOnlyGraphic.w, height: customOnlyGraphic.h });
    return canvas.toBuffer('image/png');
};
assert.notDeepEqual(customOnlyFrame(0), customOnlyFrame(1),
    'custom-only rich-text endpoints animate in the shared preview renderer without a named preset');
const selectedRange = sampleTypographyMotion(authoredLayout, {
    preset: 'fade', unit: 'char', stagger: 0, duration: 1, easing: 'linear',
    from: { translateY: 0 }, to: { translateY: 20 },
    rangeSelector: { start: 0, end: 50, shape: 'square' },
}, 1);
assert.equal(selectedRange.get(0).translateY, 20, 'square text range selects glyphs inside the authored interval');
assert.equal(selectedRange.get(3).translateY, 0, 'square text range leaves glyphs outside the interval untouched');
const triangleRange = sampleTypographyMotion(authoredLayout, {
    preset: 'fade', unit: 'char', stagger: 0, duration: 1, easing: 'linear',
    from: { translateY: 0 }, to: { translateY: 20 },
    rangeSelector: { start: 0, end: 100, shape: 'triangle' },
}, 1);
assert.ok(Math.abs(triangleRange.get(0).translateY - 5) < 1e-9, 'triangle range gives a soft partial weight at the selection edge');
assert.ok(Math.abs(triangleRange.get(1).translateY - 15) < 1e-9, 'triangle range peaks toward the selection center');
const advancedTextScene = createScene({ frame: { aspectRatio: '16:9', w: 1920, h: 1080 }, duration: 2, nodes: [
    createNode(NODE_TYPES.TEXT, { id: 'range-title', content: 'MOVE', start: 0, duration: 2,
        size: { w: 600, h: 160 }, transform: { x: 50, y: 50 }, style: { fontSize: 84 }, charAnim: authoredMotion }),
] });
const [advancedTextPlacement] = flattenScene(advancedTextScene).placements;
assert.deepEqual(advancedTextPlacement.clip.template.params.charAnim, authoredMotion,
    'authored unit transforms and order survive scene flattening into the compositor');
const [roundTrippedText] = sceneFromPlacements([advancedTextPlacement], { aspectRatio: '16:9' }).nodes[0].children;
assert.deepEqual(roundTrippedText.charAnim, authoredMotion, 'authored unit transforms survive timeline lift and scene relifting');
const overshootingAlpha = sampleTypographyMotion(authoredLayout, {
    preset: 'fade', unit: 'word', duration: 1, easing: 'easeOutBack',
    from: { opacity: 0 }, to: { opacity: 1 },
}, 0.7).get(0).opacity;
assert.ok(overshootingAlpha >= 0 && overshootingAlpha <= 1,
    'overshooting easing cannot feed invalid alpha to the canvas renderer');
const authoredGraphic = { ...graphic, text: 'MOVE', charAnim: authoredMotion };
const authoredFrame = time => {
    const canvas = Canvas.createCanvas(authoredGraphic.w, authoredGraphic.h);
    drawRichTextFrame(canvas.getContext('2d'), authoredGraphic, time, { width: authoredGraphic.w, height: authoredGraphic.h });
    return canvas.toBuffer('image/png');
};
assert.notDeepEqual(authoredFrame(0.1), authoredFrame(0.35), 'authored per-character rotation and transforms render in preview frames');
const authoredPathGraphic = { ...authoredGraphic, textPath: pathGraphic.textPath };
const authoredPathCanvas = Canvas.createCanvas(authoredGraphic.w, authoredGraphic.h);
const unrotatedPathCanvas = Canvas.createCanvas(authoredGraphic.w, authoredGraphic.h);
drawRichTextFrame(authoredPathCanvas.getContext('2d'), authoredPathGraphic, 0.35,
    { width: authoredGraphic.w, height: authoredGraphic.h });
drawRichTextFrame(unrotatedPathCanvas.getContext('2d'), { ...authoredPathGraphic,
    charAnim: { ...authoredMotion, from: { ...authoredMotion.from, rotation: 0 }, to: { ...authoredMotion.to, rotation: 0 } } },
    0.35, { width: authoredGraphic.w, height: authoredGraphic.h });
assert.notDeepEqual(authoredPathCanvas.toBuffer('image/png'), unrotatedPathCanvas.toBuffer('image/png'),
    'authored rotation composes with tangent rotation on text paths');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibed-rich-text-'));
try {
    const sequence = await renderTemplateFrames({ kind: 'rich-text', params: graphic }, {
        durationSec: 1,
        fps: 4,
        widthPx: graphic.w,
        tmpDir,
        name: 'headline',
        canvasModule: Canvas,
    });
    assert.equal(sequence.frames, 4);
    assert.equal(sequence.files.length, 4);
    assert.ok(sequence.files.every(file => fs.statSync(file).size > 100), 'export frames should contain rasterized text');

    const pathSequence = await renderTemplateFrames({ kind: 'rich-text', params: pathGraphic }, {
        durationSec: 1,
        fps: 4,
        widthPx: pathGraphic.w,
        tmpDir,
        name: 'text-on-path',
        canvasModule: Canvas,
    });
    assert.notDeepEqual(fs.readFileSync(pathSequence.files[0]), fs.readFileSync(pathSequence.files[3]),
        'exported frames preserve animated text along the SVG path');

    const authoredSequence = await renderTemplateFrames({ kind: 'rich-text', params: authoredGraphic }, {
        durationSec: 1,
        fps: 4,
        widthPx: authoredGraphic.w,
        tmpDir,
        name: 'authored-unit-transforms',
        canvasModule: Canvas,
    });
    assert.notDeepEqual(fs.readFileSync(authoredSequence.files[0]), fs.readFileSync(authoredSequence.files[1]),
        'export frames preserve authored per-character transform endpoints and rotation');

    const customOnlySequence = await renderTemplateFrames({ kind: 'rich-text', params: customOnlyGraphic }, {
        durationSec: 1,
        fps: 2,
        widthPx: customOnlyGraphic.w,
        tmpDir,
        name: 'custom-only-unit-transforms',
        canvasModule: Canvas,
    });
    assert.notDeepEqual(fs.readFileSync(customOnlySequence.files[0]), fs.readFileSync(customOnlySequence.files[1]),
        'custom-only text animators remain animated in export frames without a named preset');

    const captionParams = captionPlacement.clip.template.params;
    const captionSequence = await renderTemplateFrames({ kind: 'rich-text', params: captionParams }, {
        durationSec: 1,
        fps: 4,
        widthPx: 800,
        tmpDir,
        name: 'isolated-timed-caption',
        canvasModule: Canvas,
    });
    assert.notDeepEqual(fs.readFileSync(captionSequence.files[0]), fs.readFileSync(captionSequence.files[2]),
        'export samples absolute caption word times and changes the highlighted word in the rendered frames');
    const plainCaptionSequence = await renderTemplateFrames({ kind: 'rich-text', params: plainCaptionStyle }, {
        durationSec: 1,
        fps: 4,
        widthPx: 800,
        tmpDir,
        name: 'isolated-plain-caption',
        canvasModule: Canvas,
    });
    const neonCaptionSequence = await renderTemplateFrames({ kind: 'rich-text', params: {
        ...captionParams,
        captionStyle: { wordHighlight: { mode: 'neon-glow', color: '#00E5FF', glowColor: '#00E5FF' } },
    } }, {
        durationSec: 1,
        fps: 4,
        widthPx: 800,
        tmpDir,
        name: 'isolated-neon-caption',
        canvasModule: Canvas,
    });
    assert.notDeepEqual(fs.readFileSync(neonCaptionSequence.files[0]), fs.readFileSync(plainCaptionSequence.files[0]),
        'export renderer applies the shared caption highlight mode');
} finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log('Rich-text motion passed: authored characters compile to an overlay and animate through the shared preview/export renderer.');
