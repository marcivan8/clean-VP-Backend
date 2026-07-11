import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import useTimelineStore from '../../store/useTimelineStore';

// Injected once — keyframes for caption animations
const CAPTION_KEYFRAMES = `
@keyframes vibed-fade-in {
    from { opacity: 0; }
    to   { opacity: 1; }
}
@keyframes vibed-slide-up {
    from { opacity: 0; transform: translateY(18px); }
    to   { opacity: 1; transform: translateY(0); }
}
@keyframes vibed-pop {
    0%   { opacity: 0; transform: scale(0.55); }
    65%  { transform: scale(1.1); }
    100% { opacity: 1; transform: scale(1); }
}
.caption-anim-fade-in  { animation: vibed-fade-in  0.25s ease-out both; }
.caption-anim-slide-up { animation: vibed-slide-up 0.3s  cubic-bezier(.22,.61,.36,1) both; }
.caption-anim-pop      { animation: vibed-pop      0.25s cubic-bezier(.22,.61,.36,1) both; }
.caption-anim-word     { animation: vibed-pop      0.2s  cubic-bezier(.22,.61,.36,1) both; }
`;

const ANIM_CLASS = {
    'none':         '',
    'fade-in':      'caption-anim-fade-in',
    'slide-up':     'caption-anim-slide-up',
    'pop':          'caption-anim-pop',
    'word-by-word': 'caption-anim-word',
};

// Default Vibed caption style (used when no clip style is set)
const DEFAULT_STYLE = {
    fontFamily:  'Anton, sans-serif',
    fontSize:    48,
    fontWeight:  900,
    fontStyle:   'normal',
    color:       '#FACC15',
    textShadow:  '2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 0 3px 6px rgba(0,0,0,0.6)',
    stroke:      { width: 2, color: '#000000' },
    textAlign:   'center',
    animation:   'none',
    textTransform: 'uppercase',
    letterSpacing: '0.02em',
};

const CaptionOverlay = () => {
    const { currentTime, captions, tracks } = useTimelineStore(useShallow(state => ({
        currentTime: state.currentTime,
        captions:    state.captions,
        tracks:      state.tracks,
    })));

    if (!captions || captions.length === 0) return null;

    // Find the active word from word-level timing data
    const activeWord = captions.find(w => currentTime >= w.start && currentTime <= w.end);
    if (!activeWord) return null;

    // Find the text track and the active segment clip by time range
    const textTrack  = tracks?.find(t => t.type === 'text');
    const activeClip = textTrack?.clips.find(c => {
        const s = c.start ?? 0;
        const e = s + (c.duration ?? 0);
        return currentTime >= s && currentTime <= e;
    });

    // Merge clip style over defaults
    const fontFamily   = activeClip?.fontFamily  || DEFAULT_STYLE.fontFamily;
    const fontSize     = activeClip?.fontSize     || DEFAULT_STYLE.fontSize;
    const fontWeight   = activeClip?.fontWeight   || DEFAULT_STYLE.fontWeight;
    const fontStyle    = activeClip?.fontStyle    || DEFAULT_STYLE.fontStyle;
    const color        = activeClip?.color        || DEFAULT_STYLE.color;
    const textShadow   = activeClip?.textShadow   !== undefined ? activeClip.textShadow : DEFAULT_STYLE.textShadow;
    const stroke       = activeClip?.stroke       !== undefined ? activeClip.stroke    : DEFAULT_STYLE.stroke;
    const textAlign    = activeClip?.textAlign    || DEFAULT_STYLE.textAlign;
    const animation    = activeClip?.animation    || DEFAULT_STYLE.animation;
    const textTransform = 'uppercase';
    const letterSpacing = '0.02em';

    const animClass    = ANIM_CLASS[animation] || '';
    const strokeCss    = stroke ? `${stroke.width}px ${stroke.color}` : 'none';

    return (
        <>
            <style>{CAPTION_KEYFRAMES}</style>
            <div
                className="absolute bottom-16 left-0 right-0 flex justify-center items-end pointer-events-none z-20"
                style={{ padding: '0 24px' }}
            >
                <div style={{ textAlign, width: '100%', maxWidth: 900, margin: '0 auto' }}>
                    <span
                        key={activeWord.word + activeWord.start}
                        className={animClass}
                        style={{
                            display:          'inline-block',
                            fontFamily,
                            fontSize:         `${fontSize}px`,
                            fontWeight,
                            fontStyle,
                            color,
                            textShadow:       textShadow || 'none',
                            WebkitTextStroke: strokeCss,
                            textTransform,
                            letterSpacing,
                            lineHeight:       1.1,
                            padding:          '0 4px',
                        }}
                    >
                        {activeWord.word}
                    </span>
                </div>
            </div>
        </>
    );
};

export default CaptionOverlay;
