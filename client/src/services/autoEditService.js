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

// ── Shared helpers ────────────────────────────────────────────────────────────

/**
 * Finds the transcript for a given filename from the store.
 * Tries the exact basename first, then strips the leading timestamp prefix
 * (e.g. "1782165576970-IMG_3678.mp4" → "IMG_3678.mp4") so the lookup works
 * whether the transcript was stored under the timestamped or original name.
 */
function getTranscriptForFile(store, filename) {
    const basename = (p) => (p || '').split(/[\\/]/).pop();
    const base = basename(filename);
    const stripped = base.replace(/^\d+-/, '');

    if (store.transcripts) {
        if (store.transcripts[base]?.length > 0) return store.transcripts[base];
        if (store.transcripts[stripped]?.length > 0) return store.transcripts[stripped];
        // Last resort: match any key whose basename matches
        for (const [key, words] of Object.entries(store.transcripts)) {
            if (words?.length > 0 && (basename(key) === base || basename(key) === stripped)) return words;
        }
    }
    // Legacy fallback: captions array (older sessions before transcripts map was added)
    if (store.captions?.length > 0) return store.captions;
    return null;
}

/**
 * Replaces one or more clips on the video track with segment clips produced
 * by silence/filler detection.  Mirrors _applySegmentsToTimeline in
 * MediaExecutionEngine but lives here so autoEditService doesn't need to
 * import the engine class.
 *
 * @param {Array<{start,end,duration}>} activeSegments  - segments to KEEP
 * @param {string}  prefix   - id prefix for new clips ('silence'|'filler')
 * @param {object}  baseClip - the original clip to replace
 * @param {string}  trackId  - the track the clip lives on
 */
function applySegmentsToClip(activeSegments, prefix, baseClip, trackId) {
    const store = useTimelineStore.getState();

    // Sanity: reject if active duration < 10% of source (detection failed)
    const totalOriginal = baseClip.duration || 0;
    const totalActive   = activeSegments.reduce((s, seg) => s + seg.duration, 0);
    if (totalOriginal > 30 && totalActive < totalOriginal * 0.10) {
        const msg = `Detection rejected — only ${totalActive.toFixed(1)}s active out of ${totalOriginal.toFixed(1)}s source. Re-run or check your audio.`;
        console.error(`[autoEditService] ${msg}`);
        return { success: false, message: msg };
    }

    const validSegs = activeSegments.filter(s => s.duration > 0.05);
    if (!validSegs.length) return { success: false, message: 'No segments to apply after filtering.' };

    const rangeStart      = baseClip.start;
    const persistentUrl   = baseClip.sourceUrl || baseClip.url || '';
    const ts              = Date.now();

    // Remove the original clip
    store.removeClip(trackId, baseClip.id);

    // Insert replacement clips
    let cursor = rangeStart;
    validSegs.forEach((seg, i) => {
        store.addClip(trackId, {
            ...baseClip,
            id:           `clip_${prefix}_${ts}_${i}`,
            start:        cursor,
            duration:     seg.duration,
            offset:       seg.start,
            name:         `Segment ${i + 1}`,
            originalName: baseClip.originalName || baseClip.name,
            url:          persistentUrl,
            sourceUrl:    baseClip.sourceUrl || persistentUrl,
        });
        cursor += seg.duration;
        console.log(`[autoEditService]   ${prefix} clip ${i}: timeline ${(cursor - seg.duration).toFixed(2)}s–${cursor.toFixed(2)}s  source ${seg.start.toFixed(2)}s–${seg.end.toFixed(2)}s`);
    });

    // Shift any subsequent clips to close the gap (or fill the expansion)
    const rangeEnd     = rangeStart + totalOriginal;
    const durationDiff = cursor - rangeEnd;
    if (Math.abs(durationDiff) > 0.01) {
        const freshTrack = useTimelineStore.getState().tracks?.find(t => t.id === trackId);
        (freshTrack?.clips || [])
            .filter(c => c.start >= rangeEnd - 0.01 && !c.id.startsWith(`clip_${prefix}_${ts}_`))
            .sort((a, b) => a.start - b.start)
            .forEach(c => store.updateClip(trackId, c.id, { start: c.start + durationDiff }, { skipHistory: true }));
    }

    return { success: true, count: validSegs.length };
}

// ── Silence Removal ───────────────────────────────────────────────────────────

