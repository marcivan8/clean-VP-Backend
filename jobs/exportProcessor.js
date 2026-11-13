'use strict';

/**
 * jobs/exportProcessor.js
 *
 * BullMQ job handler for timeline exports.
 * Replaces the synchronous HTTP handler in routes/exportRoutes.js.
 *
 * Job data shape:
 *   { timeline, settings, userId, assetMap }
 *
 * Returns:
 *   { url, filename, metadata }
 *   url = '/api/proxy/gcs-media/exports/{userId}/{jobId}.{format}' (GCS)
 *      OR '/uploads/exports/{jobId}.{format}'                       (local fallback)
 */

const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
const { spawnSync, spawn } = require('child_process');

ffmpeg.setFfprobePath(ffprobeInstaller.path);
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const storageConfig = require('../config/storage');
// Shared with routes/waveformRoutes.js: one definition of where the bundled
// sound-effect library lives and how its root-relative URLs resolve to disk.
const { resolveStaticAudioPath, resolveStaticAudioFile } = require('../utils/waveformPath');

ffmpeg.setFfmpegPath(ffmpegPath);

// ── drawtext / libfreetype detection ─────────────────────────────────────────
// ffmpeg-static omits libfreetype on most platforms, so the drawtext filter
// (used to burn captions into the exported video) is unavailable.  We probe
// once at startup: if the static binary lacks it we fall back to the system
// ffmpeg (installed via apt in the Dockerfile) which ships with libfreetype.
function _probeDrawtext(bin) {
    try {
        const r = spawnSync(bin, ['-filters'], { encoding: 'utf-8', timeout: 8000 });
        return (r.stdout || r.stderr || '').includes('drawtext');
    } catch (_) { return false; }
}
const SYSTEM_FFMPEG = '/usr/bin/ffmpeg';
const DRAWTEXT_BIN  =
    _probeDrawtext(ffmpegPath)                             ? ffmpegPath   :
    (fs.existsSync(SYSTEM_FFMPEG) && _probeDrawtext(SYSTEM_FFMPEG)) ? SYSTEM_FFMPEG :
    ffmpegPath; // last resort — drawtext will still fail but at least logs why
console.log(`[exportProcessor] drawtext ffmpeg: ${DRAWTEXT_BIN === ffmpegPath ? 'static' : 'system ('+SYSTEM_FFMPEG+')'}`);

/** Run an ffmpeg binary with argv, rejecting with the stderr tail on failure. */
function runFfmpegArgs(bin, args) {
    return new Promise((resolve, reject) => {
        const proc = spawn(bin, args);
        const stderrChunks = [];
        proc.stderr.on('data', chunk => stderrChunks.push(chunk));
        proc.on('error', reject);
        proc.on('close', code => {
            if (code === 0) return resolve();
            const errTail = Buffer.concat(stderrChunks).toString('utf-8').slice(-8000);
            reject(new Error(`ffmpeg exited ${code}:\n${errTail}`));
        });
    });
}

function runProgram(bin, args, cwd) {
    return new Promise((resolve, reject) => {
        const proc = spawn(bin, args, { cwd });
        const stderr = [];
        proc.stderr.on('data', chunk => stderr.push(chunk));
        proc.on('error', reject);
        proc.on('close', code => code === 0
            ? resolve()
            : reject(new Error(`${path.basename(bin)} exited ${code}: ${Buffer.concat(stderr).toString('utf8').slice(-4000)}`)));
    });
}

/**
 * Render an authored effect DAG over a generated RGBA graphic sequence.
 *
 * Templates and vectors are drawn to PNGs before the composition compiler
 * places/scales them on the output canvas. Applying a branched graph here keeps
 * every branch in the layer's own coordinate space, preserves alpha, and uses
 * the exact DAG compiler already used for primary footage. It deliberately
 * returns another numbered PNG sequence: the regular compositor can then keep
 * doing masks, motion blur, parent groups, blend modes, and transparency
 * without a second special rendering path.
 */
async function renderGraphicEffectGraphSequence(sequence, effectGraph, {
    tmpDir,
    name,
    fps,
    duration,
    clipStart,
} = {}) {
    if (!effectGraph || !sequence?.pattern) return sequence;
    const frameRate = Math.max(1, Math.min(120, Number(fps) || 30));
    const frameCount = Math.max(1, Math.round(Number(sequence.frames) || Math.ceil(Math.max(0.01, Number(duration) || 0.01) * frameRate)));
    const width = Math.max(2, Math.round(Number(sequence.width) || 2));
    const height = Math.max(2, Math.round(Number(sequence.height) || 2));
    const outputDir = path.join(tmpDir, `graphic-effect-graph-${String(name || 'layer').replace(/[^a-zA-Z0-9_-]/g, '_')}`);
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPattern = path.join(outputDir, 'f%05d.png');
    const graphScript = path.join(outputDir, 'effect-graph.txt');
    const graphOutput = 'graphic_effect_dag';
    const finalOutput = 'graphic_effect_rgba';
    const graph = [
        ...compileTimelineVisualEffectDag(effectGraph, {
            width,
            height,
            duration: Math.max(1 / frameRate, Number(duration) || frameCount / frameRate),
            clipStart: Math.max(0, Number(clipStart) || 0),
            complexGlow: true,
        }, '0:v', graphOutput),
        `[${graphOutput}]format=rgba[${finalOutput}]`,
    ];
    fs.writeFileSync(graphScript, graph.join(';'), 'utf8');
    await runFfmpegArgs(ffmpegPath, [
        '-hide_banner', '-loglevel', 'error',
        '-framerate', String(frameRate), '-start_number', '0', '-i', sequence.pattern,
        '-filter_complex_script', graphScript, '-map', `[${finalOutput}]`,
        '-frames:v', String(frameCount), '-vsync', '0',
        '-c:v', 'png', '-pix_fmt', 'rgba', '-compression_level', '3', '-y',
        // This is an OUTPUT option. Keep it after the input so the generated
        // sequence starts at f00000.png, matching TemplateRenderer and the
        // image-sequence input the composition pass consumes next.
        '-start_number', '0', outputPattern,
    ]);
    const files = fs.readdirSync(outputDir)
        .filter(file => /^f\d+\.png$/i.test(file))
        .sort((left, right) => Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]))
        .map(file => path.join(outputDir, file));
    if (files.length !== frameCount) {
        throw new Error(`effect graph produced ${files.length}/${frameCount} graphic frames`);
    }
    return {
        ...sequence,
        pattern: outputPattern,
        files,
    };
}

/**
 * Prepare an uploaded overlay for the raster-DAG pass.
 *
 * The composition compiler normally owns video in-points, speed and time
 * remapping. A branched effect graph needs to run *between* that source-time
 * operation and layer geometry, however: feeding the graph an un-retimed
 * source would make an effect window/keyframe disagree with the layer the
 * user sees. Keep this deliberately small twin of the compiler's source-time
 * block. It emits a LOCAL (zero-based) timeline; the regular compositor still
 * applies outputStart, transform, masks, mattes and blend mode afterwards.
 */
function compileOverlaySourcePreparation(overlay) {
    const sourceType = String(overlay?.source?.type || 'video');
    if (sourceType !== 'video') return ['setpts=PTS-STARTPTS'];

    const map = Array.isArray(overlay?.sourceTimeMap)
        ? overlay.sourceTimeMap.filter(point => Number.isFinite(Number(point?.source)) && Number.isFinite(Number(point?.output)))
        : [];
    const speed = Number(overlay?.speed) > 0 ? Number(overlay.speed) : 1;
    if (map.length === 1) {
        // A vertical source-time curve is a deliberate freeze. The source is
        // sought to the hold frame by the caller, then expanded locally.
        return [
            'trim=end_frame=1', 'setpts=PTS-STARTPTS',
            'loop=loop=-1:size=1:start=0', 'setpts=PTS-STARTPTS',
        ];
    }
    if (map.length > 1) {
        const direction = Math.sign(Number(map.at(-1).source) - Number(map[0].source));
        const reverse = direction < 0;
        const sourceSpan = Math.max(1 / 120, Math.abs(Number(map.at(-1).source) - Number(map[0].source)));
        const source = `(${Number(map[0].source).toFixed(6)}${reverse ? '-' : '+'}(PTS-STARTPTS)*TB)`;
        let outputTime = Number(map.at(-1).output).toFixed(6);
        for (let index = map.length - 2; index >= 0; index--) {
            const from = map[index], to = map[index + 1];
            const deltaSource = Number(to.source) - Number(from.source);
            if (Math.abs(deltaSource) <= 1e-7) {
                const boundary = reverse
                    ? `gte(${source},${Number(from.source).toFixed(6)})`
                    : `lte(${source},${Number(from.source).toFixed(6)})`;
                outputTime = `if(${boundary},${Number(from.output).toFixed(6)},${outputTime})`;
                continue;
            }
            if (Math.sign(deltaSource) !== direction) continue;
            const slope = (Number(to.output) - Number(from.output)) / deltaSource;
            const segment = `${Number(from.output).toFixed(6)}+(${source}-${Number(from.source).toFixed(6)})*${Number(slope).toFixed(8)}`;
            outputTime = `if(${reverse ? 'gt' : 'lt'}(${source},${Number(to.source).toFixed(6)}),${segment},${outputTime})`;
        }
        return [
            `trim=duration=${sourceSpan.toFixed(6)}`,
            ...(reverse ? ['reverse'] : []),
            'setpts=PTS-STARTPTS',
            `setpts=(${outputTime.replace(/,/g, '\\,')})/TB`,
        ];
    }
    return Math.abs(speed - 1) > 0.001
        ? [`setpts=(PTS-STARTPTS)/${speed.toFixed(6)}`]
        : ['setpts=PTS-STARTPTS'];
}

function overlayGraphSeek(overlay) {
    if (overlay?.source?.type !== 'video') return 0;
    const map = Array.isArray(overlay?.sourceTimeMap) ? overlay.sourceTimeMap : [];
    const mapStart = map.length
        ? Math.min(...map.map(point => Number(point?.source)).filter(Number.isFinite))
        : 0;
    return Math.max(0, (Number(overlay?.sourceOffset) || 0) + (Number.isFinite(mapStart) ? mapStart : 0));
}

/**
 * Rasterize a complex graph on an uploaded image/video overlay.
 *
 * This is the media equivalent of renderGraphicEffectGraphSequence. It turns
 * the source into a bounded local RGBA PNG sequence after its authored source
 * timing, applies the true fork/join DAG, and leaves every subsequent layer
 * operation to CompositorCompiler. PNGs are intentional: they preserve alpha
 * and make this stage cacheable/recoverable independently of the final codec.
 */
async function renderOverlayEffectGraphSequence(sourcePath, overlay, {
    tmpDir,
    name,
    fps,
    duration,
    clipStart,
} = {}) {
    if (!overlay?.effectGraph || !sourcePath) return null;
    const frameRate = Math.max(1, Math.min(120, Number(fps) || 30));
    const localDuration = Math.max(1 / frameRate, Number(duration) || 1 / frameRate);
    const frameCount = Math.max(1, Math.ceil(localDuration * frameRate));
    const dimensions = await getVideoDimensions(sourcePath);
    const width = Math.max(2, Math.round(Number(dimensions?.width || overlay?.sourceWidth) || 1920));
    const height = Math.max(2, Math.round(Number(dimensions?.height || overlay?.sourceHeight) || 1080));
    const safeName = String(name || overlay.id || 'layer').replace(/[^a-zA-Z0-9_-]/g, '_');
    const outputDir = path.join(tmpDir, `overlay-effect-graph-${safeName}`);
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPattern = path.join(outputDir, 'f%05d.png');
    const graphScript = path.join(outputDir, 'effect-graph.txt');
    const sourceLabel = 'overlay_graph_source';
    const graphOutput = 'overlay_graph_dag';
    const finalOutput = 'overlay_graph_rgba';
    const sourceFilters = [
        ...compileOverlaySourcePreparation(overlay),
        `fps=${frameRate}`,
        // A source map can deliberately hold a frame, and source footage can
        // end a fraction before a requested timeline window. Match the normal
        // compositor's stable end-of-source behavior rather than exposing a
        // transparent one-frame flash in the prepass.
        `tpad=stop_mode=clone:stop_duration=${localDuration.toFixed(6)}`,
        `trim=duration=${localDuration.toFixed(6)}`,
        'format=rgba',
    ];
    const graph = [
        `[0:v]${sourceFilters.join(',')}[${sourceLabel}]`,
        ...compileTimelineVisualEffectDag(overlay.effectGraph, {
            width,
            height,
            duration: localDuration,
            clipStart: Math.max(0, Number(clipStart) || 0),
            complexGlow: true,
        }, sourceLabel, graphOutput),
        `[${graphOutput}]format=rgba[${finalOutput}]`,
    ];
    fs.writeFileSync(graphScript, graph.join(';'), 'utf8');
    const args = ['-hide_banner', '-loglevel', 'error'];
    if (overlay?.source?.type === 'image' || overlay?.source?.type === 'sticker') {
        args.push('-loop', '1', '-framerate', String(frameRate), '-t', String(localDuration), '-i', sourcePath);
    } else {
        const seek = overlayGraphSeek(overlay);
        if (seek > 0) args.push('-ss', String(seek));
        args.push('-i', sourcePath);
    }
    args.push(
        '-filter_complex_script', graphScript, '-map', `[${finalOutput}]`,
        '-frames:v', String(frameCount), '-vsync', '0',
        '-c:v', 'png', '-pix_fmt', 'rgba', '-compression_level', '3', '-y',
        '-start_number', '0', outputPattern,
    );
    await runFfmpegArgs(ffmpegPath, args);
    const files = fs.readdirSync(outputDir)
        .filter(file => /^f\d+\.png$/i.test(file))
        .sort((left, right) => Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]))
        .map(file => path.join(outputDir, file));
    if (files.length !== frameCount) {
        throw new Error(`effect graph produced ${files.length}/${frameCount} overlay frames`);
    }
    return { pattern: outputPattern, files, frames: frameCount, width, height };
}
// ─────────────────────────────────────────────────────────────────────────────

const gcsBucket = storageConfig.bucket;

// ─── Helpers (mirrors exportRoutes.js) ───────────────────────────────────────

const isServerUsableUrl = (u) => u && !u.startsWith('blob:');

/**
 * The opt-in Revideo worker draws plain text and static image overlays with
 * transform/opacity motion, CSS filters, and node shadows. It does not apply
 * masks, blend modes, vector/template layers, or media overlays. Keep those
 * projects on the complete FFmpeg compositor path until the worker implements
 * those capabilities, rather than claiming success after dropping features.
 */
const REVVIDEO_SUPPORTED_EFFECTS = new Set([
    'blur', 'blur_gaussian', 'brightness', 'contrast', 'invert', 'saturation', 'saturate',
    'hue', 'hue-rotate', 'grayscale', 'sepia', 'shadow', 'drop-shadow',
]);
const REVVIDEO_EFFECT_ANIMATABLE_PARAMS = {
    blur: new Set(['radius', 'amount']), blur_gaussian: new Set(['radius', 'amount']),
    invert: new Set(['amount', 'value']),
    brightness: new Set(['amount', 'value']), contrast: new Set(['amount', 'value']),
    saturation: new Set(['amount', 'value']), saturate: new Set(['amount', 'value']),
    hue: new Set(['degrees', 'amount']), 'hue-rotate': new Set(['degrees', 'amount']),
    grayscale: new Set(['amount', 'value']), sepia: new Set(['amount', 'value']),
    shadow: new Set(['blur', 'opacity', 'x', 'y', 'offsetX', 'offsetY']),
    'drop-shadow': new Set(['blur', 'opacity', 'x', 'y', 'offsetX', 'offsetY']),
};

function isRevideoEffectAnimationSupported(effect) {
    const supported = REVVIDEO_EFFECT_ANIMATABLE_PARAMS[effect?.kind || effect?.type];
    if (!supported) return true;
    const params = effect?.params || {};
    const animated = new Set([
        ...Object.keys(effect?.keyframes || {}),
        ...Object.keys(effect?.expressions || {}),
        ...Object.keys(params).filter(key => Array.isArray(params[key]?.keyframes) || typeof params[key]?.expression === 'string'),
    ]);
    return [...animated].every(key => supported.has(key));
}

function isRevideoShadowStackSupported(effects) {
    // Revideo Node exposes one shadow channel. The adapter can merge multiple
    // shadows into that channel, but doing so collapses distinct colors and
    // blur radii and changes the look. Keep stacked shadows on the full
    // compositor path until the Revideo adapter can render each independently.
    return (Array.isArray(effects) ? effects : []).filter(effect => effect
        && effect.enabled !== false && ['shadow', 'drop-shadow'].includes(effect.kind || effect.type)).length <= 1;
}

function isRevideoTextStyleSupported(clip) {
    const style = clip.captionStyle || {};
    if ((clip.fontStyle && clip.fontStyle !== 'normal') || (style.fontStyle && style.fontStyle !== 'normal')) return false;
    if ((clip.textDecoration && clip.textDecoration !== 'none') || (style.textDecoration && style.textDecoration !== 'none')) return false;
    if ((clip.textAlign && clip.textAlign !== 'center') || (style.textAlign && style.textAlign !== 'center')) return false;
    if ((clip.textShadow && clip.textShadow !== 'none') || (style.textShadow && style.textShadow !== 'none')) return false;
    // The Revideo <Txt> renderer only maps content, basic font/color, and
    // transforms. RichTextEngine/DOM preview also support tracking, leading,
    // stroke, backgrounds and case transforms; send those authored clips to
    // the complete compositor instead of silently dropping their typography.
    if (clip.stroke || clip.strokeWidth || clip.backgroundColor || clip.uppercase || style.uppercase
        || style.stroke || style.strokeWidth || style.backgroundColor
        || clip.letterSpacing || clip.tracking || style.letterSpacing || style.tracking
        || clip.lineHeight != null || style.lineHeight != null
        || (clip.textTransform && clip.textTransform !== 'none')
        || (style.textTransform && style.textTransform !== 'none')) return false;
    const highlightMode = clip.captionStyle?.wordHighlight?.mode;
    return !highlightMode || ['none', 'color', 'opacity', 'scale'].includes(highlightMode);
}

const REVVIDEO_LEGACY_TRANSFORM_CHANNELS = new Set([
    'x', 'y', 'scale', 'scaleX', 'scaleY', 'rotation', 'opacity',
]);

function isRevideoLegacyTransformKeyframesSupported(keyframes) {
    if (!keyframes || typeof keyframes !== 'object' || Array.isArray(keyframes)) return false;
    return Object.entries(keyframes).every(([channel, frames]) => {
        if (!REVVIDEO_LEGACY_TRANSFORM_CHANNELS.has(channel)) return false;
        if (!Array.isArray(frames)) return false;
        return frames.every(frame => frame?.time != null && frame?.value != null
            && Number.isFinite(Number(frame.time)) && Number.isFinite(Number(frame.value)));
    });
}

function isRevideoTrackSupported(track, audioWaveformsByAsset = {}) {
    if (!track || !Array.isArray(track.clips) || track.clips.length === 0) return false;
    const transformProps = new Set(['x', 'y', 'scale', 'rotation', 'opacity']);
    const audioReactiveMotionTargets = new Set(['x', 'y', 'scale', 'rotation', 'opacity', 'positionX', 'positionY', 'rotationZ']);
    return track.clips.every(clip => {
        const audioReactive = clip?.audioReactive;
        const audioTarget = String(audioReactive?.target || 'scale');
        if (audioReactive?.assetId && !audioReactiveMotionTargets.has(audioTarget)) return false;
        const audioReactiveAssetId = clip?.audioReactive?.assetId;
        if (audioReactiveAssetId) {
            const waveform = audioWaveformsByAsset?.[audioReactiveAssetId];
            const peaks = Array.isArray(waveform) ? waveform : waveform?.peaks;
            if (!Array.isArray(peaks) || peaks.length === 0) return false;
        }
        if (!clip || (clip.effects || []).some(effect => effect && effect.enabled !== false
            && !REVVIDEO_SUPPORTED_EFFECTS.has(effect.kind || effect.type))) return false;
        if (!isRevideoShadowStackSupported(clip.effects)) return false;
        if ((clip.effects || []).some(effect => effect && effect.enabled !== false && !isRevideoEffectAnimationSupported(effect))) return false;
        if ((clip.effects || []).some(effect => effect && effect.enabled !== false
            && effect.outputWindows != null && (!Array.isArray(effect.outputWindows)
                || effect.outputWindows.some(window => !window || !Number.isFinite(Number(window.start))
                    || !Number.isFinite(Number(window.end)) || Number(window.start) < 0
                    || Number(window.end) <= Number(window.start))))) return false;
        // Revideo's shared resolver evaluates these absolute transform tracks
        // for text and image overlays. Unknown or malformed tracks stay on the
        // compositor path, which preserves their complete behavior.
        if (Object.keys(clip.keyframes || {}).length > 0
            && (!['text', 'overlay'].includes(track.type)
                || !isRevideoLegacyTransformKeyframesSupported(clip.keyframes))) return false;
        // Nested composition stacks are not yet represented by the Revideo
        // adapter. The compositor path preserves group transforms and effects.
        if (Array.isArray(clip.compositionStack) && clip.compositionStack.length > 0) return false;
        if (clip.sceneMask || clip.layerMask || clip.mask || clip.shadow || (clip.blendMode && clip.blendMode !== 'source-over')) return false;
        const expressions = clip.expressions || {};
        if (Object.keys(expressions).some(prop => !transformProps.has(prop))) return false;
        const animations = Array.isArray(clip.animations) ? clip.animations : [];
        if (animations.some(animation => (animation?.keyframes || []).some(frame =>
            Object.keys(frame?.properties || {}).some(prop => !transformProps.has(prop)
                && !(prop === 'reveal' && Array.isArray(clip.words) && clip.words.length > 0))))) return false;
        if (track.type === 'text') return clip.type === 'text' && !clip.template && !clip.runs && isRevideoTextStyleSupported(clip);
        if (track.type === 'overlay') {
            const kind = clip.type || 'image';
            return ['image', 'sticker'].includes(kind) && !!(clip.url || clip.proxyUrl || clip.sourceUrl);
        }
        return false;
    });
}

/**
 * The line of an FFmpeg failure that actually says what went wrong.
 *
 * `runFfmpegArgs` rejects with the whole stderr tail, which is mostly banner
 * and stream metadata. Surfacing all of it in a user-facing warning is as
 * useless as surfacing none of it, so take the first line that looks like a
 * diagnosis and cap it.
 */
function firstFfmpegError(message) {
    const text = String(message || '').trim();
    if (!text) return 'no error message';
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const noise = /^(ffmpeg version|built with|configuration:|lib[a-z]+ +\d|\s*Stream #|\s*Metadata:|\s*encoder\s*:|Input #|Output #|\s*Duration:)/i;
    // "Conversion failed!" is the trailer ffmpeg prints after the line that
    // actually explains the failure, so it is the LAST resort, not the first
    // match — reporting it would be the same dead end as reporting nothing.
    const generic = /^(conversion failed|error while filtering)/i;
    const diagnostic = /error|invalid|no such|cannot|unable|impossible|failed|unrecognized|unknown|not found|permission|killed|out of memory|too many/i;
    const useful = lines.filter(l => !noise.test(l) && diagnostic.test(l));
    const best = useful.find(l => !generic.test(l)) || useful[0] || lines[lines.length - 1];
    return String(best || text).slice(0, 300);
}

async function downloadToTemp(url, destPath, headers = undefined) {
    const response = await axios({ url, method: 'GET', responseType: 'stream', timeout: 120_000, headers });
    await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(destPath);
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
        response.data.on('error', reject);
    });
}

function resolveSourcePath(clip, uploadsDir) {
    if (clip.fsPath && fs.existsSync(clip.fsPath)) return clip.fsPath;
    const inUploads = path.join(uploadsDir, clip.name);
    if (fs.existsSync(inUploads)) return inUploads;
    return null;
}

function buildScaleFilter(width, height) {
    return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
}

// ── R100: base-clip (video/image) resize/reposition transform ──────────────
// The export-side counterpart of BaseClipOverlay.jsx's on-screen drag/resize
// handles. Until now `clip.x`/`clip.y`/`clip.scale` on a BASE clip were read
// by the live preview (client/src/revideo/project.tsx) but had NO export
// consumer at all — buildScaleFilter()'s centred fit-and-pad ran unconditionally
// for every base clip, so a clip resized/moved in the editor came out full-
// frame and centred in the actual export. This fixes that gap specifically;
// it does not touch any clip that was never resized/moved (hasBaseClipTransform
// is false for every pre-existing project — buildScaleFilter is still used
// for those, completely unchanged).
//
// fitContainSizePx() MUST mirror client/src/motion/BaseClipGeometry.js's
// fitContainSize() AND project.tsx's own fitSize() exactly — the same
// preview/export-parity concern as DEFAULT_WIDTH_FRACTION elsewhere in this
// codebase. It is duplicated here (not imported) because this file is
// CommonJS and that one is an ES module — see vibed-codegen's module-format
// rule.
function fitContainSizePx(mediaW, mediaH, canvasWidth, canvasHeight) {
    if (!mediaW || !mediaH || !canvasWidth || !canvasHeight) {
        return { w: canvasWidth || 0, h: canvasHeight || 0 };
    }
    const s = Math.min(canvasWidth / mediaW, canvasHeight / mediaH);
    return { w: Math.round(mediaW * s), h: Math.round(mediaH * s) };
}

function optionalFiniteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

/** True only for a clip actually moved/resized by the new handles — a tiny
 *  float epsilon so a clip that was merely re-saved (scale === 1.0000001 from
 *  a prior float round-trip) doesn't spuriously take the new code path. */
function hasBaseClipTransform(clip) {
    const scale = optionalFiniteNumber(clip.scale);
    const scaleX = optionalFiniteNumber(clip.scaleX);
    const scaleY = optionalFiniteNumber(clip.scaleY);
    const rotation = optionalFiniteNumber(clip.rotation);
    const opacity = optionalFiniteNumber(clip.opacity);
    const animatedOpacity = Array.isArray(clip.keyframes?.opacity) && clip.keyframes.opacity.length > 0;
    const animatedRotation = Array.isArray(clip.keyframes?.rotation) && clip.keyframes.rotation.length > 0;
    const x = Number(clip.x) || 0;
    const y = Number(clip.y) || 0;
    return (Number.isFinite(scale) && Math.abs(scale - 1) > 1e-6)
        || (Number.isFinite(scaleX) && Math.abs(scaleX - 1) > 1e-6)
        || (Number.isFinite(scaleY) && Math.abs(scaleY - 1) > 1e-6)
        || (Number.isFinite(rotation) && Math.abs(rotation) > 1e-6)
        || (Number.isFinite(opacity) && opacity < 1 - 1e-6)
        || animatedOpacity
        || animatedRotation
        || Math.abs(x) > 0.5 || Math.abs(y) > 0.5;
}

/**
 * The scale filter (no pad) plus the pixel position to `overlay=` this clip
 * at, so it lands on the output canvas at the same place/size the editor
 * showed — contain-fit the source, multiply by clip.scale, then centre and
 * nudge by clip.x/clip.y (canvas pixels from centre — see
 * BaseClipGeometry.js's header for why base clips use this convention and
 * not overlay clips' 0-100 percent).
 */
function buildTransformFilters(clip, targetWidth, targetHeight) {
    const even = (n) => Math.max(2, Math.round(n / 2) * 2);
    const rawSrcW = clip.metadata?.resolution?.w || clip.sourceWidth || targetWidth;
    const rawSrcH = clip.metadata?.resolution?.h || clip.sourceHeight || targetHeight;
    const cropW = Math.max(0.05, Math.min(1, Number(clip.virtualCam?.cropW) || 1));
    const cropH = Math.max(0.05, Math.min(1, Number(clip.virtualCam?.cropH) || 1));
    const srcW = rawSrcW * cropW;
    const srcH = rawSrcH * cropH;
    const fitted = fitContainSizePx(srcW, srcH, targetWidth, targetHeight);
    const authoredScale = optionalFiniteNumber(clip.scale);
    const authoredScaleX = optionalFiniteNumber(clip.scaleX);
    const authoredScaleY = optionalFiniteNumber(clip.scaleY);
    // Clip axes are signed: a negative horizontal/vertical value is an
    // intentional mirror. Scale dimensions themselves must stay positive for
    // FFmpeg, so preserve the sign as hflip/vflip after scaling. Previously
    // the `> 0` checks silently replaced a mirror with the uniform scale,
    // creating a preview/export mismatch for flipped footage.
    const scale = authoredScale !== null && Math.abs(authoredScale) > 1e-8 ? authoredScale : 1;
    const scaleX = authoredScaleX !== null && Math.abs(authoredScaleX) > 1e-8 ? authoredScaleX : scale;
    const scaleY = authoredScaleY !== null && Math.abs(authoredScaleY) > 1e-8 ? authoredScaleY : scale;
    const flipH = scaleX < 0;
    const flipV = scaleY < 0;
    const w = even(fitted.w * Math.abs(scaleX));
    const h = even(fitted.h * Math.abs(scaleY));
    const rotation = optionalFiniteNumber(clip.rotation) ?? 0;
    const opacity = Math.max(0, Math.min(1, optionalFiniteNumber(clip.opacity) ?? 1));
    const radians = rotation * Math.PI / 180;
    const rotatedW = Math.abs(rotation) > 1e-6 ? even(Math.abs(w * Math.cos(radians)) + Math.abs(h * Math.sin(radians))) : w;
    const rotatedH = Math.abs(rotation) > 1e-6 ? even(Math.abs(h * Math.cos(radians)) + Math.abs(w * Math.sin(radians))) : h;
    const needsAlpha = Math.abs(rotation) > 1e-6 || opacity < 1 - 1e-6;
    const alphaFilters = needsAlpha
        ? `,format=rgba${Math.abs(rotation) > 1e-6 ? `,rotate=${rotation.toFixed(4)}*PI/180:ow=2*ceil(rotw(iw)/2):oh=2*ceil(roth(ih)/2):c=black@0:bilinear=1` : ''}${opacity < 1 - 1e-6 ? `,colorchannelmixer=aa=${opacity.toFixed(4)}` : ''},format=yuva420p`
        : '';
    const overlayX = Math.round((targetWidth - rotatedW) / 2 + (Number(clip.x) || 0));
    const overlayY = Math.round((targetHeight - rotatedH) / 2 + (Number(clip.y) || 0));
    return {
        scaleFilter: `scale=${w}:${h}:force_original_aspect_ratio=disable,setsar=1${flipH ? ',hflip' : ''}${flipV ? ',vflip' : ''}${alphaFilters}`,
        overlayX, overlayY, w: rotatedW, h: rotatedH, sourceW: w, sourceH: h, rotation, opacity, flipH, flipV,
    };
}

function buildAnimatedOpacityFilter(keyframes) {
    const points = (Array.isArray(keyframes) ? keyframes : [])
        .filter(frame => Number.isFinite(Number(frame?.time)) && Number.isFinite(Number(frame?.value)))
        .map(frame => ({ t: Math.max(0, Number(frame.time)), v: Math.max(0, Math.min(1, Number(frame.value))), e: frame.easing }))
        .sort((a, b) => a.t - b.t);
    if (!points.length) return null;
    const expression = keyframeExpr(points, 'T', 6);
    if (!expression) return null;
    return `format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*clip((${expression}),0,1)'`;
}

/** Rotate a clip-local layer per frame while keeping a fixed, centered bounds. */
function buildAnimatedRotationFilter(keyframes) {
    const points = (Array.isArray(keyframes) ? keyframes : [])
        .filter(frame => Number.isFinite(Number(frame?.time)) && Number.isFinite(Number(frame?.value)))
        .map(frame => ({ t: Math.max(0, Number(frame.time)), v: Number(frame.value), e: frame.easing }))
        .sort((a, b) => a.t - b.t);
    if (!points.length) return null;
    const angle = keyframeExpr(points, 't', 5);
    if (!angle) return null;
    // The diagonal square keeps every intermediate angle inside the same output
    // bounds; otherwise FFmpeg sizes the first frame and clips later rotations.
    return `format=rgba,rotate='(${angle})*PI/180':ow=2*ceil(sqrt(iw*iw+ih*ih)/2):oh=2*ceil(sqrt(iw*iw+ih*ih)/2):c=black@0:bilinear=1,format=yuva420p`;
}

/**
 * Audio tempo for a clip speed, as a chain of atempo filters. One atempo
 * only accepts 0.5-2.0 (older ffmpeg), so 4x is atempo=2,atempo=2 and 0.25x
 * is atempo=0.5,atempo=0.5. It used to clamp to 0.5-2.0, so a 4x clip's
 * audio ran at 2x and drifted out of sync with its picture.
 */
function atempoChain(speed) {
    let s = Number(speed) > 0 ? Number(speed) : 1;
    const parts = [];
    while (s > 2.0 + 1e-9) { parts.push(2.0); s /= 2.0; }
    while (s < 0.5 - 1e-9) { parts.push(0.5); s /= 0.5; }
    parts.push(s);
    return parts.map(x => `atempo=${x.toFixed(4)}`);
}

/**
 * Smooth, sub-pixel zoom for scale keyframes (zoom rhythm push-ins and
 * punch-ins), as an ffmpeg filter string: `fps=N,perspective=...`.
 *
 * Replaces zoompan, which snaps its crop window to whole pixels: on a slow
 * push-in the picture stepped back and forth by up to 2 px per frame (visible
 * shake). `perspective` samples the window with (bilinear) interpolation, so
 * the motion is smooth and only ever moves one way. Measured on a 5 s
 * 1.05 -> 1.10 push-in: zoompan 25 backward steps, this 0. Cost: about +55%
 * encode time on the zoomed clips only (bicubic was +90% for no visible gain
 * at these zoom levels).
 *
 * Time is the frame index over `fps` (the filter starts with `fps=N`), i.e.
 * clip-local timeline seconds when placed after the speed `setpts`, the same
 * axis the keyframes use. Each segment uses the DESTINATION keyframe's easing,
 * like the preview's evaluateKF (client/src/revideo/project.tsx).
 *
 * anchor:
 *   { mode: 'fixed', x, y }   the point at (x, y) (fractions of the frame)
 *                             stays put, e.g. the talking-head anchor (0.5, 0.28)
 *   { mode: 'center', x, y }  the window is centred on (x, y) and kept inside
 *                             the frame (multicam angle centre)
 * Returns null when there is nothing visible to animate.
 */
function springEaseExpr(stiffness, damping, mass, u) {
    const k = Math.max(1, Number(stiffness) || 170);
    const c = Math.max(0.1, Number(damping) || 26);
    const m = Math.max(0.1, Number(mass) || 1);
    const w0 = Math.sqrt(k / m);
    const zeta = c / (2 * Math.sqrt(k * m));
    let response;
    if (zeta < 1) {
        const wd = w0 * Math.sqrt(1 - zeta * zeta);
        const tau = `((${u})*${(Math.log(1000) / (zeta * w0)).toFixed(6)})`;
        response = `(1-exp(-${(zeta * w0).toFixed(6)}*${tau})*(cos(${wd.toFixed(6)}*${tau})+${(zeta * w0 / wd).toFixed(6)}*sin(${wd.toFixed(6)}*${tau})))`;
    } else if (zeta === 1) {
        const tau = `((${u})*${(9.2 / w0).toFixed(6)})`;
        response = `(1-exp(-${w0.toFixed(6)}*${tau})*(1+${w0.toFixed(6)}*${tau}))`;
    } else {
        const root = Math.sqrt(zeta * zeta - 1);
        const r1 = -w0 * (zeta - root), r2 = -w0 * (zeta + root);
        const A = r2 / (r2 - r1), B = 1 - A;
        const tau = `((${u})*${(Math.log(1000) / Math.abs(r1)).toFixed(6)})`;
        response = `(1-(${A.toFixed(6)}*exp(${r1.toFixed(6)}*${tau})+${B.toFixed(6)}*exp(${r2.toFixed(6)}*${tau})))`;
    }
    return `if(lte(${u},0),0,if(gte(${u},1),1,${response}))`;
}

function sampledEaseExpr(samples, u) {
    const points = samples.map((sample, index) => Array.isArray(sample)
        ? { x: sample[0], y: sample[1] }
        : sample && typeof sample === 'object' && Number.isFinite(sample.x) && Number.isFinite(sample.y)
            ? { x: sample.x, y: sample.y }
            : { x: index / (samples.length - 1), y: sample });
    let expression = points.at(-1).y.toFixed(6);
    for (let i = points.length - 2; i >= 0; i--) {
        const { x: a, y: from } = points[i];
        const { x: b, y: to } = points[i + 1];
        // Interpolate by the local segment fraction exactly once.
        const value = `(${from.toFixed(6)}+${(to - from).toFixed(6)}*((${u}-${a.toFixed(6)})/${(b - a).toFixed(6)}))`;
        expression = `if(lt(${u},${b.toFixed(6)}),${value},${expression})`;
    }
    return `if(lte(${u},0),0,if(gte(${u},1),1,${expression}))`;
}

