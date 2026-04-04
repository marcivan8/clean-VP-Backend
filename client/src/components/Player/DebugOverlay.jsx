import React, { useEffect, useState, useRef } from 'react';
import useTimelineStore from '../../store/useTimelineStore';

/**
 * DebugOverlay.jsx
 * Real-time diagnostic overlay for the PlaybackEngine.
 * Shows buffer health, clock time, drift, and FPS.
 * 
 * MANDATORY for production debugging. If these metrics show:
 * - Audio buffer = 0 → Audio underrun
 * - Clock not advancing → Engine stalled
 * - Frame timestamps not increasing → Video freeze
 */
const DebugOverlay = ({ visible = true }) => {
    const [stats, setStats] = useState({
        audioBufferMs: 0,
        videoFramesQueued: 0,
        state: 'IDLE',
        clockTime: 0,
        isPlaying: false,
        fps: 0,
        drift: 0
    });

    const fpsRef = useRef({ frameCount: 0, lastTime: performance.now() });
    const lastClockRef = useRef(0);

    useEffect(() => {
        if (!visible) return;

        let rafId;

        const updateStats = () => {
            const engine = useTimelineStore.getState().playbackEngine;

            if (engine && typeof engine.getBufferStats === 'function') {
                const bufferStats = engine.getBufferStats();

                // Calculate FPS
                fpsRef.current.frameCount++;
                const now = performance.now();
                const elapsed = now - fpsRef.current.lastTime;

                let fps = stats.fps;
                if (elapsed >= 1000) {
                    fps = Math.round((fpsRef.current.frameCount * 1000) / elapsed);
                    fpsRef.current.frameCount = 0;
                    fpsRef.current.lastTime = now;
                }

                // Calculate drift (how much behind video is from audio)
                // Drift = expected frame time - actual rendered frame time
                const drift = engine.lastFrameRendered !== null
                    ? Math.round((bufferStats.clockTime - engine.lastFrameRendered) * 1000)
                    : 0;

                setStats({
                    ...bufferStats,
                    fps,
                    drift
                });

                lastClockRef.current = bufferStats.clockTime;
            }

            rafId = requestAnimationFrame(updateStats);
        };

        rafId = requestAnimationFrame(updateStats);

        return () => {
            if (rafId) cancelAnimationFrame(rafId);
        };
    }, [visible]);

    if (!visible) return null;

    // Color coding for health indicators
    const getAudioColor = () => {
        if (stats.audioBufferMs > 300) return '#22c55e'; // Green - healthy
        if (stats.audioBufferMs > 100) return '#eab308'; // Yellow - warning
        return '#ef4444'; // Red - critical
    };

    const getVideoColor = () => {
        if (stats.videoFramesQueued > 3) return '#22c55e';
        if (stats.videoFramesQueued > 0) return '#eab308'; // warning
        return '#ef4444';
    };

    const getDriftColor = () => {
        const absDrift = Math.abs(stats.drift);
        if (absDrift < 20) return '#22c55e'; // <20ms = good
        if (absDrift < 50) return '#eab308'; // 20-50ms = warning
        return '#ef4444'; // >50ms = bad
    };

    const stateColors = {
        IDLE: '#6b7280',
        PRELOADING: '#3b82f6',
        READY: '#22c55e',
        PLAYING: '#22c55e',
        PAUSED: '#eab308',
        ERROR: '#ef4444'
    };

    return (
        <div style={{
            position: 'absolute',
            top: 8,
            left: 8,
            background: 'rgba(0, 0, 0, 0.75)',
            color: '#fff',
            padding: '8px 12px',
            borderRadius: 6,
            fontFamily: 'monospace',
            fontSize: 11,
            lineHeight: 1.6,
            zIndex: 1000,
            pointerEvents: 'none',
            minWidth: 180
        }}>
            <div style={{ marginBottom: 4, fontWeight: 'bold', color: '#a78bfa' }}>
                🎬 Engine Debug
            </div>

            {/* State */}
            <div>
                State: <span style={{ color: stateColors[stats.state] || '#fff' }}>{stats.state}</span>
            </div>

            {/* Clock Time */}
            <div>
                Clock: <span style={{ color: '#60a5fa' }}>{stats.clockTime.toFixed(2)}s</span>
            </div>

            {/* Audio Buffer */}
            <div>
                Audio: <span style={{ color: getAudioColor() }}>{Math.round(stats.audioBufferMs)}ms</span>
            </div>

            {/* Video Buffer */}
            <div>
                Video: <span style={{ color: getVideoColor() }}>{stats.videoFramesQueued} frames</span>
            </div>

            {/* Drift */}
            <div>
                Drift: <span style={{ color: getDriftColor() }}>{stats.drift}ms</span>
            </div>

            {/* FPS */}
            <div>
                FPS: <span style={{ color: stats.fps >= 25 ? '#22c55e' : '#ef4444' }}>{stats.fps}</span>
            </div>
        </div>
    );
};

export default DebugOverlay;
