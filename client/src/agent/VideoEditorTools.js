import useTimelineStore from '../store/useTimelineStore.js';
import { performSilenceRemoval, performFillerRemoval, performAudioDenoise, performAudioNormalization } from '../services/autoEditService.js';
import { ContentAnalyzer } from './ContentAnalyzer.js';
import { LongFormEditPlanner } from './LongFormEditPlanner.js';

/**
 * VideoEditorTools
 * Defines the available tools for the Autonomous Agent.
 * Follows the Command Pattern for Reversibility (Undo).
 */

export const TOOL_DEFINITIONS = [
    // --- Editing Tools ---
    {
        name: "cut_clip",
        description: "Splits a clip into two parts at a specific time.",
        parameters: {
            type: "object",
            properties: {
                clipId: { type: "string", description: "ID of the clip to split" },
                time: { type: "number", description: "Timestamp to split at (in seconds)" },
                trackId: { type: "string", description: "ID of the track containing the clip" }
            },
            required: ["clipId", "time", "trackId"]
        }
    },
    {
        name: "remove_clip",
        description: "Removes a clip from the timeline.",
        parameters: {
            type: "object",
            properties: {
                clipId: { type: "string", description: "ID of the clip to remove" },
                trackId: { type: "string", description: "ID of the track containing the clip" }
            },
            required: ["clipId", "trackId"]
        }
    },
    {
        name: "move_clip",
        description: "Moves a clip to a new start time.",
        parameters: {
            type: "object",
            properties: {
                clipId: { type: "string", description: "ID of the clip to move" },
                trackId: { type: "string", description: "ID of the track containing the clip" },
                newStart: { type: "number", description: "New start time (in seconds)" }
            },
            required: ["clipId", "trackId", "newStart"]
        }
    },
    {
        name: "set_clip_speed",
        description: "Changes the playback speed of a clip.",
        parameters: {
            type: "object",
            properties: {
                clipId: { type: "string", description: "ID of the clip" },
                trackId: { type: "string", description: "ID of the track" },
                speed: { type: "number", description: "Playback speed (e.g., 0.5, 1.0, 2.0)" }
            },
            required: ["clipId", "trackId", "speed"]
        }
    },

    // --- AI & Audio Tools ---
    {
        name: "silence_removal",
        description: "Automatically detects and removes silent parts from the video.",
        parameters: {
            type: "object",
            properties: {
                threshold: { type: "string", description: "Silence threshold (default: -30dB)" }
            }
        }
    },
    {
        name: "remove_filler_words",
        description: "Automatically detects and removes filler words (ums, uhs) from the video.",
        parameters: { type: "object", properties: {} }
    },
    {
        name: "denoise_audio",
        description: "Removes background noise from the audio.",
        parameters: { type: "object", properties: {} }
    },
    {
        name: "normalize_audio",
        description: "Normalizes audio levels to standard loudness.",
        parameters: { type: "object", properties: {} }
    },
    {
        name: "sync_clips_to_beat",
        description: "Automatically cuts video clips at detected beat markers.",
        parameters: { type: "object", properties: {} }
    },

    // --- Visual & Project Tools ---
    {
        name: "set_aspect_ratio",
        description: "Changes the project aspect ratio (e.g., '16:9', '9:16', '1:1').",
        parameters: {
            type: "object",
            properties: {
                ratio: { type: "string", enum: ["16:9", "9:16", "1:1"], description: "Target aspect ratio" }
            },
            required: ["ratio"]
        }
    },
    {
        name: "color_grade_clip",
        description: "Applies a color preset or filter to a clip.",
        parameters: {
            type: "object",
            properties: {
                clipId: { type: "string", description: "ID of the clip" },
                trackId: { type: "string", description: "ID of the track" },
                preset: { type: "string", enum: ["cinematic", "vibrant", "bw", "warm", "cool"], description: "Color preset name" }
            },
            required: ["clipId", "trackId", "preset"]
        }
    },
    {
        name: "add_text_overlay",
        description: "Adds a text overlay to the timeline.",
        parameters: {
            type: "object",
            properties: {
                text: { type: "string", description: "Content of the text" },
                start: { type: "number", description: "Start time (seconds)" },
                duration: { type: "number", description: "Duration (seconds)" }
            },
            required: ["text", "start", "duration"]
        }
    },

    // --- Track Control Tools ---
    {
        name: "set_track_volume",
        description: "Sets the volume for a specific track.",
        parameters: {
            type: "object",
            properties: {
                trackId: { type: "string", description: "ID of the track" },
                volume: { type: "number", description: "Volume level (0.0 to 1.0)" }
            },
            required: ["trackId", "volume"]
        }
    },
    {
        name: "mute_track",
        description: "Mutes or unmutes a specific track.",
        parameters: {
            type: "object",
            properties: {
                trackId: { type: "string", description: "ID of the track" },
                muted: { type: "boolean", description: "True to mute, False to unmute" }
            },
            required: ["trackId", "muted"]
        }
    },

    // --- Playback Controls ---
    {
        name: "seek_to",
        description: "Moves the playhead to a specific time.",
        parameters: {
            type: "object",
            properties: {
                time: { type: "number", description: "Time in seconds" }
            },
            required: ["time"]
        }
    },
    {
        name: "undo_action",
        description: "Undoes the last action.",
        parameters: { type: "object", properties: {} }
    },

    // --- Long-Form Intelligence Engine Tools ---
    {
        name: "analyze_structure",
        description: "Analyzes video content semantically — detects content type, segments the video by topic, finds the best hook, and identifies key narrative sections (Intro, Body, Outro). Does NOT execute any edits. Returns a full content analysis for user approval.",
        parameters: {
            type: "object",
            properties: {
                platform: { type: "string", enum: ["youtube", "podcast", "tiktok", "instagram", null], description: "Target platform (affects edit mode selection)" },
                targetDuration: { type: "number", description: "Desired output duration in seconds (optional)" }
            }
        }
    },
    {
        name: "long_form_edit",
        description: "Generates and executes a full long-form edit plan based on prior content analysis. Includes silence removal, hook placement, segment reordering, repetition removal, and transitions. Always requires user approval before executing.",
        parameters: {
            type: "object",
            properties: {
                editMode: { type: "string", enum: ["FULL_BUILD", "CLEAN_EDIT", "YOUTUBE_OPTIMIZED"], description: "Edit mode to apply" },
                platform: { type: "string", description: "Target platform" },
                targetDuration: { type: "number", description: "Desired output duration in seconds" }
            }
        }
    },
    {
        name: "reorder_segment",
        description: "Moves a clip or segment to a new position in the timeline for structural rebuilding (e.g., moving the hook to position 0).",
        parameters: {
            type: "object",
            properties: {
                clipId: { type: "string", description: "ID of the clip/placement to move" },
                trackId: { type: "string", description: "ID of the track containing the clip" },
                targetPosition: { type: "number", description: "Target start time in seconds (0 = beginning of timeline)" }
            },
            required: ["clipId", "trackId", "targetPosition"]
        }
    }
];

