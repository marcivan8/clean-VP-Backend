import React, { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from './LandingIcons';
import { captureEvent } from '../../lib/posthog';

const SRC = '/video/vibed-how-it-works.mp4';
const POSTER = '/video/vibed-how-it-works-poster.jpg';

/**
 * Full-screen player for the product walkthrough.
 *
 * The film has no soundtrack, so it starts muted and autoplays: browsers block
 * autoplay with sound, and a silent film that needs a second click to start is
 * just friction. The caption says so, otherwise people hunt for the volume.
 */
const VideoModal = ({ onClose }) => {
    const { t } = useTranslation('landing');
    const videoRef = useRef(null);
    const closeRef = useRef(null);
    const furthest = useRef(0);

    const close = useCallback(() => {
        const v = videoRef.current;
        if (v) {
            captureEvent('landing_video_close', {
                watched_seconds: Math.round(furthest.current),
                duration: Math.round(v.duration || 0),
            });
            v.pause();
        }
        onClose();
    }, [onClose]);

    useEffect(() => {
        captureEvent('landing_video_open', { video: 'how_it_works' });

        const onKey = (e) => { if (e.key === 'Escape') close(); };
        document.addEventListener('keydown', onKey);

        // keep the page behind from scrolling under the overlay
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        closeRef.current?.focus();
        videoRef.current?.play?.().catch(() => { /* autoplay refused; controls are there */ });

        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = prev;
        };
    }, [close]);

    const onTime = (e) => {
        furthest.current = Math.max(furthest.current, e.target.currentTime);
    };

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label={t('v2.video.title')}
            onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
            style={{
                position: 'fixed', inset: 0, zIndex: 120,
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                padding: '40px 24px',
                background: 'rgba(3, 5, 8, 0.88)',
                backdropFilter: 'blur(14px)',
                animation: 'vlFadeIn 220ms ease both',
            }}
        >
            <div style={{
                width: '100%', maxWidth: 1180, display: 'flex',
                alignItems: 'baseline', justifyContent: 'space-between',
                gap: 20, marginBottom: 16,
            }}>
                <h2 style={{
                    fontFamily: 'var(--vl-display)', fontWeight: 800, fontSize: 21,
                    color: 'var(--vl-ink)', margin: 0,
                }}>{t('v2.video.title')}</h2>

                <button
                    ref={closeRef}
                    type="button"
                    onClick={close}
                    aria-label={t('v2.video.close')}
                    style={{
                        flex: 'none', width: 40, height: 40, borderRadius: 999, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.16)',
                        color: 'var(--vl-ink)',
                    }}
                >
                    <Icon name="close" size={18} />
                </button>
            </div>

            <video
                ref={videoRef}
                src={SRC}
                poster={POSTER}
                controls
                muted
                playsInline
                preload="metadata"
                onTimeUpdate={onTime}
                onEnded={() => captureEvent('landing_video_complete', { video: 'how_it_works' })}
                style={{
                    width: '100%', maxWidth: 1180, maxHeight: '72vh',
                    aspectRatio: '16 / 9', borderRadius: 16, display: 'block',
                    background: '#05070B', border: '1px solid rgba(255,255,255,0.14)',
                    boxShadow: '0 50px 100px -30px rgba(0,0,0,0.9)',
                }}
            />

            <p className="vl-mono" style={{
                maxWidth: 1180, width: '100%', margin: '14px 0 0',
                fontSize: 12.5, color: 'var(--vl-ink-4)',
            }}>{t('v2.video.note')}</p>
        </div>
    );
};

export default VideoModal;
