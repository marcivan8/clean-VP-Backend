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

const fs   = require('fs');
const { getAIClient, isAIConfigured } = require('../../../services/AIProvider');
const os   = require('os');
const path = require('path');

const { supabaseAdmin } = require('../../../config/database');
const { AudioClassifier } = require('./AudioClassifier');
const { VisualAnalyzer } = require('./VisualAnalyzer');
const { ContentClassifier } = require('./ContentClassifier');
const {
    ASSET_ANALYSIS_DONE,
    ASSET_ANALYSIS_PROCESSING,
    ASSET_ANALYSIS_FAILED,
} = require('./analysisStatus');

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
    async analyzeAsset(assetId, filePath, projectId, userId, name = null) {
        // Create the row FIRST, then mark it processing.
        //
        // Everything in this file writes with `.update()`, which in PostgREST
        // matches zero rows and reports NO error when the row doesn't exist. And
        // nothing in the entire codebase ever INSERTed into media_assets — so
        // every analysis wrote into the void, logged "✓ analyzed", and left the
        // table permanently empty (verified: 0 rows in prod). See CLAUDE.md R38.
        await this._ensureAssetRow(assetId, projectId, userId, name);
        await this._updateAssetStatus(assetId, ASSET_ANALYSIS_PROCESSING);

        // The analyzers take a LOCAL path (both do fs.existsSync and bail),
        // but the caller hands us a GCS key like `raw/{userId}/{file}`. Resolve
        // to a real local file first, and clean it up afterwards.
        let localPath = null;
        let cleanupPath = null;

        try {
            ({ localPath, cleanupPath } = await this._resolveToLocalFile(filePath, assetId));

            if (!localPath) {
                // Nothing to analyse — record the failure rather than writing a
                // row full of 'unknown' that looks like a real (bad) result.
                console.error(`[MediaPipeline] Could not resolve a readable file for ${assetId} (${filePath})`);
                await this._updateAssetStatus(assetId, ASSET_ANALYSIS_FAILED);
                return;
            }

            // Run audio and visual analysis in parallel (they are independent)
            const [audioAnalysis, visualAnalysis] = await Promise.all([
                this.audioClassifier.classify(localPath).catch(err => {
                    console.error(`[MediaPipeline] Audio classify error for ${assetId}:`, err.message);
                    return { audioType: 'unknown', hasAudio: false, hasSpokenWord: false, error: true };
                }),
                this.visualAnalyzer.analyze(localPath, null).catch(err => {
                    console.error(`[MediaPipeline] Visual analyze error for ${assetId}:`, err.message);
                    return { error: true, sceneType: 'unknown' };
                }),
            ]);

            // Transcribe only if spoken word detected
            let transcriptText = null;
            if (audioAnalysis.hasSpokenWord === true) {
                transcriptText = await this._transcribe(localPath, assetId).catch(err => {
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
                    analysis_status: ASSET_ANALYSIS_DONE,
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
            await this._updateAssetStatus(assetId, ASSET_ANALYSIS_FAILED);
        } finally {
            // Only remove a file WE downloaded — never a pre-existing local upload.
            if (cleanupPath) {
                try { fs.unlinkSync(cleanupPath); } catch { /* already gone */ }
            }
        }
    }

    /**
     * Create the media_assets row if it doesn't exist yet.
     *
     * This is the row every other write in this file targets. Without it,
     * `.update(...).eq('id', assetId)` silently affects zero rows — no error, no
     * warning, and the caller's own success log still prints. That is why the
     * table sat at 0 rows in production while the pipeline appeared healthy.
     *
     * Uses upsert with ignoreDuplicates so a re-analysis of the same asset (or
     * two jobs racing for it) can't clobber existing results.
     *
     * @private
     */
    async _ensureAssetRow(assetId, projectId, userId, name) {
        try {
            const { error } = await supabaseAdmin
                .from('media_assets')
                .upsert(
                    {
                        id:         assetId,
                        user_id:    userId    || null,
                        project_id: projectId || null,
                        name:       name      || null,
                    },
                    { onConflict: 'id', ignoreDuplicates: true }
                );

            if (error) {
                console.error(`[MediaPipeline] _ensureAssetRow failed for ${assetId}:`, error.message);
            }
        } catch (err) {
            console.error('[MediaPipeline] _ensureAssetRow threw:', err.message);
        }
    }

    /**
     * Resolve an input reference to a readable LOCAL file.
     *
     * `AudioClassifier.classify()` and `VisualAnalyzer.analyze()` both start with
     * `fs.existsSync(filePath)` and return an empty/unknown result if it's false.
     * The asset-analysis job is handed a GCS key (`raw/{userId}/{file}` — the
     * same value the client passes as `gcsPath`), so that check failed every
     * time and BOTH analyzers degraded to 'unknown' without raising anything.
     *
     * @returns {Promise<{localPath: string|null, cleanupPath: string|null}>}
     *   cleanupPath is set ONLY when this function downloaded the file, so the
     *   caller never deletes a real local upload.
     * @private
     */
    async _resolveToLocalFile(filePath, assetId) {
        if (!filePath) return { localPath: null, cleanupPath: null };

        // Already a readable local file (local-storage mode / legacy upload path).
        try {
            if (fs.existsSync(filePath)) return { localPath: filePath, cleanupPath: null };
        } catch { /* fall through to GCS */ }

        const storageConfig = require('../../../config/storage');
        if (!storageConfig.bucket) {
            console.warn(`[MediaPipeline] No local file and no GCS bucket configured for ${assetId}`);
            return { localPath: null, cleanupPath: null };
        }

        // Mirrors jobs/audioProcessor.js's GCS fallback. Downloading to the OS
        // temp dir (not uploads/) keeps these throwaway copies out of the
        // directory the storage layer treats as real user content.
        const gcsPath = filePath;
        const dest = path.join(
            os.tmpdir(),
            `mediaintel_${assetId.replace(/[^a-zA-Z0-9._-]/g, '')}_${Date.now()}${path.extname(gcsPath) || '.mp4'}`
        );

        try {
            await storageConfig.bucket.file(gcsPath).download({ destination: dest });
            console.log(`[MediaPipeline] Downloaded ${gcsPath} for analysis`);
            return { localPath: dest, cleanupPath: dest };
        } catch (err) {
            console.error(`[MediaPipeline] GCS download failed for ${gcsPath}:`, err.message);
            try { fs.unlinkSync(dest); } catch { /* nothing written */ }
            return { localPath: null, cleanupPath: null };
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

            const allDone = assets.length > 0 && assets.every(a => a.analysis_status === ASSET_ANALYSIS_DONE);
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
                .eq('analysis_status', ASSET_ANALYSIS_DONE);

            if (error || !assets?.length) return;

            const classification = await this.contentClassifier.classifyBin(assets);

            // NEVER call .catch() on a PostgREST query builder.
            //
            // The builder is THENABLE but not a Promise: it implements .then()
            // and nothing else. `.eq(...).catch(fn)` therefore throws
            // `TypeError: ....catch is not a function` SYNCHRONOUSLY, before the
            // query is ever sent — so both of these updates never ran at all.
            // The outer try/catch turned that into a single log line
            // ("runBinClassification error: ... .catch is not a function") that
            // looked like a runtime failure inside the query rather than a query
            // that never happened. Await the builder and inspect `error`, the
            // pattern used everywhere else in this file.
            let classified = 0;
            for (const classifiedAsset of (classification.assets || [])) {
                if (!classifiedAsset.id) continue;

                const { error: assetErr } = await supabaseAdmin
                    .from('media_assets')
                    .update({
                        content_class:   classifiedAsset.content_class,
                        suggested_track: classifiedAsset.suggested_track,
                        related_to:      classifiedAsset.related_to || null,
                        confidence:      classifiedAsset.confidence,
                    })
                    .eq('id', classifiedAsset.id);

                if (assetErr) {
                    console.error(
                        `[MediaPipeline] asset class update failed for ${classifiedAsset.id}:`,
                        assetErr.message
                    );
                } else {
                    classified++;
                }
            }

            // Update project with detected type
            if (classification.projectType || classification.projectDescription) {
                const { error: projErr } = await supabaseAdmin
                    .from('projects')
                    .update({
                        detected_project_type: classification.projectType,
                        bin_classification:    classification,
                    })
                    .eq('id', projectId);

                if (projErr) {
                    console.error('[MediaPipeline] project update failed:', projErr.message);
                }
            }

            console.log(
                `[MediaPipeline] Bin classification persisted for ${classified}/` +
                `${(classification.assets || []).length} asset(s)`
            );

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
            a.analysis_status === ASSET_ANALYSIS_DONE || a.analysisStatus === ASSET_ANALYSIS_DONE
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
        if (!isAIConfigured()) return null;

        const OpenAI = require('openai');
        const fs = require('fs');
        const openai = getAIClient();

        const transcription = await openai.audio.transcriptions.create({
            file:  fs.createReadStream(filePath),
            model: 'whisper-1',
        });

        return transcription?.text || null;
    }
}

module.exports = { MediaIntelligencePipeline };
