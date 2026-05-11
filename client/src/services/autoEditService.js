/**
 * autoEditService.js
 *
 * FIX: Every fetch() call to /api/* replaced with authFetch() so the Supabase
 *      JWT Bearer token is sent in production. Without auth headers, all
 *      silence detection, filler removal, denoise, normalize, beat-detect,
 *      and transcription calls returned 401 Unauthorized and silently failed,
 *      leaving the timeline unmodified while the agent reported success.
 */

import { authFetch } from '../utils/authFetch.js';
import useTimelineStore from '../store/useTimelineStore';
import { mediaBunnyService } from './MediaBunnyService.js';

const API_SILENCE = '/api/silence/detect';

function getSourceFile() {
    const state = useTimelineStore.getState();
    return state.uploadedFile || null;
}

// ── Auto Captions ─────────────────────────────────────────────────────────────

export const performAutoCaptions = async (filename) => {
    try {
        const { setCaptions } = useTimelineStore.getState();
        console.log('🤖 Agent: Requesting Transcription for', filename);

        // FIX: was fetch('/api/audio/transcribe', ...) — no auth → 401
        const response = await authFetch('/api/audio/transcribe', {
            method: 'POST',
            body: JSON.stringify({ filename })
        });

        if (!response.ok) throw new Error('Transcription failed on server');
        const data = await response.json();

        if (data.words && data.words.length > 0) {
            setCaptions(data.words);
            return { success: true, count: data.words.length, message: 'Transcription complete. Energy markers and captions are now available.' };
        }

        return { success: false, message: 'No speech detected' };
    } catch (error) {
        console.error('Transcription Error:', error);
        return { success: false, error: error.message };
    }
};

// ── Audio Extraction (client-side via mediabunny — no auth needed) ─────────────

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

// ── Silence Removal ───────────────────────────────────────────────────────────

export const performSilenceRemoval = async (filename, threshold = '-30dB') => {
    try {
        const { tracks, addClip, removeClip } = useTimelineStore.getState();
        const videoTrack = tracks.find(t => t.type === 'video');
        if (!videoTrack || videoTrack.clips.length === 0) throw new Error('No video clip to analyze');

        console.log('🤖 Agent: Requesting Silence Analysis for', filename);

        // FIX: was fetch(API_SILENCE, ...) — no auth → 401
        const response = await authFetch(API_SILENCE, {
            method: 'POST',
            body: JSON.stringify({ filename, threshold })
        });

        if (!response.ok) throw new Error('Silence detection failed on server');
        const data = await response.json();

        const activeSegments = data.activeSegments;
        if (!activeSegments || activeSegments.length === 0) return { success: false, message: 'No active speech found' };

        const parentClip = videoTrack.clips[0];
        removeClip(videoTrack.id, parentClip.id);

        let timelineCursor = 0;
        activeSegments.forEach((seg, idx) => {
            addClip(videoTrack.id, {
                id: `auto-cut-${Date.now()}-${idx}`,
                name: `${parentClip.name} (Part ${idx + 1})`,
                start: timelineCursor,
                duration: seg.duration,
                offset: seg.start,
                url: parentClip.url,
                assetId: parentClip.assetId,
                color: parentClip.color
            });
            timelineCursor += seg.duration;
        });

        useTimelineStore.getState().setDuration(Math.ceil(timelineCursor + 5));
        return { success: true, count: activeSegments.length };

    } catch (error) {
        console.error('Auto-Edit Error:', error);
        return { success: false, error: error.message };
    }
};

// ── Filler Word Removal ───────────────────────────────────────────────────────

export const performFillerRemoval = async (filename) => {
    try {
        const { tracks, addClip, removeClip } = useTimelineStore.getState();
        const videoTrack = tracks.find(t => t.type === 'video');
        if (!videoTrack || videoTrack.clips.length === 0) throw new Error('No video clip to analyze');

        console.log('🤖 Agent: Requesting Filler Word Analysis for', filename);

        // FIX: was fetch('/api/audio/transcribe', ...) — no auth → 401
        const response = await authFetch('/api/audio/transcribe', {
            method: 'POST',
            body: JSON.stringify({ filename })
        });

        if (!response.ok) throw new Error('Transcription failed on server');
        const data = await response.json();

        if (!data.words || data.words.length === 0) {
            return { success: false, message: 'No speech detected' };
        }

        const fillerWords = ['um', 'uh', 'like', 'you know', 'sort of', 'kind of', 'euh', 'ben', 'genre'];
        const activeSegments = [];
        let currentSegmentStart = 0;

        data.words.forEach((w) => {
            const wordText = w.word.toLowerCase().replace(/[^a-z\s]/g, '').trim();
            if (fillerWords.includes(wordText)) {
                if (currentSegmentStart < w.start) {
                    activeSegments.push({ start: currentSegmentStart, duration: w.start - currentSegmentStart });
                }
                currentSegmentStart = w.end;
            }
        });

        const lastWord = data.words[data.words.length - 1];
        if (currentSegmentStart < lastWord.end) {
            activeSegments.push({ start: currentSegmentStart, duration: lastWord.end - currentSegmentStart });
        }

        if (activeSegments.length === 1 && activeSegments[0].start === 0) {
            return { success: true, count: 0, message: 'No filler words found!' };
        }

        const parentClip = videoTrack.clips[0];
        removeClip(videoTrack.id, parentClip.id);

        let timelineCursor = 0;
        activeSegments.forEach((seg, idx) => {
            addClip(videoTrack.id, {
                id: `auto-cut-filler-${Date.now()}-${idx}`,
                name: `${parentClip.name} (Part ${idx + 1})`,
                start: timelineCursor,
                duration: seg.duration,
                offset: seg.start,
                url: parentClip.url,
                assetId: parentClip.assetId,
                color: parentClip.color
            });
            timelineCursor += seg.duration;
        });

        useTimelineStore.getState().setDuration(Math.ceil(timelineCursor + 5));
        return { success: true, count: data.words.length - activeSegments.length, message: 'Removed filler words!' };

    } catch (error) {
        console.error('Filler Removal Error:', error);
        return { success: false, error: error.message };
    }
};