function cubicBezierEaseExpr(x1, y1, x2, y2, u) {
    // CSS easing clamps time control points to [0, 1] while allowing vertical
    // overshoot. Mirror client/src/motion/Easing.js so camera animation and
    // layer animation interpret the same authored curve.
    x1 = Math.max(0, Math.min(1, Number(x1)));
    x2 = Math.max(0, Math.min(1, Number(x2)));
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = t => ((ax * t + bx) * t + cx) * t;
    const sy = t => ((ay * t + by) * t + cy) * t;
    const dx = t => (3 * ax * t + 2 * bx) * t + cx;
    const sample = x => {
        let t = x;
        for (let i = 0; i < 8; i++) { const e = sx(t) - x; if (Math.abs(e) < 1e-7) return sy(t); const d = dx(t); if (Math.abs(d) < 1e-7) break; t = Math.max(0, Math.min(1, t - e / d)); }
        let lo = 0, hi = 1; t = x;
        for (let i = 0; i < 30; i++) { const v = sx(t); if (Math.abs(v - x) < 1e-7) break; if (x > v) lo = t; else hi = t; t = (lo + hi) / 2; }
        return sy(t);
    };
    // A fixed 17-point approximation visibly flattened steep handles and
    // vertical overshoot (up to 0.057 normalized error). Subdivide only where
    // the curve departs from its local chord, with a bounded depth of 7
    // (128 segments maximum) and a 0.0005 normalized midpoint error target.
    const points = [{ x: 0, y: 0 }];
    const refine = (x0, y0, x1, y1, depth) => {
        const fractions = [0.25, 0.5, 0.75];
        let maxError = 0;
        for (const fraction of fractions) {
            const x = x0 + (x1 - x0) * fraction;
            maxError = Math.max(maxError, Math.abs(sample(x) - (y0 + (y1 - y0) * fraction)));
        }
        if (maxError > 0.0005 && depth < 7) {
            const mid = (x0 + x1) / 2, yMid = sample(mid);
            refine(x0, y0, mid, yMid, depth + 1);
            refine(mid, yMid, x1, y1, depth + 1);
        } else points.push({ x: x1, y: y1 });
    };
    refine(0, 0, 1, 1, 0);
    return sampledEaseExpr(points, u);
}

function zoomEaseExpr(easing, u) {
    const raw = String(easing || 'linear').trim();
    const customBezier = /^cubic-bezier\(([^)]+)\)$/i.exec(raw);
    if (customBezier) {
        const p = customBezier[1].split(',').map(Number);
        if (p.length === 4 && p.every(Number.isFinite)) return cubicBezierEaseExpr(p[0], p[1], p[2], p[3], u);
    }
    const steps = /^steps\s*\(\s*(\d+)\s*(?:,\s*(jump-start|jump-end|jump-none|jump-both|start|end)\s*)?\)$/i.exec(raw);
    if (steps) {
        const count = Number(steps[1]);
        const position = (steps[2] || 'end').toLowerCase();
        const mode = position === 'start' ? 'jump-start' : position === 'end' ? 'jump-end' : position;
        if (Number.isSafeInteger(count) && count > 0 && !(position === 'jump-none' && count === 1)) {
            if (mode === 'jump-none' && count === 1) return u;
            const denominator = mode === 'jump-both' ? count + 1 : mode === 'jump-none' ? count - 1 : count;
            const offset = mode === 'jump-start' || mode === 'jump-both' ? 1 : 0;
            return `if(gte(${u},1),1,if(lte(${u},0),${mode === 'jump-start' || mode === 'jump-both' ? (1 / denominator).toFixed(6) : 0},(floor(${u}*${count})+${offset})/${denominator}))`;
        }
    }
    const springs = {
        spring: [170, 26, 1], springGentle: [120, 14, 1], springWobbly: [180, 12, 1],
        springStiff: [210, 20, 1], springSlow: [280, 60, 1], springSnappy: [400, 28, 1],
        springBouncy: [180, 12, 1], springSmooth: [200, 28.284, 1], springHeavy: [140, 25, 2],
    };
    const springAliases = { 'spring-gentle': 'springGentle', 'spring-wobbly': 'springWobbly', 'spring-stiff': 'springStiff', 'spring-slow': 'springSlow', 'spring-snappy': 'springSnappy', 'spring-bouncy': 'springBouncy', 'spring-smooth': 'springSmooth', 'spring-heavy': 'springHeavy', wobbly: 'springWobbly', snappy: 'springSnappy', bouncy: 'springBouncy', smooth: 'springSmooth', heavy: 'springHeavy' };
    const springName = springAliases[raw] || raw;
    if (springs[springName]) return springEaseExpr(...springs[springName], u);
    const springArgs = /^spring\(([^)]+)\)$/i.exec(raw);
    if (springArgs) {
        const args = springArgs[1].split(',').map(Number);
        if (args.length >= 2 && args.every(Number.isFinite)) return springEaseExpr(args[0], args[1], args[2] || 1, u);
    }
    switch (raw.toLowerCase()) {
        case 'easeoutcubic': case 'ease-out-cubic': return `(1-pow(1-${u},3))`;
        case 'easeincubic': case 'ease-in-cubic': return `pow(${u},3)`;
        case 'easeinoutcubic': case 'ease-in-out-cubic': return `if(lt(${u},0.5),4*pow(${u},3),1-pow(-2*${u}+2,3)/2)`;
        case 'easeinquart': case 'ease-in-quart': return `pow(${u},4)`;
        case 'easeoutquart': case 'ease-out-quart': return `(1-pow(1-${u},4))`;
        case 'easeinoutquart': case 'ease-in-out-quart': return `if(lt(${u},0.5),8*pow(${u},4),1-pow(-2*${u}+2,4)/2)`;
        case 'easeinsine': case 'ease-in-sine': return `(1-cos(${u}*PI/2))`;
        case 'easeoutsine': case 'ease-out-sine': return `sin(${u}*PI/2)`;
        case 'easeinoutsine': case 'ease-in-out-sine': return `-(cos(PI*${u})-1)/2`;
        case 'easeinexpo': case 'ease-in-expo': return `if(lte(${u},0),0,pow(2,10*${u}-10))`;
        case 'easeoutexpo': case 'ease-out-expo': return `if(gte(${u},1),1,1-pow(2,-10*${u}))`;
        case 'easeinoutexpo': case 'ease-in-out-expo': return `if(lte(${u},0),0,if(gte(${u},1),1,if(lt(${u},0.5),pow(2,20*${u}-10)/2,(2-pow(2,-20*${u}+10))/2)))`;
        case 'easeoutcirc': case 'ease-out-circ': return `sqrt(1-pow(${u}-1,2))`;
        case 'easeinoutcirc': case 'ease-in-out-circ': return `if(lt(${u},0.5),(1-sqrt(1-pow(2*${u},2)))/2,(sqrt(1-pow(-2*${u}+2,2))+1)/2)`;
        case 'backout': case 'back-out': case 'back': return `(1+2.70158*pow(${u}-1,3)+1.70158*pow(${u}-1,2))`;
        case 'backin': case 'back-in': case 'anticipate': return `(2.70158*pow(${u},3)-1.70158*pow(${u},2))`;
        case 'backinout': case 'back-in-out': return `if(lt(${u},0.5),(pow(2*${u},2)*(3.59490952*2*${u}-2.59490952))/2,(pow(2*${u}-2,2)*(3.59490952*(2*${u}-2)+2.59490952)+2)/2)`;
        case 'bounce': return `if(lt(${u},0.36363636),7.5625*pow(${u},2),if(lt(${u},0.72727273),7.5625*pow(${u}-0.54545455,2)+0.75,if(lt(${u},0.90909091),7.5625*pow(${u}-0.81818182,2)+0.9375,7.5625*pow(${u}-0.95454545,2)+0.984375)))`;
        case 'elastic': return `if(lte(${u},0),0,if(gte(${u},1),1,pow(2,-10*${u})*sin((${u}-0.1)*5*PI)+1))`;
        case 'easein': case 'ease-in': return `(${u}*${u})`;
        case 'easeout': case 'ease-out': return `(${u}*(2-${u}))`;
        case 'ease': case 'easeinout': case 'ease-in-out': return `if(lt(${u},0.5),2*${u}*${u},-1+(4-2*${u})*${u})`;
        case 'stepstart': case 'step-start': return `if(gte(${u},1),1,1)`;
        case 'stepend': case 'step-end': case 'hold': return `if(gte(${u},1),1,0)`;
        default: return u;
    }
}

/** Piecewise expression of a `[{time,value,easing}]` track over T, or null. */
function keyframeExpr(pts, T, digits = 4) {
    if (!pts.length) return null;
    if (pts.length === 1) return pts[0].v.toFixed(digits);
    let e = pts[pts.length - 1].v.toFixed(digits);
    for (let i = pts.length - 2; i >= 0; i--) {
        const a = pts[i], b = pts[i + 1];
        const span = b.t - a.t;
        const seg = span > 0.001
            ? `(${a.v.toFixed(digits)}+(${(b.v - a.v).toFixed(digits)})*${zoomEaseExpr(b.e, `((${T}-${a.t.toFixed(3)})/${span.toFixed(3)})`)})`
            : b.v.toFixed(digits);
        e = `if(lt(${T},${b.t.toFixed(3)}),${seg},${e})`;
    }
    return `if(lt(${T},${pts[0].t.toFixed(3)}),${pts[0].v.toFixed(digits)},${e})`;
}

function buildSmoothZoomFilter(kfs, { fps = 30, anchor = { mode: 'fixed', x: 0.5, y: 0.28 }, multiplier = 1, minZoom = 1.0, maxZoom = 2.0, panX = null, panY = null, scaleXKfs = null, scaleYKfs = null, positionX = null, positionY = null, width = 1, height = 1 } = {}) {
    const clean = (arr, map) => (arr || [])
        .filter(k => k && Number.isFinite(Number(k.time)) && Number.isFinite(Number(k.value)))
        .map(k => ({ t: Math.max(0, Number(k.time)), v: map(Number(k.value)), e: k.easing }))
        .sort((a, b) => a.t - b.t);
    const pts = clean(kfs, v => Math.min(maxZoom, Math.max(minZoom, v * multiplier)));
    // Independent axis tracks are relative multipliers. Keep the established
    // uniform track as each axis' fallback so existing camera moves are byte-
    // for-byte equivalent, while X/Y keyframes can shape a deliberate stretch.
    const xPts = clean(scaleXKfs || kfs, v => Math.min(maxZoom, Math.max(minZoom, v * multiplier)));
    const yPts = clean(scaleYKfs || kfs, v => Math.min(maxZoom, Math.max(minZoom, v * multiplier)));
    // Camera pan (shake / whip / pan), fraction of the frame: the picture
    // moves right by panX × width. Fed by CameraMotionCompiler.
    const px = clean(panX, v => Math.max(-0.5, Math.min(0.5, v)));
    const py = clean(panY, v => Math.max(-0.5, Math.min(0.5, v)));
    // Clip transform keyframes store pixel offsets; perspective pan expects a
    // frame fraction. Keep them as a separate expression so camera-pan tracks
    // can coexist with manually animated X/Y position.
    const tx = clean(positionX, v => Math.max(-0.5, Math.min(0.5, v / Math.max(1, width))));
    const ty = clean(positionY, v => Math.max(-0.5, Math.min(0.5, v / Math.max(1, height))));
    const pans = [...px, ...py, ...tx, ...ty].some(p => Math.abs(p.v) > 1e-4);
    if (!pts.length && !xPts.length && !yPts.length && !pans) return null;
    if (!pans && ![...pts, ...xPts, ...yPts].some(p => p.v > 1.0005)) return null; // never zoomed in: nothing to draw

    const T = `(in/${fps})`;
    const z = keyframeExpr(pts, T) || '1';
    const zx = keyframeExpr(scaleXKfs ? xPts : pts, T) || z;
    const zy = keyframeExpr(scaleYKfs ? yPts : pts, T) || z;
    const dxParts = [keyframeExpr(px, T, 5), keyframeExpr(tx, T, 5)].filter(Boolean);
    const dyParts = [keyframeExpr(py, T, 5), keyframeExpr(ty, T, 5)].filter(Boolean);
    const dx = dxParts.length ? `(${dxParts.join('+')})` : null;
    const dy = dyParts.length ? `(${dyParts.join('+')})` : null;

    const ax = Math.max(0, Math.min(1, Number(anchor?.x ?? 0.5)));
    const ay = Math.max(0, Math.min(1, Number(anchor?.y ?? 0.28)));
    let L, Tp;
    if (anchor?.mode === 'center') {
        L  = `clip(W*${ax.toFixed(4)}-W/(2*(${zx})),0,W-W/(${zx}))`;
        Tp = `clip(H*${ay.toFixed(4)}-H/(2*(${zy})),0,H-H/(${zy}))`;
    } else {
        L  = `(W*${ax.toFixed(4)}*(1-1/(${zx})))`;
        Tp = `(H*${ay.toFixed(4)}*(1-1/(${zy})))`;
    }
    // Moving the picture right by dx·W = moving the sampled window left.
    if (dx) L  = `(${L}-(${dx})*W/(${zx}))`;
    if (dy) Tp = `(${Tp}-(${dy})*H/(${zy}))`;
    const R = `(${L}+W/(${zx}))`;
    const B = `(${Tp}+H/(${zy}))`;
    return `fps=${fps},perspective=x0='${L}':y0='${Tp}':x1='${R}':y1='${Tp}':x2='${L}':y2='${B}':x3='${R}':y3='${B}':interpolation=linear:eval=frame`;
}

/**
 * R67 — Object Intelligence Integration, "blur background" export path.
 *
 * This is a genuinely NEW render primitive, unlike zoom/track/animate
 * speaker (which reuse the existing `clip.virtualCam` crop pipeline
 * unchanged — see client/src/motion/ObjectLayers.js's header for why).
 * Nothing in this codebase has ever composited two video sources with an
 * alpha mask before (confirmed by ADR-001's audit before this was written).
 *
 * DELIBERATE SCOPE LIMIT, stated plainly per this project's convention
 * (see CameraMotionCompiler.js's translate-preset scope note for the
 * precedent): a clip using `layerTarget: 'background'` renders through
 * THIS function instead of the main per-clip pipeline above, which means
 * rotation-correction, `virtualCam` crop, and zoom-rhythm keyframes on the
 * SAME clip are not composed with the blur here — layerTarget is set by
 * `setLayerTarget`/`zoomToSpeaker` as mutually-exclusive choices in the
 * store today, so this has not come up in practice, but if a future clip
 * genuinely needs both, this function is the one to extend.
 *
 * Filter graph (fluent-ffmpeg complexFilter, two inputs — source + mask):
 *   [0:v] scale to output dims                                  → [base]
 *   [1:v] scale mask to output dims (nearest-neighbor edges         )
 *                                                                → [maskscaled]
 *   [base] boxblur (background blur amount)                     → [blurred]
 *   [base][maskscaled] alphamerge (mask's luma → base's alpha)  → [fg]
 *   [blurred][fg] overlay                                       → [outv]
 * `alphamerge` is the standard FFmpeg primitive for "use this second video's
 * luma as this first video's alpha channel" — exactly matte-video compositing,
 * which is what a SAM2 "highlighted" mask output already is.
 */
async function downloadUrlToFile(url, localPath) {
    const response = await axios.get(url, { responseType: 'stream', timeout: 120_000 });
    await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(localPath);
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
        response.data.on('error', reject);
    });
    return localPath;
}

// Browser blob URLs cannot be fetched by the export worker and can outlive
// their source File in persisted scene templates. Always resolve exports from
// durable URLs or the project asset manifest.
const isEphemeralBlobUrl = value => typeof value === 'string' && /^blob:/i.test(value);
const firstDurableAssetUrl = (...values) => values.find(value =>
    typeof value === 'string' && value.length > 0 && !isEphemeralBlobUrl(value)
) || null;

/**
 * R69 — resolve this backend's own public URL, for handing to the render-worker
 * so it can fetch `/uploads/...`-relative assets. SAME resolution order the
 * internal-proxy-download fallback already uses a few dozen lines below
 * (PUBLIC_URL → RAILWAY_PUBLIC_DOMAIN → localhost) — reused here rather than
 * re-derived, so the two can never silently disagree about what "this server"
 * means.
 */
function resolvePublicBackendUrl() {
    return process.env.PUBLIC_URL
        || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null)
        || `http://localhost:${process.env.PORT || 3000}`;
}

/**
 * R69 — call the self-hosted (non-Lambda) Revideo render-worker (render-worker/,
 * deployed to Fly.io) to composite captions/motion-graphics/stickers on top of
 * an already-cut, already-graded, already-audio-mixed base video. Streams the
 * resulting MP4 to `outputPath`.
 *
 * Deliberately a single request/response call, not a queued job — the worker
 * itself is the concurrency boundary (see CLAUDE.md: without Lambda's elastic
 * scaling, this is one fixed-capacity renderer, sized by RENDER_WORKER_URL's
 * own machine). A future high-concurrency mode would swap this call for the
 * dormant `render-lambda/` path instead of changing anything here.
 *
 * @throws on any failure — caller is responsible for the fails-open fallback.
 */
/**
 * R92: is the render-worker up? GET /health with a short timeout. Any error
 * or non-2xx means "no", so the caller falls back to the built-in renderer.
 */
async function revideoWorkerHealthy() {
    const workerUrl = process.env.RENDER_WORKER_URL;
    if (!workerUrl) return false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(process.env.REVIDEO_HEALTH_TIMEOUT_MS) || 5000);
    try {
        const res = await fetch(`${workerUrl.replace(/\/$/, '')}/health`, { signal: controller.signal });
        return res.ok;
    } catch (err) {
        console.warn(`[exportProcessor] render-worker health check failed: ${err.message}`);
        return false;
    } finally {
        clearTimeout(timer);
    }
}

async function renderViaRevideoWorker({ baseVideoUrl, tracks, duration, aspectRatio, fps, backendUrl, audioWaveformsByAsset, outputPath }) {
    const workerUrl    = process.env.RENDER_WORKER_URL;
    const workerSecret = process.env.WORKER_SECRET;
    if (!workerUrl) throw new Error('RENDER_WORKER_URL is not configured');

    const controller  = new AbortController();
    const timeoutMs   = Number(process.env.REVIDEO_RENDER_TIMEOUT_MS) || 6 * 60 * 1000; // 6 min — matches other long-render timeouts in this codebase
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(`${workerUrl.replace(/\/$/, '')}/render`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(workerSecret ? { Authorization: workerSecret } : {}),
            },
            body: JSON.stringify({ baseVideoUrl, tracks, duration, aspectRatio, fps, backendUrl, audioWaveformsByAsset }),
            signal: controller.signal,
        });

        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw new Error(`render-worker responded ${res.status}: ${errText.slice(0, 300)}`);
        }

        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length === 0) throw new Error('render-worker returned an empty response');
        fs.writeFileSync(outputPath, buffer);
        return outputPath;
    } finally {
        clearTimeout(timeoutHandle);
    }
}

/**
 * R92: copy a clip's background mask to a local file. Prefers the stored
 * path (no expiring link), then the link saved on the clip.
 */
async function fetchMaskToLocal(layerMask, localPath) {
    const p = String(layerMask?.maskAssetPath || '');
    if (p.startsWith('local:')) {
        fs.copyFileSync(path.join(__dirname, '..', 'uploads', p.slice(6)), localPath);
        return localPath;
    }
    if (p && storageConfig.bucket) {
        await storageConfig.bucket.file(p).download({ destination: localPath });
        return localPath;
    }
    if (layerMask?.maskAssetUrl) return downloadUrlToFile(layerMask.maskAssetUrl, localPath);
    throw new Error('the clip has no stored mask');
}

let matteSettingsPromise = null;
function loadMatteSettings() {
    if (!matteSettingsPromise) {
        const { pathToFileURL } = require('url');
        matteSettingsPromise = import(pathToFileURL(path.join(__dirname, '..', 'client', 'src', 'motion', 'MatteSettings.js')).href);
    }
    return matteSettingsPromise;
}

// R99 — freeform zone blur. Same dynamic-import trick as loadMatteSettings
// above: client/src/motion/ZoneBlur.js is a pure ESM module with no DOM/
// network dependency, so Node can import() it directly rather than this
// file reimplementing the crop/blur/overlay-back filter graph math.
let zoneBlurPromise = null;
function loadZoneBlur() {
    if (!zoneBlurPromise) {
        const { pathToFileURL } = require('url');
        zoneBlurPromise = import(pathToFileURL(path.join(__dirname, '..', 'client', 'src', 'motion', 'ZoneBlur.js')).href);
    }
    return zoneBlurPromise;
}

let depthCompositorPromise = null;
function loadDepthCompositor() {
    if (!depthCompositorPromise) {
        const { pathToFileURL } = require('url');
        depthCompositorPromise = import(pathToFileURL(path.join(__dirname, '..', 'client', 'src', 'motion', 'DepthCompositor.js')).href);
    }
    return depthCompositorPromise;
}

/**
 * R92: render one clip with its background removed (blur, dim, colour or
 * image). Same filter graph builder as the preview's settings
 * (client/src/motion/MatteSettings.js). The mask is read from
 * (offset - mask.sourceStart), so trimmed clips stay in sync, and clip speed
 * is applied to the picture, the mask and the audio together.
 */
async function renderMattedSegment(clip, src, segPath, opts) {
    const { targetWidth, targetHeight, targetFps, codec, profile, audioBitrate, maskLocalPath, bgImagePath, sandwichFilter, sandwichInput, clipLutFilters = new Map() } = opts;
    const { matteFilterGraph, normalizeMatte } = await loadMatteSettings();
    const settings = normalizeMatte(clip.layerMask?.settings);
    if (settings.mode === 'image' && !bgImagePath) settings.mode = 'blur';
    const speed = Number(clip.speed) > 0 ? Number(clip.speed) : 1;
    const windowedAudioEffects = hasPartialTimelineAudioEffects(clip.effects, Number(clip.start) || 0, Number(clip.duration) || 0);
    const offset = Number(clip.offset) || 0;
    const readDur = (Number(clip.duration) || 0) * speed;
    const maskSeek = Math.max(0, offset - (Number(clip.layerMask?.sourceStart) || 0));
    const visualEffects = compileTimelineVisualEffects(clip.effects, {
        width: targetWidth, height: targetHeight, duration: Number(clip.duration) || 5, clipStart: Number(clip.start) || 0, complexGlow: true, clipLutFilters,
    });
    if (clip.effectGraph) visualEffects.unshift(`__VIBED_EFFECT_DAG__${JSON.stringify({
        graph: clip.effectGraph,
        options: { width: targetWidth, height: targetHeight, duration: Number(clip.duration) || 5, clipStart: Number(clip.start) || 0, complexGlow: true, clipLutFilters },
    })}`);
    const hasComplexGlow = visualEffects.some(filter => String(filter).startsWith('__VIBED_HIGHLIGHT_GLOW__'));
    const hasComplexLut = visualEffects.some(filter => String(filter).startsWith('__VIBED_LUT__'));
    const hasComplexShake = visualEffects.some(filter => String(filter).startsWith('__VIBED_SHAKE__'));
    const graph = matteFilterGraph(settings, {
        width: targetWidth,
        height: targetHeight,
        speed,
        duration: Number(clip.duration) || 5,
        sandwichFilter: sandwichFilter || null,
        outputFilter: hasComplexGlow || hasComplexLut || hasComplexShake || !!clip.effectGraph ? null : visualEffects.join(','),
        outputGraph: hasComplexGlow || hasComplexLut || hasComplexShake || !!clip.effectGraph ? compileTimelineVisualEffectGraph(visualEffects, { input: 'outbase', output: 'outv' }) : null,
        crop: clip.virtualCam ? { x: clip.virtualCam.cropX, y: clip.virtualCam.cropY, w: clip.virtualCam.cropW, h: clip.virtualCam.cropH } : null,
        transform: { scale: Number(clip.scale) > 0 ? Number(clip.scale) : 1, x: Number(clip.x) || 0, y: Number(clip.y) || 0 },
    });
    return new Promise((resolve, reject) => {
        const cmd = ffmpeg()
            .input(src).setStartTime(offset).setDuration(readDur)
            .input(maskLocalPath).inputOptions(['-ss', maskSeek.toFixed(3)]);
        if (settings.mode === 'image') cmd.input(bgImagePath).inputOptions(['-loop', '1']);
        if (sandwichInput && sandwichInput.path) {
            cmd.input(sandwichInput.path).inputOptions(sandwichInput.options || []);
        }
        cmd.complexFilter(graph, 'outv');
        const vol = (clip.volume ?? 1.0) * (clip.trackVolume ?? 1.0);
        const af = [];
        if (speed !== 1) {
            if (clip.speedChangeMaintainPitch === false) af.push(`asetrate=44100*${speed.toFixed(4)}`, 'aresample=44100');
            else af.push(...atempoChain(speed));
        }
        if (vol !== 1.0) af.push(`volume=${vol.toFixed(4)}`);
        if (!windowedAudioEffects) af.push(...compileTimelineAudioEffects(clip.effects));
        if (af.length) cmd.audioFilters(af);
        cmd
            .fps(targetFps)
            .videoCodec(codec)
            .addOutputOption('-map', '0:a?')
            .addOutputOption('-profile:v', profile)
            .addOutputOption('-pix_fmt', 'yuv420p')
            .addOutputOption('-movflags', '+faststart')
            .addOutputOption('-t', String(Number(clip.duration) || 0))
            .audioBitrate(audioBitrate)
            .output(segPath)
            .on('end', async () => {
                try {
                    if (windowedAudioEffects) await applyWindowedTimelineAudioEffectsToFile(segPath, {
                        effects: clip.effects, clipStart: Number(clip.start) || 0,
                        duration: Number(clip.duration) || 0, bitrate: audioBitrate, hasVideo: true,
                    });
                    resolve();
                } catch (error) { reject(error); }
            })
            .on('error', reject)
            .run();
    });
}

function renderBackgroundBlurSegment(clip, src, segPath, opts) {
    const { targetWidth, targetHeight, targetFps, codec, profile, audioBitrate, maskLocalPath, blurAmount = 20 } = opts;
    return new Promise((resolve, reject) => {
        const cmd = ffmpeg()
            .input(src)
            .setStartTime(clip.offset || 0)
            .setDuration(clip.duration)
            .input(maskLocalPath);

        cmd.complexFilter([
            `[0:v]scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase,crop=${targetWidth}:${targetHeight}[base]`,
            `[1:v]scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase,crop=${targetWidth}:${targetHeight}[maskscaled]`,
            `[base]boxblur=${blurAmount}:2[blurred]`,
            `[base][maskscaled]alphamerge[fg]`,
            `[blurred][fg]overlay=shortest=1[outv]`,
        ], 'outv');

        const vol = (clip.volume ?? 1.0) * (clip.trackVolume ?? 1.0);
        if (vol !== 1.0) cmd.audioFilters(`volume=${vol.toFixed(4)}`);

        cmd
            .fps(targetFps)
            .videoCodec(codec)
            .addOutputOption('-profile:v', profile)
            .addOutputOption('-pix_fmt', 'yuv420p')
            .addOutputOption('-movflags', '+faststart')
            .addOutputOption('-shortest')
            .audioBitrate(audioBitrate)
            .output(segPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
    });
}

/**
 * Probe a video file and return its stored rotation in degrees (0, 90, 180, 270).
 * Phone-recorded portrait videos are often stored as landscape with a rotate=90
 * metadata tag. We need to correct for this before applying the scale filter,
 * otherwise the dimensions are swapped and the video ends up tiny with black bars.
 */
/**
 * Rotation (0/90/180/270, clockwise) from one ffprobe video stream, in any of
 * the three shapes it can arrive in:
 *   - `stream.rotation`        fluent-ffmpeg's parser flattens the Display
 *                              Matrix side data onto the stream (ffprobe >= 5).
 *                              This is what a modern iPhone .MOV reports, and
 *                              the one the old code never read: every phone
 *                              portrait clip probed as 0.
 *   - `stream.side_data_list`  ffprobe's own JSON output.
 *   - `stream.tags.rotate`     ffmpeg <= 4.
 * ffprobe reports the matrix as a negative angle (-90 = 90 deg clockwise).
 */
function rotationFromProbeStream(vStream) {
    if (!vStream) return 0;
    const norm = (deg) => ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
    const has = (v) => v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v));
    const sd = (Array.isArray(vStream.side_data_list) ? vStream.side_data_list : []).find(d => d && has(d.rotation));
    if (sd) return norm(-Number(sd.rotation));
    if (has(vStream.rotation)) return norm(-Number(vStream.rotation));
    const tag = parseInt(vStream?.tags?.rotate || 0, 10);
    return Number.isFinite(tag) ? norm(tag) : 0;
}

function getVideoRotation(filePath) {
    return new Promise((resolve) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) { resolve(0); return; }
            const vStream = (metadata?.streams || []).find(s => s.codec_type === 'video');
            resolve(rotationFromProbeStream(vStream));
        });
    });
}

/**
 * Probe a video file's width/height as stored. Used to report the RENDERED
 * size of the finished export (metadata.resolution). Returns null on any
 * probe failure.
 */
/**
 * The audio-mix filtergraph: the base's own audio (when it has any) plus one
 * delayed segment per audio clip.
 *
 * Pure and exported so the two cases can be pinned by a test. The silent-base
 * case is not a nicety: `[0:a]` against an input with no audio stream makes
 * ffmpeg refuse the WHOLE graph ("Stream specifier ':a' matches no streams" /
 * "Error binding filtergraph inputs/outputs: Invalid argument") and the entire
 * export fails. It stayed hidden for as long as it did because every bundled
 * sound effect was dropped before reaching this step, so with no segments the
 * mix never ran at all.
 *
 * @param {Array<{path:string, startTime:number}>} segments
 * @param {boolean} baseHasAudio
 * @returns {string}
 */
function buildAudioMixGraph(segments, baseHasAudio) {
    const ms = (t) => Math.round((Number(t) || 0) * 1000);
    const delayed = segments.map((seg, i) => `[${i + 1}:a]adelay=${ms(seg.startTime)}|${ms(seg.startTime)}[da${i}]`).join(';');
    const labels = segments.map((_, i) => `[da${i}]`).join('');
    return baseHasAudio
        // `duration=first` is the base's own audio length, so a sound effect
        // landing near the end can never extend the video.
        ? `[0:a]volume=1[va];${delayed};[va]${labels}amix=inputs=${1 + segments.length}:duration=first:dropout_transition=0[aout]`
        // Nothing to anchor to, so the mix is the segments alone; the copied
        // video stream still governs the container's length.
        : `${delayed};${labels}amix=inputs=${segments.length}:duration=longest:dropout_transition=0[aout]`;
}

function hasAudioStream(filePath) {
    return new Promise((resolve) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) { resolve(false); return; }
            resolve((metadata?.streams || []).some(s => s.codec_type === 'audio'));
        });
    });
}

function getVideoDimensions(filePath) {
    return new Promise((resolve) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) { resolve(null); return; }
            const vStream = (metadata?.streams || []).find(s => s.codec_type === 'video');
            if (!vStream?.width || !vStream?.height) { resolve(null); return; }
            resolve({ width: vStream.width, height: vStream.height });
        });
    });
}

/**
 * Download a Google Font TTF to `destPath` if it isn't already present.
 * Uses the legacy CSS1 API (old browser UA) so the response contains TTF URLs.
 */
// ── Font registry ─────────────────────────────────────────────────────────────
// Maps every font offered in TextPanel.jsx + ReasoningPanel.jsx to a local
// filename + jsDelivr download spec (@fontsource v4 packages include TTF files).
// jsDelivr: reliable CDN, no auth, no UA tricks, no rate limits.
// URL pattern: https://cdn.jsdelivr.net/npm/@fontsource/{slug}@4/files/{slug}-{subset}-{weight}-normal.ttf
const FONT_SPECS = {
    // Talking Head
    'Anton':              { file: 'Anton-Regular.ttf',             slug: 'anton',              weight: 400, subset: 'latin' },
    'Bebas Neue':         { file: 'BebasNeue-Regular.ttf',         slug: 'bebas-neue',         weight: 400, subset: 'latin' },
    'Montserrat':         { file: 'Montserrat-Bold.ttf',           slug: 'montserrat',         weight: 800, subset: 'latin' },
    'Inter':              { file: 'Inter-Regular.ttf',             slug: 'inter',              weight: 400, subset: 'latin' },
    'Barlow Condensed':   { file: 'BarlowCondensed-Bold.ttf',      slug: 'barlow-condensed',   weight: 700, subset: 'latin' },
    // Podcast / Doc
    'Playfair Display':   { file: 'PlayfairDisplay-Regular.ttf',   slug: 'playfair-display',   weight: 400, subset: 'latin' },
    'Lora':               { file: 'Lora-Regular.ttf',              slug: 'lora',               weight: 400, subset: 'latin' },
    'Merriweather':       { file: 'Merriweather-Regular.ttf',      slug: 'merriweather',       weight: 400, subset: 'latin' },
    'DM Serif Display':   { file: 'DMSerifDisplay-Regular.ttf',    slug: 'dm-serif-display',   weight: 400, subset: 'latin' },
    'Cormorant Garamond': { file: 'CormorantGaramond-Regular.ttf', slug: 'cormorant-garamond', weight: 400, subset: 'latin' },
    // Lifestyle / Vlog
    'Nunito':             { file: 'Nunito-Regular.ttf',            slug: 'nunito',             weight: 400, subset: 'latin' },
    'Poppins':            { file: 'Poppins-Regular.ttf',           slug: 'poppins',            weight: 400, subset: 'latin' },
    'Quicksand':          { file: 'Quicksand-Regular.ttf',         slug: 'quicksand',          weight: 400, subset: 'latin' },
    'Josefin Sans':       { file: 'JosefinSans-Regular.ttf',       slug: 'josefin-sans',       weight: 400, subset: 'latin' },
    'Raleway':            { file: 'Raleway-Regular.ttf',           slug: 'raleway',            weight: 400, subset: 'latin' },
    // Gaming / Tech
    'Rajdhani':           { file: 'Rajdhani-Regular.ttf',          slug: 'rajdhani',           weight: 400, subset: 'latin' },
    'Exo 2':              { file: 'Exo2-Regular.ttf',              slug: 'exo-2',              weight: 400, subset: 'latin' },
    'Orbitron':           { file: 'Orbitron-Regular.ttf',          slug: 'orbitron',           weight: 400, subset: 'latin' },
    'Oxanium':            { file: 'Oxanium-Regular.ttf',           slug: 'oxanium',            weight: 400, subset: 'latin' },
    'Roboto Condensed':   { file: 'RobotoCondensed-Regular.ttf',   slug: 'roboto-condensed',   weight: 400, subset: 'latin' },
    // Motivational
    'Oswald':             { file: 'Oswald-Regular.ttf',            slug: 'oswald',             weight: 400, subset: 'latin' },
    'Teko':               { file: 'Teko-Regular.ttf',              slug: 'teko',               weight: 400, subset: 'latin' },
    'Black Han Sans':     { file: 'BlackHanSans-Regular.ttf',      slug: 'black-han-sans',     weight: 400, subset: 'latin' },
    'Saira Condensed':    { file: 'SairaCondensed-Regular.ttf',    slug: 'saira-condensed',    weight: 400, subset: 'latin' },
    'Cabin':              { file: 'Cabin-Regular.ttf',             slug: 'cabin',              weight: 400, subset: 'latin' },
    // Handwritten
    'Caveat':             { file: 'Caveat-Regular.ttf',            slug: 'caveat',             weight: 400, subset: 'latin' },
    'Pacifico':           { file: 'Pacifico-Regular.ttf',          slug: 'pacifico',           weight: 400, subset: 'latin' },
    'Kalam':              { file: 'Kalam-Regular.ttf',             slug: 'kalam',              weight: 400, subset: 'latin' },
    'Satisfy':            { file: 'Satisfy-Regular.ttf',           slug: 'satisfy',            weight: 400, subset: 'latin' },
    'Dancing Script':     { file: 'DancingScript-Regular.ttf',     slug: 'dancing-script',     weight: 400, subset: 'latin' },
    // Neon / Glow
    'Boogaloo':           { file: 'Boogaloo-Regular.ttf',          slug: 'boogaloo',           weight: 400, subset: 'latin' },
    'Righteous':          { file: 'Righteous-Regular.ttf',         slug: 'righteous',          weight: 400, subset: 'latin' },
    'Press Start 2P':     { file: 'PressStart2P-Regular.ttf',      slug: 'press-start-2p',     weight: 400, subset: 'latin' },
    'Audiowide':          { file: 'Audiowide-Regular.ttf',         slug: 'audiowide',          weight: 400, subset: 'latin' },
    // Caption style picker extras (CaptionStylesCard)
    'DM Sans':            { file: 'DMSans-Regular.ttf',            slug: 'dm-sans',            weight: 400, subset: 'latin' },
    'Unbounded':          { file: 'Unbounded-Regular.ttf',         slug: 'unbounded',          weight: 400, subset: 'latin' },
    'JetBrains Mono':     { file: 'JetBrainsMono-Regular.ttf',     slug: 'jetbrains-mono',     weight: 400, subset: 'latin' },
    'Bootzy TM':          { file: 'BootzyTM.ttf',                  slug: 'bootzy-tm',          weight: 400, subset: 'latin' },
};