export class VideoEditorTools {
    // Always read fresh state — never cache a snapshot
    get store() {
        return useTimelineStore.getState();
    }

    // Helper: Robustly find track and clip
    resolveTrackAndClip(trackId, clipId) {
        console.log(`🔍 Resolving Track/Clip: trackId=${trackId}, clipId=${clipId}`);
        let track = this.store.tracks.find(t => t.id === trackId);
        if (!track) {
            // Try to find track containing the clip
            console.log(`   Track ${trackId} not found directly. Searching by clipId...`);
            track = this.store.tracks.find(t => t.clips.some(c => c.id === clipId));
        }
        if (!track) {
            // Default to first video track
            console.log(`   Track still not found. Defaulting to first video track.`);
            track = this.store.tracks.find(t => t.type === 'video');
        }

        if (!track) {
            console.error(`❌ Track Resolution Failed: Could not find track ${trackId} or any default.`);
            throw new Error(`Track ${trackId} not found.`);
        }
        console.log(`   Found Track: ${track.id} (${track.type})`);

        // Find clip
        let clip = track.clips.find(c => c.id === clipId);

        // If clip not found by ID, and activeClipId is set, try that?
        // Or if clipId is generic 'clip-1' and we have clips...
        if (!clip && track.clips.length > 0) {
            // Heuristic: If we only have 1 clip, use it.
            if (track.clips.length === 1) {
                console.log(`   Clip ${clipId} not found. Using the only available clip: ${track.clips[0].id}`);
                clip = track.clips[0];
            }
        }

        if (!clip) {
            console.error(`❌ Clip Resolution Failed: Could not find clip ${clipId} in track ${track.id}. Available clips:`, track.clips.map(c => c.id));
            throw new Error(`Clip ${clipId} not found.`);
        }
        console.log(`   Found Clip: ${clip.id}`);

        return { track, clip };
    }

