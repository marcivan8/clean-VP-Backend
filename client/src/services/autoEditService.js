import useTimelineStore from '../store/useTimelineStore';
import { mediaBunnyService } from './MediaBunnyService.js';

const API_SILENCE = '/api/silence/detect';

/**
 * Get the source file from the editor store for client-side processing.
 * Falls back to null if no file is available (backend will use filename instead).
 */
function getSourceFile() {
    const state = useTimelineStore.getState();
    return state.uploadedFile || null;
}

/**
 * Extract audio from the uploaded video using mediabunny (client-side).
 * Returns an audio Blob that can be sent to backend for analysis,
 * or used directly for Web Audio API processing.
 */
export const performAudioExtraction = async () => {
    try {
        const sourceFile = getSourceFile();
        if (!sourceFile) throw new Error('No uploaded file available for audio extraction');

        console.log('🤖 Agent: Extracting audio client-side via mediabunny');
        const audioBlob = await mediaBunnyService.extractAudio(sourceFile);

        return { success: true, audioBlob, message: `Audio extracted: ${(audioBlob.size / 1024).toFixed(1)} KB` };
    } catch (error) {
        console.error('Audio Extraction Error:', error);
        return { success: false, error: error.message };
    }
};

/**
 * Auto-Edit Service (The "Hands" of the Agent)
 * Executes complex macro-edits based on AI instructions.
 */

export const performSilenceRemoval = async (filename, threshold = '-30dB') => {
    try {
        const { tracks, updateClip, addClip, removeClip } = useTimelineStore.getState();
        const videoTrack = tracks.find(t => t.type === 'video');
        if (!videoTrack || videoTrack.clips.length === 0) throw new Error("No video clip to analyze");

        // Assume we process the first clip or the "main" file
        // In a real app we'd upload the specific clip's file or use its source ID
        // For MVP we use the filename passed

        console.log("🤖 Agent: Requesting Silence Analysis for", filename);

        const response = await fetch(API_SILENCE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename, threshold })
        });

        if (!response.ok) throw new Error("Silence detection failed on server");
        const data = await response.json();

        // Execution Strategy:
        // 1. Clear existing clips (or just the one being processed)
        // 2. Create NEW clips for each "Active Segment"
        // 3. Place them sequentially (Jump Cut style)

        const activeSegments = data.activeSegments;
        if (!activeSegments || activeSegments.length === 0) return { success: false, message: "No active speech found" };

        const parentClip = videoTrack.clips[0]; // Assuming single main clip for now

        // Remove original
        removeClip(videoTrack.id, parentClip.id);

        // Add chopped segments
        // We need to keep a running "timeline cursor" to stack them
        let timelineCursor = 0;

        activeSegments.forEach((seg, idx) => {
            addClip(videoTrack.id, {
                id: `auto-cut-${Date.now()}-${idx}`,
                name: `${parentClip.name} (Part ${idx + 1})`,
                start: timelineCursor,
                duration: seg.duration,
                offset: seg.start, // Crucial: Play from where speech actually is
                url: parentClip.url,
                assetId: parentClip.assetId,
                color: parentClip.color
            });
            timelineCursor += seg.duration; // Advance cursor
        });

        // Update global duration
        useTimelineStore.getState().setDuration(Math.ceil(timelineCursor + 5));

        return { success: true, count: activeSegments.length };

    } catch (error) {
        console.error("Auto-Edit Error:", error);
        return { success: false, error: error.message };
    }
};

const API_DENOISE = '/api/audio/denoise';

export const performAudioDenoise = async (filename) => {
    try {
        const { tracks, updateClip } = useTimelineStore.getState();
        const videoTrack = tracks.find(t => t.type === 'video');
        if (!videoTrack || videoTrack.clips.length === 0) throw new Error("No video clip to process");

        const parentClip = videoTrack.clips[0]; // Process main clip

        console.log("🤖 Agent: Denoising audio for", filename);

        const response = await fetch(API_DENOISE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename }) // Send filename, let backend resolve
        });

        if (!response.ok) throw new Error("Denoise failed on server");
        const data = await response.json();

        // Data should contain { url: '/uploads/audio_temp/...' }
        // We replace the clip's URL with this new one. 
        // The clip will reload with the cleaned video file.

        if (data.url) {
            // Need absolute URL or relative?
            // If backend returns relative relative to root, we might need to prepend host if on different port.
            // Vite proxy handles /uploads -> Backend.

            updateClip(videoTrack.id, parentClip.id, {
                url: data.url,
                name: `${parentClip.name} (Cleaned)`
            });
            return { success: true, count: 1, message: "Audio cleaned and updated." };
        }

        return { success: false, message: "No output URL received." };

    } catch (error) {
        console.error("Denoise Error:", error);
        return { success: false, error: error.message };
    }
};

