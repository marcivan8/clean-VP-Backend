import React, { useRef, useState, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import useTimelineStore from '../../store/useTimelineStore';
import CaptionOverlay from './CaptionOverlay';
import TextOverlay from './TextOverlay';
import FatigueAlert from './FatigueAlert';
import DebugOverlay from './DebugOverlay';
import PlaybackEngine from '../../engine/PlaybackEngine';

/**
 * Interpolates a keyframe track at `localTime` (clip-local seconds).
 * Shared by the CSS-transform block (plain zoom-rhythm, no multicam) and the
 * crop-composition effect (zoom-rhythm ON TOP of a virtual-multicam crop) so
 * both use identical easing — see the "compose, don't stack" note on
 * computeComposedCrop below.
 */
function interpolateKeyframes(propKeyframes, defaultVal, localTime) {
    if (!propKeyframes || propKeyframes.length === 0) return defaultVal;
    if (propKeyframes.length === 1) return propKeyframes[0].value;

    let k1 = propKeyframes[0];
    let k2 = propKeyframes[propKeyframes.length - 1];
    for (let i = 0; i < propKeyframes.length - 1; i++) {
        if (localTime >= propKeyframes[i].time && localTime <= propKeyframes[i + 1].time) {
            k1 = propKeyframes[i];
            k2 = propKeyframes[i + 1];
            break;
        }
    }
    if (localTime <= k1.time) return k1.value;
    if (localTime >= k2.time) return k2.value;

    const progress = (localTime - k1.time) / (k2.time - k1.time);
    const eased = k2.easing === 'easeOutCubic' ? 1 - Math.pow(1 - progress, 3) : progress;
    return k1.value + (k2.value - k1.value) * eased;
}

/**
 * Composes a virtual-multicam crop with a zoom-rhythm scale keyframe track
 * into ONE effective crop rectangle, instead of stacking the multicam crop
 * (WebGL UV sub-region) and the rhythm zoom (CSS transform scale) as two
 * independent transforms — which is what used to happen, and which silently
 * over-zoomed/cropped-out faces whenever both effects landed on the same clip
 * (see CLAUDE.md R16).
 *
 * The rhythm scale is applied WITHIN the multicam window, re-centered on the
 * SAME point the multicam angle detected (not frame-center) — so a punch-in
 * on a close-up shot zooms further into that same close-up.
 *
 * @param {{cropX:number,cropY:number,cropW:number,cropH:number}} baseCrop
 * @param {number} extraScale  — interpolated keyframe scale (1.0 = no extra zoom)
 * @returns {{cropX:number,cropY:number,cropW:number,cropH:number}}
 */
function composeCropWithZoom(baseCrop, extraScale) {
    if (!extraScale || extraScale <= 1.0001) return baseCrop;
    const cx = baseCrop.cropX + baseCrop.cropW / 2;
    const cy = baseCrop.cropY + baseCrop.cropH / 2;
    const w  = baseCrop.cropW / extraScale;
    const h  = baseCrop.cropH / extraScale;
    return {
        cropX: Math.max(0, Math.min(1 - w, cx - w / 2)),
        cropY: Math.max(0, Math.min(1 - h, cy - h / 2)),
        cropW: w,
        cropH: h,
    };
}

const VideoPlayer = () => {
    const { t } = useTranslation('editor');
    const canvasRef = useRef(null);
    const containerRef = useRef(null); // Added containerRef
    const engineRef = useRef(null); // Persist engine instance
    // (prevTimeRef / prevIsPlayingRef removed — seek-on-scrub is now handled by a
    //  dedicated useEffect([currentTime, isPlaying]) so these stale-closure guards
    //  are no longer needed)
    // Native video dimensions from onMetadata — used to pin canvas to source resolution
    // so that ResizeObserver doesn't downgrade it back to container size.
    const nativeVideoDimRef = useRef(null);
    // Project frame aspect as [w, h]. Held in a ref because handleResize lives
    // in a ResizeObserver effect with empty deps — reading the store value
    // directly there would capture the mount-time ratio forever, so switching
    // 9:16 → 16:9 would never resize the buffer. Same trap as R42's labelWRef.
    const frameAspectRef = useRef([16, 9]);
    // Lets the aspect-ratio effect re-run the buffer sizing without duplicating it.
    const resizeHandlerRef = useRef(null);

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
                // Pin native resolution so ResizeObserver never downgrades it.
                nativeVideoDimRef.current = { width: videoWidth, height: videoHeight };

                // Tell the engine the SOURCE shape so it can contain-fit into
                // the project frame. Without this the fit falls back to
                // identity (fill) — which is the old, wrong behaviour.
                engineRef.current?.setSourceAspect?.(videoWidth, videoHeight);

                // Re-derive the buffer from the PROJECT frame, not from these
                // dimensions. Resizing the canvas to the video's own shape is
                // exactly what made the preview disagree with the export (R53);
                // handleResize uses the source only to pick a resolution, never
                // an aspect ratio.
                if (resizeHandlerRef.current) {
                    resizeHandlerRef.current();
                } else if (canvasRef.current && engineRef.current) {
                    engineRef.current.resize(videoWidth, videoHeight);
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

        // Resolve the best available URL for this clip.
        // Priority: asset.proxyUrl > clip.url > asset.url (raw).
        // We must always check asset.proxyUrl first: a clip may have been created with
        // clip.url pointing at a raw unprocessed upload.  Once the proxy job finishes,
        // assets[].proxyUrl is set and this effect re-runs — the engine then switches
        // to the streamable proxy automatically.
        let mediaUrl = null;
        if (activeClip?.assetId) {
            const asset = assets.find(a => a.id === activeClip.assetId);
            if (asset?.proxyUrl) {
                mediaUrl = asset.proxyUrl;
                if (mediaUrl.startsWith('proxies/') || mediaUrl.startsWith('raw/')) {
                    mediaUrl = `/api/proxy/gcs-media/${mediaUrl}`;
                }
            } else if (activeClip?.url) {
                // Proxy not ready yet — use the clip's stored URL as a fallback
                mediaUrl = activeClip.url;
            } else if (asset?.url) {
                mediaUrl = asset.url;
                if (mediaUrl.startsWith('proxies/') || mediaUrl.startsWith('raw/')) {
                    mediaUrl = `/api/proxy/gcs-media/${mediaUrl}`;
                }
            }
        } else {
            mediaUrl = activeClip?.url || null;
        }

        // --- URL Sync Fix for Paused State ---
        // If the clip changes (e.g. Undo/Redo) while paused, we must tell the engine
        // to load the new URL, otherwise it holds onto the old one (or none).
        if (mediaUrl && engineRef.current.currentUrl !== mediaUrl) {
            // If playing, play() handles it below. But if paused, we must explicit load.
            if (!isPlaying) {
                engineRef.current.load(mediaUrl);
            }
        } else if (!mediaUrl && !activeClip) {
            // No clip on the timeline at all — clear to black.
            // If activeClip exists but mediaUrl is null (proxy still generating),
            // we leave the canvas as-is rather than clearing it.
            engineRef.current.clearCanvas();
        }

        if (isPlaying) {
            if (activeClip) {
                if (!mediaUrl) {
                    // Proxy not yet generated for this clip — don't hand the engine a null URL
                    // or a huge unprocessed raw file that can't stream.  The assets array will
                    // update when the proxy job finishes, re-triggering this effect with a real URL.
                    console.log('[VideoPlayer] Proxy not ready yet — waiting for generation job to finish');
                } else {
                    engineRef.current.play(mediaUrl);
                }
            } else {
                engineRef.current.resumeAudio();
                engineRef.current.play(); // No active clip — attempt resume on cached URL
            }
        } else {
            engineRef.current.pause();
        }

        // Sync grading, volume, and virtual-cam crop — runs for both playing and paused states.
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
            // Virtual multicam crop is now handled by the dedicated composed-crop
            // effect below (keyed on currentTime), which also folds in any
            // zoom-rhythm scale keyframes — see composeCropWithZoom().

                // When paused the RAF loop stops — renderOnce() alone isn't enough because
            // _wantOneRender is only consumed when a NEW_FRAME arrives from the worker.
            // seek() triggers the worker to decode and send a fresh frame, so the two
            // must always be paired (as documented on renderOnce()).
            if (!isPlaying) {
                if (typeof engineRef.current.renderOnce === 'function') {
                    engineRef.current.renderOnce();
                }
                if (typeof engineRef.current.seek === 'function') {
                    engineRef.current.seek(currentTime);
                }
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isPlaying, avTracks, assets, activeClipForEngine]);

    // --- Composed crop effect (virtual multicam + zoom rhythm) ---
    // Runs on every currentTime tick (both playing and paused) so a rhythm
    // punch-in/push-in animates smoothly even when it's layered on top of a
    // multicam angle. This is the SINGLE place crop is set — see
    // composeCropWithZoom() above for why multicam crop + rhythm scale must be
    // combined into one rectangle rather than applied as two independent
    // transforms (R16 in CLAUDE.md). Ordered BEFORE the paused-scrub effect so
    // the crop is applied before any render is triggered in the same commit.
    useEffect(() => {
        if (!engineRef.current || typeof engineRef.current.setCrop !== 'function') return;

        if (!activeClip?.virtualCam) {
            engineRef.current.setCrop(0, 0, 1, 1);
            return;
        }

        const { cropX = 0, cropY = 0, cropW = 1, cropH = 1 } = activeClip.virtualCam;
        const baseCrop = { cropX, cropY, cropW, cropH };

        const scaleKfs = activeClip.keyframes?.scale;
        if (scaleKfs?.length) {
            const localTime   = currentTime - activeClip.start;
            const extraScale  = interpolateKeyframes(scaleKfs, 1.0, localTime);
            const composed    = composeCropWithZoom(baseCrop, extraScale);
            engineRef.current.setCrop(composed.cropX, composed.cropY, composed.cropW, composed.cropH);
        } else {
            engineRef.current.setCrop(cropX, cropY, cropW, cropH);
        }
    }, [currentTime, activeClip?.id, activeClip?.start, activeClip?.virtualCam, activeClip?.keyframes]);

    // --- Paused-scrub seek effect ---
    // Runs only when currentTime changes while paused so the preview frame stays in sync
    // with the scrubber.  Separated from the play/pause effect to avoid calling play()
    // ~60fps during playback (which was the root cause of the canvas-clear quality bug).
    useEffect(() => {
        if (!engineRef.current || isPlaying) return;
        if (typeof engineRef.current.seek === 'function') {
            engineRef.current.seek(currentTime);
        }
        if (typeof engineRef.current.renderOnce === 'function') {
            engineRef.current.renderOnce();
        }
    }, [currentTime, isPlaying]);

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

            const quality = useTimelineStore.getState().previewQuality;
            const qualityScale = quality === 'low' ? 0.5 : 1.0;

            // The canvas buffer is the PROJECT FRAME, not the active clip.
            //
            // It used to be sized from nativeVideoDimRef — the current video's
            // own pixel dimensions — which meant the preview surface was
            // whatever shape the clip happened to be, not the shape being
            // exported. Switch a 9:16 project to 16:9 and the buffer stayed
            // 9:16 while the frame around it became 16:9, so the source got
            // blown up to cover the difference: heavily upscaled, soft, and
            // cropped top and bottom. Export never had this problem because it
            // composites into a real output frame and pads (see
            // buildScaleFilter's force_original_aspect_ratio=decrease).
            //
            // Deriving the buffer from the project's aspect ratio makes the two
            // agree by construction; the source is then FITTED into it by the
            // engine's contain-fit (computeContainFit). See CLAUDE.md R53.
            const native = nativeVideoDimRef.current;

            // Longest edge of the source, so a portrait project keeps portrait
            // resolution and we never upscale beyond what the footage has.
            const sourceLongEdge = native
                ? Math.max(native.width, native.height)
                : Math.max(width, height);

            const [arW, arH] = frameAspectRef.current;   // e.g. [16, 9]
            const frameIsLandscape = arW >= arH;

            const baseW = frameIsLandscape ? sourceLongEdge : Math.round(sourceLongEdge * (arW / arH));
            const baseH = frameIsLandscape ? Math.round(sourceLongEdge * (arH / arW)) : sourceLongEdge;

            const targetWidth  = Math.max(2, Math.floor(baseW * qualityScale));
            const targetHeight = Math.max(2, Math.floor(baseH * qualityScale));

            // Only update if changed to avoid thrashing
            if (canvasRef.current.width !== targetWidth || canvasRef.current.height !== targetHeight) {
                engineRef.current.resize(targetWidth, targetHeight);
                console.log(`[VideoPlayer] Resized to ${targetWidth}x${targetHeight} (${quality})`);

                // Force repaint if paused, because resize clears the WebGL buffer
                if (!useTimelineStore.getState().isPlaying) {
                    const t = useTimelineStore.getState().currentTime;
                    engineRef.current.seek(t);
                }
            }
        };

        resizeHandlerRef.current = handleResize;
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

        // 2. Adjust Canvas Resolution — use native video dims when available so
        //    CSS scale() transforms don't stretch a low-res canvas buffer.
        const qualityScale = previewQuality === 'low' ? 0.5 : 1.0;
        const native = nativeVideoDimRef.current;
        let targetWidth, targetHeight;
        if (native) {
            targetWidth  = Math.floor(native.width  * qualityScale);
            targetHeight = Math.floor(native.height * qualityScale);
        } else {
            const { width, height } = containerRef.current.getBoundingClientRect();
            targetWidth  = Math.floor(width  * qualityScale);
            targetHeight = Math.floor(height * qualityScale);
        }

        if (canvasRef.current.width !== targetWidth || canvasRef.current.height !== targetHeight) {
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
    // Project colour grade as a CSS filter, written by useAudioEngine.applyLUT.
    // Subscribed (not read via getState) so applying a LUT re-renders the canvas
    // immediately — that immediacy is the whole point of the CSS-filter path.
    const projectLUTFilter = useTimelineStore(state => state.projectLUTFilter);
    
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

    // Keep the resize closure's view of the project frame current, and re-run
    // the buffer sizing when the ratio changes. Without this second part the
    // buffer would only be re-derived on a container resize, so switching
    // aspect ratio would leave the old frame shape until the window moved.
    useEffect(() => {
        const [w, h] = (dynamicRatio || '16 / 9').split('/').map(n => parseFloat(n.trim()));
        frameAspectRef.current = [
            Number.isFinite(w) && w > 0 ? w : 16,
            Number.isFinite(h) && h > 0 ? h : 9,
        ];
        // Re-run the buffer sizing directly. A ResizeObserver only fires when
        // the observed ELEMENT's box changes, and the container box does not
        // necessarily change when the ratio does — so without this the new
        // frame shape would not take effect until the window was resized.
        resizeHandlerRef.current?.();
    }, [dynamicRatio]);

    // --- Interpolate Keyframes for Smart Zoom ---
    let transformStyle = '';
    // For talking-head content (portrait or standard interview framing) scale from the
    // upper-center third so the speaker's face stays in frame rather than the bottom
    // of the frame drifting in. Landscape B-roll keeps the default center-center anchor.
    const contentType = useTimelineStore(state => state.contentAnalysis?.contentType);
    const isTalkingHead = ['long_form_raw', 'podcast', 'interview', 'youtube_long'].includes(contentType);
    const transformOrigin = isTalkingHead ? '50% 28%' : 'center center';

    // When activeClip.virtualCam is present, any zoom-rhythm scale keyframes are
    // baked into the composed crop rectangle by the effect above instead — CSS
    // transform scale must stay neutral here or the zoom gets applied TWICE
    // (once via crop, once via this transform). x/y/rotation still apply as
    // normal since virtualCam only ever controls the crop, never these.
    if (activeClip && activeClip.keyframes) {
        const localTime = currentTime - activeClip.start;
        const kf = activeClip.keyframes;
        const hasVirtualCam = !!activeClip.virtualCam;

        const scale = hasVirtualCam ? 1.0 : interpolateKeyframes(kf.scale, 1.0, localTime);
        const x = interpolateKeyframes(kf.x, 0, localTime);
        const y = interpolateKeyframes(kf.y, 0, localTime);
        const rotation = interpolateKeyframes(kf.rotation, 0, localTime);

        if (scale !== 1.0 || x !== 0 || y !== 0 || rotation !== 0) {
            transformStyle = `translate(${x}px, ${y}px) scale(${scale}) rotate(${rotation}deg)`;
        }
    } else if (activeClip && !activeClip.virtualCam) {
        // No keyframes — read direct clip properties set by the Transform tab
        const scale = activeClip.scale ?? 1.0;
        const x = activeClip.x ?? 0;
        const y = activeClip.y ?? 0;
        const rotation = activeClip.rotation ?? 0;
        if (scale !== 1.0 || x !== 0 || y !== 0 || rotation !== 0) {
            transformStyle = `translate(${x}px, ${y}px) scale(${scale}) rotate(${rotation}deg)`;
        }
    }

    // Show overlay when user presses play but no proxy exists yet.
    // Computed here (not in the effect) so it stays reactive to the store subscription.
    const proxyGenerating = (() => {
        if (!isPlaying || !activeClip) return false;
        if (!activeClip.assetId) return !activeClip.url;
        const asset = assets.find(a => a.id === activeClip.assetId);
        return !(asset?.proxyUrl || activeClip?.url);
    })();

    return (
        <div
            ref={containerRef}
            className="relative w-full h-full flex items-center justify-center bg-black overflow-hidden"
            style={{ aspectRatio: dynamicRatio }}
        >
            {proxyGenerating && <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>}
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
                    // Project colour grade. `applyLUT` has always stored a CSS
                    // filter alongside the LUT id — its own comment says "CSS
                    // filter is used in the editor (immediate); FFmpeg lut3d
                    // used at export" — but nothing ever applied it, so clicking
                    // a LUT changed the store and nothing else. See R55.
                    // 'none' (the cleared state) is a valid CSS filter value and
                    // costs nothing, so the ungraded path is unchanged.
                    filter: projectLUTFilter || 'none',
                }}
            />

            {/* Proxy still generating — shown when user presses play before the
                background proxy job finishes. Engine is NOT started in this state. */}
            {proxyGenerating && (
                <div style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(0,0,0,0.72)',
                    color: 'var(--fg-2, #a0a0b0)',
                    fontSize: 13,
                    fontFamily: 'var(--f-sans, system-ui)',
                    gap: 10,
                    pointerEvents: 'none',
                }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                        style={{ animation: 'spin 1s linear infinite', opacity: 0.7 }}
                        xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                    </svg>
                    {t('player.generatingPreview')}
                </div>
            )}
        </div>
    );
};

export default VideoPlayer;