    async execute(action) {
        console.log(`\n🔧 [VideoEditorTools] Executing Tool: ${action.name}`, JSON.stringify(action.args));

        // Helper to get main filename
        const getFilename = () => {
            const state = useTimelineStore.getState();
            if (state.uploadedFile && state.uploadedFile.name) return state.uploadedFile.name;
            const videoTrack = state.tracks.find(t => t.type === 'video');
            if (videoTrack && videoTrack.clips.length > 0) return videoTrack.clips[0].name;
            throw new Error("No file found to process.");
        };

        switch (action.name) {
            // Editing
            case 'cut_clip': return this.cutClip(action.args);
            case 'remove_clip': return this.removeClip(action.args);
            case 'move_clip': return this.moveClip(action.args);
            case 'set_clip_speed': return this.setClipSpeed(action.args);

            // AI / Audio
            case 'silence_removal': return await performSilenceRemoval(getFilename(), action.args?.threshold);
            case 'remove_filler_words': return await performFillerRemoval(getFilename());
            case 'denoise_audio': return await performAudioDenoise(getFilename());
            case 'normalize_audio': return await performAudioNormalization(getFilename());
            case 'sync_clips_to_beat': return this.syncClipsToBeats();

            // Visual / Project
            case 'set_aspect_ratio': return this.setAspectRatio(action.args);
            case 'color_grade_clip': return this.colorGradeClip(action.args);
            case 'add_text_overlay': return this.addTextOverlay(action.args);

            // Tracks
            case 'set_track_volume': return this.setTrackVolume(action.args);
            case 'mute_track': return this.muteTrack(action.args);

            // Playback
            case 'seek_to': return this.seekTo(action.args);
            case 'undo_action': return this.undo();

            // Long-Form Intelligence Engine
            case 'analyze_structure': return await this.analyzeStructure(action.args);
            case 'long_form_edit': return await this.longFormEdit(action.args);
            case 'find_hook': return this.findHook();
            case 'remove_repetition': return await this.removeRepetition(action.args);
            case 'reorder_segment': return this.reorderSegment(action.args);
            case 'cut_segment': return this.cutSegment(action.args);

            default:
                throw new Error(`Unknown tool: ${action.name}`);
        }
    }

    // --- Tool Implementations ---

    cutClip({ clipId, time, trackId }) {
        let track = this.store.tracks.find(t => t.id === trackId);

        // Fallback: If track not found, try to find ANY track with that clip
        if (!track) {
            track = this.store.tracks.find(t => t.clips.some(c => c.id === clipId));
        }

        // Fallback 2: Default to first video track if still nothing
        if (!track) {
            track = this.store.tracks.find(t => t.type === 'video');
            if (track) console.warn(`Tool: Track ${trackId} not found, defaulting to ${track.id}`);
        }

        if (!track) throw new Error(`Track ${trackId} not found and no default available.`);

        let clip = track.clips.find(c => c.id === clipId);

        // Fallback 3: Find clip at the specific timestamp
        if (!clip) {
            console.warn(`Tool: Clip ${clipId} not found. Searching for clip at time ${time}s...`);
            clip = track.clips.find(c => time >= c.start && time < c.start + c.duration);
        }

        if (!clip) throw new Error(`Clip ${clipId} not found and no clip exists at time ${time}s.`);

        const validTime = Math.max(clip.start + 0.01, Math.min(clip.start + clip.duration - 0.01, time));
        if (time !== validTime) time = validTime;

        this.store.splitClip(track.id, clip.id, time);
        return { success: true, message: `Split clip ${clip.id} at ${time}s` };
    }

    removeClip({ clipId, trackId }) {
        try {
            const { track, clip } = this.resolveTrackAndClip(trackId, clipId);
            this.store.removeClip(track.id, clip.id);
            return { success: true, message: `Removed clip ${clip.id}` };
        } catch (e) {
            // Keep original error logic if heuristic fails
            throw e;
        }
    }

