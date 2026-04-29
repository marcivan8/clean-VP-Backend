import React, { useRef, useState, useEffect } from 'react';
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

    // Connect to store
    const { currentTime, isPlaying, tracks, assets, seek, setIsPlaying } = useTimelineStore();

    // Determine Active Clip for Rendering & Logic
    const videoTrack = tracks.find(t => t.type === 'video');
    const activeClip = videoTrack?.clips.find(
        clip => currentTime >= clip.start - 0.001 && currentTime < clip.start + clip.duration + 0.001
    );

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
            if (asset?.proxyUrl) {
                console.log(`[VideoPlayer] Using Proxy: ${asset.proxyUrl}`);
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
        }

    }, [isPlaying, currentTime, tracks, assets, activeClip]);

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
                    }

                    if (mediaUrl) {
                        engineRef.current.loadAudioTrack(clip.id, mediaUrl);
                    }
                });
            }
        });

        // Pass Full Track Metadata to Engine for Fades/Effects Logic
        engineRef.current.updateTrackMetadata(tracks);

    }, [tracks, assets]); // Run when tracks/assets change

    // Sync Seek (One-way: Store -> Engine)
    // We need to detect if Seek happened. Compare internal engine time vs store time?
    // Or assume store update implies seek if |delta| > small?
    useEffect(() => {
        if (!engineRef.current) return;

        const engineTime = engineRef.current.lastFrameRendered || engineRef.current.clock.getCurrentTime();
        // Lower threshold for better scrubbing responsiveness (e.g. 100ms)
        if (Math.abs(currentTime - engineTime) > 0.1) {
            engineRef.current.seek(currentTime);
        }
    }, [currentTime]);

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
    return (
        <div
            ref={containerRef}
            className="relative w-full h-full flex items-center justify-center bg-black overflow-hidden"
            style={{ aspectRatio: dynamicRatio }}
        >
            {/* The Custom Rendering Surface */}
            <canvas
                ref={canvasRef}
                className="transition-all duration-300"
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
        </div>
    );
};

export default VideoPlayer;
