import React from 'react';
import { useTranslation } from 'react-i18next';
import { startResizeGesture } from '../../utils/resizeGesture.js';

/**
 * Resize handle drawn at the bottom-right corner of a selected clip (the
 * rotate handle owns the top-right — see RotateHandle.jsx's own header
 * comment). 44×44 touch target, same visual language as the rotate handle.
 *
 * A mouse/touch-friendly, discoverable alternative to the existing
 * two-finger pinch gesture — both write the same `clip.scale` field, anchored
 * on the clip's own centre, so dragging this corner never moves clip.x/y.
 */
const ResizeHandle = ({ getElement, scale, onLive, onCommit, onStart, minScale = 0.1, maxScale = 5 }) => {
    const { t } = useTranslation('editor');

    const handlePointerDown = (e) => {
        e.stopPropagation();
        e.preventDefault();
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
        <div
            role="slider"
            aria-label={t('player.resize', 'Resize')}
            aria-valuenow={Math.round((Number(scale) || 1) * 100)}
            aria-valuemin={Math.round(minScale * 100)}
            aria-valuemax={Math.round(maxScale * 100)}
            title={t('player.resizeHint', 'Drag to resize')}
            onPointerDown={handlePointerDown}
            style={{
                position: 'absolute',
                bottom: -22,
                right: -22,
                width: 44,
                height: 44,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'nwse-resize',
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
                <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                    <path d="M1.5 8.5L8.5 1.5M8.5 1.5H4.5M8.5 1.5V5.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
            </div>
        </div>
    );
};

export default ResizeHandle;
