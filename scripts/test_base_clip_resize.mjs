globalThis.window = new EventTarget();
// R100 — move/resize handles for BASE video/image clips (BaseClipOverlay.jsx),
// the generalization of the existing overlay-only drag/pinch model. Base
// clips use a DIFFERENT unit convention than overlay clips (canvas pixels,
// centre-anchored, vs. overlay's 0-100 percent, top-left-anchored) — this is
// the geometry that bridges them, so it is verified thoroughly here, pure
// and without touching the DOM gesture code.
// node scripts/test_base_clip_resize.mjs
import assert from 'assert/strict';
const log = console.log;
const ok = (n) => log(`✓ ${n}`);

const { fitContainSize, baseClipScreenBox, screenDeltaToCanvasDelta } =
    await import('../client/src/motion/BaseClipGeometry.js');
const { clampScale, startResizeGesture } = await import('../client/src/utils/resizeGesture.js');

// ── 1 · fitContainSize mirrors project.tsx's fitSize() exactly ───────────
{
    // 16:9 source (1920x1080) into a 9:16 canvas (1080x1920): height-limited.
    const fit = fitContainSize(1920, 1080, 1080, 1920);
    const s = Math.min(1080 / 1920, 1920 / 1080);
    assert.deepEqual(fit, { w: Math.round(1920 * s), h: Math.round(1080 * s) });
    assert.ok(fit.w <= 1080 && fit.h <= 1920, 'fits inside the canvas, no cropping');
    ok('fitContainSize contain-fits a landscape source into a portrait canvas');

    // No source dims known → falls back to filling the canvas (project.tsx's own fallback).
    const fallback = fitContainSize(0, 0, 1080, 1920);
    assert.deepEqual(fallback, { w: 1080, h: 1920 });
    ok('missing source dimensions fall back to the full canvas size');
}

// ── 2 · baseClipScreenBox: centre-anchored canvas-px → CSS percent ────────
{
    // clip.x = clip.y = 0 (default, centred) → box centred at 50%/50%.
    const centred = baseClipScreenBox({ clipX: 0, clipY: 0, scale: 1, srcW: 1080, srcH: 1920, canvasWidth: 1080, canvasHeight: 1920 });
    assert.ok(Math.abs(centred.leftPct - 50) < 1e-9 && Math.abs(centred.topPct - 50) < 1e-9);
    assert.ok(Math.abs(centred.widthPct - 100) < 1e-6, `expected ~100% width (1:1 fit), got ${centred.widthPct}`);
    ok('clip.x=0, clip.y=0, scale=1 on a matching-aspect source centres and fills the frame');

    // Moving right by a quarter of the canvas width → leftPct advances by 25.
    const moved = baseClipScreenBox({ clipX: 270, clipY: 0, scale: 1, srcW: 1080, srcH: 1920, canvasWidth: 1080, canvasHeight: 1920 });
    assert.ok(Math.abs(moved.leftPct - 75) < 1e-6, `expected 75%, got ${moved.leftPct}`);
    ok('clip.x in canvas pixels maps linearly onto percent-of-frame for CSS positioning');

    // Doubling scale doubles the on-screen width percent.
    const scaled = baseClipScreenBox({ clipX: 0, clipY: 0, scale: 2, srcW: 1080, srcH: 1920, canvasWidth: 1080, canvasHeight: 1920 });
    assert.ok(Math.abs(scaled.widthPct - 200) < 1e-6, `expected ~200%, got ${scaled.widthPct}`);
    ok('clip.scale multiplies the fitted size directly (same meaning as overlay clips)');
}

// ── 3 · screenDeltaToCanvasDelta: screen-px drag → canvas-px delta ────────
{
    // Player box rendered at 540x960 screen px for a 1080x1920 canvas (half scale):
    // dragging 54 screen px right should be +108 canvas px (2x, inverse of the half render scale).
    const rect = { width: 540, height: 960 };
    const { dx, dy } = screenDeltaToCanvasDelta({ deltaScreenX: 54, deltaScreenY: 96, containerRect: rect, canvasWidth: 1080, canvasHeight: 1920 });
    assert.ok(Math.abs(dx - 108) < 1e-6, `expected dx=108, got ${dx}`);
    assert.ok(Math.abs(dy - 192) < 1e-6, `expected dy=192, got ${dy}`);
    ok('a drag is converted from on-screen pixels to canvas pixels using the actual rendered scale');

    // Degenerate container rect (not yet measured) → no-op, never NaN.
    const safe = screenDeltaToCanvasDelta({ deltaScreenX: 10, deltaScreenY: 10, containerRect: null, canvasWidth: 1080, canvasHeight: 1920 });
    assert.deepEqual(safe, { dx: 0, dy: 0 });
    ok('a missing container rect is a safe no-op, not a NaN delta');
}

// ── 4 · the resize handle (shared with overlay clips) is correctly reused ─
{
    assert.equal(clampScale(10, { min: 0.1, max: 5 }), 5);
    assert.equal(clampScale(0.01, { min: 0.1, max: 5 }), 0.1);
    ok('clampScale enforces the same 0.1x-5x bounds the pinch gesture already uses');

    // Simulate a corner drag: element centred at (100,100), pointer starts at
    // (150,100) -> startDist=50 (the "1x" reference); dragging out to distance
    // 100 should double the scale.
    let live = null, committed = null;
    startResizeGesture(
        { clientX: 150, clientY: 100 },
        { getCenter: () => ({ x: 100, y: 100 }), initialScale: 1, onChange: (s) => { live = s; }, onCommit: (s) => { committed = s; } },
    );
    const moveEvent = new Event('pointermove'); moveEvent.clientX = 200; moveEvent.clientY = 100;
    window.dispatchEvent(moveEvent);
    assert.ok(Math.abs(live - 2) < 1e-6, `expected live scale ~2, got ${live}`);
    window.dispatchEvent(new Event('pointerup'));
    assert.ok(Math.abs(committed - 2) < 1e-6, `expected committed scale ~2, got ${committed}`);
    ok('dragging the resize handle out to 2x the starting distance doubles clip.scale, and commits on release');
}

console.log('\nAll base-clip resize/geometry checks passed.');
