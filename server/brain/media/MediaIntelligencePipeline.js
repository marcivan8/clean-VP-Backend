/**
 * server/brain/media/MediaIntelligencePipeline.js
 *
 * Orchestrates the full asset analysis pipeline:
 *   AudioClassifier + VisualAnalyzer in parallel →
 *   optional transcription →
 *   DB update →
 *   bin classification when all assets are done
 *
 * Safety:
 * - analyzeAsset() always sets analysis_status='failed' on error
 * - Never leaves status as 'processing' if the job crashes
 * - getSummary() is pure — no async, no DB
 */

'use strict';

const { supabaseAdmin } = require('../../../config/database');
const { AudioClassifier } = require('./AudioClassifier');
const { VisualAnalyzer } = require('./VisualAnalyzer');
const { ContentClassifier } = require('./ContentClassifier');

class MediaIntelligencePipeline {

    constructor() {
        this.audioClassifier  = new AudioClassifier();
        this.visualAnalyzer   = new VisualAnalyzer();
        this.contentClassifier = new ContentClassifier();
    }

    /**
     * Full analysis pipeline for a single asset.
     * Called by the 'asset-analysis' BullMQ worker.
     *
     * On success: sets analysis_status='done'
     * On failure: sets analysis_status='failed' (NEVER leaves as 'processing')
     *
     * @param {string} assetId
     * @param {string} filePath   - Local (or GCS-downloaded) file path
     * @param {string} projectId
     * @param {string} userId
     */
    async analyzeAsset(assetId, filePath, projectId, userId) {
        // Mark as processing
        await this._updateAssetStatus(assetId, 'processing');

        try {
            // Run audio and visual analysis in parallel (they are independent)
            const [audioAnalysis, visualAnalysis] = await Promise.all([
                this.audioClassifier.classify(filePath).catch(err => {
                    console.error(`[MediaPipeline] Audio classify error for ${assetId}:`, err.message);
                    return { audioType: 'unknown', hasAudio: false, hasSpokenWord: false, error: true };
                }),
                this.visualAnalyzer.analyze(filePath, null).catch(err => {
                    console.error(`[MediaPipeline] Visual analyze error for ${assetId}:`, err.message);
                    return { error: true, sceneType: 'unknown' };
                }),
            ]);

            // Transcribe only if spoken word detected
            let transcriptText = null;
            if (audioAnalysis.hasSpokenWord === true) {
                transcriptText = await this._transcribe(filePath, assetId).catch(err => {
                    console.warn(`[MediaPipeline] Transcription failed for ${assetId}:`, err.message);
                    return null;
                });
            }

            // Persist all results
            const { error: updateError } = await supabaseAdmin
                .from('media_assets')
                .update({
                    // Audio
                    audio_type:          audioAnalysis.audioType,
                    has_audio:           audioAnalysis.hasAudio,
                    has_spoken_word:     audioAnalysis.hasSpokenWord,
                    integrated_loudness: audioAnalysis.integratedLoudness,
                    loudness_range:      audioAnalysis.loudnessRange,
                    true_peak:           audioAnalysis.truePeak,
                    is_mono:             audioAnalysis.isMono,

                    // Visual
                    scene_type:          visualAnalysis.sceneType,
                    camera_angle:        visualAnalysis.cameraAngle,
                    subject_count:       visualAnalysis.subjectCount,
                    has_main_speaker:    visualAnalysis.hasMainSpeaker,
                    has_faces:           visualAnalysis.hasFaces,
                    is_broll:            visualAnalysis.isBroll,
                    is_screen_recording: visualAnalysis.isScreenRecording,
                    location_type:       visualAnalysis.locationType,
                    lighting_quality:    visualAnalysis.lightingQuality,
                    stability:           visualAnalysis.stability,
                    emotional_tone:      visualAnalysis.emotionalTone,
                    content_description: visualAnalysis.contentDescription,
                    suggested_label:     visualAnalysis.suggestedLabel,

                    // Transcript
                    transcript_text:     transcriptText,

                    // Status
                    analysis_status: 'done',
                    analyzed_at:     new Date().toISOString(),
                })
                .eq('id', assetId);

            if (updateError) {
                console.error(`[MediaPipeline] DB update failed for ${assetId}:`, updateError.message);
            }

            console.log(`[MediaPipeline] ✓ Asset ${assetId} analyzed (${visualAnalysis.sceneType}, ${audioAnalysis.audioType})`);

            // Check if ALL project assets are done — if so, run bin classification
            await this._maybeRunBinClassification(userId, projectId);

        } catch (err) {
            // ALWAYS mark as failed — never leave as 'processing'
            console.error(`[MediaPipeline] analyzeAsset FAILED for ${assetId}:`, err.message);
            await this._updateAssetStatus(assetId, 'failed');
        }
    }

