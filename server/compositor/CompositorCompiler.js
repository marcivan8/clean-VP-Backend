/**
 * server/compositor/CompositorCompiler.js
 *
 * Compiles a composition plan (built by `client/src/motion/Compositor.js`) into
 * an FFmpeg `filter_complex` string.
 *
 * ─── WHY THIS IS A SEPARATE, PURE MODULE ────────────────────────────────────
 * It builds strings and touches nothing else — no fs, no network, no ffmpeg
 * invocation, no job state. That means the whole overlay graph is testable
 * without rendering anything, and the one part that genuinely needs a real
 * encoder (does FFmpeg accept and execute this graph?) is proven separately by
 * running it, exactly as §5 of `test_lut_export.js` proves the LUT chain.
 *
 * ─── THE PLAN IS AUTHORED ON THE CLIENT, NOT RE-DERIVED HERE ────────────────
 * This module does NOT decide what overlays exist, where they go, or when. That
 * is `Compositor.buildCompositionPlan()`, which runs once on the client and
 * ships in the export settings — the same route `projectLUTId` takes (R55).
 * Re-deriving any of it here would recreate the divergence that produced R14,
 * R16, R53 and R56. This module only translates.
 *
 * ─── COORDINATE / CLOCK CONTRACT ────────────────────────────────────────────
 * Plan geometry is already in OUTPUT time and expressed as TOP-LEFT positions
 * in NORMALISED units (0..1 fractions of the frame). Both conversions happen in
 * the Compositor. This module multiplies by the resolution actually being
 * rendered — the only place the plan ever meets a pixel — which is what lets a
 * single plan export correctly at 720p and at 4K.
 * Two consequences worth stating because getting either wrong is silent:
 *   • `t` inside the `overlay` filter is the BASE stream's timestamp, i.e.
 *     output time. Geometry expressions therefore need no offset.
 *   • Each overlay stream is `setpts`-shifted to its output start FIRST, so
 *     every later filter in that chain (scale, fade) also sees output time.
 *     Shifting last would leave scale/fade on a 0-based clock and put animated
 *     size and fades at the wrong moment while position stayed correct — a
 *     particularly confusing way to fail.
 */

'use strict';

const hasNumericValue = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const SHAPE_MASKS = new Set(['ellipse', 'circle', 'rectangle', 'rounded-rectangle', 'capsule', 'callout', 'polygon', 'star', 'arrow']);

function polygonMaskExpression(mask, x, y, w, h) {
    const points = mask.shape === 'star'
        ? Math.max(2, Math.min(64, Math.round(Number(mask.points) || 5))) * 2
        : Math.max(3, Math.min(128, Math.round(Number(mask.sides) || 5)));
    const outerRatio = Math.max(0.01, Math.min(0.5, Number(mask.outerRadius ?? mask.radius ?? 0.5)));
    const innerRatio = Math.max(0.005, Math.min(outerRatio, Number(mask.innerRadius ?? outerRatio * 0.5)));
    const cx = x + w / 2, cy = y + h / 2;
    const outer = Math.min(w, h) * outerRatio;
    const inner = Math.min(w, h) * innerRatio;
    const rotation = (Number(mask.rotation) || 0) * Math.PI / 180 - Math.PI / 2;
    const vertices = mask.shape === 'arrow'
        ? [
            [x, cy - h * 0.16], [x + w * 0.58, cy - h * 0.16], [x + w * 0.58, y],
            [x + w, cy], [x + w * 0.58, y + h], [x + w * 0.58, cy + h * 0.16], [x, cy + h * 0.16],
        ].map(([px, py]) => {
            const dx = px - cx, dy = py - cy;
            return { x: cx + dx * Math.cos(rotation) - dy * Math.sin(rotation), y: cy + dx * Math.sin(rotation) + dy * Math.cos(rotation) };
        })
        : Array.from({ length: points }, (_, index) => {
            const radius = mask.shape === 'star' && index % 2 ? inner : outer;
            const angleStep = mask.shape === 'star' ? Math.PI / (points / 2) : (2 * Math.PI) / points;
            const angle = rotation + index * angleStep;
            return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
        });
    const crossings = vertices.map((a, index) => {
        const b = vertices[(index + 1) % vertices.length];
        if (Math.abs(a.y - b.y) < 1e-8) return null;
        const low = n4(Math.min(a.y, b.y)), high = n4(Math.max(a.y, b.y));
        const crossX = `(${n4(a.x)}+(Y/H-${n4(a.y)})*${n4(b.x - a.x)}/${n4(b.y - a.y)})`;
        return `(gt(Y/H,${low})*lte(Y/H,${high})*lt(X/W,${crossX}))`;
    }).filter(Boolean);
    return `gt(mod(${crossings.join('+') || '0'},2),0)`;
}

function calloutMaskExpression(mask, x, y, w, h) {
    const tailSize = h * Math.max(0, Math.min(0.4, Number(mask.tailSize) || 0.2));
    const bodyHeight = h - tailSize;
    const radius = Math.min(w, bodyHeight) * Math.max(0, Math.min(0.45, Number(mask.radius) || 0.12));
    const tailCenter = x + w * Math.max(0.15, Math.min(0.85, Number(mask.tailPosition) || 0.28));
    const cx = n4(x + w / 2), cy = n4(y + bodyHeight / 2), rx = n4(w / 2), ry = n4(bodyHeight / 2), r = n4(radius);
    const qx = `abs(X-W*${cx})-W*(${rx}-${r})`, qy = `abs(Y-H*${cy})-H*(${ry}-${r})`;
    const body = `lte(sqrt(pow(max(${qx},0),2)+pow(max(${qy},0),2))+min(max(${qx},${qy}),0),W*${r})`;
    const tail = tailSize > 0
        ? `between(Y,H*${n4(y + bodyHeight)},H*${n4(y + h)})*lte(abs(X-W*${n4(tailCenter)}),(Y-H*${n4(y + bodyHeight)})*W*${n4(w * 0.55 / tailSize)}/H)`
        : '0';
    return `gt(${body}+${tail},0)`;
}

/**
 * Hard ceiling on geometry samples per overlay.
 *
 * Each sample adds a nested `if(lt(t,..),..)` to the expression, so an
 * unsimplified 60s animated overlay could produce a filter string long enough
 * to hit FFmpeg's parser limits or the command-line length limit — and it would
 * fail at render time, on a real user's export, not here. The Compositor
 * already simplifies collinear samples; this is the backstop.
 */
const MAX_GEOMETRY_SAMPLES = 60;

/** Round to 4dp and strip the trailing zeros FFmpeg does not need. */
const n4 = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '0';
    return String(Math.round(n * 10000) / 10000);
};

// Use the editor's half-open timeline windows in every exported gate.
const timeWindowExpr = (start, end) => `(gte(t,${n4(start)})*lt(t,${n4(end)}))`;

function compileIsolatedGroupEffects(group, groupToken = 'group') {
    const parts = [];
    for (const effect of Array.isArray(group?.effects) ? group.effects : []) {
        if (!effect || effect.enabled === false) continue;
        const p = effect.params || {};
        const read = (key, fallback) => {
            const value = Number(p[key]?.value ?? p[key] ?? fallback);
            return Number.isFinite(value) ? value : fallback;
        };
        const sampled = (key, inactiveValue = 1) => {
            const points = effect.samples?.[key];
            if (!Array.isArray(points) || points.length === 0) return null;
            const bounded = points.map(point => ({ t: Number(point?.t), value: Number(point?.value) }))
                .filter(point => Number.isFinite(point.t) && Number.isFinite(point.value));
            if (!bounded.length) return null;
            let expression = buildPiecewiseExpr(bounded, 'value');
            const windows = Array.isArray(effect.outputWindows) ? effect.outputWindows
                .filter(window => Number.isFinite(Number(window?.start)) && Number.isFinite(Number(window?.end)) && Number(window.end) > Number(window.start)) : [];
            if (windows.length) {
                const active = windows.map(window => timeWindowExpr(window.start, window.end)).join('+');
                expression = `if(${active},${expression},${n4(inactiveValue)})`;
            }
            return expression;
        };
        switch (effect.kind || effect.type) {
            case 'blur': case 'blur_gaussian': {
                const sigma = Math.max(0, Math.min(50, read('radius', read('amount', 0))));
                const key = Array.isArray(effect.samples?.radius) ? 'radius' : 'amount';
                const points = effect.samples?.[key];
                if (Array.isArray(points) && points.length > 1) {
                    const target = `${String(groupToken).replace(/[^a-zA-Z0-9_]/g, '_')}_blur`;
                    const windows = Array.isArray(effect.outputWindows) ? effect.outputWindows
                        .filter(window => Number.isFinite(Number(window?.start)) && Number.isFinite(Number(window?.end)) && Number(window.end) > Number(window.start)) : [];
                    const valueAt = time => {
                        if (windows.length && !windows.some(window => time >= Number(window.start) && time < Number(window.end))) return 0;
                        if (time <= Number(points[0].t)) return Number(points[0].value);
                        for (let index = 0; index < points.length - 1; index++) {
                            const a = points[index], b = points[index + 1];
                            if (time <= Number(b.t)) {
                                const progress = (time - Number(a.t)) / Math.max(1e-6, Number(b.t) - Number(a.t));
                                return Number(a.value) + (Number(b.value) - Number(a.value)) * progress;
                            }
                        }
                        return Number(points.at(-1).value);
                    };
                    // gblur exposes sigma through FFmpeg's command interface.
                    // Re-issue a smoothly sampled command on the same output
                    // clock so an animated blur remains animated in export.
                    const start = Math.max(0, Number(points[0].t) || 0);
                    const end = Math.max(start, Number(points.at(-1).t) || start);
                    const steps = Math.min(1800, Math.max(1, Math.ceil((end - start) * 30)));
                    const commandTimes = new Set([start, end]);
                    for (let index = 1; index < steps; index++) commandTimes.add(start + (end - start) * index / steps);
                    for (const window of windows) {
                        if (Number(window.start) >= start && Number(window.start) <= end) commandTimes.add(Number(window.start));
                        if (Number(window.end) >= start && Number(window.end) <= end) commandTimes.add(Number(window.end));
                    }
                    const commands = [...commandTimes].sort((a, b) => a - b).map(time =>
                        `${n4(time)} ${target} sigma ${n4(Math.max(0, Math.min(50, valueAt(time))))}`);
                    const initial = n4(Math.max(0, Math.min(50, valueAt(start))));
                    // Isolated composition buffers are RGBA. Blur all four
                    // planes so the alpha edge softens along with RGB; leaving
                    // alpha untouched clips the bloom/blur to the child's
                    // original bounds on FFmpeg builds that don't infer alpha.
                    parts.push(`sendcmd=c='${commands.join(';')}',gblur@${target}=sigma=${initial}:planes=15`);
                } else {
                    parts.push(`gblur=sigma=${n4(sigma)}:planes=15`);
                }
                break;
            }
            case 'glow': {
                // A group is rendered to its own transparent canvas. Build the
                // highlight bloom from that isolated image so it cannot leak
                // into sibling layers or the footage beneath the composition.
                const [red, green, blue] = colorToRgb(p.color, [114, 217, 255]);
                const threshold = Math.max(0, Math.min(1, read('threshold', 0.7)));
                const intensity = Math.max(0, Math.min(1, read('intensity', 1) * 0.7));
                const radius = Math.max(0, Math.min(50, read('radius', 18)));
                const thresholdExpression = sampled('threshold', 1);
                const intensityExpression = sampled('intensity', 0);
                const radiusSamples = effect.samples?.radius;
                let radiusCommands = null;
                if (Array.isArray(radiusSamples) && radiusSamples.length > 1) {
                    const windows = Array.isArray(effect.outputWindows) ? effect.outputWindows
                        .filter(window => Number.isFinite(Number(window?.start)) && Number.isFinite(Number(window?.end)) && Number(window.end) > Number(window.start)) : [];
                    const valueAt = time => {
                        if (windows.length && !windows.some(window => time >= Number(window.start) && time < Number(window.end))) return 0;
                        if (time <= Number(radiusSamples[0].t)) return Number(radiusSamples[0].value);
                        for (let index = 0; index < radiusSamples.length - 1; index++) {
                            const a = radiusSamples[index], b = radiusSamples[index + 1];
                            if (time <= Number(b.t)) {
                                const progress = (time - Number(a.t)) / Math.max(1e-6, Number(b.t) - Number(a.t));
                                return Number(a.value) + (Number(b.value) - Number(a.value)) * progress;
                            }
                        }
                        return Number(radiusSamples.at(-1).value);
                    };
                    const start = Math.max(0, Number(radiusSamples[0].t) || 0);
                    const end = Math.max(start, Number(radiusSamples.at(-1).t) || start);
                    const steps = Math.min(1800, Math.max(1, Math.ceil((end - start) * 30)));
                    const commandTimes = new Set([start, end]);
                    for (let index = 1; index < steps; index++) commandTimes.add(start + (end - start) * index / steps);
                    for (const window of windows) {
                        if (Number(window.start) >= start && Number(window.start) <= end) commandTimes.add(Number(window.start));
                        if (Number(window.end) >= start && Number(window.end) <= end) commandTimes.add(Number(window.end));
                    }
                    radiusCommands = [...commandTimes].sort((a, b) => a - b).map(time =>
                        [n4(time), n4(Math.max(0, Math.min(50, valueAt(time))))]);
                }
                parts.push(`__VIBED_GROUP_GLOW__${JSON.stringify({ red, green, blue, threshold, intensity, radius, thresholdExpression, intensityExpression, radiusCommands })}`);
                break;
            }
            case 'brightness': {
                const expression = sampled('amount');
                if (expression) parts.push(`eq=brightness='((${expression})-1)/2':eval=frame`);
                else parts.push(compileBrightnessScale(read('amount', read('value', 1)), 4));
                break;
            }
            case 'contrast': {
                const expression = sampled('amount');
                if (expression) parts.push(`eq=contrast='${expression}':eval=frame`);
                else parts.push(`eq=contrast=${n4(Math.max(0, Math.min(4, read('amount', read('value', 1)))))}`);
                break;
            }
            case 'saturation': case 'saturate': {
                const expression = sampled('amount');
                if (expression) parts.push(`eq=saturation='${expression}':eval=frame`);
                else parts.push(`eq=saturation=${n4(Math.max(0, Math.min(5, read('amount', read('value', 1)))))}`);
                break;
            }
            case 'color_grade': {
                const readGrade = (key, fallback) => Math.max(0, Math.min(200, read(key, fallback)));
                const grade = (key, min = 0, max = 200, fallback = 100, normalize = true) => {
                    const points = effect.samples?.[key];
                    if (!Array.isArray(points) || !points.length) return null;
                    const bounded = points.map(point => ({ ...point, value: Math.max(min, Math.min(max, Number(point.value))) }));
                    const expression = buildPiecewiseExpr(bounded, 'value');
                    const windows = Array.isArray(effect.outputWindows) ? effect.outputWindows : [];
                    const active = windows.map(window => timeWindowExpr(window.start, window.end)).join('+');
                    const sampled = active ? `if(${active},${expression},${fallback})` : expression;
                    return normalize ? `(${sampled})/100` : sampled;
                };
                const brightness = grade('brightness');
                const contrast = grade('contrast');
                const saturation = grade('saturation');
                const temperatureTrack = grade('temperature', -100, 100, 0, false);
                const tintTrack = grade('tint', -100, 100, 0, false);
                const b = brightness ? `((${brightness})-1)/2` : n4((readGrade('brightness', 100) / 100 - 1) / 2);
                const c = contrast || n4(readGrade('contrast', 100) / 100);
                const s = saturation || n4(readGrade('saturation', 100) / 100);
                const animated = brightness || contrast || saturation;
                parts.push(`eq=brightness='${b}':contrast='${c}':saturation='${s}'${animated ? ':eval=frame' : ''}`);
                const temperatureValue = Math.max(-100, Math.min(100, read('temperature', 0)));
                const tintValue = Math.max(-100, Math.min(100, read('tint', 0)));
                const temperature = String(temperatureTrack || n4(temperatureValue)).replace(/\bt\b/g, 'T');
                const tint = String(tintTrack || n4(tintValue)).replace(/\bt\b/g, 'T');
                if (temperatureTrack || tintTrack || temperatureValue || tintValue) {
                    parts.push(`format=rgba,geq=r='clip(r(X,Y)+(${temperature})*0.765,0,255)':g='clip(g(X,Y)+(${tint})*0.765,0,255)':b='clip(b(X,Y)-(${temperature})*0.765,0,255)':a='alpha(X,Y)'`);
                }
                break;
            }
            case 'hue': case 'hue-rotate': {
                const key = effect.samples?.degrees ? 'degrees' : 'amount';
                const expression = sampled(key, 0);
                if (expression) parts.push(`hue=h='${expression}'`);
                else parts.push(`hue=h=${n4(Math.max(-360, Math.min(360, read('degrees', read('amount', 0)))))}`);
                break;
            }
        }
    }
    return parts;
}

