import React from 'react';
import { drawSpeedLines } from '../../motion/TransitionFX.js';
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

    const lines = fx ? fx.lines : null;
    React.useEffect(() => {
        const cv = linesRef.current;
        if (!cv) return;
        const rect = cv.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const W = Math.max(1, Math.round(rect.width * dpr));
        const H = Math.max(1, Math.round(rect.height * dpr));
        if (cv.width !== W) cv.width = W;
        if (cv.height !== H) cv.height = H;
        const ctx = cv.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, W, H);
        if (lines != null) {
            try { drawSpeedLines(ctx, W, H, lines); } catch (err) { console.warn('[TransitionLayer] speed lines failed:', err?.message); }
        }
    }, [lines]);

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
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', display: fx && fx.lines != null ? 'block' : 'none' }}
            />
        </>
    );
};

export default TransitionLayer;