    /**
     * Run bin classification once all project assets are analyzed.
     * @private
     */
    async _maybeRunBinClassification(userId, projectId) {
        try {
            const { data: assets, error } = await supabaseAdmin
                .from('media_assets')
                .select('analysis_status')
                .eq('project_id', projectId);

            if (error || !assets) return;

            const allDone = assets.length > 0 && assets.every(a => a.analysis_status === 'done');
            if (allDone) {
                console.log(`[MediaPipeline] All assets done for project ${projectId} — running bin classification`);
                await this.runBinClassification(userId, projectId);
            }
        } catch (err) {
            console.error('[MediaPipeline] _maybeRunBinClassification error:', err.message);
        }
    }

    /**
     * Run ContentClassifier across all done assets for a project and persist results.
     *
     * @param {string} userId
     * @param {string} projectId
     */
    async runBinClassification(userId, projectId) {
        try {
            const { data: assets, error } = await supabaseAdmin
                .from('media_assets')
                .select('*')
                .eq('project_id', projectId)
                .eq('analysis_status', 'done');

            if (error || !assets?.length) return;

            const classification = await this.contentClassifier.classifyBin(assets);

            // Update each asset with its classification
            for (const classifiedAsset of (classification.assets || [])) {
                if (!classifiedAsset.id) continue;
                await supabaseAdmin
                    .from('media_assets')
                    .update({
                        content_class:   classifiedAsset.content_class,
                        suggested_track: classifiedAsset.suggested_track,
                        related_to:      classifiedAsset.related_to || null,
                        confidence:      classifiedAsset.confidence,
                    })
                    .eq('id', classifiedAsset.id)
                    .catch(err => console.error('[MediaPipeline] asset class update error:', err.message));
            }

            // Update project with detected type
            if (classification.projectType || classification.projectDescription) {
                await supabaseAdmin
                    .from('projects')
                    .update({
                        detected_project_type: classification.projectType,
                        bin_classification:    classification,
                    })
                    .eq('id', projectId)
                    .catch(err => console.error('[MediaPipeline] project update error:', err.message));
            }

            console.log(`[MediaPipeline] Bin classification done: ${classification.projectType} for project ${projectId}`);
        } catch (err) {
            console.error('[MediaPipeline] runBinClassification error:', err.message);
        }
    }

