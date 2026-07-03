/**
 * routes/interviewRoutes.js
 *
 * Interview / Podcast / Talking-Head smart editing endpoints.
 *
 * Phase 1 — Single person:
 *   POST /api/interview/analyze
 *     Transcribes a video with OpenAI Whisper, classifies pauses (thinking vs
 *     dead air), detects filler words, and returns pre-computed activeSegment
 *     sets the editor can apply with one click.
 *
 * Phase 2 — Multi-person:
 *   POST /api/interview/split-speakers
 *     (Requires DIARIZE_SERVICE_URL) Runs WhisperX + pyannote diarization and
 *     returns speaker-segmented clip lists for building a multi-track timeline.
 *
 * Phase 3 — Semantic clip organizer:
 *   POST /api/interview/organize-clips
 *     Extracts one representative frame per clip asset via ffmpeg, sends all
 *     frames + optional transcripts to GPT-4o-mini Vision in one batch call,
 *     and returns per-clip metadata (type, energy, summary) plus an ordered
 *     list of clip IDs and a human-readable rationale.
 */

const express        = require('express');
const router         = express.Router();
const path           = require('path');
const fs             = require('fs');
const { authenticateUser } = require('../middleware/auth');
const { aiGate }     = require('../middleware/usageGate');
const { audioQueue } = require('../queue/queues');
const storageConfig  = require('../config/storage');