/**
 * Download a font TTF to `destPath` if not already present.
 *
 * All fonts in FONT_SPECS are committed as real .ttf files directly in
 * client/public/fonts/ (see CLAUDE.md EXT2 + the Dockerfile's font-presence
 * check), so in practice this function's existsSync guard below returns
 * immediately and nothing past it ever runs. It only matters as a defensive
 * fallback if someone adds a new font to FONT_SPECS without committing its
 * file first.
 *
 * HISTORY: this used to try jsDelivr's @fontsource npm package path
 * (`/npm/@fontsource/{slug}@4/files/{slug}-{subset}-{weight}-normal.ttf`)
 * first. That path is fundamentally broken and was removed — @fontsource v4
 * packages only ever published .woff/.woff2, never .ttf, so that request
 * 404'd on literally every call, silently wasting up to ~40s (two attempts:
 * declared subset + 'all', 20s timeout each) before falling through to the
 * fallback below. This was the actual root cause of captions "always falling
 * back to the presaved font" — the primary path could never succeed for any
 * font, in any environment. See utils/waveformPath.js-style lesson: verify a
 * dependency's file layout before writing a URL against it.
 *
 * Remaining fallback: Google Fonts CSS1 API with legacy UA (returns TTF for
 * old browsers). Undocumented and fragile, but it's the only remaining path
 * that has actually been observed to return a real TTF. Does NOT use
 * encodeURIComponent on the full name — encodes the space as '+' and passes
 * weight as ':700' (not '%3A700') so the API parses it.
 */
async function downloadFont(destPath, spec) {
    if (fs.existsSync(destPath) && fs.statSync(destPath).size > 5_000) return;
    const { weight } = spec;

    // ── Fallback: Google Fonts CSS1 API (legacy TTF endpoint) ────────────────
    // Encode space as '+', weight as ':700' (NOT %3A700 — that breaks the API).
    const familyParam = spec.file
        .replace(/-.*/, '')                         // strip weight/style suffix
        .replace(/([a-z])([A-Z])/g, '$1 $2')       // CamelCase → words
        .replace(/ /g, '+');                        // spaces → +
    const weightSuffix = weight !== 400 ? `:${weight}` : '';
    const cssUrl = `https://fonts.googleapis.com/css?family=${familyParam}${weightSuffix}`;
    try {
        const cssRes = await axios.get(cssUrl, {
            headers: { 'User-Agent': 'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)' },
            timeout: 15_000,
        });
        const match = (cssRes.data || '').match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.ttf)\)/);
        if (match) {
            const response = await axios({ url: match[1], method: 'GET', responseType: 'stream', timeout: 30_000 });
            await new Promise((resolve, reject) => {
                const writer = fs.createWriteStream(destPath);
                response.data.pipe(writer);
                writer.on('finish', resolve);
                writer.on('error', reject);
            });
            if (fs.existsSync(destPath) && fs.statSync(destPath).size > 5_000) {
                console.log(`[fonts] ✓ ${path.basename(destPath)} (Google Fonts fallback)`);
                return;
            }
        }
    } catch { /* silent */ }

    console.warn(`[fonts] ✗ Could not download ${path.basename(destPath)} — will use fallback font`);
}

const PLATFORM_PRESETS = {
    tiktok:  { label: 'TikTok',             width: 1080, height: 1920, fps: 30,  bitrate: '6000k', audioBitrate: '128k', codec: 'libx264', profile: 'high', level: '4.0' },
    youtube: { label: 'YouTube',             width: 1920, height: 1080, fps: 30,  bitrate: '8000k', audioBitrate: '192k', codec: 'libx264', profile: 'high', level: '4.2' },
    reels:   { label: 'Instagram Reels',     width: 1080, height: 1920, fps: 30,  bitrate: '5500k', audioBitrate: '128k', codec: 'libx264', profile: 'high', level: '4.0' },
    shorts:  { label: 'YouTube Shorts',      width: 1080, height: 1920, fps: 60,  bitrate: '6000k', audioBitrate: '192k', codec: 'libx264', profile: 'high', level: '4.1' },
};

const RESOLUTION_PRESETS = {
    '720p':  { width: 1280, height: 720,  bitrate: '4000k' },
    '1080p': { width: 1920, height: 1080, bitrate: '8000k' },
    '2k':    { width: 2560, height: 1440, bitrate: '16000k' },
    '4k':    { width: 3840, height: 2160, bitrate: '35000k' },
};

// ── Aspect-ratio reference dimensions ───────────────────────────────────────
// MUST mirror client/src/utils/playerDimensions.js's getPlayerDimensions()
// exactly — that table is what `project.settings.shared.size` gets synced to
// for the live `<Player>`, what `clip.fontSize` is authored against (a raw
// pixel value in THIS coordinate space), and what TextOverlay.jsx's
// `previewScale` divides by. Every RESOLUTION_PRESETS width below is that
// same table's 16:9 width at each quality tier (1280/1920/2560/3840) — no
// coincidence, `getResolutionDimensions()` below derives every OTHER aspect
// ratio's dimensions the same way, so 16:9 exports are byte-identical to
// before this fix and every other aspect ratio finally matches too.
//
// THE BUG THIS FIXES: `targetWidth`/`targetHeight` (below) used to come
// ONLY from RESOLUTION_PRESETS/PLATFORM_PRESETS — both blind to the
// project's actual aspect ratio unless the user happens to pick a platform
// preset (tiktok/reels/shorts) that matches it. A 9:16 project exported at
// the default '1080p' resolution (no platform selected) rendered at
// 1920x1080 — LANDSCAPE — while the editor's reference resolution for that
// same project was 1080x1920 PORTRAIT. `clip.fontSize` is an absolute pixel
// value in that reference space, so every caption came out roughly 1.78x
// off from what the editor showed, on top of the video itself being
// letterboxed into the wrong orientation. This is the actual cause of
// "caption size doesn't match the editor" that survived the earlier
// TextOverlay.jsx previewScale fix — that fix made the editor correctly
// show fontSize against ITS reference resolution; it could never have fixed
// the export using a DIFFERENT, aspect-ratio-blind one.
const ASPECT_RATIO_DIMENSIONS = {
    '9:16': { width: 1080, height: 1920 },
    '1:1':  { width: 1080, height: 1080 },
    '4:3':  { width: 1440, height: 1080 },
    '4:5':  { width: 1080, height: 1350 },
    '21:9': { width: 2560, height: 1080 },
    '16:9': { width: 1920, height: 1080 },
};

/**
 * Derive target export dimensions for a resolution TIER ('720p'/'1080p'/
 * '2k'/'4k') at a given aspect ratio, by scaling ASPECT_RATIO_DIMENSIONS'
 * 1080p-tier numbers to that tier's long edge — the same numbers
 * RESOLUTION_PRESETS already uses for 16:9, so 16:9 output is unchanged.
 * Falls back to the plain 16:9 RESOLUTION_PRESETS entry for an unrecognized
 * aspect ratio rather than throwing — an export must never fail over this.
 */
function getResolutionDimensions(aspectRatio, tier) {
    const resPreset = RESOLUTION_PRESETS[tier] || RESOLUTION_PRESETS['1080p'];
    const ref = ASPECT_RATIO_DIMENSIONS[aspectRatio];
    if (!ref) return { width: resPreset.width, height: resPreset.height };
    const scale = resPreset.width / ASPECT_RATIO_DIMENSIONS['16:9'].width;
    // FFmpeg's yuv420p output requires even width/height.
    const roundEven = (n) => Math.round(n * scale / 2) * 2;
    return { width: roundEven(ref.width), height: roundEven(ref.height) };
}

/** FFmpeg equivalents for the CSS effects used by the editor's timeline shelf. */
function compileEffectKeyframeExpression(effect, parameter, fallback, min, max, clipStart = 0) {
    const raw = effect?.params?.[parameter];
    const sampled = effect?.samples?.[parameter];
    const input = Array.isArray(sampled) && sampled.length ? sampled : (effect?.keyframes?.[parameter] || raw?.keyframes);
    if (!Array.isArray(input) || input.length === 0) return null;
    const rawTrack = input.map((keyframe, index) => ({
        time: Number(sampled?.length ? (keyframe?.t ?? keyframe?.time) : keyframe?.time) - (sampled?.length ? 0 : (Number(clipStart) || 0)),
        value: keyframe?.value ?? keyframe?.properties?.[parameter],
        easing: String(keyframe?.easing || 'linear'), index,
    })).filter(point => Number.isFinite(point.time))
        .sort((a, b) => a.time - b.time || a.index - b.index);
    // Color/vector tracks share the same authored timing as scalar effects.
    // Compile each channel independently so FFmpeg's per-frame expressions
    // follow the same interpolation as the canvas preview.
    const vectorLength = rawTrack.find(point => Array.isArray(point.value))?.value?.length;
    if (Number.isInteger(vectorLength) && vectorLength > 0
        && rawTrack.every(point => Array.isArray(point.value) && point.value.length === vectorLength
            && point.value.every(channel => Number.isFinite(Number(channel))))) {
        return Array.from({ length: vectorLength }, (_, channel) => compileScalarEffectTrack(
            rawTrack.map(point => {
                const value = Number(point.value[channel]);
                return { ...point, value: Math.max(min, Math.min(max, value <= 1 ? value * 255 : value)) };
            }),
        ));
    }
    const track = rawTrack.filter(point => Number.isFinite(Number(point.value)))
        .map(point => ({ ...point, value: Math.max(min, Math.min(max, Number(point.value))) }));
    return compileScalarEffectTrack(track);
}

function compileScalarEffectTrack(track) {
    const unique = [];
    for (const point of track) {
        if (unique.at(-1)?.time === point.time) unique[unique.length - 1] = point;
        else unique.push(point);
    }
    if (!unique.length) return null;
    if (unique.length === 1) return String(unique[0].value);

    // FFmpeg expressions cannot call the JS easing resolver. Preserve
    // discrete step curves exactly and compile continuous curves to the same
    // analytic easing expressions used by camera motion. Sampling these
    // tracks at a fixed 24 Hz flattened fast springs and made their export
    // diverge from the frame-accurate preview.
    const stepProgress = (easing, u) => {
        const raw = String(easing || '').trim();
        const named = raw.toLowerCase().replace(/[-_\s]/g, '');
        if (named === 'stepstart') return `if(gte(${u},1),1,1)`;
        if (named === 'stepend' || named === 'hold') return `if(gte(${u},1),1,0)`;
        const match = /^steps\s*\(\s*(\d+)\s*(?:,\s*(jump-start|jump-end|jump-none|jump-both|start|end)\s*)?\)$/i.exec(raw);
        if (!match) return null;
        const count = Number(match[1]);
        const rawPosition = (match[2] || 'end').toLowerCase();
        const position = rawPosition === 'start' ? 'jump-start' : rawPosition === 'end' ? 'jump-end' : rawPosition;
        if (!Number.isSafeInteger(count) || count <= 0 || (position === 'jump-none' && count <= 1)) return null;
        const denominator = position === 'jump-both' ? count + 1 : position === 'jump-none' ? count - 1 : count;
        const offset = position === 'jump-start' || position === 'jump-both' ? 1 : 0;
        return `if(gte(${u},1),1,(floor(${u}*${count})+${offset})/${denominator})`;
    };
    let expression = unique.at(-1).value.toFixed(6);
    for (let i = unique.length - 2; i >= 0; i--) {
        const from = unique[i], to = unique[i + 1];
        const duration = Math.max(0.000001, to.time - from.time);
        const u = `clip((t-${from.time.toFixed(6)})/${duration.toFixed(6)},0,1)`;
        const stepped = stepProgress(to.easing, u);
        const progress = stepped || zoomEaseExpr(to.easing, u);
        const interpolated = `${from.value.toFixed(6)}+(${to.value.toFixed(6)}-${from.value.toFixed(6)})*(${progress})`;
        expression = `if(lt(t,${to.time.toFixed(6)}),${interpolated},${expression})`;
    }
    return expression;
}