function compileBrightnessScale(value, maximum = 2) {
    const factor = Math.max(0, Math.min(maximum, Number.isFinite(Number(value)) ? Number(value) : 1));
    const formatted = n4(factor);
    return `colorchannelmixer=rr=${formatted}:gg=${formatted}:bb=${formatted}`;
}

/**
 * Reduce geometry samples without evenly skipping motion beats. The old
 * uniform decimator could erase short reversals and overshoots from the
 * authored path. Keep the point with the largest deviation from its retained
 * neighbours until the expression budget is met (or the remaining error is
 * visually negligible). Coordinates and dimensions are normalized; rotation
 * and blur are normalized to practical display ranges before comparing.
 */
function decimate(samples, max) {
    if (!Array.isArray(samples) || samples.length <= max || max < 2) return samples;
    const keys = ['x', 'y', 'w', 'h', 'opacity', 'rotation', 'blur', 'flipH', 'flipV']
        .filter(key => samples.some(sample => Number.isFinite(Number(sample?.[key]))));
    const normalize = (key, value) => key === 'rotation' ? value / 360 : key === 'blur' ? value / 100 : value;
    const retained = new Set([0, samples.length - 1]);
    const maxError = 0.0015;

    while (retained.size < max) {
        const anchors = [...retained].sort((a, b) => a - b);
        let worst = maxError;
        let worstIndex = -1;
        for (let spanIndex = 0; spanIndex < anchors.length - 1; spanIndex++) {
            const lo = anchors[spanIndex], hi = anchors[spanIndex + 1];
            const a = samples[lo], b = samples[hi];
            const timeSpan = Number(b.t) - Number(a.t);
            for (let i = lo + 1; i < hi; i++) {
                const p = timeSpan > 0 ? (Number(samples[i].t) - Number(a.t)) / timeSpan : (i - lo) / (hi - lo);
                let error = 0;
                for (const key of keys) {
                    const av = Number(a[key]), bv = Number(b[key]), value = Number(samples[i][key]);
                    if (![av, bv, value].every(Number.isFinite)) continue;
                    error = Math.max(error, Math.abs(normalize(key, value) - (normalize(key, av) + (normalize(key, bv) - normalize(key, av)) * p)));
                }
                if (error > worst) { worst = error; worstIndex = i; }
            }
        }
        if (worstIndex < 0) break;
        retained.add(worstIndex);
    }
    return [...retained].sort((a, b) => a - b).map(index => samples[index]);
}

/**
 * Build a piecewise-linear FFmpeg expression for one geometry property.
 *
 * Deliberately the same nested-`if(lt(t,..))` shape as `buildSmoothZoomFilter()`
 * in jobs/exportProcessor.js. That pattern is already proven in this pipeline
 * for zoom keyframes; a second, different expression style would be one more
 * thing to get subtly wrong.
 *
 * @returns {string} a bare number for static values, an expression otherwise
 */
function buildPiecewiseExpr(samples, key, scale = 1) {
    if (!Array.isArray(samples) || samples.length === 0) return '0';
    const v = (s) => Number(s[key]) * scale;

    if (samples.length === 1) return n4(v(samples[0]));

    const last = samples[samples.length - 1];
    let expr = n4(v(last));

    for (let i = samples.length - 2; i >= 0; i--) {
        const a = samples[i];
        const b = samples[i + 1];
        const span = b.t - a.t;
        const seg = span > 0.001
            ? `${n4(v(a))}+(${n4(v(b) - v(a))})*(t-${n4(a.t)})/${n4(span)}`
            : n4(v(b));
        expr = `if(lt(t,${n4(b.t)}),${seg},${expr})`;
    }
    return expr;
}

/** Does this property actually change across the samples? */
function isAnimated(samples, key) {
    if (!Array.isArray(samples) || samples.length < 2) return false;
    const first = samples[0][key];
    return samples.some(s => Math.abs(s[key] - first) > 0.001);
}

/**
 * Compile one overlay into its source-preparation chain.
 *
 * @param {object} ov       an overlay entry from the plan
 * @param {number} inputIdx this overlay's FFmpeg input index
 * @param {string} label    the stream label to produce
 * @returns {string} a filter chain ending in `[label]`
 */
