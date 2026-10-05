import React from 'react';
import { useTranslation } from 'react-i18next';
import { startRotationGesture } from '../../utils/rotationGesture.js';

/**
 * Rotate handle drawn at the top-right corner of a selected caption or
 * sticker (the resize handle owns the bottom-right). 44×44 touch target,
 * small visual dot, same visual language as the resize handle.
 *
 * Shift snaps to 15°; without Shift the angle sticks to 0/±90/180 when close.
 */
const RotateHandle = ({ getElement, rotation, onLive, onCommit, onStart }) => {
    const { t } = useTranslation('editor');

    const handlePointerDown = (e) => {
        e.stopPropagation();
        e.preventDefault();
        onStart?.();
        startRotationGesture(e, {
            initialRotation: rotation,
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
            aria-label={t('player.rotate', 'Rotate')}
            aria-valuenow={Math.round(Number(rotation) || 0)}
            aria-valuemin={-180}
            aria-valuemax={180}
            title={t('player.rotateHint', 'Drag to rotate (Shift: 15° steps)')}
            onPointerDown={handlePointerDown}
            style={{
                position: 'absolute',
                top: -22,
                right: -22,
                width: 44,
                height: 44,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'grab',
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
                    <path d="M8.5 5A3.5 3.5 0 1 1 5 1.5h2" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                    <path d="M6 0.3L7.4 1.5L6 2.7" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
            </div>
        </div>
    );
};

export default RotateHandle;
