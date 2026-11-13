import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Canvas from '@napi-rs/canvas';
import { buildCompositionPlan } from '../client/src/motion/Compositor.js';

const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static');
const { compileCompositionPlan } = require('../server/compositor/CompositorCompiler.js');
const { compileRasterOverlays } = require('../server/compositor/RasterCaptionCompiler.js');
const exportProcessorSource = fs.readFileSync(new URL('../jobs/exportProcessor.js', import.meta.url), 'utf8');
const exportModalSource = fs.readFileSync(new URL('../client/src/components/ExportModal.jsx', import.meta.url), 'utf8');
const exportRequestSource = fs.readFileSync(new URL('../client/src/layouts/IDELayout.jsx', import.meta.url), 'utf8');
assert.match(exportProcessorSource, /'transparent-png-sequence',\s*'transparent-mov',\s*'transparent-webm'/,
  'the export processor accepts the transparent video formats');
assert.match(exportProcessorSource, /\['transparent-png-sequence',\s*'transparent-mov',\s*'transparent-webm'\]\.includes\(String\(settings\.format/,
  'transparent MOV and WebM exports render the same transparent overlay graph as PNG sequences');
assert.match(exportProcessorSource, /requestedFormat === 'transparent-mov'[\s\S]*?'-c:v',\s*'prores_ks'[\s\S]*?'-profile:v',\s*'4'[\s\S]*?'-pix_fmt',\s*'yuva444p10le'/,
  'transparent MOV delivery encodes ProRes 4444 with an alpha-capable pixel format');
assert.match(exportProcessorSource, /requestedFormat === 'transparent-webm'[\s\S]*?'-c:v',\s*'libvpx-vp9'[\s\S]*?'-pix_fmt',\s*'yuva420p'[\s\S]*?'-auto-alt-ref',\s*'0'/,
  'transparent WebM delivery encodes VP9 with an alpha-capable pixel format');
assert.match(exportProcessorSource, /\['webm',\s*'transparent-webm'\]\.includes\(requestedFormat\)\s*\?\s*'video\/webm'/,
  'transparent WebM uploads use the WebM media type');
assert.match(exportModalSource, /\['transparent-mov',\s*'Alpha MOV'\]/,
  'the export dialog exposes the transparent MOV format');
assert.match(exportModalSource, /\['transparent-webm',\s*'Alpha WebM'\]/,
  'the export dialog exposes the transparent WebM format');
assert.match(exportRequestSource, /format:\s*settings\.format\s*\|\|\s*'mp4'/,
  'the chosen export format reaches the render job without being normalized away by the editor');
const sceneEffects = [{ kind: 'brightness', params: { amount: 0.7 } }, { kind: 'grain', params: { amount: 5 } }, { kind: 'vignette', params: { intensity: 0.5 } }, { kind: 'glitch', params: { intensity: 0.3 } }, { kind: 'blur_motion', params: { intensity: { value: 0.5 }, samples: { value: 16 } } }, { kind: 'distortion', params: { amount: { value: 0.03 } } }, { type: 'glow', params: { radius: 8, intensity: 1, color: [0, 1, 0] } }];
const planned = buildCompositionPlan([
  { id: 'base', type: 'video', clips: [{ id: 'base-clip', start: 0, duration: 1, url: 'base.mp4' }] },
  { id: 'overlay', type: 'overlay', clips: [{ id: 'overlay-clip', type: 'image', start: 0, duration: 1, url: 'overlay.png', effects: sceneEffects }] },
], { width: 128, height: 128, fps: 1 });
assert.deepEqual(planned.overlays[0].effects, sceneEffects.map(effect => ({
  kind: effect.kind || effect.type,
  params: Object.fromEntries(Object.entries(effect.params).map(([key, value]) => [key, value && typeof value === 'object' && 'value' in value ? value.value : value])),
})), 'scene footage effects survive composition planning with parameter wrappers resolved');
const plannedGlow = planned.overlays[0].effects.at(-1);
plannedGlow.type = plannedGlow.kind;
delete plannedGlow.kind;
const disabledEffectPlan = buildCompositionPlan([
  { id: 'base', type: 'video', clips: [{ id: 'base-clip', start: 0, duration: 1, url: 'base.mp4' }] },
  { id: 'overlay', type: 'overlay', clips: [{ id: 'overlay-clip', type: 'image', start: 0, duration: 1, url: 'overlay.png', effects: [
    { kind: 'brightness', enabled: false, params: { amount: 0.2 } },
    { kind: 'contrast', enabled: true, params: { amount: 1.4 } },
  ] }] },
], { width: 128, height: 128, fps: 1 });
assert.equal(disabledEffectPlan.overlays[0].effects[0].enabled, false, 'disabled state survives composition planning');
const disabledCompiled = compileCompositionPlan(disabledEffectPlan, [{ overlayId: 'ov-overlay-clip', inputIndex: 1 }], { preserveAlpha: true });
assert.doesNotMatch(disabledCompiled.filterComplex, /eq=brightness=/, 'disabled effects are omitted from export');
assert.match(disabledCompiled.filterComplex, /eq=contrast=1\.4/, 'enabled effects still compile');
const sceneEffectCompiled = compileCompositionPlan(planned, [{ overlayId: 'ov-overlay-clip', inputIndex: 1 }], { preserveAlpha: true });
assert.match(sceneEffectCompiled.filterComplex, /geq=.*alpha\(X,Y\)/, 'enabled overlay vignette effects compile into the export graph');
assert.match(sceneEffectCompiled.filterComplex, /geq=.*floor\(T\*12\)/, 'enabled overlay glitch effects export as preview-matched timed displacement bands');
assert.match(sceneEffectCompiled.filterComplex, /gblur=sigma=.*:sigmaV=0/, 'overlay motion blur exports as a directional spatial blur');
assert.match(sceneEffectCompiled.filterComplex, /geq=.*sin\(Y\*0\.045\+\(?0\)?\).*\(0\.03\)\*W/, 'wrapped distortion values reach the preview-matched displacement filter');
assert.match(sceneEffectCompiled.filterComplex, /lutrgb=r='0\*val\+0':g='0\*val\+255':b='0\*val\+0'/, 'array-valued glow colors are preserved by overlay export');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vibed-alpha-graphics-'));
try {
  const source = path.join(tmp, 'overlay.png');
  const output = path.join(tmp, 'frame.png');
  const sourceCanvas = Canvas.createCanvas(32, 32);
  const sourceContext = sourceCanvas.getContext('2d');
  sourceContext.fillStyle = '#FF355E';
  sourceContext.fillRect(0, 0, 32, 32);
  fs.writeFileSync(source, sourceCanvas.toBuffer('image/png'));

  const plan = {
    version: 3,
    frame: { width: 128, height: 128 },
    renderWidth: 128,
    renderHeight: 128,
    fps: 1,
    base: { totalDuration: 1 },
    overlays: [{
      id: 'title', clipId: 'title', outputStart: 0, outputEnd: 1, zIndex: 0,
      source: { type: 'image', url: source },
      effects: [{ kind: 'brightness', params: { amount: 0.8 } }, { kind: 'saturation', params: { amount: 0.5 } }, { kind: 'vignette', params: { intensity: 0.8 } }],
      geometry: [{ t: 0, x: 0.25, y: 0.25, w: 0.5, h: 0.5, opacity: 1, rotation: 0 }],
    }],
  };
  const inputs = [{ overlayId: 'title', inputIndex: 1 }];
  const compiled = compileCompositionPlan(plan, inputs, { preserveAlpha: true });
  assert.match(compiled.filterComplex, /overlay=.*format=auto/);
  assert.match(compiled.filterComplex, /colorchannelmixer=rr=0\.8:gg=0\.8:bb=0\.8/);
  assert.match(compiled.filterComplex, /eq=saturation=0\.5/);
  const highBrightness = compileCompositionPlan({ ...plan, overlays: [{ ...plan.overlays[0], effects: [{ kind: 'brightness', params: { amount: 3 } }] }] }, inputs, { preserveAlpha: true });
  assert.match(highBrightness.filterComplex, /colorchannelmixer=rr=3:gg=3:bb=3/, 'overlay brightness retains the four-times range supported by its preview');

  const graph = path.join(tmp, 'graph.txt');
  fs.writeFileSync(graph, compiled.filterComplex);
  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=black@0:s=128x128:r=1:d=1,format=rgba',
    '-loop', '1', '-t', '1', '-i', source,
    '-filter_complex_script', graph,
    '-map', `[${compiled.outputLabel}]`, '-frames:v', '1',
    '-c:v', 'png', '-pix_fmt', 'rgba', '-y', output,
  ];
  const rendered = spawnSync(ffmpeg, args, { encoding: 'utf8' });
  assert.equal(rendered.status, 0, rendered.stderr);
  const renderedCanvas = await Canvas.loadImage(output);
  const check = Canvas.createCanvas(128, 128);
  const ctx = check.getContext('2d');
  ctx.drawImage(renderedCanvas, 0, 0);
  const pixel = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
  assert.equal(pixel(4, 4)[3], 0, 'empty frame area stays transparent');
  assert.equal(pixel(64, 64)[3], 255, 'the graphic remains fully opaque');
  assert.ok(pixel(64, 64)[0] < 240, 'overlay footage effects alter pixels in the exported composition');
  assert.ok(pixel(40, 64)[0] < pixel(64, 64)[0], 'overlay vignette darkens its edges more than its center');

  const captionGraph = compileRasterOverlays([], {
    frameWidth: 128, frameHeight: 128, fps: 1,
    drawtextGroups: [{ clipId: 'alpha-caption', filters: [
      `drawtext=fontfile=${path.join(new URL('../render-worker/revideo/src/fonts/Anton-Regular.ttf', import.meta.url).pathname)}:text=CAPTION:fontcolor=white:fontsize=12:x=4:y=4`,
    ] }],
    orderByClipId: new Map([['alpha-caption', 0]]),
    inputLabel: 'alpha_base',
  });
  const captionedAlpha = path.join(tmp, 'captioned-alpha.png');
  const captionedGraph = path.join(tmp, 'captioned-alpha.txt');
  fs.writeFileSync(captionedGraph, `[0:v]format=rgba[alpha_base];${captionGraph.filterComplex}`);
  const captionRender = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-loop', '1', '-t', '1', '-i', output,
    '-filter_complex_script', captionedGraph, '-map', `[${captionGraph.outputLabel}]`, '-frames:v', '1',
    '-c:v', 'png', '-pix_fmt', 'rgba', '-y', captionedAlpha,
  ], { encoding: 'utf8' });
  assert.equal(captionRender.status, 0, `FFmpeg composites captions over the alpha graphics sequence: ${captionRender.stderr}`);
  const captionImage = await Canvas.loadImage(captionedAlpha);
  const captionCanvas = Canvas.createCanvas(128, 128);
  const captionCtx = captionCanvas.getContext('2d');
  captionCtx.drawImage(captionImage, 0, 0);
  let captionRegionAlphaPixels = 0;
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    if (captionCtx.getImageData(x, y, 1, 1).data[3] > 0) captionRegionAlphaPixels++;
  }
  assert.ok(captionRegionAlphaPixels > 5, 'caption glyphs add visible alpha to the transparent graphics sequence');
  assert.equal(captionCtx.getImageData(120, 120, 1, 1).data[3], 0, 'combining captions preserves empty transparent pixels');

  const alphaSequenceDir = path.join(tmp, 'alpha-prores-frames');
  fs.mkdirSync(alphaSequenceDir, { recursive: true });
  fs.copyFileSync(captionedAlpha, path.join(alphaSequenceDir, 'frame-000001.png'));
  fs.copyFileSync(captionedAlpha, path.join(alphaSequenceDir, 'frame-000002.png'));
  const alphaMov = path.join(tmp, 'graphics-alpha.mov');
  const alphaEncode = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-framerate', '1', '-start_number', '1',
    '-i', path.join(alphaSequenceDir, 'frame-%06d.png'), '-frames:v', '2', '-an',
    '-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0',
    '-f', 'mov', '-y', alphaMov,
  ], { encoding: 'utf8' });
  assert.equal(alphaEncode.status, 0, `FFmpeg encodes transparent ProRes 4444: ${alphaEncode.stderr}`);
  const alphaProbe = spawnSync(ffmpeg, ['-hide_banner', '-i', alphaMov], { encoding: 'utf8' });
  assert.match(alphaProbe.stderr, /prores \(4444\)/, 'the alpha MOV uses the ProRes 4444 profile');
  assert.match(alphaProbe.stderr, /yuva444p\d+le/, 'the encoded video stream retains an alpha-capable pixel format');
  const alphaDecoded = path.join(tmp, 'alpha-prores-decoded.png');
  const alphaDecode = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-i', alphaMov, '-frames:v', '1', '-pix_fmt', 'rgba', '-y', alphaDecoded,
  ], { encoding: 'utf8' });
  assert.equal(alphaDecode.status, 0, `FFmpeg decodes transparent ProRes 4444: ${alphaDecode.stderr}`);
  const alphaDecodedImage = await Canvas.loadImage(alphaDecoded);
  const alphaDecodedCanvas = Canvas.createCanvas(128, 128);
  const alphaDecodedCtx = alphaDecodedCanvas.getContext('2d');
  alphaDecodedCtx.drawImage(alphaDecodedImage, 0, 0);
  assert.equal(alphaDecodedCtx.getImageData(120, 120, 1, 1).data[3], 0, 'empty transparent pixels survive the ProRes 4444 round trip');
  assert.ok(alphaDecodedCtx.getImageData(64, 64, 1, 1).data[3] >= 250, 'opaque graphic pixels survive the ProRes 4444 round trip');

  const alphaWebm = path.join(tmp, 'graphics-alpha.webm');
  const alphaWebmEncode = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-framerate', '1', '-start_number', '1',
    '-i', path.join(alphaSequenceDir, 'frame-%06d.png'), '-frames:v', '2', '-an',
    '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0',
    '-f', 'webm', '-y', alphaWebm,
  ], { encoding: 'utf8' });
  assert.equal(alphaWebmEncode.status, 0, `FFmpeg encodes transparent VP9 WebM: ${alphaWebmEncode.stderr}`);
  const alphaWebmProbe = spawnSync(ffmpeg, ['-hide_banner', '-i', alphaWebm], { encoding: 'utf8' });
  assert.match(alphaWebmProbe.stderr, /vp9/, 'the alpha WebM uses the VP9 codec');
  assert.match(alphaWebmProbe.stderr, /alpha_mode\s*:\s*1|yuva420p/, 'the WebM video stream retains an alpha channel');
  const alphaWebmDecoded = path.join(tmp, 'alpha-webm-decoded.png');
  const alphaWebmDecode = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-vcodec', 'libvpx-vp9', '-i', alphaWebm, '-frames:v', '1', '-pix_fmt', 'rgba', '-y', alphaWebmDecoded,
  ], { encoding: 'utf8' });
  assert.equal(alphaWebmDecode.status, 0, `FFmpeg decodes transparent VP9 WebM: ${alphaWebmDecode.stderr}`);
  const alphaWebmDecodedImage = await Canvas.loadImage(alphaWebmDecoded);
  const alphaWebmDecodedCanvas = Canvas.createCanvas(128, 128);
  const alphaWebmDecodedCtx = alphaWebmDecodedCanvas.getContext('2d');
  alphaWebmDecodedCtx.drawImage(alphaWebmDecodedImage, 0, 0);
  assert.equal(alphaWebmDecodedCtx.getImageData(120, 120, 1, 1).data[3], 0, 'empty transparent pixels survive the VP9 WebM round trip');
  assert.ok(alphaWebmDecodedCtx.getImageData(64, 64, 1, 1).data[3] >= 250, 'opaque graphic pixels survive the VP9 WebM round trip');

  const maskedPlan = {
    ...plan,
    overlays: [{ ...plan.overlays[0], sceneMask: { kind: 'shape', shape: 'ellipse', x: 0.1, y: 0.2, w: 0.3, h: 0.4 } }],
  };
  const maskedCompiled = compileCompositionPlan(maskedPlan, inputs, { preserveAlpha: true });
  assert.match(maskedCompiled.filterComplex, /W\*0\.25/, 'export ellipse uses the configured horizontal center');
  assert.match(maskedCompiled.filterComplex, /H\*0\.4/, 'export ellipse uses the configured vertical center');

  async function renderMask(mask, outputPath) {
    const maskPlan = { ...plan, overlays: [{ ...plan.overlays[0], sceneMask: mask }] };
    const maskCompiled = compileCompositionPlan(maskPlan, inputs, { preserveAlpha: true });
    const maskGraph = `${outputPath}.txt`;
    fs.writeFileSync(maskGraph, maskCompiled.filterComplex);
    const maskRender = spawnSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=black@0:s=128x128:r=1:d=1,format=rgba',
      '-loop', '1', '-t', '1', '-i', source,
      '-filter_complex_script', maskGraph,
      '-map', `[${maskCompiled.outputLabel}]`, '-frames:v', '1',
      '-c:v', 'png', '-pix_fmt', 'rgba', '-y', outputPath,
    ], { encoding: 'utf8' });
    assert.equal(maskRender.status, 0, `FFmpeg renders mask: ${maskRender.stderr}`);
    const renderedMask = await Canvas.loadImage(outputPath);
    const maskCanvas = Canvas.createCanvas(128, 128);
    const maskCtx = maskCanvas.getContext('2d');
    maskCtx.drawImage(renderedMask, 0, 0);
    return (x, y) => maskCtx.getImageData(x, y, 1, 1).data[3];
  }
  const ellipseAlpha = await renderMask(maskedPlan.overlays[0].sceneMask, path.join(tmp, 'ellipse-mask.png'));
  assert.equal(ellipseAlpha(48, 58), 255, 'rendered ellipse preserves the inside alpha');
  assert.equal(ellipseAlpha(80, 64), 0, 'rendered ellipse clears pixels outside its configured shape');
  const invertedEllipseAlpha = await renderMask({ ...maskedPlan.overlays[0].sceneMask, invert: true }, path.join(tmp, 'inverted-ellipse-mask.png'));
  assert.equal(invertedEllipseAlpha(48, 58), 0, 'inverted render mask clears the configured inside');
  assert.equal(invertedEllipseAlpha(80, 64), 255, 'inverted render mask preserves the outside area');

  const blendSource = path.join(tmp, 'blend-source.png');
  const blendCanvas = Canvas.createCanvas(32, 32);
  const blendCtx = blendCanvas.getContext('2d');
  blendCtx.fillStyle = '#FF0000';
  blendCtx.fillRect(0, 0, 8, 32);
  blendCtx.globalAlpha = 0.5;
  blendCtx.fillRect(8, 0, 8, 32);
  blendCtx.globalAlpha = 1;
  fs.writeFileSync(blendSource, blendCanvas.toBuffer('image/png'));
  async function renderBlend(mode) {
    const blendPlan = { ...plan, overlays: [{ ...plan.overlays[0], source: { type: 'image', url: blendSource }, effects: [], blendMode: mode }] };
    const blendCompiled = compileCompositionPlan(blendPlan, inputs);
    const blendGraph = path.join(tmp, `blend-${mode}.txt`);
    const blendOutput = path.join(tmp, `blend-${mode}.png`);
    fs.writeFileSync(blendGraph, blendCompiled.filterComplex);
    const blendRender = spawnSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=0x808080:s=128x128:r=1:d=1,format=rgba',
      '-loop', '1', '-t', '1', '-i', blendSource,
      '-filter_complex_script', blendGraph,
      '-map', `[${blendCompiled.outputLabel}]`, '-frames:v', '1',
      '-c:v', 'png', '-pix_fmt', 'rgba', '-y', blendOutput,
    ], { encoding: 'utf8' });
    assert.equal(blendRender.status, 0, `FFmpeg renders ${mode}: ${blendRender.stderr}`);
    const image = await Canvas.loadImage(blendOutput);
    const canvas = Canvas.createCanvas(128, 128);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    return (x, y) => [...context.getImageData(x, y, 1, 1).data];
  }
  const expectedBlendPixels = {
    multiply: [128, 0, 0], screen: [255, 128, 128], darken: [128, 0, 0],
    lighten: [255, 128, 128], difference: [127, 128, 128], addition: [255, 128, 128],
    overlay: [255, 0, 0], 'color-dodge': [255, 128, 128], 'color-burn': [128, 0, 0],
    'hard-light': [255, 0, 0], 'soft-light': [181, 64, 64], exclusion: [127, 128, 128],
  };
  for (const [mode, expected] of Object.entries(expectedBlendPixels)) {
    const blendPixel = await renderBlend(mode);
    const colored = blendPixel(40, 64);
    const unchanged = blendPixel(80, 64);
    assert.ok(expected.every((channel, index) => Math.abs(colored[index] - channel) <= 12), `${mode} produces its expected blend inside the opaque overlay; got ${colored.slice(0, 3).join(',')}`);
    assert.ok(unchanged.slice(0, 3).every(channel => Math.abs(channel - 128) <= 12), `${mode} leaves transparent overlay pixels unchanged`);
    assert.ok(blendPixel(10, 10).slice(0, 3).every(channel => Math.abs(channel - 128) <= 12), `${mode} leaves pixels outside the overlay unchanged`);
  }
  for (const mode of Object.keys(expectedBlendPixels)) {
    const alphaBlendPlan = { ...plan, overlays: [{ ...plan.overlays[0], source: { type: 'image', url: blendSource }, effects: [], blendMode: mode }] };
    const alphaBlendCompiled = compileCompositionPlan(alphaBlendPlan, inputs, { preserveAlpha: true });
    const alphaBlendGraph = path.join(tmp, `alpha-blend-${mode}.txt`);
    const alphaBlendOutput = path.join(tmp, `alpha-blend-${mode}.png`);
    fs.writeFileSync(alphaBlendGraph, alphaBlendCompiled.filterComplex);
    const alphaBlendRender = spawnSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=black@0:s=128x128:r=1:d=1,format=rgba',
      '-loop', '1', '-t', '1', '-i', blendSource,
      '-filter_complex_script', alphaBlendGraph,
      '-map', `[${alphaBlendCompiled.outputLabel}]`, '-frames:v', '1',
      '-c:v', 'png', '-pix_fmt', 'rgba', '-y', alphaBlendOutput,
    ], { encoding: 'utf8' });
    assert.equal(alphaBlendRender.status, 0, `FFmpeg preserves alpha for ${mode} blend exports: ${alphaBlendRender.stderr}`);
    const alphaBlendImage = await Canvas.loadImage(alphaBlendOutput);
    const alphaBlendCanvas = Canvas.createCanvas(128, 128);
    const alphaBlendCtx = alphaBlendCanvas.getContext('2d');
    alphaBlendCtx.drawImage(alphaBlendImage, 0, 0);
    const alphaBlendPixel = (x, y) => [...alphaBlendCtx.getImageData(x, y, 1, 1).data];
    assert.equal(alphaBlendPixel(40, 64)[3], 255, `${mode} keeps opaque source coverage`);
    assert.ok(Math.abs(alphaBlendPixel(56, 64)[3] - 128) <= 3, `${mode} keeps semi-transparent source coverage`);
    assert.equal(alphaBlendPixel(80, 64)[3], 0, `${mode} keeps transparent overlay areas transparent`);
    assert.equal(alphaBlendPixel(10, 10)[3], 0, `${mode} keeps outside areas transparent`);
    assert.ok(alphaBlendPixel(40, 64)[0] > 220, `${mode} retains source-only color over transparent pixels`);
  }
  const blueSource = path.join(tmp, 'blend-blue.png');
  const blueCanvas = Canvas.createCanvas(32, 32);
  const blueCtx = blueCanvas.getContext('2d');
  blueCtx.globalAlpha = 0.5;
  blueCtx.fillStyle = '#0000FF';
  blueCtx.fillRect(0, 0, 32, 32);
  fs.writeFileSync(blueSource, blueCanvas.toBuffer('image/png'));
  const layeredAlphaPlan = {
    ...plan,
    overlays: [
      { ...plan.overlays[0], id: 'red-base', clipId: 'red-base', source: { type: 'image', url: blendSource }, effects: [], geometry: [{ t: 0, x: 0.25, y: 0.25, w: 0.5, h: 0.5, opacity: 0.5, rotation: 0 }], zIndex: 0 },
      { ...plan.overlays[0], id: 'blue-blend', clipId: 'blue-blend', source: { type: 'image', url: blueSource }, effects: [], blendMode: 'multiply', geometry: [{ t: 0, x: 0.25, y: 0.25, w: 0.5, h: 0.5, opacity: 1, rotation: 0 }], zIndex: 1 },
    ],
  };
  const layeredAlphaCompiled = compileCompositionPlan(layeredAlphaPlan, [{ overlayId: 'red-base', inputIndex: 1 }, { overlayId: 'blue-blend', inputIndex: 2 }], { preserveAlpha: true });
  const layeredAlphaGraph = path.join(tmp, 'layered-alpha-blend.txt');
  const layeredAlphaOutput = path.join(tmp, 'layered-alpha-blend.png');
  fs.writeFileSync(layeredAlphaGraph, layeredAlphaCompiled.filterComplex);
  const layeredAlphaRender = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=black@0:s=128x128:r=1:d=1,format=rgba',
    '-loop', '1', '-t', '1', '-i', blendSource,
    '-loop', '1', '-t', '1', '-i', blueSource,
    '-filter_complex_script', layeredAlphaGraph,
    '-map', `[${layeredAlphaCompiled.outputLabel}]`, '-frames:v', '1',
    '-c:v', 'png', '-pix_fmt', 'rgba', '-y', layeredAlphaOutput,
  ], { encoding: 'utf8' });
  assert.equal(layeredAlphaRender.status, 0, `FFmpeg renders multiply between partially transparent layers: ${layeredAlphaRender.stderr}`);
  const layeredAlphaImage = await Canvas.loadImage(layeredAlphaOutput);
  const layeredCanvas = Canvas.createCanvas(128, 128);
  const layeredCtx = layeredCanvas.getContext('2d');
  layeredCtx.drawImage(layeredAlphaImage, 0, 0);
  const layeredPixel = [...layeredCtx.getImageData(40, 64, 1, 1).data];
  assert.ok(Math.abs(layeredPixel[3] - 191) <= 4, `two half-covered layers produce 75% coverage; got ${layeredPixel[3]}`);
  assert.ok(Math.abs(layeredPixel[0] - 85) <= 12 && Math.abs(layeredPixel[2] - 85) <= 12, `blend RGB is unpremultiplied correctly over partial destination alpha; got ${layeredPixel.slice(0, 3).join(',')}`);
  // A normal source-over layer after a blend layer must keep working in the
  // same graph, including its alpha, without the RGB blend conversion leaking.
  const topSource = path.join(tmp, 'chained-top.png');
  const topCanvas = Canvas.createCanvas(32, 32);
  const topCtx = topCanvas.getContext('2d');
  topCtx.fillStyle = '#00FF00';
  topCtx.fillRect(0, 0, 8, 8);
  fs.writeFileSync(topSource, topCanvas.toBuffer('image/png'));
  const chainedPlan = {
    ...plan,
    overlays: [
      { ...plan.overlays[0], id: 'blend', clipId: 'blend', source: { type: 'image', url: blendSource }, effects: [], blendMode: 'multiply', zIndex: 0 },
      { ...plan.overlays[0], id: 'normal', clipId: 'normal', source: { type: 'image', url: topSource }, effects: [], zIndex: 1, geometry: [{ t: 0, x: 0, y: 0, w: 0.25, h: 0.25, opacity: 1, rotation: 0 }] },
    ],
  };
  const chainedCompiled = compileCompositionPlan(chainedPlan, [
    { overlayId: 'blend', inputIndex: 1 }, { overlayId: 'normal', inputIndex: 2 },
  ]);
  const chainedGraph = path.join(tmp, 'chained-blend.txt');
  const chainedOutput = path.join(tmp, 'chained-blend.png');
  fs.writeFileSync(chainedGraph, chainedCompiled.filterComplex);
  const chainedRender = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=0x808080:s=128x128:r=1:d=1,format=rgba',
    '-loop', '1', '-t', '1', '-i', blendSource,
    '-loop', '1', '-t', '1', '-i', topSource,
    '-filter_complex_script', chainedGraph,
    '-map', `[${chainedCompiled.outputLabel}]`, '-frames:v', '1',
    '-c:v', 'png', '-pix_fmt', 'rgba', '-y', chainedOutput,
  ], { encoding: 'utf8' });
  assert.equal(chainedRender.status, 0, `FFmpeg renders a normal layer after a blend layer: ${chainedRender.stderr}`);
  const chainedImage = await Canvas.loadImage(chainedOutput);
  const chainedCanvas = Canvas.createCanvas(128, 128);
  const chainedCtx = chainedCanvas.getContext('2d');
  chainedCtx.drawImage(chainedImage, 0, 0);
  const chainedPixel = (x, y) => [...chainedCtx.getImageData(x, y, 1, 1).data];
  assert.ok(chainedPixel(4, 4)[1] > 180, `the later source-over layer remains visible after RGB blend compositing; got ${chainedPixel(4, 4).join(',')}`);
  assert.ok(chainedPixel(40, 64)[0] >= 115 && chainedPixel(40, 64)[0] <= 140, `the earlier multiply result remains intact after a later layer; got ${chainedPixel(40, 64).join(',')}`);
  assert.ok(chainedPixel(80, 64).slice(0, 3).every(channel => Math.abs(channel - 128) <= 12), 'transparent pixels in the later layer preserve the blended base');
  assert.throws(() => compileCompositionPlan({
    ...maskedPlan,
    overlays: [{ ...maskedPlan.overlays[0], sceneMask: { kind: 'shape', shape: 'ellipse', x: 0.2, y: 0.2, w: 0, h: 0.4 } }],
  }, inputs, { preserveAlpha: true }), /scene mask bounds/, 'degenerate masks are rejected instead of compiling division-by-zero expressions');

  assert.match(compileCompositionPlan({
    ...plan,
    overlays: [{ ...plan.overlays[0], blendMode: 'multiply' }],
  }, inputs, { preserveAlpha: true }).filterComplex, /hstack=inputs=2.*geq=.*crop=128:128/, 'transparent exports compile alpha-aware blend modes with the paired-layer equation');

  // Alpha-based media shadow/glow effects get their own padded transparent
  // source, so the blurred silhouette can extend beyond the source bounds.
  const iconPath = path.join(tmp, 'icon.png');
  const iconOutput = path.join(tmp, 'icon-glow.png');
  const icon = Canvas.createCanvas(32, 32);
  const iconCtx = icon.getContext('2d');
  iconCtx.fillStyle = '#ffffff';
  iconCtx.beginPath(); iconCtx.arc(16, 16, 8, 0, Math.PI * 2); iconCtx.fill();
  fs.writeFileSync(iconPath, icon.toBuffer('image/png'));
  const iconPlan = {
    ...plan,
    overlays: [{
      id: 'icon', clipId: 'icon', outputStart: 0, outputEnd: 1, zIndex: 0,
      source: { type: 'image', url: iconPath },
      effects: [
        { kind: 'gradient-fill', params: { colors: ['#FF0000', '#0000FF'], angle: 0, opacity: 1 } },
        { kind: 'stroke', params: { color: '#00FF00', width: 5, opacity: 1 } },
        { kind: 'shadow', params: { color: '#000000', x: 3, y: 4, blur: 24, opacity: 0.8 } },
        { kind: 'glow', params: { color: '#33aaff', blur: 60, opacity: 1 } },
      ],
      shadow: { dx: -2, dy: 2, blur: 8, opacity: 0.4 },
      geometry: [{ t: 0, x: 0.34375, y: 0.34375, w: 0.3125, h: 0.3125, opacity: 1, rotation: 0 }],
    }],
  };
  const iconCompiled = compileCompositionPlan(iconPlan, [{ overlayId: 'icon', inputIndex: 1 }], { preserveAlpha: true });
  assert.match(iconCompiled.filterComplex, /pad=iw\+/);
  assert.match(iconCompiled.filterComplex, /dilation=coordinates=255/, 'image stroke expands the source alpha before compositing');
  const timedGlowPlan = {
    ...iconPlan,
    overlays: [{ ...iconPlan.overlays[0], shadow: null, effects: [
      { kind: 'glow', params: { color: '#33aaff', blur: 24, opacity: 0.8 }, outputWindows: [{ start: 0.2, end: 0.8 }] },
    ] }],
  };
  const timedGlowGraph = compileCompositionPlan(timedGlowPlan, [{ overlayId: 'icon', inputIndex: 1 }], { preserveAlpha: true }).filterComplex;
  assert.match(timedGlowGraph, /enable='\(gte\(t,0\)\*lt\(t,1\)\)\*\(\(gte\(t,0\.2\)\*lt\(t,0\.8\)\)\)'/, 'alpha glow obeys its half-open overlay and authored effect windows during compositing');
  const iconGraph = path.join(tmp, 'icon-graph.txt');
  fs.writeFileSync(iconGraph, iconCompiled.filterComplex);
  const iconRender = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=black@0:s=128x128:r=1:d=1,format=rgba',
    '-loop', '1', '-t', '1', '-i', iconPath,
    '-filter_complex_script', iconGraph,
    '-map', `[${iconCompiled.outputLabel}]`, '-frames:v', '1',
    '-c:v', 'png', '-pix_fmt', 'rgba', '-y', iconOutput,
  ], { encoding: 'utf8' });
  assert.equal(iconRender.status, 0, `FFmpeg renders the alpha glow: ${iconRender.stderr}`);
  const glowFrame = await Canvas.loadImage(iconOutput);
  const glowCanvas = Canvas.createCanvas(128, 128);
  const glowCtx = glowCanvas.getContext('2d');
  glowCtx.drawImage(glowFrame, 0, 0);
  assert.ok(glowCtx.getImageData(50, 64, 1, 1).data[3] > 0, 'glow alpha extends beyond the original icon silhouette');
  const strokePixel = glowCtx.getImageData(53, 64, 1, 1).data;
  assert.ok(strokePixel[1] > strokePixel[0] && strokePixel[1] > strokePixel[2], 'stroke adds its configured tint outside the original icon edge');
  const leftTint = glowCtx.getImageData(55, 64, 1, 1).data;
  const rightTint = glowCtx.getImageData(73, 64, 1, 1).data;
  assert.ok(leftTint[0] > leftTint[2] && rightTint[2] > rightTint[0], 'gradient fill interpolates across the media layer');

  const parameterizedPlan = {
    ...iconPlan,
    overlays: [{ ...iconPlan.overlays[0], effects: [
      { kind: 'chromatic-aberration', params: { amount: 7 } },
      { kind: 'motion-blur', params: { amount: 3 } },
      { kind: 'distortion', params: { amount: 0 } },
      { type: 'rgb_split', params: { amount: { value: 4 }, angle: { value: 90 }, centerX: { value: 0.2 }, centerY: { value: 0.7 } } },
      { kind: 'color_grade', params: { brightness: { value: 110 }, contrast: { value: 120 }, saturation: { value: 90 } } },
      { kind: 'film_grain', params: { intensity: { value: 0.2 } } },
    ], shadow: null }],
  };
  const parameterizedGraph = compileCompositionPlan(parameterizedPlan, [{ overlayId: 'icon', inputIndex: 1 }], { preserveAlpha: true }).filterComplex;
  assert.ok(parameterizedGraph.includes("r(clip(X-round(7),0,W-1),Y)")
    && parameterizedGraph.includes("b(clip(X+round(7),0,W-1),Y)"), 'chromatic shift uses the requested amount and matches preview channel direction');
  assert.ok(parameterizedGraph.includes("cos(((90)*PI/180))*(4)")
    && parameterizedGraph.includes('pow(X/W-(0.2),2)+pow(Y/H-(0.7),2)'), 'registered RGB split alias preserves wrapped amount, direction and center on overlays');
  assert.ok(parameterizedGraph.includes("sin(((90)*PI/180))*(4)"), 'vertical RGB split direction reaches overlay export');
  assert.match(parameterizedGraph, /colorchannelmixer=rr=1\.1:gg=1\.1:bb=1\.1,eq=contrast=1\.2:saturation=0\.9/, 'registered color grade uses multiplicative CSS brightness semantics in overlays');
  assert.match(parameterizedGraph, /geq=.*floor\(X\/1\.5\).*floor\(T\*30\).*\*9\.6/, 'overlay film grain preserves intensity, authored size, and animation timing');
  assert.match(parameterizedGraph, /gblur=sigma=.*:sigmaV=0/, 'motion blur uses a directional spatial kernel instead of frame trails');
  assert.match(parameterizedGraph, /sin\(Y\*0\.045\+\(?0\)?\).*\(0\)\*W/, 'zero distortion remains zero instead of falling back to a default');
  const parameterizedGraphPath = path.join(tmp, 'parameterized-effects.txt');
  const parameterizedOutput = path.join(tmp, 'parameterized-effects.png');
  fs.writeFileSync(parameterizedGraphPath, parameterizedGraph);
  const parameterizedRender = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=black@0:s=128x128:r=30:d=1,format=rgba',
    '-loop', '1', '-t', '1', '-i', iconPath,
    '-filter_complex_script', parameterizedGraphPath,
    '-map', '[vout]', '-frames:v', '1', '-c:v', 'png', '-pix_fmt', 'rgba', '-y', parameterizedOutput,
  ], { encoding: 'utf8' });
  assert.equal(parameterizedRender.status, 0, `FFmpeg renders the parameterized effect stack: ${parameterizedRender.stderr}`);

  const innerShadowPlan = {
    ...iconPlan,
    overlays: [{ ...iconPlan.overlays[0], effects: [{ kind: 'inner-shadow', params: { color: '#000000', blur: 4, opacity: 1 } }], shadow: null }],
  };
  const innerShadowCompiled = compileCompositionPlan(innerShadowPlan, [{ overlayId: 'icon', inputIndex: 1 }], { preserveAlpha: true });
  const innerShadowGraph = path.join(tmp, 'inner-shadow-graph.txt');
  const innerShadowOutput = path.join(tmp, 'inner-shadow.png');
  fs.writeFileSync(innerShadowGraph, innerShadowCompiled.filterComplex);
  const innerShadowRender = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=black@0:s=128x128:r=1:d=1,format=rgba',
    '-loop', '1', '-t', '1', '-i', iconPath,
    '-filter_complex_script', innerShadowGraph,
    '-map', `[${innerShadowCompiled.outputLabel}]`, '-frames:v', '1',
    '-c:v', 'png', '-pix_fmt', 'rgba', '-y', innerShadowOutput,
  ], { encoding: 'utf8' });
  assert.equal(innerShadowRender.status, 0, `FFmpeg renders inner shadow: ${innerShadowRender.stderr}`);
  const shadowFrame = await Canvas.loadImage(innerShadowOutput);
  const shadowCanvas = Canvas.createCanvas(128, 128);
  const shadowCtx = shadowCanvas.getContext('2d');
  shadowCtx.drawImage(shadowFrame, 0, 0);
  const edge = shadowCtx.getImageData(55, 64, 1, 1).data;
  const center = shadowCtx.getImageData(64, 64, 1, 1).data;
  assert.ok(edge[0] < center[0], 'inner shadow darkens the alpha silhouette near its edge');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('Transparent graphics export passed: captions, alpha masks, ProRes 4444 round trip, blend modes, and footage effects render through FFmpeg.');