function compileOverlaySource(ov, inputIdx, label, frame, options = {}) {
    const W = frame.width;
    const H = frame.height;
    const samples = decimate(ov.geometry, MAX_GEOMETRY_SAMPLES);
    const first = samples[0];
    const parts = [];

    // 1. Shift onto output time FIRST so every later filter shares one clock.
    // A sped-up/slowed video overlay plays at its own speed (R88; it used to
    // play at 1x whatever the clip said). Its in-point is applied as an input
    // seek by exportProcessor (`-ss sourceOffset`), so PTS starts at 0 here.
    const ovSpeed = Number(ov.speed) > 0 ? Number(ov.speed) : 1;
    if (ov.source?.type === 'video' && Math.abs(ovSpeed - 1) > 0.001) {
        parts.push(`setpts=(PTS-STARTPTS)/${n4(ovSpeed)}+${n4(ov.outputStart)}/TB`);
    } else {
        parts.push(`setpts=PTS-STARTPTS+${n4(ov.outputStart)}/TB`);
    }

    // 2. Size. `eval=frame` re-evaluates per frame, which is what makes an
    //    animated scale (a sticker "pop") possible at all — verified against a
    //    real encoder, not assumed.
    // Plan geometry is normalised (0..1); multiply by the resolution actually
    // being rendered. This is the ONLY place the plan meets a pixel size, which
    // is what lets one plan export correctly at 720p and 4K alike.
    // Even dimensions: yuv420p chroma subsampling requires them, and an odd
    // width fails the encode with a message that names neither the overlay nor
    // the cause.
    const even = (px) => Math.max(2, Math.round(px / 2) * 2);
    const sizeAnimated = isAnimated(samples, 'w') || isAnimated(samples, 'h');
    const rot = Number(first.rotation) || 0;
    const rotAnimated = isAnimated(samples, 'rotation');
    const rotated = rotAnimated || Math.abs(rot) > 0.01;

    if (ov.fit && ov.fit.mode === 'cover') {
        // R88 layout presets: COVER the box, crop around the focus point —
        // the export twin of CSS object-fit: cover; object-position: fx fy.
        // A framed layer never rotates or resizes (LayoutPresets.js).
        const bw = even(first.w * W);
        const bh = even(first.h * H);
        const fx = Math.max(0, Math.min(1, Number(ov.fit.focusX ?? 0.5)));
        const fy = Math.max(0, Math.min(1, Number(ov.fit.focusY ?? 0.5)));
        parts.push(`scale=${bw}:${bh}:force_original_aspect_ratio=increase`);
        parts.push(`crop=${bw}:${bh}:'(iw-${bw})*${n4(fx)}':'(ih-${bh})*${n4(fy)}'`);
        parts.push('format=yuva420p');
    } else if (!rotated) {
        // Unrotated layers: exactly the chain they have always had.
        if (sizeAnimated) {
            parts.push(
                `scale=w='2*floor((${buildPiecewiseExpr(samples, 'w', W)})/2)'` +
                `:h='2*floor((${buildPiecewiseExpr(samples, 'h', H)})/2)':eval=frame`
            );
        } else {
            parts.push(`scale=${even(first.w * W)}:${even(first.h * H)}`);
        }

        // 3. Alpha must exist before rotate/opacity, or rotation fills the corners
        //    with black instead of leaving them transparent.
        parts.push('format=yuva420p');
    } else {
        // R88 — rotated layers (the rotate handle on stickers, animated spins).
        // Size first to the FIRST sample (constant), rotate (constant output
        // box: the diagonal for an animated angle, the exact rotated bounds for
        // a fixed one), THEN apply any size animation as a factor on that box.
        // Rotating after a per-frame resize would hand `rotate` a changing input
        // size, which it does not support. Uniform scale and rotation commute,
        // so the picture is the same. The overlay below centres the result on
        // the layer's centre (overlay_w/overlay_h), which also fixes the old
        // static-rotation chain placing the larger rotated box by its top-left.
        const w0 = even(first.w * W);
        const h0 = even(first.h * H);
        parts.push(`scale=${w0}:${h0}`);
        parts.push('format=yuva420p');
        if (rotAnimated) {
            parts.push(`rotate=a='${buildPiecewiseExpr(samples, 'rotation', Math.PI / 180)}':c=none:ow='hypot(iw,ih)':oh='hypot(iw,ih)'`);
        } else {
            const a = n4(rot * Math.PI / 180);
            parts.push(`rotate=${a}:c=none:ow=rotw(${a}):oh=roth(${a})`);
        }
        if (sizeAnimated) {
            const f = `(${buildPiecewiseExpr(samples, 'w', W)})/${w0}`;
            parts.push(`scale=w='max(2,2*floor(iw*${f}/2))':h='max(2,2*floor(ih*${f}/2))':eval=frame`);
        }
    }

    // Signed scale is represented as a positive box size plus an orientation
    // channel in the composition plan. FFmpeg's flip filters support timeline
    // expressions, so a keyframed scale crossing zero mirrors on the same
    // output frame as the preview without generating negative dimensions.
    for (const [key, filter] of [['flipH', 'hflip'], ['flipV', 'vflip']]) {
        if (isAnimated(samples, key)) {
            parts.push(`${filter}=enable='gte(${buildPiecewiseExpr(samples, key)},0.5)'`);
        } else if (Number(first[key]) >= 0.5) {
            parts.push(filter);
        }
    }

    // 5. Opacity. Constant opacity is a cheap channel mix. Animated opacity
    //    must use the sampled curve: fade filters only describe monotonic fades
    //    at the clip edges and silently lose interior keyframes, pulses, and
    //    eased curves. `geq` evaluates against the output PTS established above.
    if (isAnimated(samples, 'opacity')) {
        const opacityExpr = buildPiecewiseExpr(samples, 'opacity')
            .replace(/\bt\b/g, 'T')
            .replace(/,/g, '\\,');
        parts.push(`geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='clip(alpha(X,Y)*(${opacityExpr}),0,255)'`);
    } else if (first.opacity < 0.999) {
        parts.push(`colorchannelmixer=aa=${n4(Math.max(0, Math.min(1, first.opacity)))}`);
    }

    // 6. Blur, when a motion preset asked for one (e.g. camera-whip). Geometry
    // blur is sampled at output-frame cadence; keep it animated during export
    // instead of freezing it at the first frame. This mirrors the sampled blur
    // implementation used by composition effects below.
    const blur = Math.max(0, Math.min(50, Number(first.blur) || 0));
    if (isAnimated(samples, 'blur')) {
        const points = samples.map(sample => ({ t: Number(sample.t), value: Math.max(0, Math.min(50, Number(sample.blur) || 0)) }));
        const start = Math.max(0, points[0].t);
        const end = Math.max(start, points.at(-1).t);
        const steps = Math.min(1800, Math.max(1, Math.ceil((end - start) * 30)));
        const commandTimes = new Set([start, end]);
        for (let index = 1; index < steps; index++) commandTimes.add(start + (end - start) * index / steps);
        const valueAt = time => {
            if (time <= points[0].t) return points[0].value;
            for (let index = 0; index < points.length - 1; index++) {
                const a = points[index], b = points[index + 1];
                if (time <= b.t) {
                    const progress = (time - a.t) / Math.max(1e-6, b.t - a.t);
                    return a.value + (b.value - a.value) * progress;
                }
            }
            return points.at(-1).value;
        };
        const target = `ov${String(ov.id || inputIdx).replace(/[^a-zA-Z0-9_]/g, '_')}_motion_blur`;
        const commands = [...commandTimes].sort((a, b) => a - b)
            .map(time => `${n4(time)} ${target} sigma ${n4(valueAt(time))}`);
        parts.push(`sendcmd=c='${commands.join(';')}',gblur@${target}=sigma=${n4(valueAt(start))}`);
    } else if (blur > 0.05) {
        parts.push(`gblur=sigma=${n4(blur)}`);
    }

    // Scene footage effects travel with the overlay through the same plan as
    // its geometry. Unsupported alpha-only effects remain the responsibility
    // of the transparent graphics renderer rather than being guessed here.
    for (const [effectIndex, effect] of (Array.isArray(ov.effects) ? ov.effects : []).entries()) {
        if (!effect || effect.enabled === false) continue;
        if (Array.isArray(effect.outputWindows) && effect.outputWindows.length === 0) continue;
        const effectPartsStart = parts.length;
        const p = effect.params || {};
        const kind = effect.kind || effect.type;
        const effectExpr = (key, fallback, min, max) => {
            const points = effect.samples?.[key];
            if (!Array.isArray(points) || !points.length) return null;
            const bounded = points.map(point => ({
                ...point,
                value: Math.max(min, Math.min(max, Number(point.value))),
            })).filter(point => Number.isFinite(point.t) && Number.isFinite(point.value));
            return bounded.length ? buildPiecewiseExpr(bounded, 'value') : null;
        };
        switch (kind) {
            case 'gradient-fill': parts.push(compileGradientFill(effect)); break;
            case 'fade_in': case 'fade_out': {
                const duration = Math.max(0.05, Math.min(5, Number(p.duration?.value ?? p.duration) || 0.5));
                const windows = Array.isArray(effect.outputWindows) ? effect.outputWindows : [];
                const effectStart = windows.length ? Number(windows[0].start) : Number(ov.outputStart);
                const effectEnd = windows.length ? Number(windows.at(-1).end) : Number(ov.outputEnd);
                const colorValue = p.color?.value ?? p.color ?? [0, 0, 0];
                const color = colorToRgb(colorValue, [0, 0, 0]).map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('');
                const alphaFade = ['image', 'sticker'].includes(ov.source?.type);
                if (kind === 'fade_in') {
                    parts.push(`fade=t=in:st=${n4(effectStart)}:d=${n4(Math.min(duration, Math.max(0.05, effectEnd - effectStart)))}:${alphaFade ? 'alpha=1' : `color=0x${color}`}`);
                } else {
                    const fadeDuration = Math.min(duration, Math.max(0.05, effectEnd - effectStart));
                    parts.push(`fade=t=out:st=${n4(Math.max(effectStart, effectEnd - fadeDuration))}:d=${n4(fadeDuration)}:${alphaFade ? 'alpha=1' : `color=0x${color}`}`);
                }
                break;
            }
            case 'blur': case 'blur_gaussian': {
                const radiusValue = Math.max(0, Math.min(50, Number(p.radius?.value ?? p.radius ?? p.amount?.value ?? p.amount) || 0));
                const radiusKey = effect.samples?.radius ? 'radius' : 'amount';
                const radiusPoints = effect.samples?.[radiusKey];
                const boundedRadiusPoints = Array.isArray(radiusPoints)
                    ? radiusPoints.map(point => ({ t: Number(point?.t), value: Math.max(0, Math.min(50, Number(point?.value))) }))
                        .filter(point => Number.isFinite(point.t) && Number.isFinite(point.value))
                    : [];
                if (boundedRadiusPoints.length > 1) {
                    const target = `ov${String(ov.id || inputIdx).replace(/[^a-zA-Z0-9_]/g, '_')}_effect${effectIndex}_gaussian_blur`;
                    const start = Math.max(0, boundedRadiusPoints[0].t);
                    const end = Math.max(start, boundedRadiusPoints.at(-1).t);
                    const steps = Math.min(1800, Math.max(1, Math.ceil((end - start) * 30)));
                    const commandTimes = new Set([start, end]);
                    for (let index = 1; index < steps; index++) commandTimes.add(start + (end - start) * index / steps);
                    const valueAt = time => {
                        if (time <= boundedRadiusPoints[0].t) return boundedRadiusPoints[0].value;
                        for (let index = 0; index < boundedRadiusPoints.length - 1; index++) {
                            const a = boundedRadiusPoints[index], b = boundedRadiusPoints[index + 1];
                            if (time <= b.t) {
                                const progress = (time - a.t) / Math.max(1e-6, b.t - a.t);
                                return a.value + (b.value - a.value) * progress;
                            }
                        }
                        return boundedRadiusPoints.at(-1).value;
                    };
                    const commands = [...commandTimes].sort((a, b) => a - b)
                        .map(time => `${n4(time)} ${target} sigma ${n4(valueAt(time))}`);
                    parts.push(`sendcmd=c='${commands.join(';')}',gblur@${target}=sigma=${n4(valueAt(start))}`);
                } else {
                    parts.push(`gblur=sigma=${n4(radiusValue)}`);
                }
                break;
            }
            case 'blur_radial': {
                const intensityValue = Math.max(0, Math.min(1, Number(p.intensity?.value ?? p.intensity ?? 0.3)));
                const intensityTrack = effectExpr('intensity', intensityValue, 0, 1);
                const intensity = String(intensityTrack || n4(intensityValue)).replace(/\bt\b/g, 'T');
                const centerXValue = Math.max(0, Math.min(1, Number(p.centerX?.value ?? p.centerX ?? 0.5)));
                const centerYValue = Math.max(0, Math.min(1, Number(p.centerY?.value ?? p.centerY ?? 0.5)));
                const expressionForGeq = (expression, fallback) => String(expression || n4(fallback))
                    .replace(/\bt\b/g, 'T').replace(/,/g, '\\,');
                const centerX = expressionForGeq(effectExpr('centerX', centerXValue, 0, 1), centerXValue);
                const centerY = expressionForGeq(effectExpr('centerY', centerYValue, 0, 1), centerYValue);
                const samples = Math.max(8, Math.min(64, Math.round(Number(p.samples?.value ?? p.samples ?? 32))));
                const sampleChannel = channel => {
                    const taps = [];
                    for (let sample = 0; sample < samples; sample++) {
                        const progress = n4(sample / samples);
                        const distance = `sqrt(pow((${centerX})-X/W,2)+pow((${centerY})-Y/H,2))`;
                        const sampleX = `clip(X+((${centerX})-X/W)*(${progress})*(${intensity})*${distance}*0.5*W,0,W-1)`;
                        const sampleY = `clip(Y+((${centerY})-Y/H)*(${progress})*(${intensity})*${distance}*0.5*H,0,H-1)`;
                        taps.push(`${channel}(${sampleX},${sampleY})`);
                    }
                    return `(${taps.join('+')})/${samples}`;
                };
                // Keep scene media overlays on the same center-directed,
                // transparent-pixel-inclusive kernel as footage export and
                // the WebGL preview. A Gaussian approximation lost both the
                // authored center and the zooming streak direction.
                parts.push(`format=rgba,geq=r='${sampleChannel('r')}':g='${sampleChannel('g')}':b='${sampleChannel('b')}':a='${sampleChannel('alpha')}'`);
                break;
            }
            case 'blur_motion': case 'motion-blur': {
                // Approximate the GPU's symmetric spatial sample kernel with a
                // directional Gaussian whose sigma matches the kernel travel.
                // Legacy `amount` is retained as a pixel-scale control, while
                // `intensity` uses the registry's normalized shutter travel.
                const rawIntensity = p.intensity?.value ?? p.intensity;
                const rawAmount = p.amount?.value ?? p.amount;
                const intensity = Math.max(0, Math.min(1, rawIntensity != null
                    ? Number(rawIntensity)
                    : rawAmount != null ? Number(rawAmount) / 31.176914536 : 0.5));
                const rawAngle = Number(p.angle?.value ?? p.angle) || 0;
                const angle = ((rawAngle % 360) + 360) % 360;
                const angleTrack = effectExpr('angle', angle, -360, 360);
                const sourceWidth = even(first.w * W);
                const sigma = intensity * 0.1 * sourceWidth / Math.sqrt(12);
                if (sigma > 0.01) {
                    const blurW = even(first.w * W);
                    const blurH = even(first.h * H);
                    const radians = angleTrack
                        ? `((${angleTrack})*PI/180)`
                        : n4(angle * Math.PI / 180);
                    const inverse = angleTrack ? `-(${radians})` : n4(-angle * Math.PI / 180);
                    // Rotate into horizontal, blur only that axis, rotate back
                    // and crop transparent padding. Temporal tmix creates
                    // frame trails, so it is not used for spatial motion blur.
                    parts.push(angleTrack
                        ? `rotate=a='${inverse}':c=none:ow='hypot(iw,ih)':oh='hypot(iw,ih)'`
                        : `rotate=${inverse}:c=none:ow='hypot(iw,ih)':oh='hypot(iw,ih)'`);
                    parts.push(`gblur=sigma=${n4(sigma)}:sigmaV=0`);
                    parts.push(angleTrack
                        ? `rotate=a='${radians}':c=none:ow='hypot(iw,ih)':oh='hypot(iw,ih)'`
                        : `rotate=${radians}:c=none:ow='hypot(iw,ih)':oh='hypot(iw,ih)'`);
                    parts.push(`crop=${blurW}:${blurH}:(iw-${blurW})/2:(ih-${blurH})/2`);
                }
                break;
            }
            case 'shake': {
                const rotation = Math.max(0, Math.min(180, Number(p.rotationAmount?.value ?? p.rotationAmount) || 0));
                const frequency = Math.max(1, Math.min(60, Number(p.frequency?.value ?? p.frequency) || 10));
                const seed = Math.max(0, Math.min(1000, Number(p.randomSeed?.value ?? p.randomSeed) || 0));
                const rotationTrack = effectExpr('rotationAmount', rotation, 0, 180);
                const frequencyTrack = effectExpr('frequency', frequency, 1, 60);
                if (rotation > 0 || rotationTrack) {
                    const phase = n4(seed * 0.61803398875 + 1.7);
                    const windows = Array.isArray(effect.outputWindows) ? effect.outputWindows : [];
                    const active = windows.length
                        ? windows.map(w => timeWindowExpr(w.start, w.end)).join('+')
                        : timeWindowExpr(ov.outputStart, ov.outputEnd);
                    const sampledFrequency = frequencyTrack ? `(${frequencyTrack})` : n4(frequency * 0.83);
                    const sampledRotation = rotationTrack ? `(${rotationTrack})` : n4(rotation);
                    // Keep a fixed transparent canvas large enough for every
                    // angle, then the compositor positions it by its centre.
                    parts.push(`rotate=a='if(${active},sin(2*PI*t*${sampledFrequency}+${phase})*${sampledRotation}*PI/180,0)':c=none:ow='hypot(iw,ih)':oh='hypot(iw,ih)'`);
                }
                break;
            }
            case 'brightness': {
                const raw = Number(p.amount?.value ?? p.amount ?? p.value?.value ?? p.value);
                const expression = effectExpr('amount', Number.isFinite(raw) ? raw : 1, 0, 4);
                if (expression) parts.push(`eq=brightness='((${expression})-1)/2':eval=frame`);
                else parts.push(compileBrightnessScale(Number.isFinite(raw) ? raw : 1, 4));
                break;
            }
            case 'contrast': {
                const raw = Number(p.amount?.value ?? p.amount ?? p.value?.value ?? p.value);
                const expression = effectExpr('amount', Number.isFinite(raw) ? raw : 1, 0, 4);
                parts.push(expression ? `eq=contrast='${expression}':eval=frame` : `eq=contrast=${n4(Math.max(0, Math.min(4, Number.isFinite(raw) ? raw : 1)))}`);
                break;
            }
            case 'saturation': case 'saturate': {
                const raw = Number(p.amount?.value ?? p.amount ?? p.value?.value ?? p.value);
                const expression = effectExpr('amount', Number.isFinite(raw) ? raw : 1, 0, 5);
                parts.push(expression ? `eq=saturation='${expression}':eval=frame` : `eq=saturation=${n4(Math.max(0, Math.min(5, Number.isFinite(raw) ? raw : 1)))}`);
                break;
            }
            case 'hue': case 'hue-rotate': {
                const raw = Number(p.degrees?.value ?? p.degrees ?? p.amount?.value ?? p.amount) || 0;
                const expression = effectExpr(p.degrees !== undefined ? 'degrees' : 'amount', raw, -360, 360);
                parts.push(expression ? `hue=h='${expression}'` : `hue=h=${n4(Math.max(-360, Math.min(360, raw)))}`);
                break;
            }
            case 'color_grade': {
                const read = (key, fallback) => Number(p[key]?.value ?? p[key] ?? fallback);
                const brightness = read('brightness', 100), contrast = read('contrast', 100), saturation = read('saturation', 100);
                const brightnessExpr = effectExpr('brightness', brightness, 0, 200);
                const contrastExpr = effectExpr('contrast', contrast, 0, 200);
                const saturationExpr = effectExpr('saturation', saturation, 0, 200);
                if (brightnessExpr || contrastExpr || saturationExpr) {
                    const b = brightnessExpr ? `((${brightnessExpr})/100-1)/2` : n4(((Number.isFinite(brightness) ? brightness : 100) / 100 - 1) / 2);
                    const c = contrastExpr ? `(${contrastExpr})/100` : n4(Math.max(0, Math.min(2, (Number.isFinite(contrast) ? contrast : 100) / 100)));
                    const s = saturationExpr ? `(${saturationExpr})/100` : n4(Math.max(0, Math.min(2, (Number.isFinite(saturation) ? saturation : 100) / 100)));
                    parts.push(`eq=brightness='${b}':contrast='${c}':saturation='${s}':eval=frame`);
                } else {
                    parts.push(compileBrightnessScale((Number.isFinite(brightness) ? brightness : 100) / 100));
                    parts.push(`eq=contrast=${n4(Math.max(0, Math.min(2, (Number.isFinite(contrast) ? contrast : 100) / 100)))}:saturation=${n4(Math.max(0, Math.min(2, (Number.isFinite(saturation) ? saturation : 100) / 100)))}`);
                }
                const hue = read('hueRotate', 0);
                const hueExpr = effectExpr('hueRotate', hue, -180, 180);
                if (hueExpr) parts.push(`hue=h='${hueExpr}'`);
                else if (Number.isFinite(hue) && hue) parts.push(`hue=h=${n4(Math.max(-180, Math.min(180, hue)))}`);
                const temperatureValue = Math.max(-100, Math.min(100, read('temperature', 0)));
                const tintValue = Math.max(-100, Math.min(100, read('tint', 0)));
                const temperatureTrack = effectExpr('temperature', temperatureValue, -100, 100);
                const tintTrack = effectExpr('tint', tintValue, -100, 100);
                const temperature = String(temperatureTrack || temperatureValue.toFixed(6)).replace(/\bt\b/g, 'T');
                const tint = String(tintTrack || tintValue.toFixed(6)).replace(/\bt\b/g, 'T');
                if (temperatureTrack || tintTrack || temperatureValue || tintValue) {
                    // Keep overlay white balance identical to the live shader
                    // and footage export. colorbalance uses tonal ranges and
                    // gives overlays a different look from the base footage.
                    parts.push(`format=rgba,geq=r='clip(r(X,Y)+(${temperature})*0.765,0,255)':g='clip(g(X,Y)+(${tint})*0.765,0,255)':b='clip(b(X,Y)-(${temperature})*0.765,0,255)':a='alpha(X,Y)'`);
                }
                break;
            }
            case 'grain': case 'film_grain': case 'film-grain': {
                const value = Number(p.amount?.value ?? p.amount);
                const intensity = Number(p.intensity?.value ?? p.intensity);
                if (kind === 'film_grain' || kind === 'film-grain') {
                    const intensityValue = Math.max(0, Math.min(1, Number.isFinite(intensity) ? intensity : 0.15));
                    const intensityTrack = effectExpr('intensity', intensityValue, 0, 1);
                    const strength = intensityTrack
                        ? `(${intensityTrack.replace(/\bt\b/g, 'T').replace(/,/g, '\\,')})*48`
                        : n4(intensityValue * 48);
                    const size = Math.max(0.5, Math.min(5, Number(p.size?.value ?? p.size ?? 1.5)));
                    const seed = Math.max(0, Math.min(2147483647, Math.floor(Number(p.seed?.value ?? p.seed ?? 941) || 0)));
                    const rawAnimated = p.animated?.value ?? p.animated;
                    const frame = rawAnimated === false ? '0' : 'floor(T*30)';
                    const hash = `(sin((floor(X/${n4(size)})+${seed}*7.1)*12.9898+(floor(Y/${n4(size)})+${seed}*3.17)*78.233+${frame}*37.719)*43758.5453)`;
                    const noise = `((${hash})-floor(${hash})-0.5)*${strength}`;
                    parts.push(`format=rgba,geq=r='clip(r(X,Y)+${noise},0,255)':g='clip(g(X,Y)+${noise},0,255)':b='clip(b(X,Y)+${noise},0,255)':a='alpha(X,Y)'`);
                } else {
                    const amount = Number.isFinite(value) ? value : 8;
                    parts.push(`noise=alls=${n4(Math.max(0, Math.min(48, amount)))}:allf=t+u`);
                }
                break;
            }
            case 'chromatic-aberration': {
                const value = Number(p.amount?.value ?? p.amount);
                const amount = Math.max(0, Math.min(12, Number.isFinite(value) ? value : 2));
                const amountTrack = effectExpr('amount', amount, 0, 12);
                const displacement = String(amountTrack || n4(amount))
                    .replace(/\bt\b/g, 'T').replace(/,/g, '\\,');
                const redX = `clip(X-round(${displacement}),0,W-1)`;
                const blueX = `clip(X+round(${displacement}),0,W-1)`;
                // Match the editor's horizontal red/blue channel separation,
                // while evaluating authored amount keyframes per output frame.
                parts.push(`format=rgba,geq=r='r(${redX},Y)':g='g(X,Y)':b='b(${blueX},Y)':a='alpha(X,Y)'`);
                break;
            }
            case 'rgb_split': {
                const rawAmount = Number(p.amount?.value ?? p.amount);
                const amount = Math.max(0, Math.min(50, Number.isFinite(rawAmount) ? rawAmount : 5));
                const rawAngle = Number(p.angle?.value ?? p.angle);
                const rawCenterX = Number(p.centerX?.value ?? p.centerX);
                const rawCenterY = Number(p.centerY?.value ?? p.centerY);
                const amountExpr = effectExpr('amount', amount, 0, 50);
                const angleExpr = effectExpr('angle', Number.isFinite(rawAngle) ? rawAngle : 0, -360, 360);
                const centerXExpr = effectExpr('centerX', Number.isFinite(rawCenterX) ? rawCenterX : 0.5, 0, 1);
                const centerYExpr = effectExpr('centerY', Number.isFinite(rawCenterY) ? rawCenterY : 0.5, 0, 1);
                // geq is parsed by FFmpeg's expression grammar, so commas in
                // sampled piecewise tracks must be escaped at this boundary.
                const geqValue = (expression, fallback) => String(expression || n4(fallback))
                    .replace(/\bt\b/g, 'T').replace(/,/g, '\\,');
                const splitAmount = geqValue(amountExpr, amount);
                const angle = `((${geqValue(angleExpr, Number.isFinite(rawAngle) ? rawAngle : 0)})*PI/180)`;
                const centerX = geqValue(centerXExpr, Number.isFinite(rawCenterX) ? rawCenterX : 0.5);
                const centerY = geqValue(centerYExpr, Number.isFinite(rawCenterY) ? rawCenterY : 0.5);
                const dx = `(cos(${angle})*(${splitAmount}))`;
                const dy = `(sin(${angle})*(${splitAmount}))`;
                const radialDistance = `sqrt(pow(X/W-(${centerX}),2)+pow(Y/H-(${centerY}),2))`;
                const redX = `clip(X+(${dx})*(${radialDistance}),0,W-1)`;
                const redY = `clip(Y+(${dy})*(${radialDistance}),0,H-1)`;
                const blueX = `clip(X-(${dx})*(${radialDistance}),0,W-1)`;
                const blueY = `clip(Y-(${dy})*(${radialDistance}),0,H-1)`;
                parts.push(`format=rgba,geq=r='r(${redX},${redY})':g='g(X,Y)':b='b(${blueX},${blueY})':a='alpha(X,Y)'`);
                break;
            }
            case 'distortion': {
                const rawAmount = Number(p.amount?.value ?? p.amount);
                const amount = Number.isFinite(rawAmount) ? Math.max(0, Math.min(0.08, rawAmount)) : 0.018;
                const amountExpr = effectExpr('amount', amount, 0, 0.08);
                const sampledAmount = String(amountExpr || n4(amount)).replace(/\bt\b/g, 'T').replace(/,/g, '\\,');
                const phase = Number(p.phase?.value ?? p.phase) || 0;
                const phaseExpr = effectExpr('phase', phase, -360, 360);
                const sampledPhase = String(phaseExpr || n4(phase)).replace(/\bt\b/g, 'T').replace(/,/g, '\\,');
                const sx = `clip(X+sin(Y*0.045+(${sampledPhase}))*(${sampledAmount})*W,0,W-1)`;
                const sy = `clip(Y+sin(X*0.04)*(${sampledAmount})*H,0,H-1)`;
                parts.push(`format=rgba,geq=r='r(${sx},${sy})':g='g(${sx},${sy})':b='b(${sx},${sy})':a='alpha(${sx},${sy})'`);
                break;
            }
            case 'vignette': {
                const rawIntensity = Number(p.intensity?.value ?? p.intensity ?? 0.5);
                const intensity = Number.isFinite(rawIntensity) ? Math.max(0, Math.min(1, rawIntensity)) : 0.5;
                const intensityExpr = effectExpr('intensity', intensity, 0, 1);
                const rawRadius = Number(p.radius?.value ?? p.radius ?? 0.7);
                const radius = Number.isFinite(rawRadius) ? Math.max(0.1, Math.min(1.5, rawRadius)) : 0.7;
                const radiusExpr = effectExpr('radius', radius, 0.1, 1.5);
                const rawSoftness = Number(p.softness?.value ?? p.softness ?? 0.5);
                const softness = Number.isFinite(rawSoftness) ? Math.max(0, Math.min(1, rawSoftness)) : 0.5;
                const softnessExpr = effectExpr('softness', softness, 0, 1);
                const toGeqTime = expression => String(expression).replace(/\bt\b/g, 'T');
                const amount = intensityExpr ? toGeqTime(intensityExpr) : n4(intensity);
                const r = radiusExpr ? toGeqTime(radiusExpr) : n4(radius);
                const s = softnessExpr ? toGeqTime(softnessExpr) : n4(softness);
                const color = colorToRgb(p.color?.value ?? p.color, [0, 0, 0]);
                const distance = `sqrt(pow(X/W-0.5,2)+pow(Y/H-0.5,2))`;
                const edgeT = `clip((${distance}-(${r}-${s}))/max(${s},0.0001),0,1)`;
                const edge = `(${edgeT})*(${edgeT})*(3-2*(${edgeT}))`;
                const mix = `(${edge})*(${amount})`;
                parts.push(`format=rgba,geq=r='r(X,Y)*(1-${mix})+${color[0]}*${mix}':g='g(X,Y)*(1-${mix})+${color[1]}*${mix}':b='b(X,Y)*(1-${mix})+${color[2]}*${mix}':a='alpha(X,Y)'`);
                break;
            }
            case 'glitch': {
                const hasLegacyAmount = p.amount != null || effect.samples?.amount;
                const control = hasLegacyAmount ? 'amount' : 'intensity';
                const rawControl = Number(hasLegacyAmount
                    ? (p.amount?.value ?? p.amount ?? 8)
                    : (p.intensity?.value ?? p.intensity ?? 0.2));
                const controlValue = Number.isFinite(rawControl)
                    ? Math.max(0, Math.min(hasLegacyAmount ? 32 : 1, rawControl))
                    : (hasLegacyAmount ? 8 : 0.2);
                const amount = hasLegacyAmount ? controlValue : controlValue * 40;
                const seed = Math.max(0, Math.min(1000, Number(p.seed?.value ?? p.seed) || 17));
                const amountTrack = effectExpr(control, controlValue, 0, hasLegacyAmount ? 32 : 1);
                const sampledAmount = amountTrack
                    ? `(${amountTrack.replace(/\bt\b/g, 'T')})*${hasLegacyAmount ? 1 : 40}`
                    : n4(amount);
                const rawBlockSize = Number(p.blockSize?.value ?? p.blockSize ?? 32);
                const blockSize = Number.isFinite(rawBlockSize) ? Math.max(4, Math.min(128, rawBlockSize)) : 32;
                const blockSizeTrack = effectExpr('blockSize', blockSize, 4, 128);
                const sampledBlockSize = blockSizeTrack ? blockSizeTrack.replace(/\bt\b/g, 'T') : n4(blockSize);
                const frame = 'floor(T*12)';
                const blockX = `floor(X/(${sampledBlockSize}))`;
                const blockY = `floor(Y/(${sampledBlockSize}))`;
                const random = (x, y, salt = 0) => `mod(abs(sin((${x}+${salt})*12.9898+(${y}+${seed})*78.233)*43758.5453),1)`;
                const blockRandom = random(`${blockX}+${frame}*0.17`, blockY);
                const displacement = `if(gt(${blockRandom},1-(${sampledAmount})/40*0.3),round((${random(blockX, blockY, 1)}-0.5)*(${sampledAmount})*0.1*W),0)`;
                const colorShift = (p.colorShift?.value ?? p.colorShift) !== false;
                const scanlines = (p.scanlines?.value ?? p.scanlines) !== false;
                const split = colorShift
                    ? `if(gt(${random(blockX, blockY, 0.5)},0.7),(${random(blockX, blockY, 1)}-0.5)*(${sampledAmount})*0.02*W,0)`
                    : '0';
                const redX = `clip(X+(${displacement})+(${split}),0,W-1)`;
                const greenX = `clip(X+(${displacement}),0,W-1)`;
                const blueX = `clip(X+(${displacement})-(${split}),0,W-1)`;
                const scanline = scanlines ? '(0.9+(sin(Y*PI)*0.5+0.5)*0.1)' : '1';
                parts.push(`format=rgba,geq=r='clip(r(${redX},Y)*${scanline},0,255)':g='clip(g(${greenX},Y)*${scanline},0,255)':b='clip(b(${blueX},Y)*${scanline},0,255)':a='alpha(X,Y)'`);
                break;
            }
            case 'inner-shadow': parts.push(compileInnerShadow(effect, frame)); break;
            default: break;
        }
        const windows = Array.isArray(effect.outputWindows) ? effect.outputWindows : [];
        if (windows.length) {
            const enable = windows
                .filter(window => Number.isFinite(Number(window.start)) && Number.isFinite(Number(window.end)) && Number(window.end) > Number(window.start))
                .map(window => `gte(t,${n4(window.start)})*lt(t,${n4(window.end)})`)
                .join('+');
            if (enable) {
                for (let i = effectPartsStart; i < parts.length; i++) {
                    // Some alpha effects expand to a multi-chain graph and
                    // cannot be gated by appending a filter option. Their
                    // dedicated compilers own their timing semantics.
                    if (typeof parts[i] === 'string' && !parts[i].includes(';') && !parts[i].includes('[')) {
                        parts[i] += `:enable='${enable}'`;
                    }
                }
            }
        }
    }

    const mask = ov.sceneMask;
    if (mask?.kind === 'shape' && SHAPE_MASKS.has(mask.shape)) {
        const inset = Math.max(0, Math.min(0.45, Number(mask.inset) || 0));
        const hasX = hasNumericValue(mask.x), hasY = hasNumericValue(mask.y);
        const x = hasX ? Number(mask.x) : inset;
        const y = hasY ? Number(mask.y) : inset;
        const w = hasNumericValue(mask.w) ? Number(mask.w) : 1 - x - (hasX ? 0 : inset);
        const h = hasNumericValue(mask.h) ? Number(mask.h) : 1 - y - (hasY ? 0 : inset);
        let inside;
        if (mask.shape === 'ellipse' || mask.shape === 'circle') {
            const radius = Math.min(w, h) / 2;
            const cx = n4(x + w / 2), cy = n4(y + h / 2);
            const rx = n4(mask.shape === 'circle' ? radius : w / 2);
            const ry = n4(mask.shape === 'circle' ? radius : h / 2);
            inside = `lte(pow((X-W*${cx})/(W*${rx}),2)+pow((Y-H*${cy})/(H*${ry}),2),1)`;
        } else if (mask.shape === 'rounded-rectangle' || mask.shape === 'capsule') {
            const radius = mask.shape === 'capsule' ? Math.min(w, h) / 2
                : Math.max(0, Math.min(0.5, Number(mask.radius ?? mask.roundness ?? 0.12))) * Math.min(w, h);
            const cx = n4(x + w / 2), cy = n4(y + h / 2), rx = n4(w / 2), ry = n4(h / 2), r = n4(radius);
            const qx = `abs(X-W*${cx})-W*(${rx}-${r})`, qy = `abs(Y-H*${cy})-H*(${ry}-${r})`;
            inside = `lte(sqrt(pow(max(${qx},0),2)+pow(max(${qy},0),2))+min(max(${qx},${qy}),0),W*${r})`;
        } else if (mask.shape === 'callout') {
            inside = calloutMaskExpression(mask, x, y, w, h);
        } else if (mask.shape === 'polygon' || mask.shape === 'star' || mask.shape === 'arrow') {
            inside = polygonMaskExpression(mask, x, y, w, h);
        } else {
            inside = `between(X,W*${n4(x)},W*(${n4(x)}+${n4(w)}))*between(Y,H*${n4(y)},H*(${n4(y)}+${n4(h)}))`;
        }
        const transparent = mask.invert ? `eq(${inside},1)` : `eq(${inside},0)`;
        const feather = Math.max(0, Math.min(0.25, Number(mask.feather) || 0));
        parts.push(`format=rgba`);
        parts.push(feather > 0
            ? `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(${transparent},0,alpha(X,Y))',gblur=sigma=${n4(feather * Math.min(first.w * W, first.h * H))}:planes=8`
            : `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(${transparent},0,alpha(X,Y))'`);
    }

    const source = options.sourceLabel ? `[${options.sourceLabel}]` : `[${inputIdx}:v]`;
    const offset = Number(options.timeOffset) || 0;
    const timeShiftedParts = offset
        ? parts.map(part => part.replace(/\bt\b/g, `(t+${n4(offset)})`).replace(/\bT\b/g, `(T+${n4(offset)})`))
        : parts;
    const weighted = Number(options.exposureWeight) > 0 && Number(options.exposureWeight) < 1
        ? `,colorchannelmixer=aa=${n4(options.exposureWeight)}`
        : '';
    return `${source}${timeShiftedParts.join(',')}${weighted}[${label}]`;
}

