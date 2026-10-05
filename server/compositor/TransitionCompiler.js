/**
 * server/compositor/TransitionCompiler.js
 *
 * R89 (to-do A4) — the export side of the transition pack. Transitions are cut
 * effects centred on each cut of the CONCATENATED base video (STEP 2 output),
 * applied before overlays and captions, so nothing changes length.
 *
 * The curves are not re-implemented here: client/src/motion/TransitionFX.js
 * (pure ESM, no imports) is loaded with a dynamic import() and sampled once per
 * output frame inside each window. The preview reads the same file.
 *
 * Per window, all gated with `enable` so the rest of the video is untouched:
 *   perspective  shift + zoom about the centre (whip, zoom punch, glitch shake)
 *   gblur        directional blur, sigma driven frame by frame through sendcmd
 *   rgbashift    red/blue split (glitch), also through sendcmd
 *   eq           flash to white / dip to black, the exact CSS overlay blend:
 *                Y' = Y(1-a) + a (white) or Y(1-a) (black), chroma × (1-a)
 *   overlay      the speed-line sweep, frames drawn with the SAME drawSpeedLines()
 *                the preview canvas uses (@napi-rs/canvas, Skia)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const FX_PATH = path.join(__dirname, '..', '..', 'client', 'src', 'motion', 'TransitionFX.js');
let fxModulePromise = null;

/** The shared TransitionFX module (ESM), loaded once. */
function loadTransitionFX() {
    if (!fxModulePromise) fxModulePromise = import(pathToFileURL(FX_PATH).href);
    return fxModulePromise;
}

const n4 = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '0';
    return String(Math.round(n * 10000) / 10000);
};

/**
 * Windows in OUTPUT time for the concatenated segments.
 * @param {Array} segClips    the clip behind each segment, in order
 * @param {number[]} segStarts output start of each segment
 * @param {number} totalOut   output duration
 */
function outputWindows(FX, segClips, segStarts, totalOut) {
    const clips = (segClips || []).map((c, i) => {
        const start = Number(segStarts[i]) || 0;
        const end = i + 1 < segStarts.length ? Number(segStarts[i + 1]) : Number(totalOut);
        return { id: c?.id || `seg${i}`, start, duration: Math.max(0, end - start), transition: c?.transition || null };
    });
    return FX.transitionWindows(clips);
}

/** Piecewise-linear expression of samples [{t, v}] in variable `tv`. */
function piecewise(samples, tv) {
    if (samples.length === 0) return '0';
    if (samples.length === 1) return n4(samples[0].v);
    let expr = n4(samples[samples.length - 1].v);
    for (let i = samples.length - 2; i >= 0; i--) {
        const a = samples[i];
        const b = samples[i + 1];
        const span = b.t - a.t;
        const seg = span > 1e-4 ? `${n4(a.v)}+(${n4(b.v - a.v)})*(${tv}-${n4(a.t)})/${n4(span)}` : n4(b.v);
        expr = `if(lt(${tv},${n4(b.t)}),${seg},${expr})`;
    }
    return expr;
}

/**
 * Compile every transition into one filter_complex over input 0.
 *
 * @param {Array} windows from outputWindows
 * @param {object} opts { FX, width, height, fps, tmpDir, canvasModule? }
 * @returns {{filterComplex:string, outputLabel:string, inputs:Array<{path, inputOptions}>, tempFiles:string[]}|null}
 */
