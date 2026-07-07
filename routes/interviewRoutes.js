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
const { execSync }   = require('child_process');
const { authenticateUser, optionalAuth } = require('../middleware/auth');
const { aiGate }     = require('../middleware/usageGate');
const { audioQueue } = require('../queue/queues');
const storageConfig  = require('../config/storage');

// ── Host-side detection helpers ───────────────────────────────────────────────

/**
 * Find the longest consecutive speaking turn for a given speaker.
 * A turn ends when another speaker's word appears within 1s.
 */
function findLongestTurn(words, targetSpeaker) {
    const sorted = [...words].sort((a, b) => a.start - b.start);
    let best = null;
    let runStart = null;
    let runEnd   = null;

    for (const w of sorted) {
        if (w.speaker === targetSpeaker) {
            if (runStart === null) runStart = w.start;
            runEnd = w.end;
        } else if (w.speaker && runStart !== null) {
            // Another speaker intervened — close this run
            const dur = runEnd - runStart;
            if (!best || dur > (best.end - best.start)) {
                best = { start: runStart, end: runEnd, speaker: targetSpeaker };
            }
            runStart = null;
            runEnd   = null;
        }
    }
    if (runStart !== null) {
        const dur = runEnd - runStart;
        if (!best || dur > (best.end - best.start)) {
            best = { start: runStart, end: runEnd, speaker: targetSpeaker };
        }
    }
    return best; // { start, end, speaker } or null
}

/**
 * Extract one video frame at `timestampSec` from a GCS file or local file.
 * Returns a base64 JPEG string, or null on failure.
 */