function motionBlurSampleCount(overlay) {
    if (!overlay?.motionBlur?.enabled) return 1;
    const shutter = Number(overlay.motionBlur.shutterAngle);
    if (Number.isFinite(shutter) && shutter <= 0) return 1;
    const geometry = Array.isArray(overlay.geometry) ? overlay.geometry : [];
    const transformKeys = ['x', 'y', 'w', 'h', 'rotation'];
    const hasTransformMotion = geometry.length > 1 && transformKeys.some(key => {
        const values = geometry.map(sample => Number(sample?.[key])).filter(Number.isFinite);
        return values.length > 1 && Math.max(...values) - Math.min(...values) > 0.0001;
    });
    if (!hasTransformMotion) return 1;
    return Math.max(2, Math.min(15, Math.round(Number(overlay.motionBlur.samples) || 5)));
}

function atShutterTime(expression, offset, overlay) {
    if (!offset) return expression;
    const start = n4(Number(overlay.outputStart) || 0);
    const end = n4(Number(overlay.outputEnd) || 0);
    const shifted = `(t+${n4(offset)})`;
    return String(expression).replace(/\bt\b/g, `min(max(${shifted},${start}),${end})`);
}

function shutterOffsets(overlay, fps) {
    const count = motionBlurSampleCount(overlay);
    if (count === 1) return [0];
    const rawAngle = Number(overlay.motionBlur.shutterAngle);
    const angle = Math.max(0, Math.min(360, Number.isFinite(rawAngle) ? rawAngle : 180));
    const exposure = angle / (360 * Math.max(1, Number(overlay.motionBlur.frameRate) || fps || 30));
    if (exposure <= 0) return [0];
    return Array.from({ length: count }, (_, index) => ((index + 0.5) / count - 0.5) * exposure);
}

/**
 * R98 — a blackened, blurred, dimmed copy of an overlay's own source chain,
 * for a generic drop shadow (stickers/icons/shapes/templates; see
 * client/src/motion/Compositor.js's normalizeShadow and GraphicOverlay.jsx's
 * overlayFilterCss for the preview twin of this). Built by reusing
 * compileOverlaySource verbatim for the shape/scale/rotate/opacity/blur
 * chain (so a shadow never silently drifts out of sync with its sprite —
 * one real implementation of that geometry, not two) and appending the
 * shadow-specific steps on top of its already-alpha-formatted output:
 *   - `lutrgb=r=0:g=0:b=0` recolors every pixel to black while leaving the
 *     alpha channel untouched, so the shadow keeps the sprite's own
 *     silhouette instead of becoming a rectangle.
 *   - `gblur` softens it further than the sprite's own blur (a shadow reads
 *     as a soft blob, not a sharp silhouette).
 *   - `colorchannelmixer=aa=` dims it to the requested shadow strength.
 *
 * dx/dy/blur arrive in Compositor.js's CSS-pixel-ish units (a 1080-wide-frame
 * reference, matching the preview's typical player size); scaled here by the
 * ACTUAL render width so a shadow reads the same size at 720p and at 4K —
 * the same "one place the plan meets a pixel" rule this file's header
 * documents for geometry.
 *
 * @param {object} ov       the overlay entry (must have ov.shadow)
 * @param {number} inputIdx this overlay's FFmpeg input index (SAME source as
 *                          the sprite's own chain — two independent chains
 *                          reading the same input, not a split)
 * @param {string} label    the stream label to produce (the sprite's own
 *                          chain, from compileOverlaySource, is `${label}_raw`)
 * @returns {string} two filter_complex statements joined by `;`, ending in `[label]`
 */
function compileShadowSource(ov, inputIdx, label, frame) {
    const rawLabel = `${label}_raw`;
    const base = compileOverlaySource(ov, inputIdx, rawLabel, frame);

    const REFERENCE_WIDTH = 1080; // matches Compositor.js normalizeShadow's doc comment
    const scale = frame.width / REFERENCE_WIDTH;
    const blurPx = Math.max(0, (Number(ov.shadow?.blur) || 0) * scale);
    const alpha = Math.max(0, Math.min(1, Number.isFinite(Number(ov.shadow?.opacity)) ? Number(ov.shadow.opacity) : 0.55));
    // A touch softer than the sprite's own edge, floor so a near-zero blur
    // (dx/dy-only "hard" shadow) still gets SOME softening rather than a
    // razor-sharp silhouette, which would read as a second sticker, not a shadow.
    const shadowSigma = Math.max(1, blurPx / 2);

    return `${base};[${rawLabel}]lutrgb=r=0:g=0:b=0,gblur=sigma=${n4(shadowSigma)},colorchannelmixer=aa=${n4(alpha)}[${label}]`;
}

function overlayAlphaEffects(ov) {
    if (!['image', 'video', 'sticker'].includes(ov?.source?.type)) return [];
    return (Array.isArray(ov.effects) ? ov.effects : [])
        .filter(effect => effect && effect.enabled !== false && ['shadow', 'glow'].includes(effect.kind || effect.type)
            && !((effect.kind || effect.type) === 'glow' && ov.source?.type === 'video'));
}

function overlayTopEffects(ov) {
    if (ov?.source?.type !== 'video') return [];
    return (Array.isArray(ov.effects) ? ov.effects : [])
        .filter(effect => effect && effect.enabled !== false && (effect.kind || effect.type) === 'glow');
}

function overlayStrokeEffects(ov) {
    if (!['image', 'sticker'].includes(ov?.source?.type)) return [];
    return (Array.isArray(ov.effects) ? ov.effects : [])
        .filter(effect => effect && effect.enabled !== false && (effect.kind || effect.type) === 'stroke');
}

function effectWindowEnable(effect, overlay) {
    const base = timeWindowExpr(overlay.outputStart, overlay.outputEnd);
    if (!Array.isArray(effect?.outputWindows)) return `enable='${base}'`;
    const windows = effect.outputWindows
        .filter(window => Number.isFinite(Number(window.start)) && Number.isFinite(Number(window.end)) && Number(window.end) > Number(window.start))
        .map(window => `(gte(t,${n4(window.start)})*lt(t,${n4(window.end)}))`);
    return `enable='${base}*(${windows.length ? windows.join('+') : '0'})'`;
}

/** Expand an image/sticker alpha silhouette and tint it as an outline layer. */
function compileStrokeSource(ov, inputIdx, label, frame, effect) {
    const rawLabel = `${label}_raw`;
    const sourceOverlay = { ...ov, effects: (ov.effects || []).filter(item => (item?.kind || item?.type) !== 'stroke') };
    const base = compileOverlaySource(sourceOverlay, inputIdx, rawLabel, frame);
    const p = effect.params || {};
    const scale = frame.width / 1080;
    const radius = Math.max(1, Math.min(24, Math.round(Number(p.width ?? p.amount ?? 2) * scale)));
    const pad = radius + 1;
    const iterations = Math.max(1, Math.ceil(radius / 2));
    const [red, green, blue] = colorToRgb(p.color, [255, 255, 255]);
    const opacity = Math.max(0, Math.min(1, Number.isFinite(Number(p.opacity)) ? Number(p.opacity) : 1));
    const dilation = Array.from({ length: iterations }, () => 'dilation=coordinates=255').join(',');
    return {
        graph: `${base};[${rawLabel}]format=rgba,pad=iw+${pad * 2}:ih+${pad * 2}:${pad}:${pad}:color=black@0,alphaextract,${dilation},format=rgba,geq=r='${red}':g='${green}':b='${blue}':a='r(X,Y)*${n4(opacity)}'[${label}]`,
        pad,
    };
}

function alphaEffectMetrics(effect, frame) {
    const p = effect.params || {};
    const kind = effect.kind || effect.type;
    const scale = frame.width / 1080;
    const sampledRadii = ['radius', 'blur'].flatMap(key => Array.isArray(effect.samples?.[key])
        ? effect.samples[key].map(point => Number(point?.value)).filter(Number.isFinite) : []);
    const authoredBlur = Number(p.blur?.value ?? p.blur ?? p.radius?.value ?? p.radius ?? (kind === 'glow' ? 18 : 12)) || 0;
    const blur = Math.max(0, Math.min(100, Math.max(authoredBlur, ...sampledRadii))) * scale;
    const sigma = Math.max(1, blur / 2);
    // Keep enough transparent padding for the Gaussian tails. The media is
    // centered back onto its original geometry during composition.
    return { sigma, pad: Math.max(2, Math.ceil(sigma * 3)), scale };
}

function colorToRgb(color, fallback) {
    if (Array.isArray(color) && color.length >= 3) {
        return color.slice(0, 3).map(channel => {
            const value = Number(channel);
            if (!Number.isFinite(value)) return 0;
            return Math.round(Math.max(0, Math.min(1, value <= 1 ? value : value / 255)) * 255);
        });
    }
    const hex = String(color || '').trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i);
    if (!hex) return fallback;
    const value = hex[1].length === 3 ? [...hex[1]].map(ch => ch + ch).join('') : hex[1];
    return [0, 2, 4].map(index => parseInt(value.slice(index, index + 2), 16));
}