const API_BEAT_DETECT = '/api/audio/beat-detect';

export const performBeatDetection = async (filename) => {
    try {
        const { setBeatMarkers } = useTimelineStore.getState();
        console.log("🤖 Agent: Detecting beats for", filename);

        const response = await fetch(API_BEAT_DETECT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename })
        });

        if (!response.ok) throw new Error("Beat detection failed on server");
        const data = await response.json();

        if (data.success && data.beats) {
            setBeatMarkers(data.beats);
            return { success: true, count: data.beats.length, message: `Detailed ${data.bpm} BPM. Found ${data.beats.length} beat markers.` };
        }

        return { success: false, message: "No beats found." };

    } catch (error) {
        console.error("Beat Detect Error:", error);
        return { success: false, error: error.message };
    }
};

export const performAudioNormalization = async (filename) => {
    try {
        const { tracks, updateClip } = useTimelineStore.getState();
        const videoTrack = tracks.find(t => t.type === 'video');
        if (!videoTrack || videoTrack.clips.length === 0) throw new Error("No video clip to process");
        const parentClip = videoTrack.clips[0];

        console.log("🤖 Agent: Normalizing audio for", filename);

        const response = await fetch('/api/audio/normalize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename })
        });

        if (!response.ok) throw new Error("Normalization failed on server");
        const data = await response.json();

        if (data.url) {
            updateClip(videoTrack.id, parentClip.id, {
                url: data.url,
                name: `${parentClip.name} (Normalized)`
            });
            return { success: true, count: 1, message: "Audio levels fixed (Normalized)." };
        }
        return { success: false, message: "No output URL received." };

    } catch (error) {
        console.error("Normalize Error:", error);
        return { success: false, error: error.message };
    }
};

export const parseAgentCommand = async (command, filename) => {
    // 1. Keyword Parser (Optimistic Local Execution)
    const cmd = command.toLowerCase();
    const store = useTimelineStore.getState();

    // Specific Keyword Overrides (Speed)
    if (cmd.includes('silence') && cmd.includes('remove')) {
        return await performSilenceRemoval(filename);
    }

    // 2. Real AI Fallback (Backend LLM)
    try {
        const context = {
            filename,
            duration: store.duration,
            aspectRatio: store.aspectRatio,
            tracks: store.tracks.map(t => ({ type: t.type, count: t.clips.length }))
        };

        const response = await fetch('/api/ai/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command, context })
        });

        if (!response.ok) throw new Error("AI Backend Error");
        const data = await response.json();

        if (data.success && data.actions.length > 0) {
            // Execute Actions Checklist
            let count = 0;
            for (const action of data.actions) {
                switch (action.type) {
                    case 'silence_removal':
                        await performSilenceRemoval(filename);
                        count++;
                        break;
                    case 'set_aspect_ratio':
                        store.setAspectRatio(action.params.ratio);
                        count++;
                        break;
                    case 'color_grade':
                        store.tracks.forEach(track => {
                            if (track.type === 'video') {
                                track.clips.forEach(clip => {
                                    // Map preset name to tailwind color (Mock)
                                    const color = action.params.preset === 'cinematic' ? 'bg-teal-700' : 'bg-red-600';
                                    store.updateClip(track.id, clip.id, { color });
                                });
                            }
                        });
                        count++;
                        break;
                    // TODO: Implement other actions (trim, music, etc.)
                }
            }
            return { success: true, count, message: data.message || "AI executed commands." };
        }

        return { success: false, message: data.message || "AI returned no actions." };

    } catch (err) {
        console.error("AI Fallback Error:", err);
        return { success: false, error: "AI failed to respond. (Check API Key)" };
    }
};
