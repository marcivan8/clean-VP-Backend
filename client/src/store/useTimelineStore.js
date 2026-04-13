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

/**
 * Zustand store that syncs with TimelineStateManager
 */
const useTimelineStore = create(
    subscribeWithSelector((set, get) => {
        // Subscribe to timeline events to update Zustand state
        timelineEvents.on('*', (event) => {
            set({
                _timelineState: timelineManager.getState(),
                tracks: timelineManager.toLegacyTracks(),
                _lastEvent: event
            });
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
            duration: timelineManager.getState().metadata?.duration || 60,
            isPlaying: false,

            // Timeline view
            zoomLevel: timelineManager.getState().ui?.zoomLevel || 10,
            aspectRatio: timelineManager.getState().metadata?.aspectRatio || '16:9',

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

            // Assets & uploads (UI-only, not in timeline engine)
            assets: [],
            uploadedFile: null,
            pacingSegments: [],
            beatMarkers: [],
            captions: [],

            // Preview
            previewQuality: 'high',

            // Video native dimensions (set by PlaybackEngine.onMetadata)
            videoWidth: 1920,
            videoHeight: 1080,

            // Audio
            audioLevels: {},
            waveforms: {},

            // History (expose for UI disabled-state)
            past: [],
            future: [],

            // Manager access
            manager: timelineManager,

            playerRef: null,
            setPlayerRef: (ref) => set({ playerRef: ref }),

            // ==============================================================
            // PLAYBACK ACTIONS
            // ==============================================================
            togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),
            setIsPlaying: (isPlaying) => set({ isPlaying }),

            seek: (time) => {
                const { duration } = get();
                const clamped = Math.max(0, Math.min(time, duration));
                set({ currentTime: clamped });
                timelineManager.dispatch(
                    TimelineActions.setPlayhead(clamped),
                    { skipHistory: true }
                );
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
            removeAsset: (assetId) => set((state) => ({
                assets: state.assets.filter(a => a.id !== assetId)
            })),
            updateAsset: (assetId, updates) => set((state) => ({
                assets: state.assets.map(a => a.id === assetId ? { ...a, ...updates } : a)
            })),
            setUploadedFile: (file) => set({ uploadedFile: file }),

            // Audio
            setAudioLevels: (levels) => set({ audioLevels: levels }),
            addWaveform: (id, peaks, duration) => set((state) => ({
                waveforms: { ...state.waveforms, [id]: { peaks, duration } }
            })),

            // Captions / beats / pacing
            setCaptions: (captions) => set({ captions }),
            setBeatMarkers: (markers) => set({ beatMarkers: markers }),
            setPacingSegments: (segments) => set({ pacingSegments: segments }),

            // ==============================================================
            // CLIP MANAGEMENT (legacy-compatible API)
            // ==============================================================

            toggleTrackMute: (trackId) => {
                timelineManager.dispatch({ type: ACTION_TYPES.LAYER_MUTE, payload: { layerId: trackId } });
                set({ tracks: timelineManager.toLegacyTracks() });
            },

            toggleTrackSolo: (trackId) => {
                timelineManager.dispatch({ type: ACTION_TYPES.LAYER_SOLO, payload: { layerId: trackId } });
                set({ tracks: timelineManager.toLegacyTracks() });
            },

            setTrackVolume: (trackId, volume) => {
                timelineManager.dispatch({ type: ACTION_TYPES.LAYER_UPDATE, payload: { layerId: trackId, updates: { volume } } });
                set({ tracks: timelineManager.toLegacyTracks() });
            },

            addClip: (trackId, clip) => {
                get()._saveHistory();

                const clipId = clip.id || `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

                timelineManager.beginTransaction();
                try {
                    // Add clip entity
                    timelineManager.dispatch(TimelineActions.addClip({
                        id: clipId,
                        name: clip.name,
                        type: clip.type || 'video',
                        sourceUrl: clip.url || clip.sourceUrl,
                        sourceDuration: clip.sourceDuration || clip.duration,
                        thumbnail: clip.thumbnail,
                        metadata: clip.metadata || {}
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
            },

            removeClip: (trackId, clipId) => {
                get()._saveHistory();

                const state = get();
                const targets = state.selectedClipIds.includes(clipId)
                    ? state.selectedClipIds
                    : [clipId];

                targets.forEach(id => {
                    timelineManager.dispatch(TimelineActions.removePlacement(id));
                });

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
                const order = layers.length;
                const id = `track-${Date.now()}`;
                const name = `${type.charAt(0).toUpperCase() + type.slice(1)} Track ${count + 1}`;

                timelineManager.dispatch(TimelineActions.addLayer({
                    id, name, type, order
                }));
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
                get().addTextTrack();
                const tracks = timelineManager.toLegacyTracks();
                const textTrack = tracks.find(t => t.type === 'text');
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
                const projectData = {
                    version: '1.0',
                    timestamp: Date.now(),
                    tracks: state.tracks,
                    duration: state.duration,
                    aspectRatio: state.aspectRatio,
                    zoomLevel: state.zoomLevel,
                    pacingSegments: state.pacingSegments,
                    beatMarkers: state.beatMarkers,
                    captions: state.captions
                };
                localStorage.setItem('vp_autosave', JSON.stringify(projectData));
                console.log('💾 Project Saved to LocalStorage');
                return projectData;
            },

            loadProject: (projectData) => {
                if (!projectData) return;
                // Import legacy tracks into the timeline engine
                if (projectData.tracks) {
                    timelineManager.fromLegacyTracks(projectData.tracks);
                }
                set({
                    tracks: timelineManager.toLegacyTracks(),
                    duration: projectData.duration || 60,
                    aspectRatio: projectData.aspectRatio || '16:9',
                    zoomLevel: projectData.zoomLevel || 10,
                    pacingSegments: projectData.pacingSegments || [],
                    beatMarkers: projectData.beatMarkers || [],
                    captions: projectData.captions || [],
                    activeClipId: null,
                    currentTime: 0,
                    past: [],
                    future: []
                });
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
                get()._saveHistory();
                // Placeholder
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
            }
        };
    })
);

// Expose globally for debugging
if (typeof window !== 'undefined') {
    window.useTimelineStore = useTimelineStore;
    window.timelineManager = timelineManager;
}

export default useTimelineStore;