function compileInnerShadow(effect, frame) {
    const p = effect.params || {};
    const scale = frame.width / 1080;
    const dx = Math.max(-80, Math.min(80, Number(p.x ?? p.offsetX) || 0)) * scale;
    const dy = Math.max(-80, Math.min(80, Number(p.y ?? p.offsetY) || 0)) * scale;
    const radius = Math.max(0, Math.min(16, Number(p.blur ?? p.radius) || 0)) * scale;
    const opacity = Math.max(0, Math.min(1, Number.isFinite(Number(p.opacity)) ? Number(p.opacity) : 0.65));
    const [red, green, blue] = colorToRgb(p.color, [0, 0, 0]);
    const taps = radius > 0
        ? [-1, 0, 1].flatMap(ty => [-1, 0, 1].map(tx => {
            const weight = (tx === 0 ? 2 : 1) * (ty === 0 ? 2 : 1);
            return `${weight}*alpha(X-${n4(dx)}+${n4(tx * radius)},Y-${n4(dy)}+${n4(ty * radius)})/255`;
        }))
        : [`16*alpha(X-${n4(dx)},Y-${n4(dy)})/255`];
    const visible = `alpha(X,Y)/255`;
    const shade = `(${visible})*${n4(opacity)}*(1-(${taps.join('+')})/16)`;
    return `format=rgba,geq=r='r(X,Y)*(1-${shade})+${red}*${shade}':g='g(X,Y)*(1-${shade})+${green}*${shade}':b='b(X,Y)*(1-${shade})+${blue}*${shade}':a='alpha(X,Y)'`;
}

function compileGradientFill(effect) {
    const p = effect.params || {};
    const supplied = Array.isArray(p.colors) && p.colors.length
        ? p.colors
        : [p.from || p.color || '#FFFFFF', p.to || p.color || '#000000'];
    const stops = supplied.map((entry, index) => ({
        offset: Math.max(0, Math.min(1, Number.isFinite(Number(entry?.offset)) ? Number(entry.offset) : index / Math.max(1, supplied.length - 1))),
        color: colorToRgb(typeof entry === 'string' ? entry : entry?.color, [255, 255, 255]),
    })).sort((a, b) => a.offset - b.offset);
    if (stops.length === 1) stops.push({ offset: 1, color: stops[0].color });
    const angle = (Number(p.angle) || 0) * Math.PI / 180;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const t = `clip(0.5+2*((X-W/2)*${n4(cos)}*W+(Y-H/2)*${n4(sin)}*H)/(${n4(cos * cos)}*W*W+${n4(sin * sin)}*H*H),0,1)`;
    const opacity = Math.max(0, Math.min(1, Number.isFinite(Number(p.opacity)) ? Number(p.opacity) : 1));
    const channel = index => {
        let expression = String(stops.at(-1).color[index]);
        for (let i = stops.length - 2; i >= 0; i--) {
            const a = stops[i], b = stops[i + 1];
            const span = Math.max(1e-6, b.offset - a.offset);
            const ramp = `${a.color[index]}+(${b.color[index] - a.color[index]})*((${t}-${n4(a.offset)})/${n4(span)})`;
            expression = `if(lt(${t},${n4(b.offset)}),${ramp},${expression})`;
        }
        const first = stops[0], last = stops.at(-1);
        if (first.offset > 0) expression = `if(lt(${t},${n4(first.offset)}),${first.color[index]},${expression})`;
        if (last.offset < 1) expression = `if(gt(${t},${n4(last.offset)}),${last.color[index]},${expression})`;
        return `r(X,Y)*(1-${n4(opacity)})+(${expression})*${n4(opacity)}`;
    };
    return `format=rgba,geq=r='${channel(0)}':g='${channel(1)}':b='${channel(2)}':a='alpha(X,Y)'`;
}

/** Create a tinted, softened copy of the media alpha for shadow/glow effects. */
function compileAlphaEffectSource(ov, inputIdx, label, frame, effect) {
    const rawLabel = `${label}_raw`;
    const kind = effect.kind || effect.type;
    const sourceOverlay = { ...ov, effects: (ov.effects || []).filter(item => !['shadow', 'glow'].includes(item?.kind || item?.type)) };
    const base = compileOverlaySource(sourceOverlay, inputIdx, rawLabel, frame);
    const p = effect.params || {};
    const { sigma, pad } = alphaEffectMetrics(effect, frame);
    const sampled = (key, min, max) => {
        const points = Array.isArray(effect.samples?.[key]) ? effect.samples[key]
            .map(point => ({ t: Number(point?.t), value: Number(point?.value) }))
            .filter(point => Number.isFinite(point.t) && Number.isFinite(point.value))
            .sort((a, b) => a.t - b.t) : [];
        if (points.length < 2) return null;
        const bounded = points.map(point => ({ ...point, value: Math.max(min, Math.min(max, point.value)) }));
        return { points: bounded, expression: buildPiecewiseExpr(bounded, 'value') };
    };
    const animatedBlur = sampled('blur', 0, 100) || sampled('radius', 0, 100);
    const animatedOpacity = sampled('opacity', 0, 1);
    const animatedIntensity = kind === 'glow' ? sampled('intensity', 0, 1 / 0.7) : null;
    // Match LayerEffects' Canvas shadow controls (±200 px). The previous
    // tighter export-only clamp made large keyed offsets stop short in the
    // rendered file while the editor preview continued to the authored value.
    const animatedX = sampled('x', -200, 200) || sampled('offsetX', -200, 200);
    const animatedY = sampled('y', -200, 200) || sampled('offsetY', -200, 200);
    const ffExpr = expression => expression.replace(/\bt\b/g, 'T').replace(/,/g, '\\,');
    const blurFilter = (track, fallbackSigma) => {
        if (!track) return `gblur=sigma=${n4(fallbackSigma)}`;
        const scale = frame.width / 1080;
        const start = Math.max(0, track.points[0].t);
        const end = Math.max(start, track.points.at(-1).t);
        const steps = Math.min(1800, Math.max(1, Math.ceil((end - start) * 30)));
        const times = new Set([start, end]);
        for (let index = 1; index < steps; index++) times.add(start + (end - start) * index / steps);
        const valueAt = time => {
            if (time <= track.points[0].t) return track.points[0].value;
            for (let index = 0; index < track.points.length - 1; index++) {
                const a = track.points[index], b = track.points[index + 1];
                if (time <= b.t) {
                    const progress = (time - a.t) / Math.max(1e-6, b.t - a.t);
                    return a.value + (b.value - a.value) * progress;
                }
            }
            return track.points.at(-1).value;
        };
        const target = `${String(label).replace(/[^a-zA-Z0-9_]/g, '_')}_radius`;
        const commands = [...times].sort((a, b) => a - b).map(time =>
            `${n4(time)} ${target} sigma ${n4(valueAt(time) * scale / 2)}`);
        return `sendcmd=c='${commands.join(';')}',gblur@${target}=sigma=${n4(valueAt(start) * scale / 2)}`;
    };
    const fallback = kind === 'glow' ? [114, 217, 255] : [0, 0, 0];
    const [red, green, blue] = colorToRgb(p.color, fallback);
    const rawIntensity = Number(p.intensity?.value ?? p.intensity);
    const glowOpacity = Number.isFinite(rawIntensity) ? Math.max(0, Math.min(1, rawIntensity * 0.7)) : 0.7;
    const rawOpacity = Number(p.opacity?.value ?? p.opacity);
    const opacity = Math.max(0, Math.min(1, Number.isFinite(rawOpacity) ? rawOpacity : (kind === 'glow' ? glowOpacity : 0.55)));
    const scale = frame.width / 1080;
    const dx = kind === 'shadow'
        ? (animatedX ? `(${buildPiecewiseExpr(animatedX.points, 'value', scale)})` : n4((Number(p.x?.value ?? p.x ?? p.offsetX?.value ?? p.offsetX) || 0) * scale))
        : '0';
    const dy = kind === 'shadow'
        ? (animatedY ? `(${buildPiecewiseExpr(animatedY.points, 'value', scale)})` : n4((Number(p.y?.value ?? p.y ?? p.offsetY?.value ?? p.offsetY) || 0) * scale))
        : '0';
    const tint = `lutrgb=r='0*val+${red}':g='0*val+${green}':b='0*val+${blue}'`;
    if (kind === 'glow' && ov.source?.type === 'video') {
        const rawThreshold = Number(p.threshold?.value ?? p.threshold ?? 0.7);
        const threshold = Math.max(0, Math.min(1, Number.isFinite(rawThreshold) ? rawThreshold : 0.7)) * 255;
        const thresholdTrack = sampled('threshold', 0, 0.99);
        const intensityTrack = sampled('intensity', 0, 1 / 0.7);
        const radiusTrack = sampled('radius', 0, 100);
        const thresholdExpr = thresholdTrack ? `(${ffExpr(thresholdTrack.expression)})*255` : n4(threshold);
        const intensityExpr = intensityTrack ? `clip((${ffExpr(intensityTrack.expression)})*0.7\\,0\\,1)`
            : n4(opacity);
        const brightAlpha = `geq=r='${red}':g='${green}':b='${blue}':a='if(gte(max(max(r(X,Y),g(X,Y)),b(X,Y)),${thresholdExpr}),255,0)'`;
        const radiusFilter = blurFilter(radiusTrack, sigma);
        const glowAlpha = intensityTrack
            ? `,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='clip(alpha(X,Y)*(${intensityExpr}),0,255)'`
            : `,colorchannelmixer=aa=${n4(opacity)}`;
        // Footage glow is a highlight bloom, as described by the GPU effect.
        // A blurred alpha silhouette produces a fuzzy rectangle for opaque
        // video and does not resemble the preview's thresholded bright areas.
        return {
            graph: `${base};[${rawLabel}]format=rgba,pad=iw+${pad * 2}:ih+${pad * 2}:${pad}:${pad}:color=black@0,${brightAlpha},${radiusFilter}${glowAlpha}[${label}]`,
            pad, dx: '0', dy: '0',
        };
    }
    const animatedAlphaExpression = animatedOpacity ? ffExpr(animatedOpacity.expression)
        : animatedIntensity ? `clip((${ffExpr(animatedIntensity.expression)})*0.7\\,0\\,1)` : null;
    const alphaAdjustment = animatedAlphaExpression
        ? `,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='clip(alpha(X,Y)*(${animatedAlphaExpression}),0,255)'`
        : `,colorchannelmixer=aa=${n4(opacity)}`;
    return {
        graph: `${base};[${rawLabel}]format=rgba,pad=iw+${pad * 2}:ih+${pad * 2}:${pad}:${pad}:color=black@0,${tint},${blurFilter(animatedBlur, sigma)}${alphaAdjustment}[${label}]`,
        pad, dx, dy,
    };
}

/**
 * Derive a leading fade-in / trailing fade-out window from opacity samples.
 * Returns null when opacity doesn't move in that direction at the relevant end.
 */
function findFade(samples, direction) {
    if (!Array.isArray(samples) || samples.length < 2) return null;

    if (direction === 'in') {
        if (samples[0].opacity >= 0.999) return null;
        // Walk forward to where opacity first reaches full.
        for (let i = 1; i < samples.length; i++) {
            if (samples[i].opacity >= 0.999) {
                return { start: samples[0].t, duration: Math.max(0.01, samples[i].t - samples[0].t) };
            }
        }
        return null;
    }

    const last = samples[samples.length - 1];
    if (last.opacity >= 0.999) return null;
    for (let i = samples.length - 2; i >= 0; i--) {
        if (samples[i].opacity >= 0.999) {
            return { start: samples[i].t, duration: Math.max(0.01, last.t - samples[i].t) };
        }
    }
    return null;
}

/**
 * Compile a full composition plan into a filter_complex.
 *
 * @param {object} plan     a validated composition plan
 * @param {Array<{overlayId:string, inputIndex:number}>} inputs
 *        one entry per overlay whose source was successfully fetched. Overlays
 *        with no entry are SKIPPED rather than failing the graph — one
 *        unreachable sticker must not cost the user their whole export.
 * @returns {{filterComplex: string, outputLabel: string, used: number}|null}
 *          null when there is nothing to composite
 */