function compileTransitions(windows, opts) {
    const list = Array.isArray(windows) ? windows : [];
    if (list.length === 0) return null;
    const { FX } = opts;
    const W = Number(opts.width) || 1080;
    const H = Number(opts.height) || 1920;
    const fps = Number(opts.fps) > 0 ? Number(opts.fps) : 30;
    const dt = 1 / fps;
    const tempFiles = [];
    const inputs = [];
    const cmds = [];
    const chain = [];

    list.forEach((w, i) => {
        // Sample at every output frame inside the window, plus both edges.
        const times = [];
        for (let t = w.from; t < w.to - 1e-6; t += dt) times.push(Number(t.toFixed(4)));
        times.push(Number(w.to.toFixed(4)));
        const samples = times.map(t => ({ t, fx: FX.fxAt(w.type, Math.max(-1, Math.min(1, (t - w.cut) / w.half))) }));
        const enable = `between(t,${n4(w.from)},${n4(w.to)})`;
        const any = (key, test) => samples.some(s => test(s.fx[key]));

        // 1. Shift + zoom about the centre. CSS: translateX(tx·W) scale(s) with
        //    origin at the centre ⇒ src = c + (out − c − tx·W)/s. perspective
        //    maps the four output corners to these source points.
        if (any('tx', v => Math.abs(v) > 1e-5) || any('scale', v => Math.abs(v - 1) > 1e-5)) {
            const T = `(in/${fps})`;
            const S = piecewise(samples.map(s => ({ t: s.t, v: s.fx.scale })), T);
            const TX = piecewise(samples.map(s => ({ t: s.t, v: s.fx.tx })), T);
            const xl = `(W/2+(-W/2-(${TX})*W)/(${S}))`;
            const xr = `(W/2+(W/2-(${TX})*W)/(${S}))`;
            const yt = `(H/2-H/2/(${S}))`;
            const yb = `(H/2+H/2/(${S}))`;
            chain.push(`perspective=x0='${xl}':y0='${yt}':x1='${xr}':y1='${yt}':x2='${xl}':y2='${yb}':x3='${xr}':y3='${yb}':interpolation=linear:eval=frame:enable='${enable}'`);
        }

        // 2. Blur, sigma per frame via sendcmd (gblur options are runtime commands).
        if (any('blurX', v => v > 1e-6) || any('blurY', v => v > 1e-6)) {
            const name = `gblur@tb${i}`;
            chain.push(`${name}=sigma=0.01:sigmaV=0.01:steps=2:enable='${enable}'`);
            for (const s of samples) {
                const sx = Math.max(0.01, s.fx.blurX * W);
                const sy = Math.max(0.01, s.fx.blurY * W);
                cmds.push(`${n4(s.t)} ${name} sigma ${n4(sx)}, ${name} sigmaV ${n4(sy)};`);
            }
        }

        // 3. Red/blue split.
        if (any('chroma', v => Math.abs(v) > 1e-6)) {
            const name = `rgbashift@tc${i}`;
            chain.push(`${name}=rh=0:bh=0:edge=smear:enable='${enable}'`);
            for (const s of samples) {
                const px = Math.round(s.fx.chroma * W);
                cmds.push(`${n4(s.t)} ${name} rh ${px}, ${name} bh ${-px};`);
            }
        }

        // 4. Flash / dip, the CSS overlay blend expressed through eq:
        //    Y' = (Y−0.5)·c + 0.5 + b with c = 1−a and b = ±a/2.
        if (any('flash', v => v > 1e-4) || any('dip', v => v > 1e-4)) {
            const amt = samples.map(s => ({ t: s.t, v: Math.max(s.fx.flash, s.fx.dip) }));
            const A = piecewise(amt, 't');
            // White or black: decided by whichever blend is stronger over the
            // window (one window is one type, so it never flips mid-way).
            const flashSum = samples.reduce((m, s) => m + s.fx.flash, 0);
            const dipSum = samples.reduce((m, s) => m + s.fx.dip, 0);
            const k = flashSum >= dipSum ? 0.5 : -0.5;
            chain.push(`eq=contrast='1-(${A})':brightness='${n4(k)}*(${A})':saturation='1-(${A})':eval=frame:enable='${enable}'`);
        }

        // 5. Speed lines: one transparent PNG per output frame of the window.
        if (samples.some(s => s.fx.lines != null)) {
            const Canvas = opts.canvasModule || require('@napi-rs/canvas');
            const dir = path.join(opts.tmpDir, `tlines-${i}`);
            fs.mkdirSync(dir, { recursive: true });
            const frames = samples.slice(0, -1);
            frames.forEach((s, k) => {
                const c = Canvas.createCanvas(W, H);
                FX.drawSpeedLines(c.getContext('2d'), W, H, s.fx.lines);
                const file = path.join(dir, `f${String(k).padStart(4, '0')}.png`);
                fs.writeFileSync(file, c.toBuffer('image/png'));
                tempFiles.push(file);
            });
            inputs.push({
                path: path.join(dir, 'f%04d.png'),
                inputOptions: ['-framerate', String(fps), '-start_number', '0'],
                window: w,
            });
        }
    });

    if (chain.length === 0 && inputs.length === 0) return null;

    const parts = [];
    let cmdPath = null;
    if (cmds.length > 0) {
        cmdPath = path.join(opts.tmpDir, 'transition_cmds.txt');
        fs.writeFileSync(cmdPath, cmds.join('\n') + '\n', 'utf8');
        tempFiles.push(cmdPath);
    }
    const head = [];
    if (cmdPath) head.push(`sendcmd=f='${cmdPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''")}'`);
    const baseChain = [...head, ...chain];
    let current = 'tfx0';
    parts.push(`[0:v]${baseChain.length ? baseChain.join(',') : 'null'}[${current}]`);

    inputs.forEach((inp, k) => {
        const idx = k + 1;
        const lbl = `tl${k}`;
        parts.push(`[${idx}:v]setpts=PTS-STARTPTS+${n4(inp.window.from)}/TB,format=rgba[${lbl}]`);
        const out = `tfx${k + 1}`;
        parts.push(`[${current}][${lbl}]overlay=0:0:eof_action=pass:enable='between(t,${n4(inp.window.from)},${n4(inp.window.to)})'[${out}]`);
        current = out;
    });

    return {
        filterComplex: parts.join(';'),
        outputLabel: current,
        inputs: inputs.map(({ path: p, inputOptions }) => ({ path: p, inputOptions })),
        tempFiles,
    };
}

module.exports = { loadTransitionFX, outputWindows, compileTransitions, piecewise };
