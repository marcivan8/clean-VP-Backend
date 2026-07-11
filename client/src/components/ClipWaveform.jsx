/**
 * ClipWaveform.jsx
 *
 * A WaveSurfer.js-based waveform renderer for timeline clips.
 * Designed to be absolutely positioned inside a clip div as a passive overlay:
 *   - interact: false  — timeline controls playback, not this component
 *   - pointer-events: none on the wrapper — drag/resize/selection pass through
 *
 * Props:
 *   audioUrl  {string}   URL of the audio/video source (for media element reference)
 *   peaks     {number[]} Pre-computed peaks array (0-1 floats, 50/sec)
 *   duration  {number}   Source duration in seconds (required when peaks are supplied)
 *   height    {number}   Canvas height in px (default 40)
 *   color     {string}   Waveform bar colour (default semi-transparent white)
 *   loading   {boolean}  Show skeleton placeholder while peaks are loading
 */

import React, { useEffect, useRef } from 'react';
import WaveSurfer from 'wavesurfer.js';

const ClipWaveform = ({
    audioUrl,
    peaks,
    duration,
    height   = 40,
    color    = 'rgba(255,255,255,0.5)',
    loading  = false,
}) => {
    const containerRef = useRef(null);
    const wsRef        = useRef(null);

    // ── Create / recreate WaveSurfer when audioUrl or color changes ───────────
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        // Destroy previous instance before creating a new one
        if (wsRef.current) {
            try { wsRef.current.destroy(); } catch (_) {}
            wsRef.current = null;
        }

        // Need at least an audio source to initialise
        if (!audioUrl && !peaks) return;

        const ws = WaveSurfer.create({
            container:     el,
            waveColor:     color,
            progressColor: 'transparent',
            cursorColor:   'transparent',
            cursorWidth:   0,
            interact:      false,   // clicks / drags on the waveform do nothing
            normalize:     true,
            barWidth:      2,
            barGap:        1,
            barRadius:     2,
            height,
            fillParent:    true,    // stretches to container CSS width automatically
            backend:       'MediaElement',
        });

        wsRef.current = ws;

        // Load with pre-computed peaks when available — no audio decoding needed.
        // WaveSurfer still needs a URL for its internal <audio> element but it
        // won't fetch/decode the file when channelData is provided.
        if (peaks && peaks.length > 0 && audioUrl) {
            ws.load(audioUrl, [peaks], duration ?? undefined);
        } else if (audioUrl) {
            // Fallback: let WaveSurfer decode from the URL (slower, but works)
            ws.load(audioUrl);
        }

        return () => {
            try { ws.destroy(); } catch (_) {}
            wsRef.current = null;
        };
    // Recreate if the source or colour changes; height is intentionally stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [audioUrl, color]);

    // ── Re-draw peaks when they arrive (peaks may load after WaveSurfer init) ─
    useEffect(() => {
        const ws = wsRef.current;
        if (!ws || !peaks || !peaks.length || !audioUrl) return;
        try {
            // Re-load with peaks into the existing instance to avoid full recreate
            ws.load(audioUrl, [peaks], duration ?? undefined);
        } catch (_) {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [peaks]);

    // ─────────────────────────────────────────────────────────────────────────
    return (
        <div
            style={{
                width:         '100%',
                height:        `${height}px`,
                pointerEvents: 'none',   // never intercept clip drag / resize / select
                overflow:      'hidden',
                position:      'relative',
            }}
        >
            {/* Skeleton pulse shown while peaks are in flight */}
            {loading && !peaks && (
                <div
                    style={{
                        position:     'absolute',
                        inset:        0,
                        background:   'rgba(255,255,255,0.06)',
                        borderRadius: 2,
                        animation:    'pulse 1.4s ease-in-out infinite',
                    }}
                />
            )}

            {/* WaveSurfer mounts its canvas here */}
            <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
        </div>
    );
};

export default ClipWaveform;
