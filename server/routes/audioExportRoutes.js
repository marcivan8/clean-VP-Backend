'use strict';

/**
 * server/routes/audioExportRoutes.js
 *
 * Audio export API routes.
 *
 * Routes:
 *   POST /api/audio/export — extract audio from a video and stream it to the client
 *
 * Supported formats: mp3, wav, aac, m4a
 *
 * Request body:
 *   videoUrl    {string}          — signed GCS URL or any URL ffmpeg can read (required if no projectId)
 *   projectId   {string}          — look up first video asset from project timeline (required if no videoUrl)
 *   format      {'mp3'|'wav'|'aac'|'m4a'} — default: 'mp3'
 *   bitrate     {string}          — e.g. '128k', '192k', '320k' (ignored for wav)
 *   sampleRate  {number}          — e.g. 44100, 48000
 *   channels    {1|2}             — 1=mono, 2=stereo
 *   normalize   {boolean}         — EBU R128 loudness normalisation (default: false)
 *   fadeIn      {number}          — fade-in duration in seconds
 *   fadeOut     {number}          — fade-out duration in seconds
 *   trimStart   {number}          — start time in seconds
 *   trimEnd     {number}          — end time in seconds
 *
 * Response:
 *   Streams the audio file directly. Content-Type and Content-Disposition set.
 *   Temp file deleted after stream ends.
 */

const express = require('express');
const router  = express.Router();

const { authenticateUser }   = require('../middleware/auth.js');
const { audioExportService } = require('../audio-engine/export/AudioExportService.js');
const { supabaseAdmin }      = require('../../config/database.js');

// TODO: apply uploadLimiter or a dedicated audio export rate limiter

const SUPPORTED_FORMATS = ['mp3', 'wav', 'aac', 'm4a'];

// ── POST /api/audio/export ────────────────────────────────────────────────────
router.post('/export', authenticateUser, async (req, res) => {
    const {
        videoUrl,
        projectId,
        format     = 'mp3',
        bitrate    = '192k',
        sampleRate,
        channels,
        normalize  = false,
        fadeIn,
        fadeOut,
        trimStart,
        trimEnd,
    } = req.body || {};

    // ── Validate ──────────────────────────────────────────────────────────────

    if (!videoUrl && !projectId) {
        return res.status(400).json({ error: 'videoUrl or projectId is required' });
    }

    if (!SUPPORTED_FORMATS.includes(format)) {
        return res.status(400).json({
            error: `format must be one of: ${SUPPORTED_FORMATS.join(', ')}`,
        });
    }

    let sourceInput = videoUrl || null;
    let tempInputPath = null; // only set if we download to local temp

    try {
        // ── Resolve source from projectId ─────────────────────────────────────
        if (!sourceInput && projectId) {
            const { data: project, error: projErr } = await supabaseAdmin
                .from('projects')
                .select('timeline_state')
                .eq('id', projectId)
                .eq('user_id', req.user.id)
                .single();

            if (projErr || !project) {
                return res.status(404).json({ error: 'Project not found' });
            }

            // Walk the timeline to find the first video clip URL
            const timeline = project.timeline_state || {};
            const tracks   = Array.isArray(timeline.tracks) ? timeline.tracks : [];
            let assetUrl   = null;

            outer: for (const track of tracks) {
                const clips = Array.isArray(track.clips) ? track.clips : [];
                for (const clip of clips) {
                    // Accept any of the common URL fields the timeline might store
                    const url = clip.src || clip.proxyUrl || clip.originalUrl || clip.url;
                    if (url) {
                        assetUrl = url;
                        break outer;
                    }
                }
            }

            if (!assetUrl) {
                return res.status(400).json({ error: 'No video asset found in project timeline' });
            }

            sourceInput = assetUrl;
        }

        // ── Run extraction ────────────────────────────────────────────────────
        const opts = {
            format,
            bitrate,
            sampleRate: sampleRate ? Number(sampleRate) : undefined,
            channels:   channels   ? Number(channels)   : undefined,
            normalize:  Boolean(normalize),
            fadeIn:     fadeIn     ? Number(fadeIn)     : undefined,
            fadeOut:    fadeOut    ? Number(fadeOut)     : undefined,
            trimStart:  trimStart  ? Number(trimStart)  : undefined,
            trimEnd:    trimEnd    ? Number(trimEnd)     : undefined,
        };

        const { outputPath, mimeType } = await audioExportService.extractAudio(sourceInput, opts);

        // ── Stream response (deletes temp file on stream end) ─────────────────
        audioExportService.streamAndCleanup(outputPath, mimeType, format, res);

    } catch (err) {
        console.error('[audioExportRoutes POST /export] error:', err.message);

        // Clean up temp input file if we had one
        if (tempInputPath) audioExportService.cleanup(tempInputPath);

        if (!res.headersSent) {
            return res.status(500).json({ error: err.message });
        }
    }
});

module.exports = router;
