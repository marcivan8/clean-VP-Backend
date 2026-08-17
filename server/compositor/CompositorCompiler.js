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

/**
 * Evenly decimate samples down to `max`, always keeping the first and last —
 * dropping either end would change where the animation starts or finishes.
 */
function decimate(samples, max) {
    if (!Array.isArray(samples) || samples.length <= max) return samples;
    const out = [samples[0]];
    const step = (samples.length - 1) / (max - 1);
    for (let i = 1; i < max - 1; i++) out.push(samples[Math.round(i * step)]);
    out.push(samples[samples.length - 1]);
    return out;
}

/**
 * Build a piecewise-linear FFmpeg expression for one geometry property.
 *
 * Deliberately the same nested-`if(lt(t,..))` shape as `buildZoomKeyframeExpr()`
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
function compileOverlaySource(ov, inputIdx, label, frame) {
    const W = frame.width;
    const H = frame.height;
    const samples = decimate(ov.geometry, MAX_GEOMETRY_SAMPLES);
    const first = samples[0];
    const parts = [];

    // 1. Shift onto output time FIRST so every later filter shares one clock.
    parts.push(`setpts=PTS-STARTPTS+${n4(ov.outputStart)}/TB`);

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
    if (isAnimated(samples, 'w') || isAnimated(samples, 'h')) {
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

    // 4. Rotation. Static only in v1 — `rotate` accepts a per-frame expression
    //    but also resizes its own output box, which would fight the geometry
    //    already computed by the plan. Animated rotation is therefore pinned to
    //    the first sample rather than silently drifting out of position.
    const rot = Number(first.rotation) || 0;
    if (Math.abs(rot) > 0.01) {
        parts.push(`rotate=${n4(rot * Math.PI / 180)}:c=none:ow=rotw(${n4(rot * Math.PI / 180)}):oh=roth(${n4(rot * Math.PI / 180)})`);
    }

    // 5. Opacity. A constant is a cheap channel mix; a changing one becomes
    //    real alpha fades, which is the idiomatic and well-supported way to do
    //    it (colorchannelmixer cannot vary over time).
    if (isAnimated(samples, 'opacity')) {
        const fadeIn = findFade(samples, 'in');
        const fadeOut = findFade(samples, 'out');
        if (fadeIn)  parts.push(`fade=t=in:st=${n4(fadeIn.start)}:d=${n4(fadeIn.duration)}:alpha=1`);
        if (fadeOut) parts.push(`fade=t=out:st=${n4(fadeOut.start)}:d=${n4(fadeOut.duration)}:alpha=1`);
    } else if (first.opacity < 0.999) {
        parts.push(`colorchannelmixer=aa=${n4(Math.max(0, Math.min(1, first.opacity)))}`);
    }

    // 6. Blur, when a motion preset asked for one (e.g. camera-whip).
    const blur = Number(first.blur) || 0;
    if (blur > 0.05) parts.push(`gblur=sigma=${n4(Math.min(50, blur))}`);

    return `[${inputIdx}:v]${parts.join(',')}[${label}]`;
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
function compileCompositionPlan(plan, inputs) {
    if (!plan || !Array.isArray(plan.overlays) || plan.overlays.length === 0) return null;
    if (!Array.isArray(inputs) || inputs.length === 0) return null;

    const byId = new Map(inputs.map(i => [i.overlayId, i.inputIndex]));

    // Draw bottom-to-top. A plan with a mangled order would otherwise put a
    // background over a foreground, which reads as "the overlay disappeared".
    const drawable = plan.overlays
        .filter(ov => byId.has(ov.id) && Array.isArray(ov.geometry) && ov.geometry.length > 0)
        .sort((a, b) => a.zIndex - b.zIndex);

    if (drawable.length === 0) return null;

    const frame = {
        width:  Number(plan.renderWidth)  > 0 ? Number(plan.renderWidth)  : (plan.frame?.width  || 1080),
        height: Number(plan.renderHeight) > 0 ? Number(plan.renderHeight) : (plan.frame?.height || 1920),
    };

    const chains = [];
    drawable.forEach((ov, i) => {
        chains.push(compileOverlaySource(ov, byId.get(ov.id), `ov${i}`, frame));
    });

    // Base video is always input 0.
    let current = '0:v';
    drawable.forEach((ov, i) => {
        const samples = decimate(ov.geometry, MAX_GEOMETRY_SAMPLES);
        const xExpr = buildPiecewiseExpr(samples, 'x', frame.width);
        const yExpr = buildPiecewiseExpr(samples, 'y', frame.height);
        const outLabel = (i === drawable.length - 1) ? 'vout' : `bg${i}`;

        // `enable` gates the overlay to its window; without it the last frame of
        // a finished overlay would stick for the rest of the video.
        // `eval=frame` is required for x/y expressions to be re-read per frame.
        chains.push(
            `[${current}][ov${i}]overlay=x='${xExpr}':y='${yExpr}'` +
            `:eval=frame:enable='between(t,${n4(ov.outputStart)},${n4(ov.outputEnd)})'` +
            `[${outLabel}]`
        );
        current = outLabel;
    });

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
const SUPPORTED_PLAN_VERSION = 1;

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
        if (!ov.source || (!ov.source.url && !ov.source.assetId)) errors.push(`overlays[${i}] has no resolvable source`);
        if (!(Number(ov.outputEnd) > Number(ov.outputStart))) errors.push(`overlays[${i}] has a non-positive time window`);
        if (seenZ.has(ov.zIndex)) errors.push(`overlays[${i}] has a duplicate zIndex ${ov.zIndex}`);
        seenZ.add(ov.zIndex);

        if (!Array.isArray(ov.geometry) || ov.geometry.length === 0) {
            errors.push(`overlays[${i}] has no geometry`);
            return;
        }
        for (const g of ov.geometry) {
            if (!['x', 'y', 'w', 'h', 't'].every(k => Number.isFinite(Number(g[k])))) {
                errors.push(`overlays[${i}] has a non-finite geometry sample`);
                break;
            }
            if (Number(g.w) <= 0 || Number(g.h) <= 0) {
                errors.push(`overlays[${i}] has a non-positive size`);
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