function toFfmpegColor(value, fallback = '0x000000') {
    const toByte = channel => {
        const number = Number(channel);
        if (!Number.isFinite(number)) return 0;
        return Math.round(Math.max(0, Math.min(255, number <= 1 ? number * 255 : number)));
    };
    if (Array.isArray(value)) {
        const channels = value.slice(0, 3).map(toByte);
        while (channels.length < 3) channels.push(0);
        return `0x${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
    }
    const color = String(value ?? '').trim();
    const hex = color.match(/^#?([\da-f]{3}|[\da-f]{6})$/i)?.[1];
    if (hex) {
        const expanded = hex.length === 3 ? [...hex].map(channel => channel + channel).join('') : hex;
        return `0x${expanded}`;
    }
    const rgb = color.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*[\d.]+)?\s*\)$/i);
    if (rgb) return toFfmpegColor(rgb.slice(1, 4).map(Number), fallback);
    return color || fallback;
}

function effectParam(effect, key, fallback) {
    const value = effect?.params?.[key];
    return value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value')
        ? value.value
        : (value ?? fallback);
}

/** Attach compositor-sampled procedural parameters to their authored effect slots. */
function applyEffectSamples(clipEffects = [], sampledEffects = []) {
    const byIndex = new Map((Array.isArray(sampledEffects) ? sampledEffects : [])
        .filter(effect => Number.isInteger(effect?.sourceIndex) && effect.samples)
        .map(effect => [effect.sourceIndex, effect.samples]));
    return (Array.isArray(clipEffects) ? clipEffects : []).map((effect, index) => {
        const samples = byIndex.get(index);
        return samples ? { ...effect, samples } : effect;
    });
}

function compileTimelineAudioEffects(effects = []) {
    const filters = [];
    const ordered = (Array.isArray(effects) ? effects : [])
        .filter(effect => effect && effect.enabled !== false)
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    for (const effect of ordered) {
        const kind = effect.kind || effect.type;
        if (kind === 'audio_normalize') {
            const requested = Number(effectParam(effect, 'targetLevel', -3));
            const target = Math.max(-20, Math.min(0, Number.isFinite(requested) ? requested : -3));
            filters.push(`loudnorm=I=${target}:TP=-1.5:LRA=11`);
        } else if (kind === 'audio_denoise') {
            const amount = Math.max(0, Math.min(1, Number(effectParam(effect, 'amount', 0.5)) || 0));
            filters.push(`afftdn=nf=${(-80 + amount * 60).toFixed(1)}`);
        }
    }
    return filters;
}

function hasPartialTimelineAudioEffects(effects = [], clipStart = 0, duration = 0) {
    return (Array.isArray(effects) ? effects : []).some(effect => {
        const kind = effect?.kind || effect?.type;
        return effect && effect.enabled !== false
            && ['audio_normalize', 'audio_denoise'].includes(kind)
            && timelineEffectWindow(effect, clipStart, duration).partial;
    });
}

/** Apply audio effects to their authored clip-local windows, preserving the
 * untouched audio before and after each window. The input has already been
 * trimmed/retimed into timeline duration when this graph is used. */
function compileWindowedTimelineAudioEffects(inputLabel, effects = [], clipStart = 0, duration = 0, outputLabel = 'audio_windowed') {
    const length = Math.max(0, Number(duration) || 0);
    if (!(length > 0) || !hasPartialTimelineAudioEffects(effects, clipStart, length)) return null;
    const rows = (Array.isArray(effects) ? effects : [])
        .filter(effect => effect && effect.enabled !== false && ['audio_normalize', 'audio_denoise'].includes(effect.kind || effect.type))
        .map(effect => ({ effect, window: timelineEffectWindow(effect, clipStart, length) }))
        .filter(row => row.window.active);
    const boundaries = [...new Set([0, length, ...rows.flatMap(row => [row.window.start, row.window.end])]
        .map(value => Math.max(0, Math.min(length, Number(value))))
        .filter(Number.isFinite))].sort((a, b) => a - b);
    const intervals = boundaries.slice(0, -1).map((start, index) => ({ start, end: boundaries[index + 1] }))
        .filter(interval => interval.end - interval.start > 1e-6);
    if (!intervals.length) return null;

    const graph = [];
    const splitLabels = intervals.map((_, index) => `[audio_window_in_${index}]`);
    graph.push(`[${String(inputLabel).replace(/^\[|\]$/g, '')}]asplit=${intervals.length}${splitLabels.join('')}`);
    const outputParts = intervals.map((interval, index) => {
        const midpoint = (interval.start + interval.end) / 2;
        const activeEffects = rows.filter(row => midpoint >= row.window.start && midpoint < row.window.end).map(row => row.effect);
        const filters = compileTimelineAudioEffects(activeEffects);
        const output = `audio_window_out_${index}`;
        const chain = [
            `atrim=start=${interval.start.toFixed(6)}:end=${interval.end.toFixed(6)}`,
            'asetpts=PTS-STARTPTS',
            'aformat=sample_rates=44100:channel_layouts=stereo',
            ...filters,
        ];
        graph.push(`${splitLabels[index]}${chain.join(',')}[${output}]`);
        return `[${output}]`;
    });
    graph.push(`${outputParts.join('')}concat=n=${outputParts.length}:v=0:a=1[${String(outputLabel).replace(/^\[|\]$/g, '')}]`);
    return graph.join(';');
}

async function applyWindowedTimelineAudioEffectsToFile(filePath, { effects = [], clipStart = 0, duration = 0, bitrate = '192k', hasVideo = true } = {}) {
    if (!hasPartialTimelineAudioEffects(effects, clipStart, duration) || !(await hasAudioStream(filePath))) return false;
    const graph = compileWindowedTimelineAudioEffects('0:a', effects, clipStart, duration, 'audiofx');
    if (!graph) return false;
    const extension = path.extname(filePath) || (hasVideo ? '.mp4' : '.m4a');
    const stem = filePath.slice(0, filePath.length - path.extname(filePath).length);
    const outputPath = `${stem}.audio-window-${process.pid}-${Date.now()}${extension}`;
    await new Promise((resolve, reject) => {
        // fluent-ffmpeg treats each `complexFilter` map entry as a label and
        // wraps it in brackets. The optional input video stream is a normal
        // `-map` specifier, so add it as an output option instead of passing
        // it through the filter-output mapping API.
        const command = ffmpeg(filePath).complexFilter(graph, '[audiofx]')
            .outputOptions([
                ...(hasVideo ? ['-map', '0:v?', '-c:v', 'copy'] : []),
                '-c:a', 'aac', '-b:a', bitrate, '-t', String(Math.max(0, Number(duration) || 0)),
                ...(hasVideo ? ['-movflags', '+faststart'] : []),
            ])
            .output(outputPath)
            .on('end', resolve)
            .on('error', reject);
        command.run();
    });
    await fs.promises.rename(outputPath, filePath);
    return true;
}

function resolveTimelineSpeedEffect(effects = [], clipStart = 0, clipDuration = 0) {
    const speedEffects = (Array.isArray(effects) ? effects : [])
        .filter(effect => effect && effect.enabled !== false && (effect.kind || effect.type) === 'speed_change')
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    if (!speedEffects.length) return { speed: null, maintainPitch: null, warning: null };
    const effect = speedEffects[speedEffects.length - 1];
    const end = clipStart + clipDuration;
    const partial = (effect.startTime != null && Number(effect.startTime) > clipStart)
        || (effect.endTime != null && Number(effect.endTime) < end);
    const speedParam = effect?.params?.speed;
    const authoredKeyframes = effect?.keyframes?.speed || speedParam?.keyframes;
    const speedTrack = (Array.isArray(authoredKeyframes) ? authoredKeyframes : [])
        .map(frame => Number(frame?.value ?? frame?.properties?.speed))
        .filter(Number.isFinite);
    const raw = Number(effectParam(effect, 'speed', 1));
    const maintainPitch = effectParam(effect, 'maintainPitch', true);
    if (partial || speedTrack.length > 1) {
        const effectStart = Math.max(clipStart, Number.isFinite(Number(effect.startTime)) ? Number(effect.startTime) : clipStart);
        const effectEnd = Math.min(end, Number.isFinite(Number(effect.endTime)) ? Number(effect.endTime) : end);
        if (effectEnd <= effectStart) return { speed: null, maintainPitch: null, warning: null };

        const track = (Array.isArray(authoredKeyframes) ? authoredKeyframes : [])
            .map((frame, index) => ({
                time: Number(frame?.time),
                value: Number(frame?.value ?? frame?.properties?.speed),
                easing: frame?.easing || 'linear',
                index,
            }))
            .filter(frame => Number.isFinite(frame.time) && Number.isFinite(frame.value))
            .sort((a, b) => a.time - b.time || a.index - b.index);
        const sampleTrack = time => {
            if (!track.length) return Math.max(0.1, Math.min(4, Number.isFinite(raw) ? raw : 1));
            if (time <= track[0].time) return track[0].value;
            if (time >= track.at(-1).time) return track.at(-1).value;
            for (let i = 0; i < track.length - 1; i++) {
                const from = track[i], to = track[i + 1];
                if (time < from.time || time > to.time) continue;
                const progress = (time - from.time) / Math.max(1e-9, to.time - from.time);
                const eased = applyRetimeEasing(to.easing, progress);
                return from.value + (to.value - from.value) * eased;
            }
            return track.at(-1).value;
        };
        const retimeKeys = [];
        if (effectStart > clipStart) {
            const epsilon = Math.min(1e-5, (effectStart - clipStart) / 2, (effectEnd - effectStart) / 2);
            retimeKeys.push({ time: clipStart, value: 1, easing: 'linear' });
            retimeKeys.push({ time: effectStart - epsilon, value: 1, easing: 'linear' });
        }
        retimeKeys.push({ time: effectStart, value: sampleTrack(effectStart), easing: 'linear' });
        retimeKeys.push(...track.filter(frame => frame.time > effectStart && frame.time < effectEnd));
        const endKeyframe = track.find(frame => frame.time === effectEnd);
        retimeKeys.push({ time: effectEnd, value: sampleTrack(effectEnd), easing: endKeyframe?.easing || 'linear' });
        if (effectEnd < end) {
            const epsilon = Math.min(1e-5, (end - effectEnd) / 2, (effectEnd - effectStart) / 2);
            retimeKeys.push({ time: effectEnd + epsilon, value: 1, easing: 'linear' });
            retimeKeys.push({ time: end, value: 1, easing: 'linear' });
        }
        const retime = buildSpeedRetimePlan(clipDuration, retimeKeys, 1, clipStart, maintainPitch !== false);
        return {
            speed: null,
            maintainPitch: maintainPitch !== false,
            retime,
            warning: retime ? null : 'Animated speed keyframes could not be mapped to this clip and were not applied.',
        };
    }
    const uniqueSpeeds = [...new Set(speedTrack)];
    const constantSpeed = uniqueSpeeds.length === 1 ? uniqueSpeeds[0] : raw;
    return {
        speed: Number.isFinite(constantSpeed) ? Math.max(0.1, Math.min(4, constantSpeed)) : 1,
        maintainPitch: maintainPitch !== false,
        warning: null
    };
}

/**
 * Build a bounded piecewise-constant approximation of an animated speed
 * curve. Segment boundaries are in output time; source boundaries integrate
 * the average rate, so the complete source range maps to exactly the clip's
 * authored timeline duration. The same plan drives video timestamps and
 * audio atempo segments.
 */
function applyRetimeEasing(name, progress) {
    const t = Math.max(0, Math.min(1, progress));
    const rawKey = String(name || 'linear').trim().toLowerCase();
    const key = rawKey.replace(/[-_\s]/g, '');
    const functions = {
        linear: x => x,
        // Match the canonical motion engine's one-step CSS aliases. These
        // names are exposed in the keyframe UI, so treating them as unknown
        // linear easings made the rendered retime disagree with its preview.
        stepstart: () => 1,
        stepend: x => x >= 1 ? 1 : 0,
        ease: x => x < 0.5 ? 2 * x * x : -1 + (4 - 2 * x) * x,
        easein: x => x * x,
        easeout: x => x * (2 - x),
        easeinout: x => x < 0.5 ? 2 * x * x : -1 + (4 - 2 * x) * x,
        easeincubic: x => x ** 3,
        easeoutcubic: x => 1 - (1 - x) ** 3,
        easeinoutcubic: x => x < 0.5 ? 4 * x ** 3 : 1 - ((-2 * x + 2) ** 3) / 2,
        easeinquart: x => x ** 4,
        easeoutquart: x => 1 - (1 - x) ** 4,
        easeinoutquart: x => x < 0.5 ? 8 * x ** 4 : 1 - 8 * (1 - x) ** 4,
        easeinsine: x => 1 - Math.cos((x * Math.PI) / 2),
        easeoutsine: x => Math.sin((x * Math.PI) / 2),
        easeinoutsine: x => -(Math.cos(Math.PI * x) - 1) / 2,
        easeinexpo: x => x === 0 ? 0 : 2 ** (10 * x - 10),
        easeoutexpo: x => x === 1 ? 1 : 1 - 2 ** (-10 * x),
        easeinoutexpo: x => x === 0 || x === 1 ? x : x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2,
        easeoutcirc: x => Math.sqrt(Math.max(0, 1 - (x - 1) ** 2)),
        easeinoutcirc: x => x < 0.5
            ? (1 - Math.sqrt(Math.max(0, 1 - (2 * x) ** 2))) / 2
            : (Math.sqrt(Math.max(0, 1 - (-2 * x + 2) ** 2)) + 1) / 2,
        backout: x => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2,
        backin: x => 2.70158 * x ** 3 - 1.70158 * x ** 2,
        backinout: x => {
            const c = 1.70158 * 1.525;
            return x < 0.5
                ? (Math.pow(2 * x, 2) * ((c + 1) * 2 * x - c)) / 2
                : (Math.pow(2 * x - 2, 2) * ((c + 1) * (2 * x - 2) + c) + 2) / 2;
        },
        elastic: x => x === 0 || x === 1 ? x : 2 ** (-10 * x) * Math.sin((x - 0.1) * 5 * Math.PI) + 1,
        bounce: x => {
            const n = 7.5625, d = 2.75;
            if (x < 1 / d) return n * x * x;
            if (x < 2 / d) return n * (x - 1.5 / d) ** 2 + 0.75;
            if (x < 2.5 / d) return n * (x - 2.25 / d) ** 2 + 0.9375;
            return n * (x - 2.625 / d) ** 2 + 0.984375;
        },
    };
    // Parse arguments before normalizing aliases; removing hyphens from a
    // whole easing string corrupts valid negative Bézier y control points.
    const bezier = /^cubic[-_\s]?bezier\s*\(([^)]+)\)$/.exec(rawKey);
    if (bezier) {
        const [rawX1, y1, rawX2, y2] = bezier[1].split(',').map(Number);
        if ([rawX1, y1, rawX2, y2].every(Number.isFinite)) {
            // Match the canonical CSS easing parser: x controls must be in
            // [0,1] for a monotonic time curve; y controls may overshoot.
            const x1 = Math.max(0, Math.min(1, rawX1));
            const x2 = Math.max(0, Math.min(1, rawX2));
            const sample = u => 3 * (1 - u) ** 2 * u * y1 + 3 * (1 - u) * u ** 2 * y2 + u ** 3;
            const position = u => 3 * (1 - u) ** 2 * u * x1 + 3 * (1 - u) * u ** 2 * x2 + u ** 3;
            let low = 0, high = 1;
            for (let i = 0; i < 24; i++) { const mid = (low + high) / 2; if (position(mid) < t) low = mid; else high = mid; }
            return sample((low + high) / 2);
        }
    }
    const steps = /^steps\s*\(\s*(\d+)\s*(?:,\s*(jump-start|jump-end|jump-none|jump-both|start|end)\s*)?\)$/i.exec(rawKey);
    if (steps) {
        const count = Number(steps[1]);
        const rawPosition = (steps[2] || 'end').toLowerCase();
        const position = rawPosition === 'start' ? 'jump-start' : rawPosition === 'end' ? 'jump-end' : rawPosition;
        if (Number.isSafeInteger(count) && count > 0 && !(position === 'jump-none' && count === 1)) {
            return t >= 1 ? 1 : position === 'jump-start' ? (Math.floor(t * count) + 1) / count
                : position === 'jump-both' ? (Math.floor(t * count) + 1) / (count + 1)
                    : position === 'jump-none' ? Math.floor(t * count) / (count - 1)
                        : Math.floor(t * count) / count;
        }
    }
    const springMatch = /^spring\s*\(([^)]+)\)$/.exec(rawKey);
    const springPresets = {
        spring: [170, 26, 1], springgentle: [120, 14, 1], springwobbly: [180, 12, 1],
        springstiff: [210, 20, 1], springslow: [280, 60, 1], springsnappy: [400, 28, 1],
        springbouncy: [180, 12, 1], springsmooth: [200, 28.284, 1], springheavy: [140, 25, 2],
    };
    const alias = { ease: 'easeinout', back: 'backout', anticipate: 'backin', hold: 'stepend', wobbly: 'springwobbly',
        snappy: 'springsnappy', bouncy: 'springbouncy', smooth: 'springsmooth', heavy: 'springheavy' }[key] || key;
    const springArgs = springMatch ? springMatch[1].split(',').map(Number) : springPresets[alias];
    if (springArgs && springArgs.length >= 2 && springArgs.slice(0, 2).every(Number.isFinite)) {
        const stiffness = Math.max(1, springArgs[0]);
        const damping = Math.max(0.1, springArgs[1]);
        const mass = Math.max(0.1, Number(springArgs[2]) || 1);
        const w0 = Math.sqrt(stiffness / mass);
        const zeta = damping / (2 * Math.sqrt(stiffness * mass));
        let spring, settle;
        if (zeta < 1) {
            const wd = w0 * Math.sqrt(1 - zeta * zeta);
            spring = u => 1 - Math.exp(-zeta * w0 * u) * (Math.cos(wd * u) + (zeta * w0 / wd) * Math.sin(wd * u));
            settle = Math.log(1000) / (zeta * w0);
        } else if (zeta === 1) {
            spring = u => 1 - Math.exp(-w0 * u) * (1 + w0 * u);
            settle = 9.2 / w0;
        } else {
            const r1 = -w0 * (zeta - Math.sqrt(zeta * zeta - 1));
            const r2 = -w0 * (zeta + Math.sqrt(zeta * zeta - 1));
            const a = r2 / (r2 - r1), b = 1 - a;
            spring = u => 1 - (a * Math.exp(r1 * u) + b * Math.exp(r2 * u));
            settle = Math.log(1000) / Math.abs(r1);
        }
        return t <= 0 ? 0 : t >= 1 ? 1 : spring(t * settle);
    }
    return (functions[alias] || functions.linear)(t);
}

function buildSpeedRetimePlan(clipDuration, keyframes, baseSpeed = 1, clipStart = 0, maintainPitch = true) {
    const duration = Number(clipDuration);
    if (!Number.isFinite(duration) || duration <= 0 || !Array.isArray(keyframes)) return null;
    const boundedSpeed = value => Math.max(0.1, Math.min(4, Number.isFinite(Number(value)) ? Number(value) : 1));
    const points = keyframes.map((frame, index) => ({
        time: Number(frame?.time) - (Number(clipStart) || 0),
        value: boundedSpeed(frame?.value ?? frame?.properties?.speed),
        easing: frame?.easing || 'linear',
        index,
    })).filter(frame => Number.isFinite(frame.time) && frame.time >= 0 && frame.time <= duration)
        .sort((a, b) => a.time - b.time || a.index - b.index)
        .reduce((unique, frame) => {
            if (unique.at(-1)?.time === frame.time) unique[unique.length - 1] = frame;
            else unique.push(frame);
            return unique;
        }, []);
    if (points.length < 2) return null;
    if (points[0].time > 0) points.unshift({ time: 0, value: boundedSpeed(baseSpeed) });
    if (points.at(-1).time < duration) points.push({ time: duration, value: points.at(-1).value });

    const intervals = [];
    const maxIntervals = 240;
    for (let i = 0; i < points.length - 1; i++) {
        if (intervals.length >= maxIntervals) return null;
        const from = points[i], to = points[i + 1];
        const span = to.time - from.time;
        if (span <= 0) continue;
        const count = Math.max(1, Math.ceil(span * 8));
        const stepMatch = /^steps\s*\(\s*(\d+)\s*(?:,\s*(jump-start|jump-end|jump-none|jump-both|start|end)\s*)?\)$/i.exec(String(to.easing || ''));
        const stepCount = Number(stepMatch?.[1]);
        const stepMode = (stepMatch?.[2] || 'end').toLowerCase();
        const stepBoundaries = [];
        if (stepMatch && Number.isSafeInteger(stepCount) && stepCount > 0 && stepCount <= maxIntervals && !(stepMode === 'jump-none' && stepCount <= 1)) {
            for (let index = 1; index <= stepCount; index++) {
                const fraction = index / stepCount;
                if (fraction > 0 && fraction < 1) stepBoundaries.push(fraction);
            }
        }
        const fractions = new Set(Array.from({ length: count + 1 }, (_, index) => index / count));
        stepBoundaries.forEach(fraction => fractions.add(fraction));
        const orderedFractions = [...fractions].sort((a, b) => a - b);
        if (intervals.length + orderedFractions.length - 1 > maxIntervals) return null;
        if (stepMatch && stepCount > maxIntervals) return null;
        const easing = progress => applyRetimeEasing(to.easing, progress);
        for (let j = 0; j < orderedFractions.length - 1; j++) {
            const p0 = orderedFractions[j], p1 = orderedFractions[j + 1];
            const start = from.time + span * p0;
            const end = from.time + span * p1;
            const s0 = Math.max(0.1, Math.min(4, from.value + (to.value - from.value) * easing(p0)));
            const s1 = Math.max(0.1, Math.min(4, from.value + (to.value - from.value) * easing(p1)));
            const speed = stepBoundaries.length
                ? Math.max(0.1, Math.min(4, from.value + (to.value - from.value) * easing((p0 + p1) / 2)))
                : (s0 + s1) / 2;
            const sourceStart = intervals.at(-1)?.sourceEnd || 0;
            const sourceEnd = sourceStart + (end - start) * speed;
            intervals.push({ start, end, speed, sourceStart, sourceEnd });
        }
    }
    if (!intervals.length || intervals.at(-1).end < duration - 1e-5) return null;

    let expression = duration.toFixed(6);
    for (let i = intervals.length - 1; i >= 0; i--) {
        const interval = intervals[i];
        const sourceEnd = interval.sourceEnd.toFixed(6);
        const mapped = `${interval.start.toFixed(6)}+(T-${interval.sourceStart.toFixed(6)})/${interval.speed.toFixed(6)}`;
        expression = `if(lt(T\\,${sourceEnd})\\,${mapped}\\,${expression})`;
    }
    const audioSplits = intervals.map((_, index) => `[retime_in_${index}]`).join('');
    const audioGraph = [
        `[0:a]asetpts=PTS-STARTPTS,asplit=${intervals.length}${audioSplits}`,
        ...intervals.map((interval, index) => {
            const tempo = maintainPitch
                ? atempoChain(interval.speed).join(',')
                : `asetrate=44100*${interval.speed.toFixed(6)},aresample=44100`;
            return `[retime_in_${index}]atrim=start=${interval.sourceStart.toFixed(6)}:end=${interval.sourceEnd.toFixed(6)},asetpts=PTS-STARTPTS,aformat=sample_rates=44100:channel_layouts=stereo,${tempo}[retime_seg_${index}]`;
        }),
        `${intervals.map((_, index) => `[retime_seg_${index}]`).join('')}concat=n=${intervals.length}:v=0:a=1[aretimed]`,
    ].join(';');
    return {
        duration,
        sourceDuration: intervals.at(-1).sourceEnd,
        intervals,
        videoFilter: `setpts=PTS-STARTPTS,setpts='${expression}/TB'`,
        audioGraph,
        maintainPitch,
    };
}

function renderRetimeAudio(source, outputPath, retime, { offset = 0, duration, clipStart = 0, volume = 1, bitrate = '192k', effects = [], hasAudio = true } = {}) {
    return new Promise((resolve, reject) => {
        const windowedEffects = hasPartialTimelineAudioEffects(effects, clipStart, duration);
        const postFilters = [
            ...(!windowedEffects ? compileTimelineAudioEffects(effects) : []),
            ...(Number(volume) !== 1 ? [`volume=${Number(volume).toFixed(4)}`] : []),
        ];
        if (!hasAudio) {
            ffmpeg()
                .input('anullsrc=channel_layout=stereo:sample_rate=44100')
                .inputOptions(['-f', 'lavfi'])
                .setDuration(duration)
                .audioCodec('aac')
                .audioBitrate(bitrate)
                .output(outputPath)
                .on('end', resolve)
                .on('error', reject)
                .run();
            return;
        }
        const graph = [retime.audioGraph];
        if (windowedEffects) {
            graph.push(compileWindowedTimelineAudioEffects('aretimed', effects, clipStart, duration, 'audiofx'));
            graph.push(`[audiofx]${postFilters.length ? `${postFilters.join(',')},` : ''}anull[aout]`);
        } else {
            graph.push(`[aretimed]${postFilters.length ? `${postFilters.join(',')},` : ''}anull[aout]`);
        }
        ffmpeg(source)
            .setStartTime(offset)
            .setDuration(duration)
            .complexFilter(graph, 'aout')
            .audioCodec('aac')
            .audioBitrate(bitrate)
            .output(outputPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
    });
}

const EXPORTABLE_TIMELINE_EFFECTS = new Set([
    'blur', 'blur_gaussian', 'blur_radial', 'blur_motion', 'motion-blur',
    'brightness', 'contrast', 'invert', 'saturation', 'saturate', 'hue', 'hue-rotate', 'color_grade', 'grayscale', 'sepia',
    'grain', 'film_grain', 'film-grain', 'chromatic-aberration', 'rgb_split', 'distortion', 'vignette',
    'glow', 'fade_in', 'fade_out', 'glitch', 'shake', 'speed_change', 'lut_apply',
    'audio_normalize', 'audio_denoise',
]);

function timelineEffectWindow(effect, clipStart = 0, duration = 0) {
    const origin = Number.isFinite(Number(clipStart)) ? Number(clipStart) : 0;
    const length = Math.max(0, Number(duration) || 0);
    const clipEnd = length > 0 ? origin + length : Infinity;
    const authoredStart = effect?.startTime == null || effect.startTime === '' ? origin : Number(effect.startTime);
    const authoredEnd = effect?.endTime == null || effect.endTime === '' ? clipEnd : Number(effect.endTime);
    const absoluteStart = Number.isFinite(authoredStart) ? authoredStart : origin;
    const absoluteEnd = Number.isFinite(authoredEnd) ? authoredEnd : clipEnd;
    const start = Math.max(0, absoluteStart - origin);
    const end = Math.min(length > 0 ? length : Infinity, absoluteEnd - origin);
    if (!(end > start)) return { active: false, partial: false, start, end };
    return { active: true, partial: start > 0 || (length > 0 && end < length), start, end };
}

function scopeEffectFiltersToWindow(filters, firstFilterIndex, window, effect, complexGlow) {
    if (!window.active) {
        filters.splice(firstFilterIndex);
        return;
    }
    if (!window.partial) return;
    const kind = effect?.kind || effect?.type || effect?.id;
    const segment = filters.slice(firstFilterIndex);
    // Camera shake is isolated in a compositing branch so its authored time
    // window can be gated without changing the surrounding clip frames.
    if (kind === 'shake') {
        const shakeIndex = segment.findIndex(filter => String(filter).startsWith('__VIBED_SHAKE__'));
        if (shakeIndex >= 0) {
            const spec = JSON.parse(String(segment[shakeIndex]).slice('__VIBED_SHAKE__'.length));
            spec.window = { start: window.start, end: window.end };
            filters[firstFilterIndex + shakeIndex] = `__VIBED_SHAKE__${JSON.stringify(spec)}`;
        }
        return;
    }
    const blurIndex = segment.findIndex(filter => String(filter).startsWith('__VIBED_ANIMATED_BLUR__'));
    if (blurIndex >= 0) {
        const spec = JSON.parse(String(segment[blurIndex]).slice('__VIBED_ANIMATED_BLUR__'.length));
        spec.window = { start: window.start, end: window.end };
        filters[firstFilterIndex + blurIndex] = `__VIBED_ANIMATED_BLUR__${JSON.stringify(spec)}`;
        return;
    }
    const glowIndex = segment.findIndex(filter => String(filter).startsWith('__VIBED_HIGHLIGHT_GLOW__'));
    if (glowIndex >= 0 && complexGlow) {
        const raw = String(segment[glowIndex]);
        const spec = JSON.parse(raw.slice('__VIBED_HIGHLIGHT_GLOW__'.length));
        spec.window = { start: window.start, end: window.end };
        filters[firstFilterIndex + glowIndex] = `__VIBED_HIGHLIGHT_GLOW__${JSON.stringify(spec)}`;
        return;
    }
    const lutIndex = segment.findIndex(filter => String(filter).startsWith('__VIBED_LUT__'));
    if (lutIndex >= 0) {
        const spec = JSON.parse(String(segment[lutIndex]).slice('__VIBED_LUT__'.length));
        spec.window = { start: window.start, end: window.end };
        filters[firstFilterIndex + lutIndex] = `__VIBED_LUT__${JSON.stringify(spec)}`;
        return;
    }
    if (glowIndex >= 0) {
        filters.splice(firstFilterIndex);
        return;
    }
    const enable = `:enable='gte(t,${window.start.toFixed(6)})*lt(t,${Number.isFinite(window.end) ? window.end.toFixed(6) : '1e12'})'`;
    filters.splice(firstFilterIndex, segment.length, ...segment.map(filter => `${filter}${enable}`));
}

function hasRenderedAIAnalysis(clip, effect, kind) {
    const analysis = clip?.metadata?.aiEffectAnalysis?.[effect?.id];
    if (!analysis || analysis.error) return false;
    if (kind === 'beat_sync') {
        const mode = effectParam(effect, 'effectType', 'zoom_pulse');
        if (mode === 'flash') return (clip.effects || []).some(candidate => candidate?.id === `${effect.id}-generated-flash`
            && candidate.enabled !== false && ['brightness', 'color_grade'].includes(candidate.kind || candidate.type));
        if (mode === 'shake') return (clip.effects || []).some(candidate => candidate?.id === `${effect.id}-generated-shake`
            && candidate.enabled !== false && (candidate.kind || candidate.type) === 'shake'
            && Array.isArray(candidate.keyframes?.intensity) && candidate.keyframes.intensity.length > 0);
        if (mode !== 'zoom_pulse') return false;
    }
    return Array.isArray(clip?.keyframes?.scale) && clip.keyframes.scale.length > 0;
}

function collectTimelineEffectWarnings(clips = [], { clipLutFilters = new Map() } = {}) {
    const warnings = [];
    for (const clip of Array.isArray(clips) ? clips : []) {
        for (const effect of Array.isArray(clip?.effects) ? clip.effects : []) {
            if (!effect || effect.enabled === false) continue;
            const kind = effect.kind || effect.type;
            if (!kind) continue;
            const window = timelineEffectWindow(effect, Number(clip.start) || 0, Number(clip.duration) || 0);
            if (!window.active) continue;
            if (kind === 'lut_apply') {
                if (!clipLutFilters.has(String(effectParam(effect, 'lutId', effectParam(effect, 'lut', ''))))) {
                    warnings.push(`${clip.name || 'A clip'}: its LUT could not be resolved for export and was skipped.`);
                }
            } else if (['smart_zoom', 'emotion_frame', 'beat_sync'].includes(kind) && !hasRenderedAIAnalysis(clip, effect, kind)) {
                const mode = kind === 'beat_sync' ? effectParam(effect, 'effectType', 'zoom_pulse') : null;
                warnings.push(mode && mode !== 'zoom_pulse' && mode !== 'flash'
                    ? `${clip.name || 'A clip'}: “beat_sync” mode “${mode}” has no export implementation and was skipped.`
                    : `${clip.name || 'A clip'}: “${kind}” has no completed analysis keyframes, so it was skipped in export.`);
            } else if (!EXPORTABLE_TIMELINE_EFFECTS.has(kind) && !['smart_zoom', 'emotion_frame', 'beat_sync'].includes(kind)) {
                warnings.push(`${clip.name || 'A clip'}: the “${kind}” effect is not supported in export and was skipped.`);
            }
        }
    }
    return [...new Set(warnings)];
}

function compileTimelineVisualEffects(effects = [], { width = 1080, height = 1920, duration = 0, clipStart = 0, complexGlow = false, clipLutFilters = new Map() } = {}) {
    const filters = [];
    const orderedEffects = (Array.isArray(effects) ? effects : [])
        .map((effect, index) => ({ effect, index }))
        .sort((a, b) => (Number(a.effect?.order) || 0) - (Number(b.effect?.order) || 0) || a.index - b.index)
        .map(({ effect }) => effect);
    const brightnessFilter = (factor) => {
        const value = Math.max(0, Math.min(2, Number.isFinite(Number(factor)) ? Number(factor) : 1));
        return `colorchannelmixer=rr=${value.toFixed(4)}:gg=${value.toFixed(4)}:bb=${value.toFixed(4)}`;
    };
    for (const effect of orderedEffects) {
        if (!effect || effect.enabled === false) continue;
        const effectWindow = timelineEffectWindow(effect, clipStart, duration);
        const firstEffectFilter = filters.length;
        if (!effectWindow.active) continue;
        // The footage stack stores editable effects as { kind, params }, while
        // the older timeline shelf stores named presets as { id }. Compile
        // both schemas here so primary footage and overlays share the same
        // user-authored effect semantics.
        if (effect.kind || effect.type) {
            const p = effect.params || {};
            const read = (key, fallback) => {
                const value = Number(p[key]?.value ?? p[key] ?? fallback);
                if (Number.isFinite(value)) return value;
                const safeFallback = Number(fallback);
                return Number.isFinite(safeFallback) ? safeFallback : 0;
            };
            const animated = (key, fallback, min, max) => compileEffectKeyframeExpression(effect, key, fallback, min, max, clipStart);
            const kind = effect.kind || effect.type;
            // Retiming effects are executed by the timeline speed compiler,
            // not by this per-frame visual filter stack.
            // Audio, LUT resolution, and AI analysis also have dedicated
            // pipelines. The export warning collector reports skipped or
            // unresolved cases for these effect families.
            if (['speed_change', 'audio_normalize', 'audio_denoise', 'smart_zoom', 'emotion_frame', 'beat_sync'].includes(kind)) continue;
            if (kind === 'lut_apply' && !clipLutFilters.has(String(effectParam(effect, 'lutId', effectParam(effect, 'lut', ''))))) continue;
            const amount = read('amount', read('value', 1));
            const localTime = (value, fallback) => {
                const time = Number(value);
                return Number.isFinite(time) ? Math.max(0, time - (Number(clipStart) || 0)) : fallback;
            };
            switch (kind) {
                case 'blur': case 'blur_gaussian': {
                    const radiusKey = p.radius != null || effect.keyframes?.radius ? 'radius' : 'amount';
                    const radius = Math.max(0, Math.min(50, read(radiusKey, amount)));
                    const radiusExpression = animated(radiusKey, radius, 0, 50);
                    if (radiusExpression) filters.push(`__VIBED_ANIMATED_BLUR__${JSON.stringify({ radius, radiusExpression })}`);
                    else filters.push(`gblur=sigma=${radius}`);
                    break;
                }
                case 'blur_radial': {
                    const intensityValue = Math.max(0, Math.min(1, read('intensity', 0.3)));
                    const intensityTrack = animated('intensity', intensityValue, 0, 1);
                    const intensity = String(intensityTrack || intensityValue.toFixed(6)).replace(/\bt\b/g, 'T');
                    const centerXValue = Math.max(0, Math.min(1, read('centerX', 0.5)));
                    const centerYValue = Math.max(0, Math.min(1, read('centerY', 0.5)));
                    const centerXTrack = animated('centerX', centerXValue, 0, 1);
                    const centerYTrack = animated('centerY', centerYValue, 0, 1);
                    const centerX = centerXTrack ? String(centerXTrack).replace(/\bt\b/g, 'T') : centerXValue;
                    const centerY = centerYTrack ? String(centerYTrack).replace(/\bt\b/g, 'T') : centerYValue;
                    const samples = Math.max(8, Math.min(64, Math.round(read('samples', 32))));
                    const sampleChannel = channel => {
                        const terms = [];
                        for (let index = 0; index < samples; index++) {
                            const progress = (index / samples).toFixed(6);
                            const distance = `sqrt(pow(${centerX}-X/W,2)+pow(${centerY}-Y/H,2))`;
                            const x = `clip(X+(${centerX}-X/W)*(${progress})*(${intensity})*${distance}*0.5*W,0,W-1)`;
                            const y = `clip(Y+(${centerY}-Y/H)*(${progress})*(${intensity})*${distance}*0.5*H,0,H-1)`;
                            terms.push(`${channel}(${x},${y})`);
                        }
                        return `(${terms.join('+')})/${samples}`;
                    };
                    filters.push(`format=rgba,geq=r='${sampleChannel('r')}':g='${sampleChannel('g')}':b='${sampleChannel('b')}':a='alpha(X,Y)'`);
                    break;
                }
                case 'blur_motion': case 'motion-blur': {
                    const rawIntensity = p.intensity?.value ?? p.intensity;
                    const hasIntensity = rawIntensity != null;
                    const rawLegacyAmount = p.amount?.value ?? p.amount ?? p.value?.value ?? p.value;
                    const legacyAmount = Number(rawLegacyAmount);
                    const hasLegacyAmount = rawLegacyAmount != null || Array.isArray(effect.keyframes?.amount);
                    const intensityValue = Math.max(0, Math.min(1, hasIntensity
                        ? Number(rawIntensity)
                        : hasLegacyAmount
                            ? (Number.isFinite(legacyAmount) ? legacyAmount : amount) / 31.176914536
                            : 0.5));
                    const intensityTrack = animated('intensity', intensityValue, 0, 1);
                    const amountTrack = !hasIntensity && hasLegacyAmount
                        ? animated('amount', Number.isFinite(legacyAmount) ? legacyAmount : amount, 0, 50)
                        : null;
                    const intensity = intensityTrack
                        ? `clip((${intensityTrack.replace(/\bt\b/g, 'T')}),0,1)`
                        : amountTrack
                            ? `clip((${amountTrack.replace(/\bt\b/g, 'T')})/31.176914536,0,1)`
                            : intensityValue.toFixed(6);
                    const rawAngle = p.angle?.value ?? p.angle;
                    const angle = ((Number(rawAngle) || 0) % 360 + 360) % 360;
                    const angleTrack = animated('angle', angle, 0, 360);
                    const angleExpression = angleTrack
                        ? `mod((${angleTrack.replace(/\bt\b/g, 'T')}),360)`
                        : angle.toFixed(6);
                    const samples = Math.max(2, Math.min(64, Math.round(read('samples', 16))));
                    const sampleChannel = channel => {
                        const terms = [];
                        for (let index = 0; index < samples; index++) {
                            const progress = (index / (samples - 1) - 0.5).toFixed(6);
                            const travel = `(${progress})*(${intensity})*0.1*W`;
                            const x = `clip(X+cos((${angleExpression})*PI/180)*${travel},0,W-1)`;
                            const y = `clip(Y+sin((${angleExpression})*PI/180)*${travel},0,H-1)`;
                            terms.push(`${channel}(${x},${y})`);
                        }
                        return `(${terms.join('+')})/${samples}`;
                    };
                    filters.push(`format=rgba,geq=r='${sampleChannel('r')}':g='${sampleChannel('g')}':b='${sampleChannel('b')}':a='alpha(X,Y)'`);
                    break;
                }
                case 'brightness': {
                    const expression = animated('amount', Number.isFinite(amount) ? amount : 1, 0, 2);
                    if (expression) filters.push(`eq=brightness='((${expression})-1)/2':eval=frame`);
                    else filters.push(brightnessFilter(Number.isFinite(amount) ? amount : 1));
                    break;
                }
                case 'contrast': {
                    const value = animated('amount', amount, 0, 4) || Math.max(0, Math.min(4, Number.isFinite(amount) ? amount : 1));
                    filters.push(`eq=contrast='${value}':eval=frame`);
                    break;
                }
                case 'saturation': case 'saturate': {
                    const value = animated('amount', amount, 0, 5) || Math.max(0, Math.min(5, Number.isFinite(amount) ? amount : 1));
                    filters.push(`eq=saturation='${value}':eval=frame`);
                    break;
                }
                case 'grayscale': {
                    const value = animated('amount', amount, 0, 1);
                    const strength = value ? `(1-(${value}))` : (1 - Math.max(0, Math.min(1, amount))).toFixed(4);
                    filters.push(`eq=saturation='${strength}':eval=frame`);
                    break;
                }
                case 'sepia': {
                    const value = animated('amount', amount, 0, 1);
                    const strength = String(value || Math.max(0, Math.min(1, amount)).toFixed(4)).replace(/\bt\b/g, 'T');
                    const channel = (name, red, green, blue) => `clip((1-(${strength}))*${name}(X,Y)+(${strength})*(${red}*r(X,Y)+${green}*g(X,Y)+${blue}*b(X,Y)),0,255)`;
                    filters.push(`format=rgba,geq=r='${channel('r', '0.393', '0.769', '0.189')}':g='${channel('g', '0.349', '0.686', '0.168')}':b='${channel('b', '0.272', '0.534', '0.131')}':a='alpha(X,Y)'`);
                    break;
                }
                case 'invert': {
                    const value = animated('amount', amount, 0, 1);
                    const strength = value
                        ? `clip((${value.replace(/\bt\b/g, 'T')}),0,1)`
                        : Math.max(0, Math.min(1, Number.isFinite(amount) ? amount : 1)).toFixed(6);
                    // Per-channel geq keeps inversion at frame time, including
                    // animated strength, while preserving the source alpha.
                    const channel = name => `clip(${name}(X,Y)*(1-2*(${strength}))+255*(${strength}),0,255)`;
                    filters.push(`format=rgba,geq=r='${channel('r')}':g='${channel('g')}':b='${channel('b')}':a='alpha(X,Y)'`);
                    break;
                }
                case 'hue': case 'hue-rotate': {
                    const degrees = animated('degrees', Number(p.degrees ?? amount) || 0, -360, 360) || Math.max(-360, Math.min(360, Number(p.degrees ?? amount) || 0));
                    filters.push(`hue=h='${degrees}'`);
                    break;
                }
                case 'color_grade': {
                    const brightness = animated('brightness', read('brightness', 100), 0, 200);
                    if (brightness) {
                        // CSS brightness is multiplicative. `eq=brightness`
                        // adds an offset, so it diverges badly on highlights.
                        // geq exposes frame time and preserves the source alpha.
                        const timeExpression = brightness.replace(/\bt\b/g, 'T');
                        filters.push(`format=rgba,geq=r='clip(r(X,Y)*clip((${timeExpression})/100,0,2),0,255)':g='clip(g(X,Y)*clip((${timeExpression})/100,0,2),0,255)':b='clip(b(X,Y)*clip((${timeExpression})/100,0,2),0,255)':a='alpha(X,Y)'`);
                    } else {
                        const factor = Number(read('brightness', 100));
                        filters.push(brightnessFilter(Number.isFinite(factor) ? factor / 100 : 1));
                    }
                    const contrastTrack = animated('contrast', read('contrast', 100), 0, 200);
                    const saturationTrack = animated('saturation', read('saturation', read('saturate', 100)), 0, 200);
                    const contrastRaw = Number(read('contrast', 100));
                    const saturationRaw = Number(read('saturation', read('saturate', 100)));
                    const contrast = contrastTrack ? `'(${contrastTrack})/100'` : String(Math.max(0, Math.min(2, Number.isFinite(contrastRaw) ? contrastRaw / 100 : 1)));
                    const saturation = saturationTrack ? `'(${saturationTrack})/100'` : String(Math.max(0, Math.min(2, Number.isFinite(saturationRaw) ? saturationRaw / 100 : 1)));
                    filters.push(`eq=contrast=${contrast}:saturation=${saturation}:eval=frame`);
                    const hueExpression = animated('hueRotate', read('hueRotate', 0), -180, 180);
                    const hue = hueExpression || Math.max(-180, Math.min(180, read('hueRotate', 0)));
                    if (hueExpression) filters.push(`hue=h='${hueExpression}'`);
                    else if (hue) filters.push(`hue=h=${hue}`);
                    const temperatureValue = Math.max(-100, Math.min(100, read('temperature', 0)));
                    const tintValue = Math.max(-100, Math.min(100, read('tint', 0)));
                    const temperatureTrack = animated('temperature', temperatureValue, -100, 100);
                    const tintTrack = animated('tint', tintValue, -100, 100);
                    const temperature = String(temperatureTrack || temperatureValue.toFixed(6)).replace(/\bt\b/g, 'T');
                    const tint = String(tintTrack || tintValue.toFixed(6)).replace(/\bt\b/g, 'T');
                    if (temperatureTrack || tintTrack || temperatureValue || tintValue) {
                        // The live shader applies linear RGB channel offsets:
                        // red/blue for temperature and green for tint. FFmpeg
                        // colorbalance is tonal-range based and visibly differs
                        // from preview even for static values.
                        filters.push(`format=rgba,geq=r='clip(r(X,Y)+(${temperature})*0.765,0,255)':g='clip(g(X,Y)+(${tint})*0.765,0,255)':b='clip(b(X,Y)-(${temperature})*0.765,0,255)':a='alpha(X,Y)'`);
                    }
                    break;
                }
                case 'lut_apply': {
                    const lutId = String(effectParam(effect, 'lutId', effectParam(effect, 'lut', '')) || '');
                    const lutFilter = clipLutFilters.get(lutId);
                    const intensity = Number(effectParam(effect, 'intensity', 1));
                    if (lutFilter) filters.push(`__VIBED_LUT__${JSON.stringify({ filter: lutFilter, intensity: Number.isFinite(intensity) ? Math.max(0, Math.min(1, intensity)) : 1 })}`);
                    break;
                }
                case 'grain': filters.push(`noise=alls=${Math.max(0, Math.min(48, Number.isFinite(amount) ? amount : 8))}:allf=t+u`); break;
                case 'film_grain': case 'film-grain': {
                    const rawAnimated = p.animated?.value ?? p.animated;
                    const animated = rawAnimated == null ? true : Boolean(rawAnimated);
                    const intensity = Math.max(0, Math.min(1, read('intensity', 0.15)));
                    const intensityTrack = compileEffectKeyframeExpression(effect, 'intensity', intensity, 0, 1, clipStart);
                    const strength = intensityTrack
                        ? `clip((${intensityTrack.replace(/\bt\b/g, 'T')}),0,1)*510`
                        : (intensity * 510).toFixed(4);
                    const size = Math.max(0.5, Math.min(5, read('size', 1.5)));
                    const seed = Math.max(0, Math.min(2147483647, Math.floor(read('seed', 941))));
                    const frame = animated ? 'floor(T*30)' : '0';
                    const hash = `(sin((floor(X/${size.toFixed(4)})+${seed}*7.1)*12.9898+(floor(Y/${size.toFixed(4)})+${seed}*3.17)*78.233+${frame}*37.719)*43758.5453)`;
                    const noise = `((${hash})-floor(${hash})-0.5)*(${strength})`;
                    // Preserve fully transparent RGB. Otherwise grain in hidden
                    // pixels can bleed across an overlay edge during scaling,
                    // even though the alpha channel itself remains zero.
                    filters.push(`format=rgba,geq=r='if(gt(alpha(X,Y),0),clip(r(X,Y)+${noise},0,255),r(X,Y))':g='if(gt(alpha(X,Y),0),clip(g(X,Y)+${noise},0,255),g(X,Y))':b='if(gt(alpha(X,Y),0),clip(b(X,Y)+${noise},0,255),b(X,Y))':a='alpha(X,Y)'`);
                    break;
                }
                case 'chromatic-aberration':
                case 'rgb_split': {
                    const distance = Math.max(0, Math.min(50, read('amount', kind === 'chromatic-aberration' ? 2 : 5)));
                    const distanceTrack = animated('amount', distance, 0, 50);
                    const distanceExpression = distanceTrack
                        ? `clip((${distanceTrack.replace(/\bt\b/g, 'T')}),0,50)`
                        : distance.toFixed(6);
                    const angle = ((read('angle', 0) % 360) + 360) % 360;
                    const angleTrack = animated('angle', angle, 0, 360);
                    const angleExpression = angleTrack
                        ? `mod((${angleTrack.replace(/\bt\b/g, 'T')}),360)`
                        : angle.toFixed(6);
                    const centerX = Math.max(0, Math.min(1, read('centerX', 0.5)));
                    const centerY = Math.max(0, Math.min(1, read('centerY', 0.5)));
                    const radialDistance = `sqrt(pow(X/W-${centerX},2)+pow(Y/H-${centerY},2))`;
                    const dx = `(cos((${angleExpression})*PI/180)*(${distanceExpression}))`;
                    const dy = `(sin((${angleExpression})*PI/180)*(${distanceExpression}))`;
                    const redX = `clip(X+(${dx})*(${radialDistance}),0,W-1)`;
                    const redY = `clip(Y+(${dy})*(${radialDistance}),0,H-1)`;
                    const blueX = `clip(X-(${dx})*(${radialDistance}),0,W-1)`;
                    const blueY = `clip(Y-(${dy})*(${radialDistance}),0,H-1)`;
                    filters.push(`format=rgba,geq=r='r(${redX},${redY})':g='g(X,Y)':b='b(${blueX},${blueY})':a='alpha(X,Y)'`);
                    break;
                }
                case 'distortion': {
                    const rawAmount = read('amount', 0.018);
                    const amountValue = Math.max(0, Math.min(0.08, rawAmount));
                    const amountTrack = animated('amount', amountValue, 0, 0.08);
                    const displacement = String(amountTrack || amountValue.toFixed(6)).replace(/\bt\b/g, 'T');
                    const phase = read('phase', 0);
                    const sx = `clip(X+sin(Y*0.045+${phase.toFixed(6)})*(${displacement})*W,0,W-1)`;
                    const sy = `clip(Y+sin(X*0.04)*(${displacement})*H,0,H-1)`;
                    filters.push(`format=rgba,geq=r='r(${sx},${sy})':g='g(${sx},${sy})':b='b(${sx},${sy})':a='alpha(${sx},${sy})'`);
                    break;
                }
                case 'vignette': {
                    const intensityValue = Math.max(0, Math.min(1, read('intensity', 0.5)));
                    const radiusValue = Math.max(0.1, Math.min(1.5, read('radius', 0.7)));
                    const softnessValue = Math.max(0, Math.min(1, read('softness', 0.5)));
                    const asGeqTime = expression => String(expression).replace(/\bt\b/g, 'T');
                    const intensity = asGeqTime(animated('intensity', intensityValue, 0, 1) || intensityValue.toFixed(6));
                    const radius = asGeqTime(animated('radius', radiusValue, 0.1, 1.5) || radiusValue.toFixed(6));
                    const softness = asGeqTime(animated('softness', softnessValue, 0, 1) || softnessValue.toFixed(6));
                    const rawColor = effectParam(effect, 'color', [0, 0, 0]);
                    const hex = typeof rawColor === 'string' ? rawColor.match(/^#?([\da-f]{6})$/i) : null;
                    const color = hex
                        ? [0, 2, 4].map(index => parseInt(hex[1].slice(index, index + 2), 16))
                        : Array.isArray(rawColor) ? rawColor.slice(0, 3).map(channel => {
                            const value = Number(channel);
                            return Math.round(Math.max(0, Math.min(255, Number.isFinite(value) ? (value <= 1 ? value * 255 : value) : 0)));
                        }) : [0, 0, 0];
                    const animatedColor = animated('color', color, 0, 255);
                    const colorChannels = Array.isArray(animatedColor) && animatedColor.length >= 3
                        ? animatedColor.slice(0, 3).map(channel => String(channel).replace(/\bt\b/g, 'T'))
                        : color.map(String);
                    const distance = 'sqrt(pow(X/W-0.5,2)+pow(Y/H-0.5,2))';
                    const edgeT = `clip((${distance}-(${radius}-${softness}))/max(${softness},0.0001),0,1)`;
                    const edge = `(${edgeT})*(${edgeT})*(3-2*(${edgeT}))`;
                    const mix = `(${edge})*(${intensity})`;
                    filters.push(`format=rgba,geq=r='r(X,Y)*(1-${mix})+(${colorChannels[0]})*${mix}':g='g(X,Y)*(1-${mix})+(${colorChannels[1]})*${mix}':b='b(X,Y)*(1-${mix})+(${colorChannels[2]})*${mix}':a='alpha(X,Y)'`);
                    break;
                }
                case 'glow': {
                    const radius = Math.max(1, Math.min(50, read('radius', 10)));
                    const threshold = Math.max(0, Math.min(1, read('threshold', 0.7)));
                    const intensity = Math.max(0, Math.min(3, read('intensity', 1)) * 0.7);
                    const thresholdTrack = animated('threshold', threshold, 0, 1);
                    const intensityTrack = animated('intensity', read('intensity', 1), 0, 3);
                    const radiusTrack = animated('radius', radius, 1, 50);
                    const radiusInput = effect?.samples?.radius?.length ? effect.samples.radius
                        : (effect?.keyframes?.radius || effect?.params?.radius?.keyframes || []);
                    const radiusValues = radiusInput.map(point => Number(point?.value)).filter(Number.isFinite)
                        .map(value => Math.max(1, Math.min(50, value)));
                    const color = effectParam(effect, 'color', [0.447, 0.851, 1]);
                    const hex = typeof color === 'string' ? color.match(/^#?([\da-f]{6})$/i) : null;
                    const channels = hex ? [0, 2, 4].map(index => parseInt(hex[1].slice(index, index + 2), 16))
                        : Array.isArray(color) ? color.slice(0, 3).map(channel => {
                        const value = Number(channel);
                        const normalized = Number.isFinite(value) ? value : 1;
                        return Math.round(Math.max(0, Math.min(255, normalized <= 1 ? normalized * 255 : normalized)));
                    }) : [114, 217, 255];
                    const animatedColor = animated('color', channels, 0, 255);
                    const glowColor = Array.isArray(animatedColor) && animatedColor.length >= 3
                        ? animatedColor.slice(0, 3).map(channel => String(channel).replace(/\bt\b/g, 'T'))
                        : channels;
                    if (complexGlow) filters.push(`__VIBED_HIGHLIGHT_GLOW__${JSON.stringify({
                        radius, threshold: threshold * 255, intensity, color: glowColor,
                        thresholdExpression: thresholdTrack ? `(${String(thresholdTrack).replace(/\bt\b/g, 'T')})*255` : null,
                        intensityExpression: intensityTrack ? `(${String(intensityTrack).replace(/\bt\b/g, 'T')})*0.7` : null,
                        radiusExpression: radiusTrack ? String(radiusTrack).replace(/\bt\b/g, 'T') : null,
                        radiusRange: radiusValues.length > 1
                            ? [Math.min(...radiusValues), Math.max(...radiusValues)] : null,
                    })}`);
                    else filters.push(`gblur=sigma=${radius}`, `eq=brightness=${Math.max(0, Math.min(0.2, intensity * 0.05))}`);
                    break;
                }
                case 'fade_in': {
                    const fadeDuration = Math.max(0.05, Math.min(Number(duration) || 60, read('duration', 0.5)));
                    const start = localTime(effect.startTime, 0);
                    const color = effectParam(effect, 'color', [0, 0, 0]);
                    const hex = toFfmpegColor(color);
                    filters.push(`fade=t=in:st=${start.toFixed(3)}:d=${fadeDuration.toFixed(3)}:color=${hex}`);
                    break;
                }
                case 'fade_out': {
                    const fadeDuration = Math.max(0.05, Math.min(Number(duration) || 60, read('duration', 0.5)));
                    const end = localTime(effect.endTime, Number(duration) || 0);
                    const start = Math.max(0, end - fadeDuration);
                    const color = effectParam(effect, 'color', [0, 0, 0]);
                    const hex = toFfmpegColor(color);
                    filters.push(`fade=t=out:st=${start.toFixed(3)}:d=${Math.max(0.05, Math.min(fadeDuration, end - start)).toFixed(3)}:color=${hex}`);
                    break;
                }
                case 'glitch': {
                    const hasLegacyAmount = p.amount != null || Array.isArray(effect.keyframes?.amount);
                    const rawAmount = hasLegacyAmount ? read('amount', 8) : read('intensity', 0.2);
                    const intensityTrack = animated(hasLegacyAmount ? 'amount' : 'intensity', rawAmount,
                        hasLegacyAmount ? 0 : 0, hasLegacyAmount ? 32 : 1);
                    const strength = Math.max(0, Math.min(1, hasLegacyAmount
                        ? rawAmount / 32
                        : rawAmount));
                    const seed = Math.max(0, Math.min(1000, read('seed', 17)));
                    const sampledStrength = intensityTrack
                        ? `((${intensityTrack.replace(/\bt\b/g, 'T')})${hasLegacyAmount ? '/32' : ''})`
                        : strength.toFixed(4);
                    const blockSize = Math.max(4, Math.min(128, read('blockSize', 32)));
                    const colorShift = effectParam(effect, 'colorShift', true) !== false;
                    const scanlines = effectParam(effect, 'scanlines', true) !== false;
                    const frame = 'floor(T*12)';
                    const blockX = `floor(X/${blockSize.toFixed(4)})`;
                    const blockY = `floor(Y/${blockSize.toFixed(4)})`;
                    const random = (x, y, salt = 0) => `mod(abs(sin((${x}+${salt})*12.9898+(${y}+${seed})*78.233)*43758.5453),1)`;
                    const blockRandom = random(`${blockX}+${frame}*0.17`, blockY);
                    const displacement = `if(gt(${blockRandom},1-(${sampledStrength})*0.3),round((${random(blockX, blockY, 1)}-0.5)*(${sampledStrength})*0.1*W),0)`;
                    const split = colorShift
                        ? `if(gt(${random(blockX, blockY, 0.5)},0.7),(${random(blockX, blockY, 1)}-0.5)*(${sampledStrength})*0.02*W,0)`
                        : '0';
                    const redX = `clip(X+(${displacement})+(${split}),0,W-1)`;
                    const greenX = `clip(X+(${displacement}),0,W-1)`;
                    const blueX = `clip(X+(${displacement})-(${split}),0,W-1)`;
                    const scanline = scanlines ? `(0.9+(sin((Y+0.5)*PI)*0.5+0.5)*0.1)` : '1';
                    filters.push(`format=rgba,geq=r='clip(r(${redX},Y)*${scanline},0,255)':g='clip(g(${greenX},Y)*${scanline},0,255)':b='clip(b(${blueX},Y)*${scanline},0,255)':a='alpha(X,Y)'`);
                    break;
                }
                case 'shake': {
                    const frequency = Math.max(1, Math.min(60, read('frequency', 10)));
                    const baseIntensity = Math.max(0, Math.min(50, read('intensity', 5)));
                    // Beat Sync writes an intensity envelope onto this effect.
                    // Evaluate that track per output frame so the generated
                    // beat accents actually move the picture during export.
                    const intensityTrack = animated('intensity', baseIntensity, 0, 50);
                    const intensity = intensityTrack
                        ? `(${String(intensityTrack)})*${Math.max(0.25, width / 1080).toFixed(4)}`
                        : String((baseIntensity * Math.max(0.25, width / 1080)).toFixed(3));
                    const rotation = Math.max(0, Math.min(10, read('rotationAmount', 0)));
                    const rotationTrack = animated('rotationAmount', rotation, 0, 10);
                    const rotationExpr = rotationTrack ? String(rotationTrack) : rotation.toFixed(3);
                    const seed = read('randomSeed', 0);
                    filters.push(`__VIBED_SHAKE__${JSON.stringify({
                        width, height, frequency, intensity, rotation: rotationExpr, seed,
                        window: effectWindow.partial ? { start: effectWindow.start, end: effectWindow.end } : null,
                    })}`);
                    break;
                }
                default: break;
            }
            if (filters.length === firstEffectFilter && EXPORTABLE_TIMELINE_EFFECTS.has(kind)) {
                throw new Error(`Exportable footage effect has no renderer: ${String(kind || '(missing kind)')}`);
            }
            scopeEffectFiltersToWindow(filters, firstEffectFilter, effectWindow, effect, complexGlow);
            continue;
        }
        switch (effect.id) {
            case 'warm-film': filters.push('colorbalance=rs=.04:gs=.015:bs=-.035', 'eq=saturation=1.18:contrast=1.06'); break;
            case 'vivid': filters.push('eq=saturation=1.45:contrast=1.08'); break;
            case 'noir': filters.push('hue=s=0', 'eq=contrast=1.22'); break;
            case 'dreamy': filters.push('eq=brightness=0.08:saturation=0.88', 'boxblur=0.3:1'); break;
            case 'soft-contrast': filters.push('eq=brightness=-0.03:contrast=1.06'); break;
            case 'cool-tone': filters.push('hue=h=12:s=0.92', 'eq=contrast=1.04'); break;
            case 'soft-focus': filters.push('boxblur=0.5:1', 'eq=saturation=0.92'); break;
            case 'bright-pop': filters.push('eq=brightness=0.12:saturation=1.24'); break;
            case 'golden-hour': filters.push('colorbalance=rs=.04:gs=.02:bs=-.04', 'eq=brightness=0.04:saturation=1.3'); break;
            case 'cinematic': filters.push('eq=contrast=1.16:saturation=0.86:brightness=-0.02'); break;
            case 'matte': filters.push('eq=contrast=0.88:brightness=0.05:saturation=0.9'); break;
            case 'high-contrast': filters.push('eq=contrast=1.34:saturation=1.08'); break;
            case 'sepia': filters.push('colorchannelmixer=rr=.393:rg=.769:rb=.189:gr=.349:gg=.686:gb=.168:br=.272:bg=.534:bb=.131', 'eq=saturation=0.9'); break;
            case 'mono': filters.push('hue=s=0'); break;
            case 'blue-mono': filters.push('hue=s=0', 'colorbalance=bs=.12:rs=-.04'); break;
            case 'teal-shift': filters.push('hue=h=155:s=0.78'); break;
            case 'rose-toned': filters.push('colorbalance=rs=.06:gs=-.025:bs=.02', 'eq=saturation=1.18'); break;
            case 'sunset': filters.push('colorbalance=rs=.08:gs=.015:bs=-.06', 'eq=saturation=1.42'); break;
            case 'faded-film': filters.push('eq=contrast=0.82:saturation=0.78:brightness=0.05'); break;
            case 'crisp': filters.push('eq=contrast=1.18:saturation=1.08'); break;
            case 'moody': filters.push('eq=brightness=-0.08:contrast=1.18:saturation=0.82'); break;
            case 'shadow-lift': filters.push('eq=brightness=0.08:contrast=0.9'); break;
            case 'bright-airy': filters.push('eq=brightness=0.12:contrast=0.92:saturation=0.9'); break;
            case 'cool-night': filters.push('hue=h=18:s=0.82', 'eq=brightness=-0.1'); break;
            case 'warm-shadow': filters.push('colorbalance=rs=.04:gs=.015:bs=-.025', 'eq=brightness=-0.04:contrast=1.08'); break;
            case 'soft-warm': filters.push('colorbalance=rs=.035:gs=.012:bs=-.025', 'eq=brightness=0.03:saturation=0.92'); break;
            case 'vintage': filters.push('colorchannelmixer=rr=.393:rg=.769:rb=.189:gr=.349:gg=.686:gb=.168:br=.272:bg=.534:bb=.131', 'eq=contrast=0.92:saturation=0.78'); break;
            case 'washed': filters.push('eq=brightness=0.06:contrast=0.78:saturation=0.78'); break;
            case 'punchy': filters.push('eq=contrast=1.24:saturation=1.34'); break;
            case 'pastel': filters.push('eq=saturation=0.72:brightness=0.06:contrast=0.88'); break;
            case 'amber': filters.push('colorbalance=rs=.05:gs=.02:bs=-.04', 'eq=saturation=1.22'); break;
            case 'aqua': filters.push('hue=h=155:s=1.18', 'eq=brightness=0.02'); break;
            case 'lavender': filters.push('hue=h=265:s=0.78', 'eq=brightness=0.03'); break;
            case 'sports': filters.push('eq=contrast=1.22:saturation=1.3:brightness=0.02'); break;
            // Footage treatments mirror the live preview's SVG filters. FFmpeg
            // uses temporal noise, channel offsets, spatial blur and lens
            // correction so exports retain actual pixel-level treatment.
            case 'film-grain': filters.push('noise=alls=9:allf=t+u'); break;
            case 'chromatic-aberration': filters.push('chromashift=cbh=-2:crh=2:edge=smear'); break;
            case 'motion-blur': {
                const sigma = 2 * Math.max(width / 1080, height / 1920) * 0.7;
                // Match the preview SVG's slightly anisotropic blur instead of
                // dropping the vertical component entirely in rendered files.
                filters.push(`gblur=sigma=${sigma.toFixed(4)}:sigmaV=${(sigma * 0.21).toFixed(4)}`);
                break;
            }
            case 'lens-distortion': filters.push('lenscorrection=cx=0.5:cy=0.5:k1=-0.04:k2=0.01'); break;
            default: break;
        }
        if (filters.length === firstEffectFilter) {
            throw new Error(`Cannot export unsupported footage effect preset: ${String(effect.id || '(missing id)')}`);
        }
        scopeEffectFiltersToWindow(filters, firstEffectFilter, effectWindow, effect, complexGlow);
    }
    return filters;
}

// Bake the preview shader's six hue-range adjustments into a small 3D LUT for
// FFmpeg. The range centers/weights and HSL math intentionally mirror
// PlaybackEngine's shader so selective grades survive export instead of being
// silently dropped. The LUT also carries hueRotate because the preview applies
// both in HSL before brightness, contrast and saturation.
function buildSelectiveGradeCube(selective = {}, hueRotate = 0, size = 17) {
    const ranges = ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'];
    const centers = [0, 0.166, 0.333, 0.5, 0.666, 0.833];
    const values = ranges.map(key => {
        const p = selective?.[key] || {};
        return {
            h: (Number(p.hue ?? p.h) || 0) / 360,
            s: (Number(p.sat ?? p.s) || 0) / 100,
            l: (Number(p.lum ?? p.l) || 0) / 100,
        };
    });
    const hslToRgb = (h, s, l) => {
        const channel = n => {
            const k = (n + h * 12) % 12;
            const a = s * Math.min(l, 1 - l);
            return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
        };
        return [channel(0), channel(8), channel(4)];
    };
    const rgbToHsl = (r, g, b) => {
        const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
        const l = (max + min) / 2;
        let h = 0, s = 0;
        if (d > 1e-10) {
            s = d / (1 - Math.abs(2 * l - 1) + 1e-10);
            if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
            else if (max === g) h = ((b - r) / d + 2) / 6;
            else h = ((r - g) / d + 4) / 6;
        }
        return [h, s, l];
    };
    const lines = [`TITLE "Vibed selective grade"`, `LUT_3D_SIZE ${size}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
    for (let bz = 0; bz < size; bz++) {
        for (let gy = 0; gy < size; gy++) {
            for (let rx = 0; rx < size; rx++) {
                const [h0, s0, l0] = rgbToHsl(rx / (size - 1), gy / (size - 1), bz / (size - 1));
                let dh = 0, ds = 0, dl = 0;
                for (let i = 0; i < ranges.length; i++) {
                    const center = centers[i];
                    const weight = Math.max(0, 1 - Math.abs(h0 - center) * 6)
                        + (i === 0 ? Math.max(0, 1 - Math.abs(h0 - 1) * 6) : 0);
                    dh += weight * values[i].h;
                    ds += weight * values[i].s;
                    dl += weight * values[i].l;
                }
                const h = ((h0 + dh + (Number(hueRotate) || 0) / 360) % 1 + 1) % 1;
                const s = Math.max(0, Math.min(1, s0 + ds));
                const l = Math.max(0, Math.min(1, l0 + dl));
                lines.push(hslToRgb(h, s, l).map(v => Math.max(0, Math.min(1, v)).toFixed(6)).join(' '));
            }
        }
    }
    return lines.join('\n') + '\n';
}

function hasSelectiveGrade(selective, hueRotate = 0) {
    if (Number(hueRotate)) return true;
    return ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'].some(key => {
        const p = selective?.[key] || {};
        return [p.hue ?? p.h ?? 0, p.sat ?? p.s ?? 0, p.lum ?? p.l ?? 0].some(value => Number(value) !== 0);
    });
}

