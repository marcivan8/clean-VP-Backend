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
// R65 — pure, dependency-free (no React/DOM/store deps of its own), so a
// static import costs nothing meaningful in bundle size, unlike the heavier
// Compositor.js/CaptionCompiler.js which IDELayout.jsx deliberately loads
// dynamically only at export time.
import { buildComponent } from '../motion/ComponentLibrary.js';
import { clipsInGroup, computeGroupMoveUpdates, computeGroupDuplicateSpecs } from '../motion/ClipGrouping.js';
import { deriveSpeakerCrop, deriveTrackingSegments } from '../motion/ObjectLayers.js';
import { computeRippleDelete, computeGapRipple, remapTimelineWords } from '../timeline/rippleDelete.js';
import { computeMultiMove } from '../timeline/multiMove.js';
import { computeRangeCut } from '../timeline/rangeCut.js';
import { computeCaptionFollow } from '../timeline/captionFollow.js';
import { computeSpeedChange, remapWordsForSpeed } from '../timeline/speedChange.js';
import { mapTranscriptToTimeline } from '../timeline/transcriptMap.js';
import { LEGACY_PACK_MOTION } from '../motion/CaptionModel.js';
import { retimeWordsForText, splitCaption, mergeCaptions, shiftWords as shiftCaptionWords } from '../motion/captionEdits.js';

