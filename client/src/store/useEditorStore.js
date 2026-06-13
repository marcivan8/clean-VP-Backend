import { create } from 'zustand';

/**
 * Core Editor Store
 * Manages the global state of the video editor including playback, timeline tracks, and clips.
 */
const useEditorStore = create((set, get) => ({
    // Playback State
    currentTime: 0,
    duration: 60, // Default 60s timeline
    isPlaying: false,

    // Timeline State
    zoomLevel: 10,
    aspectRatio: '16:9', // Default landscape
    tracks: [
        {
            id: 'track-1',
            type: 'video',
            name: 'Video Track 1',
            volume: 1.0,
            muted: false,
            solo: false,
            clips: []
        },
        {
            id: 'track-2',
            type: 'audio',
            name: 'Audio Track 1',
            volume: 1.0,
            muted: false,
            solo: false,
            clips: []
        }
    ],
    activeClipId: null, // Primary active clip (for inspector)
    selectedClipIds: [], // Multi-selection array
    clipboard: null, // Clip ID or data to copy
    uploadedFile: null, // The real file object for backend analysis
    pacingSegments: [], // Array of fast/slow segments for HUD
    beatMarkers: [], // Array of timestamps for music beats
    captions: [], // Array of { word, start, end }

    // Phase 7: Viral Intelligence
    viralAnalysis: null, // Full analysis result from viralEngine
    isAnalyzing: false,  // Analysis in progress flag

    // Phase 7: A/B Iteration Variations (max 3)
    variations: [],          // Array of { id, name, description, snapshot, engagementScore }
    activeVariationId: null, // Currently previewed variation

    // Asset Library (Phase 10)
    assets: [], // { id, name, type, url, thumbnail }

    // Actions
    setCaptions: (captions) => set({ captions: captions }),
    setBeatMarkers: (markers) => set({ beatMarkers: markers }),
    setPacingSegments: (segments) => set({ pacingSegments: segments }),

    // Phase 7: Viral Intelligence actions
    setViralAnalysis: (data) => set({ viralAnalysis: data, isAnalyzing: false }),
    setIsAnalyzing: (v) => set({ isAnalyzing: v }),
    clearViralAnalysis: () => set({ viralAnalysis: null }),

    // Phase 7: A/B Variation actions
    setVariations: (variations) => set({ variations: variations.slice(0, 3) }),
    addVariation: (variation) => set((state) => ({
        variations: [...state.variations, variation].slice(0, 3)
    })),
    setActiveVariation: (id) => set({ activeVariationId: id }),
    clearVariations: () => set({ variations: [], activeVariationId: null }),

    // Assets Actions
    addAssets: (newAssets) => set((state) => ({
        assets: [...state.assets, ...newAssets],
        // Default uploadedFile to the last added video if none selected (for AI compatibility)
        uploadedFile: newAssets.find(a => a.type === 'video')?.file || state.uploadedFile
    })),
    removeAsset: (assetId) => set((state) => ({
        assets: state.assets.filter(a => a.id !== assetId)
    })),
    updateAsset: (assetId, updates) => set((state) => ({
        assets: state.assets.map(a => a.id === assetId ? { ...a, ...updates } : a)
    })),
    setUploadedFile: (file) => set({ uploadedFile: file }),
    setDuration: (duration) => set({ duration }),

    // Audio Analysis
    audioLevels: {}, // { trackId: rms }
    setAudioLevels: (levels) => set({ audioLevels: levels }),

    waveforms: {}, // { trackId (or assetUrl?): { peaks: Float32Array, duration: number } }
    addWaveform: (id, peaks, duration) => set((state) => ({
        waveforms: {
            ...state.waveforms,
            [id]: { peaks, duration }
        }
    })),

    togglePlay: () => set((state) => ({ isPlaying: !state.isPlaying })),

    setIsPlaying: (isPlaying) => set({ isPlaying }),

    seek: (time) => {
        const { duration } = get();
        // Clamp time between 0 and duration
        const newTime = Math.max(0, Math.min(time, duration));
        set({ currentTime: newTime });
    },

    setZoomLevel: (zoomLevel) => set({ zoomLevel: Math.max(1, zoomLevel) }),
    setAspectRatio: (newRatio) => set({ aspectRatio: newRatio }), // '16:9', '9:16', '1:1'

    // Preview Quality (Low/High)
    previewQuality: 'high',
    setPreviewQuality: (quality) => set({ previewQuality: quality }),

    setActiveClip: (clipId) => set({ activeClipId: clipId, selectedClipIds: [clipId] }), // Default behavior: Select only this one

    // Multi-Select Actions
    toggleClipSelection: (clipId) => set((state) => {
        const isSelected = state.selectedClipIds.includes(clipId);
        let newSelection;
        if (isSelected) {
            newSelection = state.selectedClipIds.filter(id => id !== clipId);
        } else {
            newSelection = [...state.selectedClipIds, clipId];
        }
        // If we deselected the activeClipId, fallback to the last selected one or null
        const newActive = state.activeClipId === clipId
            ? (newSelection.length > 0 ? newSelection[newSelection.length - 1] : null)
            : state.activeClipId;

        // If we just selected a new one, make it active
        const finalActive = !isSelected ? clipId : newActive;

        return { selectedClipIds: newSelection, activeClipId: finalActive };
    }),

    clearSelection: () => set({ selectedClipIds: [], activeClipId: null }),


    // --- Persistence (Phase 9) ---
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
        // For MVP: Save to localStorage (or trigger download)
        // Let's return the object so UI can handle download if needed, 
        // but also autosave to localStorage
        localStorage.setItem('vp_autosave', JSON.stringify(projectData));
        console.log("💾 Project Saved to LocalStorage");
        return projectData;
    },

    loadProject: (projectData) => {
        if (!projectData) return;
        set({
            tracks: projectData.tracks || [],
            duration: projectData.duration || 60,
            aspectRatio: projectData.aspectRatio || '16:9',
            zoomLevel: projectData.zoomLevel || 10,
            pacingSegments: projectData.pacingSegments || [],
            beatMarkers: projectData.beatMarkers || [],
            captions: projectData.captions || [],
            activeClipId: null,
            currentTime: 0
        });
        console.log("📂 Project Loaded");
    },

    setClipSpeed: (trackId, clipId, speed) => set((state) => {
        const track = state.tracks.find(t => t.id === trackId);
        if (!track) return state;

        const clip = track.clips.find(c => c.id === clipId);
        if (!clip) return state;

        // Initialize sourceDuration if missing (legacy clips)
        // Assume current duration at 1x if sourceDuration not set
        const sourceDuration = clip.sourceDuration || (clip.duration * (clip.speed || 1));

        // Calculate new timeline duration: Source / Speed
        // e.g. 10s clip at 2x = 5s on timeline
        const newDuration = sourceDuration / speed;

        const newTracks = state.tracks.map(t => {
            if (t.id === trackId) {
                const newClips = t.clips.map(c =>
                    c.id === clipId ? { ...c, speed, duration: newDuration, sourceDuration } : c
                );
                return { ...t, clips: newClips };
            }
            return t;
        });

        return { tracks: newTracks };
    }),

    // --- History System ---
    past: [],
    future: [],

    saveToHistory: () => {
        const state = get();
        // snapshot relevant state
        const snapshot = {
            tracks: state.tracks,
            duration: state.duration,
            aspectRatio: state.aspectRatio,
            zoomLevel: state.zoomLevel,
            pacingSegments: state.pacingSegments,
            beatMarkers: state.beatMarkers,
            captions: state.captions,
            activeClipId: state.activeClipId,
            selectedClipIds: state.selectedClipIds
        };
        // Limit history size to 50
        const newPast = [...state.past, snapshot].slice(-50);
        set({ past: newPast, future: [] });
    },

    undo: () => set((state) => {
        if (state.past.length === 0) return state;

        const previous = state.past[state.past.length - 1];
        const newPast = state.past.slice(0, -1);

        // Save current to future
        const currentSnapshot = {
            tracks: state.tracks,
            duration: state.duration,
            aspectRatio: state.aspectRatio,
            zoomLevel: state.zoomLevel,
            pacingSegments: state.pacingSegments,
            beatMarkers: state.beatMarkers,
            captions: state.captions,
            activeClipId: state.activeClipId,
            selectedClipIds: state.selectedClipIds
        };

        return {
            ...previous,
            past: newPast,
            future: [currentSnapshot, ...state.future]
        };
    }),

    redo: () => set((state) => {
        if (state.future.length === 0) return state;

        const next = state.future[0];
        const newFuture = state.future.slice(1);

        // Save current to past
        const currentSnapshot = {
            tracks: state.tracks,
            duration: state.duration,
            aspectRatio: state.aspectRatio,
            zoomLevel: state.zoomLevel,
            pacingSegments: state.pacingSegments,
            beatMarkers: state.beatMarkers,
            captions: state.captions,
            activeClipId: state.activeClipId,
            selectedClipIds: state.selectedClipIds
        };

        return {
            ...next,
            past: [...state.past, currentSnapshot],
            future: newFuture
        };
    }),

    // Clip Management
    addTextTrack: () => {
        get().saveToHistory();
        set((state) => {
            const newTrack = {
                id: `track-${Date.now()}`,
                type: 'text',
                name: `Text Layer ${state.tracks.filter(t => t.type === 'text').length + 1}`,
                clips: []
            };
            // Add text tracks to the TOP of the list (so they are valid tracks)
            // Note: Rendering order depends on PlaybackEngine or DOM order in TextOverlay.
            return { tracks: [newTrack, ...state.tracks] };
        });
    },

    // Clip Management
    addClip: (trackId, clip) => {
        get().saveToHistory();
        set((state) => {
            const newTracks = state.tracks.map(track => {
                if (track.id === trackId) {
                    // Initialize default speed props
                    const newClip = {
                        offset: 0,
                        speed: 1.0,
                        volume: 1.0,
                        fadeIn: 0, // Seconds
                        fadeOut: 0, // Seconds
                        denoise: false,
                        enhance: false,
                        sourceDuration: clip.duration, // Capture original length
                        ...clip
                    };
                    return { ...track, clips: [...track.clips, newClip] };
                }
                return track;
            });
            return { tracks: newTracks };
        });
    },

    updateClip: (trackId, clipId, updates, options = { skipHistory: false }) => {
        // Debounce history for rapid updates (active dragging)? 
        // For strict Undo/Redo, we should save. 
        // Ideally, UI handles "start drag" (save) and "end drag" (save). 
        // For now, let's save on every update to be safe, or check if it's a major change.
        // If updates contains 'grading', maybe don't save every tick? 
        // Let's blindly save for now, optimization later.

        // Optimization: Don't save if it's just a seek or minor UI update?
        // But updateClip changes state. 
        // Let's try to avoid saving for purely transient updates if possible, but here we don't know context.
        if (!options.skipHistory) {
            get().saveToHistory();
        }

        set((state) => {
            const newTracks = state.tracks.map(track => {
                if (track.id === trackId) {
                    const newClips = track.clips.map(clip =>
                        clip.id === clipId ? { ...clip, ...updates } : clip
                    );
                    return { ...track, clips: newClips };
                }
                return track;
            });
            return { tracks: newTracks };
        });
    },

    // AI Actions
    performAction: (action) => {
        get().saveToHistory();
        const { tracks, updateClip } = get();
        console.log("⚡ Executing Action:", action);
        // ... (rest of logic same, but we need to ensure internal calls don't double save?)
        // updateClip calls saveToHistory. So performAction calling it is redundant IF it only calls updateClip.
        // But performAction might do complex multi-step. 
        // Actually, since updateClip saves, we don't need to save here explicitly if we delegate.
        // EXCEPT: `updateClip` inside `performAction` will call `saveToHistory` inside `updateClip` implementation?
        // No, `updateClip` is a function in the store. When called from `performAction`, it's the function defined above.
        // So yes, it will trigger save. 
        // We should remove explicit save here to avoid 2 history entries or refactor.
        // Refactor: make internal _updateClip without history? 
        // Let's keep it simple: History will have granular steps. 

        // Wait, `performAction` implementation calls `updateClip` which is the one defined in `create(...)`? 
        // Yes, `const { updateClip } = get();` gets the action.

        if (action.action === 'trimStart') {
            const videoTrack = tracks.find(t => t.type === 'video');
            if (videoTrack && videoTrack.clips.length > 0) {
                const clip = videoTrack.clips[0];
                const trimAmount = action.params.duration || 2;
                // Use the action directly
                get().updateClip(videoTrack.id, clip.id, {
                    offset: (clip.offset || 0) + trimAmount,
                    duration: Math.max(1, clip.duration - trimAmount),
                    name: `${clip.name} (Trimmed)`
                });
                return true;
            }
        }
        // ... other actions
        return false;
    },

    // Manual Editing Actions
    removeClip: (trackId, clipId) => {
        get().saveToHistory();
        set((state) => {
            // Handle Multi-Delete if target is part of selection
            const targets = state.selectedClipIds.includes(clipId) ? state.selectedClipIds : [clipId];

            const newTracks = state.tracks.map(track => {
                return { ...track, clips: track.clips.filter(c => !targets.includes(c.id)) };
            });

            return {
                tracks: newTracks,
                activeClipId: null,
                selectedClipIds: []
            };
        });
    },

    addTrack: (type) => {
        get().saveToHistory();
        set((state) => {
            const newId = `track-${state.tracks.length + 1}`;
            const newTrack = {
                id: newId,
                type,
                name: `${type.charAt(0).toUpperCase() + type.slice(1)} Track ${state.tracks.filter(t => t.type === type).length + 1}`,
                volume: 1.0,
                muted: false,
                solo: false,
                clips: []
            };
            return { tracks: [...state.tracks, newTrack] };
        });
    },

    // Mixer Actions (No History for fader usage to avoid spam)
    updateTrackVolume: (trackId, volume) => set((state) => ({
        tracks: state.tracks.map(t => t.id === trackId ? { ...t, volume } : t)
    })),

    toggleTrackMute: (trackId) => set((state) => ({
        tracks: state.tracks.map(t => t.id === trackId ? { ...t, muted: !t.muted } : t)
    })),

    toggleTrackSolo: (trackId) => set((state) => ({
        tracks: state.tracks.map(t => t.id === trackId ? { ...t, solo: !t.solo } : t)
    })),

    // Advanced Editing
    splitClip: (trackId, clipId, splitTime) => {
        get().saveToHistory();
        set((state) => {
            const track = state.tracks.find(t => t.id === trackId);
            if (!track) return state;

            const clip = track.clips.find(c => c.id === clipId);
            if (!clip) return state;

            // Validation: Split time must be within clip boundaries (convert to internal coordinates safely)
            // Ensure numbers are floats, not strings
            const sTime = parseFloat(splitTime);

            if (sTime <= clip.start + 0.1 || sTime >= (clip.start + clip.duration) - 0.1) {
                console.warn(`Split time ${sTime} is too close to boundaries or outside clip range [${clip.start}, ${clip.start + clip.duration}]`);
                return state;
            }

            const relativeSplit = sTime - clip.start;
            const offset = clip.offset || 0;

            // Clip A: The left part (keep original start, trim duration)
            const clipA = {
                ...clip,
                duration: relativeSplit,
                name: `${clip.name} (Part 1)`
            };

            // Clip B: The right part (move start, reduce duration, shift offset natively)
            const clipB = {
                ...clip,
                id: `clip-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                start: sTime,
                duration: clip.duration - relativeSplit,
                offset: offset + relativeSplit,
                name: `${clip.name} (Part 2)`
            };

            const newTracks = state.tracks.map(t => {
                if (t.id === trackId) {
                    // Find index to insert right after
                    const idx = t.clips.findIndex(c => c.id === clipId);
                    const newClips = [...t.clips];
                    newClips[idx] = clipA;
                    newClips.splice(idx + 1, 0, clipB);
                    return { ...t, clips: newClips };
                }
                return t;
            });

            return { tracks: newTracks, activeClipId: clipB.id, selectedClipIds: [clipB.id] };
        });
    },

    duplicateClip: (trackId, clipId) => {
        get().saveToHistory();
        set((state) => {
            const track = state.tracks.find(t => t.id === trackId);
            if (!track) return state;

            const clip = track.clips.find(c => c.id === clipId);
            if (!clip) return state;

            const newClip = {
                ...clip,
                id: `clip-dup-${Date.now()}`,
                start: clip.start + clip.duration, // Place right after
                name: `${clip.name} (Copy)`
            };

            // Check for collision? For now, just overlap or insert
            // Better: Insert and shift others?
            const newTracks = state.tracks.map(t => {
                if (t.id === trackId) {
                    const idx = t.clips.findIndex(c => c.id === clipId);
                    // Insert right after
                    const newClips = [...t.clips];
                    newClips.splice(idx + 1, 0, newClip);

                    // Simple shift logic for subsequent clips
                    for (let i = idx + 2; i < newClips.length; i++) {
                        newClips[i] = { ...newClips[i], start: newClips[i].start + newClip.duration };
                    }

                    return { ...t, clips: newClips };
                }
                return t;
            });

            return { tracks: newTracks, activeClipId: newClip.id };
        });
    },

    trimClip: (trackId, clipId, trimFrom, amount) => {
        get().saveToHistory();
        set((state) => {
            const newTracks = state.tracks.map(track => {
                if (track.id === trackId) {
                    const newClips = track.clips.map(clip => {
                        if (clip.id === clipId) {
                            if (trimFrom === 'start') {
                                return {
                                    ...clip,
                                    start: clip.start + amount,
                                    duration: Math.max(0.1, clip.duration - amount),
                                    offset: (clip.offset || 0) + amount
                                };
                            } else {
                                return {
                                    ...clip,
                                    duration: Math.max(0.1, clip.duration - amount)
                                };
                            }
                        }
                        return clip;
                    });
                    return { ...track, clips: newClips };
                }
                return track;
            });
            return { tracks: newTracks };
        });
    },

    rippleDelete: (atTime) => {
        get().saveToHistory();
        set((state) => {
            // Very basic ripple delete: find gap at time and close it
            // For now, let's just shift everything after `atTime` left?
            // Need to know how much to shift.
            // Simplified: Just remove active clip and shift?
            // The compiler sends `atTime`. 
            // Let's assume we want to close gaps. 
            // Real ripple delete usually deletes A CLIP and shifts.
            // If passed a time, maybe it means "close gap at this time".
            return state; // Placeholder until we have gap detection logic
        });
    },

    addTransition: (clipId, type, duration) => {
        get().saveToHistory();
        set((state) => {
            const newTracks = state.tracks.map(track => ({
                ...track,
                clips: track.clips.map(clip =>
                    clip.id === clipId
                        ? { ...clip, transition: { type, duration } }
                        : clip
                )
            }));
            return { tracks: newTracks };
        });
    },

    addFilter: (clipId, filterType, intensity) => {
        get().saveToHistory();
        set((state) => {
            const newTracks = state.tracks.map(track => ({
                ...track,
                clips: track.clips.map(clip =>
                    clip.id === clipId
                        ? { ...clip, filter: filterType, filterIntensity: intensity }
                        : clip
                )
            }));
            return { tracks: newTracks };
        });
    },

    addTextOverlay: (text, position, duration, style) => {
        get().addTextTrack();
        // Wait for state update? 
        // Zustand updates are sync usually.
        // We need to add the clip to the new text track.
        set(state => {
            // Find the new text track (first one)
            const textTrack = state.tracks.find(t => t.type === 'text');
            if (textTrack) {
                const newClip = {
                    id: `text-${Date.now()}`,
                    start: state.currentTime,
                    duration: duration || 5,
                    name: text,
                    content: text,
                    position,
                    style,
                    type: 'text'
                };
                const newTracks = state.tracks.map(t =>
                    t.id === textTrack.id ? { ...t, clips: [...t.clips, newClip] } : t
                );
                return { tracks: newTracks };
            }
            return state;
        });
    },

    applyColorGrade: (clipId, adjustments) => {
        get().saveToHistory();
        set((state) => {
            const newTracks = state.tracks.map(track => ({
                ...track,
                clips: track.clips.map(clip =>
                    clip.id === clipId
                        ? {
                            ...clip,
                            grading: { ...(clip.grading || {}), ...adjustments }
                        }
                        : clip
                )
            }));
            return { tracks: newTracks };
        });
    },

    copyClip: (clipId) => {
        const { tracks } = get();
        // Find the clip across all tracks
        for (const track of tracks) {
            const clip = track.clips.find(c => c.id === clipId);
            if (clip) {
                set({ clipboard: { ...clip, id: null } }); // Copy data without ID
                return;
            }
        }
    },

    pasteClip: (currentTime) => {
        get().saveToHistory();
        set((state) => {
            if (!state.clipboard) return state;

            const targetTrack = state.tracks[0]; // Logic can be improved

            if (!targetTrack) return state;

            const newClip = {
                ...state.clipboard,
                id: `clip-paste-${Date.now()}`,
                start: currentTime,
                // Keep original duration/offset
            };

            const newTracks = state.tracks.map(track => {
                if (track.id === targetTrack.id) {
                    return { ...track, clips: [...track.clips, newClip] };
                }
                return track;
            });

            return { tracks: newTracks, activeClipId: newClip.id };
        });
    },

    // Sync Action: Chop clips at beat markers
    syncClipsToBeats: () => {
        get().saveToHistory();
        set((state) => {
            const { tracks, beatMarkers } = state;
            if (!beatMarkers || beatMarkers.length === 0) return state;

            // Only affect video tracks for now
            const videoTrack = tracks.find(t => t.type === 'video');
            if (!videoTrack) return state;

            let newClips = [];
            // ... (sync logic same as before, essentially)
            // Re-using logic:

            const sortedBeats = [...beatMarkers].sort((a, b) => a - b);
            const resultantClips = [];

            videoTrack.clips.forEach(clip => {
                const clipStart = clip.start;
                const clipEnd = clip.start + clip.duration;
                const internalBeats = sortedBeats.filter(b => b > clipStart + 0.1 && b < clipEnd - 0.1);

                if (internalBeats.length === 0) {
                    resultantClips.push(clip);
                } else {
                    let currentOffset = clip.offset || 0;
                    let cuts = [clipStart, ...internalBeats, clipEnd];

                    for (let i = 0; i < cuts.length - 1; i++) {
                        const startT = cuts[i];
                        const endT = cuts[i + 1];
                        const dur = endT - startT;

                        resultantClips.push({
                            ...clip,
                            id: `beat-cut-${Math.random().toString(36).substr(2, 9)}`,
                            start: startT,
                            duration: dur,
                            offset: currentOffset + (startT - clipStart),
                            name: `${clip.name} (Beat)`
                        });
                    }
                }
            });

            const newTracks = tracks.map(t =>
                t.id === videoTrack.id ? { ...t, clips: resultantClips } : t
            );

            return { tracks: newTracks };
        });
    }
}));

if (typeof window !== 'undefined') {
    window.useEditorStore = useEditorStore;
}

export default useEditorStore;