    moveClip({ clipId, trackId, newStart }) {
        const { track, clip } = this.resolveTrackAndClip(trackId, clipId);
        this.store.updateClip(track.id, clip.id, { start: newStart });
        return { success: true, message: `Moved clip ${clipId} to ${newStart}s` };
    }

    setClipSpeed({ clipId, trackId, speed }) {
        const { track, clip } = this.resolveTrackAndClip(trackId, clipId);
        this.store.setClipSpeed(track.id, clip.id, speed);
        return { success: true, message: `Set clip speed to ${speed}x` };
    }

    syncClipsToBeats() {
        this.store.syncClipsToBeats();
        return { success: true, message: "Synced clips to extracted beat markers." };
    }

    setAspectRatio({ ratio }) {
        this.store.setAspectRatio(ratio);
        return { success: true, message: `Set aspect ratio to ${ratio}` };
    }

    colorGradeClip({ clipId, trackId, preset }) {
        const { track, clip } = this.resolveTrackAndClip(trackId, clipId);

        // Map presets to Tailwind classes or filter values
        const presetMap = {
            'cinematic': { filter: 'contrast(1.2) saturate(1.1) brightness(0.9)' },
            'vibrant': { filter: 'saturate(1.5) contrast(1.1)' },
            'bw': { filter: 'grayscale(1)' },
            'warm': { filter: 'sepia(0.3)' },
            'cool': { filter: 'hue-rotate(180deg) opacity(0.9)' }
        };
        const updates = { filter: presetMap[preset]?.filter || '' };

        this.store.updateClip(track.id, clip.id, updates);
        return { success: true, message: `Applied '${preset}' look to clip.` };
    }

    addTextOverlay({ text, start, duration }) {
        this.store.addTextOverlay(text, 'center', duration || 5);
        return { success: true, message: `Added text "${text}" at ${start}s` };
    }

    setTrackVolume({ trackId, volume }) {
        // Simple track resolution
        let track = this.store.tracks.find(t => t.id === trackId);
        if (!track) track = this.store.tracks.find(t => t.type === 'audio'); // Default to audio
        if (!track) track = this.store.tracks[0];

        if (track) {
            this.store.updateTrackVolume(track.id, volume);
            return { success: true, message: `Set track ${track.id} volume to ${volume}` };
        }
        throw new Error("Track not found");
    }

    muteTrack({ trackId, muted }) {
        // Simple resolution
        const track = this.store.tracks.find(t => t.id === trackId);
        if (track && track.muted !== muted) {
            this.store.toggleTrackMute(trackId);
            return { success: true, message: `Set track ${trackId} mute to ${muted}` };
        }
        // If not found, ignore or default
        return { success: true, message: `Track mute unchanged.` };
    }

    seekTo({ time }) {
        this.store.seek(time);
        return { success: true, message: `Seeked to ${time}s` };
    }

    undo() {
        this.store.undo();
        return { success: true, message: "Undid last action." };
    }

    // ── Long-Form Tool Implementations ───────────────────────────────────────

    /**
     * Run ContentAnalyzer and return the full analysis for approval.
     */
    async analyzeStructure({ platform = null, targetDuration = null } = {}) {
        console.log('[VideoEditorTools] Running ContentAnalyzer...');
        const result = await ContentAnalyzer.analyze({ platform, targetDuration });
        return {
            success: result.success,
            message: result.success
                ? `Content analysis complete: ${result.segments?.length || 0} segments detected.`
                : `Analysis failed: ${result.error}`,
            analysisResult: result,
            requiresApproval: true,
        };
    }

    /**
     * Generate LongFormEditPlanner plan from cached ContentAnalyzer result.
     * Returns the plan for approval — does NOT execute it.
     */
    async longFormEdit({ editMode, platform, targetDuration } = {}) {
        console.log('[VideoEditorTools] Building LongFormEditPlanner plan...');

        // Get cached analysis from store
        let analysis = ContentAnalyzer.getCachedAnalysis();

        // If no cached analysis, run it now
        if (!analysis?.success) {
            console.log('[VideoEditorTools] No cached analysis. Running ContentAnalyzer first...');
            analysis = await ContentAnalyzer.analyze({ platform, targetDuration });
        }

        // Override editMode if specified
        if (editMode && analysis) {
            analysis = { ...analysis, editMode };
        }

        const plan = LongFormEditPlanner.generatePlan(analysis, { platform, targetDuration });

        return {
            success: true,
            message: plan.error || `Long-form edit plan ready: ${plan.step_count} steps.`,
            editPlan: plan,
            approvalMessage: plan.approvalMessage,
            requiresApproval: true,
        };
    }