export const performSilenceRemoval = async (filename, threshold = '-30dB') => {
    const store = useTimelineStore.getState();
    const videoTrack =
        store.tracks?.find(t => t.type === 'video' && t.clips.length > 0) ??
        store.tracks?.find(t => t.type === 'video');

    if (!videoTrack || videoTrack.clips.length === 0) {
        return { success: false, message: 'No video clip on the timeline.' };
    }

    // ── Require transcript — never fall back to aggressive FFmpeg audio analysis ──
    const transcript = getTranscriptForFile(store, filename);
    if (!transcript || transcript.length === 0) {
        return {
            success: false,
            message: 'No transcript found. Please wait for transcription to finish (or ask the AI to transcribe the clip) before running silence removal.',
        };
    }

    console.log(`🤖 [autoEditService] Silence detection for "${filename}" — injecting ${transcript.length} transcript words`);

    const response = await authFetch(API_SILENCE, {
        method: 'POST',
        body: JSON.stringify({
            filename,
            threshold,
            // Inject transcript so the server uses speech timestamps instead of
            // FFmpeg audio-level thresholds. The audio-level path applies a fixed
            // -30 dB cut that wipes entire clips recorded at lower levels.
            transcript: transcript.map(w => ({ start: w.start, end: w.end, word: w.word || w.content || w.text || '' })),
        }),
    });

    if (!response.ok) {
        const err = await response.text().catch(() => response.statusText);
        throw new Error(`Silence detection API error ${response.status}: ${err}`);
    }

    const data = await response.json();

    // If the job was queued, poll for completion
    let activeSegments = data.activeSegments;
    if (data.jobId && !activeSegments) {
        const { pollJobResult } = await import('../utils/jobPoller.js');
        const result = await pollJobResult(data.jobId);
        activeSegments = result?.activeSegments;
    }

    if (!activeSegments || activeSegments.length === 0) {
        return { success: true, count: 0, message: 'No silences detected — your clip is already clean!' };
    }

    // Find the clip that matches the uploaded file (not hardcoded clips[0])
    const basename = (p) => (p || '').split(/[\\/]/).pop();
    const base     = basename(filename);
    const stripped = base.replace(/^\d+-/, '');
    const clips    = [...videoTrack.clips].sort((a, b) => a.start - b.start);
    const baseClip = clips.find(c => {
        const asset = store.assets?.find(a => a.id === c.assetId);
        const an    = basename(asset?.name || '');
        const cn    = basename(c.name || '');
        return an === base || an === stripped || cn === base || cn === stripped
            || an.replace(/^\d+-/, '') === stripped;
    }) ?? clips[0];

    return applySegmentsToClip(activeSegments, 'silence', baseClip, videoTrack.id);
};

// ── Filler Word Removal ───────────────────────────────────────────────────────

export const performFillerRemoval = async (filename) => {
    const store = useTimelineStore.getState();
    const videoTrack =
        store.tracks?.find(t => t.type === 'video' && t.clips.length > 0) ??
        store.tracks?.find(t => t.type === 'video');

    if (!videoTrack || videoTrack.clips.length === 0) {
        return { success: false, message: 'No video clip on the timeline.' };
    }

    // ── Require transcript — don't re-run Whisper; the transcription pipeline
    //    already ran when the clip was uploaded. Re-running is slow and wastes quota.
    const transcript = getTranscriptForFile(store, filename);
    if (!transcript || transcript.length === 0) {
        return {
            success: false,
            message: 'No transcript found. Please wait for transcription to finish (or ask the AI to transcribe the clip) before running filler removal.',
        };
    }

    console.log(`🤖 [autoEditService] Filler detection for "${filename}" — injecting ${transcript.length} transcript words (GPT-4o semantic pass on server)`);

    // Send to /api/audio/filler/detect with the pre-existing transcript.
    // The server's detectFillerWords() uses GPT-4o semantic analysis when a
    // transcript is provided — far more accurate than the old keyword match.
    const response = await authFetch('/api/audio/filler/detect', {
        method: 'POST',
        body: JSON.stringify({
            filename,
            transcript: transcript.map(w => ({ start: w.start, end: w.end, word: w.word || w.content || w.text || '' })),
        }),
    });

    if (!response.ok) {
        const err = await response.text().catch(() => response.statusText);
        throw new Error(`Filler detection API error ${response.status}: ${err}`);
    }

    const data = await response.json();

    // Poll if queued
    let activeSegments = data.activeSegments;
    if (data.jobId && !activeSegments) {
        const { pollJobResult } = await import('../utils/jobPoller.js');
        const result = await pollJobResult(data.jobId);
        activeSegments = result?.activeSegments;
    }

    if (!activeSegments || activeSegments.length === 0) {
        return { success: true, count: 0, message: 'No filler words found — your clip sounds clean!' };
    }

    const basename = (p) => (p || '').split(/[\\/]/).pop();
    const base     = basename(filename);
    const stripped = base.replace(/^\d+-/, '');
    const clips    = [...videoTrack.clips].sort((a, b) => a.start - b.start);
    const baseClip = clips.find(c => {
        const asset = store.assets?.find(a => a.id === c.assetId);
        const an    = basename(asset?.name || '');
        const cn    = basename(c.name || '');
        return an === base || an === stripped || cn === base || cn === stripped
            || an.replace(/^\d+-/, '') === stripped;
    }) ?? clips[0];

    const fillerCount = data.fillerCount ?? (transcript.length - activeSegments.reduce((s, seg) => s + 1, 0));
    const result = applySegmentsToClip(activeSegments, 'filler', baseClip, videoTrack.id);
    if (result.success) result.message = `Removed ${fillerCount} filler word(s) using GPT-4o semantic analysis.`;
    return result;
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