/**
 * server/routes/brainRoutes.js
 *
 * Brain API — exposes Editorial Brain + Media Intelligence to the frontend.
 * DO NOT modify any existing route file.
 *
 * All routes require authenticateUser middleware.
 * Rate limited via aiLimiter (applied at mount point in index.js).
 *
 * Routes:
 *   POST   /api/brain/command         — Execute a command via the brain
 *   POST   /api/brain/analyze         — Analyze project state (advise only)
 *   POST   /api/brain/feedback        — Record suggestion chip feedback
 *   POST   /api/brain/analyze-asset   — Queue asset analysis (BullMQ job)
 *   GET    /api/brain/bin-summary     — Fast media bin summary (no AI)
 *   POST   /api/brain/organize        — Build a timeline organize plan
 *   GET    /api/brain/profile         — Return learned user style (for "Your Style" page)
 *   DELETE /api/brain/profile/reset   — Reset learned profile (GDPR: right to erasure)
 *   GET    /api/brain/profile/export  — Export raw profile JSON (GDPR: right to data portability)
 */

'use strict';

const express = require('express');
const router  = express.Router();

const { authenticateUser }      = require('../../middleware/auth');
const { BrainOrchestrator }     = require('../brain/Orchestrator');
const { PatternLearner }        = require('../brain/PatternLearner');
const { UserProfileEngine }     = require('../brain/UserProfileEngine');
const { MediaIntelligencePipeline } = require('../brain/media/MediaIntelligencePipeline');
const { getOrCreateSession }    = require('../brain/Session');
const { supabaseAdmin }         = require('../../config/database');

// Singleton instances — shared across requests
const orchestrator   = new BrainOrchestrator();
const learner        = new PatternLearner();
const profileEngine  = new UserProfileEngine();
const mediaIntel     = new MediaIntelligencePipeline();

// ── POST /api/brain/command ───────────────────────────────────────────────────
// Execute a natural-language command via the Editorial Brain.
// Returns full BrainOutput including intent, response, and learning.
router.post('/command', authenticateUser, async (req, res) => {
    try {
        const { rawInput, trigger = 'user_typed', projectState = {} } = req.body || {};

        // Validate: need rawInput OR a non-text trigger
        const nonTextTriggers = ['suggestion_tapped', 'project_opened', 'asset_added'];
        if (!rawInput && !nonTextTriggers.includes(trigger)) {
            return res.status(400).json({ error: 'rawInput is required for user_typed and user_spoke triggers' });
        }

        // Validate: projectId is required
        if (!projectState.projectId) {
            return res.status(400).json({ error: 'projectState.projectId is required' });
        }

        /** @type {import('../brain/types').BrainInput} */
        const input = {
            userId:   req.user.id,
            rawInput: rawInput || null,
            trigger,
            context: {
                ...projectState,
                projectId: projectState.projectId,
            },
        };

        const brainOutput = await orchestrator.process(input);
        return res.json(brainOutput);

    } catch (err) {
        console.error('[brainRoutes] /command error:', err.message);
        return res.status(500).json({ error: err.message, message: 'Brain command failed' });
    }
});