    /**
     * Find the best hook from the cached content analysis.
     */
    findHook() {
        const analysis = ContentAnalyzer.getCachedAnalysis();
        const hook = analysis?.structure?.hookCandidate || analysis?.structure?.hook || null;

        if (hook) {
            this.store.seek(hook.start);
            return {
                success: true,
                message: `Hook found at ${hook.start.toFixed(0)}s–${hook.end.toFixed(0)}s`,
                hookCandidate: hook,
            };
        }

        return {
            success: false,
            message: 'No hook candidate found. Run content analysis first.',
            hookCandidate: null,
        };
    }

    /**
     * Remove repetitive / low-value segments from the timeline.
     */
    async removeRepetition({ importance_threshold = 0.3 } = {}) {
        const analysis = ContentAnalyzer.getCachedAnalysis();
        if (!analysis?.segments) {
            return { success: false, message: 'No content analysis available. Run analyze_structure first.' };
        }

        const lowValueSegs = analysis.segments.filter(
            s => s.importance_score < importance_threshold || s.type === 'filler'
        );

        let removedCount = 0;
        for (const seg of lowValueSegs) {
            try {
                this.cutSegment({ start: seg.start, end: seg.end });
                removedCount++;
            } catch (e) {
                console.warn(`[VideoEditorTools] Could not cut segment ${seg.start}–${seg.end}:`, e.message);
            }
        }

        return {
            success: true,
            message: `Removed ${removedCount} low-value segment(s).`,
            removedCount,
        };
    }

    /**
     * Move a clip to a new timeline position (for narrative reordering).
     */
    reorderSegment({ clipId, trackId, targetPosition }) {
        const store = this.store;
        store._saveHistory();

        const { track, clip } = this.resolveTrackAndClip(trackId, clipId);

        // Shift all clips that were at or after targetPosition to make room
        const shiftAmount = clip.duration;
        const clipsToShift = track.clips
            .filter(c => c.id !== clip.id && c.start >= targetPosition)
            .sort((a, b) => a.start - b.start);

        // Move the target clip to the front
        store.updateClip(track.id, clip.id, { start: targetPosition }, { skipHistory: true });

        // Ripple shift other clips
        clipsToShift.forEach(c => {
            store.updateClip(track.id, c.id, { start: c.start + shiftAmount }, { skipHistory: true });
        });

        return {
            success: true,
            message: `Moved clip "${clip.name}" to position ${targetPosition.toFixed(1)}s`,
        };
    }

    /**
     * Cut out a time range from the timeline.
     */
    cutSegment({ start, end }) {
        const store = this.store;
        const videoTrack = store.tracks.find(t => t.type === 'video');
        if (!videoTrack) return { success: false, message: 'No video track found' };

        // Find clips that overlap with [start, end]
        const overlapping = videoTrack.clips.filter(c =>
            c.start < end && (c.start + c.duration) > start
        );

        overlapping.forEach(clip => {
            const clipEnd = clip.start + clip.duration;

            if (clip.start >= start && clipEnd <= end) {
                // Clip is fully inside the segment — remove it
                store.removeClip(videoTrack.id, clip.id);
            } else if (clip.start < start && clipEnd > end) {
                // Clip spans the entire segment — split twice
                store.splitClip(videoTrack.id, clip.id, start);
                // Find the new clip after split
                const newTracks = useTimelineStore.getState().tracks;
                const newTrack = newTracks.find(t => t.id === videoTrack.id);
                const middleClip = newTrack?.clips.find(c => c.start >= start && (c.start + c.duration) <= end + 0.5);
                if (middleClip) store.removeClip(videoTrack.id, middleClip.id);
            } else if (clip.start < start) {
                // Clip overlaps at end — trim end
                store.updateClip(videoTrack.id, clip.id, { duration: start - clip.start });
            } else {
                // Clip overlaps at start — trim start
                const newStart = end;
                store.updateClip(videoTrack.id, clip.id, { start: newStart, duration: clipEnd - newStart });
            }
        });

        return { success: true, message: `Cut segment ${start.toFixed(1)}s–${end.toFixed(1)}s` };
    }
}