/** Build one clip's complete grade chain in preview order: selective/HSL
 * remapping first, then global brightness, contrast, saturation and temperature. */
function compileClipColorGradeFilters(grading, { selectiveFilter = null, ...options } = {}) {
    if (!grading || typeof grading !== 'object') return [];
    const filters = selectiveFilter ? [selectiveFilter] : [];
    const globalGrade = { ...grading, selective: undefined, hueRotate: 0 };
    filters.push(...compileTimelineVisualEffects([{
        kind: 'color_grade',
        params: globalGrade,
    }], options));
    return filters;
}

/** Compile linear FFmpeg filters and thresholded highlight bloom stages into a
 * single filter_complex graph, preserving authored effect order. */
function compileTimelineVisualEffectGraph(filters = [], { input = '0:v', output = 'vfxout' } = {}) {
    const graph = [];
    let current = input;
    let stage = 0;
    let linear = [];
    const flushLinear = () => {
        if (!linear.length) return;
        const next = `vfx_${stage++}`;
        graph.push(`[${current}]${linear.join(',')}[${next}]`);
        current = next;
        linear = [];
    };
    for (const filter of filters) {
        const prefix = '__VIBED_HIGHLIGHT_GLOW__';
        const lutPrefix = '__VIBED_LUT__';
        const shakePrefix = '__VIBED_SHAKE__';
        const blurPrefix = '__VIBED_ANIMATED_BLUR__';
        const effectGraphPrefix = '__VIBED_EFFECT_DAG__';
        if (String(filter).startsWith(effectGraphPrefix)) {
            flushLinear();
            const spec = JSON.parse(String(filter).slice(effectGraphPrefix.length));
            const next = `vfx_${stage++}`;
            graph.push(...compileTimelineVisualEffectDag(spec.graph, spec.options || {}, current, next));
            current = next;
            continue;
        }
        if (String(filter).startsWith(blurPrefix)) {
            flushLinear();
            const spec = JSON.parse(String(filter).slice(blurPrefix.length));
            const radii = [0.01, 10, 20, 30, 40, 50];
            const [base, ...sources] = Array.from({ length: radii.length + 1 }, () => `vfx_${stage++}`);
            const blurred = radii.map(() => `vfx_${stage++}`);
            const radius = `clip((${String(spec.radiusExpression).replace(/\bt\b/g, 'T')}),0,50)`;
            const splitPads = [`[${base}]`, ...sources.map(label => `[${label}]`)].join('');
            graph.push(`[${current}]split=${radii.length + 1}${splitPads}`);
            radii.forEach((value, index) => graph.push(`[${sources[index]}]gblur=sigma=${value}[${blurred[index]}]`));
            let mixed = blurred[0];
            for (let index = 1; index < radii.length; index++) {
                const next = `vfx_${stage++}`;
                const lower = radii[index - 1];
                const upper = radii[index];
                const mix = `clip((${radius}-${lower})/${upper - lower},0,1)`;
                graph.push(`[${mixed}][${blurred[index]}]blend=all_expr='A*(1-(${mix}))+B*(${mix})'[${next}]`);
                mixed = next;
            }
            const merged = `vfx_${stage++}`;
            const enable = spec.window
                ? `:enable='gte(t,${Number(spec.window.start).toFixed(6)})*lt(t,${Number(spec.window.end).toFixed(6)})'`
                : '';
            graph.push(`[${base}][${mixed}]overlay=shortest=1:format=auto${enable}[${merged}]`);
            current = merged;
            continue;
        }
        if (String(filter).startsWith(shakePrefix)) {
            flushLinear();
            const spec = JSON.parse(String(filter).slice(shakePrefix.length));
            const [base, source, shaken, merged] = [`vfx_${stage++}`, `vfx_${stage++}`, `vfx_${stage++}`, `vfx_${stage++}`];
            const width = Math.max(2, Math.ceil(Number(spec.width) / 2) * 2);
            const height = Math.max(2, Math.ceil(Number(spec.height) / 2) * 2);
            // Reserve enough source pixels for both the maximum animated
            // rotation and the shake translation. A fixed 1.08 zoom clipped
            // rotated portrait footage because its vertical dimension is
            // longer than its width.
            const rotationValue = Number(spec.rotation);
            const maxRotation = Number.isFinite(rotationValue)
                ? Math.max(0, Math.min(10, Math.abs(rotationValue)))
                : 10; // Animated tracks are clamped to 0–10 degrees above.
            const radians = maxRotation * Math.PI / 180;
            const aspect = width / height;
            const rotationCoverage = Math.cos(radians) + Math.sin(radians) * Math.max(aspect, 1 / aspect);
            const zoom = Math.max(1.1, rotationCoverage + 0.1);
            const scaledWidth = Math.ceil(width * zoom / 2) * 2;
            const scaledHeight = Math.ceil(height * zoom / 2) * 2;
            // Keep the deterministic camera path identical to
            // resolveTimelineEffectTransform in the editor preview. A former
            // one-sine export approximation made shakes visibly jump when a
            // project moved from preview to final render.
            const phase = `(t*${Number(spec.frequency)}*2*PI)`;
            const seed = Number(spec.seed);
            const x = `(iw-ow)/2+(sin(${phase}*1.17+${seed}*12.9898)*0.72+sin(${phase}*0.73+${seed}*7.31)*0.28)*(${spec.intensity})`;
            const y = `(ih-oh)/2+(sin(${phase}*0.91+100+${seed}*3.17)*0.68+sin(${phase}*1.31+${seed}*9.2)*0.32)*(${spec.intensity})`;
            const rotate = `sin(${phase}*0.83+200+${seed}*5.13)*(${spec.rotation})*PI/180`;
            graph.push(`[${current}]split[${base}][${source}]`);
            graph.push(`[${source}]scale=${scaledWidth}:${scaledHeight},rotate=a='${rotate}':c=black@0:ow=iw:oh=ih,crop=${width}:${height}:x='${x}':y='${y}'[${shaken}]`);
            const enable = spec.window
                ? `:enable='gte(t,${Number(spec.window.start).toFixed(6)})*lt(t,${Number(spec.window.end).toFixed(6)})'`
                : '';
            graph.push(`[${base}][${shaken}]overlay=shortest=1:format=auto${enable}[${merged}]`);
            current = merged;
            continue;
        }
        if (String(filter).startsWith(lutPrefix)) {
            flushLinear();
            const spec = JSON.parse(String(filter).slice(lutPrefix.length));
            const [base, source, graded, merged] = [`vfx_${stage++}`, `vfx_${stage++}`, `vfx_${stage++}`, `vfx_${stage++}`];
            graph.push(`[${current}]split[${base}][${source}]`);
            graph.push(`[${source}]${spec.filter}[${graded}]`);
            const enable = spec.window
                ? `:enable='gte(t,${Number(spec.window.start).toFixed(6)})*lt(t,${Number(spec.window.end).toFixed(6)})'`
                : '';
            graph.push(`[${base}][${graded}]blend=all_opacity=${Number(spec.intensity).toFixed(4)}${enable}[${merged}]`);
            current = merged;
            continue;
        }
        if (!String(filter).startsWith(prefix)) { linear.push(filter); continue; }
        flushLinear();
        const spec = JSON.parse(String(filter).slice(prefix.length));
        const [red, green, blue] = spec.color;
        const splitBase = `vfx_${stage++}`, splitBloom = `vfx_${stage++}`;
        const bloom = `vfx_${stage++}`, merged = `vfx_${stage++}`;
        const threshold = spec.thresholdExpression || Number(spec.threshold).toFixed(3);
        const intensity = spec.intensityExpression || Number(spec.intensity).toFixed(4);
        // Match the live SVG highlight mask: Rec. 709 luminance with a soft
        // ramp from threshold to white, followed by a tinted bloom overlay.
        const luminance = `(0.2126*r(X,Y)+0.7152*g(X,Y)+0.0722*b(X,Y))`;
        const alpha = `255*clip((${intensity})*clip((${luminance}-(${threshold}))/max(255-(${threshold}),1),0,1),0,1)`;
        const radius = Number(spec.radius).toFixed(3);
        graph.push(`[${current}]split[${splitBase}][${splitBloom}]`);
        const animatedRadius = spec.radiusExpression && Array.isArray(spec.radiusRange)
            && spec.radiusRange.length === 2 && spec.radiusRange[1] > spec.radiusRange[0];
        if (animatedRadius) {
            const [minRadius, maxRadius] = spec.radiusRange.map(value => Math.max(1, Math.min(50, Number(value))));
            const [radiusA, radiusB, blurA, blurB] = [`vfx_${stage++}`, `vfx_${stage++}`, `vfx_${stage++}`, `vfx_${stage++}`];
            const radiusMix = `clip((${spec.radiusExpression}-${minRadius.toFixed(4)})/${(maxRadius - minRadius).toFixed(4)},0,1)`;
            graph.push(`[${splitBloom}]format=rgba,geq=r='${red}':g='${green}':b='${blue}':a='${alpha}',split[${radiusA}][${radiusB}]`);
            graph.push(`[${radiusA}]gblur=sigma=${minRadius.toFixed(3)}[${blurA}]`);
            graph.push(`[${radiusB}]gblur=sigma=${maxRadius.toFixed(3)}[${blurB}]`);
            graph.push(`[${blurA}][${blurB}]blend=all_expr='A*(1-(${radiusMix}))+B*(${radiusMix})'[${bloom}]`);
        } else {
            graph.push(`[${splitBloom}]format=rgba,geq=r='${red}':g='${green}':b='${blue}':a='${alpha}',gblur=sigma=${radius}[${bloom}]`);
        }
        const enable = spec.window
            ? `:enable='gte(t,${Number(spec.window.start).toFixed(6)})*lt(t,${Number(spec.window.end).toFixed(6)})'`
            : '';
        graph.push(`[${splitBase}][${bloom}]overlay=shortest=1:format=auto${enable}[${merged}]`);
        current = merged;
    }
    flushLinear();
    if (!graph.length) graph.push(`[${input}]null[${output}]`);
    else graph.push(`[${current}]null[${output}]`);
    return graph;
}

/** Compile an explicit fork/join effect graph without flattening its branches.
 * Each join must be an authored `composite` node with `base` and `overlay`
 * ports; ambiguous joins fail export rather than changing the user's design. */
function compileTimelineVisualEffectDag(effectGraph, options = {}, inputLabel = '0:v', outputLabel = 'effect_dag_out') {
    const nodes = Array.isArray(effectGraph?.nodes) ? effectGraph.nodes : [];
    const connections = Array.isArray(effectGraph?.connections) ? effectGraph.connections : [];
    if (!nodes.length) return [`[${inputLabel}]null[${outputLabel}]`];
    const byId = new Map(nodes.map(node => [String(node.id), node]));
    if (byId.size !== nodes.length || nodes.some(node => !node?.id)) throw new Error('Cannot export effect graph: node IDs must be present and unique');
    const outgoing = new Map(nodes.map(node => [String(node.id), []]));
    const incoming = new Map(nodes.map(node => [String(node.id), []]));
    for (const edge of connections) {
        const from = String(edge?.from || ''), to = String(edge?.to || '');
        if (!byId.has(from) || !byId.has(to)) throw new Error('Cannot export effect graph: a connection references a missing node');
        outgoing.get(from).push(edge);
        incoming.get(to).push(edge);
    }
    const roots = nodes.filter(node => incoming.get(String(node.id)).length === 0);
    const sinks = nodes.filter(node => outgoing.get(String(node.id)).length === 0);
    if (roots.length !== 1 || sinks.length !== 1) throw new Error('Cannot export effect graph: expected exactly one input and one output');

    const pending = new Map(nodes.map(node => [String(node.id), incoming.get(String(node.id)).length]));
    const ready = roots.map(node => String(node.id));
    const ordered = [];
    while (ready.length) {
        const id = ready.shift();
        ordered.push(byId.get(id));
        for (const edge of outgoing.get(id)) {
            const remaining = pending.get(String(edge.to)) - 1;
            pending.set(String(edge.to), remaining);
            if (remaining === 0) ready.push(String(edge.to));
        }
    }
    if (ordered.length !== nodes.length) throw new Error('Cannot export effect graph: circular dependency detected');

    const graph = [];
    const edgeLabels = new Map();
    let labelIndex = 0;
    const fresh = prefix => `${prefix}_${labelIndex++}`;
    const unbracket = label => String(label).replace(/^\[|\]$/g, '');
    const nodeOut = new Map();
    const opts = { ...options };
    for (const node of ordered) {
        const id = String(node.id);
        const inputs = incoming.get(id);
        let source = unbracket(inputLabel);
        if (inputs.length === 1) source = edgeLabels.get(inputs[0]);
        if (inputs.length > 1) {
            const ports = new Map(inputs.map(edge => [edge.port, edgeLabels.get(edge)]));
            if ((node.type || node.kind) !== 'composite' || inputs.length !== 2 || ports.size !== 2 || !ports.has('base') || !ports.has('overlay')) {
                throw new Error(`Cannot export effect graph: join "${node.name || id}" needs base and overlay inputs on a composite node`);
            }
            const base = ports.get('base'), overlay = ports.get('overlay');
            const mode = String(node.params?.mode?.value ?? node.params?.mode ?? 'source-over').toLowerCase();
            const opacityRaw = Number(node.params?.opacity?.value ?? node.params?.opacity ?? 1);
            const opacity = Number.isFinite(opacityRaw) ? Math.max(0, Math.min(1, opacityRaw)) : 1;
            const opacityExpression = compileEffectKeyframeExpression(node, 'opacity', opacity, 0, 1, Number(opts.clipStart) || 0);
            const output = fresh('dag_composite');
            const window = timelineEffectWindow(node, Number(opts.clipStart) || 0, Number(opts.duration) || 0);
            if (node.enabled === false || !window.active) {
                graph.push(`[${base}]null[${output}]`);
            } else if (mode === 'normal' || mode === 'source-over') {
                const overlayInput = fresh('dag_overlay');
                if (opacityExpression) {
                    const animatedOpacity = String(opacityExpression).replace(/\bt\b/g, 'T');
                    graph.push(`[${overlay}]format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*clip((${animatedOpacity}),0,1)'[${overlayInput}]`);
                } else {
                    graph.push(`[${overlay}]format=rgba,colorchannelmixer=aa=${opacity.toFixed(6)}[${overlayInput}]`);
                }
                const enable = window.partial
                    ? `:enable='gte(t,${window.start.toFixed(6)})*lt(t,${window.end.toFixed(6)})'`
                    : '';
                graph.push(`[${base}][${overlayInput}]overlay=shortest=1:eof_action=pass:format=auto${enable}[${output}]`);
            } else {
                const { alphaBlendChannelExpression, SUPPORTED_BLEND_MODE_KINDS } = require('../server/compositor/CompositorCompiler.js');
                if (!SUPPORTED_BLEND_MODE_KINDS.includes(mode)) {
                    throw new Error(`Cannot export effect graph: unsupported composite blend mode "${mode}"`);
                }
                const width = Math.max(1, Math.round(Number(opts.width) || 1920));
                const baseRgba = fresh('dag_base_rgba');
                const overlayRgba = fresh('dag_overlay_rgba');
                const pair = fresh('dag_blend_pair');
                const baseOffset = width;
                const staticOpacity = opacityExpression ? null : opacity;
                const activeOpacity = opacityExpression
                    ? String(opacityExpression).replace(/\bt\b/g, 'T')
                    : String(staticOpacity);
                const activeWindow = window.partial
                    ? `*if(gte(T,${window.start.toFixed(6)})*lt(T,${window.end.toFixed(6)}),1,0)`
                    : '';
                const alphaFactor = `clip((${activeOpacity}),0,1)${activeWindow}`
                    .replace(/(?<!\\),/g, '\\,');
                const alphaProcessedOverlay = fresh('dag_overlay_opacity');
                graph.push(`[${base}]format=rgba[${baseRgba}]`);
                if (opacityExpression || window.partial) {
                    graph.push(`[${overlay}]format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*${alphaFactor}'[${alphaProcessedOverlay}]`);
                } else if (staticOpacity < 1) {
                    graph.push(`[${overlay}]format=rgba,colorchannelmixer=aa=${staticOpacity.toFixed(6)}[${alphaProcessedOverlay}]`);
                } else {
                    graph.push(`[${overlay}]format=rgba[${alphaProcessedOverlay}]`);
                }
                graph.push(`[${baseRgba}][${alphaProcessedOverlay}]hstack=inputs=2:shortest=1[${pair}]`);
                const alpha = `255*(alpha(X+${baseOffset},Y)/255+(alpha(X,Y)/255)*(1-alpha(X+${baseOffset},Y)/255))`;
                graph.push(`[${pair}]geq=r='${alphaBlendChannelExpression(mode, 'r', baseOffset)}':g='${alphaBlendChannelExpression(mode, 'g', baseOffset)}':b='${alphaBlendChannelExpression(mode, 'b', baseOffset)}':a='${alpha}',crop=${width}:${Math.max(1, Math.round(Number(opts.height) || 1080))}:0:0[${output}]`);
            }
            nodeOut.set(id, output);
        } else if (node.type === 'composite' || node.kind === 'composite') {
            throw new Error(`Cannot export effect graph: composite node "${node.name || id}" requires base and overlay inputs`);
        } else if (node.enabled === false || node.engine === 'ai') {
            nodeOut.set(id, source);
        } else {
            const window = timelineEffectWindow(node, Number(opts.clipStart) || 0, Number(opts.duration) || 0);
            if (!window.active) {
                nodeOut.set(id, source);
            } else {
            const filters = compileTimelineVisualEffects([node], opts);
            if (!filters.length) {
                throw new Error(`Cannot export effect graph: effect "${node.name || id}" (${node.type || node.kind || 'unknown'}) has no visual export implementation`);
            } else {
                const output = fresh('dag_node');
                const labels = compileTimelineVisualEffectGraph(filters, { input: source, output });
                const nodePrefix = `dag_node_graph_${labelIndex}_`;
                graph.push(...labels.map(line => line.replace(/\bvfx_(\d+)\b/g, `${nodePrefix}$1`)));
                nodeOut.set(id, output);
            }
            }
        }

        const edges = outgoing.get(id);
        if (edges.length === 1) edgeLabels.set(edges[0], nodeOut.get(id));
        else if (edges.length > 1) {
            const labels = edges.map(() => fresh('dag_branch'));
            graph.push(`[${nodeOut.get(id)}]split=${edges.length}${labels.map(label => `[${label}]`).join('')}`);
            edges.forEach((edge, index) => edgeLabels.set(edge, labels[index]));
        }
    }
    graph.push(`[${nodeOut.get(String(sinks[0].id))}]null[${outputLabel}]`);
    return graph;
}

// ─── Main job handler ─────────────────────────────────────────────────────────