// ── Shared path-resolution helper ─────────────────────────────────────────────
// Mirrors the same guard used in silenceRoutes and audioRoutes so every route
// enforces the same uploads/ boundary.
function resolveUploadPath(filename, filePath) {
    const uploadsDir = path.resolve(__dirname, '../uploads');

    const normalized = (filename || '')
        .replace(/\\/g, '/')
        .replace(/^\/|\.\.\/|\.\.$/g, '');

    let inputPath = filePath
        ? path.resolve(filePath)
        : path.resolve(uploadsDir, normalized);

    if (!inputPath.startsWith(uploadsDir)) {
        return { error: 'Access denied: invalid file path', inputPath: null, uploadsDir };
    }

    // Bare filename fall-back to uploads/temp/
    if (!fs.existsSync(inputPath)) {
        const tempPath = path.resolve(uploadsDir, 'temp', path.basename(inputPath));
        if (tempPath.startsWith(uploadsDir) && fs.existsSync(tempPath)) {
            inputPath = tempPath;
        }
        // In GCS deployments the worker will download from GCS — don't hard-reject here
    }

    return { error: null, inputPath, uploadsDir, normalized };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/interview/rhythm-zoom   (SYNCHRONOUS — no file, no queue)
//
// Assigns a static zoom scale to each existing clip on the timeline so that
// the natural cut-points between clips simulate a multi-camera shoot.
//
// Key insight: after silence removal the timeline already has many short clips.
// Each clip IS a "camera shot". We just decide whether it's wide / medium /
// close based on the surviving words inside that clip.  We never add keyframes
// inside a clip — one static scale per clip, applied at time=0.
//
// Body:
//   clips  – Array<{ id, offset, duration }>  (video track clips from the store)
//   words  – Array<{ word, start, end }>       (original Whisper transcript)
//   style  – 'subtle' | 'dynamic' | 'cinematic'
//
// Returns synchronously (typically < 5 s — one GPT-4o-mini call):
//   { clipZooms: [{ clipId, scale, type }], summary }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/rhythm-zoom', authenticateUser, aiGate, async (req, res) => {
    try {
        const { clips = [], words = [], style = 'dynamic' } = req.body;

        if (!clips.length) {
            return res.status(400).json({ error: 'No clips provided. Add video clips to the timeline first.' });
        }
        if (!words.length) {
            return res.status(400).json({ error: 'No transcript provided. Run Auto-Captions first.' });
        }
        if (clips.length < 2) {
            return res.status(400).json({
                error: 'Only one clip found. Run Silence Removal first to create segments — each cut becomes a camera shot.',
            });
        }

        // ── Style config ────────────────────────────────────────────────────────
        // min = wide shot scale, max = close-up scale, mid = medium shot
        const STYLES = {
            subtle:    { wide: 1.00, mid: 1.06, close: 1.12 },
            dynamic:   { wide: 1.00, mid: 1.10, close: 1.20 },
            cinematic: { wide: 1.00, mid: 1.12, close: 1.26 },
        };
        const cfg = STYLES[style] || STYLES.dynamic;

        // ── Per-clip word extraction ────────────────────────────────────────────
        // Match words to clips by source-video offset overlap.
        // A word belongs to a clip if it falls within [clip.offset, clip.offset + clip.duration].
        const clipTexts = clips.map(clip => {
            const ofs = clip.offset ?? 0;
            const end = ofs + (clip.duration ?? 0);
            const clipWords = words
                .filter(w => w.start >= ofs - 0.05 && w.end <= end + 0.05)
                .map(w => w.word)
                .join(' ')
                .trim();
            return clipWords || '[silence]';
        });

        // ── GPT-4o-mini batch scoring ───────────────────────────────────────────
        // Send all clip texts at once. Assign 'wide' | 'medium' | 'close' and
        // an intensity score (0-1) to each.
        const OpenAI = require('openai');
        if (!process.env.OPENAI_API_KEY) {
            return res.status(503).json({ error: 'OPENAI_API_KEY not configured on server.' });
        }
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 30_000 });

        const compact = clipTexts.map((t, i) => ({
            i,
            dur: parseFloat((clips[i].duration || 0).toFixed(1)),
            t: t.slice(0, 120),   // cap length to keep the prompt small
        }));

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{
                role: 'user',
                content:
`You are a professional video editor choosing camera shots for a talking-head interview.
Each entry is one edited clip from the timeline (already cut/cleaned). Assign it a shot type:
  "wide"   – neutral, transition, hesitation, low energy, breather
  "medium" – normal conversational tone, background explanation
  "close"  – key statement, emotion, emphasis, surprise, strong assertion

Rules:
- Vary shots — avoid the same type more than 3 clips in a row
- Never jump directly wide → close (use medium as bridge)
- Very short clips (dur < 0.8 s) must match the shot type of the clip before them
- Return ONLY valid JSON: {"c":[{"i":N,"type":"wide"|"medium"|"close"}]}

Clips: ${JSON.stringify(compact)}`,
            }],
            response_format: { type: 'json_object' },
            temperature:     0.2,
            max_tokens:      1024,
        });

        let gptAssignments = [];
        try {
            const parsed = JSON.parse(completion.choices[0].message.content);
            gptAssignments = parsed.c || [];
        } catch (_) {
            // Malformed — fall back to pure rhythm (wide/mid/close cycle)
        }

        // ── Build assignment map ────────────────────────────────────────────────
        const gptMap = {};
        gptAssignments.forEach(a => { gptMap[a.i] = a.type; });

        // ── Fallback rhythm for any unscored clips ──────────────────────────────
        // Simple cycling pattern: wide → medium → close → medium → wide …
        const FALLBACK_CYCLE = ['wide', 'medium', 'close', 'medium'];
        let prevType = 'wide';
        let sameCount = 0;

        const clipZooms = clips.map((clip, i) => {
            let type = gptMap[i] || null;

            // Short clip: inherit previous shot
            if (!type && (clip.duration ?? 0) < 0.8) {
                type = prevType;
            }

            // Pure fallback: cycle
            if (!type) {
                type = FALLBACK_CYCLE[i % FALLBACK_CYCLE.length];
            }

            // Enforce no wide→close jump
            if (type === 'close' && prevType === 'wide')  type = 'medium';
            if (type === 'wide'  && prevType === 'close') type = 'medium';

            // Enforce max 3 in a row
            if (type === prevType) {
                sameCount++;
                if (sameCount >= 3) {
                    type = type === 'wide' ? 'medium' : (type === 'close' ? 'medium' : 'wide');
                    sameCount = 0;
                }
            } else {
                sameCount = 1;
            }

            prevType = type;

            const scale = cfg[type] ?? 1.0;
            return { clipId: clip.id, scale, type };
        });

        // ── Summary ─────────────────────────────────────────────────────────────
        const counts = { wide: 0, medium: 0, close: 0 };
        clipZooms.forEach(c => { counts[c.type] = (counts[c.type] || 0) + 1; });

        console.log(
            `[interviewRoutes] rhythm-zoom: ${clips.length} clips → ` +
            `${counts.wide}W ${counts.medium}M ${counts.close}C  style=${style}`
        );

        res.json({
            clipZooms,
            summary: { clipCount: clips.length, style, counts, maxScale: cfg.close },
        });

    } catch (err) {
        console.error('[interviewRoutes] /rhythm-zoom error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/interview/analyze
// Body: { filename, filePath?, language? }
//
// Queues an "interview-analyze" job that:
//   1. Transcribes the video with OpenAI Whisper (word-level timestamps)
//   2. Classifies gaps between words:
//        < 0.3 s  → micro-pause  (keep as-is)
//        0.3–1.2 s → thinking     (flag for user review)
//        > 1.2 s  → dead_air      (suggest removal)
//   3. Keyword-matches filler words
//   4. Returns pre-built activeSegment sets for the editor
// ─────────────────────────────────────────────────────────────────────────────
router.post('/analyze', authenticateUser, aiGate, async (req, res) => {
    try {
        const { filename, filePath, language = 'en' } = req.body;

        if (!filename && !filePath) {
            return res.status(400).json({ error: 'Provide filename or filePath' });
        }

        const { error, inputPath, uploadsDir, normalized } = resolveUploadPath(filename, filePath);
        if (error) return res.status(403).json({ error });

        const userId    = req.user?.id || (process.env.NODE_ENV !== 'production' ? 'dev-user' : null);
        const uniqueId  = `interview-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

        // Preserve GCS-relative prefix so the worker uses the right GCS path
        const jobFilename = normalized.startsWith('raw/') || normalized.startsWith('temp/')
            ? normalized
            : path.basename(inputPath);

        const job = await audioQueue.add('interview-analyze', {
            action:   'interview-analyze',
            filename: jobFilename,
            filePath: inputPath,
            userId,
            language,
        }, {
            jobId:   uniqueId,
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
        });

        res.json({ success: true, jobId: job.id, status: 'queued' });

    } catch (err) {
        console.error('[interviewRoutes] /analyze error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/interview/split-speakers
// Body: { filename, filePath?, language? }
//
// Phase 2: Requires DIARIZE_SERVICE_URL env var (WhisperX + pyannote).
// Queues a "diarize" job (already handled in audioProcessor.js) and returns
// a jobId.  The job result includes { words, speakers } which the client then
// posts back as { words, speakers, videoDuration, projectId } to
// /api/interview/build-tracks to get the multi-track timeline_state patch.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/split-speakers', authenticateUser, aiGate, async (req, res) => {
    try {
        const DiarizeService = require('../services/DiarizeService');
        if (!DiarizeService.isAvailable) {
            return res.status(503).json({
                error: 'Speaker diarization is not configured on this server. Set DIARIZE_SERVICE_URL.',
            });
        }

        const { filename, filePath, language } = req.body;
        if (!filename && !filePath) {
            return res.status(400).json({ error: 'Provide filename or filePath' });
        }

        const { error, inputPath, normalized } = resolveUploadPath(filename, filePath);
        if (error) return res.status(403).json({ error });

        const userId   = req.user?.id || (process.env.NODE_ENV !== 'production' ? 'dev-user' : null);
        const uniqueId = `diarize-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const jobFilename = normalized.startsWith('raw/') || normalized.startsWith('temp/')
            ? normalized
            : path.basename(inputPath);

        const job = await audioQueue.add('diarize', {
            action:   'diarize',
            filename: jobFilename,
            filePath: inputPath,
            userId,
            language: language || null,
        }, {
            jobId:   uniqueId,
            attempts: 2,
            backoff: { type: 'exponential', delay: 5000 },
        });

        res.json({ success: true, jobId: job.id, status: 'queued' });

    } catch (err) {
        console.error('[interviewRoutes] /split-speakers error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/interview/build-tracks
// Body: { words, speakers, videoDuration, assetId }
//
// Phase 2 (client-facing): Takes diarize output and converts it into a
// list of clip ranges per speaker.  The client uses this to build a
// multi-track timeline_state.
//
// Returns:
//   { tracks: [{ speaker, clips: [{ start, end, duration }] }] }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/build-tracks', authenticateUser, (req, res) => {
    try {
        const { words, speakers, videoDuration, assetId } = req.body;

        if (!words?.length || !speakers?.length) {
            return res.status(400).json({ error: 'words and speakers are required' });
        }

        // Group consecutive words by speaker into clip ranges
        const MERGE_GAP = 0.5; // seconds — gaps shorter than this are merged within same speaker

        const speakerClips = {}; // { SPEAKER_00: [{ start, end }], ... }
        speakers.forEach(s => { speakerClips[s] = []; });

        let currentSpeaker = null;
        let currentClip    = null;

        for (const w of words) {
            const speaker = w.speaker || 'SPEAKER_00';
            if (!speakerClips[speaker]) speakerClips[speaker] = [];

            if (speaker !== currentSpeaker) {
                // Speaker change — close previous clip
                if (currentClip) speakerClips[currentSpeaker].push(currentClip);
                currentSpeaker = speaker;
                currentClip    = { start: w.start, end: w.end };
            } else {
                // Same speaker — extend or start new clip if gap is too large
                const gap = w.start - currentClip.end;
                if (gap > MERGE_GAP) {
                    speakerClips[speaker].push(currentClip);
                    currentClip = { start: w.start, end: w.end };
                } else {
                    currentClip.end = w.end;
                }
            }
        }
        if (currentClip) speakerClips[currentSpeaker].push(currentClip);

        // Build final track list
        const tracks = speakers.map(speaker => ({
            speaker,
            clips: speakerClips[speaker].map(c => ({
                start:    c.start,
                end:      c.end,
                duration: c.end - c.start,
                assetId:  assetId || null,
            })),
        }));

        res.json({ tracks });

    } catch (err) {
        console.error('[interviewRoutes] /build-tracks error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/interview/organize-clips
//
// Phase 3 — Semantic clip organizer.
//
// Pipeline (best path — when DIARIZE_SERVICE_URL is set):
//   1. Node resolves each clip's server-side file path
//   2. Node extracts 3 frames per clip via ffmpeg (at 15 %, 45 %, 75 % of the
//      clip's range inside the source file) — piped directly, no temp files
//   3. Frames (base64 JPEG) + transcript excerpt → POST /classify-clips on the
//      Python diarize-service (CLIP + MediaPipe + sentence-transformers)
//   4. Rich ML metadata → GPT-4o (text-only prompt, no images) for final
//      narrative ordering + rationale
//
// Fallback path (when Python service is not available):
//   Sends the single best frame per clip to GPT-4o-mini Vision for combined
//   classification and ordering — same quality as the original V1 approach.
//
// Body:
//   clips – Array<{
//     id:          string   (client-side clip/placement ID)
//     assetName:   string   (filename used to resolve the server path)
//     filePath?:   string   (absolute server path — preferred when available)
//     offset:      number   (seconds into source file where this clip starts)
//     duration:    number   (clip length in seconds)
//     transcript?: string   (optional Whisper text for this clip — improves accuracy)
//   }>
//
// Returns:
//   {
//     clipMeta:   [{ id, clip_type, energy, face_size, topic_cluster, summary }]
//     orderedIds: string[]    — clip IDs in recommended order
//     rationale:  string      — human-readable explanation
//     pipeline:   string      — "ml" | "vision_fallback"
//   }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/organize-clips', authenticateUser, aiGate, async (req, res) => {
    const { spawn } = require('child_process');

    try {
        const { clips = [] } = req.body;

        if (!clips.length) {
            return res.status(400).json({ error: 'No clips provided.' });
        }
        if (clips.length < 2) {
            return res.status(400).json({ error: 'Need at least 2 clips to organize.' });
        }
        if (!process.env.OPENAI_API_KEY) {
            return res.status(503).json({ error: 'OPENAI_API_KEY not configured on server.' });
        }

        const OpenAI = require('openai');
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 60_000 });

        const uploadsDir = path.resolve(__dirname, '../uploads');

        // ── 1. Resolve server file path per clip (de-duped by asset key) ────────
        const assetPaths = {}; // key → absolute path | null

        for (const clip of clips) {
            const key = clip.assetName || clip.filePath || String(clip.id);
            if (assetPaths[key] !== undefined) continue;

            if (clip.filePath) {
                const abs = path.resolve(clip.filePath);
                assetPaths[key] = abs.startsWith(uploadsDir) && fs.existsSync(abs) ? abs : null;
                continue;
            }

            if (!clip.assetName) { assetPaths[key] = null; continue; }

            const { error, inputPath } = resolveUploadPath(clip.assetName, null);
            assetPaths[key] = (!error && inputPath && fs.existsSync(inputPath)) ? inputPath : null;
        }

        // ── 2. ffmpeg frame extraction helper ────────────────────────────────────
        // Pipes JPEG bytes to stdout — no temp files, no race conditions.
        const extractFrame = (filePath, seekSeconds) => new Promise((resolve) => {
            if (!filePath || !fs.existsSync(filePath)) { resolve(null); return; }
            const chunks = [];
            const ff = spawn('ffmpeg', [
                '-ss', String(Math.max(0, seekSeconds)),
                '-i', filePath,
                '-frames:v', '1',
                '-q:v', '3',
                '-vf', 'scale=640:-2',
                '-f', 'image2pipe',
                '-vcodec', 'mjpeg',
                'pipe:1',
            ], { stdio: ['ignore', 'pipe', 'ignore'] });
            ff.stdout.on('data', c => chunks.push(c));
            ff.on('close', code => resolve(
                (code === 0 && chunks.length) ? Buffer.concat(chunks).toString('base64') : null
            ));
            ff.on('error', () => resolve(null));
            setTimeout(() => { ff.kill('SIGKILL'); resolve(null); }, 12_000);
        });

        // Extract 3 frames per clip at 15 %, 45 %, 75 % of its timeline range.
        // Running all concurrently (bounded by OS process limits) is faster than serial.
        const clipFrameMap = {}; // clipId → string[] (base64 or empty)
        await Promise.all(clips.map(async (clip) => {
            const key       = clip.assetName || clip.filePath || String(clip.id);
            const filePath  = assetPaths[key];
            const offset    = clip.offset   ?? 0;
            const dur       = clip.duration ?? 0;
            const positions = [0.15, 0.45, 0.75].map(p => offset + dur * p);
            const frames    = await Promise.all(positions.map(t => extractFrame(filePath, t)));
            clipFrameMap[clip.id] = frames.filter(Boolean);
        }));

        const totalFrames = Object.values(clipFrameMap).reduce((s, f) => s + f.length, 0);
        const mlAvailable = (() => {
            try { return require('../services/ClipAnalysisService').isAvailable; }
            catch { return false; }
        })();

        // ── 3. ML path: CLIP + MediaPipe + sentence-transformers ─────────────────
        if (mlAvailable && totalFrames > 0) {
            console.log(
                `[interviewRoutes] organize-clips: ML path — ${clips.length} clips, ` +
                `${totalFrames} frames → /classify-clips`
            );

            const ClipAnalysisService = require('../services/ClipAnalysisService');

            const classifyPayload = clips.map(clip => ({
                id:         clip.id,
                frames:     clipFrameMap[clip.id] || [],
                transcript: (clip.transcript || '').slice(0, 400),
                duration:   clip.duration ?? 0,
            }));

            const mlResult = await ClipAnalysisService.classifyClips(classifyPayload);
            const mlClips  = mlResult.clips || [];

            // ── 4. GPT-4o — text-only ordering with rich ML metadata ───────────
            // No images needed: CLIP already classified the visuals.
            // GPT reasons about narrative structure from structured metadata.
            const metadataLines = mlClips.map((m, i) => {
                const clip        = clips.find(c => c.id === m.id) || {};
                const typeLabel   = (m.clip_type || 'unknown').replace(/_/g, ' ');
                const topStr      = Object.entries(m.top_types || {})
                    .map(([k, v]) => `${k.replace(/_/g, ' ')} ${(v * 100).toFixed(0)}%`)
                    .join(', ');
                const faceStr     = m.has_face
                    ? `face detected (${m.face_count} person${m.face_count > 1 ? 's' : ''}, ${m.face_size} close-up)`
                    : 'no face detected';
                const transcriptSnippet = (clip.transcript || '').slice(0, 250).trim();
                return [
                    `Clip ${i + 1} [id: ${m.id}]`,
                    `  Visual type : ${typeLabel} (confidence ${(m.clip_type_confidence * 100).toFixed(0)}%)`,
                    `  Alternatives: ${topStr || 'none'}`,
                    `  Face signal : ${faceStr}`,
                    `  Energy      : ${m.energy}`,
                    `  Duration    : ${(m.duration || 0).toFixed(1)} s`,
                    `  Topic group : ${m.topic_cluster}`,
                    transcriptSnippet ? `  Transcript  : "${transcriptSnippet}"` : '',
                ].filter(Boolean).join('\n');
            }).join('\n\n');

            const numClusters = mlResult.num_topic_clusters ?? 1;

            const gptPrompt = `You are an expert video editor deciding the best narrative order for ${clips.length} clips.

The clips have been pre-analyzed by ML models (CLIP + MediaPipe + semantic embeddings).
There are ${numClusters} distinct topic group(s) across all clips.

━━━ CLIP METADATA ━━━
${metadataLines}

━━━ ORDERING RULES ━━━
• Open with a hook: the highest-energy talking-head close-up or the clearest intro
• Group clips from the same topic cluster together where possible
• B-roll / cutaways should surround the spoken content they illustrate
• Demonstrations come after the verbal introduction of the topic
• End with a clear outro: low-energy summary talking head or call-to-action
• Avoid placing two establishing shots or two product shots back-to-back
• Emotional moments are best placed just before or after a key-point clip

Return ONLY valid JSON:
{
  "orderedIds": ["<clip id>", ...],
  "clipMeta": [
    { "id": "<clip id>", "narrative_role": "<role>", "summary": "<one sentence>" }
  ],
  "rationale": "<3-4 sentences explaining the chosen order>"
}`;

            const completion = await openai.chat.completions.create({
                model:           'gpt-4o',
                messages:        [{ role: 'user', content: gptPrompt }],
                response_format: { type: 'json_object' },
                temperature:     0.15,
                max_tokens:      1200,
            });

            let parsed;
            try { parsed = JSON.parse(completion.choices[0].message.content); }
            catch { return res.status(500).json({ error: 'GPT returned malformed JSON.' }); }

            const orderedIds = (parsed.orderedIds || []).filter(id => clips.some(c => c.id === id));
            const clipMeta   = (parsed.clipMeta   || []).filter(m => m.id);
            const rationale  = parsed.rationale || '';

            // Append any IDs GPT dropped
            const seen = new Set(orderedIds);
            clips.forEach(c => { if (!seen.has(c.id)) orderedIds.push(c.id); });

            // Merge ML metadata into the clipMeta array
            const mlById = {};
            mlClips.forEach(m => { mlById[m.id] = m; });
            const enrichedMeta = clipMeta.map(m => ({ ...mlById[m.id], ...m }));

            console.log(
                `[interviewRoutes] organize-clips (ML): ${clips.length} clips → order: ${orderedIds.join(' → ')}`
            );

            return res.json({ clipMeta: enrichedMeta, orderedIds, rationale, pipeline: 'ml' });
        }

        // ── Fallback path: GPT-4o-mini Vision (no Python service) ────────────────
        // Sends one frame per clip as an image_url block to GPT-4o-mini Vision.
        // Same approach as the original V1 implementation.
        console.log(
            `[interviewRoutes] organize-clips: vision fallback — ${clips.length} clips` +
            (mlAvailable ? '' : ' (ClipAnalysisService unavailable)')
        );

        const userContent = [];
        userContent.push({
            type: 'text',
            text: `You are a professional video editor. Analyze these ${clips.length} clips and determine their content type, energy, and best narrative order.

Return ONLY valid JSON:
{
  "clips": [{ "id": "<id>", "type": "<shot type>", "energy": "<energy>", "summary": "<one sentence>" }],
  "orderedIds": ["<id>", ...],
  "rationale": "<2-3 sentences>"
}

Shot types: intro_talking_head | mid_explanation | key_point | demo_or_tutorial | emotional_close_up | broll_cutaway | product_shot | outro_talking_head | unknown
Energy: high | medium | low | neutral
Ordering: hook first, demos in middle, outro last, B-roll around spoken content it illustrates.`,
        });

        clips.forEach((clip) => {
            const frame = (clipFrameMap[clip.id] || [])[1] || (clipFrameMap[clip.id] || [])[0] || null;
            userContent.push({
                type: 'text',
                text: `\n[Clip id:${clip.id} dur:${(clip.duration || 0).toFixed(1)}s${clip.transcript ? ` transcript:"${clip.transcript.slice(0, 180)}"` : ''}]`,
            });
            if (frame) {
                userContent.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${frame}`, detail: 'low' } });
            } else {
                userContent.push({ type: 'text', text: '[no frame available]' });
            }
        });

        const completion = await openai.chat.completions.create({
            model:           'gpt-4o-mini',
            messages:        [{ role: 'user', content: userContent }],
            response_format: { type: 'json_object' },
            temperature:     0.2,
            max_tokens:      1024,
        });

        let parsed;
        try { parsed = JSON.parse(completion.choices[0].message.content); }
        catch { return res.status(500).json({ error: 'GPT returned malformed JSON.' }); }

        const orderedIds = (parsed.orderedIds || []).filter(id => clips.some(c => c.id === id));
        const clipMeta   = (parsed.clips      || []).filter(m => m.id);
        const rationale  = parsed.rationale || '';
        const seen       = new Set(orderedIds);
        clips.forEach(c => { if (!seen.has(c.id)) orderedIds.push(c.id); });

        console.log(
            `[interviewRoutes] organize-clips (vision): ${clips.length} clips → order: ${orderedIds.join(' → ')}`
        );

        res.json({ clipMeta, orderedIds, rationale, pipeline: 'vision_fallback' });

    } catch (err) {
        console.error('[interviewRoutes] /organize-clips error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