// Same breakpoint as hooks/useDeviceType.js (isMobile = width < 768). Used by
// deleteClipWithMagnet: the main-track magnet is always on for mobile.
const isMobileViewport = () =>
    typeof window !== 'undefined' && typeof window.innerWidth === 'number' && window.innerWidth < 768;

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
        if (_saved.version === '1.2' && _age < 7 * 24 * 60 * 60 * 1000 && _saved.tracks?.some(t => t.clips?.length > 0)) {
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
            // Wipe corrupted or expired autosave.
            // Also clear the project ID so EditorPage doesn't take the early-return branch
            // and instead reloads fresh data from Supabase.
            localStorage.removeItem('vp_autosave');
            localStorage.removeItem('vp_project_id');
            localStorage.removeItem('vp_project_name');
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

            // Cloud project identity (set by EditorPage on load, or by autosave hook on first save)
            projectId:   localStorage.getItem('vp_project_id') || null,
            projectName: localStorage.getItem('vp_project_name') || 'Untitled Project',
            setProjectId:   (id)   => { set({ projectId: id });     try { localStorage.setItem('vp_project_id', id); }   catch (_) {} },
            setProjectName: (name) => { set({ projectName: name }); try { localStorage.setItem('vp_project_name', name); } catch (_) {} },

            // Main-track magnet (CapCut-style): deleting a clip on the main video
            // track closes the gap. Always on for mobile; desktop can toggle it
            // from the timeline toolbar. Default ON, persisted per browser.
            mainTrackMagnet: (() => { try { return localStorage.getItem('vp_main_track_magnet') !== '0'; } catch (_) { return true; } })(),
            setMainTrackMagnet: (on) => { set({ mainTrackMagnet: !!on }); try { localStorage.setItem('vp_main_track_magnet', on ? '1' : '0'); } catch (_) {} },

            // History
            past: [],
            future: [],

            // Clipboard
            clipboard: null,
            copiedAttributes: null,

            // Assets & uploads — pre-filled from autosave so proxyUrls are available immediately
            assets: _preRestoredProject?.assets || [],
            uploadedFile: _preRestoredProject?.uploadedFilePath ? { name: _preRestoredProject.uploadedFilePath } : null,
            uploadedFilePath: _preRestoredProject?.uploadedFilePath || null,
            pacingSegments: _preRestoredProject?.pacingSegments || [],
            beatMarkers: _preRestoredProject?.beatMarkers || [],
            captions: _preRestoredProject?.captions || [],
            captionsFilePath: _preRestoredProject?.captionsFilePath || null,
            transcriptionAttempted: _preRestoredProject?.transcriptionAttempted || false,
            // Per-file transcript map: { [basename]: Word[] }
            // Accumulates across all uploaded clips so the AI can understand the full timeline.
            transcripts: _preRestoredProject?.transcripts || {},
            // basename → true for transcripts KNOWN to be in source time (written
            // by setCaptions with a file path after the timeline-mapping fix).
            // Older entries may hold timeline-time words and are not reused for
            // caption mapping — the next caption run re-transcribes that file.
            transcriptVerified: _preRestoredProject?.transcriptVerified || {},

            // Long-Form Intelligence Engine — stores ContentAnalyzer result
            contentAnalysis: _preRestoredProject?.contentAnalysis || null,

            // Speaker diarization map — populated after split_speakers completes.
            // Shape: { SPEAKER_00: { role: 'interviewer'|'guest'|null, label: string|null, words: [{word, start, end}] } }
            speakerMap: _preRestoredProject?.speakerMap || {},
            diarizationByAsset: _preRestoredProject?.diarizationByAsset || {},   // assetId → { words, speakers } (see setAssetDiarization)
            sceneAnalysisByAsset: _preRestoredProject?.sceneAnalysisByAsset || {}, // assetId → { segments, mode, hostSide, … } (see setSceneAnalysis)

            // Ledger of operations actually applied to this project, newest last.
            // ContextEngine.build() reads projectState.editHistory and feeds it to
            // the Editorial Brain prompt ("Edits applied: …"); before this existed
            // the field was ALWAYS empty, so the Brain could never tell what had
            // already been done and kept repeating the same suggestions.
            // Entry: { op, at, summary, params }
            editHistory: _preRestoredProject?.editHistory || [],

            // Preview
            previewQuality: 'high',

            // Video native dimensions (set by PlaybackEngine.onMetadata)
            videoWidth: 1920,
            videoHeight: 1080,

            // Audio
            audioLevels: {},
            // Track-keyed peaks (canvas waveform, written by addWaveform).
            waveforms: _preRestoredProject?.waveforms || {},
            // Asset-keyed peaks, owned by services/WaveformEngine.js.
            // Separate from `waveforms` above because peaks belong to a SOURCE
            // FILE, not to a track: one asset re-segmented into 20 clips across
            // 2 tracks has exactly one waveform, and keying it by track meant
            // re-deriving it per track. Persisted (R29) so a reload is a cache
            // hit instead of an ffmpeg round-trip.
            waveformsByAsset: _preRestoredProject?.waveformsByAsset || {},

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
            /**
             * Move the playhead by a whole number of frames (desktop ←/→ keys).
             * Pauses playback first, like any editor's frame step, and lands on
             * an exact frame boundary so repeated steps never drift.
             */
            stepFrames: (frames) => {
                const { currentTime, playerRef, isPlaying } = get();
                const fps = Number(playerRef?.playback?.fps) || 30;
                if (isPlaying) get().togglePlay();
                const frame = Math.round((Number(currentTime) || 0) * fps) + Math.round(Number(frames) || 0);
                get().seek(Math.max(0, frame / fps));
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

                // 2. Remove from the asset list and sync updated track state
                set((state) => ({
                    assets: state.assets.filter(a => a.id !== assetId),
                    tracks: timelineManager.toLegacyTracks(),
                    activeClipId: null,
                    selectedClipIds: [],
                }));

                // 3. Persist immediately so the deletion survives a refresh
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

            // ── Caption edit scope ────────────────────────────────────────────
            // 'global'     — a style/position change applies to EVERY caption
            // 'individual' — it applies only to the caption being edited
            //
            // This lives in the store, not in TextPanel's local useState, because
            // captions are editable from two places: the Text panel AND directly
            // on the playback canvas (drag / pinch / resize in TextOverlay).
            // While the toggle was component state, the canvas had no way to read
            // it, so canvas edits were ALWAYS single-segment — the user would set
            // "Global", drag a caption, and watch one segment move while the rest
            // stayed put. Same control, two different behaviours depending on
            // where you touched it.
            captionEditScope: 'global',
            setCaptionEditScope: (scope) => set({
                captionEditScope: scope === 'individual' ? 'individual' : 'global',
            }),

            /**
             * THE single path for every caption style/position change.
             *
             * Both the Text panel and the playback-canvas overlay must call this
             * rather than updateClip() directly — that is what keeps the scope
             * toggle meaningful no matter where the edit originates.
             *
             * @param {object} updates        Style/position fields. `content` is
             *                                handled specially — see below.
             * @param {object} opts
             * @param {string} opts.clipId    The caption being edited. Required
             *                                for individual scope; in global
             *                                scope it only decides which clip
             *                                receives a `content` change.
             * @param {string} opts.scope     Override the store scope (rare).
             * @param {boolean} opts.skipHistory  True during a live drag, so a
             *                                gesture produces ONE undo entry
             *                                rather than one per pointer move.
             * @param {boolean} opts.liveOnly True to touch only the edited clip
             *                                even in global scope — used mid-drag
             *                                so a 200-caption project doesn't fan
             *                                out N writes per pointer event. The
             *                                caller commits the real fan-out on
             *                                pointer-up.
             * @returns {number} how many clips were actually updated
             */
            applyCaptionUpdate: (updates, opts = {}) => {
                const { clipId = null, scope = null, skipHistory = false, liveOnly = false } = opts;
                const state = get();
                const effectiveScope = scope || state.captionEditScope || 'global';

                // `content` is the caption's TEXT. It is per-segment by
                // definition — fanning it out would overwrite every caption in
                // the project with the same words — so it is always applied to
                // the edited clip alone, regardless of scope.
                const { content, ...styleOnly } = updates || {};
                const hasStyle = Object.keys(styleOnly).length > 0;

                const textTracks = (state.tracks || []).filter(t => t.type === 'text');
                if (textTracks.length === 0) return 0;

                const ownerTrack = clipId
                    ? textTracks.find(t => t.clips.some(c => c.id === clipId))
                    : null;

                if (!skipHistory) get()._saveHistory();

                let updated = 0;

                if (hasStyle) {
                    if (effectiveScope === 'global' && !liveOnly) {
                        // Fan out across EVERY text track, not just the edited
                        // one — a project can have more than one caption track
                        // and "global" has to mean global.
                        for (const track of textTracks) {
                            for (const clip of (track.clips || [])) {
                                get().updateClip(track.id, clip.id, styleOnly, { skipHistory: true });
                                updated++;
                            }
                        }
                    } else if (clipId && ownerTrack) {
                        get().updateClip(ownerTrack.id, clipId, styleOnly, { skipHistory: true });
                        updated++;
                    }
                }

                if (content !== undefined && clipId && ownerTrack) {
                    get().updateClip(ownerTrack.id, clipId, { content }, { skipHistory: true });
                    if (!hasStyle) updated++;
                }

                return updated;
            },

            // Asset-keyed peak cache — written ONLY by services/WaveformEngine.js.
            // Do not call this from a component: the engine is the single owner
            // of extraction so that rendering a clip can never trigger a network
            // request (see the header comment in WaveformEngine.js).
            setAssetWaveform: (assetId, data) => set((state) => (
                assetId && data?.peaks?.length
                    ? { waveformsByAsset: { ...state.waveformsByAsset, [assetId]: data } }
                    : {}
            )),

            // Captions / beats / pacing
            setCaptions: (captions, filePath) => {
                const basename = filePath ? filePath.split(/[\\/]/).pop() : null;
                const newTranscripts = { ...get().transcripts };
                const newVerified = { ...(get().transcriptVerified || {}) };
                if (basename && captions?.length > 0) {
                    newTranscripts[basename] = captions;
                    newVerified[basename] = true; // every setCaptions(words, file) caller passes SOURCE-time words
                }
                set({ captions, captionsFilePath: filePath ?? null, transcriptionAttempted: true, transcripts: newTranscripts, transcriptVerified: newVerified });
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

            // Speaker diarization
            setSpeakerMap: (speakerMap) => set({ speakerMap }),

            // Per-asset diarization cache: { [assetId]: { words, speakers } }.
            // Diarization runs on ONE file at a time, so a timeline built from
            // several uploads needs one result per asset. Cached here so a second
            // "interview angles" run doesn't re-pay for jobs already completed
            // (each diarization is a 1–5 min queued job).
            setAssetDiarization: (assetId, data) => set(state => ({
                diarizationByAsset: { ...state.diarizationByAsset, [assetId]: data },
            })),

            // Per-asset camera-angle analysis: { segments, mode, hostSide, host, guest }.
            // Written by the `detect_scene` command and consumed by `apply_angle`.
            // This split is what makes multicam ATOMIC (R23): the expensive part
            // (diarization + GPT-4o Vision) runs once as its own inspectable step,
            // and applying angles afterwards is instant and re-runnable — instead
            // of one opaque command that redid everything on every attempt.
            setSceneAnalysis: (assetId, data) => set(state => ({
                sceneAnalysisByAsset: { ...state.sceneAnalysisByAsset, [assetId]: data },
            })),
            clearSceneAnalysis: () => set({ sceneAnalysisByAsset: {} }),

            /**
             * Append an applied operation to the edit ledger.
             * Called from WorkflowController when a job completes successfully.
             * Capped at 60 entries — enough for the Brain's context window while
             * keeping the saved project payload small.
             */
            recordEdit: (op, { summary = null, params = null } = {}) => set(state => {
                if (!op) return {};
                const entry = { op, at: Date.now(), summary, params };
                const next  = [...state.editHistory, entry];
                return { editHistory: next.length > 60 ? next.slice(-60) : next };
            }),
            clearEditHistory: () => set({ editHistory: [] }),
            setSpeakerRole: (speakerId, role, label = null) => set(state => ({
                speakerMap: {
                    ...state.speakerMap,
                    [speakerId]: { ...(state.speakerMap[speakerId] || {}), role, label },
                }
            })),

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

            addClip: (trackId, clip, options = {}) => {
                if (!options.skipHistory) get()._saveHistory();

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
                if (updates.animation !== undefined) clipUpdates.animation = updates.animation;
                // Caption style pack motion: uppercase, animation preset and the
                // spoken-word highlight (motion/CaptionModel.js legacyPackToCaptionStyle),
                // read by TextOverlay. Was missing here, so the desktop Roka style
                // card only ever changed fonts and colours.
                if (updates.captionStyle !== undefined) clipUpdates.captionStyle = updates.captionStyle;
                // Motion presets (MotionPanel, "animate automatically", style
                // packs clearing a clip's own animation). Was missing here, so
                // every preset applied through updateClip stored nothing.
                if (updates.animations !== undefined) clipUpdates.animations = updates.animations;
                // R66 — clip grouping. `null` is a legitimate value (ungroup),
                // so this checks `!== undefined`, same as every field above —
                // an explicit `updateClip(..., { groupId: null })` must go
                // through, not be silently skipped the way `if (updates.groupId)` would.
                if (updates.groupId !== undefined) clipUpdates.groupId = updates.groupId;
                // Virtual multicam crop metadata
                if (updates.virtualCam !== undefined) clipUpdates.virtualCam = updates.virtualCam;
                // R67 — Object Intelligence (SAM2). `null` is legitimate for both
                // (clearing a separation / a target), same `!== undefined` rule
                // as groupId above.
                if (updates.layerMask !== undefined) clipUpdates.layerMask = updates.layerMask;
                if (updates.layerTarget !== undefined) clipUpdates.layerTarget = updates.layerTarget;

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

                // Force the player to redraw the current frame if paused so edits
                // (grading, virtualCam crop) are visible immediately.
                // CSS-transform-only updates (x, y, scale, rotation, opacity) are applied
                // as canvas element style — the engine never needs to re-decode a frame for
                // them. Calling seek() for those changes causes quality degradation and the
                // "cursor jumps to end of clip" bug where onTick fires during renderOnce().
                const CSS_ONLY_KEYS = new Set(['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotation', 'opacity']);
                const isCssOnly = Object.keys(updates).every(k => CSS_ONLY_KEYS.has(k));
                if (!options.skipHistory && !get().isPlaying && !isCssOnly) {
                    const updatedTrack = timelineManager.toLegacyTracks().find(t =>
                        t.id === trackId && t.type !== 'text'
                    );
                    if (updatedTrack) {
                        setTimeout(() => { get().seek(get().currentTime); }, 10);
                    }
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

            removeClip: (trackId, clipId, options = {}) => {
                if (!options.skipHistory) get()._saveHistory();

                const state = get();
                const targets = state.selectedClipIds.includes(clipId)
                    ? state.selectedClipIds
                    : [clipId];

                targets.forEach(id => {
                    timelineManager.dispatch(TimelineActions.removePlacement(id));
                });

                // Clean up empty tracks (except defaults)
                const currentPlacements = Object.values(timelineManager.getState().entities.placements);
                const currentLayers = Object.values(timelineManager.getState().entities.layers);
                
                currentLayers.forEach(layer => {
                    // Never auto-delete the default tracks (by ID) or any primary
                    // media container (by type).  Deleting an empty video/audio track
                    // causes subsequent addClip calls to silently orphan their placements.
                    if (layer.id === 'track-default-video' || layer.id === 'track-default-audio') return;
                    if (layer.type === 'video' || layer.type === 'audio') return;
                    const hasClips = currentPlacements.some(p => p.layerId === layer.id);
                    if (!hasClips) {
                        timelineManager.dispatch(TimelineActions.removeLayer(layer.id));
                    }
                });

                set({
                    tracks: timelineManager.toLegacyTracks(),
                    activeClipId: null,
                    selectedClipIds: []
                });
            },

            /**
             * Main-track magnet delete (CapCut-style ripple delete).
             *
             * Deletes the clip (or the whole selection, if the clip is part of
             * it — same targeting as removeClip). If any deleted clip was on the
             * MAIN video track, the gap closes: later main-track clips and
             * text/caption clips slide left, and the word-level `captions`
             * array is remapped so preview captions stay in sync. Audio and
             * overlay tracks never move. Deleting from any other track behaves
             * exactly like removeClip. One undo step restores everything.
             *
             * Deliberately a separate action: removeClip keeps its plain
             * behaviour because the AI tools (cutSegment, speaker removal,
             * silence removal) call it in loops using precomputed positions,
             * and must not have clips shifting underneath them.
             * The planning logic is pure and lives in timeline/rippleDelete.js.
             */
            rippleDeleteClip: (trackId, clipId) => {
                const state = get();
                const targetIds = state.selectedClipIds.includes(clipId)
                    ? state.selectedClipIds
                    : [clipId];
                const plan = computeRippleDelete(state.tracks, targetIds);

                // Nothing deleted from the main track → plain delete, nothing moves.
                if (plan.removedRanges.length === 0) {
                    get().removeClip(trackId, clipId);
                    return;
                }

                const maxEnd = (tracks) => tracks.reduce((m, t) =>
                    Math.max(m, ...(t.clips || []).map(c => (Number(c.start) || 0) + (Number(c.duration) || 0))), 0);
                const oldMaxEnd = maxEnd(state.tracks);

                get()._saveHistory();
                // Opt-in: this snapshot also carries the store fields this action
                // changes outside the timeline engine (word-level captions and
                // the store's duration). undo/redo restore `_extraState` only for
                // snapshots that have it, so every other history step behaves
                // exactly as before.
                set(s => {
                    const past = s.past.slice();
                    const last = past[past.length - 1];
                    if (last) past[past.length - 1] = { ...last, _extraState: { captions: state.captions, duration: state.duration } };
                    return { past };
                });

                timelineManager.beginTransaction();
                try {
                    plan.removeIds.forEach(({ clipId: id }) => {
                        timelineManager.dispatch(TimelineActions.removePlacement(id));
                    });
                    plan.moves.forEach(({ clipId: id, start }) => {
                        timelineManager.dispatch(TimelineActions.updatePlacement(id, { startTime: start }));
                    });
                    timelineManager.commitTransaction('Ripple Delete');
                } catch (err) {
                    timelineManager.rollbackTransaction();
                    // Drop the history snapshot taken above — nothing changed.
                    set(s => ({ past: s.past.slice(0, -1) }));
                    console.error('[rippleDeleteClip] failed, timeline left unchanged:', err);
                    return;
                }

                // Same empty-track cleanup as removeClip.
                const currentPlacements = Object.values(timelineManager.getState().entities.placements);
                const currentLayers = Object.values(timelineManager.getState().entities.layers);
                currentLayers.forEach(layer => {
                    if (layer.id === 'track-default-video' || layer.id === 'track-default-audio') return;
                    if (layer.type === 'video' || layer.type === 'audio') return;
                    const hasClips = currentPlacements.some(p => p.layerId === layer.id);
                    if (!hasClips) {
                        timelineManager.dispatch(TimelineActions.removeLayer(layer.id));
                    }
                });

                const tracks = timelineManager.toLegacyTracks();
                set({
                    tracks,
                    activeClipId: null,
                    selectedClipIds: [],
                    captions: remapTimelineWords(state.captions, plan.removedRanges),
                });

                // Shrink the timeline end with the content, but only when the
                // duration was tracking the content end (a manually longer
                // duration is left alone).
                const newMaxEnd = maxEnd(tracks);
                if (newMaxEnd > 0 && Math.abs((Number(state.duration) || 0) - oldMaxEnd) < 0.05) {
                    get().setDuration(newMaxEnd);
                }
            },

            /**
             * Ripple-delete an empty GAP (right-click on empty timeline space →
             * Ripple Delete): the clips after the gap slide left to close it.
             * On the main video track captions/text follow and the word-level
             * captions are remapped, exactly like rippleDeleteClip; on any other
             * track only that track moves. One undo step. Planning is pure:
             * timeline/rippleDelete.js computeGapRipple.
             * @returns {boolean} true when a gap was closed
             */
            rippleDeleteGap: (trackId, time, opts = {}) => {
                const state = get();
                const plan = computeGapRipple(state.tracks, trackId, time);
                if (!plan.gap || plan.moves.length === 0) return false;

                const maxEnd = (tracks) => tracks.reduce((m, t) =>
                    Math.max(m, ...(t.clips || []).map(c => (Number(c.start) || 0) + (Number(c.duration) || 0))), 0);
                const oldMaxEnd = maxEnd(state.tracks);

                // opts.skipHistory: part of a gesture that already took its
                // snapshot (mobile trim, beginEditGesture).
                if (!opts.skipHistory) {
                    get()._saveHistory();
                    // Same opt-in snapshot as rippleDeleteClip: undo also restores
                    // the word-level captions and the store duration.
                    set(s => {
                        const past = s.past.slice();
                        const last = past[past.length - 1];
                        if (last) past[past.length - 1] = { ...last, _extraState: { captions: state.captions, duration: state.duration } };
                        return { past };
                    });
                }

                timelineManager.beginTransaction();
                try {
                    plan.moves.forEach(({ clipId: id, start }) => {
                        timelineManager.dispatch(TimelineActions.updatePlacement(id, { startTime: start }));
                    });
                    timelineManager.commitTransaction('Ripple Delete Gap');
                } catch (err) {
                    timelineManager.rollbackTransaction();
                    if (!opts.skipHistory) set(s => ({ past: s.past.slice(0, -1) }));
                    console.error('[rippleDeleteGap] failed, timeline left unchanged:', err);
                    return false;
                }

                const tracks = timelineManager.toLegacyTracks();
                set({
                    tracks,
                    ...(plan.removedRanges.length > 0
                        ? { captions: remapTimelineWords(state.captions, plan.removedRanges) }
                        : {}),
                });
                const newMaxEnd = maxEnd(tracks);
                if (newMaxEnd > 0 && Math.abs((Number(state.duration) || 0) - oldMaxEnd) < 0.05) {
                    get().setDuration(newMaxEnd);
                }
                return true;
            },

            /**
             * Cut a TIMELINE range [start, end) out of the edit (transcript panel
             * "cut selected words"). The range comes from words already mapped
             * onto the timeline, so only the clip(s) that actually play those
             * words are cut, whatever file they come from; everything after
             * slides left, captions lose the cut words and stay in sync, b-roll
             * and audio are left alone (same rules as rippleDeleteClip).
             * One undo step, restoring word-level captions and duration too.
             * Planning is pure: timeline/rangeCut.js computeRangeCut.
             * @returns {boolean} true when something was cut
             */
            cutTimelineRange: (start, end, opts = {}) => {
                const state = get();
                const a = Math.max(0, Number(start) || 0);
                const b = Number(end);
                const plan = computeRangeCut(state.tracks, a, b);
                if (!plan.changed) return false;

                const maxEnd = (tracks) => tracks.reduce((m, t) =>
                    Math.max(m, ...(t.clips || []).map(c => (Number(c.start) || 0) + (Number(c.duration) || 0))), 0);
                const oldMaxEnd = maxEnd(state.tracks);
                // Placements as they were before the cut: the right-hand piece of
                // a split clip is a copy of its original placement, and caption
                // words are stored minus the placement's wordShift.
                const before = timelineManager.getState().entities.placements || {};

                // opts.skipHistory: the caller (cutTimelineRanges) already took
                // ONE snapshot for a batch of cuts.
                if (!opts.skipHistory) {
                    get()._saveHistory();
                    set(s => {
                        const past = s.past.slice();
                        const last = past[past.length - 1];
                        if (last) past[past.length - 1] = { ...last, _extraState: { captions: state.captions, duration: state.duration } };
                        return { past };
                    });
                }

                timelineManager.beginTransaction();
                try {
                    plan.removeIds.forEach(id => {
                        timelineManager.dispatch(TimelineActions.removePlacement(id));
                    });
                    plan.updates.forEach(({ id, updates }) => {
                        timelineManager.dispatch(TimelineActions.updatePlacement(id, updates));
                    });
                    plan.adds.forEach(({ fromId, overrides }) => {
                        const src = before[fromId];
                        if (!src) return;
                        const { id: _id, createdAt: _c, ...rest } = src;
                        timelineManager.dispatch(TimelineActions.addPlacement({ ...rest, ...overrides }));
                    });
                    plan.wordEdits.forEach(({ id, words, content }) => {
                        const p = before[id];
                        if (!p?.clipId) return;
                        const shift = Number(p.wordShift) || 0;
                        const stored = words.map(w => ({
                            ...w,
                            start: Number.isFinite(w?.start) ? w.start - shift : w?.start,
                            end: Number.isFinite(w?.end) ? w.end - shift : w?.end,
                        }));
                        timelineManager.dispatch(TimelineActions.updateClip(p.clipId,
                            content !== undefined ? { words: stored, content, name: content } : { words: stored }));
                    });
                    timelineManager.commitTransaction('Cut From Transcript');
                } catch (err) {
                    timelineManager.rollbackTransaction();
                    if (!opts.skipHistory) set(s => ({ past: s.past.slice(0, -1) }));
                    console.error('[cutTimelineRange] failed, timeline left unchanged:', err);
                    return false;
                }

                // Same empty-track cleanup as rippleDeleteClip (a caption track
                // whose captions were all cut).
                const currentPlacements = Object.values(timelineManager.getState().entities.placements);
                const currentLayers = Object.values(timelineManager.getState().entities.layers);
                currentLayers.forEach(layer => {
                    if (layer.id === 'track-default-video' || layer.id === 'track-default-audio') return;
                    if (layer.type === 'video' || layer.type === 'audio') return;
                    if (!currentPlacements.some(p => p.layerId === layer.id)) {
                        timelineManager.dispatch(TimelineActions.removeLayer(layer.id));
                    }
                });

                const tracks = timelineManager.toLegacyTracks();

                // Word-level transcript on the timeline clock: re-derive from the
                // source-time transcripts when we have them (exact), otherwise
                // shift the existing words through the cut.
                let captions = remapTimelineWords(state.captions, [[a, b]]);
                const verified = {};
                for (const [k, v] of Object.entries(state.transcripts || {})) {
                    if (state.transcriptVerified?.[k]) verified[k] = v;
                }
                if (Object.keys(verified).length > 0) {
                    const mapped = mapTranscriptToTimeline({ tracks, assets: state.assets, transcripts: verified });
                    if (mapped.length > 0) captions = mapped;
                }

                set({ tracks, activeClipId: null, selectedClipIds: [], captions });

                const newMaxEnd = maxEnd(tracks);
                if (newMaxEnd > 0 && Math.abs((Number(state.duration) || 0) - oldMaxEnd) < 0.05) {
                    get().setDuration(newMaxEnd);
                }
                // Keep the playhead on the same moment of the edit.
                const ct = Number(get().currentTime) || 0;
                if (ct > a) get().seek?.(ct >= b ? ct - (b - a) : a);
                return true;
            },

            /**
             * Cut several TIMELINE ranges as ONE undo step (mobile transcript:
             * "Remove all" filler words). Ranges are cut from the last to the
             * first so earlier cuts never move the ranges still to come.
             * @param {Array<[number, number]>} ranges
             * @returns {number} how many ranges were cut
             */
            cutTimelineRanges: (ranges) => {
                const list = (Array.isArray(ranges) ? ranges : [])
                    .map(([a, b]) => [Math.max(0, Number(a) || 0), Number(b)])
                    .filter(([a, b]) => Number.isFinite(b) && b - a > 1e-3)
                    .sort((x, y) => y[0] - x[0]);
                if (list.length === 0) return 0;
                const state = get();
                get()._saveHistory();
                set(s => {
                    const past = s.past.slice();
                    const last = past[past.length - 1];
                    if (last) past[past.length - 1] = { ...last, _extraState: { captions: state.captions, duration: state.duration } };
                    return { past };
                });
                let cut = 0;
                for (const [a, b] of list) {
                    if (get().cutTimelineRange(a, b, { skipHistory: true })) cut++;
                }
                // Nothing changed: drop the snapshot so Undo doesn't do nothing.
                if (cut === 0) set(s => ({ past: s.past.slice(0, -1) }));
                return cut;
            },

            // ── Caption editing (mobile caption sheets, phase 4) ─────────────────
            // These write straight to the caption ENTITY through TimelineActions
            // because the legacy updateClip() does not map `words` or `animations`. Each is one undo step. Word arrays come in as
            // DISPLAYED timeline times and are stored minus the placement's
            // wordShift (see TimelineStateManager withWordShift). A caption whose
            // entity is shared by several placements is left alone for word edits.

            /** Style every caption / text clip (all text tracks). @returns {boolean} */
            applyCaptionStyleToAll: (fields) => {
                const textClips = get().tracks.filter(t => t.type === 'text').flatMap(t => t.clips || []);
                if (textClips.length === 0 || !fields) return false;
                const placements = timelineManager.getState().entities.placements;
                const entityIds = [...new Set(textClips.map(c => placements[c.id]?.clipId).filter(Boolean))];
                get()._saveHistory();
                timelineManager.beginTransaction();
                try {
                    entityIds.forEach(id => timelineManager.dispatch(TimelineActions.updateClip(id, fields)));
                    timelineManager.commitTransaction('Caption Style');
                } catch (err) {
                    timelineManager.rollbackTransaction();
                    set(s => ({ past: s.past.slice(0, -1) }));
                    console.error('[applyCaptionStyleToAll] failed:', err);
                    return false;
                }
                set({ tracks: timelineManager.toLegacyTracks() });
                return true;
            },

            /** Turn the spoken-word highlight on (each clip's pack default) or off. */
            setCaptionWordHighlight: (on) => {
                const textClips = get().tracks.filter(t => t.type === 'text').flatMap(t => t.clips || []);
                const placements = timelineManager.getState().entities.placements;
                const entities = timelineManager.getState().entities.clips;
                const seen = new Set();
                const updates = [];
                for (const c of textClips) {
                    const id = placements[c.id]?.clipId;
                    if (!id || seen.has(id)) continue;
                    seen.add(id);
                    const cs = entities[id]?.captionStyle || {};
                    const packDefault = LEGACY_PACK_MOTION[cs.packId]?.wordHighlight;
                    const wordHighlight = on
                        ? (packDefault && packDefault.mode !== 'none' ? packDefault : { mode: 'color', color: '#FACC15', scale: 1.08 })
                        : { mode: 'none', scale: 1 };
                    updates.push([id, { captionStyle: { ...cs, wordHighlight } }]);
                }
                if (updates.length === 0) return false;
                get()._saveHistory();
                timelineManager.beginTransaction();
                try {
                    updates.forEach(([id, u]) => timelineManager.dispatch(TimelineActions.updateClip(id, u)));
                    timelineManager.commitTransaction('Caption Highlight');
                } catch (err) {
                    timelineManager.rollbackTransaction();
                    set(s => ({ past: s.past.slice(0, -1) }));
                    console.error('[setCaptionWordHighlight] failed:', err);
                    return false;
                }
                set({ tracks: timelineManager.toLegacyTracks() });
                return true;
            },

            /** Change one caption's text; its word timings follow (motion/captionEdits.js). */
            editCaptionText: (placementId, newText) => {
                const text = String(newText ?? '').replace(/\s+/g, ' ').trim();
                if (!text) return false;
                const st = timelineManager.getState().entities;
                const p = st.placements[placementId];
                if (!p?.clipId) return false;
                const legacy = get().tracks.flatMap(t => t.clips || []).find(c => c.id === placementId);
                if (!legacy) return false;
                const shared = Object.values(st.placements).filter(x => x.clipId === p.clipId).length > 1;
                const words = shared ? null : retimeWordsForText(legacy.words, text);
                const updates = { content: text, name: text };
                if (words) updates.words = shiftCaptionWords(words, -(Number(p.wordShift) || 0));
                get()._saveHistory();
                timelineManager.dispatch(TimelineActions.updateClip(p.clipId, updates));
                set({ tracks: timelineManager.toLegacyTracks() });
                return true;
            },

            /** Split a caption into two before word `index`. @returns {boolean} */
            splitCaptionAt: (placementId, index) => {
                const st = timelineManager.getState().entities;
                const p = st.placements[placementId];
                const entity = p?.clipId ? st.clips[p.clipId] : null;
                if (!p || !entity) return false;
                if (Object.values(st.placements).filter(x => x.clipId === p.clipId).length > 1) return false;
                const legacy = get().tracks.flatMap(t => t.clips || []).find(c => c.id === placementId);
                const parts = legacy ? splitCaption(legacy.words, legacy.content, index) : null;
                if (!parts) return false;
                const s0 = Number(p.startTime) || 0;
                const e0 = s0 + (Number(p.duration) || 0);
                if (!(parts.splitTime > s0 + 0.05 && parts.splitTime < e0 - 0.05)) return false;

                const shift = Number(p.wordShift) || 0;
                const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                const newEntityId = `caption-${stamp}-r`;
                get()._saveHistory();
                timelineManager.beginTransaction();
                try {
                    timelineManager.dispatch(TimelineActions.updatePlacement(placementId, { duration: parts.splitTime - s0 }));
                    timelineManager.dispatch(TimelineActions.updateClip(p.clipId, {
                        content: parts.left.content, name: parts.left.content,
                        words: shiftCaptionWords(parts.left.words, -shift),
                    }));
                    const { id: _oldId, createdAt: _c, updatedAt: _u, ...entityRest } = entity;
                    timelineManager.dispatch(TimelineActions.addClip({
                        ...entityRest,
                        id: newEntityId,
                        content: parts.right.content,
                        name: parts.right.content,
                        words: parts.right.words, // new placement has no wordShift
                    }));
                    timelineManager.dispatch(TimelineActions.addPlacement({
                        id: `caption-${stamp}-p`,
                        clipId: newEntityId,
                        layerId: p.layerId,
                        startTime: parts.splitTime,
                        duration: e0 - parts.splitTime,
                        offset: 0,
                        speed: p.speed ?? 1,
                        volume: p.volume ?? 1,
                    }));
                    timelineManager.commitTransaction('Split Caption');
                } catch (err) {
                    timelineManager.rollbackTransaction();
                    set(s => ({ past: s.past.slice(0, -1) }));
                    console.error('[splitCaptionAt] failed:', err);
                    return false;
                }
                set({ tracks: timelineManager.toLegacyTracks() });
                return true;
            },

            /** Merge a caption with the next one on its track. @returns {boolean} */
            mergeCaptionWithNext: (placementId) => {
                const track = get().tracks.find(t => t.type === 'text' && (t.clips || []).some(c => c.id === placementId));
                if (!track) return false;
                const sorted = (track.clips || []).slice().sort((a, b) => (Number(a.start) || 0) - (Number(b.start) || 0));
                const i = sorted.findIndex(c => c.id === placementId);
                const a = sorted[i];
                const b = sorted[i + 1];
                if (!a || !b) return false;
                const st = timelineManager.getState().entities;
                const pa = st.placements[a.id];
                const pb = st.placements[b.id];
                if (!pa?.clipId || !pb) return false;
                const count = (cid) => Object.values(st.placements).filter(x => x.clipId === cid).length;
                if (count(pa.clipId) > 1 || count(pb.clipId) > 1) return false;
                const merged = mergeCaptions(a, b);
                const newDuration = (Number(b.start) || 0) + (Number(b.duration) || 0) - (Number(a.start) || 0);
                if (!(newDuration > 0)) return false;
                get()._saveHistory();
                timelineManager.beginTransaction();
                try {
                    timelineManager.dispatch(TimelineActions.removePlacement(b.id));
                    timelineManager.dispatch(TimelineActions.updatePlacement(a.id, { duration: newDuration }));
                    timelineManager.dispatch(TimelineActions.updateClip(pa.clipId, {
                        content: merged.content, name: merged.content,
                        words: shiftCaptionWords(merged.words, -(Number(pa.wordShift) || 0)),
                    }));
                    timelineManager.commitTransaction('Merge Captions');
                } catch (err) {
                    timelineManager.rollbackTransaction();
                    set(s => ({ past: s.past.slice(0, -1) }));
                    console.error('[mergeCaptionWithNext] failed:', err);
                    return false;
                }
                set({ tracks: timelineManager.toLegacyTracks() });
                return true;
            },

            // ── Touch gestures (mobile trim) ──────────────────────────────────
            // A trim drag updates the clip live with skipHistory, so a snapshot
            // taken when the finger LIFTS already holds the trimmed clip and
            // Undo would change nothing. Take it when the gesture STARTS
            // instead (with captions + duration, like ripple delete), and drop
            // it again if nothing changed.
            beginEditGesture: () => {
                const state = get();
                const futureBefore = state.future;
                get()._saveHistory();
                set(s => {
                    const past = s.past.slice();
                    const last = past[past.length - 1];
                    // _futureBefore: _saveHistory empties the redo stack; a gesture
                    // that ends up changing nothing (a click on a handle) gives it back.
                    if (last) past[past.length - 1] = { ...last, _extraState: { captions: state.captions, duration: state.duration }, _gesture: true, _futureBefore: futureBefore };
                    return { past };
                });
            },
            endEditGesture: (changed) => {
                if (changed) return;
                set(s => {
                    const last = s.past[s.past.length - 1];
                    return last?._gesture
                        ? { past: s.past.slice(0, -1), future: last._futureBefore || s.future }
                        : {};
                });
            },

            /**
             * After a same-track move of main-track clips (mobile long-press
             * reorder), move the captions / text that sat over each moved clip
             * by the same amount (timeline/captionFollow.js). Part of the
             * move's undo step: it adds no history of its own.
             * @param {Array} prevTracks legacy tracks from before the move
             * @returns {number} text clips moved
             */
            followMainTrackMove: (prevTracks) => {
                const moves = computeCaptionFollow(prevTracks, get().tracks);
                if (moves.length === 0) return 0;
                timelineManager.beginTransaction();
                try {
                    // startTime only → withWordShift moves the word timings too
                    moves.forEach(({ clipId, start }) => timelineManager.dispatch(TimelineActions.updatePlacement(clipId, { startTime: start })));
                    timelineManager.commitTransaction('Captions Follow Move');
                } catch (err) {
                    timelineManager.rollbackTransaction();
                    console.error('[followMainTrackMove] failed:', err);
                    return 0;
                }
                const tracks = timelineManager.toLegacyTracks();
                const state = get();
                const verified = {};
                for (const [k, v] of Object.entries(state.transcripts || {})) {
                    if (state.transcriptVerified?.[k]) verified[k] = v;
                }
                const mapped = Object.keys(verified).length > 0
                    ? mapTranscriptToTimeline({ tracks, assets: state.assets, transcripts: verified })
                    : [];
                set({ tracks, ...(mapped.length > 0 ? { captions: mapped } : {}) });
                return moves.length;
            },

            /**
             * Entry point for deletes the USER triggers by hand (Delete key,
             * clip ✕ button, Edit menu, context menu, mobile Delete button).
             * Ripples when the magnet is on — always on mobile, toggle on
             * desktop — otherwise a plain removeClip.
             */
            deleteClipWithMagnet: (trackId, clipId) => {
                if (get().mainTrackMagnet || isMobileViewport()) {
                    get().rippleDeleteClip(trackId, clipId);
                } else {
                    get().removeClip(trackId, clipId);
                }
            },

            /**
             * Move every selected clip (or the given clipIds) by the same time
             * delta — desktop multi-drag, and single-clip drags within a track.
             * Time only: clips keep their tracks. When the moved
             * clips land on other clips, those slide into the space the
             * selection left (CapCut-style swap). Planning is pure and lives in
             * timeline/multiMove.js. One undo step. Selection is kept.
             *
             * @returns {{ok: boolean, reason?: string}} ok:false with
             *   reason 'interleaved' when an unselected clip sits between
             *   selected clips on a track — nothing is changed in that case.
             */
            moveSelectedClips: (delta, clipIds = null) => {
                const { selectedClipIds, tracks } = get();
                // clipIds lets a single-clip drag reuse the same swap logic
                // without touching (or depending on) the current selection.
                const ids = Array.isArray(clipIds) ? clipIds : selectedClipIds;
                const result = computeMultiMove(tracks, ids, delta);
                if (!result.ok || result.updates.length === 0) return result;

                get()._saveHistory();
                timelineManager.beginTransaction();
                try {
                    result.updates.forEach(u => {
                        timelineManager.dispatch(TimelineActions.updatePlacement(u.clipId, { startTime: u.start }));
                    });
                    timelineManager.commitTransaction('Move Clips');
                } catch (err) {
                    timelineManager.rollbackTransaction();
                    set(st => ({ past: st.past.slice(0, -1) }));
                    console.error('[moveSelectedClips] failed, timeline left unchanged:', err);
                    return { ok: false, reason: 'error' };
                }

                const newTracks = timelineManager.toLegacyTracks();
                set({ tracks: newTracks });
                const newEnd = newTracks.reduce((m, t) =>
                    Math.max(m, ...(t.clips || []).map(c => (Number(c.start) || 0) + (Number(c.duration) || 0))), 0);
                if (newEnd > (Number(get().duration) || 0)) get().setDuration(newEnd);
                return result;
            },

            /**
             * Paste the copied clip at a given time, preferring the given
             * track when its type fits the clip (video/image → video, audio →
             * audio, text → text, sticker/overlay → overlay), otherwise the
             * first track that fits. If the spot is occupied, a new track of
             * the right type is created instead — same rule as dragging a
             * clip onto another. The older pasteClip(time) is unchanged.
             */
            pasteClipAt: (trackId, time) => {
                const { clipboard, tracks } = get();
                if (!clipboard) return;
                const wantType = clipboard.type === 'audio' ? 'audio'
                    : clipboard.type === 'text' ? 'text'
                    : (clipboard.type === 'sticker' || clipboard.type === 'overlay') ? 'overlay'
                    : 'video';
                const fits = (t) => !!t && (t.type === wantType || (wantType === 'video' && t.type === 'image'));
                let target = tracks.find(t => t.id === trackId);
                if (!fits(target)) target = tracks.find(fits);

                const start = Math.max(0, Number(time) || 0);
                const dur = Number(clipboard.duration) || 5;
                const collides = !!target && target.clips.some(c =>
                    start < c.start + c.duration - 1e-3 && start + dur > c.start + 1e-3);

                // Caption word timings are absolute: carry them to the paste spot.
                const wordDelta = start - (Number(clipboard.start) || 0);
                const words = Array.isArray(clipboard.words)
                    ? clipboard.words.map(w => ({ ...w, start: (Number(w.start) || 0) + wordDelta, end: (Number(w.end) || 0) + wordDelta }))
                    : clipboard.words;
                const clip = { ...clipboard, id: `clip-paste-${Date.now()}`, start, words };
                if (!target || collides) {
                    const newTrackId = get().addTrack(wantType); // saves the history step
                    get().addClip(newTrackId, clip, { skipHistory: true });
                } else {
                    get().addClip(target.id, clip);
                }
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

            // The clip keeps the same piece of source and gets longer/shorter;
            // later clips on its track (and, on the main track, the captions)
            // move with it. Planning is pure: timeline/speedChange.js.
            setClipSpeed: (trackId, clipId, speed) => {
                const state = get();
                const plan = computeSpeedChange(state.tracks, trackId, clipId, speed);
                if (!plan) return;

                const maxEnd = (tracks) => tracks.reduce((m, t) =>
                    Math.max(m, ...(t.clips || []).map(c => (Number(c.start) || 0) + (Number(c.duration) || 0))), 0);
                const oldMaxEnd = maxEnd(state.tracks);

                get()._saveHistory();
                // Word-level captions and duration live outside the timeline
                // engine; carry them on this snapshot so undo restores them
                // (same opt-in as rippleDeleteClip).
                set(s => {
                    const past = s.past.slice();
                    const last = past[past.length - 1];
                    if (last) past[past.length - 1] = { ...last, _extraState: { captions: state.captions, duration: state.duration } };
                    return { past };
                });

                timelineManager.beginTransaction();
                try {
                    timelineManager.dispatch(TimelineActions.setPlacementSpeed(clipId, plan.newSpeed));
                    plan.moves.forEach(({ clipId: id, start, duration }) => {
                        timelineManager.dispatch(TimelineActions.updatePlacement(id,
                            duration !== undefined ? { startTime: start, duration } : { startTime: start }));
                    });
                    timelineManager.commitTransaction('Clip Speed');
                } catch (err) {
                    timelineManager.rollbackTransaction();
                    set(s => ({ past: s.past.slice(0, -1) }));
                    console.error('[setClipSpeed] failed, timeline left unchanged:', err);
                    return;
                }

                const tracks = timelineManager.toLegacyTracks();
                set({ tracks, captions: remapWordsForSpeed(state.captions, plan) });

                // Follow the content end when the duration was tracking it.
                const newMaxEnd = maxEnd(tracks);
                if (newMaxEnd > 0 && Math.abs((Number(state.duration) || 0) - oldMaxEnd) < 0.05) {
                    get().setDuration(newMaxEnd);
                }
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

            /**
             * R62 — Graphics/Overlay track.
             *
             * Adds a sticker/logo/shape clip to the (single) 'overlay' track,
             * creating that track on first use. Reuses `addTrack`/`addClip`
             * as-is rather than a bespoke code path, so overlay clips get the
             * exact same persistence, undo history, and duration-sync
             * behaviour every other clip type already has for free.
             *
             * `asset` is whatever the media library already produces for an
             * image (id, url/sourceUrl, name, resolution) — the same shape
             * `addAssetToTimeline` accepts. `kind` selects the clip.type,
             * which `ClipAdapter.inferKind()` maps onto a LAYER_KINDS value
             * (defaults to 'sticker' — a small, positioned graphic, as
             * opposed to 'image' which the adapter treats as a full-bleed
             * background layer).
             */
            addOverlayClip: (asset, opts = {}) => {
                if (!asset) return null;

                // Deliberately NOT calling _saveHistory() here: addTrack() already
                // saves one when it creates a fresh track, and addClip() saves one
                // of its own below. Adding a third save-point here (matching the
                // addAssetToTimeline pattern above, which has the same two-step
                // find-or-create shape) would cost the user two undos to remove
                // one overlay instead of one.
                let track = get().tracks.find(t => t.type === 'overlay');
                const trackId = track ? track.id : get().addTrack('overlay');

                const start = Number.isFinite(opts.start) ? opts.start : get().currentTime;
                const duration = Number.isFinite(opts.duration) ? opts.duration : (asset.duration || 5);

                get().addClip(trackId, {
                    type: opts.kind || 'sticker',
                    assetId: asset.id,
                    name: asset.name || 'Overlay',
                    url: asset.url || asset.sourceUrl,
                    sourceUrl: asset.url || asset.sourceUrl,
                    thumbnail: asset.thumbnail,
                    metadata: asset.resolution ? { resolution: asset.resolution } : {},
                    start,
                    duration,
                    // Centred-ish default (upper-right third) so a freshly added
                    // sticker/logo is visible immediately rather than dead
                    // centre, covering the subject — matches how most editors
                    // default a newly dropped watermark/logo.
                    x: Number.isFinite(opts.x) ? opts.x : 78,
                    y: Number.isFinite(opts.y) ? opts.y : 18,
                    scale: Number.isFinite(opts.scale) ? opts.scale : 1,
                    rotation: 0,
                    opacity: 1,
                });

                return trackId;
            },

            /**
             * R65 — Motion Graphics Components.
             *
             * The store-side half of `client/src/motion/ComponentLibrary.js`.
             * `buildComponent()` is pure — it never touches the store — and
             * returns PLACEMENT DESCRIPTORS; this turns each one into a real
             * `addClip` call on the appropriate track (finding-or-creating it,
             * same as `addOverlayClip`/`addTextOverlay` already do). This is
             * also the function `MediaExecutionEngine.executeStoreAction`'s
             * new `addMotionComponent` case calls — the AI-tool entry point:
             * `{ component: "CTAWidget", preset: "subscribe" }` arrives here
             * as `(componentId, presetId, params)`.
             *
             * ONE history entry for the whole component in the common case
             * (its track(s) already exist) — `_saveHistory()` once up front,
             * every `addClip` call below passes `skipHistory: true`, same
             * fan-out pattern `updateClip`'s `$ALL_CLIPS` and `applyColorGrade`
             * already use. `addTrack()` has no skip-history option and always
             * saves one of its own, so a component whose track(s) don't exist
             * yet costs 2 undo steps instead of 1 the first time — the exact
             * same accepted tradeoff `addOverlayClip`'s own comment documents,
             * not a new compromise introduced here.
             *
             * @param {string} componentId one of ComponentLibrary.COMPONENT_IDS
             * @param {string} presetId a preset key for that component
             * @param {object} [params] component-specific content (text/url/emoji/...)
             * @returns {{success:boolean, error?:string, clipCount?:number}}
             */
            addMotionComponent: (componentId, presetId, params = {}) => {
                let result;
                try {
                    result = buildComponent(componentId, presetId, params);
                } catch (err) {
                    return { success: false, error: `could not build component: ${err.message}` };
                }
                if (!result || !Array.isArray(result.placements) || result.placements.length === 0) {
                    return { success: false, error: result?.error || `component "${componentId}" produced nothing` };
                }

                get()._saveHistory();

                const start = Number.isFinite(Number(params.start)) ? Number(params.start) : get().currentTime;
                let textTrackId = null;
                let overlayTrackId = null;
                const ensureTextTrack = () => {
                    if (textTrackId) return textTrackId;
                    const existing = get().tracks.find(t => t.type === 'text');
                    textTrackId = existing ? existing.id : get().addTrack('text');
                    return textTrackId;
                };
                const ensureOverlayTrack = () => {
                    if (overlayTrackId) return overlayTrackId;
                    const existing = get().tracks.find(t => t.type === 'overlay');
                    overlayTrackId = existing ? existing.id : get().addTrack('overlay');
                    return overlayTrackId;
                };

                let clipCount = 0;
                for (const placement of result.placements) {
                    if (placement.trackType === 'text') {
                        const trackId = ensureTextTrack();
                        get().addClip(trackId, { ...placement.clip, start }, { skipHistory: true });
                        clipCount++;
                    } else if (placement.trackType === 'overlay') {
                        const trackId = ensureOverlayTrack();
                        const a = placement.asset || {};
                        get().addClip(trackId, {
                            type: 'sticker',
                            assetId: a.id,
                            name: a.name || componentId,
                            url: a.url,
                            sourceUrl: a.url,
                            ...placement.clip,
                            start,
                        }, { skipHistory: true });
                        clipCount++;
                    }
                }

                // R66 — every composite component's placements share a groupId
                // (stamped by ComponentLibrary.buildComponent → assignGroupId);
                // surfacing it lets a caller immediately follow up with
                // moveClipGroup/duplicateClipGroup/removeClipGroup. null for
                // the 5 single-clip components, which were never grouped.
                const groupId = result.placements[0]?.clip?.groupId ?? null;
                return { success: true, clipCount, groupId };
            },

            /**
             * R66 — Clip grouping. Three group-aware operations built on the
             * pure `client/src/motion/ClipGrouping.js`, mirroring exactly how
             * `addMotionComponent` above wraps `ComponentLibrary`: the pure
             * module computes WHAT changes, this dispatches it.
             *
             * Every member moves/is-removed/is-duplicated as ONE undo step —
             * `_saveHistory()` once up front, every underlying call passes
             * `{ skipHistory: true }`, the same fan-out shape `updateClip`'s
             * `$ALL_CLIPS` case already uses.
             */
            moveClipGroup: (groupId, delta = {}) => {
                const updates = computeGroupMoveUpdates(get().tracks, groupId, delta);
                if (updates.length === 0) return { success: false, error: `no clips found for group "${groupId}"` };

                get()._saveHistory();
                for (const u of updates) {
                    get().updateClip(u.trackId, u.clipId, u.updates, { skipHistory: true });
                }
                return { success: true, moved: updates.length };
            },

            duplicateClipGroup: (groupId, opts = {}) => {
                const specs = computeGroupDuplicateSpecs(get().tracks, groupId, opts);
                if (specs.length === 0) return { success: false, error: `no clips found for group "${groupId}"` };

                get()._saveHistory();
                let newGroupId = null;
                for (const { trackId, clip } of specs) {
                    newGroupId = clip.groupId;
                    get().addClip(trackId, clip, { skipHistory: true });
                }
                return { success: true, duplicated: specs.length, groupId: newGroupId };
            },

            /**
             * Deletes every clip in a group as one action. Deliberately does
             * NOT call the store's own `removeClip` — that method has a
             * "delete every currently multi-selected clip, not just the one
             * passed" fan-out of its own (see its own body), and looping it
             * per group member could accidentally sweep in whatever else the
             * user has selected at the time. Dispatches the same primitive
             * `removeClip` uses internally instead, and replicates its
             * "clean up now-empty tracks" step so a group delete behaves
             * exactly like an ordinary delete, just for N clips at once.
             */
            removeClipGroup: (groupId) => {
                const members = clipsInGroup(get().tracks, groupId);
                if (members.length === 0) return { success: false, error: `no clips found for group "${groupId}"` };

                get()._saveHistory();
                members.forEach(({ clip }) => {
                    timelineManager.dispatch(TimelineActions.removePlacement(clip.id));
                });

                const currentPlacements = Object.values(timelineManager.getState().entities.placements);
                const currentLayers = Object.values(timelineManager.getState().entities.layers);
                currentLayers.forEach(layer => {
                    if (layer.id === 'track-default-video' || layer.id === 'track-default-audio') return;
                    if (layer.type === 'video' || layer.type === 'audio') return;
                    const hasClips = currentPlacements.some(p => p.layerId === layer.id);
                    if (!hasClips) {
                        timelineManager.dispatch(TimelineActions.removeLayer(layer.id));
                    }
                });

                set({
                    tracks: timelineManager.toLegacyTracks(),
                    activeClipId: null,
                    selectedClipIds: [],
                });
                return { success: true, removed: members.length };
            },

            /**
             * R67 — Object Intelligence Integration. Four actions built on the
             * pure `client/src/motion/ObjectLayers.js`, mirroring how
             * `addMotionComponent`/`moveClipGroup` above wrap their own pure
             * modules: ObjectLayers computes WHAT the crop/segments should be,
             * these dispatch it. The actual SAM2 API call + job polling lives
             * in `MediaExecutionEngine.js`'s `separate_speaker` case (it
             * already owns `resolveAssetServerPath`/`authFetch`/`pollJobResult`
             * for exactly this shape of work — see its `detect_scene` case)
             * and calls `applyLayerSeparation` once the mask/bboxTrack come back.
             */

            /** Store the SAM2 result on a clip. One history step. */
            applyLayerSeparation: (trackId, clipId, { maskAssetUrl, bboxTrack, sourceWidth, sourceHeight } = {}) => {
                if (!maskAssetUrl || !Array.isArray(bboxTrack) || bboxTrack.length === 0) {
                    return { success: false, error: 'applyLayerSeparation: maskAssetUrl and a non-empty bboxTrack are required' };
                }
                get().updateClip(trackId, clipId, {
                    layerMask: { maskAssetUrl, bboxTrack, sourceWidth, sourceHeight, status: 'ready' },
                });
                return { success: true };
            },

            /**
             * "Zoom speaker" / "animate speaker": ONE static crop for the whole
             * clip, reusing the existing virtualCam pipeline unchanged (see
             * ObjectLayers.js's header for why this needs no new render code
             * in either preview or export). `clip.offset` is the source-in
             * point SAM2's bboxTrack timestamps are relative to.
             */
            zoomToSpeaker: (trackId, clipId) => {
                const track = get().tracks.find(t => t.id === trackId);
                const clip = track?.clips?.find(c => c.id === clipId);
                if (!clip) return { success: false, error: `clip "${clipId}" not found on track "${trackId}"` };
                if (!clip.layerMask?.bboxTrack?.length) {
                    return { success: false, error: 'No SAM2 separation on this clip yet — run "separate speaker" first.' };
                }

                const crop = deriveSpeakerCrop(clip.layerMask.bboxTrack, {
                    sourceStart: Number(clip.offset) || 0,
                    duration: Number(clip.duration) || Infinity,
                });
                if (!crop) return { success: false, error: 'Could not derive a crop — no mask samples cover this clip\'s trimmed range.' };

                get().updateClip(trackId, clipId, { virtualCam: crop, layerTarget: 'speaker' });
                return { success: true, crop };
            },

            /**
             * "Track speaker": splits the clip into re-centering pieces (see
             * ObjectLayers.deriveTrackingSegments), each with its own static
             * virtualCam crop — the SAME piece-splitting shape virtual_multicam
             * already uses for per-turn angle changes, applied to subject
             * motion. Replaces the original clip with N new clips as ONE
             * history step (removeClip/addClip below run with skipHistory
             * since this wrapper already called _saveHistory once).
             */
            trackSpeaker: (trackId, clipId, opts = {}) => {
                const track = get().tracks.find(t => t.id === trackId);
                const clip = track?.clips?.find(c => c.id === clipId);
                if (!clip) return { success: false, error: `clip "${clipId}" not found on track "${trackId}"` };
                if (!clip.layerMask?.bboxTrack?.length) {
                    return { success: false, error: 'No SAM2 separation on this clip yet — run "separate speaker" first.' };
                }

                const sourceOffset = Number(clip.offset) || 0;
                const timelineStart = Number(clip.start) || 0;
                const duration = Number(clip.duration) || 0;
                const segments = deriveTrackingSegments(clip.layerMask.bboxTrack, {
                    sourceStart: sourceOffset,
                    duration,
                    ...opts,
                });
                if (segments.length === 0) {
                    return { success: false, error: 'Could not derive tracking segments — no mask samples cover this clip\'s trimmed range.' };
                }
                if (segments.length === 1) {
                    // Nothing to split — the subject never drifted past threshold.
                    // Falls back to the single-crop path so the caller still gets a result.
                    return get().zoomToSpeaker(trackId, clipId);
                }

                get()._saveHistory();
                get().removeClip(trackId, clipId, { skipHistory: true });

                let pieceCursor = timelineStart;
                let created = 0;
                for (const seg of segments) {
                    const pieceDuration = seg.end - seg.start;
                    if (!(pieceDuration > 0)) continue;
                    get().addClip(trackId, {
                        ...clip,
                        id: `${clipId}-track-${Math.round(seg.start * 1000)}`,
                        start: pieceCursor,
                        duration: pieceDuration,
                        offset: seg.start,
                        virtualCam: seg.crop,
                        layerTarget: 'speaker',
                        groupId: null, // a tracking split is not a Motion Graphics component group
                    }, { skipHistory: true });
                    pieceCursor += pieceDuration;
                    created++;
                }

                return { success: true, segments: created };
            },

            /**
             * "Blur background": no crop math — this only flags WHICH side of
             * the mask an effect should apply to. The actual blur compositing
             * is a genuinely new render primitive (see
             * client/src/components/Player/ObjectLayerOverlay.jsx for preview,
             * jobs/exportProcessor.js's buildBackgroundBlurFilter for export) —
             * this action just makes `clip.layerTarget` the thing both of
             * those read.
             */
            setLayerTarget: (trackId, clipId, target) => {
                if (target !== null && target !== 'speaker' && target !== 'background') {
                    return { success: false, error: `invalid layerTarget "${target}"` };
                }
                const track = get().tracks.find(t => t.id === trackId);
                const clip = track?.clips?.find(c => c.id === clipId);
                if (!clip) return { success: false, error: `clip "${clipId}" not found on track "${trackId}"` };
                if (target && !clip.layerMask?.bboxTrack?.length) {
                    return { success: false, error: 'No SAM2 separation on this clip yet — run "separate speaker" first.' };
                }
                get().updateClip(trackId, clipId, { layerTarget: target });
                return { success: true };
            },

            removeTrack: (trackId) => {
                get()._saveHistory();
                timelineManager.dispatch(TimelineActions.removeLayer(trackId));
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

                // Regenerating captions (re-running "Generate captions", the
                // short-circuit re-derive path, or any retry) used to be purely
                // ADDITIVE: nothing here ever removed the PREVIOUS auto-generated
                // batch, so every re-run stacked a second full set of caption
                // clips on top of the first, overlapping in time — the exact
                // "captions come out double" symptom. Manually-added text
                // overlays (`addTextOverlay`, id prefix `text-`) and any other
                // text-track content are untouched; only clips this function
                // itself created (id prefix `caption-`) are cleared before the
                // new batch goes in, so regeneration REPLACES its own prior
                // output instead of piling onto it.
                //
                // The style-inheritance snapshot below is taken from the OLD
                // batch BEFORE it's removed — this is also what fixes the
                // accompanying "wrong font" symptom: previously each duplicate
                // run re-read `textTrack.clips[0]` from a stale pre-transaction
                // snapshot, which after several regenerations could resolve to
                // whichever old clip happened to sit first rather than the
                // clip carrying the user's actual current font choice. Captured
                // once, up front, it unambiguously reflects the batch that was
                // on the timeline the moment this call started.
                const priorCaptionClips = (textTrack.clips || []).filter(c => c.id.startsWith('caption-'));
                const existingTextClip = priorCaptionClips[0] || textTrack?.clips?.[0];

                // ── ONE transaction → ONE timeline event → ONE React render ──
                timelineManager.beginTransaction();
                try {
                    for (const old of priorCaptionClips) {
                        timelineManager.dispatch(TimelineActions.removePlacement(old.id));
                    }

                    captions.forEach((cap, i) => {
                        const clipId = `caption-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`;
                        // Clamp end to the next caption's start so ASR timing jitter never
                        // causes two clips to be active at the same time (overlap bug).
                        const nextStart = captions[i + 1]?.start;
                        const clampedEnd = nextStart != null
                            ? Math.min(cap.end || 0, nextStart)
                            : (cap.end || 0);
                        const duration = Math.max(0.3, clampedEnd - (cap.start || 0));

                        // Add the clip entity (metadata / visual properties)
                        // Preserve any existing global style from the text track (so style
                        // card picks survive re-captioning), otherwise use Vibed defaults.
                        timelineManager.dispatch(TimelineActions.addClip({
                            id: clipId,
                            name: cap.text,
                            content: cap.text,
                            type: 'text',
                            position: 'bottom',
                            style: 'subtitle',
                            // Vibed caption defaults — inherit existing style if already set
                            fontFamily:    existingTextClip?.fontFamily  || 'Anton',
                            fontWeight:    existingTextClip?.fontWeight  || 900,
                            fontSize:      existingTextClip?.fontSize    || 48,
                            fontStyle:     existingTextClip?.fontStyle   || 'normal',
                            color:         existingTextClip?.color       || '#FACC15',
                            textShadow:    existingTextClip?.textShadow  !== undefined
                                               ? existingTextClip.textShadow
                                               : '2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 0 3px 6px rgba(0,0,0,0.6)',
                            stroke:        existingTextClip?.stroke      !== undefined
                                               ? existingTextClip.stroke
                                               : { width: 2, color: '#000000' },
                            textAlign:     existingTextClip?.textAlign   || 'center',
                            animation:     existingTextClip?.animation   || 'none',
                            // Motion Graphics engine (R58). `cap.words` now arrives
                            // populated from groupWordsIntoCaptions → the caption
                            // model's groupWordsIntoSegments; before R58 the word
                            // array was discarded during grouping and captions were
                            // line-level only. Carried onto the clip so per-word
                            // highlighting can resolve without re-reading the
                            // transcript (which may have been dropped from storage
                            // under size pressure — see DROP_ORDER).
                            // Times are ABSOLUTE, same clock as start/duration.
                            words:         Array.isArray(cap.words) ? cap.words : undefined,
                            captionStyle:  existingTextClip?.captionStyle,
                            animations:    existingTextClip?.animations,
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

            copyAttributes: (clipId) => {
                const tracks = timelineManager.toLegacyTracks();
                for (const track of tracks) {
                    const clip = track.clips.find(c => c.id === clipId);
                    if (clip) {
                        const ATTR_KEYS = ['scale', 'x', 'y', 'rotation', 'opacity', 'grading', 'filter', 'volume', 'speed', 'transition', 'denoise', 'enhance'];
                        const attrs = {};
                        for (const k of ATTR_KEYS) {
                            if (clip[k] !== undefined) attrs[k] = clip[k];
                        }
                        set({ copiedAttributes: attrs });
                        return;
                    }
                }
            },

            pasteAttributes: (trackId, clipId) => {
                const { copiedAttributes } = get();
                if (!copiedAttributes) return;
                get()._saveHistory();
                get().updateClip(trackId, clipId, { ...copiedAttributes });
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

                // Only snapshots that opted in (rippleDeleteClip) carry _extraState.
                if (previous._extraState) {
                    currentSnapshot._extraState = { captions: state.captions, duration: state.duration };
                }

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
                    future: [currentSnapshot, ...state.future],
                    ...(previous._extraState || {}),
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

                if (next._extraState) {
                    currentSnapshot._extraState = { captions: state.captions, duration: state.duration };
                }

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
                    future: newFuture,
                    ...(next._extraState || {}),
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
                    transcriptionAttempted: state.transcriptionAttempted,
                    assets: sanitizedAssets,
                    uploadedFilePath: state.uploadedFilePath || null,

                    // ── Expensive AI results ──────────────────────────────────
                    // Every field below is the output of a slow and/or paid
                    // operation. None of them used to be persisted, so each one
                    // was silently recomputed on every reload:
                    //   transcripts          — Whisper (paid, slow)
                    //   diarizationByAsset   — 1–5 min diarize job PER ASSET
                    //   sceneAnalysisByAsset — GPT-4o Vision call per asset
                    //   speakerMap           — split_speakers output
                    //   contentAnalysis      — ContentAnalyzer / GPT-4o
                    //   editHistory          — the Editorial Brain's memory (R19)
                    //   waveforms            — ffmpeg peak extraction
                    // That single omission is what produced "the transcript
                    // disappeared", "it re-ran diarization", "the Brain forgot
                    // what I did" and "the waveform vanished after a refresh"
                    // as four separate-looking bugs. They are one bug.
                    captionsFilePath:     state.captionsFilePath || null,
                    transcripts:          state.transcripts || {},
                    transcriptVerified:   state.transcriptVerified || {},
                    contentAnalysis:      state.contentAnalysis || null,
                    speakerMap:           state.speakerMap || {},
                    diarizationByAsset:   state.diarizationByAsset || {},
                    sceneAnalysisByAsset: state.sceneAnalysisByAsset || {},
                    editHistory:          state.editHistory || [],
                    waveforms:            state.waveforms || {},
                    waveformsByAsset:     state.waveformsByAsset || {},
                };

                // ── Tiered write ──────────────────────────────────────────────
                // The AI blobs above are large — word-level transcripts and
                // waveform peak arrays for a long interview can run to several
                // MB, and localStorage caps at ~5 MB per origin. The previous
                // `catch (_) {}` swallowed QuotaExceededError silently, which
                // would now mean a quota overflow loses the TIMELINE too — a
                // strictly worse failure than the one being fixed.
                //
                // So: try the full payload, and on overflow progressively drop
                // the heaviest recomputable fields rather than the edit itself.
                // Order is cheapest-to-lose first — waveforms regenerate from a
                // local ffmpeg call, transcripts cost real money.
                const DROP_ORDER = ['waveforms', 'waveformsByAsset', 'sceneAnalysisByAsset', 'diarizationByAsset', 'transcripts'];
                let payload = projectData;
                for (let attempt = 0; attempt <= DROP_ORDER.length; attempt++) {
                    try {
                        localStorage.setItem('vp_autosave', JSON.stringify(payload));
                        if (attempt > 0) {
                            console.warn(
                                `[useTimelineStore] autosave over quota — persisted without: ` +
                                `${DROP_ORDER.slice(0, attempt).join(', ')}. The timeline itself is saved.`
                            );
                        }
                        break;
                    } catch (err) {
                        if (attempt === DROP_ORDER.length) {
                            // Even the stripped payload doesn't fit. Say so —
                            // this is the one case where the user genuinely can
                            // lose work, and it must not fail silently.
                            console.error('[useTimelineStore] autosave FAILED — localStorage is full:', err?.message);
                            break;
                        }
                        payload = { ...payload, [DROP_ORDER[attempt]]: Array.isArray(payload[DROP_ORDER[attempt]]) ? [] : {} };
                    }
                }

                // Always return the COMPLETE payload, not the stripped one — the
                // Supabase mirror (useSupabasePersistence) has no 5 MB ceiling,
                // so a localStorage overflow must not degrade the cloud copy.
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
                    transcriptionAttempted: projectData.transcriptionAttempted || false,

                    // Mirror of the AI-result fields added to saveProject above.
                    // This is the path Supabase-loaded projects take (EditorPage
                    // → loadProject), as distinct from the synchronous
                    // localStorage pre-restore at the top of this file. BOTH
                    // must carry these fields or a cloud-loaded project silently
                    // starts with no transcript while a locally-restored one has
                    // it — the kind of split-brain that reads as "sometimes it
                    // remembers, sometimes it doesn't".
                    //
                    // Each falls back to the CURRENT in-memory value rather than
                    // a hard empty: an older project saved before this change has
                    // no such keys, and blanking a transcript the user just
                    // generated would reintroduce the exact bug being fixed.
                    captionsFilePath:     projectData.captionsFilePath     ?? get().captionsFilePath,
                    transcripts:          projectData.transcripts          ?? get().transcripts,
                    transcriptVerified:   projectData.transcriptVerified   ?? get().transcriptVerified,
                    contentAnalysis:      projectData.contentAnalysis      ?? get().contentAnalysis,
                    speakerMap:           projectData.speakerMap           ?? get().speakerMap,
                    diarizationByAsset:   projectData.diarizationByAsset   ?? get().diarizationByAsset,
                    sceneAnalysisByAsset: projectData.sceneAnalysisByAsset ?? get().sceneAnalysisByAsset,
                    editHistory:          projectData.editHistory          ?? get().editHistory,
                    waveforms:            projectData.waveforms            ?? get().waveforms,
                    waveformsByAsset:     projectData.waveformsByAsset     ?? get().waveformsByAsset,

                    activeClipId: null,
                    currentTime: 0,
                    past: [],
                    future: [],
                };
                // FIX: was `if (projectData.assets?.length) updates.assets = ...` —
                // an EMPTY array still has `.length === 0`, which is falsy, so
                // `updates.assets` was never set for a brand-new or genuinely
                // empty project. Zustand's `set()` shallow-merges, so the
                // previous project's `assets` array survived untouched in the
                // store — "New Project" (and any saved project with zero
                // assets) opened showing the last project's media bin. Unlike
                // the transcript/caption fields above (which fall back to the
                // in-memory value on purpose, for older projects saved before
                // those keys existed), a project's asset list is foundational
                // and always has a definite value — there's no case where
                // "assets missing from the payload" should mean "keep
                // whatever was already loaded". Always set it, defaulting to
                // empty, exactly like tracks/duration/captions above.
                updates.assets = projectData.assets || [];
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
                    const cSrcEnd   = cSrcStart + (clip.duration ?? 0);

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
                            id:       `${clip.id}-R`,
                            offset:   srcEnd,
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