module.exports = async function processExportJob(job) {
    const startTime = Date.now();
    const { timeline, settings = {}, userId = 'anonymous', assetMap = {} } = job.data;
    // Share the exact keyframe/easing implementation with scene preview when
    // resolving animated source-time remaps for nested video layers.
    const { sampleKeyframeTrack } = await import('../client/src/motion/MotionResolver.js');

    await job.updateProgress(2);

    // ── Resolve platform / resolution settings ─────────────────────────────
    const platform   = settings.platform && PLATFORM_PRESETS[settings.platform] ? PLATFORM_PRESETS[settings.platform] : null;
    const resPreset  = RESOLUTION_PRESETS[settings.resolution] || RESOLUTION_PRESETS['1080p'];
    // A platform preset (tiktok/reels/shorts/youtube) already names an exact
    // orientation the user explicitly opted into — leave those untouched.
    // Otherwise derive from the PROJECT's actual aspect ratio (see
    // ASPECT_RATIO_DIMENSIONS/getResolutionDimensions above) instead of
    // blindly using resPreset's bare (always-16:9) width/height — that blind
    // default was the real cause of captions (and the whole frame) rendering
    // at the wrong size/orientation for any non-16:9 project exported
    // without an explicit platform selected.
    const resolvedDims = platform || getResolutionDimensions(settings.aspectRatio, settings.resolution);

    const targetWidth  = platform?.width  || resolvedDims.width;
    const targetHeight = platform?.height || resolvedDims.height;
    const targetFps    = platform?.fps    || settings.fps    || 30;
    const codec        = platform?.codec  || 'libx264';
    const profile      = platform?.profile || 'high';

    // ── Caption font-size resolution correction ────────────────────────────
    // `clip.fontSize`/`clip.stroke.width` are authored in the project's
    // REFERENCE resolution for its aspect ratio (ASPECT_RATIO_DIMENSIONS
    // above — the same table client/src/utils/playerDimensions.js uses for
    // the live `<Player>`). That equals `targetWidth` exactly for the common
    // case (no platform preset, default '1080p' resolution tier), which is
    // why the earlier R57/clip.scale fix looked complete on its own. It is
    // NOT equal whenever a DIFFERENT resolution tier is chosen — '720p'/'2k'/
    // '4k' all scale targetWidth/targetHeight by getResolutionDimensions()
    // above, but nothing scaled the caption font/stroke to match, so a
    // caption authored (and correctly shown) at the 1080p reference came out
    // proportionally too big at 720p and too small at 2k/4k. Computed once
    // here and applied to BOTH caption render paths below (the plain
    // per-clip drawtext loop and the animated captionProgram path).
    const captionRefDims = ASPECT_RATIO_DIMENSIONS[settings.aspectRatio] || ASPECT_RATIO_DIMENSIONS['16:9'];
    const captionScaleFactor = targetWidth / captionRefDims.width;

    let videoBitrate;
    switch (settings.quality) {
        case 'high':   videoBitrate = platform?.bitrate || '8000k';  break;
        case 'medium': videoBitrate = '5000k'; break;
        case 'low':    videoBitrate = '2000k'; break;
        default:       videoBitrate = platform?.bitrate || resPreset.bitrate;
    }

    const audioBitrate = platform?.audioBitrate || '192k';

    console.log(`🎬 [ExportJob ${job.id}] ${targetWidth}x${targetHeight} @ ${targetFps}fps | ${videoBitrate} | ${platform?.label || settings.resolution || '1080p'}`);

    // ── Gather clips ───────────────────────────────────────────────────────
    const videoTracks = timeline.tracks.filter(t =>
        (t.type === 'video' || t.type === 'image') && t.clips?.length > 0
    );
    const audioTracks = timeline.tracks.filter(t =>
        t.type === 'audio' && t.clips?.length > 0
    );
    // Revideo owns supported text tracks only. All timeline visual layers
    // stay on the FFmpeg compositor, so a later Revideo failure cannot remove
    // footage overlays, stickers, or templates.
    const allTextTracks    = timeline.tracks.filter(t => t.type === 'text'    && t.clips?.length > 0);
    const revideoTextTracks = allTextTracks.filter(track => isRevideoTrackSupported(track, timeline.audioWaveformsByAsset));
    // Revideo stays opt-in. Without it, STEP 4 draws text using the built-in
    // renderer; STEP 2.5 always composites visual layers either way.
    const alphaGraphicsExportRequested = ['transparent-png-sequence', 'transparent-mov']
        .includes(String(settings.format || '').toLowerCase());
    // Transparent graphics exports need the local caption layer descriptions
    // so they can be composited over an alpha-preserving base. Keep captions
    // on the shared local renderer for that export rather than rendering them
    // only into the flattened Revideo pass.
    const revideoEnabled = !alphaGraphicsExportRequested
        && process.env.REVIDEO_RENDER_ENABLED === '1' && !!process.env.RENDER_WORKER_URL;
    // Revideo only takes ownership of supported text tracks. Visual assets
    // are composited by STEP 2.5 in every case, before this optional text pass.
    const hasUnsupportedTextTracks = allTextTracks.length !== revideoTextTracks.length;
    let useRevideo = revideoEnabled && !hasUnsupportedTextTracks && revideoTextTracks.length > 0;
    let revideoSucceeded = false;
    let revideoWarning = null;
    // Check the worker before attempting the optional text pass. A down worker
    // leaves the built-in text renderer and the already-composited visuals in
    // place.
    if (useRevideo && !(await revideoWorkerHealthy())) {
        useRevideo = false;
        revideoWarning = 'The text renderer was unreachable, so the built-in renderer drew the captions.';
        console.warn('  ⚠️  Revideo worker unhealthy, falling back to the built-in renderer');
    }

    if (videoTracks.length === 0) {
        throw new Error('No video or image clips found in timeline');
    }

    const uploadsDir = path.join(__dirname, '../uploads/temp');
    const publicDir  = path.join(__dirname, '../client/public');
    const exportsDir = path.join(__dirname, '../uploads/exports');
    if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });

    const jobId      = `render-${job.id}-${Date.now()}`;
    const outputPath = path.join(exportsDir, `${jobId}.mp4`);
    const tmpDir     = path.join(exportsDir, jobId);
    fs.mkdirSync(tmpDir, { recursive: true });

    // ── URL/GCS helpers ────────────────────────────────────────────────────
    const bucketName = process.env.GCS_BUCKET_NAME || 'viral-pilot_bucket';

    const sanitizeFilename = (name) =>
        name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');

    const gcsPathFromStorageUrl = (url) => {
        if (!url || !url.startsWith(`https://storage.googleapis.com/${bucketName}/`)) return null;
        try { return decodeURIComponent(new URL(url).pathname.replace(`/${bucketName}/`, '')); }
        catch (_) { return null; }
    };

    const gcsPathFromProxyUrl = (url) => {
        if (!url) return null;
        const match = url.match(/\/api\/proxy\/gcs-media\/([^?#]+)/);
        return match ? decodeURIComponent(match[1]) : null;
    };

    const resolveGcsPath = async (clip) => {
        let effectiveClip = clip;
        if (clip.assetId && assetMap[clip.assetId]) {
            const asset = assetMap[clip.assetId];
            const hasUsableUrl = isServerUsableUrl(clip.sourceUrl) || isServerUsableUrl(clip.url) || isServerUsableUrl(clip.proxyUrl);
            if (!hasUsableUrl) {
                effectiveClip = { ...clip, sourceUrl: asset.sourceUrl, url: asset.proxyUrl || asset.url, proxyUrl: asset.proxyUrl };
            }
        }

        const candidates = [effectiveClip.sourceUrl, effectiveClip.url, effectiveClip.src, effectiveClip.videoUrl, effectiveClip.proxyUrl];

        for (const raw of candidates) {
            const p = gcsPathFromStorageUrl(raw);
            if (p) return p;
        }
        for (const raw of candidates) {
            const p = gcsPathFromProxyUrl(raw);
            if (p) return p;
        }

        const assetForClip = clip.assetId ? assetMap[clip.assetId] : null;
        const filename = effectiveClip.originalName || assetForClip?.name || effectiveClip.name || clip.name;
        if (!filename || !gcsBucket) return null;

        const safeName = sanitizeFilename(filename);
        const rawName  = filename;

        let listUserId = userId;
        if (listUserId === 'anonymous') {
            const proxyUrls = [effectiveClip.proxyUrl, effectiveClip.url, effectiveClip.sourceUrl, clip.proxyUrl, clip.url, clip.sourceUrl];
            for (const raw of proxyUrls) {
                const m = raw?.match(/\/api\/proxy\/gcs-media\/(?:proxies|raw)\/([^/]+)\//);
                if (m) { listUserId = m[1]; break; }
            }
        }

        for (const name of [rawName, safeName]) {
            if (!name) continue;
            const exactPath = `raw/${listUserId}/${name}`;
            try {
                const [exists] = await gcsBucket.file(exactPath).exists();
                if (exists) return exactPath;
            } catch (_) {}
        }

        try {
            const [files] = await gcsBucket.getFiles({ prefix: `raw/${listUserId}/` });
            const match = files.find(f => {
                const base = f.name.split('/').pop();
                return base === rawName || base === safeName
                    || base.endsWith(`-${rawName}`) || base.endsWith(`-${safeName}`);
            });
            if (match) return match.name;
        } catch (_) {}

        return null;
    };

    const fetchClipSource = async (clip, localPath) => {
        let c = clip;
        if (clip.assetId && assetMap[clip.assetId] && !(isServerUsableUrl(clip.sourceUrl) || isServerUsableUrl(clip.url) || isServerUsableUrl(clip.proxyUrl))) {
            const asset = assetMap[clip.assetId];
            c = { ...clip, sourceUrl: asset.sourceUrl, url: asset.proxyUrl || asset.url, proxyUrl: asset.proxyUrl };
        }

        if (gcsBucket) {
            // ── 1. Try proxy/storage URL from clip metadata ──────────────────
            const gcsPath = await resolveGcsPath(c);
            if (gcsPath) {
                console.log(`[ExportJob] GCS download: ${gcsPath}`);
                try {
                    await gcsBucket.file(gcsPath).download({ destination: localPath });
                    return localPath;
                } catch (gcsErr) {
                    console.warn(`[ExportJob] GCS proxy download failed (${gcsPath}): ${gcsErr.message} — trying raw file`);
                }
            }

            // ── 2. Try raw/{userId}/{filename} — uploaded by proxyRoutes ────
            const clipName = c.name || clip.name;
            if (clipName) {
                const safeName = sanitizeFilename(clipName);
                for (const name of [clipName, safeName]) {
                    if (!name) continue;
                    const rawPath = `raw/${userId}/${name}`;
                    try {
                        const [exists] = await gcsBucket.file(rawPath).exists();
                        if (exists) {
                            console.log(`[ExportJob] GCS raw fallback: ${rawPath}`);
                            await gcsBucket.file(rawPath).download({ destination: localPath });
                            return localPath;
                        }
                    } catch (_) {}
                }
                // Try listing in case filename was prefixed with a timestamp
                try {
                    const [files] = await gcsBucket.getFiles({ prefix: `raw/${userId}/` });
                    const match = files.find(f => {
                        const base = f.name.split('/').pop();
                        return base === clipName || base === safeName
                            || base.endsWith(`-${clipName}`) || base.endsWith(`-${safeName}`);
                    });
                    if (match) {
                        console.log(`[ExportJob] GCS raw fallback (listed): ${match.name}`);
                        await gcsBucket.file(match.name).download({ destination: localPath });
                        return localPath;
                    }
                } catch (_) {}
            }
        }

        // ── 3. Local filesystem (monolith / dev mode) ────────────────────────
        const localSrc = resolveSourcePath(c, uploadsDir);
        if (localSrc) return localSrc;

        // ── 3b. Bundled static audio (`/sfx-library/<file>`) ─────────────────
        // Every generated sound effect carries this URL shape: the SFX library
        // ships as static files next to the SPA build (client/public/sfx-library,
        // the same pattern as the bundled fonts), so `preview_url` is a ROOT-
        // RELATIVE path, not an absolute URL and not a storage object.
        //
        // It therefore matched nothing: step 1 has no asset row, step 2 has no
        // GCS object, step 4 requires `startsWith('http')`, and step 5 requires
        // `/api/proxy/`. `fetchClipSource` returned null and every placed sound
        // effect was dropped from the render with "Could not find: Cinematic
        // Impact, Metal Impact, ..." — a complete, silent loss of the sound
        // design on a path that otherwise worked end to end.
        //
        // routes/waveformRoutes.js already had to solve exactly this to extract
        // waveforms for the same clips; the resolver is now shared rather than
        // reimplemented (utils/waveformPath.js).
        for (const candidateUrl of [c.sourceUrl, c.url, c.src, clip.sourceUrl, clip.url, clip.src]) {
            const staticRel = resolveStaticAudioPath(candidateUrl);
            if (!staticRel) continue;
            const staticFile = resolveStaticAudioFile(staticRel);
            if (staticFile) {
                console.log(`[ExportJob] bundled static audio: ${staticRel}`);
                return staticFile;
            }
            // The URL was the right shape but the file is not on this machine —
            // worth saying out loud, because it means the worker image shipped
            // without the SPA's static assets and EVERY sound effect will be
            // missing, not just this one.
            console.warn(`[ExportJob] "${staticRel}" is not present on the worker — is the SPA build included in this image?`);
        }

        // ── 4. Absolute HTTP URLs (signed GCS URLs, CDN, etc.) ───────────────
        for (const raw of [c.sourceUrl, c.url, c.src, c.videoUrl]) {
            if (raw && !raw.startsWith('blob:') && !raw.includes('/api/proxy') && raw.startsWith('http')) {
                let safeUrl = raw;
                try {
                    const parsed = new URL(raw);
                    parsed.pathname = parsed.pathname.split('/').map(seg => encodeURIComponent(decodeURIComponent(seg))).join('/');
                    safeUrl = parsed.toString();
                } catch (_) {}
                try {
                    await downloadToTemp(safeUrl, localPath);
                    return localPath;
                } catch (httpErr) {
                    console.warn(`[ExportJob] HTTP download failed (${raw}): ${httpErr.message}`);
                }
            }
        }

        // ── 5. Proxy URL via internal server URL (cross-container fallback) ──
        const proxyRelUrl = c.proxyUrl || c.url;
        if (proxyRelUrl && proxyRelUrl.startsWith('/api/proxy/')) {
            const serverBase = process.env.PUBLIC_URL
                || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null)
                || `http://localhost:${process.env.PORT || 3000}`;
            const fullUrl = `${serverBase.replace(/\/$/, '')}${proxyRelUrl}`;
            try {
                console.log(`[ExportJob] Internal proxy download: ${fullUrl}`);
                // Server-to-server: the media route is owner-only, so the
                // worker identifies itself (services/mediaAccess.js).
                await downloadToTemp(fullUrl, localPath,
                    process.env.WORKER_SECRET ? { 'X-Worker-Secret': process.env.WORKER_SECRET } : undefined);
                return localPath;
            } catch (err) {
                console.warn(`[ExportJob] Internal proxy download failed: ${err.message}`);
            }
        }

        console.warn(`[ExportJob] Cannot resolve source for clip "${clip.name}" — skipping`);
        return null;
    };

    // ── Collect & sort clips ───────────────────────────────────────────────
    const baseEffectSamples = new Map((settings.compositionPlan?.base?.effectsByClip || [])
        .map(entry => [entry.clipId, entry.effects || []]));
    let allClips = [];
    for (const track of videoTracks) {
        for (const clip of track.clips) {
            const authoredEffects = applyEffectSamples(clip.effects, baseEffectSamples.get(clip.id));
            const effects = authoredEffects
                .filter(effect => effect && effect.enabled !== false)
                .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
            const speedResult = resolveTimelineSpeedEffect(effects, Number(clip.start) || 0, Number(clip.duration) || 0);
            allClips.push({
                ...clip,
                ...(speedResult.speed !== null ? { speed: speedResult.speed } : {}),
                ...(speedResult.maintainPitch !== null ? { speedChangeMaintainPitch: speedResult.maintainPitch } : {}),
                ...(speedResult.retime ? { _speedRetime: speedResult.retime } : {}),
                ...(speedResult.warning ? { _effectWarning: speedResult.warning } : {}),
                trackVolume: track.volume ?? 1.0
            });
        }
    }
    allClips.sort((a, b) => a.start - b.start);

    const scaleFilter = buildScaleFilter(targetWidth, targetHeight);

    // ── Project colour grade (LUT) ──────────────────────────────────────────
    // server/lut-engine/library/LUTExportIntegration.js has always known how to
    // download a .cube and build the `lut3d` filter string — nothing ever called
    // it, so selecting a LUT changed no pixel in the export (nor in the preview;
    // see R55). Resolved ONCE per job rather than per clip: it downloads a file,
    // and the grade is a project-level setting.
    //
    // FAILS OPEN BY DESIGN: getLUTFilterForExport() returns null on every error
    // path (missing LUT, no gcs_path, download failure), and a null simply means
    // no filter is added. An export must never fail because a colour grade could
    // not be fetched — an ungraded video is a far better outcome than no video.
    let lutFilter = null;
    const projectLUTId = settings.projectLUTId || timeline?.projectLUTId || null;
    if (projectLUTId) {
        try {
            const { lutExportIntegration } = require('../server/lut-engine/library/LUTExportIntegration.js');
            lutFilter = await lutExportIntegration.getLUTFilterForExport(projectLUTId, tmpDir);
            console.log(lutFilter
                ? `🎨 [ExportJob ${job.id}] LUT ${projectLUTId} applied: ${lutFilter}`
                : `🎨 [ExportJob ${job.id}] LUT ${projectLUTId} could not be resolved — exporting ungraded`);
        } catch (lutErr) {
            console.warn(`[ExportJob ${job.id}] LUT lookup failed (exporting ungraded):`, lutErr.message);
            lutFilter = null;
        }
    }

    // Resolve per-clip LUTs through the same trusted library as project LUTs.
    // The effect stores an asset id, never an arbitrary worker filesystem path.
    const clipLutFilters = new Map();
    const clipLutIds = [...new Set(allClips.flatMap(clip => (clip.effects || [])
        .filter(effect => effect && effect.enabled !== false && (effect.kind || effect.type) === 'lut_apply')
        .map(effect => String(effectParam(effect, 'lutId', effectParam(effect, 'lut', '')) || ''))
        .filter(Boolean)))];
    if (clipLutIds.length) {
        try {
            const { lutExportIntegration } = require('../server/lut-engine/library/LUTExportIntegration.js');
            for (const lutId of clipLutIds) {
                const filter = await lutExportIntegration.getLUTFilterForExport(lutId, tmpDir);
                if (filter) clipLutFilters.set(lutId, filter);
            }
        } catch (lutErr) {
            console.warn(`[ExportJob ${job.id}] Per-clip LUT lookup failed:`, lutErr.message);
        }
    }

    // Resolve selective per-clip grades once, before segment rendering. A
    // 17³ cube is a good export-quality/performance tradeoff and identical
    // grades share the same generated file within this job.
    const selectiveGradeFilters = new Map();
    for (const clip of allClips) {
        const grading = clip.grading;
        if (!grading || !hasSelectiveGrade(grading.selective, grading.hueRotate)) continue;
        const signature = JSON.stringify({ selective: grading.selective || {}, hueRotate: Number(grading.hueRotate) || 0 });
        let filter = selectiveGradeFilters.get(signature);
        if (!filter) {
            const cubePath = path.join(tmpDir, `selective-grade-${selectiveGradeFilters.size}.cube`);
            fs.writeFileSync(cubePath, buildSelectiveGradeCube(grading.selective, grading.hueRotate), 'utf8');
            const escapedPath = cubePath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
            filter = `lut3d='${escapedPath}'`;
            selectiveGradeFilters.set(signature, filter);
        }
        clip._selectiveGradeFilter = filter;
    }

    await job.updateProgress(5);

    // ── STEP 1: Trim each clip into a segment ──────────────────────────────
    const segments = [];
    // Caption timing: track the output-video start time for every successful
    // segment so that STEP 4 can map Vibed-timeline positions → output times.
    // The output video concatenates clips back-to-back (no gaps), so a caption
    // at Vibed t=30 could appear at output t=12 if there were 18 seconds of
    // gaps or deliberate empty space before that point in the Vibed timeline.
    const segOutputStarts = []; // output video start time (s) for each segment
    const segClips        = []; // allClips entry that produced each segment
    let   cumulativeOut   = 0;  // running total output duration (s)
    // A clip whose source never resolves (video OR audio — same cause, same
    // fix below) used to just vanish from the render while the job still
    // reported success. Collected here and folded into clipWarning, the same
    // way compositorWarning/captionWarning already surface a degraded export
    // instead of a silently wrong one.
    const skippedClips = [];
    const effectWarnings = [
        ...collectTimelineEffectWarnings(allClips, { clipLutFilters }),
        ...allClips.filter(clip => clip._effectWarning).map(clip => `${clip.name || 'A clip'}: ${clip._effectWarning}`),
        ...audioTracks.flatMap(track => (track.clips || []).flatMap(clip => {
            const speedResult = resolveTimelineSpeedEffect(clip.effects, Number(clip.start) || 0, Number(clip.duration) || 0);
            return speedResult.warning ? [`${clip.name || 'An audio clip'}: ${speedResult.warning}`] : [];
        }))
    ];
    const sandwichRenderedClipIds = new Set();

    for (let i = 0; i < allClips.length; i++) {
        const clip    = allClips[i];
        const ext     = path.extname(clip.name || '.mp4') || '.mp4';
        const dlPath  = path.join(tmpDir, `dl-${i}${ext}`);
        const src     = await fetchClipSource(clip, dlPath);

        if (!src) {
            console.warn(`⚠️  [ExportJob] No source for "${clip.name}", skipping`);
            skippedClips.push(clip.name || 'a clip');
            continue;
        }

        const segPath = path.join(tmpDir, `seg-${i}.mp4`);
        const inPoint = clip.offset || 0;
        // `duration` is TIMELINE length (= output length); the clip shows
        // duration × speed seconds of SOURCE from `offset` (the store's model,
        // client/src/timeline/speedChange.js). fluent's setDuration() is an
        // OUTPUT -t, so it is `dur`: -ss seeks the source, setpts/atempo play
        // it at `speed`, -t stops after the clip's timeline length. It used to
        // be dur / speed, so a 2x clip exported at half its length (0.25x at
        // 4x its length) and every later caption drifted.
        const dur     = clip.duration;
        const vol     = (clip.volume ?? 1.0) * (clip.trackVolume ?? 1.0);
        const speed   = clip.speed || 1.0;
        const isImage = clip.type === 'image';
        const speedRetime = !isImage ? clip._speedRetime : null;

        // R67 — "blur background" (Object Intelligence). A genuinely different
        // render path (two-input alpha compositing, see
        // renderBackgroundBlurSegment's header for why this is a separate
        // function rather than another branch inside the shared vFilters
        // pipeline below). Handled and `continue`d here so every clip WITHOUT
        // layerTarget:'background' goes through the existing, unmodified path.
        if (!isImage && clip.layerTarget === 'background' && (clip.layerMask?.maskAssetPath || clip.layerMask?.maskAssetUrl)) {
            try {
                const maskLocalPath = path.join(tmpDir, `mask-${i}.mp4`);
                await fetchMaskToLocal(clip.layerMask, maskLocalPath);
                let bgImagePath = null;
                const bgUrl = clip.layerMask?.settings?.mode === 'image' ? clip.layerMask.settings.imageUrl : null;
                if (bgUrl) {
                    try {
                        bgImagePath = path.join(tmpDir, `mattebg-${i}${path.extname(String(bgUrl).split('?')[0]) || '.png'}`);
                        await downloadUrlToFile(bgUrl, bgImagePath);
                    } catch (bgErr) {
                        console.warn(`  [matte] background image unavailable, using blur: ${bgErr.message}`);
                        bgImagePath = null;
                    }
                }

                // Pillar G: Depth Sandwich — render text & graphics designated as behind_subject
                let sandwichFilter = null;
                try {
                    const { isBehindSubject } = await loadDepthCompositor();
                    const allTimelineClips = (timeline.tracks || []).flatMap(t => t.clips || []);
                    const clipStart = Number(clip.start) || 0;
                    const clipEnd = clipStart + (Number(clip.duration) || 0);
                    const sandwichClips = allTimelineClips.filter(c => {
                        if (!c || !isBehindSubject(c)) return false;
                        const cStart = Number(c.start) || 0;
                        const cEnd = cStart + (Number(c.duration) || 0);
                        return Math.max(cStart, clipStart) < Math.min(cEnd, clipEnd);
                    });

                    if (sandwichClips.length > 0) {
                        const filterParts = [];
                        for (let sIdx = 0; sIdx < sandwichClips.length; sIdx++) {
                            const sClip = sandwichClips[sIdx];
                            sandwichRenderedClipIds.add(sClip.id);
                            if (sClip.type === 'text' || sClip.content) {
                                const rawText = sClip.content || sClip.name || '';
                                const textFilePath = path.join(tmpDir, `sandwich-text-${i}-${sIdx}.txt`);
                                fs.writeFileSync(textFilePath, rawText, 'utf8');
                                const escapedTextFile = textFilePath.replace(/\\/g, '/').replace(/:/g, '\\:');
                                const xPct = Number(sClip.x) || 50;
                                const yPct = Number(sClip.y) || 50;
                                const fsPx = Math.round((Number(sClip.fontSize) || 48) * (targetWidth / 1080));
                                const fontColor = sClip.color || '#ffffff';
                                const xExpr = `(w*${(xPct / 100).toFixed(4)}-text_w/2)`;
                                const yExpr = `(h*${(yPct / 100).toFixed(4)}-text_h/2)`;
                                filterParts.push(`drawtext=textfile='${escapedTextFile}':fontsize=${fsPx}:fontcolor=${fontColor}:x=${xExpr}:y=${yExpr}`);
                            }
                        }
                        if (filterParts.length > 0) {
                            sandwichFilter = filterParts.join(',');
                            console.log(`  🥪 [depth-sandwich] clip "${clip.name}": compositing ${sandwichClips.length} element(s) behind subject`);
                        }
                    }
                } catch (depthErr) {
                    console.warn(`  [depth-sandwich] could not compile sandwich layer: ${depthErr.message}`);
                }

                await renderMattedSegment(clip, src, segPath, {
                    targetWidth, targetHeight, targetFps, codec, profile, audioBitrate,
                    maskLocalPath, bgImagePath, sandwichFilter, clipLutFilters,
                });
                segments.push(segPath);
                segOutputStarts.push(cumulativeOut);
                segClips.push(clip);
                // The segment is cut to exactly `dur` timeline seconds (speed applied inside).
                cumulativeOut += dur;
                console.log(`  [matte] clip "${clip.name}": background ${clip.layerMask?.settings?.mode || 'blur'}`);
            } catch (err) {
                console.error(`[ExportJob] background removal failed for clip "${clip.name}", exporting it unchanged: ${err.message}`);
                // Fail-open: an export never hard-fails because one effect could not render.
            }
            if (segments[segments.length - 1] === segPath) continue;
        }

        // Phones store portrait clips as landscape + a rotation matrix. FFmpeg's
        // own autorotation (left ON, see below) turns them upright before our
        // filters run and leaves the matrix out of the output. Probed only for
        // the log line.
        //
        // It used to be the other way round: -noautorotate plus a manual
        // transpose chosen from this probe. The probe read the wrong field (see
        // rotationFromProbeStream), so every iPhone clip came back as 0 and got
        // no transpose, and -noautorotate copied the rotation matrix onto the
        // segment: a 1080x1920 file that players turned into a 1920x1080 frame
        // with the speaker pillarboxed in the middle. The caption pass then
        // burned the captions onto that landscape frame. That was "the exported
        // size isn't right / captions are the wrong size", even with a 9:16
        // platform preset.
        const rotation = isImage ? 0 : await getVideoRotation(src);
        if (rotation) console.log(`  [rotate] clip "${clip.name}": stored at ${rotation}°, auto-rotated upright`);

        // R99 — freeform zone blur. Loaded here (outside the synchronous
        // Promise executor below) since dynamic import() needs an await;
        // null when the clip carries no blurZone, so the branch below is a
        // single, cheap truthiness check per clip.
        const zb = clip.blurZone ? await loadZoneBlur() : null;
        const retimeHasAudio = speedRetime ? await hasAudioStream(src) : null;
        const videoOnlyPath = speedRetime ? path.join(tmpDir, `retimed-video-${i}.mp4`) : segPath;

        await new Promise((resolve, reject) => {
            let cmd;
            if (isImage) {
                cmd = ffmpeg().input(src).inputOptions(['-loop', '1']).setDuration(dur);
            } else {
                // FFmpeg autorotates by default (rotation matrix applied before
                // the filters, and not copied to the output). Never pass
                // -noautorotate here: see the rotation note above.
                cmd = ffmpeg(src)
                    .setStartTime(inPoint)
                    .setDuration(dur);
            }

            // Virtual multicam crop (clip.virtualCam) — the editor preview applies
            // this via PlaybackEngine's UV sub-region sampling (u_cropOffset /
            // u_cropSize); the export must mirror it or multicam projects come out
            // 100% wide. Placement matters: AFTER rotation correction (coords are
            // in the upright frame the user saw in preview) and BEFORE scaling
            // (coords are fractions of the source frame, not the output frame).
            const vc = clip.virtualCam;
            const hasCrop = vc && typeof vc.cropW === 'number' && typeof vc.cropH === 'number'
                && (vc.cropW < 0.999 || vc.cropH < 0.999);
            // R100: calculate transform fit against the post-crop media bounds,
            // matching the preview order (virtual camera crop, then layer transform).
            const hasBaseTransform = hasBaseClipTransform(clip);
            const opacityKfs = Array.isArray(clip.keyframes?.opacity) && clip.keyframes.opacity.length ? clip.keyframes.opacity : null;
            const rotationKfs = Array.isArray(clip.keyframes?.rotation) && clip.keyframes.rotation.length ? clip.keyframes.rotation : null;
            const baseTransform = hasBaseTransform
                ? buildTransformFilters(opacityKfs || rotationKfs ? { ...clip, ...(opacityKfs ? { opacity: 1 } : {}), ...(rotationKfs ? { rotation: 0 } : {}) } : clip, targetWidth, targetHeight)
                : null;
            // Camera track: scale keyframes (zoom rhythm, KeyframeEditor, camera
            // presets) plus panX/panY (camera shake/whip/pan, from
            // CameraMotionCompiler). Images get it too: a base-track photo
            // with a Ken Burns / zoom animation now moves in the export.
            const scaleKfs = clip.keyframes && Array.isArray(clip.keyframes.scale) && clip.keyframes.scale.length
                ? clip.keyframes.scale
                : null;
            const scaleXKfs = Array.isArray(clip.keyframes?.scaleX) && clip.keyframes.scaleX.length ? clip.keyframes.scaleX : null;
            const scaleYKfs = Array.isArray(clip.keyframes?.scaleY) && clip.keyframes.scaleY.length ? clip.keyframes.scaleY : null;
            const panX = Array.isArray(clip.keyframes?.panX) && clip.keyframes.panX.length ? clip.keyframes.panX : null;
            const panY = Array.isArray(clip.keyframes?.panY) && clip.keyframes.panY.length ? clip.keyframes.panY : null;
            const positionX = Array.isArray(clip.keyframes?.x) && clip.keyframes.x.length ? clip.keyframes.x : null;
            const positionY = Array.isArray(clip.keyframes?.y) && clip.keyframes.y.length ? clip.keyframes.y : null;

            const vFilters = [];
            const aFilters = [];
            const windowedAudioEffects = hasPartialTimelineAudioEffects(clip.effects, Number(clip.start) || 0, dur);
            // Scale keyframes animate on clip-local TIMELINE time, so the speed
            // change runs first whenever a zoom follows (spatial filters do not
            // care about timestamps, so this order changes nothing else).
            const hasZoomKfs = !!(scaleKfs || scaleXKfs || scaleYKfs || panX || panY || positionX || positionY);
            const transformMotion = {
                positionX, positionY,
                width: baseTransform?.sourceW || targetWidth,
                height: baseTransform?.sourceH || targetHeight,
            };
            const speedFirst = !isImage && speed !== 1.0 && hasZoomKfs;
            if (speedRetime) vFilters.push(speedRetime.videoFilter);
            else if (speedFirst) vFilters.push(`setpts=${(1 / speed).toFixed(4)}*PTS`);

            const isAspectChangingCrop = hasCrop && (vc.reframe || Math.abs((vc.cropW ?? 1) - (vc.cropH ?? 1)) >= 0.05);

            if (hasCrop && hasZoomKfs && !isAspectChangingCrop) {
                // ── COMPOSED: same-aspect multicam crop + zoom-rhythm on the SAME clip ──────
                // ONE zoom whose level is vc.scale * the rhythm scale, centred on
                // the multicam angle (R16: never stack a static crop and a second
                // zoom). Runs on the upright source frame; scale/pad follows.
                const cx0 = Math.max(0, Math.min(1, (vc.cropX ?? 0) + (vc.cropW ?? 1) / 2));
                const cy0 = Math.max(0, Math.min(1, (vc.cropY ?? 0) + (vc.cropH ?? 1) / 2));
                const baseZoom = vc.scale || (1 / Math.min(vc.cropW, vc.cropH));
                const anchor = { mode: 'center', x: cx0, y: cy0 };
                const zoom = buildSmoothZoomFilter(scaleKfs || [{ time: 0, value: 1 }], { fps: targetFps, anchor, multiplier: baseZoom, maxZoom: 8.0, panX, panY, scaleXKfs, scaleYKfs, ...transformMotion })
                    || buildSmoothZoomFilter([{ time: 0, value: baseZoom }], { fps: targetFps, anchor, maxZoom: 8.0 });
                if (zoom) vFilters.push(zoom);
                vFilters.push(baseTransform ? baseTransform.scaleFilter : scaleFilter);
                console.log(
                    `  [multicam+rhythm] clip "${clip.name}" angle=${vc.angle || '?'}: composed zoom ` +
                    `centred @(${cx0.toFixed(2)},${cy0.toFixed(2)}), base=${baseZoom.toFixed(2)}x`
                );
            } else {
                if (hasCrop) {
                    const cx = Math.max(0, Math.min(1, vc.cropX ?? 0));
                    const cy = Math.max(0, Math.min(1, vc.cropY ?? 0));
                    const cw = Math.max(0.05, Math.min(1 - cx, vc.cropW));
                    const ch = Math.max(0.05, Math.min(1 - cy, vc.cropH));
                    vFilters.push(`crop=iw*${cw.toFixed(4)}:ih*${ch.toFixed(4)}:iw*${cx.toFixed(4)}:ih*${cy.toFixed(4)}`);
                    console.log(`  [crop] clip "${clip.name}" angle=${vc.angle || '?'} crop=${cw.toFixed(2)}x${ch.toFixed(2)}@(${cx.toFixed(2)},${cy.toFixed(2)})`);
                }
                vFilters.push(baseTransform ? baseTransform.scaleFilter : scaleFilter);

                // Aspect-changing crops (e.g. 16:9 to 9:16 reframe): apply zoom/pan keyframes
                // on top of the scaled output rather than attempting a uniform perspective zoom
                // on the uncropped wide frame.
                if (hasCrop && hasZoomKfs && isAspectChangingCrop) {
                    const zoom = buildSmoothZoomFilter(scaleKfs, { fps: targetFps, anchor: { mode: 'fixed', x: 0.5, y: 0.28 }, panX, panY, scaleXKfs, scaleYKfs, ...transformMotion });
                    if (zoom) {
                        vFilters.push(zoom);
                        console.log(`  [camera] clip "${clip.name}": animated zoom on reframed output (${scaleKfs?.length || 0} scale keyframes)`);
                    }
                }
            }

            // A still image just lasts `dur`; speed means nothing for it.
            if (!isImage && speed !== 1.0 && !speedRetime) {
                if (!speedFirst) vFilters.push(`setpts=${(1 / speed).toFixed(4)}*PTS`);
                if (clip.speedChangeMaintainPitch === false) aFilters.push(`asetrate=44100*${speed.toFixed(4)}`, 'aresample=44100');
                else aFilters.push(...atempoChain(speed));
            }
            if (!isImage && vol !== 1.0) aFilters.push(`volume=${vol.toFixed(4)}`);

            // Zoom-rhythm scale keyframes, NO multicam crop on this clip → smooth
            // animated zoom (push-ins / punch-ins) on the output frame. Anchor:
            // horizontally centred, the point 28% from the top stays put (the
            // speaker's face). The editor preview uses the same anchor
            // (RHYTHM_ANCHOR_Y in client/src/revideo/project.tsx).
            if (!hasCrop && hasZoomKfs) {
                const zoom = buildSmoothZoomFilter(scaleKfs, { fps: targetFps, anchor: { mode: 'fixed', x: 0.5, y: 0.28 }, panX, panY, scaleXKfs, scaleYKfs, ...transformMotion });
                if (zoom) {
                    vFilters.push(zoom);
                    console.log(`  [camera] clip "${clip.name}": animated zoom/pan (${scaleKfs?.length || 0} scale, ${(panX?.length || 0) + (panY?.length || 0)} pan keyframes)`);
                }
            }

            if (opacityKfs) vFilters.push(buildAnimatedOpacityFilter(opacityKfs));
            if (rotationKfs && baseTransform) {
                const rotationFilter = buildAnimatedRotationFilter(rotationKfs);
                if (rotationFilter) {
                    const opacityIndex = vFilters.findIndex(filter => String(filter).startsWith('format=rgba,geq='));
                    vFilters.splice(opacityIndex >= 0 ? opacityIndex : vFilters.length, 0, rotationFilter);
                    const side = Math.max(2, Math.ceil(Math.hypot(baseTransform.sourceW, baseTransform.sourceH) / 2) * 2);
                    baseTransform.w = side;
                    baseTransform.h = side;
                    baseTransform.overlayX = Math.round((targetWidth - side) / 2 + (Number(clip.x) || 0));
                    baseTransform.overlayY = Math.round((targetHeight - side) / 2 + (Number(clip.y) || 0));
                }
            }

            // Timeline effect cards are stored on clips and mirror the live CSS
            // preview with supported FFmpeg filter approximations.
            if (clip.effectGraph) vFilters.push(`__VIBED_EFFECT_DAG__${JSON.stringify({
                graph: clip.effectGraph,
                options: { width: targetWidth, height: targetHeight, duration: dur, clipStart: Number(clip.start) || 0, complexGlow: true, clipLutFilters },
            })}`);
            vFilters.push(...compileTimelineVisualEffects(clip.effects, {
                width: targetWidth, height: targetHeight, duration: dur, clipStart: Number(clip.start) || 0, complexGlow: true, clipLutFilters,
            }));
            if (!windowedAudioEffects) aFilters.push(...compileTimelineAudioEffects(clip.effects));

            // Per-clip grading is the same user-authored grade the preview
            // shader receives. Compile it after footage effects and before a
            // project LUT so independent manual grades stack in the same order
            // as the preview. LUT-derived clip grades carry _lutId; when that
            // id matches the selected project LUT, the clip grade already
            // represents that look and applying the project filter too would
            // double-grade the footage.
            if (clip.grading) {
                vFilters.push(...compileClipColorGradeFilters(clip.grading, {
                    selectiveFilter: clip._selectiveGradeFilter,
                    width: targetWidth, height: targetHeight, duration: dur,
                    clipStart: Number(clip.start) || 0, complexGlow: true, clipLutFilters,
                }));
            }

            // Apply the project LUT after independent clip grading. LUT-derived
            // grading is mutually exclusive with this filter for that clip.
            if (lutFilter && String(clip.grading?._lutId || '') !== String(projectLUTId || '')) {
                vFilters.push(lutFilter);
            }

            // R99 — zone blur needs complexFilter, not flat videoFilters.
            // R100 — a resize/position transform ALSO needs complexFilter (the
            // scaled clip must be `overlay=`'d onto a full-canvas background
            // rather than simply padded, since it no longer fills the frame).
            // Both reach a `[vbase]` stage meaning "this clip's content now
            // fills the whole output canvas" — zone blur (frame-relative, not
            // clip-relative — see BlurZoneOverlay.jsx) always runs on THAT,
            // so it behaves identically regardless of which path produced it.
            const hasZone = !!(clip.blurZone && zb);
            const hasComplexGlow = vFilters.some(filter => String(filter).startsWith('__VIBED_HIGHLIGHT_GLOW__'));
            const hasComplexLut = vFilters.some(filter => String(filter).startsWith('__VIBED_LUT__'));
            const hasComplexShake = vFilters.some(filter => String(filter).startsWith('__VIBED_SHAKE__'));
            const hasEffectDag = vFilters.some(filter => String(filter).startsWith('__VIBED_EFFECT_DAG__'));
            const usedComplexFilter = !!baseTransform || hasZone || hasComplexGlow || hasComplexLut || hasComplexShake || hasEffectDag;
            if (baseTransform || hasZone || hasComplexGlow || hasComplexLut || hasComplexShake || hasEffectDag) {
                const graph = compileTimelineVisualEffectGraph(vFilters, { input: '0:v', output: 'fg' });
                const vbaseLabel = hasZone ? 'vbase' : 'vout';
                if (baseTransform) {
                    graph.push(
                        `color=c=black:s=${targetWidth}x${targetHeight}:d=${dur}[bg]`,
                        `[bg][fg]overlay=x=${baseTransform.overlayX}:y=${baseTransform.overlayY}:eval=init[${vbaseLabel}]`,
                    );
                } else {
                    graph.push(`[fg]null[${vbaseLabel}]`);
                }
                if (hasZone) graph.push(...zb.zoneBlurFilterGraph(clip.blurZone, { width: targetWidth, height: targetHeight, inLabel: 'vbase', outLabel: 'vout' }));
                cmd.complexFilter(graph, 'vout');
            } else {
                cmd.videoFilters(vFilters.join(','));
            }

            if (speedRetime) {
                // Audio is retimed in a separate filter graph after the video
                // pass, using the same integrated speed curve.
                cmd.addOutputOption('-an');
            } else if (isImage) {
                cmd.input(`anullsrc=channel_layout=stereo:sample_rate=44100`).inputOptions(['-f', 'lavfi']);
                // complexFilter() (the blurZone / R100 transform branches
                // above) only auto-maps its own output label -- unlike
                // videoFilters(), it does NOT fall back to mapping the first
                // audio stream, so the lavfi silence input must be mapped
                // explicitly or the segment comes out with no audio track at all.
                if (usedComplexFilter) cmd.addOutputOption('-map', '1:a');
            } else {
                if (aFilters.length) cmd.audioFilters(aFilters.join(','));
                // Same reasoning as the image branch above -- see
                // renderMattedSegment's identical '-map', '0:a?' for the
                // established precedent (R92).
                if (usedComplexFilter) cmd.addOutputOption('-map', '0:a?');
            }

            if (!speedRetime) cmd.addOutputOption('-shortest');
            cmd
                .fps(targetFps)
                .videoCodec(codec)
                .addOutputOption('-profile:v', profile)
                .addOutputOption('-pix_fmt', 'yuv420p')
                .addOutputOption('-movflags', '+faststart')
                .audioBitrate(audioBitrate)
                .output(videoOnlyPath)
                .on('end', async () => {
                    try {
                        if (speedRetime) {
                            const retimedAudioPath = path.join(tmpDir, `retimed-audio-${i}.m4a`);
                            await renderRetimeAudio(src, retimedAudioPath, speedRetime, {
                                offset: inPoint,
                                duration: dur,
                                clipStart: Number(clip.start) || 0,
                                volume: vol,
                                bitrate: audioBitrate,
                                effects: clip.effects,
                                hasAudio: retimeHasAudio,
                            });
                            await new Promise((muxResolve, muxReject) => ffmpeg(videoOnlyPath)
                                .input(retimedAudioPath)
                                .outputOptions(['-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'copy', '-t', String(dur), '-movflags', '+faststart'])
                                .output(segPath)
                                .on('end', muxResolve)
                                .on('error', muxReject)
                                .run());
                        } else if (windowedAudioEffects) {
                            await applyWindowedTimelineAudioEffectsToFile(videoOnlyPath, {
                                effects: clip.effects, clipStart: Number(clip.start) || 0,
                                duration: dur, bitrate: audioBitrate, hasVideo: true,
                            });
                        }
                        segments.push(segPath);
                        // Record this clip's output start time BEFORE incrementing.
                        segOutputStarts.push(cumulativeOut);
                        segClips.push(clip);
                        cumulativeOut += dur;
                        resolve();
                    } catch (retimeErr) {
                        reject(retimeErr);
                    }
                })
                .on('error', (err, _stdout, stderr) => {
                    console.error(`[ExportJob] ffmpeg failed clip ${i + 1}: ${err.message}`);
                    if (stderr) console.error(stderr.slice(-1000));
                    reject(err);
                })
                .run();
        });

        const pct = 5 + Math.round(((i + 1) / allClips.length) * 55);
        await job.updateProgress(pct);
        console.log(`  ✅ Segment ${i + 1}/${allClips.length}: "${clip.name}"`);
    }

    if (segments.length === 0) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        throw new Error('No valid clips could be processed');
    }

    // ── STEP 2: Concatenate ────────────────────────────────────────────────
    let finalVideoPath = outputPath;
    if (segments.length === 1) {
        fs.renameSync(segments[0], outputPath);
    } else {
        const concatList = path.join(tmpDir, 'concat.txt');
        fs.writeFileSync(concatList, segments.map(s => `file '${s}'`).join('\n'));

        await new Promise((resolve, reject) => {
            ffmpeg()
                .input(concatList)
                .inputOptions(['-f', 'concat', '-safe', '0'])
                .videoCodec('copy')
                .audioCodec('copy')
                .output(outputPath)
                .on('end', resolve)
                .on('error', reject)
                .run();
        });
        console.log(`  ✅ Concatenated ${segments.length} segments`);
    }

    await job.updateProgress(70);

    // ── STEP 2.2: Transitions (R89, to-do A4) ──────────────────────────────
    // Cut effects (flash, dip, whip, zoom punch, glitch, speed lines) centred
    // on each cut of the concatenated base video, BEFORE overlays and
    // captions, so nothing changes length and captions are never shaken.
    // Curves come from client/src/motion/TransitionFX.js, the file the preview
    // uses. Runs only when a base clip carries a transition; FAILS OPEN (the
    // video ships without transitions, with a warning) like STEP 2.5 and 4.
    // TRANSITIONS_DISABLED=1 is the kill switch.
    let transitionWarning = null;
    if (process.env.TRANSITIONS_DISABLED !== '1' && segClips.some(c => c && c.transition && c.transition.type)) {
        try {
            const { loadTransitionFX, outputWindows, compileTransitions } = require('../server/compositor/TransitionCompiler.js');
            const FX = await loadTransitionFX();
            const windows = outputWindows(FX, segClips, segOutputStarts, cumulativeOut);
            const graph = windows.length > 0
                ? compileTransitions(windows, { FX, width: targetWidth, height: targetHeight, fps: targetFps, tmpDir })
                : null;
            if (graph) {
                const graphPath = path.join(tmpDir, 'transition_graph.txt');
                fs.writeFileSync(graphPath, graph.filterComplex, 'utf-8');
                const transOut = path.join(tmpDir, 'with_transitions.mp4');
                const args = ['-i', finalVideoPath];
                for (const inp of graph.inputs) args.push(...inp.inputOptions, '-i', inp.path);
                args.push(
                    '-filter_complex_script', graphPath,
                    '-map', `[${graph.outputLabel}]`,
                    '-map', '0:a?',
                    '-c:v', codec,
                    '-b:v', videoBitrate,
                    '-profile:v', profile,
                    '-pix_fmt', 'yuv420p',
                    '-c:a', 'copy',
                    '-y',
                    transOut,
                );
                console.log(`  🎞️  Applying ${windows.length} transition(s)`);
                await runFfmpegArgs(DRAWTEXT_BIN, args);
                finalVideoPath = transOut;
                console.log('  ✅ Transitions applied');
            }
        } catch (transErr) {
            transitionWarning = `Transitions could not be rendered and were left out: ${String(transErr.message).slice(0, 300)}`;
            console.warn(`[ExportJob ${job.id}] transitions failed (exporting without them):`, String(transErr.message).slice(0, 600));
        }
    }

    // ── STEP 2.5: Composite overlay layers (R60) ───────────────────────────
    // The layered-graphics pass. Everything above this line composites NOTHING:
    // `allClips` flattens every clip from every video track into one array
    // sorted by start time, so two clips overlapping in time on different
    // tracks are played in SEQUENCE, not stacked. That is why stickers, logos,
    // lower thirds and picture-in-picture have been impossible.
    //
    // ── THIS RUNS ALONGSIDE THE EXISTING PIPELINE, IT DOES NOT REPLACE IT ──
    // Three independent conditions must all hold before a single filter runs:
    //   1. the client sent a composition plan,
    //   2. the plan validates,
    //   3. there are drawable overlays. Base-footage effect samples have
    //      already been attached to the ordinary clip effect stack above.
    // COMPOSITOR_DISABLED=1 is a deploy-free kill switch if it ever misbehaves
    // in production.
    //
    // FAILS OPEN, like the LUT lookup (R55) and the caption burn-in: any error
    // leaves `finalVideoPath` pointing at the un-composited video and the export
    // continues. A video missing its stickers is a far better outcome than no
    // video, and the reason is surfaced to the user rather than swallowed.
    let compositorWarning = null;
    let transparentGraphicsPath = null;
    let transparentGraphicsFrameCount = 0;
    let transparentCaptionLayers = null;
    const rawPlan = settings.compositionPlan || null;
    // A plan may carry recoverable authoring limitations discovered on the
    // client (for example a branched graph on a rasterized graphic layer).
    // They are informational, but must survive to the finished export result:
    // omitting a graph branch and returning an unqualified success would make
    // the editor/export contract dishonest.
    const compositionPlanWarnings = [...new Set((Array.isArray(rawPlan?.warnings) ? rawPlan.warnings : [])
        .filter(warning => typeof warning === 'string' && warning.trim() && warning.length <= 600)
        .map(warning => warning.trim()))];
    if (compositionPlanWarnings.length) {
        const shown = compositionPlanWarnings.slice(0, 3);
        const remainder = compositionPlanWarnings.length - shown.length;
        compositorWarning = `${shown.join(' ')}${remainder > 0 ? ` ${remainder} more composition warning(s).` : ''}`;
    }

    // R63 — animated captions. Declared here, at function scope, NOT inside the
    // `if (textTracks.length > 0 && !useRevideo)` block further down where the
    // caption program is actually compiled: the final return statement (below)
    // reads this value long after that block has closed, and `let` is block-
    // scoped. A declaration nested inside that if/else was invisible to the
    // return statement — every export unconditionally threw
    // "captionProgramWarning is not defined" building the result object, since
    // the reference at the bottom resolved to no binding at all, not to a not-
    // yet-initialized one. Mirrors compositorWarning/revideoWarning above/below,
    // which are correctly declared at this same top level for the same reason.
    let captionProgramWarning = null;

    // Visual layers are composited before Revideo. The worker receives only
    // text tracks, preventing both duplicate overlays and dropped graphics if
    // the optional text render fails.
    if (rawPlan && (rawPlan.overlays || []).length > 0 && process.env.COMPOSITOR_DISABLED !== '1') {
        try {
            const { compileCompositionPlan, validateCompositionPlanShape } =
                require('../server/compositor/CompositorCompiler.js');

            // The plan carries its own version; a worker that predates a plan
            // format must decline it rather than mis-render it.
            const planErrors = validateCompositionPlanShape(rawPlan, targetWidth, targetHeight);
            if (planErrors.length > 0) {
                throw new Error(`plan rejected: ${planErrors.slice(0, 3).join('; ')}`);
            }

            // Plan geometry is NORMALISED (0..1 of the frame), so the same plan
            // renders correctly at any resolution. Tell the compiler which one
            // this job is actually producing — this is where fractions become
            // pixels, and it is the only place that conversion happens.
            rawPlan.renderWidth  = targetWidth;
            rawPlan.renderHeight = targetHeight;

            const overlays = rawPlan.overlays || [];
            console.log(`🧩 [ExportJob ${job.id}] compositing ${overlays.length} overlay layer(s)`);

            // Fetch each overlay's source. A layer we cannot fetch is DROPPED,
            // not fatal — one dead sticker URL must not cost the whole export.
            const inputs = [];
            const inputFiles = [];
            const skippedOverlayWarnings = [];
            const partialOverlayWarnings = [];
            const sceneLimitWarnings = [];
            // Uploaded footage/images with a fork/join graph are rasterized
            // into a local RGBA sequence before the normal compositor runs.
            // Record those layers so their runtime plan does not apply source
            // timing a second time (or leave an already-baked graph around).
            const preRenderedGraphOverlayIds = new Set();
            for (let i = 0; i < overlays.length; i++) {
                const ov = overlays[i];

                // Templates/vectors already arrive as locally generated RGBA
                // frames. Run their authored fork/join graph before geometry,
                // masks and blend mode just as we do for uploaded media below.
                const applyGeneratedGraphicEffectGraph = async (sequence) => {
                    if (!ov.effectGraph) return sequence;
                    try {
                        return await renderGraphicEffectGraphSequence(sequence, ov.effectGraph, {
                            tmpDir,
                            name: `${i}-${ov.id}`,
                            fps: targetFps,
                            duration: Math.max(0.01, Number(ov.outputEnd) - Number(ov.outputStart)),
                            // `effectGraph` stays in project-timeline time;
                            // outputStart is a different clock once timeline
                            // edits have removed/retimed ranges.
                            clipStart: Number(ov.timelineStart) || 0,
                        });
                    } catch (graphErr) {
                        // Preserve the unprocessed graphic as the recoverable
                        // fallback, but make the failed graph impossible to
                        // mistake for a complete render in the export result.
                        console.warn(`  ⚠️  effect graph on generated graphic ${ov.id}:`, graphErr.message);
                        partialOverlayWarnings.push(`Effect graph on graphic layer ${ov.id} could not be rendered: ${graphErr.message.slice(0, 220)}`);
                        return sequence;
                    }
                };

                if (ov.sourceTimeMapWarning) {
                    skippedOverlayWarnings.push(`Overlay ${ov.id} skipped: ${ov.sourceTimeMapWarning}`);
                    continue;
                }

                // R89: template components are DRAWN here (same drawing code as
                // the preview), not downloaded. One PNG per output frame, sized
                // to the largest box the layer reaches.
                if (ov.source?.type === 'vector' && ov.source.vector) {
                    try {
                        const { renderVectorFrames } = require('../server/compositor/TemplateRenderer.js');
                        const maxW = Math.max(...(ov.geometry || []).map(g => Number(g.w) || 0), 0.05);
                        const durationSec = Math.max(0.2, Number(ov.outputEnd) - Number(ov.outputStart));
                        const seq = await renderVectorFrames(ov.source.vector, {
                            durationSec,
                            fps: targetFps,
                            widthPx: Math.round(maxW * targetWidth),
                            tmpDir,
                            name: `vector-${i}`,
                            motionBlur: ov.motionBlur,
                        });
                        const renderedSequence = await applyGeneratedGraphicEffectGraph(seq);
                        inputs.push({ overlayId: ov.id, inputIndex: inputFiles.length + 1 });
                        inputFiles.push({ path: renderedSequence.pattern, isImage: false, outputEnd: ov.outputEnd, sequenceFps: targetFps });
                    } catch (vectorErr) {
                        console.warn(`  ⚠️  vector ${ov.id}: could not be drawn — layer skipped:`, vectorErr.message);
                        skippedOverlayWarnings.push(`Vector layer ${ov.id} could not be rendered`);
                    }
                    continue;
                }

                // R89: template components are DRAWN here (same drawing code as
                // the preview), not downloaded. One PNG per output frame, sized
                // to the largest box the layer reaches.
                if (ov.source?.type === 'template' && ov.source.template) {
                    try {
                        const { renderTemplateFrames, loadScene3D } = require('../server/compositor/TemplateRenderer.js');
                        const maxW = Math.max(...(ov.geometry || []).map(g => Number(g.w) || 0), 0.05);
                        const imageFiles = {};
                        const templateParams = ov.source.template?.params || {};
                        if (ov.source.template.kind === '3d-scene' && templateParams.scene) {
                            const { getScene3DRenderLimitWarnings, getScene3DCompatibilityWarnings } = await loadScene3D();
                            for (const warning of getScene3DRenderLimitWarnings(templateParams.scene)) {
                                sceneLimitWarnings.push(`3D scene layer ${ov.id}: ${warning.message}`);
                            }
                            for (const warning of getScene3DCompatibilityWarnings(templateParams.scene)) {
                                sceneLimitWarnings.push(`3D scene layer ${ov.id}: ${warning.message}`);
                            }
                        }
                        const durationSec = Math.max(0.2, Number(ov.outputEnd) - Number(ov.outputStart));
                        const videoFrameFiles = {};
                        const sceneObjects = (templateParams.scene?.objects || []).map(object => ({ ...object }));
                        const templateImageAsset = templateParams.imageAssetId ? assetMap[templateParams.imageAssetId] : null;
                        const resolvedTemplateImageUrl = firstDurableAssetUrl(templateParams.imageUrl, templateImageAsset?.sourceUrl, templateImageAsset?.proxyUrl, templateImageAsset?.url);
                        const templateImages = [{ url: resolvedTemplateImageUrl, assetId: templateParams.imageAssetId }];
                        for (const object of sceneObjects) {
                            if (!['image', 'mesh'].includes(object?.type)) continue;
                            const imageAsset = object.imageAssetId ? assetMap[object.imageAssetId] : null;
                            const imageUrl = firstDurableAssetUrl(object.imageUrl, object.textureUrl, imageAsset?.sourceUrl, imageAsset?.proxyUrl, imageAsset?.url);
                            if (imageUrl && isEphemeralBlobUrl(object.imageUrl)) object.imageUrl = imageUrl;
                            else if (!object.imageUrl && imageUrl) object.imageUrl = imageUrl;
                            if (imageUrl) templateImages.push({ url: imageUrl, assetId: object.imageAssetId });
                        }
                        const seenTemplateImages = new Set();
                        for (const [imageIndex, imageRef] of templateImages.entries()) {
                            const imgUrl = imageRef?.url;
                            if (!imgUrl) {
                                if (imageRef?.assetId) partialOverlayWarnings.push(`3D image texture ${imageRef.assetId} on layer ${ov.id} has no available source`);
                                continue;
                            }
                            if (seenTemplateImages.has(imgUrl)) continue;
                            seenTemplateImages.add(imgUrl);
                            const imgPath = path.join(tmpDir, `tplimg-${i}-${imageIndex}${path.extname(String(imgUrl).split('?')[0]) || '.png'}`);
                            const got = await fetchClipSource({ id: `${ov.clipId}-img-${imageIndex}`, name: path.basename(imgPath), assetId: imageRef.assetId || undefined, url: imgUrl, sourceUrl: imgUrl, proxyUrl: imgUrl }, imgPath);
                            if (got) imageFiles[imgUrl] = got;
                            else partialOverlayWarnings.push(`3D image texture ${imageRef.assetId || imageIndex} on layer ${ov.id} could not be loaded`);
                        }
                        for (const [videoIndex, object] of sceneObjects.entries()) {
                            if (object?.type !== 'video' || (!object.videoUrl && !object.videoAssetId)) continue;
                            const textureKey = object.videoTextureKey || object.id || `${ov.clipId}-video-${videoIndex}`;
                            object.videoTextureKey = textureKey;
                            try {
                                const videoAsset = object.videoAssetId ? assetMap[object.videoAssetId] : null;
                                const videoUrl = firstDurableAssetUrl(object.videoUrl, videoAsset?.sourceUrl, videoAsset?.proxyUrl, videoAsset?.url);
                                const videoName = videoAsset?.name || object.name || `tplvideo-${i}-${videoIndex}.mp4`;
                                if (!videoUrl) {
                                    partialOverlayWarnings.push(`3D video texture ${videoName} on layer ${ov.id} has no available source`);
                                    continue;
                                }
                                const videoExt = path.extname(String(videoUrl || videoName).split('?')[0]) || '.mp4';
                                const videoPath = path.join(tmpDir, `tplvideo-${i}-${videoIndex}${videoExt}`);
                                const got = await fetchClipSource({ id: `${ov.clipId}-video-${videoIndex}`, name: videoName, assetId: object.videoAssetId || undefined, url: videoUrl, sourceUrl: videoUrl, proxyUrl: videoUrl }, videoPath);
                                if (!got) {
                                    partialOverlayWarnings.push(`3D video texture ${videoName} on layer ${ov.id} could not be loaded`);
                                    continue;
                                }
                                const startAt = Math.max(0, Number(object.videoStart) || 0);
                                const speed = Math.max(0.05, Number(object.videoSpeed) || 1);
                                const remap = object.timeRemap || {};
                                const { maxSceneObjectSourceTime, getSceneShutterSampleTimes } = await loadScene3D();
                                // Include the exact shutter sample timestamps used by
                                // TemplateRenderer. Scene-owned motion blur may sample
                                // past the last regular frame, so a frame-only bound can
                                // truncate the source texture at the end of the render.
                                const sceneShutter = templateParams.scene?.motionBlur;
                                const frameCount = Math.max(1, Math.ceil(durationSec * targetFps));
                                const sceneShutterTimes = sceneShutter?.enabled
                                    ? Array.from({ length: frameCount }, (_, frame) => getSceneShutterSampleTimes(
                                        frame, durationSec, targetFps, sceneShutter,
                                    )).flat()
                                    : [];
                                // Use the renderer's exact remapping logic and frame cadence.
                                const maxMappedTime = maxSceneObjectSourceTime(remap, durationSec, targetFps, sceneShutterTimes);
                                const extractionDuration = Math.max(1 / targetFps, maxMappedTime * speed + 1 / targetFps);
                                const neededFrames = Math.max(1, Math.ceil(extractionDuration * targetFps) + 1);
                                const frameDir = path.join(tmpDir, `tplvideo-frames-${i}-${videoIndex}`);
                                fs.mkdirSync(frameDir, { recursive: true });
                                // Keep alpha-capable scene video textures intact.
                                // JPEG extraction silently filled transparent pixels
                                // with black, so a ProRes/WebM texture became an
                                // opaque rectangle in the 3D template render.
                                const framePattern = path.join(frameDir, 'frame-%06d.png');
                                await runFfmpegArgs(ffmpegPath, [
                                    '-hide_banner', '-loglevel', 'error', '-i', got,
                                    '-ss', String(startAt), '-t', String(extractionDuration),
                                    // Reset timestamps after seeking so the extracted sequence's
                                    // frame zero is relative to startAt. TemplateRenderer maps
                                    // requested source seconds back into this bounded sequence.
                                    '-vf', `setpts=PTS-STARTPTS,fps=${targetFps},scale=960:-2:flags=lanczos,format=rgba`, '-frames:v', String(neededFrames),
                                    '-c:v', 'png', '-pix_fmt', 'rgba', '-compression_level', '3', '-y', framePattern,
                                ]);
                                const extracted = fs.readdirSync(frameDir)
                                    .filter(file => /^frame-\d+\.png$/i.test(file))
                                    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]))
                                    .map(file => path.join(frameDir, file));
                                if (extracted.length) videoFrameFiles[textureKey] = { frames: extracted, startTime: startAt };
                                else partialOverlayWarnings.push(`3D video texture ${videoName} on layer ${ov.id} produced no frames`);
                            } catch (videoErr) {
                                console.warn(`  ⚠️  3D video texture ${object.name || object.id || videoIndex}:`, videoErr.message);
                                partialOverlayWarnings.push(`3D video texture ${object.name || object.id || videoIndex} on layer ${ov.id} could not be prepared`);
                            }
                        }
                        const templateForRender = templateParams.scene
                            ? { ...ov.source.template, params: { ...templateParams, imageUrl: resolvedTemplateImageUrl || templateParams.imageUrl, scene: { ...templateParams.scene, objects: sceneObjects, audioWaveformsByAsset: timeline.audioWaveformsByAsset || {} } } }
                            : { ...ov.source.template, params: { ...templateParams, imageUrl: resolvedTemplateImageUrl || templateParams.imageUrl } };
                        const seq = await renderTemplateFrames(templateForRender, {
                            durationSec,
                            fps: targetFps,
                            widthPx: Math.round(maxW * targetWidth),
                            tmpDir,
                            name: String(i),
                            imageFiles,
                            videoFrameFiles,
                            mask: ov.sceneMask,
                            motionBlur: ov.motionBlur,
                        });
                        const renderedSequence = await applyGeneratedGraphicEffectGraph(seq);
                        inputs.push({ overlayId: ov.id, inputIndex: inputFiles.length + 1 });
                        inputFiles.push({ path: renderedSequence.pattern, isImage: false, outputEnd: ov.outputEnd, sequenceFps: targetFps });
                    } catch (tplErr) {
                        console.warn(`  ⚠️  template ${ov.id}: could not be drawn — layer skipped:`, tplErr.message);
                        skippedOverlayWarnings.push(`Template layer ${ov.id} could not be rendered`);
                    }
                    continue;
                }

                const srcClip = {
                    id: ov.clipId,
                    name: `overlay-${i}${path.extname(ov.source?.url || '') || '.mp4'}`,
                    assetId: ov.source?.assetId,
                    url: ov.source?.url,
                    sourceUrl: ov.source?.url,
                    proxyUrl: ov.source?.url,
                };
                const dlPath = path.join(tmpDir, `ovdl-${i}${path.extname(ov.source?.url || '') || '.mp4'}`);
                const src = await fetchClipSource(srcClip, dlPath);
                if (!src) {
                    console.warn(`  ⚠️  overlay ${ov.id}: source unresolved — layer skipped`);
                    skippedOverlayWarnings.push(`Overlay ${ov.id} could not be loaded`);
                    continue;
                }
                let inputSource = src;
                let rasterizedGraph = null;
                if (ov.effectGraph) {
                    try {
                        rasterizedGraph = await renderOverlayEffectGraphSequence(src, ov, {
                            tmpDir,
                            name: `${i}-${ov.id}`,
                            fps: targetFps,
                            duration: Math.max(0.01, Number(ov.outputEnd) - Number(ov.outputStart)),
                            // Graph windows/keyframes live on the authoring
                            // timeline, not the output clock after cut/retime.
                            clipStart: Number(ov.timelineStart) || 0,
                        });
                        inputSource = rasterizedGraph.pattern;
                        preRenderedGraphOverlayIds.add(ov.id);
                    } catch (graphErr) {
                        // Keep the underlying layer exportable, but never hide
                        // the fact that an authored complex graph was skipped.
                        console.warn(`  ⚠️  effect graph on overlay ${ov.id}:`, graphErr.message);
                        partialOverlayWarnings.push(`Effect graph on overlay layer ${ov.id} could not be rendered: ${graphErr.message.slice(0, 220)}`);
                    }
                }
                // Input 0 is the base video, so overlay inputs start at 1.
                inputs.push({ overlayId: ov.id, inputIndex: inputFiles.length + 1 });
                inputFiles.push({
                    path: inputSource,
                    // A DAG-preprocessed source is a numbered PNG sequence,
                    // even when its authored layer is an image/sticker.
                    isImage: !rasterizedGraph && ov.source?.type === 'image',
                    outputEnd: ov.outputEnd,
                    ...(rasterizedGraph ? { sequenceFps: targetFps } : {}),
                    // R88: a video overlay starts at its own in-point (clip.offset),
                    // not at the top of the file. Images/stickers have none.
                    seek: !rasterizedGraph && ov.source?.type === 'video'
                        ? Math.max(0, (Number(ov.sourceOffset) || 0) + (Array.isArray(ov.sourceTimeMap) && ov.sourceTimeMap.length
                            ? Math.min(...ov.sourceTimeMap.map(point => Number(point?.source) || 0))
                            : 0))
                        : 0,
                });
            }

            // The local sequence has already consumed source offset/speed/map
            // and effectGraph. Geometry, masks, nesting, blend modes and the
            // output-time window remain authored in the regular compiler.
            const compositionPlan = preRenderedGraphOverlayIds.size
                ? {
                    ...rawPlan,
                    overlays: rawPlan.overlays.map(overlay => {
                        if (!preRenderedGraphOverlayIds.has(overlay.id)) return overlay;
                        const { effectGraph, sourceTimeMap, sourceTimeMapWarning, ...runtimeOverlay } = overlay;
                        return { ...runtimeOverlay, sourceOffset: 0, speed: 1 };
                    }),
                }
                : rawPlan;
            const compiled = compileCompositionPlan(compositionPlan, inputs);
            if (!compiled) {
                const detail = skippedOverlayWarnings.slice(0, 3).join('; ');
                const remainder = skippedOverlayWarnings.length - Math.min(3, skippedOverlayWarnings.length);
                throw new Error(`no drawable overlay layers after source resolution${detail ? `: ${detail}${remainder > 0 ? `; ${remainder} more layer(s) skipped` : ''}` : ''}`);
            }
            if (skippedOverlayWarnings.length) {
                const shown = skippedOverlayWarnings.slice(0, 3);
                const remainder = skippedOverlayWarnings.length - shown.length;
                compositorWarning = `${shown.join('; ')}${remainder > 0 ? `; ${remainder} more layer(s) skipped` : ''}.`;
            }
            if (partialOverlayWarnings.length) {
                const shown = partialOverlayWarnings.slice(0, 3);
                const remainder = partialOverlayWarnings.length - shown.length;
                const detail = `${shown.join('; ')}${remainder > 0 ? `; ${remainder} more texture(s) unavailable` : ''}.`;
                compositorWarning = [compositorWarning, detail].filter(Boolean).join(' ');
            }
            if (sceneLimitWarnings.length) {
                const shown = sceneLimitWarnings.slice(0, 3);
                const remainder = sceneLimitWarnings.length - shown.length;
                compositorWarning = [compositorWarning,
                    `${shown.join(' ')}${remainder > 0 ? ` ${remainder} more 3D render limit warning(s).` : ''}`]
                    .filter(Boolean).join(' ');
            }

            // Optional alpha deliverable: render only the planned overlay
            // layers over a transparent RGBA base. The ordinary PNG sequence
            // below remains the flattened finished video.
            if (['transparent-png-sequence', 'transparent-mov'].includes(String(settings.format || '').toLowerCase())) {
                const alphaGraph = compileCompositionPlan(compositionPlan, inputs, { preserveAlpha: true });
                if (!alphaGraph) throw new Error('no drawable graphic layers are available for a transparent sequence');
                const duration = Math.max(0.1, Number(rawPlan.base?.totalDuration) || 0, cumulativeOut);
                transparentGraphicsFrameCount = Math.max(1, Math.ceil(duration * targetFps));
                const alphaDir = path.join(tmpDir, 'transparent-graphics');
                fs.mkdirSync(alphaDir, { recursive: true });
                const alphaPattern = path.join(alphaDir, 'frame-%06d.png');
                const graphPath = path.join(tmpDir, 'transparent_graphics_filter.txt');
                fs.writeFileSync(graphPath, alphaGraph.filterComplex, 'utf8');
                const args = [
                    '-hide_banner', '-loglevel', 'error',
                    '-f', 'lavfi', '-i', `color=c=black@0:s=${targetWidth}x${targetHeight}:r=${targetFps}:d=${duration},format=rgba`,
                ];
                for (const input of inputFiles) {
                    if (input.sequenceFps) args.push('-framerate', String(input.sequenceFps), '-start_number', '0', '-i', input.path);
                    else if (input.isImage) args.push('-loop', '1', '-t', String(Math.max(0.1, input.outputEnd)), '-i', input.path);
                    else {
                        if (input.seek > 0) args.push('-ss', String(input.seek));
                        args.push('-i', input.path);
                    }
                }
                args.push(
                    '-filter_complex_script', graphPath,
                    '-map', `[${alphaGraph.outputLabel}]`,
                    '-frames:v', String(transparentGraphicsFrameCount),
                    '-start_number', '1',
                    '-c:v', 'png', '-pix_fmt', 'rgba', '-compression_level', '3',
                    '-y', alphaPattern,
                );
                await runFfmpegArgs(ffmpegPath, args);
                fs.writeFileSync(path.join(alphaDir, 'README.txt'), `Vibed transparent graphics sequence\nResolution: ${targetWidth}x${targetHeight}\nFrame rate: ${targetFps} fps\nFrames are numbered from 000001 and contain the composition-plan overlay layers with transparency. Footage base, audio, and captions are not included.\n`);
                transparentGraphicsPath = alphaDir;
                console.log(`  ✅ Rendered transparent overlay sequence (${alphaGraph.used} layers)`);
            }

            const compositedPath = path.join(tmpDir, 'composited.mp4');
            await new Promise((resolve, reject) => {
                let cmd = ffmpeg(finalVideoPath);
                for (const f of inputFiles) {
                    // A still image has no duration of its own; -loop 1 gives it
                    // one, and -t stops it running past its window forever.
                    if (f.isImage) cmd = cmd.input(f.path).inputOptions(['-loop', '1', '-t', String(Math.max(0.1, f.outputEnd))]);
                    else if (f.sequenceFps) cmd = cmd.input(f.path).inputOptions(['-framerate', String(f.sequenceFps), '-start_number', '0']);
                    else if (f.seek > 0) cmd = cmd.input(f.path).inputOptions(['-ss', String(f.seek)]);
                    else           cmd = cmd.input(f.path);
                }
                cmd
                    .complexFilter(compiled.filterComplex, compiled.outputLabel)
                    .videoCodec(codec)
                    .videoBitrate(videoBitrate)
                    .outputOptions([`-profile:v`, profile, '-pix_fmt', 'yuv420p'])
                    // Audio is untouched here — STEP 3 still mixes it afterwards.
                    .audioCodec('copy')
                    .output(compositedPath)
                    .on('end', resolve)
                    .on('error', reject)
                    .run();
            });

            finalVideoPath = compositedPath;
            console.log(`  ✅ Composited ${compiled.used} overlay layer(s)`);
        } catch (compErr) {
            compositorWarning = `Overlay layers could not be composited: ${compErr.message}`;
            console.warn(`[ExportJob ${job.id}] compositor failed (exporting without overlays):`, compErr.message);
        }
    }

    await job.updateProgress(74);

    // ── STEP 3: Mix audio tracks ───────────────────────────────────────────
    if (audioTracks.length > 0) {
        const audioSegments = [];
        for (let i = 0; i < audioTracks.length; i++) {
            const track = audioTracks[i];
            for (let j = 0; j < track.clips.length; j++) {
                const clip    = track.clips[j];
                const ext     = path.extname(clip.name || '.mp3') || '.mp3';
                const aDlPath = path.join(tmpDir, `adl-${i}-${j}${ext}`);
                const src     = await fetchClipSource(clip, aDlPath);
                if (!src) { skippedClips.push(clip.name || 'an audio track'); continue; }

                const aSegPath = path.join(tmpDir, `audio-${i}-${j}.aac`);
                const vol      = (clip.volume ?? 1.0) * (track.volume ?? 1.0);
                const speedResult = resolveTimelineSpeedEffect(clip.effects, Number(clip.start) || 0, Number(clip.duration) || 0);
                if (speedResult.retime) {
                    const hasAudio = await hasAudioStream(src);
                    if (!hasAudio) {
                        skippedClips.push(clip.name || 'an audio track');
                        continue;
                    }
                    await renderRetimeAudio(src, aSegPath, speedResult.retime, {
                        offset: Number(clip.offset) || 0,
                        duration: Number(clip.duration) || 0,
                        clipStart: Number(clip.start) || 0,
                        volume: vol,
                        bitrate: audioBitrate,
                        effects: clip.effects,
                        hasAudio: true,
                    });
                    audioSegments.push({ path: aSegPath, startTime: clip.start });
                    continue;
                }

                await new Promise((resolve, reject) => {
                    const aSpeed = speedResult.speed ?? (Number(clip.speed) > 0 ? Number(clip.speed) : 1);
                    const windowedAudioEffects = hasPartialTimelineAudioEffects(clip.effects, Number(clip.start) || 0, Number(clip.duration) || 0);
                    const speedFilters = aSpeed !== 1
                        ? (speedResult.maintainPitch === false
                            ? [`asetrate=44100*${aSpeed.toFixed(4)}`, 'aresample=44100']
                            : atempoChain(aSpeed))
                        : [];
                    ffmpeg(src)
                        .setStartTime(clip.offset || 0)
                        .setDuration(clip.duration || 0) // output -t: the clip's timeline length
                        .audioFilters([...speedFilters, ...(!windowedAudioEffects ? compileTimelineAudioEffects(clip.effects) : []), `volume=${vol.toFixed(4)}`].join(','))
                        .audioBitrate(audioBitrate)
                        .output(aSegPath)
                        .on('end', async () => {
                            try {
                                if (windowedAudioEffects) await applyWindowedTimelineAudioEffectsToFile(aSegPath, {
                                    effects: clip.effects, clipStart: Number(clip.start) || 0,
                                    duration: Number(clip.duration) || 0, bitrate: audioBitrate, hasVideo: false,
                                });
                                audioSegments.push({ path: aSegPath, startTime: clip.start });
                                resolve();
                            } catch (error) { reject(error); }
                        })
                        .on('error', reject)
                        .run();
                });
            }
        }

        if (audioSegments.length > 0) {
            // Does the base actually HAVE an audio stream? `[0:a]` on a silent
            // base is not an empty mix — ffmpeg refuses the whole filtergraph
            // ("Stream specifier ':a' matches no streams" / "Error binding
            // filtergraph inputs/outputs: Invalid argument") and the ENTIRE
            // EXPORT fails. This stayed hidden for as long as it did because
            // every bundled sound effect used to be dropped before reaching
            // here (see fetchClipSource's /sfx-library/ branch): with no
            // segments this block never ran at all. Fixing that resolution
            // made this step start running, and it took the export with it.
            const baseHasAudio = await hasAudioStream(finalVideoPath);
            const mixedPath = path.join(tmpDir, 'mixed.mp4');
            await new Promise((resolve, reject) => {
                let cmd = ffmpeg(finalVideoPath);
                for (const seg of audioSegments) cmd = cmd.input(seg.path);

                const filterComplex = buildAudioMixGraph(audioSegments, baseHasAudio);

                cmd
                    .complexFilter(filterComplex)
                    // BOTH maps, video first. Any `-map` at all turns OFF
                    // ffmpeg's default stream selection, so mapping only the
                    // mixed audio — which is what `complexFilter(fc, 'aout')`
                    // does on its own — produced an AUDIO-ONLY file with
                    // `.videoCodec('copy')` silently a no-op. Every project
                    // that reached this step (a music track, a voice-over,
                    // and now a sound effect) lost its picture entirely.
                    .outputOptions(['-map', '0:v', '-map', '[aout]'])
                    .videoCodec('copy')
                    .audioBitrate(audioBitrate)
                    .output(mixedPath)
                    .on('end', () => { finalVideoPath = mixedPath; resolve(); })
                    .on('error', reject)
                    .run();
            });
            console.log(`  ✅ Audio tracks mixed (${audioSegments.length} segment(s)${baseHasAudio ? '' : ', silent base'})`);
        }
    }

    await job.updateProgress(82);

    // ── STEP 3.5: Revideo text composite ───────────────────────────────────
    // Only runs when REVIDEO_RENDER_ENABLED=1, RENDER_WORKER_URL is set, and
    // there's actually a supported 'text' track to draw. `finalVideoPath`
    // at this point is FFmpeg's fully cut/graded/audio-mixed output — exactly
    // the single `baseVideoUrl` the render-worker's scene expects (see its
    // own header for why it owns nothing else).
    //
    // On worker failure, the already-composited video stays intact and STEP 4
    // draws text through the built-in renderer.
    if (useRevideo) {
        try {
            const backendUrl = resolvePublicBackendUrl();

            // The worker fetches this by URL — it cannot read tmpDir directly
            // (it's a separate service, possibly on a different machine).
            let baseVideoUrl;
            let uploadedTempGcsPath = null;
            if (gcsBucket) {
                uploadedTempGcsPath = `exports/${userId}/_revideo-base-${jobId}.mp4`;
                await gcsBucket.upload(finalVideoPath, {
                    destination: uploadedTempGcsPath,
                    metadata: { contentType: 'video/mp4' },
                });
                baseVideoUrl = `https://storage.googleapis.com/${bucketName}/${uploadedTempGcsPath}`;
            } else {
                // Local-storage dev mode: serve it from this same backend's
                // /uploads/exports/ static route, same fallback local exports
                // already use for the final result.
                const localName = `_revideo-base-${jobId}.mp4`;
                fs.copyFileSync(finalVideoPath, path.join(exportsDir, localName));
                baseVideoUrl = `${backendUrl}/uploads/exports/${localName}`;
            }

            const revideoOutPath = path.join(tmpDir, 'revideo-composite.mp4');
            await renderViaRevideoWorker({
                baseVideoUrl,
                tracks: revideoTextTracks,
                duration: allClips.reduce((max, c) => Math.max(max, (c.start || 0) + (c.duration || 0)), 0),
                aspectRatio: settings.aspectRatio || '16:9',
                fps: targetFps,
                backendUrl,
                audioWaveformsByAsset: timeline.audioWaveformsByAsset || {},
                outputPath: revideoOutPath,
            });

            finalVideoPath = revideoOutPath;
            revideoSucceeded = true;
            console.log('  ✅ Revideo composite (captions + motion graphics) applied');

            // Best-effort cleanup of the temporary base-video copy — a failure
            // here doesn't affect the export, so it's logged, not thrown.
            if (uploadedTempGcsPath) {
                gcsBucket.file(uploadedTempGcsPath).delete().catch(err =>
                    console.warn(`  ⚠️  Could not clean up temp GCS base video: ${err.message}`));
            }
        } catch (revideoErr) {
            revideoWarning = revideoErr.message.slice(0, 800);
            console.error(`  ❌ Revideo composite failed — captions/graphics missing:\n${revideoErr.message}`);
        }
    }

    // ── STEP 4: Text overlays ──────────────────────────────────────────────
    // Skipped when Revideo already composited captions (revideoSucceeded) —
    // running both would draw every caption twice. When useRevideo was
    // requested but failed, this does NOT run either (see the fails-open note
    // above): a Revideo attempt that fails ships without captions/graphics
    // rather than silently falling through to the old drawtext path, which
    // could otherwise mask a worker outage as "everything's fine."
    // captionError is set if the burn-in step fails; surfaced in job result.
    let captionError = null;
    // Fonts the user actually asked for that couldn't be resolved to a real file
    // and were silently substituted with the fallback (Anton). Previously this
    // was invisible — the export "succeeded" with the wrong font baked in and
    // no warning anywhere. Collected here and folded into captionWarning below.
    const fontFallbackWarnings = new Set();
    const textTracks = timeline.tracks.filter(t => t.type === 'text' && t.clips?.length > 0);

    // Gated on revideoSucceeded, not useRevideo. If the worker fails mid-render,
    // captions are still drawn here instead of being dropped.
    if (textTracks.length > 0 && !revideoSucceeded) {
        // ── Font resolution ────────────────────────────────────────────────
        const fontsDir = path.join(publicDir, 'fonts');
        if (!fs.existsSync(fontsDir)) fs.mkdirSync(fontsDir, { recursive: true });

        // Collect only the font families actually used in this export
        const neededFamilies = new Set(['Anton']); // Anton always needed as fallback
        for (const track of textTracks) {
            for (const clip of track.clips) {
                if (clip.fontFamily) neededFamilies.add(clip.fontFamily);
            }
        }

        // Download missing fonts in parallel (files persist across exports)
        await Promise.all(
            [...neededFamilies].map(family => {
                const spec = FONT_SPECS[family];
                if (!spec) return Promise.resolve();
                return downloadFont(path.join(fontsDir, spec.file), spec);
            })
        );

        // Build FAMILY_PATHS from FONT_SPECS (only include files that exist on disk)
        const FAMILY_PATHS = {};
        for (const [family, spec] of Object.entries(FONT_SPECS)) {
            const p = path.join(fontsDir, spec.file);
            if (fs.existsSync(p) && fs.statSync(p).size > 5_000) FAMILY_PATHS[family] = p;
        }
        // Also include system fonts as aliases
        const systemFontAliases = {
            'Liberation Sans': '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
            'DejaVu Sans':     '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
            'FreeSans':        '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
            'Helvetica':       '/System/Library/Fonts/Helvetica.ttc',
        };
        for (const [family, p] of Object.entries(systemFontAliases)) {
            if (fs.existsSync(p)) FAMILY_PATHS[family] = p;
        }

        // Ordered fallback list — Anton first (Vibed default)
        const fallbackFontPath = [
            path.join(fontsDir, 'Anton-Regular.ttf'),
            path.join(fontsDir, 'Roboto-Regular.ttf'),
            '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
            '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
            '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
            '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
            '/System/Library/Fonts/Helvetica.ttc',
        ].find(p => fs.existsSync(p)) || null;

        if (!fallbackFontPath) {
            console.warn('  ⚠️  No usable font found for caption export — skipping text overlay');
        } else {
            // ── Vibed-timeline → output-video time mapping ─────────────────
            // The exported video has all clips concatenated with no gaps.
            // segClips[i] is the source clip and segOutputStarts[i] is where it
            // starts in the output video.  Captions carry Vibed timeline times,
            // which must be converted to output times before writing the enable expr.
            const vibedToOutputTime = (vibedTime) => {
                for (let si = 0; si < segClips.length; si++) {
                    const sc = segClips[si];
                    const clipEnd = sc.start + sc.duration;
                    if (vibedTime >= sc.start && vibedTime < clipEnd) {
                        // A clip lasts its timeline duration in the output, so
                        // time inside it maps 1:1 (speed is already in it).
                        return segOutputStarts[si] + (vibedTime - sc.start);
                    }
                }
                // Before the first clip → clamp to output t=0
                if (segClips.length === 0 || vibedTime <= segClips[0].start) return 0;
                // Past the last clip → clamp to total output duration
                return cumulativeOut;
            };

            // ── Build drawtext filter chain ────────────────────────────────
            // IMPORTANT: Use textfile= (not text=) so ffmpeg reads text from a file.
            // This completely avoids ffmpeg filter-string escaping issues — apostrophes,
            // commas, colons, quotes, etc. in caption text all work transparently.
            const textFilters = [];
            const captionSourcePath = finalVideoPath;
            const { mergeCaptionFilterGroups } = require('../server/compositor/CaptionCompiler.js');
            const captionFilterGroups = [];
            const captionOrder = new Map();
            let captionOrderIndex = 0;
            for (const track of textTracks) {
                for (const clip of track.clips) captionOrder.set(clip.id, captionOrderIndex++);
            }
            let filterIdx = 0;

            // ── R63: animated captions (motion/textShadow/uppercase/reveal) ────
            // `captionProgram` is built client-side from the SAME resolver that
            // drives the live preview (client/src/motion/CaptionCompiler.js) and
            // ships in export settings exactly like `compositionPlan` (R59-60).
            // Clips it covers are rendered by the compiled program below and
            // SKIPPED by the plain per-clip loop that follows — one clip must
            // never be drawn by both paths. A clip with no animation/shadow/
            // uppercase never appears in the program at all, so today's plain
            // captions take the exact code path they always have.
            // FAILS OPEN like the compositor and the LUT lookup (R55): any
            // problem here just means `programClipIds` stays empty and every
            // clip falls through to the untouched static path below.
            // captionProgramWarning itself is declared at function scope (near
            // compositorWarning, above) — see the comment there. Only reassigned
            // here, never re-declared, so the final return statement can see it.
            const programClipIds = new Set();
            let compiledCaptionProgram = { filters: [], tempFiles: [], skipped: [] };
            // R88 raster captions: prepared images + the program entries they
            // replace (kept for the drawtext fallback if the overlay pass fails).
            let rasterPrepared = null;
            let rasterProgramEntries = [];
            const rawCaptionProgram = settings.captionProgram || null;

            if (rawCaptionProgram && process.env.CAPTION_PROGRAM_DISABLED !== '1') {
                try {
                    const { compileCaptionProgram, validateCaptionProgramShape } =
                        require('../server/compositor/CaptionCompiler.js');

                    const programErrors = validateCaptionProgramShape(rawCaptionProgram);
                    if (programErrors.length > 0) {
                        throw new Error(`caption program rejected: ${programErrors.slice(0, 3).join('; ')}`);
                    }

                    // Same reference-resolution correction as the static drawtext
                    // path above (`captionScaleFactor`) — `entry.style.fontSize`/
                    // `stroke.width` are reference-resolution pixels, and
                    // CaptionCompiler.js has no other way to know the actual
                    // render resolution can differ from that reference (any
                    // resolution tier other than the '1080p' one the reference
                    // table matches). Scaled once here, at the call site, so
                    // CaptionCompiler.js itself stays resolution-agnostic rather
                    // than also learning about targetWidth/ASPECT_RATIO_DIMENSIONS.
                    const scaledCaptionProgram = captionScaleFactor === 1
                        ? rawCaptionProgram
                        : {
                            ...rawCaptionProgram,
                            entries: rawCaptionProgram.entries.map(entry => ({
                                ...entry,
                                style: {
                                    ...entry.style,
                                    fontSize: (Number(entry.style?.fontSize) || 48) * captionScaleFactor,
                                    stroke: entry.style?.stroke
                                        ? { ...entry.style.stroke, width: (Number(entry.style.stroke.width) || 0) * captionScaleFactor }
                                        : entry.style?.stroke,
                                },
                            })),
                        };

                    // R88 — captions with rotation, per-word highlight or keyword
                    // emphasis are drawn as images (RasterCaptionCompiler), not
                    // drawtext. Prepared FIRST: an entry is only taken off the
                    // drawtext program once its images actually exist. If
                    // preparation fails, the entry stays below and renders as
                    // plain animated text, exactly as it did before R88.
                    if (process.env.RASTER_CAPTIONS_DISABLED !== '1') {
                        try {
                            const { prepareRasterCaptions, rasterEntries } = require('../server/compositor/RasterCaptionCompiler.js');
                            const wanted = rasterEntries(scaledCaptionProgram);
                            if (wanted.length > 0) {
                                rasterPrepared = prepareRasterCaptions(wanted, {
                                    tmpDir,
                                    frameWidth: targetWidth,
                                    frameHeight: targetHeight,
                                    pxScale: captionScaleFactor,
                                    fallbackFontPath,
                                    resolveFont: (family) => (family && FAMILY_PATHS[family]) ? FAMILY_PATHS[family] : null,
                                });
                                if (rasterPrepared.skipped.length > 0) {
                                    console.warn(`  ⚠️  ${rasterPrepared.skipped.length} raster caption(s) fell back to text:`, rasterPrepared.skipped.slice(0, 3));
                                    // Surfaced, not only logged: a skipped entry
                                    // still ships, but as one unwrapped drawtext
                                    // line with no highlight and no rotation. The
                                    // user sees that difference immediately and
                                    // had no way to know it was expected.
                                    const reasons = [...new Set(rasterPrepared.skipped.map(s => s.reason).filter(Boolean))];
                                    captionProgramWarning =
                                        `${rasterPrepared.skipped.length} of ${wanted.length} caption(s) were exported as plain text`
                                        + (reasons.length ? ` (${reasons.slice(0, 3).join('; ')})` : '') + '.';
                                }
                                console.log(`🖼️  [ExportJob ${job.id}] raster captions: ${rasterPrepared.items.length}/${wanted.length} prepared`);
                            }
                        } catch (rasterErr) {
                            rasterPrepared = null;
                            captionProgramWarning = `Rotated/highlighted captions were exported as plain text: ${rasterErr.message}`;
                            console.warn(`[ExportJob ${job.id}] raster caption preparation failed (plain text instead):`, rasterErr.message);
                        }
                    }
                    const rasterIds = new Set((rasterPrepared?.items || []).map(it => it.clipId));
                    rasterProgramEntries = scaledCaptionProgram.entries.filter(e => rasterIds.has(e.clipId));
                    const drawtextProgram = rasterIds.size === 0
                        ? scaledCaptionProgram
                        : { ...scaledCaptionProgram, entries: scaledCaptionProgram.entries.filter(e => !rasterIds.has(e.clipId)) };

                    compiledCaptionProgram = compileCaptionProgram(drawtextProgram, {
                        tmpDir,
                        escapePath: (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:'),
                        fallbackFontPath,
                        resolveFont: (family) => (family && FAMILY_PATHS[family]) ? FAMILY_PATHS[family] : null,
                    });

                    for (const entry of rawCaptionProgram.entries) programClipIds.add(entry.clipId);
                    if (compiledCaptionProgram.skipped.length > 0) {
                        captionProgramWarning = `${compiledCaptionProgram.skipped.length} animated caption(s) fell back to plain rendering (font unresolved).`;
                    }
                    // Font substitutions on THIS path used to be completely silent —
                    // see the comment on compileCaptionProgram's return shape in
                    // server/compositor/CaptionCompiler.js. Feed them into the SAME
                    // `fontFallbackWarnings` set the static per-clip loop below
                    // already populates, so both rendering paths report through the
                    // one unified `captionWarning` field instead of the static path
                    // being the only one honest about a substitution happening.
                    for (const { requestedFamily } of (compiledCaptionProgram.fontFallbacks || [])) {
                        fontFallbackWarnings.add(
                            FONT_SPECS[requestedFamily]
                                ? `"${requestedFamily}" (download failed — see [fonts] log above)`
                                : `"${requestedFamily}" (unknown font — not in FONT_SPECS)`
                        );
                    }
                    console.log(`🎬 [ExportJob ${job.id}] animated captions: ${rawCaptionProgram.entries.length} clip(s), ${compiledCaptionProgram.filters.length} filter(s)`);
                } catch (progErr) {
                    captionProgramWarning = `Animated captions could not be rendered — exported with plain static captions instead: ${progErr.message}`;
                    console.warn(`[ExportJob ${job.id}] caption program failed (falling back to static captions):`, progErr.message);
                    programClipIds.clear();
                    compiledCaptionProgram = { filters: [], tempFiles: [], skipped: [] };
                    rasterPrepared = null;
                    rasterProgramEntries = [];
                }
            }

            for (const track of textTracks) {
                for (const clip of track.clips) {
                    if (programClipIds.has(clip.id) || sandwichRenderedClipIds.has(clip.id)) continue; // rendered by the compiled program or sandwich layer instead
                    const rawText    = clip.content || clip.name || '';
                    // Convert Vibed timeline positions to output video positions.
                    const vibedStart = typeof clip.start    === 'number' ? clip.start    : 0;
                    const vibedDur   = typeof clip.duration === 'number' ? clip.duration : 3;
                    const startSec   = Math.max(0, vibedToOutputTime(vibedStart));
                    const endSec     = vibedToOutputTime(vibedStart + vibedDur);

                    if (endSec <= startSec) continue; // skip zero/negative duration or out-of-range

                    // Write the caption text to a temp file — no escaping needed
                    const textFilePath = path.join(tmpDir, `cap-${filterIdx}.txt`);
                    fs.writeFileSync(textFilePath, rawText, 'utf8');
                    // Escape the file path for the drawtext option (only : needs escaping)
                    const escapedTextFile = textFilePath.replace(/\\/g, '/').replace(/:/g, '\\:');

                    // Font: prefer the clip's declared fontFamily, fall back to default
                    const declaredFamily = clip.fontFamily;
                    const familyPath = declaredFamily && FAMILY_PATHS[declaredFamily]
                        ? FAMILY_PATHS[declaredFamily]
                        : null;
                    const familyResolved = !!(familyPath && fs.existsSync(familyPath));
                    const resolvedFont = familyResolved ? familyPath : fallbackFontPath;
                    // Track silent substitutions: the user asked for a specific font
                    // and it couldn't be resolved — either it's missing from
                    // FONT_SPECS entirely, or it IS registered but the file never
                    // downloaded successfully.
                    //
                    // IMPORTANT: this used to skip warning when declaredFamily was
                    // 'Anton', on the assumption "Anton is the fallback anyway, so
                    // Anton-requests-Anton is never a substitution." That's true only
                    // when Anton's OWN file actually resolves. If Anton's file is
                    // missing too (e.g. a fresh deployment before fonts finish baking/
                    // downloading), resolvedFont falls further down fallbackFontPath
                    // to Roboto/DejaVu/system fonts — a real substitution that the
                    // Anton exclusion was hiding with zero warning. Captions rendered
                    // in a plain system font instead of Anton, silently, on every
                    // export, until this was removed.
                    if (declaredFamily && !familyResolved) {
                        fontFallbackWarnings.add(
                            FONT_SPECS[declaredFamily]
                                ? `"${declaredFamily}" (download failed — see [fonts] log above)`
                                : `"${declaredFamily}" (unknown font — not in FONT_SPECS)`
                        );
                    }
                    const escapedFont = resolvedFont.replace(/\\/g, '/').replace(/:/g, '\\:');

                    // Vibed caption defaults must match addCaptionClips defaults
                    // (#FACC15 yellow + Anton 48 — not plain white Roboto).
                    const color    = (clip.color || '#FACC15').replace('#', '0x');
                    // clip.scale is the pinch-to-resize/drag-handle factor applied in
                    // the live preview (TextOverlay.jsx: `transform: scale(${clip.scale
                    // || 1})` on top of `fontSize * previewScale`). The export never
                    // read it, so a caption the user visibly enlarged in the editor
                    // (e.g. to fill ~1/8 of the frame height) burned in at its raw,
                    // un-resized base fontSize — tiny relative to what the preview
                    // showed. previewScale itself is resolution-normalizing and cancels
                    // out here since drawtext already renders at the true output
                    // resolution, so `fontSize * clip.scale` is the correct export-side
                    // equivalent.
                    const size     = Math.round((clip.fontSize || 48) * (clip.scale || 1) * captionScaleFactor);

                    // IMPORTANT: clip.x/clip.y are 0-100 PERCENTAGES of the frame,
                    // representing where the CENTER of the text box sits — this is
                    // exactly what client/src/components/Player/TextOverlay.jsx uses
                    // for the live preview: `left:${clip.x}%; top:${clip.y}%` plus
                    // `transform: translate(-50%,-50%)` to center the box on that
                    // point. This used to be treated as a raw pixel offset added to
                    // targetWidth/2 (`Math.round(clip.x + targetWidth/2)`), which was
                    // wrong on two counts: wrong unit (percent vs pixels) and it threw
                    // away the text_w/text_h centering term entirely, so drawtext's
                    // x= (which is the text box's LEFT edge, not its center) landed
                    // far past where the text should start — pushing captions off the
                    // right/bottom edge of the frame, worse the wider the text. The
                    // fix mirrors the preview's math as an ffmpeg eval expression so
                    // exported captions land exactly where the editor showed them.
                    let x = '(w-text_w)/2';
                    let y = '(h-text_h)/2';
                    if (clip.position === 'bottom') y = 'h*0.85-text_h/2';
                    if (clip.position === 'top')    y = 'h*0.12-text_h/2';
                    if (typeof clip.x === 'number') x = `(${(clip.x / 100).toFixed(6)})*w-text_w/2`;
                    if (typeof clip.y === 'number') y = `(${(clip.y / 100).toFixed(6)})*h-text_h/2`;

                    // Stroke (border) — maps directly to drawtext borderw / bordercolor.
                    // Default matches addCaptionClips: 2px black outline.
                    // Same clip.scale correction as fontSize above — the preview's
                    // CSS scale() visually scales the stroke along with the glyphs.
                    const strokeWidth = Math.round((clip.stroke?.width ?? 2) * (clip.scale || 1) * captionScaleFactor);
                    const strokeColor = (clip.stroke?.color || '#000000').replace('#', '0x');
                    const strokePart  = strokeWidth > 0
                        ? `:borderw=${strokeWidth}:bordercolor=${strokeColor}`
                        : '';

                    captionFilterGroups.push({ clipId: clip.id, filters: [
                        `drawtext=fontfile='${escapedFont}'` +
                        `:textfile='${escapedTextFile}'` +
                        `:fontsize=${size}:fontcolor=${color}` +
                        `:x=${x}:y=${y}` +
                        strokePart +
                        `:enable='gte(t,${startSec})*lte(t,${endSec})'`
                    ] });
                    filterIdx++;
                }
            }

            // Keep each caption's filters together (shadow, glow and glyph
            // passes are one visual layer), then restore the original timeline
            // track/clip order across static and animated captions.
            for (const group of compiledCaptionProgram.groups || []) {
                captionFilterGroups.push({
                    clipId: group.clipId,
                    filters: group.filters,
                });
            }
            const orderedCaptionFilters = mergeCaptionFilterGroups(captionFilterGroups, captionOrder);
            textFilters.push(...orderedCaptionFilters);

            // Keep the same resolved caption layers available to alpha
            // exports. The flattened MP4 renderer below and the transparent
            // graphics renderer must use the same caption compiler output.
            transparentCaptionLayers = {
                items: rasterPrepared?.items || [],
                drawtextGroups: captionFilterGroups,
                orderByClipId: captionOrder,
            };

            const hasRasterCaptionLayers = (rasterPrepared?.items || []).length > 0;
            if (textFilters.length > 0 && !hasRasterCaptionLayers) {
                const textOverlayPath = path.join(tmpDir, 'with_text.mp4');
                // Join filters with comma; each drawtext is one element in the vf chain.
                // Note: commas inside individual filter options are already inside
                // single-quoted strings so they don't act as filter separators.
                const vfChain = textFilters.join(',');
                // A project with many animated caption clips (per-word reveal
                // effects generate ~10 drawtext filters per clip) can produce a
                // vf chain hundreds of KB long. Passing that as a single argv
                // entry to spawn() blows past the OS's combined argv+environ
                // limit (ARG_MAX) and spawn() fails with `spawn E2BIG` before
                // ffmpeg even starts — this is why captions silently went
                // missing on exports with many caption clips (41 clips / 402
                // filters in the reported case). Fix: write the filtergraph to
                // a file and point ffmpeg at it with -filter_script:v, which
                // takes the same syntax as -vf but reads it from disk instead
                // of the command line, so the argv stays tiny regardless of
                // how many filters are chained.
                const filterScriptPath = path.join(tmpDir, 'caption_filters.txt');
                fs.writeFileSync(filterScriptPath, vfChain, 'utf-8');
                const drawtextArgs = [
                    '-i',  finalVideoPath,
                    '-filter_script:v', filterScriptPath,
                    '-map', '0:v',
                    '-map', '0:a?',
                    '-c:v', codec,
                    '-b:v', videoBitrate,  // preserve quality on caption re-encode
                    '-profile:v', profile,
                    '-pix_fmt', 'yuv420p',
                    '-c:a', 'copy',
                    '-y',
                    textOverlayPath,
                ];
                console.log(`  🔤 Applying ${textFilters.length} caption(s) with ${DRAWTEXT_BIN === ffmpegPath ? 'static' : 'system'} ffmpeg`);
                try {
                    await new Promise((resolve, reject) => {
                        const proc = spawn(DRAWTEXT_BIN, drawtextArgs);
                        const stderrChunks = [];
                        proc.stderr.on('data', chunk => stderrChunks.push(chunk));
                        proc.on('error', reject);
                        proc.on('close', code => {
                            if (code === 0) {
                                resolve();
                            } else {
                                const errTail = Buffer.concat(stderrChunks).toString('utf-8').slice(-8000);
                                reject(new Error(`ffmpeg drawtext exited ${code}:\n${errTail}`));
                            }
                        });
                    });
                    finalVideoPath = textOverlayPath;
                    console.log('  ✅ Text overlays applied');
                } catch (textErr) {
                    captionError = textErr.message.slice(0, 800);
                    console.error(`  ❌ Text overlay failed — captions missing:\n${textErr.message}`);
                    // Deliver the video without captions rather than failing the
                    // whole job.  The error is surfaced in the job result so the
                    // client can show a toast ("Video exported, but captions failed").
                }
            }

            // ── R88: raster captions (rotation / word highlight / emphasis) ──
            // One extra pass, only when such captions exist, so every other
            // project renders exactly as before. FAILS OPEN: if the overlay
            // pass fails, the same entries are drawn as plain animated text
            // with the R63 drawtext compiler, so the words are never lost.
            if (rasterPrepared && rasterPrepared.items.length > 0) {
                const { compileRasterOverlays } = require('../server/compositor/RasterCaptionCompiler.js');
                const rasterOutPath = path.join(tmpDir, 'with_raster_captions.mp4');
                try {
                    const graph = compileRasterOverlays(rasterPrepared.items, {
                        frameWidth: targetWidth, frameHeight: targetHeight, fps: targetFps,
                        drawtextGroups: captionFilterGroups,
                        orderByClipId: captionOrder,
                    });
                    if (!graph) throw new Error('nothing to draw');
                    const graphPath = path.join(tmpDir, 'raster_caption_graph.txt');
                    fs.writeFileSync(graphPath, graph.filterComplex, 'utf-8');
                    const args = ['-i', captionSourcePath];
                    for (const inp of graph.inputs) args.push(...inp.inputOptions, '-i', inp.path);
                    args.push(
                        '-filter_complex_script', graphPath,
                        '-map', `[${graph.outputLabel}]`,
                        '-map', '0:a?',
                        '-c:v', codec,
                        '-b:v', videoBitrate,
                        '-profile:v', profile,
                        '-pix_fmt', 'yuv420p',
                        '-c:a', 'copy',
                        '-y',
                        rasterOutPath,
                    );
                    console.log(`  🖼️  Drawing ${rasterPrepared.items.length} raster caption(s)`);
                    await runFfmpegArgs(DRAWTEXT_BIN, args);
                    finalVideoPath = rasterOutPath;
                    console.log('  ✅ Raster captions applied');
                } catch (rasterErr) {
                    console.warn(
                        `[ExportJob ${job.id}] raster caption pass failed, drawing them as text:\n` +
                        `  Diagnosis: ${firstFfmpegError(rasterErr.message)}\n` +
                        `  Stderr tail: ${rasterErr.message.slice(-1500)}`
                    );
                    // The REASON used to stop here, in a worker log nobody
                    // watching an export can see. With PARITY_ALL_TEXT every
                    // text clip is a raster entry, so this one failure takes
                    // the whole look of the video with it — wrapping, the
                    // keyword highlight, rotation, weight and alignment all
                    // revert to one unwrapped drawtext line — and the user was
                    // told only that it happened, never why. A warning without
                    // a cause cannot be acted on by the person reading it or
                    // by whoever they report it to.
                    captionProgramWarning =
                        `Rotated/highlighted captions were exported as plain text (${rasterPrepared.items.length} caption(s)): `
                        + `${firstFfmpegError(rasterErr.message)}`;
                    try {
                        const { compileCaptionProgram } = require('../server/compositor/CaptionCompiler.js');
                        const fallback = compileCaptionProgram({ version: rawCaptionProgram.version, entries: rasterProgramEntries }, {
                            tmpDir,
                            escapePath: (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:'),
                            fallbackFontPath,
                            resolveFont: (family) => (family && FAMILY_PATHS[family]) ? FAMILY_PATHS[family] : null,
                        });
                        const fallbackGroups = [
                            ...captionFilterGroups,
                            ...(fallback.groups || []),
                        ];
                        const orderedFallbackFilters = mergeCaptionFilterGroups(fallbackGroups, captionOrder);
                        if (orderedFallbackFilters.length > 0) {
                            const fbScript = path.join(tmpDir, 'raster_fallback_filters.txt');
                            fs.writeFileSync(fbScript, orderedFallbackFilters.join(','), 'utf-8');
                            const fbOut = path.join(tmpDir, 'with_raster_fallback.mp4');
                            await runFfmpegArgs(DRAWTEXT_BIN, [
                                '-i', captionSourcePath, '-filter_script:v', fbScript,
                                '-map', '0:v', '-map', '0:a?',
                                '-c:v', codec, '-b:v', videoBitrate, '-profile:v', profile,
                                '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-y', fbOut,
                            ]);
                            finalVideoPath = fbOut;
                        }
                    } catch (fbErr) {
                        captionError = `Some captions could not be drawn: ${fbErr.message.slice(0, 400)}`;
                        console.error(`  ❌ Raster caption fallback failed:`, fbErr.message.slice(0, 600));
                    }
                }
            }
        }
    }

    if (finalVideoPath !== outputPath) {
        fs.renameSync(finalVideoPath, outputPath);
    }

    // The edit pipeline uses MP4 intermediates because its effect, caption,
    // transition, and compositing stages are authored against that container.
    // Honour the export dialog's WebM choice with one final encode instead of
    // returning H.264 bytes under a misleading extension.
    let deliveredPath = outputPath;
    let deliveredCodec = codec;
    const formatChoice = String(settings.format || 'mp4').toLowerCase();
    const requestedFormat = ['mp4', 'webm', 'png-sequence', 'transparent-png-sequence', 'transparent-mov'].includes(formatChoice) ? formatChoice : 'mp4';
    if (['transparent-png-sequence', 'transparent-mov'].includes(requestedFormat)) {
        const alphaDuration = Math.max(0.1, cumulativeOut,
            Number(rawPlan?.base?.totalDuration) || 0);
        const frameCount = Math.max(1, Math.ceil(alphaDuration * targetFps));
        const captionLayers = transparentCaptionLayers;
        const hasCaptions = !!(captionLayers
            && (captionLayers.items.length || captionLayers.drawtextGroups.length));
        if (!transparentGraphicsPath || !fs.existsSync(transparentGraphicsPath)) {
            if (!hasCaptions) {
                throw new Error(compositorWarning || 'Transparent graphics export needs at least one supported overlay or caption layer. Choose PNG sequence for a flattened video export.');
            }
            const alphaDir = path.join(tmpDir, 'transparent-graphics');
            fs.mkdirSync(alphaDir, { recursive: true });
            const alphaPattern = path.join(alphaDir, 'frame-%06d.png');
            await runFfmpegArgs(ffmpegPath, [
                '-hide_banner', '-loglevel', 'error',
                '-f', 'lavfi', '-i', `color=c=black@0:s=${targetWidth}x${targetHeight}:r=${targetFps}:d=${alphaDuration},format=rgba`,
                '-frames:v', String(frameCount), '-start_number', '1',
                '-c:v', 'png', '-pix_fmt', 'rgba', '-compression_level', '3',
                '-y', alphaPattern,
            ]);
            transparentGraphicsPath = alphaDir;
            transparentGraphicsFrameCount = frameCount;
        }

        if (hasCaptions) {
            const { compileRasterOverlays } = require('../server/compositor/RasterCaptionCompiler.js');
            const graph = compileRasterOverlays(captionLayers.items, {
                frameWidth: targetWidth,
                frameHeight: targetHeight,
                fps: targetFps,
                drawtextGroups: captionLayers.drawtextGroups,
                orderByClipId: captionLayers.orderByClipId,
                inputLabel: 'alpha_base',
            });
            if (graph) {
                const sourcePattern = path.join(transparentGraphicsPath, 'frame-%06d.png');
                const outputDir = path.join(tmpDir, 'transparent-graphics-with-captions');
                fs.mkdirSync(outputDir, { recursive: true });
                const outputPattern = path.join(outputDir, 'frame-%06d.png');
                const graphPath = path.join(tmpDir, 'transparent_caption_filter.txt');
                fs.writeFileSync(graphPath, `[0:v]format=rgba[alpha_base];${graph.filterComplex}`, 'utf8');
                const args = [
                    '-hide_banner', '-loglevel', 'error',
                    '-framerate', String(targetFps), '-start_number', '1', '-i', sourcePattern,
                ];
                for (const input of graph.inputs) args.push(...input.inputOptions, '-i', input.path);
                args.push(
                    '-filter_complex_script', graphPath,
                    '-map', `[${graph.outputLabel}]`,
                    '-frames:v', String(transparentGraphicsFrameCount),
                    '-start_number', '1', '-c:v', 'png', '-pix_fmt', 'rgba', '-compression_level', '3',
                    '-y', outputPattern,
                );
                await runFfmpegArgs(ffmpegPath, args);
                transparentGraphicsPath = outputDir;
            }
        }

        fs.writeFileSync(path.join(transparentGraphicsPath, 'README.txt'),
            `Vibed transparent graphics sequence\nResolution: ${targetWidth}x${targetHeight}\nFrame rate: ${targetFps} fps\nFrames are numbered from 000001 and preserve transparency. Footage base and audio are not included. Captions are included when present.\n`);
    }
    if (requestedFormat === 'webm') {
        deliveredPath = path.join(exportsDir, `${jobId}.webm`);
        await runFfmpegArgs(ffmpegPath, [
            '-hide_banner', '-loglevel', 'error', '-i', outputPath,
            '-map', '0:v:0', '-map', '0:a?',
            '-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0',
            '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1',
            '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-b:a', audioBitrate,
            '-f', 'webm', '-y', deliveredPath,
        ]);
        deliveredCodec = 'libvpx-vp9';
        fs.unlinkSync(outputPath);
    } else if (requestedFormat === 'png-sequence') {
        const sequenceDir = path.join(tmpDir, 'png-sequence');
        fs.mkdirSync(sequenceDir, { recursive: true });
        const framePattern = path.join(sequenceDir, 'frame-%06d.png');
        await runFfmpegArgs(ffmpegPath, [
            '-hide_banner', '-loglevel', 'error', '-i', outputPath,
            '-map', '0:v:0', '-vf', `fps=${targetFps}`,
            '-start_number', '1', '-c:v', 'png', '-compression_level', '3',
            '-y', framePattern,
        ]);
        fs.writeFileSync(path.join(sequenceDir, 'README.txt'), `Vibed PNG image sequence\nResolution: ${targetWidth}x${targetHeight}\nFrame rate: ${targetFps} fps\nFrames are numbered from 000001. This sequence contains the finished composite and is opaque.\n`);
        deliveredPath = path.join(exportsDir, `${jobId}-frames.zip`);
        await runProgram('zip', ['-q', '-r', '-X', deliveredPath, 'png-sequence'], tmpDir);
        deliveredCodec = 'png-sequence';
        fs.unlinkSync(outputPath);
    } else if (requestedFormat === 'transparent-png-sequence') {
        if (!transparentGraphicsPath || !fs.existsSync(transparentGraphicsPath)) {
            throw new Error(compositorWarning || 'Transparent graphics export needs at least one supported overlay layer. Choose PNG sequence for a flattened video export.');
        }
        deliveredPath = path.join(exportsDir, `${jobId}-transparent-graphics.zip`);
        await runProgram('zip', ['-q', '-r', '-X', deliveredPath, path.basename(transparentGraphicsPath)], tmpDir);
        deliveredCodec = 'png-sequence-alpha';
    } else if (requestedFormat === 'transparent-mov') {
        if (!transparentGraphicsPath || !fs.existsSync(transparentGraphicsPath)) {
            throw new Error(compositorWarning || 'Transparent graphics export needs at least one supported overlay layer. Choose PNG sequence for a flattened video export.');
        }
        deliveredPath = path.join(exportsDir, `${jobId}-graphics.mov`);
        const alphaFrames = path.join(transparentGraphicsPath, 'frame-%06d.png');
        await runFfmpegArgs(ffmpegPath, [
            '-hide_banner', '-loglevel', 'error',
            '-framerate', String(targetFps), '-start_number', '1', '-i', alphaFrames,
            '-frames:v', String(Math.max(1, transparentGraphicsFrameCount)),
            '-an', '-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le',
            '-vendor', 'apl0', '-f', 'mov', '-y', deliveredPath,
        ]);
        deliveredCodec = 'prores-4444';
    }

    // Report what was actually rendered, not what was asked for. The old
    // metadata echoed targetWidth x targetHeight, so a 1920x1080 file came
    // back labelled "1080x1920" and the wrong-shape bug was invisible.
    const renderedDims = ['png-sequence', 'transparent-png-sequence'].includes(requestedFormat)
        ? { width: targetWidth, height: targetHeight }
        : await getVideoDimensions(deliveredPath);
    if (renderedDims && (renderedDims.width !== targetWidth || renderedDims.height !== targetHeight)) {
        console.warn(`  ⚠️  [ExportJob ${job.id}] rendered ${renderedDims.width}x${renderedDims.height}, expected ${targetWidth}x${targetHeight}`);
    }

    await job.updateProgress(90);

    // ── Upload to GCS or keep local ────────────────────────────────────────
    const filename = path.basename(deliveredPath);
    const deliveredStats = fs.existsSync(deliveredPath) ? fs.statSync(deliveredPath) : null;
    let resultUrl;

    if (gcsBucket) {
        // exports/<userId>/<projectId>/<file>: deleting the project (or the
        // retention job) can then remove its exports too (services/projectFiles.js).
        const projectFolder = /^[0-9a-f-]{8,64}$/i.test(String(settings.projectId || '')) ? `${settings.projectId}/` : '';
        const gcsDestPath = `exports/${userId}/${projectFolder}${filename}`;
        try {
            await gcsBucket.upload(deliveredPath, {
                destination: gcsDestPath,
                metadata: { contentType: requestedFormat === 'webm' ? 'video/webm' : requestedFormat === 'transparent-mov' ? 'video/quicktime' : ['png-sequence', 'transparent-png-sequence'].includes(requestedFormat) ? 'application/zip' : 'video/mp4' },
            });
            // Remove local file after successful GCS upload
            fs.unlinkSync(deliveredPath);
            resultUrl = `/api/proxy/gcs-media/${gcsDestPath}`;
            console.log(`  ✅ Uploaded to GCS: ${gcsDestPath}`);
        } catch (uploadErr) {
            console.warn(`  ⚠️  GCS upload failed, falling back to local: ${uploadErr.message}`);
            resultUrl = `/uploads/exports/${filename}`;
        }
    } else {
        resultUrl = `/uploads/exports/${filename}`;
    }

    // ── Cleanup temp dir ───────────────────────────────────────────────────
    fs.rmSync(tmpDir, { recursive: true, force: true });

    await job.updateProgress(100);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const sizeMB   = deliveredStats ? (deliveredStats.size / 1024 / 1024).toFixed(1) : '?';

    console.log(`🏁 [ExportJob ${job.id}] Complete: ${sizeMB}MB in ${duration}s → ${resultUrl}`);

    // Combine drawtext failure (video has NO captions) with font-substitution
    // warnings (video has captions, but in the wrong font) into one field so
    // any future UI toast surfaces both without needing a second field wired up.
    let fontWarningMsg = null;
    if (fontFallbackWarnings.size > 0) {
        const list = [...fontFallbackWarnings].join(', ');
        fontWarningMsg = `Caption font fallback: ${list} — used the default font instead.`;
        console.warn(`  ⚠️  [ExportJob ${job.id}] ${fontWarningMsg}`);
    }
    const captionWarning = captionError || fontWarningMsg || undefined;

    return {
        success: true,
        url: resultUrl,
        filename,
        // Populated when the caption burn-in step failed outright (no captions
        // at all) OR when captions rendered but with a substituted font.
        captionWarning,
        // Populated when the overlay compositing pass (STEP 2.5) failed and the
        // video was exported WITHOUT its overlay layers. Surfaced rather than
        // swallowed: the export succeeded, but not as the user composed it, and
        // silently shipping a video missing its graphics is the failure mode
        // this codebase keeps rediscovering.
        compositorWarning: compositorWarning || undefined,
        // A video or audio clip (e.g. a music track) whose source could not
        // be found anywhere — GCS, local disk, or a usable URL — so it was
        // left out of the render entirely rather than failing the export.
        clipWarning: skippedClips.length
            ? `Could not find: ${[...new Set(skippedClips)].join(', ')} — it was left out of this export.`
            : undefined,
        // R89 — set when the transition pass (STEP 2.2) failed; the video
        // shipped with plain cuts instead.
        transitionWarning: transitionWarning || undefined,
        // Populated when animated captions (R63) couldn't render — the export
        // still has captions (the static path never ran for those clips'
        // siblings, and on failure `programClipIds` is cleared so EVERY
        // caption falls back to the static path), just without their motion/
        // shadow/uppercase/reveal.
        captionProgramWarning: captionProgramWarning || undefined,
        // R69 — populated when Revideo compositing was attempted (useRevideo)
        // but failed: the export ships WITHOUT captions/motion-graphics/
        // stickers rather than silently falling back to the FFmpeg drawtext
        // path, so this is the one warning field that means "missing
        // entirely," not "missing some polish."
        revideoWarning: revideoWarning || undefined,
        effectWarning: effectWarnings.length ? [...new Set(effectWarnings)].join(' ') : undefined,
        metadata: {
            duration:   `${duration}s render time`,
            sizeMB:     parseFloat(sizeMB) || 0,
            resolution: renderedDims ? `${renderedDims.width}x${renderedDims.height}` : `${targetWidth}x${targetHeight}`,
            fps:        targetFps,
            codec: deliveredCodec,
            segments:   allClips.length,
            platform:   platform?.label || null,
        },
    };
};

module.exports.FONT_SPECS = FONT_SPECS;
// Pure helpers, exported for scripts/test_export_rotation_zoom.js.
module.exports.rotationFromProbeStream = rotationFromProbeStream;
module.exports.buildSmoothZoomFilter = buildSmoothZoomFilter;
module.exports.atempoChain = atempoChain;
// R100 — pure helpers, exported for scripts/test_base_clip_transform_export.mjs.
module.exports.fitContainSizePx = fitContainSizePx;
module.exports.hasBaseClipTransform = hasBaseClipTransform;
module.exports.buildTransformFilters = buildTransformFilters;
module.exports.buildAnimatedRotationFilter = buildAnimatedRotationFilter;
module.exports.buildAnimatedOpacityFilter = buildAnimatedOpacityFilter;
// R104b — the audio-mix filtergraph, so both branches can be pinned without
// standing up a whole export.
module.exports.buildAudioMixGraph = buildAudioMixGraph;
module.exports.compileTimelineVisualEffects = compileTimelineVisualEffects;
module.exports.buildSelectiveGradeCube = buildSelectiveGradeCube;
module.exports.hasSelectiveGrade = hasSelectiveGrade;
module.exports.compileClipColorGradeFilters = compileClipColorGradeFilters;
module.exports.compileTimelineVisualEffectGraph = compileTimelineVisualEffectGraph;
module.exports.compileTimelineVisualEffectDag = compileTimelineVisualEffectDag;
module.exports.renderGraphicEffectGraphSequence = renderGraphicEffectGraphSequence;
module.exports.renderOverlayEffectGraphSequence = renderOverlayEffectGraphSequence;
module.exports.compileOverlaySourcePreparation = compileOverlaySourcePreparation;
module.exports.compileTimelineAudioEffects = compileTimelineAudioEffects;
module.exports.compileWindowedTimelineAudioEffects = compileWindowedTimelineAudioEffects;
module.exports.applyWindowedTimelineAudioEffectsToFile = applyWindowedTimelineAudioEffectsToFile;
module.exports.applyEffectSamples = applyEffectSamples;
module.exports.resolveTimelineSpeedEffect = resolveTimelineSpeedEffect;
module.exports.buildSpeedRetimePlan = buildSpeedRetimePlan;
module.exports.applyRetimeEasing = applyRetimeEasing;
module.exports.compileScalarEffectTrack = compileScalarEffectTrack;
module.exports.collectTimelineEffectWarnings = collectTimelineEffectWarnings;
module.exports.isRevideoTrackSupported = isRevideoTrackSupported;