function compileCompositionPlan(plan, inputs, options = {}) {
    if (!plan || !Array.isArray(plan.overlays) || plan.overlays.length === 0) return null;
    if (!Array.isArray(inputs) || inputs.length === 0) return null;

    const byId = new Map(inputs.map(i => [i.overlayId, i.inputIndex]));

    // Draw bottom-to-top. A plan with a mangled order would otherwise put a
    // background over a foreground, which reads as "the overlay disappeared".
    const drawable = plan.overlays
        .filter(ov => byId.has(ov.id) && Array.isArray(ov.geometry) && ov.geometry.length > 0)
        .sort((a, b) => a.zIndex - b.zIndex);
    const visible = drawable.filter(ov => !ov.matteOnly);

    if (visible.length === 0) return null;
    const frame = {
        width:  Number(plan.renderWidth)  > 0 ? Number(plan.renderWidth)  : (plan.frame?.width  || 1080),
        height: Number(plan.renderHeight) > 0 ? Number(plan.renderHeight) : (plan.frame?.height || 1920),
    };

    // The worker validates request plans before compilation, but this pure
    // compiler is also imported directly by tests and tooling. Keep malformed
    // masks from producing NaN/division-by-zero expressions on every path.
    const maskErrors = drawable.flatMap((ov, i) => {
        const mask = ov.sceneMask;
        if (!mask || mask.kind !== 'shape' || !SHAPE_MASKS.has(mask.shape)) return [];
        const inset = Number.isFinite(Number(mask.inset)) ? Math.max(0, Math.min(0.45, Number(mask.inset))) : 0;
        const hasX = hasNumericValue(mask.x);
        const hasY = hasNumericValue(mask.y);
        const x = hasX ? Number(mask.x) : inset;
        const y = hasY ? Number(mask.y) : inset;
        const w = hasNumericValue(mask.w) ? Number(mask.w) : 1 - x - (hasX ? 0 : inset);
        const h = hasNumericValue(mask.h) ? Number(mask.h) : 1 - y - (hasY ? 0 : inset);
        return [x, y, w, h].every(Number.isFinite) && x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1 && y + h <= 1
            ? [] : [`overlays[${i}] has invalid scene mask bounds`];
    });
    if (maskErrors.length) throw new Error(maskErrors.join('; '));

    const chains = [];
    const alphaEffectSources = new Map();
    const strokeEffectSources = new Map();
    const matteSampleSources = new Map();
    drawable.forEach((ov, i) => {
        const offsets = ov.matteOnly ? [0] : shutterOffsets(ov, plan.fps);
        if (offsets.length > 1) {
            const sourceLabels = offsets.map((_, index) => `ov${i}mbsrc${index}`);
            chains.push(`[${byId.get(ov.id)}:v]split=${sourceLabels.length}${sourceLabels.map(label => `[${label}]`).join('')}`);
            offsets.forEach((offset, index) => chains.push(compileOverlaySource(ov, byId.get(ov.id), `ov${i}mb${index}`, frame, {
                sourceLabel: sourceLabels[index], timeOffset: offset, exposureWeight: 1 / offsets.length,
            })));
        } else {
            chains.push(compileOverlaySource(ov, byId.get(ov.id), `ov${i}`, frame));
        }
        if (ov.matteOnly) return;
        // R98 — a shadowed overlay gets a SECOND source chain: a blackened,
        // blurred, dimmed copy of the same input, drawn just before the real
        // sprite (see compileShadowSource's own header for why two chains
        // from one input rather than a split).
        if (ov.shadow) chains.push(compileShadowSource(ov, byId.get(ov.id), `ov${i}s`, frame));
        const effects = overlayAlphaEffects(ov);
        effects.forEach((effect, effectIndex) => {
            const source = compileAlphaEffectSource(ov, byId.get(ov.id), `ov${i}e${effectIndex}`, frame, effect);
            alphaEffectSources.set(`${i}:${effectIndex}`, source);
            chains.push(source.graph);
        });
        overlayTopEffects(ov).forEach((effect, effectIndex) => {
            const source = compileAlphaEffectSource(ov, byId.get(ov.id), `ov${i}t${effectIndex}`, frame, effect);
            alphaEffectSources.set(`${i}:top:${effectIndex}`, source);
            chains.push(source.graph);
        });
        overlayStrokeEffects(ov).forEach((effect, effectIndex) => {
            const source = compileStrokeSource(ov, byId.get(ov.id), `ov${i}st${effectIndex}`, frame, effect);
            strokeEffectSources.set(`${i}:${effectIndex}`, source);
            chains.push(source.graph);
        });
    });

    // A matte may be consumed by more than one layer, and every shutter sample
    // needs its own FFmpeg input edge. Fan out the matte source explicitly so
    // animated matte geometry can be evaluated at the same sample time as the
    // layer it clips.
    drawable.forEach((matte, matteIndex) => {
        if (!matte.matteOnly) return;
        const consumers = drawable.map((candidate, index) => ({ candidate, index }))
            .filter(({ candidate }) => candidate.sceneMask?.kind === 'layer' && candidate.sceneMask.sourceOverlayId === matte.id);
        if (!consumers.length) return;
        const labelsByConsumer = new Map();
        const labels = [];
        consumers.forEach(({ candidate, index }) => {
            const count = motionBlurSampleCount(candidate);
            const sampleLabels = Array.from({ length: count }, (_, sampleIndex) => {
                const label = `ov${matteIndex}mask${index}s${sampleIndex}`;
                labels.push(label);
                return label;
            });
            labelsByConsumer.set(index, sampleLabels);
        });
        chains.push(`[ov${matteIndex}]split=${labels.length}${labels.map(label => `[${label}]`).join('')}`);
        labelsByConsumer.forEach((sampleLabels, index) => matteSampleSources.set(index, sampleLabels));
    });

    // Total `overlay=` filter ops this graph will emit — a plain overlay
    // plus one more per shadowed layer — so the LAST one (whichever layer it
    // belongs to) gets the documented `vout` label, exactly as before R98
    // when every layer produced exactly one op.
    let groupOps = 0;
    let previousGroups = [];
    for (const ov of visible) {
        const stack = Array.isArray(ov.compositionStack) ? ov.compositionStack : [];
        let shared = 0;
        while (shared < previousGroups.length && shared < stack.length && previousGroups[shared]?.id === stack[shared]?.id) shared++;
        groupOps += stack.length - shared;
        previousGroups = stack;
    }
    const totalOps = visible.reduce((n, ov) => n + (ov.shadow ? 1 : 0) + overlayAlphaEffects(ov).length + overlayStrokeEffects(ov).length + motionBlurSampleCount(ov) + overlayTopEffects(ov).length, 0) + groupOps;

    // Base video is always input 0.
    let current = '0:v';
    let currentIsRgb = false;
    let opCount = 0;
    let groupSerial = 0;
    const groupStack = [];
    const openGroup = group => {
        const depth = groupStack.length;
        const canvas = `comp${groupSerial++}canvas`;
        const duration = Math.max(0.1, Number(plan.base?.totalDuration) || 0.1);
        const fps = Number(plan.fps) > 0 ? Number(plan.fps) : 30;
        groupStack.push({ group, parentCurrent: current, parentIsRgb: currentIsRgb, canvas });
        chains.push(`color=c=black@0:s=${frame.width}x${frame.height}:r=${fps}:d=${n4(duration)},format=rgba[${canvas}]`);
        current = canvas;
        currentIsRgb = false;
    };
    const closeGroup = () => {
        const frameState = groupStack.pop();
        if (!frameState) return;
        const { group, parentCurrent, parentIsRgb } = frameState;
        const groupOutput = `comp${groupSerial++}out`;
        const opacity = Math.max(0, Math.min(1, Number(group.opacity ?? 1)));
        const opacitySamples = Array.isArray(group.opacitySamples) ? group.opacitySamples : [];
        const groupEffects = compileIsolatedGroupEffects(group, `comp${groupSerial}`);
        const animatedOpacity = opacitySamples.length > 1
            ? buildPiecewiseExpr(opacitySamples, 'value').replace(/\bt\b/g, 'T')
            : null;
        const alphaAnimation = animatedOpacity
            ? `,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='clip(alpha(X,Y)*(${animatedOpacity}),0,255)'`
            : '';
        const staticOpacity = opacity * (opacitySamples.length === 1 ? Math.max(0, Math.min(1, Number(opacitySamples[0]?.value) || 0)) : 1);
        let processed = current;
        let processedIndex = 0;
        const emitLabel = () => `comp${groupSerial++}fx${processedIndex++}`;
        // Opacity belongs to the isolated composition before its effects.
        const opacityLabel = emitLabel();
        chains.push(`[${processed}]format=rgba,colorchannelmixer=aa=${n4(staticOpacity)}${alphaAnimation}[${opacityLabel}]`);
        processed = opacityLabel;
        for (const effect of groupEffects) {
            if (effect.startsWith('__VIBED_GROUP_GLOW__')) {
                const glow = JSON.parse(effect.slice('__VIBED_GROUP_GLOW__'.length));
                const baseLabel = emitLabel(), bloomLabel = emitLabel(), blurredLabel = emitLabel(), mergedLabel = emitLabel();
                const thresholdValue = glow.thresholdExpression
                    ? `(${glow.thresholdExpression.replace(/\bt\b/g, 'T').replace(/,/g, '\\,')})*255`
                    : n4(glow.threshold * 255);
                const intensityValue = glow.intensityExpression
                    ? `(${glow.intensityExpression.replace(/\bt\b/g, 'T').replace(/,/g, '\\,')})*255`
                    : n4(glow.intensity * 255);
                const ramp = `clip(((0.2126*r(X,Y)+0.7152*g(X,Y)+0.0722*b(X,Y)-(${thresholdValue}))/max(1,255-(${thresholdValue})))\\,0\\,1)`;
                const target = `comp${String(groupSerial)}_glow_${processedIndex}`.replace(/[^a-zA-Z0-9_]/g, '_');
                const radiusFilter = Array.isArray(glow.radiusCommands) && glow.radiusCommands.length > 1
                    ? `sendcmd=c='${glow.radiusCommands.map(([time, value]) => `${time} ${target} sigma ${value}`).join(';')}',gblur@${target}=sigma=${glow.radiusCommands[0][1]}:planes=15`
                    : `gblur=sigma=${n4(glow.radius)}:planes=15`;
                chains.push(`[${processed}]split[${baseLabel}][${bloomLabel}]`);
                chains.push(`[${bloomLabel}]geq=r='${glow.red}':g='${glow.green}':b='${glow.blue}':a='alpha(X,Y)*${ramp}*(${intensityValue})',${radiusFilter}[${blurredLabel}]`);
                chains.push(`[${baseLabel}][${blurredLabel}]overlay=x=0:y=0:format=auto:shortest=1[${mergedLabel}]`);
                processed = mergedLabel;
            } else {
                const next = emitLabel();
                chains.push(`[${processed}]${effect}[${next}]`);
                processed = next;
            }
        }
        chains.push(`[${processed}]format=rgba${groupEffects.length ? '' : ''}[${groupOutput}]`);
        current = parentCurrent;
        currentIsRgb = parentIsRgb;
        opCount += 1;
        const output = opCount === totalOps ? 'vout' : `bg${opCount}`;
        if (BLEND_MODES.has(group.blendMode)) {
            const destination = `comp${groupSerial++}destination`;
            const source = `comp${groupSerial++}source`;
            const pair = `comp${groupSerial++}pair`;
            chains.push(`[${current}]format=rgba[${destination}]`);
            chains.push(`[${groupOutput}]format=rgba[${source}]`);
            chains.push(`[${destination}][${source}]hstack=inputs=2:shortest=1[${pair}]`);
            const offset = frame.width;
            const alpha = `255*(alpha(X+${offset},Y)/255+(alpha(X,Y)/255)*(1-alpha(X+${offset},Y)/255))`;
            chains.push(`[${pair}]geq=r='${alphaBlendChannelExpression(group.blendMode, 'r', offset)}':g='${alphaBlendChannelExpression(group.blendMode, 'g', offset)}':b='${alphaBlendChannelExpression(group.blendMode, 'b', offset)}':a='${alpha}',crop=${frame.width}:${frame.height}:0:0[${output}]`);
        } else {
            chains.push(`[${current}][${groupOutput}]overlay=x=0:y=0:format=auto:shortest=1[${output}]`);
        }
        current = output;
    };
    visible.forEach(ov => {
        const desiredGroups = Array.isArray(ov.compositionStack) ? ov.compositionStack : [];
        let sharedDepth = 0;
        while (sharedDepth < groupStack.length && sharedDepth < desiredGroups.length
            && groupStack[sharedDepth].group.id === desiredGroups[sharedDepth]?.id) sharedDepth++;
        while (groupStack.length > sharedDepth) closeGroup();
        for (let depth = sharedDepth; depth < desiredGroups.length; depth++) openGroup(desiredGroups[depth]);
        const i = drawable.indexOf(ov);
        const samples = decimate(ov.geometry, MAX_GEOMETRY_SAMPLES);
        let xExpr = buildPiecewiseExpr(samples, 'x', frame.width);
        let yExpr = buildPiecewiseExpr(samples, 'y', frame.height);
        const shakeRotation = (Array.isArray(ov.effects) ? ov.effects : []).some(effect => {
            if (!effect || effect.enabled === false || (effect.kind || effect.type) !== 'shake') return false;
            const value = Number(effect.params?.rotationAmount?.value ?? effect.params?.rotationAmount) || 0;
            return value > 0;
        });
        // A rotated layer is bigger than its geometry box: place it by its
        // CENTRE (x + w/2) instead of its top-left. Unrotated layers keep the
        // exact expression they always had.
        if (shakeRotation || isAnimated(samples, 'rotation') || Math.abs(Number(samples[0]?.rotation) || 0) > 0.01) {
            xExpr = `(${xExpr})+(${buildPiecewiseExpr(samples, 'w', frame.width)})/2-overlay_w/2`;
            yExpr = `(${yExpr})+(${buildPiecewiseExpr(samples, 'h', frame.height)})/2-overlay_h/2`;
        }
        // Camera Shake is also available on footage layers. Match the preview's
        // time-varying translation in export instead of silently dropping the
        // effect. The seed offsets the phase so separately seeded layers do not
        // all move in lockstep. FFmpeg evaluates these expressions per frame.
        for (const effect of Array.isArray(ov.effects) ? ov.effects : []) {
            if (!effect || effect.enabled === false || (effect.kind || effect.type) !== 'shake') continue;
            if (Array.isArray(effect.outputWindows) && effect.outputWindows.length === 0) continue;
            const params = effect.params || {};
            const read = (key, fallback) => Number(params[key]?.value ?? params[key] ?? fallback);
            const intensity = Math.max(0, Math.min(50, read('intensity', 5))) * frame.width / 1080;
            const frequency = Math.max(1, Math.min(60, read('frequency', 10)));
            const sampled = (key, fallback, min, max) => {
                const points = effect.samples?.[key];
                if (!Array.isArray(points) || !points.length) return null;
                const bounded = points.map(point => ({
                    ...point,
                    value: Math.max(min, Math.min(max, Number(point.value))),
                })).filter(point => Number.isFinite(point.t) && Number.isFinite(point.value));
                return bounded.length ? buildPiecewiseExpr(bounded, 'value') : null;
            };
            const intensityTrack = sampled('intensity', read('intensity', 5), 0, 50);
            const frequencyTrack = sampled('frequency', frequency, 1, 60);
            const sampledIntensity = intensityTrack
                ? `((${intensityTrack})*${n4(frame.width / 1080)})`
                : n4(intensity);
            const sampledFrequency = frequencyTrack ? `(${frequencyTrack})` : n4(frequency);
            const sampledYFrequency = frequencyTrack ? `(${frequencyTrack}*0.83)` : n4(frequency * 0.83);
            const seed = Math.max(0, Math.min(1000, read('randomSeed', 0)));
            const phase = n4(seed * 0.61803398875);
            const active = Array.isArray(effect.outputWindows)
                ? effect.outputWindows.filter(w => Number.isFinite(Number(w.start)) && Number.isFinite(Number(w.end)) && Number(w.end) > Number(w.start))
                    .map(w => timeWindowExpr(w.start, w.end)).join('+') || '0'
                : timeWindowExpr(ov.outputStart, ov.outputEnd);
            xExpr = `(${xExpr})+if(${active},sin(2*PI*t*${sampledFrequency}+${phase})*${sampledIntensity},0)`;
            yExpr = `(${yExpr})+if(${active},cos(2*PI*t*${sampledYFrequency}+${n4(phase + 1.7)})*${sampledIntensity},0)`;
        }
        const enable = `enable='${timeWindowExpr(ov.outputStart, ov.outputEnd)}'`;
        let compositeSource = `ov${i}`;
        let compositeX = xExpr;
        let compositeY = yExpr;

        if (ov.sceneMask?.kind === 'layer') {
            const matte = drawable.find(candidate => candidate.id === ov.sceneMask.sourceOverlayId);
            if (!matte || !matte.matteOnly) throw new Error(`overlay ${ov.id} references a missing matte layer`);
            const matteIndex = drawable.indexOf(matte);
            const matteSamples = decimate(matte.geometry, MAX_GEOMETRY_SAMPLES);
            let matteX = buildPiecewiseExpr(matteSamples, 'x', frame.width);
            let matteY = buildPiecewiseExpr(matteSamples, 'y', frame.height);
            const matteRotated = isAnimated(matteSamples, 'rotation') || Math.abs(Number(matteSamples[0]?.rotation) || 0) > 0.01;
            if (matteRotated) {
                matteX = `(${matteX})+(${buildPiecewiseExpr(matteSamples, 'w', frame.width)})/2-overlay_w/2`;
                matteY = `(${matteY})+(${buildPiecewiseExpr(matteSamples, 'h', frame.height)})/2-overlay_h/2`;
            }
            const duration = Math.max(0.1, Number(plan.base?.totalDuration) || Number(ov.outputEnd) || 0.1);
            const fps = Number(plan.fps) > 0 ? Number(plan.fps) : 30;
            const targetCanvas = `matte${i}tc`;
            const targetFull = `matte${i}tf`, matteFull = `matte${i}mf`;
            const targetAlpha = `matte${i}ta`, matteAlpha = `matte${i}ma`;
            const combinedAlpha = `matte${i}ca`, targetRgb = `matte${i}rgb`;
            compositeSource = `matte${i}out`;
            compositeX = '0'; compositeY = '0';
            const shutterSampleCount = motionBlurSampleCount(ov);
            if (shutterSampleCount > 1) {
                const matteFrames = matteSampleSources.get(i) || [];
                matteFrames.forEach((sourceLabel, sampleIndex) => {
                    const matteCanvas = `matte${i}mc${sampleIndex}`;
                    const matteFull = `matte${i}mf${sampleIndex}`;
                    const sampleOffset = shutterOffsets(ov, plan.fps)[sampleIndex];
                    const sampleMatteX = atShutterTime(matteX, sampleOffset, matte);
                    const sampleMatteY = atShutterTime(matteY, sampleOffset, matte);
                    chains.push(`color=c=black@0:s=${frame.width}x${frame.height}:r=${fps}:d=${n4(duration)},format=rgba[${matteCanvas}]`);
                    chains.push(`[${matteCanvas}][${sourceLabel}]overlay=x='${sampleMatteX}':y='${sampleMatteY}':eval=frame:format=auto:eof_action=pass:enable='${timeWindowExpr(matte.outputStart, matte.outputEnd)}'[${matteFull}]`);
                });
            } else {
                const matteCanvas = `matte${i}mc`, matteSourceLabel = matteSampleSources.get(i)?.[0] || `ov${matteIndex}`;
                chains.push(`color=c=black@0:s=${frame.width}x${frame.height}:r=${fps}:d=${n4(duration)},format=rgba[${matteCanvas}]`);
                chains.push(`[${matteCanvas}][${matteSourceLabel}]overlay=x='${matteX}':y='${matteY}':eval=frame:format=auto:eof_action=pass:enable='${timeWindowExpr(matte.outputStart, matte.outputEnd)}'[${matteFull}]`);
                chains.push(`color=c=black@0:s=${frame.width}x${frame.height}:r=${fps}:d=${n4(duration)},format=rgba[${targetCanvas}]`);
                chains.push(`[${targetCanvas}][ov${i}]overlay=x='${xExpr}':y='${yExpr}':eval=frame:format=auto:eof_action=pass:${enable}[${targetFull}]`);
                chains.push(`[${targetFull}]split=2[matte${i}targbsource][matte${i}taSource]`);
                chains.push(`[matte${i}taSource]alphaextract[${targetAlpha}]`);
                if (ov.sceneMask.mode === 'luma' || ov.sceneMask.mode === 'luminance') {
                    chains.push(`[${matteFull}]split=2[matte${i}lumaSource][matte${i}alphaSource]`);
                    chains.push(`[matte${i}lumaSource]format=gray[matte${i}luma]`);
                    chains.push(`[matte${i}alphaSource]alphaextract[matte${i}sourceAlpha]`);
                    chains.push(`[matte${i}luma][matte${i}sourceAlpha]blend=all_mode=multiply[matte${i}lumaAlpha]`);
                    chains.push(`[matte${i}lumaAlpha]${ov.sceneMask.invert ? "lut=y='negval'" : 'null'}[${matteAlpha}]`);
                } else {
                    chains.push(`[${matteFull}]alphaextract,${ov.sceneMask.invert ? "lut=y='negval'" : 'null'}[${matteAlpha}]`);
                }
                chains.push(`[${targetAlpha}][${matteAlpha}]blend=all_mode=multiply[${combinedAlpha}]`);
                chains.push(`[matte${i}targbsource]format=rgb24[${targetRgb}]`);
                chains.push(`[${targetRgb}][${combinedAlpha}]alphamerge[${compositeSource}]`);
            }
        }

        if (ov.shadow) {
            // Same centred expression as the sprite, offset by the shadow's
            // own dx/dy (already scaled to this render's resolution inside
            // compileShadowSource's sibling normalisation — here it's just a
            // pixel offset on an already-pixel expression).
            const REFERENCE_WIDTH = 1080;
            const scale = frame.width / REFERENCE_WIDTH;
            const dx = n4((Number(ov.shadow.dx) || 0) * scale);
            const dy = n4((Number(ov.shadow.dy) || 0) * scale);
            const sxExpr = `(${xExpr})+${dx}`;
            const syExpr = `(${yExpr})+${dy}`;
            opCount += 1;
            const shadowOutLabel = (opCount === totalOps) ? 'vout' : `bg${opCount}`;
            // `enable` gates the overlay to its window; without it the last frame of
            // a finished overlay would stick for the rest of the video.
            // `eval=frame` is required for x/y expressions to be re-read per frame.
            chains.push(
                `[${current}][ov${i}s]overlay=x='${sxExpr}':y='${syExpr}'` +
                `${currentIsRgb ? ':format=rgb' : (options.preserveAlpha ? ':format=auto' : '')}` +
                `:eval=frame:${enable}` +
                `[${shadowOutLabel}]`
            );
            current = shadowOutLabel;
        }

        overlayAlphaEffects(ov).forEach((effect, effectIndex) => {
            const source = alphaEffectSources.get(`${i}:${effectIndex}`);
            const effectOutLabel = (opCount + 1 === totalOps) ? 'vout' : `bg${opCount + 1}`;
            const ex = `(${xExpr})-${source.pad}+${source.dx}`;
            const ey = `(${yExpr})-${source.pad}+${source.dy}`;
            opCount += 1;
            const effectEnable = effectWindowEnable(effect, ov);
            chains.push(
                `[${current}][ov${i}e${effectIndex}]overlay=x='${ex}':y='${ey}'` +
                `${currentIsRgb ? ':format=rgb' : (options.preserveAlpha ? ':format=auto' : '')}` +
                `:eval=frame:${effectEnable}[${effectOutLabel}]`
            );
            current = effectOutLabel;
        });

        overlayStrokeEffects(ov).forEach((effect, effectIndex) => {
            const source = strokeEffectSources.get(`${i}:${effectIndex}`);
            opCount += 1;
            const effectOutLabel = opCount === totalOps ? 'vout' : `bg${opCount}`;
            const effectEnable = effectWindowEnable(effect, ov);
            chains.push(`[${current}][ov${i}st${effectIndex}]overlay=x='(${xExpr})-${source.pad}':y='(${yExpr})-${source.pad}'${currentIsRgb ? ':format=rgb' : (options.preserveAlpha ? ':format=auto' : '')}:eval=frame:${effectEnable}[${effectOutLabel}]`);
            current = effectOutLabel;
        });

        const transformOffsets = shutterOffsets(ov, plan.fps);
        for (let sampleIndex = 0; sampleIndex < transformOffsets.length; sampleIndex++) {
            const offset = transformOffsets[sampleIndex];
            let sampleSource = transformOffsets.length > 1 ? `ov${i}mb${sampleIndex}` : compositeSource;
            let sampleX = atShutterTime(compositeX, offset, ov);
            let sampleY = atShutterTime(compositeY, offset, ov);
            // The ordinary layer-matte path masks one full-frame composite.
            // Transform blur instead composites several shutter samples, so
            // mask each sample after placing it at its sampled transform. If
            // we used the raw source here, the blurred trail would escape the
            // matte even though the sharp center frame was correctly clipped.
            if (transformOffsets.length > 1 && ov.sceneMask?.kind === 'layer') {
                const suffix = `matte${i}mb${sampleIndex}`;
                const canvas = `${suffix}canvas`, target = `${suffix}target`, targetAlpha = `${suffix}targetAlpha`;
                const matteAlpha = `${suffix}matteAlpha`, combinedAlpha = `${suffix}combinedAlpha`;
                const targetRgb = `${suffix}targetRgb`, masked = `${suffix}masked`;
                const totalDuration = Math.max(0.1, Number(plan.base?.totalDuration) || Number(ov.outputEnd) || 0.1);
                const fps = Number(plan.fps) > 0 ? Number(plan.fps) : 30;
                chains.push(`color=c=black@0:s=${frame.width}x${frame.height}:r=${fps}:d=${n4(totalDuration)},format=rgba[${canvas}]`);
                chains.push(`[${canvas}][${sampleSource}]overlay=x='${sampleX}':y='${sampleY}':eval=frame:format=auto:eof_action=pass:${enable}[${target}]`);
                chains.push(`[${target}]split=2[${suffix}targetRgbSource][${suffix}targetAlphaSource]`);
                chains.push(`[${suffix}targetAlphaSource]alphaextract[${targetAlpha}]`);
                const matteFull = `matte${i}mf${sampleIndex}`;
                if (ov.sceneMask.mode === 'luma' || ov.sceneMask.mode === 'luminance') {
                    chains.push(`[${matteFull}]split=2[${suffix}lumaSource][${suffix}alphaSource]`);
                    chains.push(`[${suffix}lumaSource]format=gray[${suffix}luma]`);
                    chains.push(`[${suffix}alphaSource]alphaextract[${suffix}sourceAlpha]`);
                    chains.push(`[${suffix}luma][${suffix}sourceAlpha]blend=all_mode=multiply[${suffix}lumaAlpha]`);
                    chains.push(`[${suffix}lumaAlpha]${ov.sceneMask.invert ? "lut=y='negval'" : 'null'}[${matteAlpha}]`);
                } else {
                    chains.push(`[${matteFull}]alphaextract,${ov.sceneMask.invert ? "lut=y='negval'" : 'null'}[${matteAlpha}]`);
                }
                chains.push(`[${targetAlpha}][${matteAlpha}]blend=all_mode=multiply[${combinedAlpha}]`);
                chains.push(`[${suffix}targetRgbSource]format=rgb24[${targetRgb}]`);
                chains.push(`[${targetRgb}][${combinedAlpha}]alphamerge[${masked}]`);
                sampleSource = masked;
                sampleX = '0'; sampleY = '0';
            }
            opCount += 1;
            const outLabel = (opCount === totalOps) ? 'vout' : `bg${opCount}`;

            if (BLEND_MODES.has(ov.blendMode)) {
                // Blend colors using the W3C source-over equation, including
                // premultiplied coverage from both transparent layers. Each
                // shutter sample is composited with its exposure-weighted alpha.
                const placed = `placed${i}mb${sampleIndex}`;
                const neutral = `neutral${i}mb${sampleIndex}`;
                const destination = `blend${i}mb${sampleIndex}destination`;
                const source = `blend${i}mb${sampleIndex}source`;
                const pair = `blend${i}mb${sampleIndex}pair`;
                const merged = `blend${i}mb${sampleIndex}merged`;
                const totalDuration = Math.max(0.1, Number(plan.base?.totalDuration) || Number(ov.outputEnd) || 0.1);
                const fps = Number(plan.fps) > 0 ? Number(plan.fps) : 30;
                chains.push(`color=c=black@0:s=${frame.width}x${frame.height}:r=${fps}:d=${n4(totalDuration)},format=rgba[${neutral}]`);
                chains.push(`[${neutral}][${sampleSource}]overlay=x='${sampleX}':y='${sampleY}':format=auto:eval=frame:${enable}[${placed}]`);
                chains.push(`[${current}]format=rgba[${destination}]`);
                chains.push(`[${placed}]format=rgba[${source}]`);
                chains.push(`[${destination}][${source}]hstack=inputs=2:shortest=1[${pair}]`);
                const sourceOffset = frame.width;
                const alphaExpression = `255*(alpha(X+${sourceOffset},Y)/255+(alpha(X,Y)/255)*(1-alpha(X+${sourceOffset},Y)/255))`;
                chains.push(`[${pair}]geq=r='${alphaBlendChannelExpression(ov.blendMode, 'r', sourceOffset)}':g='${alphaBlendChannelExpression(ov.blendMode, 'g', sourceOffset)}':b='${alphaBlendChannelExpression(ov.blendMode, 'b', sourceOffset)}':a='${alphaExpression}',crop=${frame.width}:${frame.height}:0:0[${merged}]`);
                chains.push(`[${merged}]format=rgba[${outLabel}]`);
            } else {
                chains.push(
                    `[${current}][${sampleSource}]overlay=x='${sampleX}':y='${sampleY}'` +
                    `${currentIsRgb ? ':format=rgb' : (options.preserveAlpha ? ':format=auto' : '')}` +
                    `:eval=frame:${enable}` +
                    `[${outLabel}]`
                );
            }
            current = outLabel;
        }

        // Highlight bloom on opaque footage must sit above its own source;
        // image/sticker glows remain behind their alpha silhouettes.
        overlayTopEffects(ov).forEach((effect, effectIndex) => {
            const source = alphaEffectSources.get(`${i}:top:${effectIndex}`);
            opCount += 1;
            const effectOutLabel = opCount === totalOps ? 'vout' : `bg${opCount}`;
            const ex = `(${xExpr})-${source.pad}`;
            const ey = `(${yExpr})-${source.pad}`;
            chains.push(`[${current}][ov${i}t${effectIndex}]overlay=x='${ex}':y='${ey}'${currentIsRgb ? ':format=rgb' : (options.preserveAlpha ? ':format=auto' : '')}:eval=frame:${effectWindowEnable(effect, ov)}[${effectOutLabel}]`);
            current = effectOutLabel;
        });
    });

    while (groupStack.length) closeGroup();

    return { filterComplex: chains.join(';'), outputLabel: 'vout', used: drawable.length };
}

