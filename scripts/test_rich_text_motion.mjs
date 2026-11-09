import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Canvas from '@napi-rs/canvas';
import { createNode, createScene, flattenScene, NODE_TYPES } from '../client/src/motion/SceneSchema.js';
import { drawRichTextFrame, layoutRichText, sampleTypographyMotion } from '../client/src/motion/RichTextEngine.js';
import { renderTemplateFrames } from '../server/compositor/TemplateRenderer.js';

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

const lifecycleLayout = layoutRichText('VIBED', { fontSize: 84, fontFamily: 'Inter', maxWidth: 600, maxHeight: 160 });
const lifecycle = { preset: 'fade', unit: 'char', duration: 0.1, exit: { preset: 'shrink', duration: 0.3 }, emphasis: [{ preset: 'pulse', start: 0.5, duration: 0.5 }] };
const beforeExit = sampleTypographyMotion(lifecycleLayout, lifecycle, 1, 2).get(0);
const duringExit = sampleTypographyMotion(lifecycleLayout, lifecycle, 1.85, 2).get(0);
const duringEmphasis = sampleTypographyMotion(lifecycleLayout, lifecycle, 0.625, 2).get(0);
assert.ok(duringExit.opacity < beforeExit.opacity, 'exit motion animates glyphs out before the clip ends');
assert.ok(duringEmphasis.scale > 1, 'emphasis beats layer a pulse on top of the settled entrance');

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
