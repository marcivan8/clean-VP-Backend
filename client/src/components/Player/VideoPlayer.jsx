import React, { useRef, useState, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import useTimelineStore from '../../store/useTimelineStore';
import CaptionOverlay from './CaptionOverlay';
import TextOverlay from './TextOverlay';
import FatigueAlert from './FatigueAlert';
import DebugOverlay from './DebugOverlay';
import PlaybackEngine from '../../engine/PlaybackEngine';

const VideoPlayer = () => {
    const canvasRef = useRef(null);
    const containerRef = useRef(null); // Added containerRef
    const engineRef = useRef(null); // Persist engine instance
    // Track previous time/playState to detect whether seek() is actually needed.
    // Property-only changes (x, y, scale, rotation, grading) update avTracks/activeClip
    // but don't need a new video decode — renderOnce() is enough.
    const prevTimeRef = useRef(null);
    const prevIsPlayingRef = useRef(null);

    // Connect to store
    // NOTE: we subscribe to the full `tracks` array for clip lookups, but use
    // a derived `avTracks` (audio+video only) as the dep for effects that talk
    // to the playback engine.  This prevents text-clip position/style changes
    // from triggering seek() / renderOnce() on every slider pixel.
    const { currentTime, isPlaying, tracks, assets, seek, setIsPlaying } = useTimelineStore(useShallow(state => ({
        currentTime:  state.currentTime,
        isPlaying:    state.isPlaying,
        tracks:       state.tracks,
        assets:       state.assets,
        seek:         state.seek,
        setIsPlaying: state.setIsPlaying,
    })));

    // avTracks: only audio/video tracks — used as effect dependencies so that
    // text-clip style/position changes don't trigger engine seek() / renderOnce().
    const avTracks = React.useMemo(
        () => tracks.filter(t => t.type === 'video' || t.type === 'audio'),
        [tracks]
    );

    // Determine Active Clip for Rendering & Logic
    // Search ALL video tracks — after split-speakers there are 2 (one per speaker).
    const videoTracks = avTracks.filter(t => t.type === 'video');
    const videoTrack = videoTracks[0]; // legacy compat for single-track code paths
    const activeClip = videoTracks
        .flatMap(t => t.clips)
        .find(clip => currentTime >= clip.start - 0.001 && currentTime < clip.start + clip.duration + 0.001);

    // activeClipForEngine: stable reference that only changes when properties the
    // engine actually cares about change. x / y / scale / rotation are pure CSS
    // transforms applied to the canvas element — they never need a seek() or
    // renderOnce(). Excluding them prevents quality-degrading re-decodes and the
    // "cursor jumps to end of clip" bug caused by onTick firing inside renderOnce().
    const activeClipForEngine = React.useMemo(() => {
        if (!activeClip) return null;
        return {
            id:         activeClip.id,
            assetId:    activeClip.assetId,
            url:        activeClip.url,
            grading:    activeClip.grading,
            volume:     activeClip.volume,
            virtualCam: activeClip.virtualCam,
            start:      activeClip.start,
            duration:   activeClip.duration,
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        activeClip?.id, activeClip?.assetId, activeClip?.url,
        activeClip?.grading, activeClip?.volume, activeClip?.virtualCam,
        activeClip?.start, activeClip?.duration,
    ]);

    // Initialize Engine
    useEffect(() => {
        if (!canvasRef.current) return;

        // Create Engine
        engineRef.current = new PlaybackEngine(canvasRef.current, {
            onTick: (time) => {
                // Determine if we should update store
                // Optimally we don't spam the store with every tick unless UI needs it (scrubber)
                // For now, let's keep it minimal or use a ref-synced store updater if needed.
                useTimelineStore.getState().seek(time);
            },
            onAudioLevels: (levels) => {
                useTimelineStore.getState().setAudioLevels(levels);
            },
            onWaveformUpdate: (peaks, timestamp, duration, trackId) => {
                useTimelineStore.getState().addWaveform(trackId, peaks, duration);
            },
            onMetadata: (videoWidth, videoHeight) => {
                // Sync canvas internal resolution to video's native dimensions
                if (canvasRef.current) {
                    canvasRef.current.width = videoWidth;
                    canvasRef.current.height = videoHeight;
                }
                // Update store so Timeline and Engine know the true dimensions
                useTimelineStore.setState({ videoWidth, videoHeight });
                console.log(`[VideoPlayer] Video metadata: ${videoWidth}x${videoHeight}`);
            }
        });

        // Expose Engine to Store (for Direct Access from UI controls like Play Button)
        useTimelineStore.setState({ playbackEngine: engineRef.current });

        return () => {
            useTimelineStore.setState({ playbackEngine: null });
            if (engineRef.current) engineRef.current.destroy(); // Assuming destroy exists, or let GC handle
        };
    }, []);

    // Sync Play/Pause
    useEffect(() => {
        if (!engineRef.current) return;

        // Find active clip URL if available
        // (activeClip is now derived in component scope)

        // Resolve URL from assets
        // Resolve URL from assets
        let mediaUrl = activeClip?.url;
        if (!mediaUrl && activeClip?.assetId) {
            const asset = assets.find(a => a.id === activeClip.assetId);
            // Prefer proxy for playback if available
            mediaUrl = asset?.proxyUrl || asset?.url;
            if (mediaUrl && (mediaUrl.startsWith('proxies/') || mediaUrl.startsWith('raw/'))) {
                mediaUrl = `/api/proxy/gcs-media/${mediaUrl}`;
            }
            if (asset?.proxyUrl) {
                console.log(`[VideoPlayer] Using Proxy: ${mediaUrl}`);
            }
        }

        // --- URL Sync Fix for Paused State ---
        // If the clip changes (e.g. Undo/Redo) while paused, we must tell the engine
        // to load the new URL, otherwise it holds onto the old one (or none).
        if (mediaUrl && engineRef.current.currentUrl !== mediaUrl) {
            // If playing, play() handles it below. But if paused, we must explicit load.
            if (!isPlaying) {
                engineRef.current.load(mediaUrl);
                // Force a seek to refresh the frame (since load() sends START_GENERATING frame 0?)
                // Actually load() triggers START_GENERATING with currentTime.
                // So the frame should arrive.
            }
        } else if (!mediaUrl) {
            // No active clip, clear the canvas
            engineRef.current.clearCanvas();
        }

        if (isPlaying) {
            if (activeClip) {
                console.log('[VideoPlayer] Active Clip:', mediaUrl);
                engineRef.current.play(mediaUrl);
                // Initial Grading & Volume
                if (activeClip.grading) {
                    engineRef.current.setGrading({
                        brightness: activeClip.grading.brightness,
                        contrast: activeClip.grading.contrast,
                        saturate: activeClip.grading.saturate,
                        hueRotate: activeClip.grading.hueRotate,
                        selective: activeClip.grading.selective
                    });
                } else {
                    engineRef.current.setGrading({});
                }
                // Set Volume
                engineRef.current.setMasterVolume(activeClip.volume !== undefined ? activeClip.volume : 1.0);
                // Virtual multicam crop — apply the stored crop region if present
                if (activeClip.virtualCam) {
                    const { cropX = 0, cropY = 0, cropW = 1, cropH = 1 } = activeClip.virtualCam;
                    engineRef.current.setCrop(cropX, cropY, cropW, cropH);
                } else {
                    engineRef.current.setCrop(0, 0, 1, 1); // full frame
                }
            } else {
                console.warn('[VideoPlayer] Playing without Active Clip URL');
                engineRef.current.resumeAudio();
                engineRef.current.play(); // May fail if no URL cached
            }
        } else {
            engineRef.current.pause();
        }

        // Sync Grading & Volume (Real-time updates)
        if (engineRef.current) {
            // Update Grading Real-time
            if (activeClip && activeClip.grading) {
                engineRef.current.setGrading({
                    brightness: activeClip.grading.brightness,
                    contrast: activeClip.grading.contrast,
                    saturate: activeClip.grading.saturate,
                    hueRotate: activeClip.grading.hueRotate,
                    selective: activeClip.grading.selective
                });
            } else {
                engineRef.current.setGrading({ brightness: 100, contrast: 100, saturate: 100, hueRotate: 0 });
            }
            // Update Volume Real-time
            if (activeClip) {
                engineRef.current.setMasterVolume(activeClip.volume !== undefined ? activeClip.volume : 1.0);
            }
            // Sync virtual multicam crop in real-time (handles clip changes while paused)
            if (activeClip?.virtualCam) {
                const { cropX = 0, cropY = 0, cropW = 1, cropH = 1 } = activeClip.virtualCam;
                engineRef.current.setCrop(cropX, cropY, cropW, cropH);
            } else if (engineRef.current.setCrop) {
                engineRef.current.setCrop(0, 0, 1, 1);
            }

            // When paused the RAF loop stops, so setCrop() above updates cropParams but
            // nothing re-renders the canvas.  Trigger a one-shot frame render here —
            // AFTER setCrop — so the crop uniforms are already correct when the frame
            // arrives from the worker and is drawn.
            if (!isPlaying && typeof engineRef.current.renderOnce === 'function') {
                engineRef.current.renderOnce();
                // seek() flushes stale buffered frames and asks the worker for a fresh
                // one — but it also forces expensive video frame decoding.  Only call it
                // when the current time or play state actually changed.  Property-only
                // updates (x, y, scale, rotation, grading) change avTracks/activeClip
                // references but don't need a new frame decode; renderOnce() is enough.
                const timeChanged = prevTimeRef.current !== currentTime;
                const playChanged = prevIsPlayingRef.current !== isPlaying;
                if ((timeChanged || playChanged) && typeof engineRef.current.seek === 'function') {
                    engineRef.current.seek(currentTime);
                }
            }
        }
        prevTimeRef.current = currentTime;
        prevIsPlayingRef.current = isPlaying;

    }, [isPlaying, currentTime, avTracks, assets, activeClipForEngine]);

    // --- Audio Track Loader & Sync ---
    useEffect(() => {
        if (!engineRef.current) return;

        // Iterate all tracks to find audio/video clips
        tracks.forEach(track => {
            // Update Track Mixer State
            if (track.type === 'audio' || track.type === 'video') {
                engineRef.current.setTrackVolume(track.id, track.volume);
                engineRef.current.setMute(track.id, track.muted);
                engineRef.current.setSolo(track.id, track.solo);

                track.clips.forEach(clip => {
                    // Load if new
                    let mediaUrl = clip.url;
                    if (!mediaUrl && clip.assetId) {
                        const asset = assets.find(a => a.id === clip.assetId);
                        mediaUrl = asset?.url;
                        if (mediaUrl && (mediaUrl.startsWith('proxies/') || mediaUrl.startsWith('raw/'))) {
                            mediaUrl = `/api/proxy/gcs-media/${mediaUrl}`;
                        }
                    }

                    if (mediaUrl) {
                        engineRef.current.loadAudioTrack(clip.id, mediaUrl);
                    }
                });
            }
        });

        // Pass Full Track Metadata to Engine for Fades/Effects Logic
        engineRef.current.updateTrackMetadata(tracks); // pass full tracks for audio mixing

    }, [avTracks, assets]); // avTracks: only re-run when video/audio tracks change

    // --- Resize Observer with Quality Scaling ---
    useEffect(() => {
        if (!containerRef.current || !canvasRef.current || !engineRef.current) return;

        const handleResize = () => {
            if (!containerRef.current) return;
            const { width, height } = containerRef.current.getBoundingClientRect();

            // Apply scale based on quality
            const quality = useTimelineStore.getState().previewQuality;
            const scale = quality === 'low' ? 0.5 : 1.0;

            // Set canvas internal resolution
            const targetWidth = Math.floor(width * scale);
            const targetHeight = Math.floor(height * scale);

            // Only update if changed to avoid thrashing
            if (canvasRef.current.width !== targetWidth || canvasRef.current.height !== targetHeight) {
                canvasRef.current.width = targetWidth;
                canvasRef.current.height = targetHeight;
                engineRef.current.resize(targetWidth, targetHeight);
                console.log(`[VideoPlayer] Resized to ${targetWidth}x${targetHeight} (${quality})`);

                // Force repaint if paused, because resize clears the WebGL buffer
                if (!useTimelineStore.getState().isPlaying) {
                    const t = useTimelineStore.getState().currentTime;
                    engineRef.current.seek(t);
                }
            }
        };

        const observer = new ResizeObserver(handleResize);
        observer.observe(containerRef.current);

        // Also listen to quality changes (via store subscription or eff dependency)
        // Since we are inside useEffect with empty deps, we need a way to trigger this.
        // We will add a separate effect for quality tracking or `useTimelineStore` subscription.

        handleResize(); // Initial

        return () => observer.disconnect();
    }, []);

    // Effect to monitor Quality Change specifically
    const previewQuality = useTimelineStore(state => state.previewQuality);
    useEffect(() => {
        if (!containerRef.current || !engineRef.current || !canvasRef.current) return;

        // 1. Tell Engine to update Worker quality (Downscaling pipeline)
        engineRef.current.setQuality(previewQuality);

        // 2. Adjust Canvas Resolution (Fragment shader load)
        const { width, height } = containerRef.current.getBoundingClientRect();
        const scale = previewQuality === 'low' ? 0.5 : 1.0;
        const targetWidth = Math.floor(width * scale);
        const targetHeight = Math.floor(height * scale);

        if (canvasRef.current.width !== targetWidth || canvasRef.current.height !== targetHeight) {
            canvasRef.current.width = targetWidth;
            canvasRef.current.height = targetHeight;
            engineRef.current.resize(targetWidth, targetHeight);
            console.log(`[VideoPlayer] Quality changed to ${previewQuality}, resized to ${targetWidth}x${targetHeight}`);

            // Repaint if paused
            if (!useTimelineStore.getState().isPlaying) {
                const t = useTimelineStore.getState().currentTime;
                engineRef.current.seek(t);
            }
        }
    }, [previewQuality]);

    // Show debug overlay in development only
    const showDebug = import.meta.env.DEV;

    // Pull global project aspect ratio so the container matches the layout perfectly
    const aspectRatio = useTimelineStore(state => state.aspectRatio);
    
    const getPlayerRatioString = (ratio) => {
        switch (ratio) {
            case '9:16': return '1080 / 1920';
            case '1:1': return '1 / 1';
            case '4:3': return '4 / 3';
            case '4:5': return '4 / 5';
            case '21:9': return '21 / 9';
            case '16:9':
            default: return '16 / 9';
        }
    };
    const dynamicRatio = getPlayerRatioString(aspectRatio);

    // --- Interpolate Keyframes for Smart Zoom ---
    let transformStyle = '';
    // For talking-head content (portrait or standard interview framing) scale from the
    // upper-center third so the speaker's face stays in frame rather than the bottom
    // of the frame drifting in. Landscape B-roll keeps the default center-center anchor.
    const contentType = useTimelineStore(state => state.contentAnalysis?.contentType);
    const isTalkingHead = ['long_form_raw', 'podcast', 'interview', 'youtube_long'].includes(contentType);
    const transformOrigin = isTalkingHead ? '50% 28%' : 'center center';

    if (activeClip && activeClip.keyframes) {
        const localTime = currentTime - activeClip.start;
        const kf = activeClip.keyframes;

        const interpolate = (propKeyframes, defaultVal) => {
            if (!propKeyframes || propKeyframes.length === 0) return defaultVal;
            if (propKeyframes.length === 1) return propKeyframes[0].value;

            // Find surrounding keyframes
            let k1 = propKeyframes[0];
            let k2 = propKeyframes[propKeyframes.length - 1];

            for (let i = 0; i < propKeyframes.length - 1; i++) {
                if (localTime >= propKeyframes[i].time && localTime <= propKeyframes[i+1].time) {
                    k1 = propKeyframes[i];
                    k2 = propKeyframes[i+1];
                    break;
                }
            }

            if (localTime <= k1.time) return k1.value;
            if (localTime >= k2.time) return k2.value;

            const progress = (localTime - k1.time) / (k2.time - k1.time);

            // Simple easeOutCubic approximation if requested
            let eased = progress;
            if (k2.easing === 'easeOutCubic') {
                eased = 1 - Math.pow(1 - progress, 3);
            }

            return k1.value + (k2.value - k1.value) * eased;
        };

        const scale = interpolate(kf.scale, 1.0);
        const x = interpolate(kf.x, 0);
        const y = interpolate(kf.y, 0);
        const rotation = interpolate(kf.rotation, 0);

        if (scale !== 1.0 || x !== 0 || y !== 0 || rotation !== 0) {
            transformStyle = `translate(${x}px, ${y}px) scale(${scale}) rotate(${rotation}deg)`;
        }
    } else if (activeClip) {
        // No keyframes — read direct clip properties set by the Transform tab
        const scale = activeClip.scale ?? 1.0;
        const x = activeClip.x ?? 0;
        const y = activeClip.y ?? 0;
        const rotation = activeClip.rotation ?? 0;
        if (scale !== 1.0 || x !== 0 || y !== 0 || rotation !== 0) {
            transformStyle = `translate(${x}px, ${y}px) scale(${scale}) rotate(${rotation}deg)`;
        }
    }

    return (
        <div
            ref={containerRef}
            className="relative w-full h-full flex items-center justify-center bg-black overflow-hidden"
            style={{ aspectRatio: dynamicRatio }}
        >
            {/* The Custom Rendering Surface */}
            <canvas
                ref={canvasRef}
                className="transition-transform duration-75"
                style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    transform: transformStyle,
                    transformOrigin,
                }}
            />
        </div>
    );
};

export default VideoPlayer;
