import React from 'react';
import { useTranslation } from 'react-i18next';
import { startResizeGesture } from '../../utils/resizeGesture.js';

// Diagonal double-arrow glyph. Drawn once pointing the nw/se diagonal;
// the ne/sw corners reuse it rotated 90 degrees rather than shipping a
// second path.
const ResizeGlyph = ({ rotate }) => (
    <svg
        width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true"
        style={rotate ? { transform: 'rotate(90deg)' } : undefined}
    >
        <path d="M1.5 8.5L8.5 1.5M8.5 1.5H4.5M8.5 1.5V5.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

// Each entry: where the 44x44 touch target sits relative to the clip's own
// box, which resize cursor it shows, and whether the glyph needs the 90deg
// rotation (nesw corners: top-right, bottom-left).
const CORNERS = [
    { key: 'nw', pos: { top: -22, left: -22 },     cursor: 'nwse-resize', rotateGlyph: false },
    { key: 'ne', pos: { top: -22, right: -22 },    cursor: 'nesw-resize', rotateGlyph: true },
    { key: 'sw', pos: { bottom: -22, left: -22 },  cursor: 'nesw-resize', rotateGlyph: true },
    { key: 'se', pos: { bottom: -22, right: -22 }, cursor: 'nwse-resize', rotateGlyph: false },
];

/**
 * Four corner resize handles drawn around a selected clip/sticker/caption on
 * the preview screen (R119). Previously this was a single bottom-right dot
 * plus a two-finger pinch gesture as a second, overlapping way to resize;
 * the request was for resize to happen ONLY by dragging a corner, with a
 * plain click/tap-and-drag (no pinch, no double-click) -- so the pinch path
 * at each call site (BaseClipOverlay.jsx, GraphicOverlay.jsx,
 * TextOverlay.jsx) was removed and this component now renders all four
 * corners instead of just one.
 *
 * All four corners share the exact same gesture (see resizeGesture.js):
 * scale is driven by the pointer's distance from the clip's own centre, not
 * by which corner was grabbed, so no per-corner maths is needed -- only the
 * handle's position and cursor differ.
 */
const ResizeHandle = ({ getElement, scale, onLive, onCommit, onStart, minScale = 0.1, maxScale = 5 }) => {
    const { t } = useTranslation('editor');

    const handlePointerDown = (e) => {
        e.stopPropagation();
        e.preventDefault();
        // Keep the resize gesture attached to this corner even as the element
        // shrinks underneath the pointer. Without capture, the pointer can
        // start targeting the element's move surface mid-drag.
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* window listeners remain a fallback */ }
        onStart?.();
        startResizeGesture(e, {
            initialScale: scale,
            minScale,
            maxScale,
            getCenter: () => {
                const el = typeof getElement === 'function' ? getElement() : null;
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
            },
            onChange: onLive,
            onCommit,
        });
    };

    return (
        <>
            {CORNERS.map(({ key, pos, cursor, rotateGlyph }) => (
                <div
                    key={key}
                    role="slider"
                    aria-label={t('player.resize', 'Resize')}
                    aria-valuenow={Math.round((Number(scale) || 1) * 100)}
                    aria-valuemin={Math.round(minScale * 100)}
                    aria-valuemax={Math.round(maxScale * 100)}
                    title={t('player.resizeHint', 'Drag to resize')}
                    onPointerDown={handlePointerDown}
                    style={{
                        position: 'absolute',
                        ...pos,
                        width: 44,
                        height: 44,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor,
                        touchAction: 'none',
                        pointerEvents: 'auto',
                    }}
                >
                    <div style={{
                        width: 18,
                        height: 18,
                        borderRadius: '50%',
                        background: 'var(--accent, #00E5FF)',
                        border: '2px solid white',
                        boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}>
                        <ResizeGlyph rotate={rotateGlyph} />
                    </div>
                </div>
            ))}
        </>
    );
};

export default ResizeHandle;
