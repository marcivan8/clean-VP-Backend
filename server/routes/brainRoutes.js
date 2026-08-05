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
 *   POST   /api/brain/observe-command — Learn from an executed command (no GPT)
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
const { ProjectIntelligence }   = require('../brain/ProjectIntelligence');
const { getOrCreateSession }    = require('../brain/Session');
const { supabaseAdmin }         = require('../../config/database');
const { ASSET_ANALYSIS_DONE }   = require('../brain/media/analysisStatus');

// Singleton instances — shared across requests
const orchestrator   = new BrainOrchestrator();
const learner        = new PatternLearner();
const profileEngine  = new UserProfileEngine();
const mediaIntel     = new MediaIntelligencePipeline();
const projectIntel   = new ProjectIntelligence();

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

        // ── Enrich with MEDIA INTELLIGENCE ────────────────────────────────────
        // The client can only describe the timeline (durations, counts). What the
        // footage actually CONTAINS — scene type, people on camera, framing,
        // content description — lives in media_assets, written by the
        // asset-analysis worker. Reading it here is what lets the Brain give
        // advice tailored to the material instead of generic pacing tips.
        // Best-effort: any failure leaves the Brain with timeline-only context.
        let assetIntelligence = [];
        try {
            const ids = (projectState.mediaBin || []).map(a => a.id).filter(Boolean);
            if (ids.length > 0) {
                const { data, error } = await supabaseAdmin
                    .from('media_assets')
                    .select('id, name, scene_type, camera_angle, subject_count, has_main_speaker, has_faces, is_broll, is_screen_recording, location_type, lighting_quality, stability, emotional_tone, content_description, suggested_label, audio_type, has_spoken_word, analysis_status')
                    .in('id', ids);
                if (error) throw error;
                assetIntelligence = data || [];
            }
        } catch (miErr) {
            console.warn('[brainRoutes] /analyze: media intelligence lookup failed (continuing without it):', miErr.message);
        }

        // ── Enrich with the PROJECT MAP ───────────────────────────────────────
        // One level up from per-asset intelligence: what this project IS, which
        // asset plays which role in it, and what it's missing (R44). Derivation
        // is fingerprint-gated, so this is a cheap read on every request except
        // the ones where the bin or timeline actually changed.
        //
        // Best-effort by design: ensureMap() never throws, and a null map just
        // means the Brain reasons without project-level context exactly as it
        // did before this existed. A slow or failed derivation must never take
        // down the advisory request that triggered it.
        let projectMap = null;
        try {
            if (projectState.projectId) {
                projectMap = await projectIntel.ensureMap({
                    projectId: projectState.projectId,
                    userId:    req.user.id,
                    assets:    assetIntelligence,
                    clipCount: projectState.clipCount || 0,
                    platform:  projectState.platform || null,
                });
            }
        } catch (pmErr) {
            console.warn('[brainRoutes] /analyze: project map failed (continuing without it):', pmErr.message);
        }

        /** @type {import('../brain/types').BrainInput} */
        const input = {
            userId:   req.user.id,
            rawInput: null,
            trigger,
            // Forces the orchestrator to treat any 'execute' intent as 'advise' —
            // this route must never run a command, only observe and suggest.
            adviceOnly: true,
            context: {
                ...projectState,
                assetIntelligence,
                projectMap,
                projectId: projectState.projectId || null,
            },
        };

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

// ── POST /api/brain/observe-command ──────────────────────────────────────────
// Record a command the REAL execution pipeline just ran, and update the user's
// editing profile from it. Learning only — NO GPT call, no execution, no
// suggestions returned.
//
// WHY THIS EXISTS (see CLAUDE.md R37): profile learning used to happen only in
// Orchestrator PHASE 5, which is reachable only via POST /api/brain/command.
// The client deliberately stopped calling that route — the Brain was making a
// SECOND, independent GPT-4o interpretation of text the real pipeline had
// already parsed, which could disagree with what actually executed. Removing it
// was correct, but it silently took the only `updateFromCommand()` hook with
// it: every `/analyze` path passes executionResult = null, so the condition
// `engineResult?.success` was never true again. `common_commands`,
// `typically_removes_silences`, `typically_adds_captions`,
// `typically_adds_music` and `skill_level` all stopped accumulating, while the
// client's own `editHistory` ledger (R19/R29) knew exactly what had run and had
// no way to tell the server.
//
// This endpoint is that missing hook, and nothing more. It takes an ALREADY
// RESOLVED command name from the pipeline that actually executed it, so there
// is no second interpretation to disagree with. It is called fire-and-forget,
// so it must never be slow and must never return an error the caller has to
// handle — a lost learning event is strictly preferable to a broken edit.
router.post('/observe-command', authenticateUser, async (req, res) => {
    try {
        const { command, success = true, projectId = null, sessionId = null, summary = null } = req.body || {};

        if (typeof command !== 'string' || !command.trim()) {
            return res.status(400).json({ error: 'command must be a non-empty string' });
        }

        // Only successful commands shape the profile. A failed command says
        // nothing about what the user PREFERS — it usually says the opposite of
        // what they got — and letting failures vote would teach the profile
        // habits the user never actually completed.
        if (success === true) {
            // Awaited so skill_level is recomputed from the same write (see
            // UserProfileEngine.updateFromCommand). Still fast: two Supabase
            // round-trips, no model call.
            await profileEngine.updateFromCommand(req.user.id, command.trim(), true);
        }

        // Best-effort session log — mirrors what PatternLearner.persistAsync
        // writes for the /command path, so the editing_sessions ledger stays
        // complete now that real executions no longer flow through there.
        try {
            await supabaseAdmin
                .from('editing_sessions')
                .insert({
                    user_id:          req.user.id,
                    project_id:       projectId || null,
                    session_id:       sessionId || 'unknown',
                    trigger:          'command_executed',
                    raw_input:        summary || null,
                    resolved_command: command.trim(),
                    executed:         success === true,
                });
        } catch (logErr) {
            console.error('[brainRoutes] /observe-command session log failed:', logErr.message);
        }

        return res.json({ ok: true });

    } catch (err) {
        console.error('[brainRoutes] /observe-command error:', err.message);
        // Never surface a hard failure to a fire-and-forget caller.
        return res.json({ ok: true });
    }
});

// ── POST /api/brain/analyze-asset ────────────────────────────────────────────
// Queue asset analysis as a BullMQ job.
// Returns { jobId, status: 'queued' } immediately — DO NOT run inline.
// Vision analysis can take 10–30s and must not block the HTTP response.
router.post('/analyze-asset', authenticateUser, async (req, res) => {
    try {
        const { assetId, gcsPath, projectId, name } = req.body || {};

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
            // Stored on the media_assets row so the Brain can refer to footage
            // BY NAME (R22) rather than as an opaque id. Falls back to the
            // filename in the GCS key when the client doesn't send one.
            name: (typeof name === 'string' && name.trim())
                ? name.trim()
                : gcsPath.split('/').pop() || null,
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
        const unanalyzed = bin.filter(a => a.analysis_status !== ASSET_ANALYSIS_DONE);
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
