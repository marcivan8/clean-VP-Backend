/**
 * server/brain/ContextEngine.js
 *
 * Transforms raw projectState (from the frontend payload) into a rich
 * context object that the EditorialBrain can reason over.
 *
 * All computation is synchronous and pure — no DB, no AI calls.
 */

'use strict';

const { getPlatform, evaluateAgainstPlatform } = require('./PlatformKnowledge');

class ContextEngine {

    /**
     * Build a rich context object from raw project state.
     *
     * @param {Object} projectState
     * @param {Array}  [projectState.tracks]       - Timeline tracks
     * @param {Array}  [projectState.captions]     - Caption/transcript array
     * @param {number} [projectState.duration]     - Total duration in seconds
     * @param {Array}  [projectState.mediaBin]     - All assets in media bin
     * @param {string} [projectState.platform]     - Platform key
     * @param {Array}  [projectState.editHistory]  - List of action names applied
     *
     * @returns {Object} enriched context
     */
    build(projectState) {
        const state = projectState || {};

        const tracks      = Array.isArray(state.tracks)      ? state.tracks      : [];
        const captions    = Array.isArray(state.captions)    ? state.captions    : [];
        const mediaBin    = Array.isArray(state.mediaBin)    ? state.mediaBin    : [];
        const editHistory = Array.isArray(state.editHistory) ? state.editHistory : [];
        const duration    = typeof state.duration === 'number' ? state.duration  : this._computeDuration(tracks);
        const platform    = state.platform || null;

        // ── Timeline analysis ─────────────────────────────────────────────────
        const clips = this._getAllClips(tracks);
        const clipCount = clips.length;
        const cutRate = duration > 0 ? (clipCount / (duration / 60)) : 0;
        const avgClipLength = clipCount > 0 ? duration / clipCount : 0;

        const originalDuration = this._computeOriginalDuration(mediaBin);
        const timeSaved = Math.max(0, originalDuration - duration);

        const audioTracks = tracks.filter(t => t.type === 'audio' || t.type === 'music');
        const hasMusic    = audioTracks.some(t => (t.clips || []).length > 0 && t.type === 'music');
        const hasCaptions = captions.length > 0;
        const aspectRatio = state.aspectRatio || state.timeline?.aspectRatio || null;

        // ── Caption / transcript analysis ─────────────────────────────────────
        const captionContext = this._analyzeCaptions(captions);

        // ── Media bin analysis ────────────────────────────────────────────────
        const binContext = this._analyzeMediaBin(mediaBin, tracks);

        // ── Completion score ──────────────────────────────────────────────────
        const completionScore = this._computeCompletionScore({
            hasCaptions,
            hasMusic,
            editHistory,
            clipCount,
            duration,
        });

        // ── Platform violations ───────────────────────────────────────────────
        const platformSpec    = getPlatform(platform);
        const builtContext    = {
            duration, clipCount, cutRate: Math.round(cutRate * 10) / 10,
            avgClipLength: Math.round(avgClipLength * 10) / 10,
            originalDuration, timeSaved,
            hasMusic, hasCaptions, aspectRatio, platform,
            editsDone: editHistory,
        };
        const platformViolations = evaluateAgainstPlatform(builtContext, platformSpec);

        return {
            // Timeline
            duration,
            originalDuration,
            timeSaved,
            clipCount,
            cutRate:        Math.round(cutRate * 10) / 10,
            avgClipLength:  Math.round(avgClipLength * 10) / 10,
            hasMusic,
            hasCaptions,
            aspectRatio,
            platform,
            editsDone:      editHistory,

            // Captions
            transcriptPreview:  captionContext.transcriptPreview,
            speakingPace:       captionContext.speakingPace,
            topicSentences:     captionContext.topicSentences,
            detectedSpeakers:   captionContext.detectedSpeakers,

            // Media bin
            totalAssets:    binContext.totalAssets,
            unusedAssets:   binContext.unusedAssets,
            assetTypes:     binContext.assetTypes,
            binReady:       binContext.binReady,

            // Computed
            completionScore,
            platformViolations,

            // Asset Engine context (Creative Asset Intelligence System)
            projectLUTId:     projectState.projectLUTId  || null,
            hasColorGrade:    !!(projectState.projectLUTId),
            hasSFX:           (binContext.assetTypes?.sfx || 0) > 0,
            assetEngineReady: true,
        };
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    _getAllClips(tracks) {
        const clips = [];
        for (const track of tracks) {
            if (Array.isArray(track.clips)) {
                clips.push(...track.clips);
            }
        }
        return clips;
    }

    _computeDuration(tracks) {
        let max = 0;
        for (const track of tracks) {
            for (const clip of (track.clips || [])) {
                const end = (clip.start || 0) + (clip.duration || 0);
                if (end > max) max = end;
            }
        }
        return Math.round(max * 10) / 10;
    }

    _computeOriginalDuration(mediaBin) {
        return mediaBin.reduce((sum, asset) => {
            const d = asset.duration || asset.originalDuration || 0;
            return sum + d;
        }, 0);
    }

    _analyzeCaptions(captions) {
        if (!captions.length) {
            return {
                transcriptPreview: null,
                speakingPace: null,
                topicSentences: [],
                detectedSpeakers: 0,
            };
        }

        // Build full transcript text
        const allText = captions
            .map(c => c.text || c.content || '')
            .join(' ')
            .trim();

        const transcriptPreview = allText.slice(0, 400);

        // Speaking pace: words per minute
        const wordCount = allText.split(/\s+/).filter(Boolean).length;
        const lastCaption = captions[captions.length - 1];
        const totalSeconds = (lastCaption?.end || lastCaption?.endTime || 0);
        const speakingPace = totalSeconds > 0
            ? Math.round((wordCount / totalSeconds) * 60)
            : null;

        // Top 5 sentences with high confidence
        const sentences = captions
            .filter(c => (c.confidence || 1) >= 0.7)
            .map(c => c.text || c.content || '')
            .filter(t => t.split(' ').length >= 5)   // skip tiny fragments
            .slice(0, 5);

        // Unique speakers (from diarization)
        const speakers = new Set(
            captions
                .map(c => c.speaker || c.speakerId)
                .filter(Boolean)
        );

        return {
            transcriptPreview,
            speakingPace,
            topicSentences: sentences,
            detectedSpeakers: speakers.size,
        };
    }

    _analyzeMediaBin(mediaBin, tracks) {
        const totalAssets = mediaBin.length;

        // Collect asset IDs used on the timeline
        const usedIds = new Set();
        for (const track of tracks) {
            for (const clip of (track.clips || [])) {
                if (clip.assetId) usedIds.add(clip.assetId);
                if (clip.asset?.id) usedIds.add(clip.asset.id);
            }
        }

        const unusedAssets = mediaBin
            .filter(a => !usedIds.has(a.id))
            .map(a => a.name || a.filename || a.id);

        // Asset type breakdown
        const assetTypes = { video: 0, audio: 0, music: 0, sfx: 0 };
        for (const asset of mediaBin) {
            const type = asset.type || asset.contentType || '';
            if (type.includes('music'))  assetTypes.music++;
            else if (type.includes('sfx') || type.includes('sound_effect')) assetTypes.sfx++;
            else if (type.startsWith('audio/') || type === 'audio') assetTypes.audio++;
            else if (type.startsWith('video/') || type === 'video' || !type) assetTypes.video++;
        }

        // All assets analyzed?
        const binReady = totalAssets === 0 ? false :
            mediaBin.every(a => a.analysis_status === 'done' || a.analysisStatus === 'done');

        return { totalAssets, unusedAssets, assetTypes, binReady };
    }

    _computeCompletionScore({ hasCaptions, hasMusic, editHistory, clipCount, duration }) {
        let score = 0;
        const actions = editHistory.map(a => String(a).toLowerCase());

        // Captions present: 20 pts
        if (hasCaptions) score += 20;

        // Silences removed: 20 pts
        if (actions.some(a => a.includes('silence'))) score += 20;

        // Music added: 15 pts
        if (hasMusic || actions.some(a => a.includes('music'))) score += 15;

        // Zoom / focus effect applied: 15 pts
        if (actions.some(a => a.includes('zoom') || a.includes('smart_zoom') || a.includes('crop'))) score += 15;

        // Exported at some point: 30 pts
        if (actions.some(a => a.includes('export'))) score += 30;

        // Clip count sanity (has at least 1 clip and non-zero duration)
        // If no clips yet, cap at 30 regardless of other flags
        if (clipCount === 0 || duration === 0) score = Math.min(score, 30);

        return Math.min(100, score);
    }
}

module.exports = { ContextEngine };
