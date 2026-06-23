/**
 * useTimelineStore.js
 * Zustand-based hook that wraps TimelineStateManager for React integration.
 * Provides the same API surface as the legacy useEditorStore so UI components
 * can swap imports without changing any call-sites.
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import {
    timelineManager,
    TimelineActions,
    ACTION_TYPES,
    TIMELINE_EVENTS,
    timelineEvents,
    LAYER_TYPES,
    ENTITY_TYPES
} from '../timeline/index.js';

// Module-level debounce timer — lives outside React so it survives re-renders
let _autosaveTimer = null;

// ── Synchronous pre-restore ────────────────────────────────────────────────
// Populate timelineManager BEFORE React renders so the Revideo scene
// compiles with the correct tracks on first mount (not empty "NO MEDIA").
// If we waited for a useEffect, the scene would already be stuck in its
// "no clips" branch by the time the restore fired.
let _preRestoredProject = null;
try {
    const _raw = localStorage.getItem('vp_autosave');
    if (_raw) {
        const _saved = JSON.parse(_raw);
        const _age = Date.now() - (_saved.timestamp || 0);
        if (_saved.version === '1.2' && _age < 24 * 60 * 60 * 1000 && _saved.tracks?.some(t => t.clips?.length > 0)) {
            // ── FIX: Deduplicate empty tracks from corrupted autosaves ─────────────
            // Separate tracks into two buckets. Keep all tracks that have clips.
            // Only keep an empty track if no clip-bearing track of that type exists.
            const tracksWithClips = (_saved.tracks || []).filter(t => t.clips?.length > 0);
            const typesWithClips = new Set(tracksWithClips.map(t => t.type));

            const emptyTracksToKeep = [];
            const seenEmptyTypes = new Set();

            for (const track of (_saved.tracks || [])) {
                if (!track.clips?.length) {
                    if (!typesWithClips.has(track.type) && !seenEmptyTypes.has(track.type)) {
                        emptyTracksToKeep.push(track);
                        seenEmptyTypes.add(track.type);
                    }
                }
            }

            _saved.tracks = [...tracksWithClips, ...emptyTracksToKeep];

            timelineManager.fromLegacyTracks(_saved.tracks);
            _preRestoredProject = _saved;

            // ── FIX: Reset aspect ratio if there are no video clips ───────────────
            // Without this, a 9:16 project that has been cleared still restores its
            // old ratio, leaving the player stuck in portrait mode.
            const hasVideoClips = _saved.tracks.some(t => t.type === 'video' && t.clips?.length > 0);
            if (!hasVideoClips) {
                _preRestoredProject = { ..._preRestoredProject, aspectRatio: '16:9' };
            }
        } else {
            // Wipe corrupted or old session (forces a completely clean state)
            localStorage.removeItem('vp_autosave');
        }
    }
} catch (_) { /* corrupted autosave — ignore */ }

/**
 * Zustand store that syncs with TimelineStateManager
 */
