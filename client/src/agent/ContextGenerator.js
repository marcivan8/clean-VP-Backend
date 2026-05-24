import useTimelineStore from '../store/useTimelineStore.js';

export class ContextGenerator {
    static getTimelineContext() {
        const state = useTimelineStore.getState();
        const { tracks, duration, currentTime, aspectRatio, beatMarkers, activeClipId } = state;

        // Build clips array for local parsing
        const clips = [];
        tracks.forEach(track => {
            track.clips?.forEach(clip => {
                clips.push({
                    id: clip.id,
                    name: clip.name,
                    start: clip.start,
                    duration: clip.duration,
                    trackId: track.id,
                    isActive: clip.id === activeClipId
                });
            });
        });

        // Build display string for API
        let displayStr = `Project Status:\n`;
        displayStr += `- Aspect Ratio: ${aspectRatio}\n`;
        displayStr += `- Total Duration: ${duration.toFixed(2)}s\n`;
        displayStr += `- Current Playhead: ${currentTime.toFixed(2)}s\n`;
        displayStr += `- Tracks: ${tracks.length}\n`;
        if (beatMarkers && beatMarkers.length > 0) {
            displayStr += `- Beat Markers Detected: ${beatMarkers.length}\n`;
        }
        displayStr += `\n`;

        tracks.forEach(track => {
            const volInfo = `Vol: ${(track.volume * 100).toFixed(0)}%${track.muted ? ' (MUTED)' : ''}`;
            displayStr += `Track: ${track.name} (${track.type}) [ID: ${track.id}] - ${volInfo}\n`;

            if (track.clips.length === 0) {
                displayStr += `  (Empty)\n`;
            } else {
                track.clips.sort((a, b) => a.start - b.start).forEach((clip, index) => {
                    const speedInfo = clip.speed !== 1 ? `| Speed: ${clip.speed}x` : '';
                    const colorInfo = clip.filter ? `| Look: ${clip.filter}` : '';
                    const activeMarker = clip.id === activeClipId ? ' [SELECTED]' : '';
                    displayStr += `  ${index + 1}. Clip: "${clip.name}" [ID: ${clip.id}]${activeMarker}\n`;
                    displayStr += `     Range: ${clip.start.toFixed(2)}s - ${(clip.start + clip.duration).toFixed(2)}s ${speedInfo} ${colorInfo}\n`;
                });
            }
            displayStr += `\n`;
        });

        // Return structured object
        return {
            clips,
            tracks,
            duration,
            currentTime,
            aspectRatio,
            activeClipId,
            display: displayStr
        };
    }

    /**
     * Grounded Agent: Build structured context for the CRL backend.
     * Produces ProjectContext, TimelineState, and MediaMetadata.
     */
    static getStructuredContext() {
        const state = useTimelineStore.getState();
        const { tracks, duration, currentTime, aspectRatio, activeClipId, captions, pacingSegments, beatMarkers, assets, transcriptionAttempted } = state;

        // --- Collect all clips ---
        const allClips = [];
        tracks.forEach(track => {
            track.clips?.forEach(clip => {
                allClips.push({ ...clip, trackId: track.id, trackType: track.type });
            });
        });

        // --- Find active/selected clip ---
        const activeClip = allClips.find(c => c.id === activeClipId) || null;
        const selectedClipDuration = activeClip ? activeClip.duration : 0;
        const sourceDuration = activeClip?.sourceDuration || (activeClip ? activeClip.duration * (activeClip.speed || 1) : 0);

        // --- Editing Mode Detection ---
        const videoClips = allClips.filter(c => c.trackType === 'video');
        let editingMode = 'CREATION';
        if (videoClips.length > 1) {
            editingMode = 'REPURPOSE';
        } else if (videoClips.length === 1 && videoClips[0].duration > 180) {
            editingMode = 'CREATION'; // Single long raw clip
        } else if (videoClips.length === 1) {
            editingMode = 'CREATION';
        }

        // --- Clip Type Inference ---
        let clipType = 'unknown';
        if (activeClip) {
            const name = (activeClip.name || '').toLowerCase();
            if (name.includes('podcast') || name.includes('interview')) clipType = 'podcast';
            else if (name.includes('broll') || name.includes('b-roll')) clipType = 'broll';
            else if (captions && captions.length > 0) clipType = 'talking_head';
            else clipType = 'generic_video';
        }

        // --- Transcript Summary ---
        const hasTranscript = captions && captions.length > 0;
        let transcriptSummary = '';
        if (hasTranscript) {
            transcriptSummary = captions.slice(0, 40).map(c => c.word).join(' ');
            if (captions.length > 40) transcriptSummary += '...';
        }

        // --- Energy Profile from pacing segments ---
        let energyProfile = 'unknown';
        if (pacingSegments && pacingSegments.length > 0) {
            const fastCount = pacingSegments.filter(s => s.type === 'fast').length;
            const ratio = fastCount / pacingSegments.length;
            if (ratio > 0.6) energyProfile = 'high_energy';
            else if (ratio > 0.3) energyProfile = 'mixed';
            else energyProfile = 'calm';
        }

        return {
            ProjectContext: {
                editingMode,
                exportTarget: null // Set by user intent, not context
            },
            TimelineState: {
                totalTimelineDuration: duration,
                selectedClipDuration,
                totalClips: allClips.length,
                currentPlayhead: currentTime,
                videoClipCount: videoClips.length,
                dedicatedAudioTrackClipCount: allClips.filter(c => c.trackType === 'audio').length,
                note: "Video clips usually contain embedded audio. Do not assume a video lacks audio just because dedicatedAudioTrackClipCount is 0."
            },
            MediaMetadata: {
                sourceDuration,
                clipType,
                aspectRatio,
                hasTranscript,
                transcriptionAttempted: !!transcriptionAttempted,
                transcriptSummary,
                energyProfile,
                hasBeatMarkers: beatMarkers && beatMarkers.length > 0
            },

            // Long-Form Intelligence Engine context (populated after ContentAnalyzer runs)
            LongFormContext: state.contentAnalysis ? {
                contentType: state.contentAnalysis.contentType,
                editMode: state.contentAnalysis.editMode,
                totalSegments: state.contentAnalysis.segments?.length || 0,
                hookFound: !!state.contentAnalysis.structure?.hookCandidate,
                hookTimestamp: state.contentAnalysis.structure?.hookCandidate?.start ?? null,
                plannedActions: state.contentAnalysis.editPlan?.actions || [],
                analysisTimestamp: state.contentAnalysis.timestamp,
                requiresApproval: state.contentAnalysis.requiresApproval,
            } : null,

            // Keep display string for backward compat
            display: this.getTimelineContext().display
        };

    }

    static getProjectMetadata() {
        const state = useTimelineStore.getState();
        return `Available Assets: ${state.assets.map(a => `${a.name} (${a.type})`).join(', ')}`;
    }
}