/**
 * Plan version this worker knows how to execute. Must track
 * `COMPOSITION_PLAN_VERSION` in client/src/motion/Compositor.js.
 *
 * These are two processes that deploy independently: a browser tab left open
 * across a deploy can post a plan built by older client code. Refusing an
 * unknown version (and rendering without overlays) is the only safe response —
 * executing a plan whose shape you are guessing at produces a wrong video that
 * nothing flags as wrong.
 */
const SUPPORTED_PLAN_VERSION = 7;
const BLEND_MODES = new Set(['multiply', 'screen', 'darken', 'lighten', 'difference', 'addition', 'overlay', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']);
// Keep this list in lockstep with compileOverlaySource and its dedicated alpha,
// top-effect, and stroke passes. Accepting an unknown kind here used to let the
// main switch's default branch drop it silently, producing a successful export
// that did not match the edit.
const SUPPORTED_OVERLAY_EFFECTS = new Set([
    'gradient-fill', 'fade_in', 'fade_out', 'blur', 'blur_gaussian', 'blur_radial',
    'blur_motion', 'motion-blur', 'shake', 'brightness', 'contrast', 'saturation',
    'saturate', 'hue', 'hue-rotate', 'color_grade', 'grain', 'film_grain', 'film-grain',
    'chromatic-aberration', 'rgb_split', 'distortion', 'vignette', 'glitch', 'inner-shadow',
    // These are compiled as dedicated alpha/top/stroke passes rather than by
    // compileOverlaySource's main effect switch. They still need to pass the
    // worker trust-boundary check or valid editor effects are rejected before
    // those specialized passes can run.
    'shadow', 'glow', 'stroke',
]);

function validIsolatedGroupEffect(effect) {
    if (effect?.enabled === false) return true;
    const kind = effect?.kind || effect?.type;
    if (!['blur', 'blur_gaussian', 'brightness', 'contrast', 'saturation', 'saturate', 'hue', 'hue-rotate', 'color_grade', 'glow'].includes(kind)) return false;
    if (effect.keyframes || effect.expressions) return false;
    const samples = effect.samples;
    if (samples == null) return effect.outputWindows == null;
    if (kind === 'blur' || kind === 'blur_gaussian') {
        const key = samples.radius ? 'radius' : 'amount';
        const points = samples[key];
        return Array.isArray(points) && points.length > 0 && points.length <= 60
            && Object.keys(samples).every(sampleKey => sampleKey === key)
            && points.every((point, index) => point && hasNumericValue(point.t) && Number(point.t) >= 0
                && hasNumericValue(point.value) && Number(point.value) >= 0 && Number(point.value) <= 50
                && (index === 0 || Number(point.t) > Number(points[index - 1]?.t)))
            && (effect.outputWindows == null || (Array.isArray(effect.outputWindows) && effect.outputWindows.every(window =>
                window && hasNumericValue(window.start) && hasNumericValue(window.end) && Number(window.start) >= 0 && Number(window.end) > Number(window.start))));
    }
    if (kind === 'hue' || kind === 'hue-rotate') {
        const key = samples?.degrees ? 'degrees' : 'amount';
        const points = samples?.[key];
        if (!Array.isArray(points) || points.length === 0 || points.length > 60
            || Object.keys(samples).some(sampleKey => sampleKey !== key)
            || points.some((point, index) => !point || !hasNumericValue(point.t) || Number(point.t) < 0
                || !hasNumericValue(point.value) || Number(point.value) < -360 || Number(point.value) > 360
                || (index > 0 && Number(point.t) <= Number(points[index - 1]?.t)))) return false;
        return effect.outputWindows == null || (Array.isArray(effect.outputWindows) && effect.outputWindows.every(window =>
            window && hasNumericValue(window.start) && hasNumericValue(window.end) && Number(window.start) >= 0 && Number(window.end) > Number(window.start)));
    }
    if (kind === 'glow') {
        const limits = { threshold: [0, 1], intensity: [0, 3], radius: [0, 50] };
        if (!samples || !Object.keys(samples).length || Object.keys(samples).some(key => !limits[key])) return false;
        for (const [key, points] of Object.entries(samples)) {
            const [min, max] = limits[key];
            if (!Array.isArray(points) || points.length === 0 || points.length > 60 || points.some((point, index) => !point
                || !hasNumericValue(point.t) || Number(point.t) < 0 || !hasNumericValue(point.value)
                || Number(point.value) < min || Number(point.value) > max
                || (index > 0 && Number(point.t) <= Number(points[index - 1]?.t)))) return false;
        }
        return effect.outputWindows == null || (Array.isArray(effect.outputWindows) && effect.outputWindows.every(window =>
            window && hasNumericValue(window.start) && hasNumericValue(window.end) && Number(window.start) >= 0 && Number(window.end) > Number(window.start)));
    }
    if (kind === 'color_grade') {
        const limits = { brightness: [0, 200], contrast: [0, 200], saturation: [0, 200], temperature: [-100, 100], tint: [-100, 100] };
        if (!samples || !Object.keys(samples).length || Object.keys(samples).some(key => !limits[key])) return false;
        for (const [key, points] of Object.entries(samples)) {
            if (!Array.isArray(points) || points.length === 0 || points.length > 60 || points.some((point, index) => !point
                || !hasNumericValue(point.t) || Number(point.t) < 0 || !hasNumericValue(point.value)
                || Number(point.value) < limits[key][0] || Number(point.value) > limits[key][1]
                || (index > 0 && Number(point.t) <= Number(points[index - 1]?.t)))) return false;
        }
        return effect.outputWindows == null || (Array.isArray(effect.outputWindows) && effect.outputWindows.every(window =>
            window && hasNumericValue(window.start) && hasNumericValue(window.end) && Number(window.start) >= 0 && Number(window.end) > Number(window.start)));
    }
    if (!['brightness', 'contrast', 'saturation', 'saturate'].includes(kind)
        || !samples || !Array.isArray(samples.amount) || samples.amount.length === 0 || samples.amount.length > 60
        || Object.keys(samples).some(key => key !== 'amount')) return false;
    if (samples.amount.some((point, index, points) => !point || !hasNumericValue(point.t) || Number(point.t) < 0
        || !hasNumericValue(point.value) || Number(point.value) < 0 || Number(point.value) > (kind === 'saturation' || kind === 'saturate' ? 5 : 4)
        || (index > 0 && Number(point.t) <= Number(points[index - 1]?.t)))) return false;
    return effect.outputWindows == null || (Array.isArray(effect.outputWindows) && effect.outputWindows.every(window =>
        window && hasNumericValue(window.start) && hasNumericValue(window.end) && Number(window.start) >= 0 && Number(window.end) > Number(window.start)));
}

function validOverlayEffectSamples(effect) {
    if (effect?.samples == null) return true;
    const samples = effect.samples;
    if (!samples || typeof samples !== 'object' || Array.isArray(samples)) return false;
    const entries = Object.entries(samples);
    if (!entries.length || entries.length > 16) return false;
    if (!entries.every(([, points]) => Array.isArray(points) && points.length > 0 && points.length <= 60
        && !points.some((point, index) => !point || !hasNumericValue(point.t) || Number(point.t) < 0
            || !hasNumericValue(point.value) || (index > 0 && Number(point.t) <= Number(points[index - 1]?.t))))) return false;
    return effect.outputWindows == null || (Array.isArray(effect.outputWindows) && effect.outputWindows.every(window =>
        window && hasNumericValue(window.start) && hasNumericValue(window.end) && Number(window.start) >= 0 && Number(window.end) > Number(window.start)));
}

function alphaBlendChannelExpression(mode, channel, offset) {
    const destination = `${channel}(X,Y)`;
    const source = `${channel}(X+${offset},Y)`;
    let blended;
    let setup = null;
    switch (mode) {
        case 'multiply': blended = `(${destination}*${source}/255)`; break;
        case 'screen': blended = `(${destination}+${source}-${destination}*${source}/255)`; break;
        case 'darken': blended = `min(${destination},${source})`; break;
        case 'lighten': blended = `max(${destination},${source})`; break;
        case 'difference': blended = `abs(${destination}-${source})`; break;
        case 'addition': blended = `min(255,${destination}+${source})`; break;
        case 'overlay': blended = `if(lte(${destination},127.5)\\,2*${destination}*${source}/255\\,255-2*(255-${destination})*(255-${source})/255)`; break;
        case 'color-dodge': blended = `if(gte(${source},255)\\,255\\,min(255,${destination}*255/max(1,255-${source})))`; break;
        case 'color-burn': blended = `if(lte(${source},0)\\,0\\,255-min(255,(255-${destination})*255/max(1,${source})))`; break;
        case 'hard-light': blended = `if(lte(${source},127.5)\\,2*${destination}*${source}/255\\,255-2*(255-${destination})*(255-${source})/255)`; break;
        case 'soft-light': {
            const normalizedBackdrop = `${destination}/255`;
            const normalizedSource = `${source}/255`;
            const d = `if(lte(${destination},63.75)\\,((16*${normalizedBackdrop}-12)*${normalizedBackdrop}+4)*${normalizedBackdrop}\\,sqrt(${normalizedBackdrop}))`;
            blended = `255*if(lte(${source},127.5)\\,${normalizedBackdrop}-(1-2*${normalizedSource})*${normalizedBackdrop}*(1-${normalizedBackdrop})\\,${normalizedBackdrop}+(2*${normalizedSource}-1)*(${d}-${normalizedBackdrop}))`;
            break;
        }
        case 'exclusion': blended = `(${destination}+${source}-2*${destination}*${source}/255)`; break;
        case 'hue':
        case 'saturation':
        case 'color':
        case 'luminosity': {
            const hsl = hslBlendChannelExpression(mode, channel, offset);
            setup = hsl.setup;
            blended = hsl.color;
            break;
        }
        default: blended = source;
    }
    const destinationAlpha = 'alpha(X,Y)/255';
    const sourceAlpha = `alpha(X+${offset},Y)/255`;
    const outputAlpha = `(${sourceAlpha}+${destinationAlpha}*(1-${sourceAlpha}))`;
    const premultiplied = `(${destinationAlpha}*(1-${sourceAlpha})*${destination}+(1-${destinationAlpha})*${sourceAlpha}*${source}+${destinationAlpha}*${sourceAlpha}*${blended})`;
    const output = `${premultiplied}/max(${outputAlpha},0.000001)`;
    return setup ? `${setup};${output}` : output;
}

// W3C separable/non-separable blend definitions, evaluated in RGB by geq.
// These four modes were already available to vector drawing in Canvas, but
// were previously dropped by SceneSchema and rejected by the export worker.
function hslBlendChannelExpression(mode, channel, offset) {
    const c = ['r', 'g', 'b'].indexOf(channel);
    const idx = i => `ld(${i})`;
    const regs = [];
    const store = (i, expression) => regs.push(`st(${i},${expression})`);
    const lum = rgb => `(0.3*${idx(rgb[0])}+0.59*${idx(rgb[1])}+0.11*${idx(rgb[2])})`;
    const min3 = rgb => `min(min(${idx(rgb[0])},${idx(rgb[1])}),${idx(rgb[2])})`;
    const max3 = rgb => `max(max(${idx(rgb[0])},${idx(rgb[1])}),${idx(rgb[2])})`;

    for (let i = 0; i < 3; i++) {
        store(i, `${'rgb'[i]}(X,Y)/255`);
        store(i + 3, `${'rgb'[i]}(X+${offset},Y)/255`);
    }
    store(6, lum([0, 1, 2]));
    store(7, lum([3, 4, 5]));
    store(8, `(${max3([0, 1, 2])}-${min3([0, 1, 2])})`);
    store(9, `(${max3([3, 4, 5])}-${min3([3, 4, 5])})`);

    let base;
    let targetLum;
    if (mode === 'hue' || mode === 'saturation') {
        const input = mode === 'hue' ? [3, 4, 5] : [0, 1, 2];
        const targetSat = idx(mode === 'hue' ? 8 : 9);
        const lo = min3(input), hi = max3(input), span = `max(0.000001,${hi}-${lo})`;
        base = [10, 11, 12];
        for (let i = 0; i < 3; i++) {
            const value = idx(input[i]);
            store(base[i], `if(eq(${value},${lo})\\,0\\,if(eq(${value},${hi})\\,${targetSat}\\,(${value}-${lo})*${targetSat}/${span}))`);
        }
        targetLum = 6;
    } else if (mode === 'color') {
        base = [3, 4, 5];
        targetLum = 6;
    } else {
        base = [0, 1, 2];
        targetLum = 7;
    }

    store(13, lum(base));
    store(22, idx(targetLum));
    for (let i = 0; i < 3; i++) store(14 + i, `(${idx(base[i])}+${idx(22)}-${idx(13)})`);
    const shifted = [14, 15, 16];
    store(17, min3(shifted));
    for (let i = 0; i < 3; i++) {
        store(18 + i, `if(lt(${idx(17)},0)\\,${idx(22)}+(${idx(shifted[i])}-${idx(22)})*${idx(22)}/max(0.000001,${idx(22)}-${idx(17)})\\,${idx(shifted[i])})`);
    }
    store(21, max3([18, 19, 20]));
    const clipped = idx(18 + c);
    const output = `255*if(gt(${idx(21)},1)\\,${idx(22)}+(${clipped}-${idx(22)})*(1-${idx(22)})/max(0.000001,${idx(21)}-${idx(22)})\\,${clipped})`;
    return { setup: regs.join(';'), color: output };
}

/**
 * Server-side plan validation.
 *
 * Deliberately a SEPARATE implementation from the client's
 * `validateCompositionPlan()` rather than a shared import: the client is ESM
 * under Vite and the worker is CommonJS under Node, and this codebase's rule is
 * that the two module systems never mix. The client's copy is a fast authoring
 * check; this one is the trust boundary — it is validating input that arrived
 * over HTTP and must not assume the sender was honest or current.
 *
 * @returns {string[]} problems found; empty means safe to execute
 */
function validateCompositionPlanShape(plan, frameWidth, frameHeight) {
    const errors = [];
    if (!plan || typeof plan !== 'object') return ['plan is not an object'];

    if (plan.version !== SUPPORTED_PLAN_VERSION) {
        errors.push(`unsupported plan version ${plan.version} (this worker executes v${SUPPORTED_PLAN_VERSION})`);
        return errors; // Shape beyond this point is unknown — stop here.
    }

    if (!Array.isArray(plan.overlays)) return ['plan.overlays is not an array'];
    if (plan.overlays.length === 0) errors.push('plan has no overlays');

    // Geometry is normalised, so a resolution change is harmless — but ASPECT
    // is baked in (a height fraction was derived from a width fraction using the
    // authoring aspect). A plan authored for 9:16 and rendered at 16:9 would
    // render happily with every overlay the wrong shape, so it is refused.
    // Tolerance is generous: 1080x1920 vs 720x1280 differ only by rounding.
    if (!plan.frame || !Number.isFinite(Number(plan.frame.width)) || !Number.isFinite(Number(plan.frame.height))
        || Number(plan.frame.width) <= 0 || Number(plan.frame.height) <= 0) {
        errors.push('plan.frame must have finite positive dimensions');
    }
    if (plan.frame && frameWidth > 0 && frameHeight > 0) {
        const authored = Number(plan.frame.width) / Number(plan.frame.height);
        const actual = frameWidth / frameHeight;
        if (Number.isFinite(authored) && Math.abs(authored - actual) > 0.02) {
            errors.push(`plan was authored at aspect ${authored.toFixed(3)} but this export is ${actual.toFixed(3)}`);
        }
    }

    const seenZ = new Set();
    plan.overlays.forEach((ov, i) => {
        if (!ov || typeof ov !== 'object') { errors.push(`overlays[${i}] is not an object`); return; }
        if (!ov.id) errors.push(`overlays[${i}] has no id`);
        if (ov.compositionStack != null && (!Array.isArray(ov.compositionStack) || ov.compositionStack.some(group =>
            !group || typeof group.id !== 'string' || !group.id || !hasNumericValue(group.opacity) || Number(group.opacity) < 0 || Number(group.opacity) > 1
            || (group.start !== undefined && (!hasNumericValue(group.start) || Number(group.start) < 0))
            || (group.duration !== undefined && (!hasNumericValue(group.duration) || Number(group.duration) < 0))
            || (group.blendMode && !['source-over', ...BLEND_MODES].includes(group.blendMode))
            || (group.opacitySamples != null && (!Array.isArray(group.opacitySamples) || group.opacitySamples.length === 0 || group.opacitySamples.some((sample, sampleIndex, samples) =>
                !sample || !hasNumericValue(sample.t) || Number(sample.t) < 0 || !hasNumericValue(sample.value)
                || Number(sample.value) < 0 || Number(sample.value) > 1
                || (sampleIndex > 0 && Number(sample.t) <= Number(samples[sampleIndex - 1]?.t)))) )
            || (group.effects != null && (!Array.isArray(group.effects) || group.effects.some(effect => !validIsolatedGroupEffect(effect))))))) {
            errors.push(`overlays[${i}] has an invalid composition stack`);
        }
        const vector = ov.source?.vector;
        const vectorKinds = new Set(['rect', 'circle', 'ellipse', 'capsule', 'callout', 'polygon', 'star', 'arrow', 'path']);
        const inlineVector = ov.source?.type === 'vector' && vector && typeof vector === 'object'
            && vectorKinds.has(String(vector.kind || 'rect'))
            && (!('w' in vector) || (hasNumericValue(vector.w) && Number(vector.w) > 0 && Number(vector.w) <= 10000))
            && (!('h' in vector) || (hasNumericValue(vector.h) && Number(vector.h) > 0 && Number(vector.h) <= 10000))
            && (vector.kind !== 'path' || (typeof vector.pathData === 'string' && vector.pathData.trim().length > 0));
        if (!ov.source || (!ov.source.url && !ov.source.assetId
            && !(ov.source.type === 'template' && ov.source.template) && !inlineVector)) {
            errors.push(`overlays[${i}] has no resolvable source`);
        }
        if (!hasNumericValue(ov.outputStart) || !hasNumericValue(ov.outputEnd)
            || Number(ov.outputStart) < 0 || !(Number(ov.outputEnd) > Number(ov.outputStart))) {
            errors.push(`overlays[${i}] has an invalid time window`);
        }
        if (ov.motionBlur != null) {
            const blur = ov.motionBlur;
            if (!blur || typeof blur !== 'object' || typeof blur.enabled !== 'boolean'
                || (blur.enabled && (!hasNumericValue(blur.samples) || Number(blur.samples) < 2 || Number(blur.samples) > 15
                    || !Number.isInteger(Number(blur.samples))
                    || !hasNumericValue(blur.shutterAngle) || Number(blur.shutterAngle) < 0 || Number(blur.shutterAngle) > 360
                    || !hasNumericValue(blur.frameRate) || Number(blur.frameRate) < 1 || Number(blur.frameRate) > 120))) {
                errors.push(`overlays[${i}] has invalid transform motion blur settings`);
            }
        }
        if (ov.blendMode && !['source-over', ...BLEND_MODES].includes(ov.blendMode)) errors.push(`overlays[${i}] has unsupported blend mode ${ov.blendMode}`);
        if (ov.effects != null && (!Array.isArray(ov.effects) || ov.effects.some(effect => !validOverlayEffectSamples(effect)))) {
            errors.push(`overlays[${i}] has malformed or over-budget effect samples`);
        }
        for (const effect of Array.isArray(ov.effects) ? ov.effects : []) {
            if (effect?.enabled === false) continue;
            const kind = effect?.kind || effect?.type;
            if (!SUPPORTED_OVERLAY_EFFECTS.has(kind)) {
                errors.push(`overlays[${i}] has unsupported enabled effect ${String(kind || '(missing kind)')}`);
            }
            // Keep source restrictions aligned with the dedicated compilers.
            // Silently accepting a kind that the compiler filters out would
            // produce a successful but visually incomplete export.
            if (kind === 'stroke' && !['image', 'sticker'].includes(ov.source?.type)) {
                errors.push(`overlays[${i}] cannot apply stroke to source type ${String(ov.source?.type || '(missing type)')}`);
            }
            if (['shadow', 'glow'].includes(kind) && !['image', 'video', 'sticker'].includes(ov.source?.type)) {
                errors.push(`overlays[${i}] cannot apply ${kind} to source type ${String(ov.source?.type || '(missing type)')}`);
            }
        }
        if (ov.sceneMask && (ov.sceneMask.kind !== 'shape' || !SHAPE_MASKS.has(ov.sceneMask.shape))) {
            const matte = plan.overlays.find(candidate => candidate?.id === ov.sceneMask?.sourceOverlayId);
            if (ov.sceneMask.kind !== 'layer' || !matte || !matte.matteOnly || matte.id === ov.id) {
                errors.push(`overlays[${i}] has unsupported or unresolved scene mask`);
            }
            if (ov.sceneMask.kind === 'layer' && ov.sceneMask.mode != null && !['alpha', 'luma', 'luminance'].includes(ov.sceneMask.mode)) {
                errors.push(`overlays[${i}] has unsupported layer matte mode ${ov.sceneMask.mode}`);
            }
        }
        if (ov.sceneMask?.kind === 'shape' && SHAPE_MASKS.has(ov.sceneMask.shape)) {
            const mask = ov.sceneMask;
            const inset = Number.isFinite(Number(mask.inset)) ? Math.max(0, Math.min(0.45, Number(mask.inset))) : 0;
            const hasX = hasNumericValue(mask.x), hasY = hasNumericValue(mask.y);
            const x = hasX ? Number(mask.x) : inset;
            const y = hasY ? Number(mask.y) : inset;
            const w = hasNumericValue(mask.w) ? Number(mask.w) : 1 - x - (hasX ? 0 : inset);
            const h = hasNumericValue(mask.h) ? Number(mask.h) : 1 - y - (hasY ? 0 : inset);
            if (![x, y, w, h].every(Number.isFinite) || x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1 || y + h > 1) {
                errors.push(`overlays[${i}] has scene mask bounds outside the layer`);
            }
            if (mask.shape === 'polygon' && (!Number.isFinite(Number(mask.sides ?? 5)) || Number(mask.sides ?? 5) < 3 || Number(mask.sides ?? 5) > 128)) {
                errors.push(`overlays[${i}] has polygon mask sides outside 3..128`);
            }
            if (mask.shape === 'star' && (!Number.isFinite(Number(mask.points ?? 5)) || Number(mask.points ?? 5) < 2 || Number(mask.points ?? 5) > 64)) {
                errors.push(`overlays[${i}] has star mask points outside 2..64`);
            }
            for (const key of ['radius', 'innerRadius', 'outerRadius', 'rotation']) {
                if (mask[key] != null && !Number.isFinite(Number(mask[key]))) errors.push(`overlays[${i}] has non-finite scene mask ${key}`);
            }
        }
        if (ov.sceneMask?.kind === 'shape' && ov.sceneMask.feather !== undefined
            && (!hasNumericValue(ov.sceneMask.feather) || Number(ov.sceneMask.feather) < 0 || Number(ov.sceneMask.feather) > 0.25)) {
            errors.push(`overlays[${i}] has shape mask feather outside 0..0.25`);
        }
        if (seenZ.has(ov.zIndex)) errors.push(`overlays[${i}] has a duplicate zIndex ${ov.zIndex}`);
        seenZ.add(ov.zIndex);

        if (!Array.isArray(ov.geometry) || ov.geometry.length === 0) {
            errors.push(`overlays[${i}] has no geometry`);
            return;
        }
        for (const g of ov.geometry) {
            if (!g || typeof g !== 'object'
                || !['x', 'y', 'w', 'h', 't', 'rotation', 'opacity', 'blur'].every(k => hasNumericValue(g[k]))) {
                errors.push(`overlays[${i}] has a non-finite geometry sample`);
                break;
            }
            if (Number(g.w) <= 0 || Number(g.h) <= 0) {
                errors.push(`overlays[${i}] has a non-positive size`);
                break;
            }
            if (Number(g.t) < 0 || Number(g.opacity) < 0 || Number(g.opacity) > 1 || Number(g.blur) < 0) {
                errors.push(`overlays[${i}] has geometry outside supported bounds`);
                break;
            }
            if (['flipH', 'flipV'].some(key => g[key] !== undefined
                && (!hasNumericValue(g[key]) || ![0, 1].includes(Number(g[key]))))) {
                errors.push(`overlays[${i}] has an invalid scale-flip channel`);
                break;
            }
        }
    });

    return errors;
}

module.exports = {
    compileCompositionPlan,
    validateCompositionPlanShape,
    SUPPORTED_PLAN_VERSION,
    // Exported for the regression suite.
    buildPiecewiseExpr,
    compileOverlaySource,
    findFade,
    decimate,
    isAnimated,
    MAX_GEOMETRY_SAMPLES,
};