// ── Audio Denoise ─────────────────────────────────────────────────────────────

const API_DENOISE = '/api/audio/denoise';

export const performAudioDenoise = async (filename) => {
    try {
        const { tracks, updateClip } = useTimelineStore.getState();
        const videoTrack = tracks.find(t => t.type === 'video');
        if (!videoTrack || videoTrack.clips.length === 0) throw new Error('No video clip to process');
        const parentClip = videoTrack.clips[0];

        console.log('🤖 Agent: Denoising audio for', filename);

        // FIX: was fetch(API_DENOISE, ...) — no auth → 401
        const response = await authFetch(API_DENOISE, {
            method: 'POST',
            body: JSON.stringify({ filename })
        });

        if (!response.ok) throw new Error('Denoise failed on server');
        const data = await response.json();

        if (data.url) {
            updateClip(videoTrack.id, parentClip.id, {
                url: data.url,
                name: `${parentClip.name} (Cleaned)`
            });
            return { success: true, count: 1, message: 'Audio cleaned and updated.' };
        }

        return { success: false, message: 'No output URL received.' };

    } catch (error) {
        console.error('Denoise Error:', error);
        return { success: false, error: error.message };
    }
};

// ── Beat Detection ────────────────────────────────────────────────────────────

const API_BEAT_DETECT = '/api/audio/beat-detect';

export const performBeatDetection = async (filename) => {
    try {
        const { setBeatMarkers } = useTimelineStore.getState();
        console.log('🤖 Agent: Detecting beats for', filename);

        // FIX: was fetch(API_BEAT_DETECT, ...) — no auth → 401
        const response = await authFetch(API_BEAT_DETECT, {
            method: 'POST',
            body: JSON.stringify({ filename })
        });

        if (!response.ok) throw new Error('Beat detection failed on server');
        const data = await response.json();

        if (data.success && data.beats) {
            setBeatMarkers(data.beats);
            return { success: true, count: data.beats.length, message: `Detected ${data.bpm} BPM. Found ${data.beats.length} beat markers.` };
        }

        return { success: false, message: 'No beats found.' };

    } catch (error) {
        console.error('Beat Detect Error:', error);
        return { success: false, error: error.message };
    }
};

// ── Audio Normalization ───────────────────────────────────────────────────────

export const performAudioNormalization = async (filename) => {
    try {
        const { tracks, updateClip } = useTimelineStore.getState();
        const videoTrack = tracks.find(t => t.type === 'video');
        if (!videoTrack || videoTrack.clips.length === 0) throw new Error('No video clip to process');
        const parentClip = videoTrack.clips[0];

        console.log('🤖 Agent: Normalizing audio for', filename);

        // FIX: was fetch('/api/audio/normalize', ...) — no auth → 401
        const response = await authFetch('/api/audio/normalize', {
            method: 'POST',
            body: JSON.stringify({ filename })
        });

        if (!response.ok) throw new Error('Normalization failed on server');
        const data = await response.json();

        if (data.url) {
            updateClip(videoTrack.id, parentClip.id, {
                url: data.url,
                name: `${parentClip.name} (Normalized)`
            });
            return { success: true, count: 1, message: 'Audio levels fixed (Normalized).' };
        }
        return { success: false, message: 'No output URL received.' };

    } catch (error) {
        console.error('Normalize Error:', error);
        return { success: false, error: error.message };
    }
};

// ── Generic AI Command Parser ─────────────────────────────────────────────────

export const parseAgentCommand = async (command, filename) => {
    const cmd = command.toLowerCase();
    const store = useTimelineStore.getState();

    if (cmd.includes('silence') && cmd.includes('remove')) {
        return await performSilenceRemoval(filename);
    }

    try {
        const context = {
            filename,
            duration: store.duration,
            aspectRatio: store.aspectRatio,
            tracks: store.tracks.map(t => ({ type: t.type, count: t.clips.length }))
        };

        // FIX: was fetch('/api/ai/chat', ...) — no auth → 401
        const response = await authFetch('/api/ai/chat', {
            method: 'POST',
            body: JSON.stringify({ command, context })
        });

        if (!response.ok) throw new Error('AI Backend Error');
        const data = await response.json();

        if (data.success && data.actions.length > 0) {
            let count = 0;
            for (const action of data.actions) {
                switch (action.type) {
                    case 'silence_removal':
                        await performSilenceRemoval(filename);
                        count++;
                        break;
                    case 'remove_filler_words':
                        await performFillerRemoval(filename);
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
                                    const color = action.params.preset === 'cinematic' ? 'bg-teal-700' : 'bg-red-600';
                                    store.updateClip(track.id, clip.id, { color });
                                });
                            }
                        });
                        count++;
                        break;
                }
            }
            return { success: true, count, message: data.message || 'AI executed commands.' };
        }

        return { success: false, message: data.message || 'AI returned no actions.' };

    } catch (err) {
        console.error('AI Fallback Error:', err);
        return { success: false, error: 'AI failed to respond. (Check API Key)' };
    }
};