import React from 'react';
import { drawTransitionOverlay, hasOverlay } from '../../motion/TransitionFX.js';
import { TFX_FILTER_ID } from './transitionStyle.js';

/**
 * R89 (to-do A4) — what the preview draws ON TOP of the base video during a
 * transition: the flash/dip blend, the speed-line sweep, and the SVG filter the
 * base video references for directional blur and the red/blue split. The base
 * video's own shift/zoom is applied by VideoPlayer (transitionTransform).
 * Parameters come from motion/TransitionFX.js, the same file the export samples.
 */
const RED = '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0';
const GREEN = '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0';
const BLUE = '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0';

const TransitionLayer = ({ fx, frameWidth }) => {
    const linesRef = React.useRef(null);
    const w = Number(frameWidth) > 0 ? Number(frameWidth) : 0;
    const bx = fx ? fx.blurX * w : 0;
    const by = fx ? fx.blurY * w : 0;
    const c = fx ? fx.chroma * w : 0;

    // R115: the overlay is whatever the transition wants drawn on top — speed
    // lines, or a wipe shape. The key is what makes the effect re-render, so
    // it has to change whenever the overlay does.
    const overlayKey = fx ? JSON.stringify(fx.wipe ?? fx.lines ?? null) : null;
    const overlay = hasOverlay(fx);
    // The CSS width the backing store was sized for. Sizing is the only part of
    // the draw that needs layout, so it happens once per container width rather
    // than once per frame.
    const sizedForRef = React.useRef(0);

    React.useEffect(() => {
        const cv = linesRef.current;
        if (!cv) return;
        // R156: this effect runs on every frame of a transition, so it must not
        // read layout. getBoundingClientRect() here forced a synchronous layout
        // ~60 times a second on top of the decode, which is most of the stutter
        // at a cut on a phone.
        if (sizedForRef.current !== w || !cv.width) {
            // offsetWidth/Height are read here only — once per width change.
            // A canvas still display:none measures 0, so fall back to the
            // frame width the player already knows and a 16:9 box.
            const cssW = cv.offsetWidth || w || 720;
            const cssH = cv.offsetHeight || Math.round(cssW * 16 / 9);
            // The overlay is speed lines and wipe shapes over a moving picture.
            // At devicePixelRatio 3 on a phone that is a ~3000px canvas cleared
            // and refilled every frame for detail nobody can see; capping the
            // scale costs a third of the fill and looks the same.
            const scale = Math.min(window.devicePixelRatio || 1, 2);
            const W = Math.max(1, Math.min(1280, Math.round(cssW * scale)));
            cv.width = W;
            cv.height = Math.max(1, Math.round(W * (cssH / Math.max(1, cssW))));
            sizedForRef.current = cv.offsetWidth ? w : 0;
        }
        const ctx = cv.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, cv.width, cv.height);
        if (overlay) {
            try { drawTransitionOverlay(ctx, cv.width, cv.height, fx); } catch (err) { console.warn('[TransitionLayer] overlay failed:', err?.message); }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [overlayKey, w]);

    return (
        <>
            <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
                <filter id={TFX_FILTER_ID} x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
                    <feGaussianBlur in="SourceGraphic" stdDeviation={`${bx.toFixed(2)} ${by.toFixed(2)}`} result="blur" />
                    <feColorMatrix in="blur" type="matrix" values={RED} result="r" />
                    <feOffset in="r" dx={c.toFixed(2)} dy="0" result="r2" />
                    <feColorMatrix in="blur" type="matrix" values={GREEN} result="g" />
                    <feColorMatrix in="blur" type="matrix" values={BLUE} result="b" />
                    <feOffset in="b" dx={(-c).toFixed(2)} dy="0" result="b2" />
                    <feBlend in="r2" in2="g" mode="screen" result="rg" />
                    <feBlend in="rg" in2="b2" mode="screen" />
                </filter>
            </svg>
            {fx && (fx.flash > 0.001 || fx.dip > 0.001) && (
                <div
                    aria-hidden="true"
                    style={{
                        position: 'absolute', inset: 0, pointerEvents: 'none',
                        background: fx.flash >= fx.dip ? '#FFFFFF' : '#000000',
                        opacity: Math.max(fx.flash, fx.dip),
                    }}
                />
            )}
            <canvas
                ref={linesRef}
                aria-hidden="true"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', display: overlay ? 'block' : 'none' }}
            />
        </>
    );
};

export default TransitionLayer;