    /**
     * Pure function: build a media bin summary from an array of assets.
     * No async, no DB calls.
     *
     * @param {Object[]} mediaBin
     * @returns {Object}
     */
    getSummary(mediaBin) {
        if (!Array.isArray(mediaBin) || mediaBin.length === 0) {
            return {
                totalAssets: 0,
                mainClips: [],
                brolls: [],
                musicTracks: [],
                sfx: [],
                angles: [],
                projectType: 'unknown',
                readyToOrganize: false,
            };
        }

        const mainClips    = mediaBin.filter(a => a.content_class === 'main_camera' || (!a.is_broll && !a.audio_type?.includes('music')));
        const brolls       = mediaBin.filter(a => a.is_broll || a.content_class === 'broll');
        const musicTracks  = mediaBin.filter(a => a.audio_type === 'music' || a.content_class === 'music');
        const sfx          = mediaBin.filter(a => a.audio_type === 'sfx' || a.content_class === 'sfx');
        const angles       = mediaBin.filter(a => a.content_class === 'interview_b_cam' || a.content_class === 'angle_b');

        const allDone = mediaBin.every(a =>
            a.analysis_status === 'done' || a.analysisStatus === 'done'
        );

        // Infer project type from asset mix
        let projectType = 'unknown';
        if (mainClips.length >= 2 && angles.length > 0) projectType = 'interview';
        else if (mainClips.length >= 1 && musicTracks.length > 0 && brolls.length > 0) projectType = 'vlog';
        else if (mainClips.length >= 1 && angles.length === 0 && brolls.length === 0) projectType = 'talking_head';
        else if (musicTracks.length > 0 && mainClips.length === 0) projectType = 'podcast';

        // Recommended LUT slug per project type — used by EditorialBrain as a
        // starting suggestion when no color grade has been applied.
        // Slugs map to @fontsource package names in the asset library.
        const RECOMMENDED_LUT_BY_TYPE = {
            interview:    'clean-corporate',
            vlog:         'golden-hour-warmth',
            talking_head: 'clean-corporate',
            podcast:      null,
            unknown:      null,
        };

        return {
            totalAssets:          mediaBin.length,
            mainClips:            mainClips.map(a => a.name || a.id),
            brolls:               brolls.map(a => a.name || a.id),
            musicTracks:          musicTracks.map(a => a.name || a.id),
            sfx:                  sfx.map(a => a.name || a.id),
            angles:               angles.map(a => a.name || a.id),
            projectType,
            readyToOrganize:      allDone,
            recommended_lut_name: RECOMMENDED_LUT_BY_TYPE[projectType] || null,
        };
    }

    /**
     * Build an organize plan for the current media bin.
     * Only call when user explicitly requests bin organization.
     *
     * @param {Object[]} mediaBin
     * @param {string}   platform
     * @returns {Promise<{ commands: string[], explanation: string, suggestions: Object[] }>}
     */
    async buildOrganizePlan(mediaBin, platform) {
        const summary = this.getSummary(mediaBin);

        // Select strategy based on project type
        let strategy;
        try {
            switch (summary.projectType) {
                case 'interview':    strategy = new (require('../strategies/InterviewStrategy'))();    break;
                case 'vlog':         strategy = new (require('../strategies/VlogStrategy'))();         break;
                case 'podcast':      strategy = new (require('../strategies/PodcastStrategy'))();      break;
                case 'talking_head': strategy = new (require('../strategies/TalkingHeadStrategy'))();  break;
                default:             strategy = new (require('../strategies/TalkingHeadStrategy'))();  break;
            }
        } catch (err) {
            console.error('[MediaPipeline] buildOrganizePlan: failed to load strategy:', err.message);
            return { commands: [], explanation: 'Strategy unavailable.', suggestions: [] };
        }

        return strategy.buildTimeline(mediaBin, { platform, summary });
    }

    /** @private */
    async _updateAssetStatus(assetId, status) {
        try {
            await supabaseAdmin
                .from('media_assets')
                .update({ analysis_status: status })
                .eq('id', assetId);
        } catch (err) {
            console.error('[MediaPipeline] _updateAssetStatus error:', err.message);
        }
    }

    /** @private */
    async _transcribe(filePath, assetId) {
        // Pattern: use OpenAI Whisper if available
        // (mirrors the pattern used in captionRoutes.js)
        if (!process.env.OPENAI_API_KEY) return null;

        const OpenAI = require('openai');
        const fs = require('fs');
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        const transcription = await openai.audio.transcriptions.create({
            file:  fs.createReadStream(filePath),
            model: 'whisper-1',
        });

        return transcription?.text || null;
    }
}

module.exports = { MediaIntelligencePipeline };