const useTimelineStore = create(
    subscribeWithSelector((set, get) => {
        // Subscribe to timeline events to update Zustand state
        timelineEvents.on('*', (event) => {
            const isPlaybackEvent = [
                'timeline:playhead:moved',
                'timeline:playback:started',
                'timeline:playback:stopped',
                'timeline:selection:changed',
                'timeline:active:changed'
            ].includes(event?.type);

            const updates = {
                _timelineState: timelineManager.getState(),
                _lastEvent: event
            };

            // Only rebuild the heavy tracks array and trigger autosaves for structural changes!
            // If we rebuild tracks on PLAYHEAD_MOVED (60fps), it destroys and recreates 
            // the entire Revideo scene 60 times a second, causing massive lag!
            if (!isPlaybackEvent) {
                updates.tracks = timelineManager.toLegacyTracks();

                // Auto-save 1.5 s after structural changes so rapid edits don't spam localStorage
                clearTimeout(_autosaveTimer);
                _autosaveTimer = setTimeout(() => {
                    useTimelineStore.getState().saveProject();
                }, 1500);
            }

            set(updates);
        });

        const legacyTracks = timelineManager.toLegacyTracks();

        return {
            // ==============================================================
            // STATE — mirrors useEditorStore shape
            // ==============================================================
            _timelineState: timelineManager.getState(),
            _lastEvent: null,

            // Playback
            currentTime: 0,
            duration: _preRestoredProject?.duration || timelineManager.getState().metadata?.duration || 60,
            isPlaying: false,

            // Timeline view
            zoomLevel: _preRestoredProject?.zoomLevel || timelineManager.getState().ui?.zoomLevel || 10,
            aspectRatio: _preRestoredProject?.aspectRatio || timelineManager.getState().metadata?.aspectRatio || '16:9',

            // Tracks (legacy shape for UI)
            tracks: legacyTracks,

            // Selection
            activeClipId: null,
            selectedClipIds: [],

            // History
            past: [],
            future: [],

            // Clipboard
            clipboard: null,

            // Assets & uploads — pre-filled from autosave so proxyUrls are available immediately
            assets: _preRestoredProject?.assets || [],
            uploadedFile: _preRestoredProject?.uploadedFilePath ? { name: _preRestoredProject.uploadedFilePath } : null,
            uploadedFilePath: _preRestoredProject?.uploadedFilePath || null,
            pacingSegments: [],
            beatMarkers: [],
            captions: _preRestoredProject?.captions || [],
            captionsFilePath: _preRestoredProject?.captionsFilePath || null,
            transcriptionAttempted: _preRestoredProject?.transcriptionAttempted || false,
            // Per-file transcript map: { [basename]: Word[] }
            // Accumulates across all uploaded clips so the AI can understand the full timeline.
            // Restored from autosave so silence/filler removal works after a page reload.
            transcripts: _preRestoredProject?.transcripts || {},

            // Long-Form Intelligence Engine — stores ContentAnalyzer result
            contentAnalysis: null,

            // Preview
            previewQuality: 'high',

            // Video native dimensions (set by PlaybackEngine.onMetadata)
            videoWidth: 1920,
            videoHeight: 1080,

            // Audio
            audioLevels: {},
            waveforms: {},

            // Manager access
            manager: timelineManager,

            playerRef: null,
            setPlayerRef: (ref) => set({ playerRef: ref }),

            // ==============================================================
            // PLAYBACK ACTIONS
            // ==============================================================
            togglePlay: () => {
                const newIsPlaying = !get().isPlaying;
                set({ isPlaying: newIsPlaying });
                // Drive the Revideo core Player directly — the React prop chain
                // (playing prop → useEffect → setPlaying → attribute change) adds
                // two render cycles of latency and can miss under concurrent rendering.
                // playerRef is the core Player instance from the 'playerready' event.
                // togglePlayback(true)  = unpause (start)  when paused  = true
                // togglePlayback(false) = pause   (stop)   when playing = false
                const { playerRef } = get();
                if (playerRef && typeof playerRef.togglePlayback === 'function') {
                    playerRef.togglePlayback(newIsPlaying);
                }
            },
            setIsPlaying: (isPlaying) => {
                set({ isPlaying });
                const { playerRef } = get();
                if (playerRef && typeof playerRef.togglePlayback === 'function') {
                    playerRef.togglePlayback(isPlaying);
                }
            },

            seek: (time) => {
                const { duration, playerRef } = get();
                const clamped = Math.max(0, Math.min(time, duration));
                set({ currentTime: clamped });
                timelineManager.dispatch(
                    TimelineActions.setPlayhead(clamped),
                    { skipHistory: true }
                );
                // playerRef is the Revideo Player instance (event.detail from 'playerready').
                // The custom element (<revideo-player>) handles 'seekto' events, but we
                // have direct access to the Player instance which exposes requestSeek(frame).
                if (playerRef && typeof playerRef.requestSeek === 'function') {
                    const fps = playerRef.playback?.fps ?? 30;
                    playerRef.requestSeek(clamped * fps);
                }
            },

            // ==============================================================
            // ZOOM / VIEW
            // ==============================================================
            setZoomLevel: (zoomLevel) => {
                const clamped = Math.max(1, zoomLevel);
                set({ zoomLevel: clamped });
                timelineManager.dispatch(
                    TimelineActions.setZoom(clamped),
                    { skipHistory: true }
                );
            },

            setAspectRatio: (newRatio) => {
                set({ aspectRatio: newRatio });
                timelineManager.dispatch(TimelineActions.setAspectRatio(newRatio));
            },

            setDuration: (duration) => {
                set({ duration });
                timelineManager.dispatch(TimelineActions.setDuration(duration));
            },

            setPreviewQuality: (quality) => set({ previewQuality: quality }),

            // ==============================================================
            // SELECTION ACTIONS
            // ==============================================================
            setActiveClip: (clipId) => {
                set({ activeClipId: clipId, selectedClipIds: [clipId] });
                timelineManager.dispatch(
                    TimelineActions.setActive(clipId),
                    { skipHistory: true }
                );
            },

            toggleClipSelection: (clipId) => set((state) => {
                const isSelected = state.selectedClipIds.includes(clipId);
                let newSelection;
                if (isSelected) {
                    newSelection = state.selectedClipIds.filter(id => id !== clipId);
                } else {
                    newSelection = [...state.selectedClipIds, clipId];
                }
                const newActive = state.activeClipId === clipId
                    ? (newSelection.length > 0 ? newSelection[newSelection.length - 1] : null)
                    : state.activeClipId;
                const finalActive = !isSelected ? clipId : newActive;
                return { selectedClipIds: newSelection, activeClipId: finalActive };
            }),

            clearSelection: () => {
                set({ selectedClipIds: [], activeClipId: null });
                timelineManager.dispatch(
                    TimelineActions.select([]),
                    { skipHistory: true }
                );
            },

            // ==============================================================
            // ASSETS (UI-only state, not in timeline engine)
            // ==============================================================
            addAssets: (newAssets) => set((state) => ({
                assets: [...state.assets, ...newAssets],
                uploadedFile: newAssets.find(a => a.type === 'video')?.file || state.uploadedFile
            })),
            // ── FIX: Cascade-remove clips that reference the deleted asset ────────
            // Previously only removed the asset entry; clips remained on the timeline
            // so the asset would reappear from the autosave on the next page load.
            removeAsset: (assetId) => {
                // 1. Remove any timeline placements that belong to this asset
                const currentTracks = get().tracks;
                currentTracks.forEach(track => {
                    (track.clips || []).forEach(clip => {
                        if (clip.assetId === assetId) {
                            timelineManager.dispatch(TimelineActions.removePlacement(clip.id));
                        }
                    });
                });

                // 2. Clean up any tracks that became empty after the removal
                get()._cleanEmptyTracks();

                // 3. Remove from the asset list and sync updated track state
                set((state) => ({
                    assets: state.assets.filter(a => a.id !== assetId),
                    tracks: timelineManager.toLegacyTracks(),
                    activeClipId: null,
                    selectedClipIds: [],
                }));

                // 4. Persist immediately so the deletion survives a refresh
                get().saveProject();
            },
            updateAsset: (assetId, updates) => set((state) => ({
                assets: state.assets.map(a => a.id === assetId ? { ...a, ...updates } : a)
            })),
            setUploadedFile: (file) => set({ uploadedFile: file }),
            setUploadedFilePath: (path) => set({ uploadedFilePath: path }),

            // Add asset to timeline (used primarily by mobile tap-to-add interface)
            addAssetToTimeline: (asset) => {
                const state = get();
                const tracks = timelineManager.toLegacyTracks();

                // Find target track (first video track for video/image, first audio for audio)
                let targetTrack = tracks.find(t => t.type === asset.type);

                // Or fallback to first track if type matches roughly
                if (!targetTrack && (asset.type === 'video' || asset.type === 'image')) {
                    targetTrack = tracks.find(t => t.type === 'video');
                }

                // If no track exists, create one
                let trackId = targetTrack?.id;
                if (!trackId) {
                    const newType = asset.type === 'audio' ? 'audio' : 'video';
                    trackId = get().addTrack(newType);
                }

                // Find end of current clips on this track.
                // Ignore ghost clips (empty URLs from a stale autosave) — they have
                // no playable content, so a freshly uploaded video should start at 0
                // rather than being pushed to the end of the ghost segments.
                const finalTrack = get().tracks.find(t => t.id === trackId);
                const currentEnd = finalTrack?.clips?.reduce((max, clip) => {
                    const hasValidUrl = clip.url || clip.sourceUrl || clip.proxyUrl;
                    if (!hasValidUrl) return max;
                    return Math.max(max, clip.start + clip.duration);
                }, 0) || 0;

                // Add the clip at the end
                get().addClip(trackId, {
                    assetId: asset.id,
                    start: currentEnd,
                    duration: asset.duration || 5,
                    name: asset.name,
                    color: asset.type === 'audio' ? 'bg-orange-500' : 'bg-blue-500',
                    url: asset.url,
                    sourceUrl: asset.sourceUrl || asset.url,
                    type: asset.type
                });

                // Seek to the new clip
                get().seek(currentEnd);
            },

            // Audio
            setAudioLevels: (levels) => set({ audioLevels: levels }),
            addWaveform: (id, peaks, duration) => set((state) => ({
                waveforms: { ...state.waveforms, [id]: { peaks, duration } }
            })),

            // Captions / beats / pacing
            setCaptions: (captions, filePath) => {
                const basename = filePath ? filePath.split(/[\\/]/).pop() : null;
                const newTranscripts = { ...get().transcripts };
                if (basename && captions?.length > 0) newTranscripts[basename] = captions;
                set({ captions, captionsFilePath: filePath ?? null, transcriptionAttempted: true, transcripts: newTranscripts });
                // Transcription finishes async — persist immediately so captions survive
                // a page reload. The autosave timer only fires on structural timeline events
                // and would otherwise miss this update.
                if (captions?.length > 0) {
                    clearTimeout(_autosaveTimer);
                    _autosaveTimer = setTimeout(() => {
                        useTimelineStore.getState().saveProject();
                    }, 500);
                }
            },
            // Store timeline-derived words without touching the per-file transcripts index.
            // Use this after segment operations so store.transcripts[file] keeps original
            // Whisper timestamps (needed for offset-based filtering) while store.captions
            // reflects the current edited timeline.
            setTimelineTranscript: (words) => set({ captions: words }),
            setBeatMarkers: (markers) => set({ beatMarkers: markers }),
            setPacingSegments: (segments) => set({ pacingSegments: segments }),

            // Long-Form Intelligence Engine
            setContentAnalysis: (analysis) => set({ contentAnalysis: analysis }),
            clearContentAnalysis: () => set({ contentAnalysis: null }),

            /**
             * Move a clip to the front of its track (position 0).
             * Ripple-shifts all other clips to make room.
             * Used by LongFormEditPlanner to promote hook segments.
             */
            moveSegmentToFront: (trackId, clipId) => {
                get()._saveHistory();
                const state = get();
                const track = state.tracks.find(t => t.id === trackId);
                if (!track) return;
                const clip = track.clips.find(c => c.id === clipId);
                if (!clip) return;

                const shiftAmount = clip.duration;

                // Move target clip to 0
                get().updateClip(trackId, clipId, { start: 0 }, { skipHistory: true });

                // Ripple shift all other clips
                const others = track.clips
                    .filter(c => c.id !== clipId)
                    .sort((a, b) => a.start - b.start);

                others.forEach(c => {
                    get().updateClip(trackId, c.id, { start: c.start + shiftAmount }, { skipHistory: true });
                });

                set({ tracks: timelineManager.toLegacyTracks() });
            },

            // ==============================================================
            // CLIP MANAGEMENT (legacy-compatible API)
            // ==============================================================

            setTrackVolume: (trackId, volume) => {
                timelineManager.dispatch({ type: ACTION_TYPES.LAYER_UPDATE, payload: { layerId: trackId, updates: { volume } } });
                set({ tracks: timelineManager.toLegacyTracks() });
            },

            addClip: (trackId, clip) => {
                get()._saveHistory();

                const clipId = clip.id || `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

                timelineManager.beginTransaction();
                try {
                    // Add clip entity — spread full clip so text/transform/overlay
                    // properties (content, fontSize, color, x, y, …) are stored.
                    timelineManager.dispatch(TimelineActions.addClip({
                        ...clip,
                        id: clipId,
                        sourceUrl: clip.url || clip.sourceUrl,
                        sourceDuration: clip.sourceDuration || clip.duration,
                        metadata: clip.metadata || {},
                    }));

                    // Add placement on the specified layer
                    timelineManager.dispatch(TimelineActions.addPlacement({
                        clipId,
                        layerId: trackId,
                        startTime: clip.start || 0,
                        duration: clip.duration || clip.sourceDuration || (clip.type === 'image' ? 5 : 10),
                        offset: clip.offset || 0,
                        speed: clip.speed || 1.0,
                        volume: clip.volume || 1.0
                    }));

                    timelineManager.commitTransaction('Add Clip');
                } catch (err) {
                    timelineManager.rollbackTransaction();
                    throw err;
                }

                // Sync timeline duration if clip extends beyond current duration
                const currentDuration = get().duration;
                const clipEnd = (clip.start || 0) + (clip.duration || clip.sourceDuration || (clip.type === 'image' ? 5 : 10));
                if (clipEnd > currentDuration) {
                    get().setDuration(clipEnd);
                }

                set({ tracks: timelineManager.toLegacyTracks() });
            },

            updateClip: (trackId, clipId, updates, options = { skipHistory: false }) => {
                if (!options.skipHistory) get()._saveHistory();

                // clipId in legacy API is actually a placement ID
                const placement = timelineManager.getState().entities.placements[clipId];
                if (!placement) {
                    console.warn(`[useTimelineStore] updateClip: placement ${clipId} not found`);
                    return;
                }

                // Map legacy field names to placement fields
                const placementUpdates = {};
                if (updates.start !== undefined) placementUpdates.startTime = updates.start;
                if (updates.duration !== undefined) placementUpdates.duration = updates.duration;
                if (updates.offset !== undefined) placementUpdates.offset = updates.offset;
                if (updates.speed !== undefined) placementUpdates.speed = updates.speed;
                if (updates.volume !== undefined) placementUpdates.volume = updates.volume;
                if (updates.muted !== undefined) placementUpdates.volume = updates.muted ? 0 : (updates.volume ?? placement.volume ?? 1);
                if (updates.layerId !== undefined) placementUpdates.layerId = updates.layerId;

                if (Object.keys(placementUpdates).length > 0) {
                    timelineManager.dispatch(
                        TimelineActions.updatePlacement(clipId, placementUpdates)
                    );
                }

                // Map clip-level fields
                const clipUpdates = {};
                if (updates.name !== undefined) clipUpdates.name = updates.name;
                if (updates.grading !== undefined) clipUpdates.grading = updates.grading;
                if (updates.filter !== undefined) clipUpdates.filter = updates.filter;
                if (updates.filterIntensity !== undefined) clipUpdates.filterIntensity = updates.filterIntensity;
                if (updates.transition !== undefined) clipUpdates.transition = updates.transition;
                // Text / visual properties
                if (updates.content !== undefined) clipUpdates.content = updates.content;
                if (updates.fontSize !== undefined) clipUpdates.fontSize = updates.fontSize;
                if (updates.fontFamily !== undefined) clipUpdates.fontFamily = updates.fontFamily;
                if (updates.fontWeight !== undefined) clipUpdates.fontWeight = updates.fontWeight;
                if (updates.fontStyle !== undefined) clipUpdates.fontStyle = updates.fontStyle;
                if (updates.textDecoration !== undefined) clipUpdates.textDecoration = updates.textDecoration;
                if (updates.textShadow !== undefined) clipUpdates.textShadow = updates.textShadow;
                if (updates.stroke !== undefined) clipUpdates.stroke = updates.stroke;
                if (updates.color !== undefined) clipUpdates.color = updates.color;
                if (updates.bgColor !== undefined) clipUpdates.bgColor = updates.bgColor;
                if (updates.textAlign !== undefined) clipUpdates.textAlign = updates.textAlign;
                if (updates.position !== undefined) clipUpdates.position = updates.position;
                if (updates.style !== undefined) clipUpdates.style = updates.style;
                if (updates.x !== undefined) clipUpdates.x = updates.x;
                if (updates.y !== undefined) clipUpdates.y = updates.y;
                if (updates.scale !== undefined) clipUpdates.scale = updates.scale;
                if (updates.scaleX !== undefined) clipUpdates.scaleX = updates.scaleX;
                if (updates.scaleY !== undefined) clipUpdates.scaleY = updates.scaleY;
                if (updates.rotation !== undefined) clipUpdates.rotation = updates.rotation;
                if (updates.opacity !== undefined) clipUpdates.opacity = updates.opacity;
                if (updates.keyframes !== undefined) clipUpdates.keyframes = updates.keyframes;

                if (Object.keys(clipUpdates).length > 0 && placement.clipId) {
                    timelineManager.dispatch(
                        TimelineActions.updateClip(placement.clipId, clipUpdates)
                    );
                }

                // Sync timeline duration with the newly updated timeline
                const maxEnd = Object.values(timelineManager.getState().entities.placements)
                    .reduce((max, p) => Math.max(max, p.startTime + p.duration), 0);
                if (maxEnd > get().duration) {
                    get().setDuration(maxEnd);
                }

                set({ tracks: timelineManager.toLegacyTracks() });

                // Force the player to redraw the current frame if paused
                // This prevents the screen from going dark after scale/position edits
                if (!get().isPlaying) {
                    setTimeout(() => {
                        get().seek(get().currentTime);
                    }, 10);
                }
            },

            // Move a clip (by its placement ID) from one track to another.
            // In the legacy track format clip.id === placement.id, so callers pass the legacy clip id.
            moveClipToTrack: (fromTrackId, clipId, toTrackId) => {
                get()._saveHistory();
                const placement = timelineManager.getEntity(ENTITY_TYPES.PLACEMENT, clipId);
                if (!placement) {
                    console.warn('[moveClipToTrack] Placement not found:', clipId);
                    return;
                }
                timelineManager.dispatch(TimelineActions.movePlacement(clipId, placement.startTime, toTrackId));
                set({ tracks: timelineManager.toLegacyTracks() });
            },

            // Ripple delete: removes the clip and shifts all subsequent clips left
            // to close the gap, preserving relative spacing.
            rippleDeleteClip: (trackId, clipId) => {
                get()._saveHistory();

                const placement = timelineManager.getState().entities.placements[clipId];
                if (!placement) return;

                const { startTime, duration } = placement;
                const gapEnd = startTime + duration;

                // Remove the clip
                timelineManager.dispatch(TimelineActions.removePlacement(clipId));

                // Shift every placement that starts at or after the gap end
                const allPlacements = Object.values(timelineManager.getState().entities.placements);
                allPlacements.forEach(p => {
                    if (p.startTime >= gapEnd) {
                        timelineManager.dispatch(
                            TimelineActions.updatePlacement(p.id, { startTime: p.startTime - duration })
                        );
                    }
                });

                get()._cleanEmptyTracks();
                set({
                    tracks: timelineManager.toLegacyTracks(),
                    activeClipId: null,
                    selectedClipIds: [],
                });
            },

            removeClip: (trackId, clipId, options = {}) => {
                get()._saveHistory();

                const state = get();
                const targets = state.selectedClipIds.includes(clipId)
                    ? state.selectedClipIds
                    : [clipId];

                targets.forEach(id => {
                    // In the legacy API, 'id' is a placement ID.
                    // Use CLIP_REMOVE which removes both the clip entity and its placement so
                    // no orphaned clip entities are left behind (which caused console validation warnings).
                    const placement = timelineManager.getState().entities.placements[id];
                    if (placement?.clipId) {
                        timelineManager.dispatch(TimelineActions.removeClip(placement.clipId));
                    } else {
                        timelineManager.dispatch(TimelineActions.removePlacement(id));
                    }
                });

                // skipCleanup: true when called from bulk operations (e.g. silence removal)
                // that remove clips and immediately re-add segments to the same layer.
                // Without this guard, _cleanEmptyTracks() deletes the now-empty video layer,
                // and the subsequent addClip() calls silently orphan their placements (they
                // reference a layer that no longer exists) → timeline appears empty.
                if (!options.skipCleanup) {
                    get()._cleanEmptyTracks();
                }
                set({
                    tracks: timelineManager.toLegacyTracks(),
                    activeClipId: null,
                    selectedClipIds: []
                });
            },

            // ==============================================================
            // SPLIT / TRIM / DUPLICATE / SPEED
            // ==============================================================

            splitClip: (trackId, clipId, splitTime) => {
                get()._saveHistory();

                const sTime = parseFloat(splitTime);
                const placement = timelineManager.getState().entities.placements[clipId];
                if (!placement) return;

                if (sTime <= placement.startTime + 0.1 ||
                    sTime >= (placement.startTime + placement.duration) - 0.1) {
                    console.warn(`Split time ${sTime} is too close to boundaries`);
                    return;
                }

                timelineManager.dispatch(
                    TimelineActions.splitPlacement(clipId, sTime)
                );

                const newTracks = timelineManager.toLegacyTracks();
                set({ tracks: newTracks });
            },

            trimClip: (trackId, clipId, trimFrom, amount) => {
                get()._saveHistory();

                if (trimFrom === 'start') {
                    timelineManager.dispatch(
                        TimelineActions.trimPlacement(clipId, amount, undefined)
                    );
                } else {
                    timelineManager.dispatch(
                        TimelineActions.trimPlacement(clipId, undefined, amount)
                    );
                }

                set({ tracks: timelineManager.toLegacyTracks() });
            },

            duplicateClip: (trackId, clipId) => {
                get()._saveHistory();

                const placement = timelineManager.getState().entities.placements[clipId];
                if (!placement) return;
                const clip = timelineManager.getState().entities.clips[placement.clipId];
                if (!clip) return;

                const newStart = placement.startTime + placement.duration;

                timelineManager.beginTransaction();
                try {
                    const newClipId = `clip-dup-${Date.now()}`;
                    timelineManager.dispatch(TimelineActions.addClip({
                        id: newClipId,
                        name: `${clip.name} (Copy)`,
                        type: clip.type,
                        sourceUrl: clip.sourceUrl,
                        sourceDuration: clip.sourceDuration
                    }));
                    const newPlacementId = `placement-dup-${Date.now()}`;
                    timelineManager.dispatch(TimelineActions.addPlacement({
                        id: newPlacementId,
                        clipId: newClipId,
                        layerId: placement.layerId,
                        startTime: newStart,
                        duration: placement.duration,
                        offset: placement.offset,
                        speed: placement.speed,
                        volume: placement.volume
                    }));
                    timelineManager.commitTransaction('Duplicate Clip');
                    set({
                        tracks: timelineManager.toLegacyTracks(),
                        activeClipId: newPlacementId
                    });
                } catch (err) {
                    timelineManager.rollbackTransaction();
                }
            },

            setClipSpeed: (trackId, clipId, speed) => {
                get()._saveHistory();
                timelineManager.dispatch(
                    TimelineActions.setPlacementSpeed(clipId, speed)
                );
                set({ tracks: timelineManager.toLegacyTracks() });
            },

            // ==============================================================
            // TRACK MANAGEMENT
            // ==============================================================

            addTrack: (type) => {
                get()._saveHistory();
                const layers = timelineManager.getEntitiesArray(ENTITY_TYPES.LAYER);
                const count = layers.filter(l => l.type === type).length;
                const id = `track-${Date.now()}`;
                const name = `${type.charAt(0).toUpperCase() + type.slice(1)} Track ${count + 1}`;

                // Video tracks stack upward  → new track gets a lower order (floats above existing)
                // Audio tracks stack downward → new track gets a higher order (sinks below existing)
                const sameType = layers.filter(l => l.type === type);
                let order;
                if (type === 'audio') {
                    const maxOrder = sameType.length > 0 ? Math.max(...sameType.map(l => l.order ?? 0)) : -1;
                    order = maxOrder + 1;
                } else {
                    const minOrder = sameType.length > 0 ? Math.min(...sameType.map(l => l.order ?? 0)) : 1;
                    order = minOrder - 1;
                }

                timelineManager.dispatch(TimelineActions.addLayer({
                    id, name, type, order
                }));
                set({ tracks: timelineManager.toLegacyTracks() });
                return id;
            },

            renameTrack: (trackId, name) => {
                timelineManager.dispatch(TimelineActions.updateLayer(trackId, { name }));
                set({ tracks: timelineManager.toLegacyTracks() });
            },

            addTextTrack: () => {
                get()._saveHistory();
                const layers = timelineManager.getEntitiesArray(ENTITY_TYPES.LAYER);
                const count = layers.filter(l => l.type === 'text').length;
                const id = `track-${Date.now()}`;
                timelineManager.dispatch(TimelineActions.addLayer({
                    id,
                    name: `Text Layer ${count + 1}`,
                    type: 'text',
                    order: 0 // text tracks go on top
                }));
                set({ tracks: timelineManager.toLegacyTracks() });
            },

            // Mixer
            updateTrackVolume: (trackId, volume) => {
                timelineManager.dispatch(
                    TimelineActions.updateLayer(trackId, { volume })
                );
                set({ tracks: timelineManager.toLegacyTracks() });
            },

            toggleTrackMute: (trackId) => {
                const layer = timelineManager.getEntity(ENTITY_TYPES.LAYER, trackId);
                if (layer) {
                    timelineManager.dispatch(
                        TimelineActions.muteLayer(trackId, !layer.muted)
                    );
                    set({ tracks: timelineManager.toLegacyTracks() });
                }
            },

            toggleTrackSolo: (trackId) => {
                const layer = timelineManager.getEntity(ENTITY_TYPES.LAYER, trackId);
                if (layer) {
                    timelineManager.dispatch(
                        TimelineActions.soloLayer(trackId, !layer.solo)
                    );
                    set({ tracks: timelineManager.toLegacyTracks() });
                }
            },

            // ==============================================================
            // TRANSITIONS / FILTERS / TEXT / COLOR
            // ==============================================================

            addTransition: (clipId, type, duration) => {
                get()._saveHistory();
                const placement = timelineManager.getState().entities.placements[clipId];
                if (!placement) return;
                timelineManager.dispatch(
                    TimelineActions.updateClip(placement.clipId, {
                        transition: { type, duration }
                    })
                );
                set({ tracks: timelineManager.toLegacyTracks() });
            },

            addFilter: (clipId, filterType, intensity) => {
                get()._saveHistory();
                const placement = timelineManager.getState().entities.placements[clipId];
                if (!placement) return;
                timelineManager.dispatch(
                    TimelineActions.updateClip(placement.clipId, {
                        filter: filterType,
                        filterIntensity: intensity
                    })
                );
                set({ tracks: timelineManager.toLegacyTracks() });
            },

            /**
             * Stamp a keyframe on a clip's transform property at `time` (local clip time).
             * property: 'x' | 'y' | 'scale' | 'scaleX' | 'scaleY' | 'rotation' | 'opacity'
             */
            addTransformKeyframe: (clipId, property, time, value, easing = 'linear') => {
                get()._saveHistory();
                const { tracks } = get();
                const track = tracks.find(t => t.clips.find(c => c.id === clipId));
                if (!track) return;
                const clip = track.clips.find(c => c.id === clipId);
                if (!clip) return;

                const existingKf = clip.keyframes || {};
                const propKf = [...(existingKf[property] || [])].filter(k => k.time !== time);
                propKf.push({ time, value, easing });
                propKf.sort((a, b) => a.time - b.time);

                const placementEntry = timelineManager.getState().entities.placements[clipId];
                if (placementEntry) {
                    timelineManager.dispatch(
                        TimelineActions.updateClip(placementEntry.clipId, {
                            keyframes: { ...existingKf, [property]: propKf }
                        })
                    );
                } else {
                    // Fallback: update via legacy updateClip which patches placement metadata
                    useTimelineStore.getState().updateClip(track.id, clipId, {
                        keyframes: { ...existingKf, [property]: propKf }
                    });
                }
                set({ tracks: timelineManager.toLegacyTracks() });
            },

            /**
             * Remove a keyframe at `time` for the given property.
             */
            removeTransformKeyframe: (clipId, property, time) => {
                get()._saveHistory();
                const { tracks } = get();
                const track = tracks.find(t => t.clips.find(c => c.id === clipId));
                if (!track) return;
                const clip = track.clips.find(c => c.id === clipId);
                if (!clip) return;

                const existingKf = clip.keyframes || {};
                const propKf = (existingKf[property] || []).filter(k => k.time !== time);
                const placementEntry = timelineManager.getState().entities.placements[clipId];
                if (placementEntry) {
                    timelineManager.dispatch(
                        TimelineActions.updateClip(placementEntry.clipId, {
                            keyframes: { ...existingKf, [property]: propKf }
                        })
                    );
                } else {
                    useTimelineStore.getState().updateClip(track.id, clipId, {
                        keyframes: { ...existingKf, [property]: propKf }
                    });
                }
                set({ tracks: timelineManager.toLegacyTracks() });
            },

            applyColorGrade: (clipId, adjustments) => {
                get()._saveHistory();
                const placement = timelineManager.getState().entities.placements[clipId];
                if (!placement) return;
                const clip = timelineManager.getState().entities.clips[placement.clipId];
                timelineManager.dispatch(
                    TimelineActions.updateClip(placement.clipId, {
                        grading: { ...(clip?.grading || {}), ...adjustments }
                    })
                );
                set({ tracks: timelineManager.toLegacyTracks() });
            },

            addTextOverlay: (text, position, duration, style) => {
                let tracks = timelineManager.toLegacyTracks();
                let textTrack = tracks.find(t => t.type === 'text');
                if (!textTrack) {
                    get().addTextTrack();
                    textTrack = timelineManager.toLegacyTracks().find(t => t.type === 'text');
                }
                if (textTrack) {
                    get().addClip(textTrack.id, {
                        id: `text-${Date.now()}`,
                        start: get().currentTime,
                        duration: duration || 5,
                        name: text,
                        content: text,
                        position,
                        style,
                        type: 'text'
                    });
                }
            },

            addCaptionClips: (captions) => {
                if (!captions || captions.length === 0) return;

                // Save history once (before any mutations)
                get()._saveHistory();

                // Ensure a text track exists — dispatch directly to timelineManager
                // so we don't trigger addTextTrack()'s own _saveHistory() call.
                let textTrack = timelineManager.toLegacyTracks().find(t => t.type === 'text');
                if (!textTrack) {
                    const layers = timelineManager.getEntitiesArray(ENTITY_TYPES.LAYER);
                    const count = layers.filter(l => l.type === 'text').length;
                    const id = `track-text-${Date.now()}`;
                    timelineManager.dispatch(TimelineActions.addLayer({
                        id,
                        name: `Captions ${count + 1}`,
                        type: 'text',
                        order: 0,
                    }), { skipHistory: true });
                    textTrack = timelineManager.toLegacyTracks().find(t => t.type === 'text');
                }
                if (!textTrack) {
                    console.error('[addCaptionClips] Could not find or create text track');
                    return;
                }

                const trackId = textTrack.id;
                let maxEnd = get().duration;

                // ── ONE transaction → ONE timeline event → ONE React render ──
                timelineManager.beginTransaction();
                try {
                    captions.forEach((cap, i) => {
                        const clipId = `caption-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`;
                        const duration = Math.max(0.3, (cap.end || 0) - (cap.start || 0));

                        // Add the clip entity (metadata / visual properties)
                        timelineManager.dispatch(TimelineActions.addClip({
                            id: clipId,
                            name: cap.text,
                            content: cap.text,
                            type: 'text',
                            position: 'bottom',
                            style: 'subtitle',
                            fontSize: 36,
                            color: '#ffffff',
                            textShadow: '2px 2px 4px rgba(0,0,0,0.9)',
                            sourceUrl: null,
                            sourceDuration: duration,
                            metadata: {},
                        }));

                        // Add the placement (when/where on the timeline)
                        timelineManager.dispatch(TimelineActions.addPlacement({
                            clipId,
                            layerId: trackId,
                            startTime: cap.start || 0,
                            duration,
                            offset: 0,
                            speed: 1.0,
                            volume: 1.0,
                        }));

                        const clipEnd = (cap.start || 0) + duration;
                        if (clipEnd > maxEnd) maxEnd = clipEnd;
                    });

                    timelineManager.commitTransaction('Add Captions');
                } catch (err) {
                    timelineManager.rollbackTransaction();
                    console.error('[addCaptionClips] Transaction failed:', err);
                    return;
                }

                // Extend timeline duration if captions run past it
                if (maxEnd > get().duration) {
                    get().setDuration(maxEnd);
                }

                // Single sync to Zustand / React
                set({ tracks: timelineManager.toLegacyTracks() });
            },

            // ==============================================================
            // CLIPBOARD
            // ==============================================================
            copyClip: (clipId) => {
                const tracks = timelineManager.toLegacyTracks();
                for (const track of tracks) {
                    const clip = track.clips.find(c => c.id === clipId);
                    if (clip) {
                        set({ clipboard: { ...clip, id: null } });
                        return;
                    }
                }
            },

            pasteClip: (currentTime) => {
                get()._saveHistory();
                const { clipboard, tracks } = get();
                if (!clipboard || !tracks[0]) return;
                get().addClip(tracks[0].id, {
                    ...clipboard,
                    id: `clip-paste-${Date.now()}`,
                    start: currentTime
                });
            },

            // ==============================================================
            // HISTORY (undo / redo)
            // ==============================================================

            _saveHistory: () => {
                const state = get();
                const snapshot = {
                    _timelineState: timelineManager.getState(),
                    currentTime: state.currentTime,
                    activeClipId: state.activeClipId,
                    selectedClipIds: [...state.selectedClipIds]
                };
                const newPast = [...state.past, snapshot].slice(-50);
                set({ past: newPast, future: [] });
            },

            // Remove every layer that has no placements. Called after any clip
            // removal so empty tracks disappear immediately, including the two
            // default tracks (track-default-video / track-default-audio).
            _cleanEmptyTracks: () => {
                const placements = Object.values(timelineManager.getState().entities.placements);
                const layers = Object.values(timelineManager.getState().entities.layers);
                layers.forEach(layer => {
                    if (!placements.some(p => p.layerId === layer.id)) {
                        timelineManager.dispatch(TimelineActions.removeLayer(layer.id));
                    }
                });
            },

            // Public alias used by TextOverlay and other UI components
            saveToHistory: () => get()._saveHistory(),

            undo: () => set((state) => {
                if (state.past.length === 0) return state;

                const previous = state.past[state.past.length - 1];
                const newPast = state.past.slice(0, -1);

                // Save current for redo
                const currentSnapshot = {
                    _timelineState: timelineManager.getState(),
                    currentTime: state.currentTime,
                    activeClipId: state.activeClipId,
                    selectedClipIds: [...state.selectedClipIds]
                };

                // Restore timeline engine state
                if (previous._timelineState) {
                    timelineManager.dispatch(
                        { type: ACTION_TYPES.LOAD_STATE, payload: { state: previous._timelineState } },
                        { skipHistory: true }
                    );
                }

                return {
                    currentTime: previous.currentTime,
                    activeClipId: previous.activeClipId,
                    selectedClipIds: previous.selectedClipIds,
                    tracks: timelineManager.toLegacyTracks(),
                    past: newPast,
                    future: [currentSnapshot, ...state.future]
                };
            }),

            redo: () => set((state) => {
                if (state.future.length === 0) return state;

                const next = state.future[0];
                const newFuture = state.future.slice(1);

                const currentSnapshot = {
                    _timelineState: timelineManager.getState(),
                    currentTime: state.currentTime,
                    activeClipId: state.activeClipId,
                    selectedClipIds: [...state.selectedClipIds]
                };

                if (next._timelineState) {
                    timelineManager.dispatch(
                        { type: ACTION_TYPES.LOAD_STATE, payload: { state: next._timelineState } },
                        { skipHistory: true }
                    );
                }

                return {
                    currentTime: next.currentTime,
                    activeClipId: next.activeClipId,
                    selectedClipIds: next.selectedClipIds,
                    tracks: timelineManager.toLegacyTracks(),
                    past: [...state.past, currentSnapshot],
                    future: newFuture
                };
            }),

            // ==============================================================
            // PERSISTENCE
            // ==============================================================
            saveProject: () => {
                const state = get();
                // Strip blob URLs and File objects — they die on page reload.
                // Keep proxyUrl / fileUrl which point to server-side files that survive.
                const sanitizedAssets = (state.assets || []).map(({ file: _f, url: _u, ...rest }) => rest);
                const sanitizedTracks = (state.tracks || []).map(track => ({
                    ...track,
                    clips: track.clips.map(clip => ({
                        ...clip,
                        url: clip.url?.startsWith('blob:') ? '' : clip.url,
                        sourceUrl: clip.sourceUrl?.startsWith('blob:') ? '' : clip.sourceUrl
                    }))
                }));
                const projectData = {
                    version: '1.2',
                    timestamp: Date.now(),
                    tracks: sanitizedTracks,
                    duration: state.duration,
                    aspectRatio: state.aspectRatio,
                    zoomLevel: state.zoomLevel,
                    pacingSegments: state.pacingSegments,
                    beatMarkers: state.beatMarkers,
                    captions: state.captions,
                    // Persist per-file transcript map so AI operations (silence detection,
                    // filler removal) survive page reloads without re-running transcription.
                    // Without this, MediaExecutionEngine falls back to destructive FFmpeg
                    // silence detection which can wipe the entire clip.
                    transcripts: state.transcripts || {},
                    captionsFilePath: state.captionsFilePath || null,
                    transcriptionAttempted: state.transcriptionAttempted,
                    assets: sanitizedAssets,
                    uploadedFilePath: state.uploadedFilePath || null,
                };
                try {
                    localStorage.setItem('vp_autosave', JSON.stringify(projectData));
                } catch (_) {
                    // localStorage full — silently skip
                }
                return projectData;
            },

            loadProject: (projectData) => {
                if (!projectData) return;
                if (projectData.tracks) {
                    timelineManager.fromLegacyTracks(projectData.tracks);
                }
                const updates = {
                    tracks: timelineManager.toLegacyTracks(),
                    duration: projectData.duration || 60,
                    aspectRatio: projectData.aspectRatio || '16:9',
                    zoomLevel: projectData.zoomLevel || 10,
                    pacingSegments: projectData.pacingSegments || [],
                    beatMarkers: projectData.beatMarkers || [],
                    captions: projectData.captions || [],
                    // Restore per-file transcript map so AI silence/filler detection
                    // can use transcript-based timing instead of FFmpeg fallback.
                    transcripts: projectData.transcripts || {},
                    captionsFilePath: projectData.captionsFilePath || null,
                    transcriptionAttempted: projectData.transcriptionAttempted || false,
                    activeClipId: null,
                    currentTime: 0,
                    past: [],
                    future: [],
                };
                if (projectData.assets?.length) {
                    updates.assets = projectData.assets;
                }
                if (projectData.uploadedFilePath) {
                    updates.uploadedFilePath = projectData.uploadedFilePath;
                    updates.uploadedFile = { name: projectData.uploadedFilePath };
                }
                set(updates);
                console.log('📂 Project Loaded');
            },

            // ==============================================================
            // AI / SYNC
            // ==============================================================

            performAction: (action) => {
                get()._saveHistory();
                const { tracks } = get();
                console.log('⚡ Executing Action:', action);

                if (action.action === 'trimStart') {
                    const videoTrack = tracks.find(t => t.type === 'video');
                    if (videoTrack && videoTrack.clips.length > 0) {
                        const clip = videoTrack.clips[0];
                        const trimAmount = action.params.duration || 2;
                        get().updateClip(videoTrack.id, clip.id, {
                            offset: (clip.offset || 0) + trimAmount,
                            duration: Math.max(1, clip.duration - trimAmount),
                            name: `${clip.name} (Trimmed)`
                        });
                        return true;
                    }
                }
                return false;
            },

            rippleDelete: (atTime) => {
                if (atTime === undefined || atTime === null) return;
                get()._saveHistory();

                const placements = Object.values(timelineManager.getState().entities.placements);
                for (const { id, startTime, duration } of placements) {
                    const endTime = startTime + duration;
                    if (startTime >= atTime) {
                        // Entirely at or after cut point — remove
                        timelineManager.dispatch(TimelineActions.removePlacement(id));
                    } else if (endTime > atTime) {
                        // Spans the cut point — trim end to atTime
                        timelineManager.dispatch(
                            TimelineActions.updatePlacement(id, { duration: atTime - startTime })
                        );
                    }
                }

                set({
                    tracks: timelineManager.toLegacyTracks(),
                    activeClipId: null,
                    selectedClipIds: [],
                    duration: Math.max(atTime, 1),
                });
            },

            syncClipsToBeats: () => {
                get()._saveHistory();
                const { tracks, beatMarkers } = get();
                if (!beatMarkers || beatMarkers.length === 0) return;
                const videoTrack = tracks.find(t => t.type === 'video');
                if (!videoTrack) return;

                const sortedBeats = [...beatMarkers].sort((a, b) => a - b);
                const resultantClips = [];

                videoTrack.clips.forEach(clip => {
                    const clipStart = clip.start;
                    const clipEnd = clip.start + clip.duration;
                    const internalBeats = sortedBeats.filter(b => b > clipStart + 0.1 && b < clipEnd - 0.1);

                    if (internalBeats.length === 0) {
                        resultantClips.push(clip);
                    } else {
                        let cuts = [clipStart, ...internalBeats, clipEnd];
                        for (let i = 0; i < cuts.length - 1; i++) {
                            const startT = cuts[i];
                            const endT = cuts[i + 1];
                            resultantClips.push({
                                ...clip,
                                id: `beat-cut-${Math.random().toString(36).substr(2, 9)}`,
                                start: startT,
                                duration: endT - startT,
                                offset: (clip.offset || 0) + (startT - clipStart),
                                name: `${clip.name} (Beat)`
                            });
                        }
                    }
                });

                // Re-import into timeline engine
                const allTracks = tracks.map(t =>
                    t.id === videoTrack.id ? { ...t, clips: resultantClips } : t
                );
                timelineManager.fromLegacyTracks(allTracks);
                set({ tracks: timelineManager.toLegacyTracks() });
            },

            /**
             * cutSourceRange — removes a span of source-file time from all video clips.
             * Used by TranscriptPanel when the user selects a word range and clicks Cut.
             * @param {number} srcStart  - start time in source file (seconds)
             * @param {number} srcEnd    - end time in source file (seconds)
             */
            cutSourceRange: (srcStart, srcEnd) => {
                if (srcEnd <= srcStart) return;
                const { tracks } = get();
                get()._saveHistory();

                const videoTrack = tracks.find(t => t.type === 'video');
                if (!videoTrack) return;

                const newClips = [];
                for (const clip of videoTrack.clips) {
                    const cSrcStart = clip.offset ?? 0;
                    const cSrcEnd = cSrcStart + (clip.duration ?? 0);

                    // No overlap → keep as-is
                    if (srcEnd <= cSrcStart || srcStart >= cSrcEnd) {
                        newClips.push(clip);
                        continue;
                    }
                    // Fully consumed → drop
                    if (srcStart <= cSrcStart && srcEnd >= cSrcEnd) continue;

                    // Left remnant
                    if (srcStart > cSrcStart) {
                        newClips.push({ ...clip, id: `${clip.id}-L`, duration: srcStart - cSrcStart });
                    }
                    // Right remnant
                    if (srcEnd < cSrcEnd) {
                        newClips.push({
                            ...clip,
                            id: `${clip.id}-R`,
                            offset: srcEnd,
                            duration: cSrcEnd - srcEnd,
                        });
                    }
                }

                // Re-layout: pack clips left-to-right with no gaps
                let cursor = 0;
                const reordered = newClips.map(c => {
                    const laid = { ...c, start: cursor };
                    cursor += c.duration;
                    return laid;
                });

                const allTracks = tracks.map(t =>
                    t.type === 'video' ? { ...t, clips: reordered } : t
                );
                timelineManager.fromLegacyTracks(allTracks);

                // Drop captions that fall inside the removed range so the
                // TranscriptPanel stays in sync with the timeline.
                const { captions } = get();
                const newCaptions = captions?.length
                    ? captions.filter(w => w.end <= srcStart || w.start >= srcEnd)
                    : captions;

                set({ tracks: timelineManager.toLegacyTracks(), captions: newCaptions });
            },
        };
    })
);

// Expose globally for debugging
if (typeof window !== 'undefined') {
    window.useTimelineStore = useTimelineStore;
    window.timelineManager = timelineManager;
}

export default useTimelineStore;