// ── POST /api/brain/analyze ───────────────────────────────────────────────────
// Analyse the current project state and return suggestions (NO command execution).
// Used when opening a project or after adding an asset.
// Returns ONLY { response, nextSuggestions } — intent/learning are not exposed.
router.post('/analyze', authenticateUser, async (req, res) => {
    try {
        const { projectState = {}, trigger = 'project_opened' } = req.body || {};

        /** @type {import('../brain/types').BrainInput} */
        const input = {
            userId:   req.user.id,
            rawInput: null,
            trigger,
            context: {
                ...projectState,
                projectId: projectState.projectId || null,
            },
        };

        // Force advise-only: patch intent before returning
        const brainOutput = await orchestrator.process(input);

        // Return only response fields — no intent or learning exposed
        return res.json({
            response:        brainOutput.response,
            nextSuggestions: brainOutput.response?.suggestions || [],
        });

    } catch (err) {
        console.error('[brainRoutes] /analyze error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

// ── POST /api/brain/feedback ──────────────────────────────────────────────────
// Record user accept/dismiss on a suggestion chip.
// Always returns { ok: true } even if Supabase is down.
router.post('/feedback', authenticateUser, async (req, res) => {
    try {
        const { suggestionType, accepted, sessionId } = req.body || {};

        if (typeof suggestionType !== 'string' || !suggestionType) {
            return res.status(400).json({ error: 'suggestionType must be a non-empty string' });
        }
        if (typeof accepted !== 'boolean') {
            return res.status(400).json({ error: 'accepted must be a boolean' });
        }

        // recordFeedback never throws — always { ok: true }
        await learner.recordFeedback(req.user.id, suggestionType, accepted, sessionId || 'unknown');

        return res.json({ ok: true });

    } catch (err) {
        // Belt-and-suspenders — recordFeedback should never throw, but just in case
        console.error('[brainRoutes] /feedback error:', err.message);
        return res.json({ ok: true }); // still return ok — feedback loss is acceptable
    }
});

// ── POST /api/brain/analyze-asset ────────────────────────────────────────────
// Queue asset analysis as a BullMQ job.
// Returns { jobId, status: 'queued' } immediately — DO NOT run inline.
// Vision analysis can take 10–30s and must not block the HTTP response.
router.post('/analyze-asset', authenticateUser, async (req, res) => {
    try {
        const { assetId, gcsPath, projectId } = req.body || {};

        if (!assetId || typeof assetId !== 'string') {
            return res.status(400).json({ error: 'assetId is required' });
        }
        if (!gcsPath || typeof gcsPath !== 'string') {
            return res.status(400).json({ error: 'gcsPath is required' });
        }

        // Add to the 'asset-analysis' BullMQ queue
        const { Queue } = require('bullmq');
        const { connection } = require('../../queue/connection');

        const assetAnalysisQueue = new Queue('asset-analysis', { connection });

        const job = await assetAnalysisQueue.add('analyze', {
            assetId,
            filePath: gcsPath,
            projectId: projectId || null,
            userId: req.user.id,
        });

        return res.json({ jobId: job.id, status: 'queued' });

    } catch (err) {
        console.error('[brainRoutes] /analyze-asset error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

// ── GET /api/brain/bin-summary ────────────────────────────────────────────────
// Fast read of the media bin — pure DB query + summary, no AI calls.
// Should return in < 200ms.
router.get('/bin-summary', authenticateUser, async (req, res) => {
    try {
        const { projectId } = req.query;

        if (!projectId) {
            return res.status(400).json({ error: 'projectId query param required' });
        }

        const { data: assets, error } = await supabaseAdmin
            .from('media_assets')
            .select('*')
            .eq('project_id', projectId);

        if (error) {
            console.error('[brainRoutes] bin-summary DB error:', error.message);
            return res.status(500).json({ error: error.message });
        }

        const summary = mediaIntel.getSummary(assets || []);
        return res.json(summary);

    } catch (err) {
        console.error('[brainRoutes] /bin-summary error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

// ── POST /api/brain/organize ──────────────────────────────────────────────────
// Build a timeline organize plan from analyzed assets.
// Returns a PLAN — frontend decides whether to execute the commands.
// If not all assets are analyzed yet, returns { ready: false } instead of an error.
router.post('/organize', authenticateUser, async (req, res) => {
    try {
        const { projectId, platform } = req.body || {};

        if (!projectId) {
            return res.status(400).json({ error: 'projectId is required' });
        }

        const { data: assets, error } = await supabaseAdmin
            .from('media_assets')
            .select('*')
            .eq('project_id', projectId);

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        const bin = assets || [];

        // Check if all assets are done
        const unanalyzed = bin.filter(a => a.analysis_status !== 'done');
        if (unanalyzed.length > 0) {
            return res.json({
                ready: false,
                message: `Still analyzing ${unanalyzed.length} asset${unanalyzed.length !== 1 ? 's' : ''}`,
            });
        }

        const plan = await mediaIntel.buildOrganizePlan(bin, platform || null);

        return res.json({
            ready: true,
            commands:    plan.commands,
            explanation: plan.explanation,
            suggestions: plan.suggestions,
        });

    } catch (err) {
        console.error('[brainRoutes] /organize error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

// ── GET /api/brain/profile ────────────────────────────────────────────────────
// Returns the user's learned editing style in a display-friendly format.
// Powers the "Your Style" settings page.
//
// Response shape:
// {
//   pacePreference:  string     — 'Fast cuts (8/min)' | 'Medium' | 'Slow'
//   typicalPlatform: string     — first preferred platform or 'Not set'
//   commonWorkflow:  string[]   — top 3 commands by frequency
//   favoriteLUT:     { name, useCount } | null
//   favoritePreset:  { name, useCount } | null
//   skillLevel:      string
//   contentType:     string
//   patterns: {
//     removeSilences: boolean
//     addsCaptions:   boolean
//     addsMusic:      boolean
//   }
//   dataAvailable:   boolean    — false when profile is brand new / no data yet
// }
router.get('/profile', authenticateUser, async (req, res) => {
    try {
        const userId  = req.user.id;
        const profile = await profileEngine.getProfile(userId);

        // ── Pace preference from avg_cut_rate ─────────────────────────────────
        const avgCutRate = profile.avg_cut_rate || 0;
        let pacePreference = 'Not established yet';
        if (avgCutRate >= 6)      pacePreference = `Fast cuts (${avgCutRate.toFixed(1)}/min)`;
        else if (avgCutRate >= 3) pacePreference = `Medium pace (${avgCutRate.toFixed(1)}/min)`;
        else if (avgCutRate > 0)  pacePreference = `Slow / deliberate (${avgCutRate.toFixed(1)}/min)`;

        // ── Common workflow from top 3 commands ───────────────────────────────
        const commands = profile.common_commands || {};
        const commonWorkflow = Object.entries(commands)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([cmd]) => cmd);

        // ── Favourite LUT from asset_usage_log ───────────────────────────────
        let favoriteLUT = null;
        try {
            const { data: lutRows } = await supabaseAdmin
                .from('asset_usage_log')
                .select('asset_id, count:asset_id.count()')
                .eq('user_id', userId)
                .eq('asset_type', 'LUT')
                .eq('accepted', true)
                .order('count', { ascending: false })
                .limit(1);

            if (lutRows?.length) {
                const topRow = lutRows[0];
                const { data: lutAsset } = await supabaseAdmin
                    .from('assets')
                    .select('display_name')
                    .eq('id', topRow.asset_id)
                    .single();
                favoriteLUT = {
                    name:     lutAsset?.display_name || topRow.asset_id,
                    useCount: topRow.count || 0,
                };
            }
        } catch { /* not critical — continues below */ }

        // ── Favourite preset from user_presets ────────────────────────────────
        let favoritePreset = null;
        try {
            const { data: presetRows } = await supabaseAdmin
                .from('user_presets')
                .select('name, use_count')
                .eq('user_id', userId)
                .order('use_count', { ascending: false })
                .limit(1);

            if (presetRows?.length) {
                favoritePreset = {
                    name:     presetRows[0].name,
                    useCount: presetRows[0].use_count || 0,
                };
            }
        } catch { /* not critical */ }

        // ── Preferred sounds from profile ────────────────────────────────────
        const preferredSounds = profile.preferred_sounds || [];

        const dataAvailable = commonWorkflow.length > 0 || avgCutRate > 0;

        return res.json({
            pacePreference,
            typicalPlatform: (profile.preferred_platforms || [])[0] || 'Not set',
            commonWorkflow,
            preferredSounds,
            favoriteLUT,
            favoritePreset,
            skillLevel:      profile.skill_level   || 'beginner',
            contentType:     profile.content_type  || 'unknown',
            patterns: {
                removeSilences: profile.typically_removes_silences || false,
                addsCaptions:   profile.typically_adds_captions   || false,
                addsMusic:      profile.typically_adds_music       || false,
            },
            dataAvailable,
        });

    } catch (err) {
        console.error('[brainRoutes] GET /profile error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

// ── DELETE /api/brain/profile/reset ──────────────────────────────────────────
// GDPR right to erasure: deletes the user's learned editing profile.
// Also clears suggestion_feedback and user_presets rows.
// The user's projects and assets are NOT deleted.
router.delete('/profile/reset', authenticateUser, async (req, res) => {
    const userId = req.user.id;

    try {
        await Promise.all([
            supabaseAdmin.from('user_editing_profiles').delete().eq('user_id', userId),
            supabaseAdmin.from('suggestion_feedback').delete().eq('user_id', userId),
            supabaseAdmin.from('user_presets').delete().eq('user_id', userId),
            supabaseAdmin.from('asset_usage_log').delete().eq('user_id', userId),
        ]);

        console.log(`[brainRoutes] Profile reset for user ${userId}`);
        return res.json({ ok: true, message: 'Your learned style data has been deleted.' });

    } catch (err) {
        console.error('[brainRoutes] DELETE /profile/reset error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

// ── GET /api/brain/profile/export ────────────────────────────────────────────
// GDPR right to data portability: returns all learned data as downloadable JSON.
router.get('/profile/export', authenticateUser, async (req, res) => {
    const userId = req.user.id;

    try {
        const [profileRes, feedbackRes, presetsRes, usageRes] = await Promise.all([
            supabaseAdmin.from('user_editing_profiles').select('*').eq('user_id', userId).single(),
            supabaseAdmin.from('suggestion_feedback').select('*').eq('user_id', userId),
            supabaseAdmin.from('user_presets').select('*').eq('user_id', userId),
            supabaseAdmin.from('asset_usage_log').select('*').eq('user_id', userId),
        ]);

        const exportData = {
            exported_at:       new Date().toISOString(),
            user_id:           userId,
            editing_profile:   profileRes.data   || null,
            suggestion_feedback: feedbackRes.data || [],
            user_presets:      presetsRes.data    || [],
            asset_usage_log:   usageRes.data      || [],
        };

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="vibed-style-data-${userId.slice(0, 8)}.json"`);
        return res.json(exportData);

    } catch (err) {
        console.error('[brainRoutes] GET /profile/export error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

module.exports = router;