async function extractVideoFrame(gcsPath, timestampSec) {
    try {
        let inputArg;

        if (storageConfig.bucket && !storageConfig.useLocalStorage) {
            // GCS: generate a short-lived signed URL
            const [signedUrl] = await storageConfig.bucket.file(gcsPath).getSignedUrl({
                version: 'v4',
                action:  'read',
                expires: Date.now() + 5 * 60 * 1000,
            });
            inputArg = signedUrl;
        } else {
            // Local fallback
            const uploadsDir = path.resolve(__dirname, '../uploads');
            const localPath  = path.resolve(uploadsDir, gcsPath.replace(/^raw\//, ''));
            if (!fs.existsSync(localPath)) return null;
            inputArg = localPath;
        }

        // -ss before -i = fast seek; -vframes 1 = single frame; pipe: = stdout
        const cmd = `ffmpeg -ss ${timestampSec.toFixed(2)} -i "${inputArg}" -vframes 1 -f image2pipe -vcodec mjpeg -q:v 5 pipe:1`;
        const buf = execSync(cmd, {
            maxBuffer: 8 * 1024 * 1024,
            timeout:   20000,
            stdio:     ['pipe', 'pipe', 'ignore'],
        });
        return buf.toString('base64');
    } catch (err) {
        console.warn(`[virtual-multicam] extractVideoFrame @${timestampSec.toFixed(1)}s failed:`, err.message);
        return null;
    }
}

/**
 * Call diarize-service /detect-faces and return face array.
 */
async function detectFacesInFrame(base64Frame, diarizeServiceUrl) {
    const res = await fetch(`${diarizeServiceUrl}/detect-faces`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ frames: [base64Frame] }),
        signal:  AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.faces || [];
}

/**
 * Determine which side (left/right) each speaker is on using:
 *  1. Find each speaker's longest solo turn from diarization
 *  2. Extract a frame at the midpoint of that turn
 *  3. Run face detection — the LARGER face (by area w×h) is more frontal
 *     (speaking person faces the camera more directly)
 *  4. The largest face's side = that speaker's side
 *
 * Returns { [speaker]: 'left'|'right' } or null on failure.
 */
async function detectSpeakerSides(words, speakers, filename, diarizeServiceUrl) {
    if (!diarizeServiceUrl || !filename) return null;
    if (speakers.length < 2) return null;

    try {
        const results = {};

        for (const speaker of speakers) {
            const turn = findLongestTurn(words, speaker);
            if (!turn || (turn.end - turn.start) < 1.5) {
                console.warn(`[virtual-multicam] No long turn found for ${speaker}`);
                continue;
            }

            const midpoint   = (turn.start + turn.end) / 2;
            const frameB64   = await extractVideoFrame(filename, midpoint);
            if (!frameB64) continue;

            const faces = await detectFacesInFrame(frameB64, diarizeServiceUrl);
            if (!faces.length) continue;

            // Largest face by bounding-box area = more frontal = active speaker
            const largestFace = faces.sort((a, b) => (b.w * b.h) - (a.w * a.h))[0];
            results[speaker]  = largestFace.side; // 'left' or 'right'

            console.log(
                `[virtual-multicam] ${speaker}: longest turn ${turn.start.toFixed(1)}s–${turn.end.toFixed(1)}s, ` +
                `frame at ${midpoint.toFixed(1)}s, ${faces.length} face(s), ` +
                `largest face → ${largestFace.side} (area=${(largestFace.w * largestFace.h).toFixed(4)})`
            );
        }

        return Object.keys(results).length === speakers.length ? results : null;
    } catch (err) {
        console.warn('[virtual-multicam] detectSpeakerSides failed:', err.message);
        return null;
    }
}

// Non-production: skip hard auth so staging/local works without valid Supabase JWTs.
// Route handlers already fall back to 'dev-user' when req.user is absent.
const isProd = process.env.NODE_ENV === 'production';
const authAndGate = isProd ? [authenticateUser, aiGate] : [optionalAuth];

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

// ── Shared: ffmpeg JPEG frame extractor ───────────────────────────────────────
// Pipes one frame to stdout at the given seek position — no temp files.
// Returns base64-encoded JPEG string, or null on any error / timeout.
function _extractFrame(filePath, seekSeconds) {
    const { spawn } = require('child_process');
    return new Promise((resolve) => {
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
}

// Extract 3 frames at 15 %, 45 %, 75 % of the clip's source range.
// All 3 fire concurrently; null frames are filtered out.
async function _extractClipFrames(filePath, offset, duration) {
    const ts = [0.15, 0.45, 0.75].map(p => (offset ?? 0) + (duration ?? 0) * p);
    return (await Promise.all(ts.map(t => _extractFrame(filePath, t)))).filter(Boolean);
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
router.post('/rhythm-zoom', ...authAndGate, async (req, res) => {
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
        const STYLES = {
            subtle:    { wide: 1.00, mid: 1.06, close: 1.12 },
            dynamic:   { wide: 1.00, mid: 1.10, close: 1.20 },
            cinematic: { wide: 1.00, mid: 1.12, close: 1.26 },
        };
        const cfg = STYLES[style] || STYLES.dynamic;

        // ── Per-clip word extraction ────────────────────────────────────────────
        const clipTexts = clips.map(clip => {
            const ofs = clip.offset ?? 0;
            const end = ofs + (clip.duration ?? 0);
            return words
                .filter(w => w.start >= ofs - 0.05 && w.end <= end + 0.05)
                .map(w => w.word).join(' ').trim() || '[silence]';
        });

        // ── ML frame classification (CLIP + MediaPipe) ────────────────────────
        // Optional — fires only when:
        //   a) DIARIZE_SERVICE_URL is configured (ClipAnalysisService.isAvailable)
        //   b) At least one clip carries an assetName the server can resolve
        //
        // Gives GPT-4o-mini ground-truth visual data (face size, shot type, energy)
        // so it makes narrative rhythm decisions from fact rather than guessing
        // from transcript words alone.  Falls back to transcript-only on any error.
        let mlMeta = {}; // index → ClipMeta | undefined

        const hasAssetNames = clips.some(c => c.assetName);
        const mlAvailable   = hasAssetNames && (() => {
            try { return require('../services/ClipAnalysisService').isAvailable; }
            catch { return false; }
        })();

        if (mlAvailable) {
            try {
                const uploadsDir = path.resolve(__dirname, '../uploads');

                // Resolve server paths (de-duped by assetName)
                const assetPaths = {};
                for (const clip of clips) {
                    const key = clip.assetName || String(clip.id);
                    if (assetPaths[key] !== undefined) continue;
                    if (!clip.assetName) { assetPaths[key] = null; continue; }
                    const { error, inputPath } = resolveUploadPath(clip.assetName, null);
                    assetPaths[key] = (!error && inputPath && fs.existsSync(inputPath)) ? inputPath : null;
                }

                // Extract 3 frames per clip concurrently
                const clipFrameMap = {};
                await Promise.all(clips.map(async (clip, i) => {
                    const key = clip.assetName || String(clip.id);
                    clipFrameMap[i] = await _extractClipFrames(assetPaths[key], clip.offset ?? 0, clip.duration ?? 0);
                }));

                const totalFrames = Object.values(clipFrameMap).reduce((s, f) => s + f.length, 0);
                if (totalFrames > 0) {
                    const ClipAnalysisService = require('../services/ClipAnalysisService');
                    const mlResult = await ClipAnalysisService.classifyClips(
                        clips.map((clip, i) => ({
                            id:         String(i),
                            frames:     clipFrameMap[i] || [],
                            transcript: (clipTexts[i] || '').slice(0, 300),
                            duration:   clip.duration ?? 0,
                        }))
                    );
                    (mlResult.clips || []).forEach(m => {
                        const idx = parseInt(m.id, 10);
                        if (!isNaN(idx)) mlMeta[idx] = m;
                    });
                    console.log(
                        `[interviewRoutes] rhythm-zoom: ML metadata loaded for ` +
                        `${Object.keys(mlMeta).length}/${clips.length} clips, ` +
                        `${totalFrames} frames`
                    );
                }
            } catch (mlErr) {
                console.warn(
                    `[interviewRoutes] rhythm-zoom: ML step failed — falling back to ` +
                    `transcript-only (${mlErr.message})`
                );
            }
        }

        const hasMl = Object.keys(mlMeta).length > 0;

        // ── GPT-4o-mini shot assignment ────────────────────────────────────────
        const OpenAI = require('openai');
        if (!process.env.OPENAI_API_KEY) {
            return res.status(503).json({ error: 'OPENAI_API_KEY not configured on server.' });
        }
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 30_000 });

        // Build compact per-clip objects for the prompt.
        // When ML data is available, include visual ground truth so GPT makes
        // informed narrative decisions rather than guessing from words alone.
        const compact = clipTexts.map((t, i) => {
            const ml  = mlMeta[i];
            const obj = {
                i,
                dur: parseFloat((clips[i].duration || 0).toFixed(1)),
                t:   t.slice(0, 120),
            };
            if (ml) {
                obj.face   = ml.face_size  || 'none';   // "large"|"medium"|"small"|"none"
                obj.vtype  = ml.clip_type  || 'unknown';
                obj.energy = ml.energy     || 'neutral';
            }
            return obj;
        });

        const mlInstructions = hasMl ? `
Each clip also has ML-detected visual fields:
  face   — actual face size in frame: "large" (face fills frame), "medium", "small", "none" (b-roll/no face)
  vtype  — CLIP visual classifier output (e.g. "talking_head_close", "broll_outdoor", "emotional_moment")
  energy — detected energy level: "high" | "medium" | "low" | "neutral"

Extra rules when ML data is present:
  • face=large: do NOT assign "close" unless this is a peak emotional moment — the face is already big
  • face=none / vtype contains "broll" or "establishing": assign "wide" — never zoom cutaways aggressively
  • vtype=emotional_moment: prefer "close"
  • energy=high: lean toward "close" or "medium"
  • energy=low: lean toward "wide" or "medium"
` : '';

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{
                role: 'user',
                content:
`You are a professional video editor assigning shot types to create a multi-camera zoom rhythm for a talking-head video.
Each clip is already edited and cut. Assign each a shot type:
  "wide"   – neutral, low energy, transition, breather
  "medium" – conversational tone, background explanation
  "close"  – key statement, emotion, emphasis, surprise, strong assertion
${mlInstructions}
Rhythm rules (always apply):
- Vary shots — no more than 3 in a row of the same type
- Never jump directly wide → close (bridge with medium)
- Clips with dur < 0.8 s must match the previous clip's type

Return ONLY valid JSON: {"c":[{"i":N,"type":"wide"|"medium"|"close"}]}

Clips: ${JSON.stringify(compact)}`,
            }],
            response_format: { type: 'json_object' },
            temperature:     0.2,
            max_tokens:      1024,
        });

        let gptAssignments = [];
        try {
            gptAssignments = JSON.parse(completion.choices[0].message.content).c || [];
        } catch (_) { /* fallback to cycle below */ }

        const gptMap = {};
        gptAssignments.forEach(a => { gptMap[a.i] = a.type; });

        // ── ML-aware scale resolver ────────────────────────────────────────────
        // Maps (narrative_type, face_size, clip_type) → actual zoom scale.
        //
        // Core insight: the zoom should COMPLEMENT the real frame composition.
        //   • face=large  → face already fills the frame; aggressive zoom crops it badly
        //   • face=none   → wide/empty frame; bigger zoom headroom
        //   • broll       → no zoom ever — it breaks the illusion
        //   • emotional   → always push close regardless of face size (within limits)
        const lerp = (a, b, t) => a + (b - a) * t;

        function getScale(type, ml) {
            if (!ml) return cfg[type] ?? cfg.mid;  // no ML → original logic

            const faceSize  = ml.face_size  || 'none';
            const clipType  = ml.clip_type  || '';
            const isBroll   = /broll|establishing_shot|screen_recording/.test(clipType);
            const isEmotional = clipType === 'emotional_moment';

            if (isBroll)       return cfg.wide;  // cutaways stay wide
            if (isEmotional)   return type === 'wide' ? cfg.mid : cfg.close; // push emotional harder

            if (type === 'wide') return cfg.wide;

            if (type === 'medium') {
                if (faceSize === 'large') return lerp(cfg.wide, cfg.mid, 0.5); // subtle — face already close
                return cfg.mid;
            }

            if (type === 'close') {
                if (faceSize === 'large')  return lerp(cfg.mid, cfg.close, 0.45); // capped — avoid over-crop
                if (faceSize === 'medium') return cfg.close;
                return Math.min(cfg.close + 0.04, 1.30);                          // wide/no face → push harder
            }

            return cfg.mid;
        }

        // ── Build final clipZooms list ──────────────────────────────────────────
        const FALLBACK_CYCLE = ['wide', 'medium', 'close', 'medium'];
        let prevType  = 'wide';
        let sameCount = 0;

        const clipZooms = clips.map((clip, i) => {
            let type = gptMap[i] || null;

            if (!type && (clip.duration ?? 0) < 0.8) type = prevType;
            if (!type) type = FALLBACK_CYCLE[i % FALLBACK_CYCLE.length];

            // Enforce rhythm constraints
            if (type === 'close' && prevType === 'wide')  type = 'medium';
            if (type === 'wide'  && prevType === 'close') type = 'medium';
            if (type === prevType) {
                if (++sameCount >= 3) {
                    type      = type === 'wide' ? 'medium' : (type === 'close' ? 'medium' : 'wide');
                    sameCount = 0;
                }
            } else {
                sameCount = 1;
            }

            prevType = type;
            const scale = getScale(type, mlMeta[i]);
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
router.post('/analyze', ...authAndGate, async (req, res) => {
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
router.post('/split-speakers', ...authAndGate, async (req, res) => {
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
router.post('/build-tracks', ...authAndGate, async (req, res) => {
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
router.post('/organize-clips', ...authAndGate, async (req, res) => {
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

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/interview/virtual-multicam
//
// Creates virtual multi-camera angles from a single-camera interview video.
// Transforms diarization data (who's talking when) into a sequence of camera
// "shots": wide, close_host, close_guest — each with crop region metadata.
//
// The client stores the returned segments as clip.virtualCam on each timeline
// clip, and PlaybackEngine applies the crop region at render time via WebGL
// UV sub-region sampling.
//
// Body: {
//   words:    Array<{ word, start, end, speaker }>  — from diarization
//   speakers: string[]                              — e.g. ["SPEAKER_00","SPEAKER_01"]
//   frames?:  string[]                              — base64 JPEG sample frames for face detection
//   hostSide?: "left" | "right"                     — override if known (default: auto-detect)
// }
//
// Returns: {
//   segments: [{
//     start:   number,     — timeline seconds
//     end:     number,
//     angle:   "wide" | "close_host" | "close_guest",
//     speaker: string | null,
//     cropX:   number,     — UV left edge [0,1]
//     cropY:   number,     — UV top edge  [0,1]
//     cropW:   number,     — UV width     [0,1]
//     cropH:   number,     — UV height    [0,1]
//   }],
//   hostSide:   "left" | "right",
//   faceDetected: boolean,
// }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/virtual-multicam', ...authAndGate, async (req, res) => {
    try {
        const {
            words    = [],
            speakers = [],
            frames   = [],          // legacy: client-sent base64 frames (kept for compat)
            filename = null,        // GCS path (e.g. "raw/1234-video.mp4") for server-side frame extraction
            hostSide: forcedHostSide,
        } = req.body;

        if (!words.length) {
            return res.status(400).json({ error: 'words array is required. Run speaker diarization first.' });
        }
        if (!speakers.length) {
            return res.status(400).json({ error: 'speakers array is required.' });
        }

        // ── 1. Determine host side ───────────────────────────────────────────
        // Priority:
        //  a. forcedHostSide from caller (explicit override)
        //  b. detectSpeakerSides(): uses diarization longest turns + server-side
        //     frame extraction + MediaPipe face detection to map each speaker to
        //     the side where their face appears largest (most frontal = speaking)
        //  c. Legacy: client-sent frames[] + simple leftmost-face heuristic
        //  d. Default: 'left'

        let hostSide     = forcedHostSide || null;
        let faceDetected = false;

        const diarizeServiceUrl = process.env.DIARIZE_SERVICE_URL;

        if (!hostSide && filename && diarizeServiceUrl) {
            // ── Path b: smart detection from diarization + server-side frames ──
            const speakerSides = await detectSpeakerSides(words, speakers, filename, diarizeServiceUrl);
            if (speakerSides) {
                // SPEAKER_00 is the host by convention (first speaker assigned by AssemblyAI)
                const host = speakers[0]; // SPEAKER_00
                if (speakerSides[host]) {
                    hostSide     = speakerSides[host];
                    faceDetected = true;
                    console.log(`[virtual-multicam] Host (${host}) detected on ${hostSide} side via diarization+frames`);
                }
            }
        }

        if (!hostSide && diarizeServiceUrl && frames.length > 0) {
            // ── Path c: legacy client-sent frames ──────────────────────────────
            try {
                const fdRes = await fetch(`${diarizeServiceUrl}/detect-faces`, {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ frames: frames.slice(0, 3) }),
                    signal:  AbortSignal.timeout(8000),
                });
                if (fdRes.ok) {
                    const fdData = await fdRes.json();
                    if (fdData.faces && fdData.faces.length > 0) {
                        const sortedByCx = [...fdData.faces].sort((a, b) => a.cx - b.cx);
                        hostSide     = sortedByCx[0].side;
                        faceDetected = true;
                        console.log(`[virtual-multicam] Face detection (legacy frames): host on ${hostSide} side`);
                    }
                }
            } catch (fdErr) {
                console.warn(`[virtual-multicam] Legacy face detection failed (${fdErr.message})`);
            }
        }

        // ── Path d: default ────────────────────────────────────────────────────
        if (!hostSide) hostSide = 'left';

        // ── 2. Virtual camera definitions ────────────────────────────────────
        //
        // Each camera is defined by scale (zoom factor) and x/y offset (relative
        // to frame centre, in texture-space units [0,1]).
        //   x < 0 → pan left   x > 0 → pan right
        //   y < 0 → pan up     y > 0 → pan down
        //
        // Names are POSITIONAL (A = left side, B = right side of the frame),
        // not tied to host/guest labels.  The host↔side mapping below determines
        // which camera label maps to which physical speaker.
        //
        // Crop math:  cropW = cropH = 1/scale  (equal to preserve 16:9 AR)
        //             centerX = 0.5 + x
        //             centerY = 0.5 + y
        //             cropX = clamp(centerX - cropW/2, 0, 1-cropW)
        //             cropY = clamp(centerY - cropH/2, 0, 1-cropH)
        //
        // Scale reference at 1080p output from 4K source:
        //   1.00 → full frame  |  1.60 → loose single  |  2.50 → standard single
        //
        // Y offset -0.10 for close-ups: shifts crop window up so faces sit in
        // the upper third rather than dead-centre (better for seated interviews).
        const VIRTUAL_CAMERAS = {
            wide:      { scale: 1.00, x:  0.00, y:  0.00 },
            speakerA:  { scale: 2.50, x: -0.28, y: -0.10 },  // left speaker, standard single
            speakerB:  { scale: 2.50, x: +0.28, y: -0.10 },  // right speaker, standard single
            reactionA: { scale: 1.60, x: -0.15, y: -0.05 },  // left speaker listening (OTS)
            reactionB: { scale: 1.60, x: +0.15, y: -0.05 },  // right speaker listening (OTS)
        };

        function scaleToCrop({ scale, x, y }) {
            const w  = 1.0 / scale;
            const h  = 1.0 / scale;
            const cx = 0.5 + x;
            const cy = 0.5 + y;
            return {
                cropX: Math.max(0, Math.min(1 - w, cx - w / 2)),
                cropY: Math.max(0, Math.min(1 - h, cy - h / 2)),
                cropW: w,
                cropH: h,
            };
        }

        // Map speaker IDs to camera labels based on detected host side.
        //   hostSide='left' → host is speaker A (left), guest is speaker B (right)
        //   hostSide='right' → host is speaker B (right), guest is speaker A (left)
        const host  = speakers[0] || 'SPEAKER_00';
        const guest = speakers[1] || 'SPEAKER_01';

        const speakerCam   = {};  // speaker → close-up camera name
        const reactionCam  = {};  // speaker → reaction camera (other side listening)

        if (hostSide === 'left') {
            speakerCam[host]   = 'speakerA';   reactionCam[host]   = 'reactionB';
            speakerCam[guest]  = 'speakerB';   reactionCam[guest]  = 'reactionA';
        } else {
            speakerCam[host]   = 'speakerB';   reactionCam[host]   = 'reactionA';
            speakerCam[guest]  = 'speakerA';   reactionCam[guest]  = 'reactionB';
        }

        // ── 3. Group words into diarization segments ─────────────────────────
        // Merge consecutive words from the same speaker (gap ≤ 0.5s = same segment)
        const MERGE_GAP = 0.5;
        const rawSegments = []; // { start, end, speaker }

        let cur = null;
        for (const w of words) {
            if (!w.speaker) continue;
            if (!cur || w.speaker !== cur.speaker || (w.start - cur.end) > MERGE_GAP) {
                if (cur) rawSegments.push(cur);
                cur = { start: w.start, end: w.end, speaker: w.speaker };
            } else {
                cur.end = w.end;
            }
        }
        if (cur) rawSegments.push(cur);

        if (!rawSegments.length) {
            return res.status(400).json({ error: 'No diarized segments found in words array.' });
        }

        // ── 4. Apply editorial rules to assign camera angles ────────────────
        //
        // Rules (in priority order):
        //  • First and last segment → wide (establish / close the scene)
        //  • Duration < 0.6 s → inherit previous angle (avoid micro-cut flicker)
        //  • Duration < MIN_CLOSE_DUR → wide (short segments look nervous as close-ups)
        //  • Otherwise → close-up of the speaking person (speakerA or speakerB)
        //  • Breather: after 3 consecutive close shots on the SAME camera → swap to
        //    the other speaker's REACTION shot (not a wide — more cinematic than a
        //    plain wide cut, and gives the listening speaker screen time)
        //  • If the reaction cam is already what we'd use → fall back to wide

        const segments = [];
        let prevAngle      = 'wide';
        let sameCloseCnt   = 0;
        const MIN_CLOSE_DUR = 1.5; // seconds

        for (let i = 0; i < rawSegments.length; i++) {
            const seg     = rawSegments[i];
            const dur     = seg.end - seg.start;
            const isFirst = i === 0;
            const isLast  = i === rawSegments.length - 1;

            let angle;

            if (isFirst || isLast) {
                angle = 'wide';
            } else if (dur < 0.6) {
                angle = prevAngle; // inherit — too short to cut cleanly
            } else if (dur < MIN_CLOSE_DUR) {
                angle = 'wide';
            } else {
                // Assign close-up for the speaking person
                const closeCam    = speakerCam[seg.speaker]  || 'wide';
                const rxCam       = reactionCam[seg.speaker] || 'wide';

                if (closeCam === prevAngle) {
                    sameCloseCnt++;
                    if (sameCloseCnt >= 3) {
                        // Breather: cut to the listening speaker's reaction shot
                        angle = (rxCam !== prevAngle) ? rxCam : 'wide';
                        sameCloseCnt = 0;
                    } else {
                        angle = closeCam;
                    }
                } else {
                    angle        = closeCam;
                    sameCloseCnt = angle !== 'wide' ? 1 : 0;
                }
            }

            prevAngle = angle;

            const cam  = VIRTUAL_CAMERAS[angle] || VIRTUAL_CAMERAS.wide;
            const crop = scaleToCrop(cam);
            segments.push({
                start:   parseFloat(seg.start.toFixed(3)),
                end:     parseFloat(seg.end.toFixed(3)),
                angle,
                speaker: seg.speaker || null,
                scale:   cam.scale,
                x:       cam.x,
                y:       cam.y,
                cropX:   crop.cropX,
                cropY:   crop.cropY,
                cropW:   crop.cropW,
                cropH:   crop.cropH,
            });
        }

        // ── 5. Summary ───────────────────────────────────────────────────────
        const counts = { wide: 0, speakerA: 0, speakerB: 0, reactionA: 0, reactionB: 0 };
        segments.forEach(s => { if (counts[s.angle] !== undefined) counts[s.angle]++; });

        console.log(
            `[virtual-multicam] ${segments.length} segments: ` +
            `${counts.wide}W / ${counts.speakerA}A / ${counts.speakerB}B / ` +
            `${counts.reactionA}rA / ${counts.reactionB}rB | ` +
            `host=${host} on ${hostSide} | face=${faceDetected}`
        );

        res.json({ segments, hostSide, faceDetected, host, guest });

    } catch (err) {
        console.error('[interviewRoutes] /virtual-multicam error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
