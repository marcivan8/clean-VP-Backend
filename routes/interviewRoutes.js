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
const { getAIClient, isAIConfigured } = require('../services/AIProvider');
const router         = express.Router();
const path           = require('path');
const fs             = require('fs');
const { execSync, spawn } = require('child_process');
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
 * Resolve the calling user's id the same way proxyRoutes.js does: real user
 * in production, a stable 'dev-user' fallback outside it (this file's routes
 * already run on `optionalAuth` in non-production, so req.user can be absent
 * there by design — see isProd/authAndGate below).
 */
function resolveRequestUserId(req) {
    if (req.user?.id) return req.user.id;
    if (process.env.NODE_ENV !== 'production') return 'dev-user';
    return null;
}

/**
 * IDOR guard: every uploaded asset's storage path embeds the owning user's id
 * — raw/{userId}/{file} or proxies/{userId}/{file}/... (see proxyRoutes.js,
 * videoProcessor.js). Extracts that segment so callers can check it against
 * the requesting user before handing the path to ffmpeg or a signed URL.
 * Returns null when the path doesn't match either shape (caller decides how
 * to treat an unrecognized path — see pathOwnedBy below).
 */
function pathOwnerUserId(gcsPath) {
    const m = String(gcsPath || '').match(/^(?:raw|proxies)\/([^/]+)\//);
    return m ? m[1] : null;
}

/**
 * True if `requestUserId` is allowed to access `gcsPath`.
 * - Path has no recognizable owner segment (e.g. a bare temp/ filename from
 *   the legacy local-upload flow) → allowed; there's nothing to check against,
 *   and resolveUploadPath's uploads/-boundary check still applies separately.
 * - Path has an owner segment but we don't know who's asking (requestUserId
 *   null — shouldn't happen once authOnly/authAndGate require auth in prod,
 *   but fails closed rather than open if it ever does) → denied.
 * - Otherwise: owner segment must match the requester.
 */
function pathOwnedBy(gcsPath, requestUserId) {
    const owner = pathOwnerUserId(gcsPath);
    if (!owner) return true;
    if (!requestUserId) return false;
    return owner === requestUserId;
}

/**
 * Resolve a GCS-relative path (or bare filename) to something ffmpeg can read
 * directly as an -i argument: a short-lived signed URL when GCS is configured,
 * or a local file path in local-storage/dev mode. Returns null if the file
 * can't be located. Shared by extractVideoFrame() and refine-cut-frames below
 * so both use the exact same resolution rules.
 *
 * `requestUserId` (resolveRequestUserId(req)) is REQUIRED for every caller
 * that received gcsPath from client input — this is the IDOR fix: without it,
 * any authenticated user could pass another user's raw/{userId}/... path and
 * this function would happily sign a URL / return a local path for it. Pass
 * `null` explicitly (not omit the arg) only for paths the server derived
 * itself, never from a request body.
 */
async function resolveFfmpegInputArg(gcsPath, requestUserId) {
    if (!pathOwnedBy(gcsPath, requestUserId)) {
        console.warn(`[interviewRoutes] resolveFfmpegInputArg: user "${requestUserId}" is not the owner of "${gcsPath}" — denied`);
        return null;
    }
    if (storageConfig.bucket && !storageConfig.useLocalStorage) {
        const [signedUrl] = await storageConfig.bucket.file(gcsPath).getSignedUrl({
            version: 'v4',
            action:  'read',
            expires: Date.now() + 5 * 60 * 1000,
        });
        return signedUrl;
    }
    const uploadsDir = path.resolve(__dirname, '../uploads');
    const localPath  = path.resolve(uploadsDir, gcsPath.replace(/^raw\//, ''));
    // SECURITY: gcsPath is client-supplied (request body) on every caller of
    // this helper (refine-cut-frames, extractVideoFrame's callers, etc.).
    // path.resolve() happily walks ".." segments out of uploadsDir, and
    // nothing downstream re-checked that before this fix — a filename like
    // "../../../../etc/passwd" would resolve outside uploads/ and get handed
    // straight to ffmpeg. Only reachable in local-storage/dev mode (the GCS
    // branch above uses the GCS SDK's object-key semantics, not a filesystem
    // path, so it isn't affected the same way).
    if (!localPath.startsWith(uploadsDir + path.sep) && localPath !== uploadsDir) {
        console.warn(`[interviewRoutes] resolveFfmpegInputArg: rejected out-of-bounds path "${gcsPath}"`);
        return null;
    }
    if (!fs.existsSync(localPath)) return null;
    return localPath;
}

/**
 * Extract one video frame at `timestampSec` from a GCS file or local file.
 * Returns a base64 JPEG string, or null on failure.
 * `requestUserId` — see resolveFfmpegInputArg's doc; propagated so the IDOR
 * guard applies here too, since every caller ultimately traces back to a
 * client-supplied filename.
 */
async function extractVideoFrame(gcsPath, timestampSec, requestUserId) {
    try {
        const inputArg = await resolveFfmpegInputArg(gcsPath, requestUserId);
        if (!inputArg) return null;

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
 * detectHostSideViaVision
 *
 * Uses GPT-4o-mini Vision to determine which side of the frame the host
 * (SPEAKER_00) is sitting on.  No extra microservice required — just OpenAI.
 *
 * Strategy: during a speaker's longest solo turn they face the camera more
 * directly than the listening person.  We extract one frame per speaker at
 * the midpoint of their longest turn and send both images in a single
 * GPT-4o-mini call, asking which half of the frame each active speaker
 * occupies.  We use the host's answer as hostSide.
 *
 * Returns 'left' | 'right' | null on failure.
 */
async function detectHostSideViaVision(words, speakers, filename, requestUserId) {
    if (!isAIConfigured()) return null;
    if (!filename || speakers.length < 2) return null;

    try {
        const OpenAI = require('openai');
        const openai = getAIClient({ timeout: 20_000 });

        // Extract one frame per speaker at the midpoint of their longest solo turn.
        // Both images go in a single API call to keep latency and cost low.
        const frames = [];
        for (const speaker of speakers.slice(0, 2)) {
            const turn = findLongestTurn(words, speaker);
            if (!turn || (turn.end - turn.start) < 1.0) {
                console.warn(`[virtual-multicam] Vision: no usable turn for ${speaker}`);
                return null;
            }
            const mid   = (turn.start + turn.end) / 2;
            const frame = await extractVideoFrame(filename, mid, requestUserId);
            if (!frame) return null;
            frames.push({ speaker, mid, frame });
        }

        // Both frames in one call: image 1 = host turn, image 2 = guest turn.
        // We ask GPT to identify which side of the frame each active speaker is on,
        // then parse the JSON answer.
        const content = [
            {
                type: 'text',
                text:
                    'These are two frames from the same two-person interview video.\n' +
                    'In each frame one person is actively speaking (more frontal, facing camera).\n' +
                    'For each frame state whether the active speaker is on the LEFT or RIGHT half.\n' +
                    'Reply with ONLY valid JSON: {"frame1":"left"|"right","frame2":"left"|"right"}',
            },
            {
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${frames[0].frame}`, detail: 'low' },
            },
            {
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${frames[1].frame}`, detail: 'low' },
            },
        ];

        const resp = await openai.chat.completions.create({
            model:       'gpt-4o-mini',
            messages:    [{ role: 'user', content }],
            max_tokens:  30,
            temperature: 0,
        });

        const raw  = resp.choices[0]?.message?.content?.trim() || '';
        // Strip any markdown fences GPT sometimes wraps around JSON
        const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        const ans  = JSON.parse(json);

        const hostSide  = (ans.frame1 || '').toLowerCase();
        const guestSide = (ans.frame2 || '').toLowerCase();

        if (!['left', 'right'].includes(hostSide) || !['left', 'right'].includes(guestSide)) {
            console.warn('[virtual-multicam] Vision: unexpected GPT answer:', ans);
            return null;
        }

        // Sanity check: two speakers should be on opposite sides
        if (hostSide === guestSide) {
            console.warn(`[virtual-multicam] Vision: both speakers reported on ${hostSide} — ignoring`);
            return null;
        }

        console.log(
            `[virtual-multicam] GPT-4o-mini Vision: host=${frames[0].speaker} on ${hostSide} ` +
            `(frame @${frames[0].mid.toFixed(1)}s), guest=${frames[1].speaker} on ${guestSide} ` +
            `(frame @${frames[1].mid.toFixed(1)}s)`
        );

        return hostSide; // side of SPEAKER_00 (the host)
    } catch (err) {
        console.warn('[virtual-multicam] Vision hostSide detection failed:', err.message);
        return null;
    }
}

/**
 * Call diarize-service /detect-faces and return face array.
 * Only used when DIARIZE_SERVICE_URL is configured (pyannote microservice).
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
 * detectSpeakerSides (pyannote path)
 *
 * Kept as a secondary option when DIARIZE_SERVICE_URL is available.
 * Finds each speaker's longest solo turn, extracts a frame, runs pyannote
 * MediaPipe face detection, and returns { [speaker]: 'left'|'right' }.
 * Returns null on any failure.
 */
async function detectSpeakerSides(words, speakers, filename, diarizeServiceUrl, requestUserId) {
    if (!diarizeServiceUrl || !filename) return null;
    if (speakers.length < 2) return null;

    try {
        const results = {};

        for (const speaker of speakers) {
            const turn = findLongestTurn(words, speaker);
            if (!turn || (turn.end - turn.start) < 1.5) {
                console.warn(`[virtual-multicam] pyannote: no long turn for ${speaker}`);
                continue;
            }

            const midpoint = (turn.start + turn.end) / 2;
            const frameB64 = await extractVideoFrame(filename, midpoint, requestUserId);
            if (!frameB64) continue;

            const faces = await detectFacesInFrame(frameB64, diarizeServiceUrl);
            if (!faces.length) continue;

            // Largest face by bounding-box area = most frontal = active speaker
            const largestFace = faces.sort((a, b) => (b.w * b.h) - (a.w * a.h))[0];
            results[speaker]  = largestFace.side;

            console.log(
                `[virtual-multicam] pyannote ${speaker}: @${midpoint.toFixed(1)}s, ` +
                `${faces.length} face(s), largest → ${largestFace.side}`
            );
        }

        return Object.keys(results).length === speakers.length ? results : null;
    } catch (err) {
        console.warn('[virtual-multicam] pyannote detectSpeakerSides failed:', err.message);
        return null;
    }
}

/**
 * detectSceneLayout — the primary vision pass for virtual multicam.
 *
 * One GPT-4o-mini call that returns REAL spatial data instead of just
 * "left or right": for each sampled frame, the number of people visible
 * on screen and the face anchor (center x/y + face height, all normalized
 * 0–1) of the active/main subject. This lets the camera builders place
 * crops where faces actually are, instead of at fixed offsets, and lets
 * the mode selector catch the "2 diarized speakers but only 1 person on
 * camera" case (voice-off interviewer → solo framing, not left/right pans).
 *
 * Frame sampling:
 *   duo  (2+ speakers): midpoint of each speaker's longest solo turn
 *   solo (1 speaker):   ~25% and ~65% through the speech span
 *
 * Returns null on any failure (caller falls back to fixed geometry):
 * {
 *   onScreenCount: number,          — max people visible across frames
 *   frames: [{ speaker, people, anchor: { cx, cy, h } | null }]
 * }
 */
async function detectSceneLayout(words, speakers, filename, requestUserId) {
    if (!isAIConfigured() || !filename) return null;

    try {
        const OpenAI = require('openai');
        const openai = getAIClient({ timeout: 25_000 });

        // ── Pick sample timestamps ──────────────────────────────────────────
        const samples = []; // { speaker, t }
        if (speakers.length >= 2) {
            for (const speaker of speakers.slice(0, 2)) {
                const turn = findLongestTurn(words, speaker);
                if (!turn || (turn.end - turn.start) < 1.0) return null;
                samples.push({ speaker, t: (turn.start + turn.end) / 2 });
            }
        } else {
            const spoken = words.filter(w => typeof w.start === 'number');
            if (!spoken.length) return null;
            const t0 = spoken[0].start;
            const t1 = spoken[spoken.length - 1].end;
            const span = Math.max(1, t1 - t0);
            samples.push({ speaker: speakers[0], t: t0 + span * 0.25 });
            samples.push({ speaker: speakers[0], t: t0 + span * 0.65 });
        }

        const frames = [];
        for (const s of samples) {
            const b64 = await extractVideoFrame(filename, s.t, requestUserId);
            if (!b64) return null;
            frames.push({ ...s, b64 });
        }

        const content = [
            {
                type: 'text',
                text:
                    `These are ${frames.length} frames from the same single-camera video.\n` +
                    'For EACH frame report:\n' +
                    '  - "people": how many distinct people are visible\n' +
                    '  - "anchor": the face of the person who appears to be actively speaking ' +
                    '(most frontal / mouth open / animated). If unsure, use the most prominent face. ' +
                    'Give its center as normalized coordinates: cx (0=left edge, 1=right edge), ' +
                    'cy (0=top, 1=bottom), and h = face height as a fraction of frame height.\n' +
                    '  - If NO face is visible, use "anchor": null\n' +
                    `Reply with ONLY valid JSON: {"frames":[{"people":N,"anchor":{"cx":0.5,"cy":0.4,"h":0.2}}${frames.length > 1 ? ',…' : ''}]}`,
            },
            ...frames.map(f => ({
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${f.b64}`, detail: 'low' },
            })),
        ];

        const resp = await openai.chat.completions.create({
            model:       'gpt-4o-mini',
            messages:    [{ role: 'user', content }],
            max_tokens:  200,
            temperature: 0,
        });

        const raw  = resp.choices[0]?.message?.content?.trim() || '';
        const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        const ans  = JSON.parse(json);

        if (!Array.isArray(ans.frames) || ans.frames.length !== frames.length) {
            console.warn('[virtual-multicam] layout: unexpected Vision answer shape:', raw.slice(0, 200));
            return null;
        }

        const clamp01 = v => Math.max(0, Math.min(1, Number(v)));
        const out = ans.frames.map((f, i) => {
            let anchor = null;
            if (f.anchor && typeof f.anchor.cx === 'number' && typeof f.anchor.cy === 'number') {
                anchor = {
                    cx: clamp01(f.anchor.cx),
                    cy: clamp01(f.anchor.cy),
                    h:  Math.max(0.02, Math.min(1, Number(f.anchor.h) || 0.2)),
                };
            }
            return { speaker: frames[i].speaker, people: Math.max(0, Number(f.people) || 0), anchor };
        });

        const onScreenCount = Math.max(...out.map(f => f.people), 0);
        console.log(
            `[virtual-multicam] layout: onScreen=${onScreenCount}, anchors=` +
            out.map(f => f.anchor ? `${f.speaker}@(${f.anchor.cx.toFixed(2)},${f.anchor.cy.toFixed(2)})` : `${f.speaker}@none`).join(' ')
        );

        return { onScreenCount, frames: out };
    } catch (err) {
        console.warn('[virtual-multicam] detectSceneLayout failed:', err.message);
        return null;
    }
}

// Non-production: skip hard auth so staging/local works without valid Supabase JWTs.
// Route handlers already fall back to 'dev-user' when req.user is absent.
const isProd = process.env.NODE_ENV === 'production';
const authAndGate = isProd ? [authenticateUser, aiGate] : [optionalAuth];
// refine-cut-frames does local motion/blur scoring only — no OpenAI call — so it
// shouldn't burn a user's monthly AI-ops quota (aiGate) or block on it.
const authOnly = isProd ? [authenticateUser] : [optionalAuth];

// ── Shared path-resolution helper ─────────────────────────────────────────────
// Mirrors the same guard used in silenceRoutes and audioRoutes so every route
// enforces the same uploads/ boundary.
// `requestUserId` (resolveRequestUserId(req)) — REQUIRED whenever filename came
// from client input. Same IDOR fix as resolveFfmpegInputArg above: without
// this, any authenticated user could pass another user's raw/{userId}/...
// filename and get a valid local path back.
function resolveUploadPath(filename, filePath, requestUserId) {
    const uploadsDir = path.resolve(__dirname, '../uploads');

    const normalized = (filename || '')
        .replace(/\\/g, '/')
        .replace(/^\/|\.\.\/|\.\.$/g, '');

    if (!pathOwnedBy(normalized, requestUserId)) {
        console.warn(`[interviewRoutes] resolveUploadPath: user "${requestUserId}" is not the owner of "${normalized}" — denied`);
        return { error: 'Access denied: invalid file path', inputPath: null, uploadsDir };
    }

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
        const requestUserId = resolveRequestUserId(req);

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
        // clipWordArrs keeps the timestamped words per clip so emphasis words can
        // be located precisely for punch-in placement (see buildMotion below).
        const clipWordArrs = clips.map(clip => {
            const ofs = clip.offset ?? 0;
            const end = ofs + (clip.duration ?? 0);
            return words.filter(w => w.start >= ofs - 0.05 && w.end <= end + 0.05);
        });
        const clipTexts = clipWordArrs.map(ws =>
            ws.map(w => w.word).join(' ').trim() || '[silence]'
        );

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
                    const { error, inputPath } = resolveUploadPath(clip.assetName, null, requestUserId);
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
        if (!isAIConfigured()) {
            return res.status(503).json({ error: 'OPENAI_API_KEY not configured on server.' });
        }
        const openai = getAIClient({ timeout: 30_000 });

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
`You are a short-form social video editor (TikTok/Reels/Shorts retention style) assigning shot types to create a multi-camera zoom rhythm for a talking-head video.
Each clip is already edited and cut. Assign each a shot type:
  "wide"   – neutral, low energy, transition, breather
  "medium" – conversational tone, background explanation
  "close"  – key statement, emotion, emphasis, surprise, strong assertion
${mlInstructions}
Rhythm rules (always apply):
- RETENTION HOOK: clip 0 is the hook — assign "medium" or "close", NEVER "wide". Viewers decide to stay in the first 3 seconds.
- Vary shots aggressively — no more than 2 in a row of the same type
- Never jump directly wide → close (bridge with medium)
- Clips with dur < 0.8 s must match the previous clip's type
- Use "wide" sparingly (breathers only) — social pacing favors medium/close

EMPHASIS: for each clip, also identify "ew" — the single most emphasized word in that clip's text (a number, superlative, emotional word, name, or key claim — the word a great editor would punch in on). It MUST be copied verbatim from the clip text. If nothing stands out, use null. Mark at most ~1 in 3 clips.

Return ONLY valid JSON: {"c":[{"i":N,"type":"wide"|"medium"|"close","ew":"word"|null}]}

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

        const gptMap      = {};
        const emphasisMap = {};  // index → emphasis word (verbatim) or undefined
        gptAssignments.forEach(a => {
            gptMap[a.i] = a.type;
            if (a.ew && typeof a.ew === 'string') emphasisMap[a.i] = a.ew;
        });

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

        // ── Motion plan builder ─────────────────────────────────────────────────
        // Turns a (type, scale, emphasis word) triple into an animation spec the
        // client renders as scale keyframes and the export renders via zoompan:
        //   static   – one scale for the whole clip (wide shots, very short clips)
        //   push_in  – slow zoom from ~95% of target to target over the clip
        //              (sustained statements — adds motion without a cut)
        //   punch_in – hold slightly under target, then snap to target exactly on
        //              the emphasized word (the social-editing emphasis beat)
        // `at` is CLIP-LOCAL seconds. from/to are absolute scale values.
        function buildMotion(type, clip, clipWords, emphasisWord, scale) {
            const dur = clip.duration ?? 0;
            if (type === 'wide' || dur < 1.2) {
                return { kind: 'static', from: scale, to: scale, at: null };
            }

            if (emphasisWord) {
                // Locate the emphasis word inside this clip (case/punct-insensitive)
                const norm = s => String(s).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
                const target = norm(emphasisWord);
                const hit = target
                    ? clipWords.find(w => norm(w.word) === target)
                    : null;
                if (hit) {
                    const ofs = clip.offset ?? 0;
                    // Keep the punch inside the clip with margins for the snap
                    const at = Math.max(0.15, Math.min(dur - 0.25, hit.start - ofs));
                    return {
                        kind: 'punch_in',
                        from: Math.max(1.0, parseFloat((scale * 0.93).toFixed(3))),
                        to:   scale,
                        at:   parseFloat(at.toFixed(3)),
                        word: emphasisWord,
                    };
                }
            }

            if (dur >= 2.5) {
                return {
                    kind: 'push_in',
                    from: Math.max(1.0, parseFloat((scale * 0.95).toFixed(3))),
                    to:   scale,
                    at:   null,
                };
            }

            return { kind: 'static', from: scale, to: scale, at: null };
        }

        // ── Build final clipZooms list ──────────────────────────────────────────
        const FALLBACK_CYCLE = ['medium', 'close', 'medium', 'wide'];
        let prevType  = 'wide';
        let sameCount = 0;

        const clipZooms = clips.map((clip, i) => {
            let type = gptMap[i] || null;

            if (!type && (clip.duration ?? 0) < 0.8) type = prevType;
            if (!type) type = FALLBACK_CYCLE[i % FALLBACK_CYCLE.length];

            // Retention hook: never open on a wide — the first shot must engage.
            if (i === 0 && type === 'wide') type = 'medium';

            // Enforce rhythm constraints (max 2 consecutive — social pacing)
            if (type === 'close' && prevType === 'wide')  type = 'medium';
            if (type === 'wide'  && prevType === 'close') type = 'medium';
            if (type === prevType) {
                if (++sameCount >= 2) {
                    type      = type === 'wide' ? 'medium' : (type === 'close' ? 'medium' : 'wide');
                    sameCount = 0;
                }
            } else {
                sameCount = 1;
            }

            prevType = type;
            const scale  = getScale(type, mlMeta[i]);
            const motion = buildMotion(type, clip, clipWordArrs[i], emphasisMap[i], scale);
            return { clipId: clip.id, scale, type, motion };
        });

        // ── Summary ─────────────────────────────────────────────────────────────
        const counts  = { wide: 0, medium: 0, close: 0 };
        const motions = { static: 0, push_in: 0, punch_in: 0 };
        clipZooms.forEach(c => {
            counts[c.type] = (counts[c.type] || 0) + 1;
            motions[c.motion?.kind || 'static'] = (motions[c.motion?.kind || 'static'] || 0) + 1;
        });

        console.log(
            `[interviewRoutes] rhythm-zoom: ${clips.length} clips → ` +
            `${counts.wide}W ${counts.medium}M ${counts.close}C | ` +
            `${motions.push_in} push-ins, ${motions.punch_in} punch-ins  style=${style}`
        );

        res.json({
            clipZooms,
            summary: { clipCount: clips.length, style, counts, motions, maxScale: cfg.close },
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

        const requestUserId = resolveRequestUserId(req);
        const { error, inputPath, uploadsDir, normalized } = resolveUploadPath(filename, filePath, requestUserId);
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
        const AssemblyAIService = require('../services/AssemblyAIService');
        const DiarizeService    = require('../services/DiarizeService');

        // Allow the request through if EITHER provider is configured.
        // The job processor uses AssemblyAI as primary and pyannote as fallback;
        // the route guard must mirror that — checking only DiarizeService here
        // causes a false 503 when ASSEMBLYAI_API_KEY is set but DIARIZE_SERVICE_URL is not.
        if (!AssemblyAIService.isAvailable && !DiarizeService.isAvailable) {
            return res.status(503).json({
                error:
                    'Speaker diarization is not configured. ' +
                    'Set ASSEMBLYAI_API_KEY (recommended) or DIARIZE_SERVICE_URL.',
            });
        }

        const { filename, filePath, language } = req.body;
        if (!filename && !filePath) {
            return res.status(400).json({ error: 'Provide filename or filePath' });
        }

        const requestUserId = resolveRequestUserId(req);
        const { error, inputPath, normalized } = resolveUploadPath(filename, filePath, requestUserId);
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

// ── Organize v2 · asset-profile helpers ──────────────────────────────────────

/**
 * Columns of `media_assets` that describe what a piece of footage actually IS.
 * Written by the asset-analysis worker (server/brain/media/MediaIntelligencePipeline.js).
 * Keep in sync with that pipeline's update payload — a column added there but
 * not here is simply invisible to the organizer.
 */
const ASSET_PROFILE_COLUMNS = [
    'id', 'name', 'scene_type', 'camera_angle', 'subject_count',
    'has_main_speaker', 'has_faces', 'is_broll', 'is_screen_recording',
    'location_type', 'lighting_quality', 'stability', 'emotional_tone',
    'content_description', 'suggested_label', 'audio_type', 'has_spoken_word',
    'analysis_status',
].join(', ');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The success value of `media_assets.analysis_status`. Imported, never inlined:
// filtering on the wrong literal here rejects every analysed asset silently and
// leaves the profile path permanently dead. See server/brain/media/analysisStatus.js.
const { ASSET_ANALYSIS_DONE } = require('../server/brain/media/analysisStatus');

/**
 * Fetch stored asset profiles for the requesting user, keyed by asset id.
 * Only rows whose analysis actually COMPLETED are returned — a 'processing' or
 * 'failed' row carries no usable signal and must not be mistaken for one (see
 * R38: a row existing is not the same as a row being analysed).
 *
 * Scoped by `user_id` as well as id: the ids come from the request body, so
 * without that filter a caller could read another user's footage description
 * by guessing asset ids.
 *
 * Never throws — the organizer degrades to live frame extraction when this
 * returns nothing, which is exactly what it did before profiles existed.
 */
async function fetchAssetProfiles(assetIds, requestUserId) {
    const ids = [...new Set((assetIds || []).filter(Boolean))];
    // 'dev-user' (the non-production fallback from resolveRequestUserId) is not
    // a uuid — querying a uuid column with it errors. Skip rather than warn on
    // every dev request.
    if (!ids.length || !UUID_RE.test(String(requestUserId || ''))) return {};

    try {
        const { supabaseAdmin } = require('../config/database');
        if (!supabaseAdmin) return {};

        const { data, error } = await supabaseAdmin
            .from('media_assets')
            .select(ASSET_PROFILE_COLUMNS)
            .eq('user_id', requestUserId)
            .in('id', ids);
        if (error) throw error;

        const byId = {};
        for (const row of data || []) {
            if (row && row.analysis_status === ASSET_ANALYSIS_DONE) byId[row.id] = row;
        }
        return byId;
    } catch (err) {
        console.warn(
            '[interviewRoutes] fetchAssetProfiles failed (falling back to frame extraction):',
            err.message
        );
        return {};
    }
}

/**
 * Render one stored profile as prompt text. Only non-empty fields are emitted —
 * a wall of "unknown" lines teaches the model to ignore the block entirely.
 */
function describeAssetProfile(profile) {
    const lines = [];
    const push = (label, value) => {
        if (value === null || value === undefined || value === '' || value === 'unknown') return;
        lines.push(`  ${label.padEnd(12)}: ${value}`);
    };

    push('Scene',     profile.scene_type);
    push('Framing',   profile.camera_angle);
    if (typeof profile.subject_count === 'number') {
        push('People', `${profile.subject_count} on camera`);
    }
    if (profile.is_broll)            lines.push('  Role        : B-roll / cutaway (no primary speaker)');
    if (profile.is_screen_recording) lines.push('  Role        : screen recording / demo');
    if (profile.has_main_speaker)    lines.push('  Role        : has a main speaker on camera');
    push('Location',  profile.location_type);
    push('Lighting',  profile.lighting_quality);
    push('Stability', profile.stability);
    push('Tone',      profile.emotional_tone);
    push('Audio',     profile.audio_type);
    if (profile.has_spoken_word === false) lines.push('  Audio       : no spoken word');
    push('Content',   profile.content_description);
    push('Label',     profile.suggested_label);

    return lines.join('\n');
}

/**
 * Build one prompt descriptor per clip, choosing the best available signal.
 *
 * PURE and synchronous by design — no I/O, no network, no model call — so the
 * signal-priority rules and the pipeline label can be executed directly in a
 * regression test instead of being inferred from the route's source. The two
 * guarantees worth pinning are: (a) a stored profile always beats live frame
 * analysis, and (b) a clip with NO signal is labelled as such rather than
 * silently described, which is what stops the model inventing a role for
 * footage nobody looked at.
 *
 * @returns {{descriptors: Array, imageDescriptors: Array, unanalysedIds: string[], pipeline: string}}
 */
function buildOrganizeDescriptors({ clips, profilesById = {}, mlById = {}, clipFrameMap = {} }) {
    const descriptors = (clips || []).map((clip, i) => {
        const label      = `Clip ${i + 1} [id: ${clip.id}]`;
        const durLine    = `  Duration    : ${(clip.duration || 0).toFixed(1)} s`;
        const transcript = (clip.transcript || '').slice(0, 250).trim();
        const trLine     = transcript ? `  Transcript  : "${transcript}"` : '';

        // 1. Stored profile — describes the whole asset, costs nothing here.
        const profile = clip.assetId ? profilesById[clip.assetId] : null;
        if (profile) {
            return {
                id: clip.id, source: 'profile', frame: null,
                text: [label, '  Source      : analysed at upload',
                       describeAssetProfile(profile), durLine, trLine]
                    .filter(Boolean).join('\n'),
            };
        }

        // 2. ML classification of sampled frames.
        const ml = mlById[clip.id];
        if (ml) {
            const typeLabel = (ml.clip_type || 'unknown').replace(/_/g, ' ');
            const topStr    = Object.entries(ml.top_types || {})
                .map(([k, v]) => `${k.replace(/_/g, ' ')} ${(v * 100).toFixed(0)}%`)
                .join(', ');
            const faceStr = ml.has_face
                ? `face detected (${ml.face_count} person${ml.face_count > 1 ? 's' : ''}, ${ml.face_size} close-up)`
                : 'no face detected';
            return {
                id: clip.id, source: 'ml', frame: null,
                text: [
                    label,
                    '  Source      : visual classification of sampled frames',
                    `  Visual type : ${typeLabel} (confidence ${((ml.clip_type_confidence || 0) * 100).toFixed(0)}%)`,
                    `  Alternatives: ${topStr || 'none'}`,
                    `  Face signal : ${faceStr}`,
                    `  Energy      : ${ml.energy}`,
                    `  Topic group : ${ml.topic_cluster}`,
                    durLine, trLine,
                ].filter(Boolean).join('\n'),
            };
        }

        // 3. A raw frame the model can look at itself.
        const frames = clipFrameMap[clip.id] || [];
        const frame  = frames[1] || frames[0] || null;
        if (frame) {
            return {
                id: clip.id, source: 'frame', frame,
                text: [label, '  Source      : single sampled frame (below)', durLine, trLine]
                    .filter(Boolean).join('\n'),
            };
        }

        // 4. Nothing. Say so explicitly — see the R30 note on the route.
        return {
            id: clip.id, source: 'none', frame: null,
            text: [
                label,
                '  Source      : NOT ANALYSED — no profile and no readable frames.',
                '                Place it by transcript/duration only, or leave it where it is.',
                durLine, trLine,
            ].filter(Boolean).join('\n'),
        };
    });

    const imageDescriptors = descriptors.filter(d => d.frame);
    const unanalysedIds    = descriptors.filter(d => d.source === 'none').map(d => d.id);

    const hasProfile = descriptors.some(d => d.source === 'profile');
    const hasMl      = descriptors.some(d => d.source === 'ml');
    const hasFrame   = imageDescriptors.length > 0;
    const pipeline =
        (hasProfile && hasMl)    ? 'profile+ml'     :
        (hasProfile && hasFrame) ? 'profile+vision' :
        hasProfile               ? 'profile'        :
        hasMl                    ? 'ml'             : 'vision_fallback';

    return { descriptors, imageDescriptors, unanalysedIds, pipeline };
}

/**
 * Resolve one clip to something ffmpeg can read, preferring the PER-ASSET path.
 *
 * Priority is deliberate:
 *  1. `gcsPath` — the asset's own storage key. Works in BOTH GCS mode (signed
 *     URL) and local mode, and is the only per-clip-correct option.
 *  2. `filePath` — legacy. The client used to send `uploadedFilePath` here,
 *     which is a single GLOBAL field each upload overwrites (R21), so every
 *     clip in a batch received the SAME path. Accepted for backward compat but
 *     never preferred.
 *  3. `assetName` — legacy bare-filename lookup under uploads/.
 *
 * All three run through the same ownership guard as the rest of this file (R27).
 */
async function resolveClipSource(clip, requestUserId, uploadsDir) {
    if (clip.gcsPath) {
        const arg = await resolveFfmpegInputArg(clip.gcsPath, requestUserId);
        if (arg) return arg;
    }

    if (clip.filePath) {
        if (!pathOwnedBy(clip.filePath, requestUserId)) {
            console.warn(
                `[interviewRoutes] organize-clips: user "${requestUserId}" is not the owner of "${clip.filePath}" — denied`
            );
            return null;
        }
        const abs = path.resolve(clip.filePath);
        if (abs.startsWith(uploadsDir) && fs.existsSync(abs)) return abs;
    }

    if (clip.assetName) {
        const { error, inputPath } = resolveUploadPath(clip.assetName, null, requestUserId);
        if (!error && inputPath && fs.existsSync(inputPath)) return inputPath;
    }

    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/interview/organize-clips
//
// Organize v2 — profile-first semantic clip organizer.
//
// The ordering signal is resolved per clip, cheapest and richest first:
//   1. STORED PROFILE — the `media_assets` row written at upload time by the
//      asset-analysis worker (scene type, framing, subject count, B-roll flag,
//      lighting, stability, tone, description). Free, instant, and already
//      reflects the whole asset rather than three sampled frames.
//   2. ML CLASSIFICATION — frames → the Python diarize-service (CLIP +
//      MediaPipe + sentence-transformers), for clips with no stored profile.
//   3. RAW FRAME → VISION — for clips with frames but no ML service.
//   4. NOTHING — clip is named in the response as unanalysed rather than
//      quietly ordered on duration alone.
//
// Everything then goes through ONE ordering call: text-only GPT-4o when no
// clip needed an image, GPT-4o-mini Vision when at least one did.
//
// R30: if NO clip produced any signal at all, this returns `orderedIds: []`
// and `pipeline: 'none'` instead of a confident order. It used to return a
// full ordering plus a plausible rationale in exactly that case — in GCS
// production EVERY frame extraction failed (the extractor was local-file only),
// so the "semantic organizer" was ordering on clip duration and saying so in
// prose. A wrong order presented as an editorial decision is worse than no
// order at all.
//
// Body:
//   clips – Array<{
//     id:          string   (client-side clip/placement ID)
//     assetId?:    string   (asset id — REQUIRED to hit the stored-profile path)
//     gcsPath?:    string   (that asset's own storage key — preferred for frames)
//     assetName?:  string   (legacy filename lookup)
//     filePath?:   string   (legacy absolute server path — see resolveClipSource)
//     offset:      number   (seconds into source file where this clip starts)
//     duration:    number   (clip length in seconds)
//     transcript?: string   (optional Whisper text for this clip)
//   }>
//
// Returns:
//   {
//     clipMeta:   [{ id, narrative_role, summary, ... }]
//     orderedIds: string[]    — clip IDs in recommended order ([] when no signal)
//     rationale:  string      — human-readable explanation
//     pipeline:   "profile" | "profile+ml" | "profile+vision" | "ml" | "vision_fallback" | "none"
//     coverage:   { total, profiled, framed, unanalyzed }
//   }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/organize-clips', ...authAndGate, async (req, res) => {
    const { spawn } = require('child_process');

    try {
        const { clips = [] } = req.body;
        const requestUserId = resolveRequestUserId(req);

        if (!clips.length) {
            return res.status(400).json({ error: 'No clips provided.' });
        }
        if (clips.length < 2) {
            return res.status(400).json({ error: 'Need at least 2 clips to organize.' });
        }
        if (!isAIConfigured()) {
            return res.status(503).json({ error: 'OPENAI_API_KEY not configured on server.' });
        }

        const OpenAI = require('openai');
        const openai = getAIClient({ timeout: 60_000 });

        const uploadsDir = path.resolve(__dirname, '../uploads');

        // ── 1. Stored asset profiles — the primary signal (Organize v2) ─────────
        // A clip whose asset was analysed at upload time needs no frames, no
        // ffmpeg, and no vision call: the profile already describes the whole
        // asset. This is the Upload → Analyze → Asset Profile → Organize path.
        const profilesById  = await fetchAssetProfiles(clips.map(c => c.assetId), requestUserId);
        const profiledClips = clips.filter(c => c.assetId && profilesById[c.assetId]);
        const needFrames    = clips.filter(c => !(c.assetId && profilesById[c.assetId]));

        // ── 2. ffmpeg frame extraction — ONLY for clips with no stored profile ──
        // Pipes JPEG bytes to stdout — no temp files, no race conditions.
        // Accepts a signed https URL as well as a local path: in GCS mode there
        // is no local copy, and the previous fs.existsSync() precondition made
        // this return null for EVERY clip in production (see the R30 note above).
        const extractFrame = (inputArg, seekSeconds) => new Promise((resolve) => {
            if (!inputArg) { resolve(null); return; }
            const isRemote = /^https?:\/\//i.test(inputArg);
            if (!isRemote && !fs.existsSync(inputArg)) { resolve(null); return; }

            const chunks = [];
            const ff = spawn('ffmpeg', [
                '-ss', String(Math.max(0, seekSeconds)),
                '-i', inputArg,
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

        // Resolve sources per clip (de-duped by asset, since N clips can share
        // one source file and signing/resolving it once is enough).
        const sourceByAsset = {}; // asset key → ffmpeg input arg | null
        for (const clip of needFrames) {
            const key = clip.assetId || clip.gcsPath || clip.assetName || clip.filePath || String(clip.id);
            if (sourceByAsset[key] !== undefined) continue;
            sourceByAsset[key] = await resolveClipSource(clip, requestUserId, uploadsDir);
        }

        // Extract 3 frames per clip at 15 %, 45 %, 75 % of its range in the source.
        const clipFrameMap = {}; // clipId → string[] (base64 or empty)
        await Promise.all(needFrames.map(async (clip) => {
            const key       = clip.assetId || clip.gcsPath || clip.assetName || clip.filePath || String(clip.id);
            const inputArg  = sourceByAsset[key];
            const offset    = clip.offset   ?? 0;
            const dur       = clip.duration ?? 0;
            const positions = [0.15, 0.45, 0.75].map(p => offset + dur * p);
            const frames    = await Promise.all(positions.map(t => extractFrame(inputArg, t)));
            clipFrameMap[clip.id] = frames.filter(Boolean);
        }));

        const framedClips = needFrames.filter(c => (clipFrameMap[c.id] || []).length > 0);
        const blindClips  = needFrames.filter(c => (clipFrameMap[c.id] || []).length === 0);
        const totalFrames = Object.values(clipFrameMap).reduce((s, f) => s + f.length, 0);

        const coverage = {
            total:      clips.length,
            profiled:   profiledClips.length,
            framed:     framedClips.length,
            unanalyzed: blindClips.length,
        };

        console.log(
            `[interviewRoutes] organize-clips: ${clips.length} clips — ` +
            `${coverage.profiled} from stored profile, ${coverage.framed} from frames, ` +
            `${coverage.unanalyzed} with no signal`
        );

        // ── 3. R30 guard: no signal at all → do NOT invent an order ─────────────
        if (profiledClips.length === 0 && totalFrames === 0) {
            console.warn(
                '[interviewRoutes] organize-clips: no stored profiles and no extractable frames — ' +
                'refusing to return an ordering derived from duration alone'
            );
            return res.json({
                clipMeta:   [],
                orderedIds: [],
                rationale:  '',
                pipeline:   'none',
                coverage,
                reason:     'No analysed footage and no readable video frames — nothing to order on.',
            });
        }

        const mlAvailable = (() => {
            try { return require('../services/ClipAnalysisService').isAvailable; }
            catch { return false; }
        })();

        // ── 4. ML classification — ONLY for clips with no stored profile ────────
        // Running it over profiled clips too would pay for CLIP + MediaPipe on
        // footage we already have a richer, whole-asset description of.
        let mlClips = [];
        let mlResult = {};
        if (mlAvailable && framedClips.length > 0) {
            console.log(
                `[interviewRoutes] organize-clips: ML classify — ${framedClips.length} unprofiled clip(s), ` +
                `${totalFrames} frames → /classify-clips`
            );

            const ClipAnalysisService = require('../services/ClipAnalysisService');

            const classifyPayload = framedClips.map(clip => ({
                id:         clip.id,
                frames:     clipFrameMap[clip.id] || [],
                transcript: (clip.transcript || '').slice(0, 400),
                duration:   clip.duration ?? 0,
            }));

            try {
                mlResult = await ClipAnalysisService.classifyClips(classifyPayload);
                mlClips  = mlResult.clips || [];
            } catch (mlErr) {
                // Not fatal: these clips fall through to the vision path below,
                // and profiled clips are unaffected either way.
                console.warn('[interviewRoutes] organize-clips: ML classify failed —', mlErr.message);
                mlClips = [];
            }
        }

        // ── 5. Build ONE descriptor per clip, best signal first ─────────────────
        const mlById = {};
        mlClips.forEach(m => { if (m && m.id) mlById[m.id] = m; });

        const { descriptors, imageDescriptors, unanalysedIds, pipeline } =
            buildOrganizeDescriptors({ clips, profilesById, mlById, clipFrameMap });

        // ── 6. Single ordering call ────────────────────────────────────────────
        // Text-only (GPT-4o) when every clip already has a written description;
        // Vision (GPT-4o-mini) only when at least one clip still needs an image.
        {
            const numClusters = mlResult.num_topic_clusters ?? 1;
            const metadataLines = descriptors.map(d => d.text).join('\n\n');

            const unanalysedNote = unanalysedIds.length
                ? `\n\n${unanalysedIds.length} of these clips could not be analysed. Do not describe them as if you can see them, and do not invent a role for them — place them conservatively and say so in the rationale.`
                : '';

            const promptText = `You are an expert video editor deciding the best narrative order for ${clips.length} clips.

Each clip below carries a "Source" line saying where its description came from:
analysed at upload (richest — describes the whole asset), visual classification
of sampled frames, a single sampled frame shown as an image, or NOT ANALYSED.
Weight your confidence accordingly.
There are ${numClusters} distinct topic group(s) among the frame-classified clips.

━━━ CLIP METADATA ━━━
${metadataLines}

━━━ ORDERING RULES ━━━
• Open with a hook: the highest-energy talking-head close-up or the clearest intro
• Group clips covering the same topic together where possible
• B-roll / cutaways should surround the spoken content they illustrate
• Demonstrations come after the verbal introduction of the topic
• End with a clear outro: low-energy summary talking head or call-to-action
• Avoid placing two establishing shots or two product shots back-to-back
• Emotional moments are best placed just before or after a key-point clip${unanalysedNote}

Return ONLY valid JSON:
{
  "orderedIds": ["<clip id>", ...],
  "clipMeta": [
    { "id": "<clip id>", "narrative_role": "<role>", "summary": "<one sentence>" }
  ],
  "rationale": "<3-4 sentences explaining the chosen order>"
}`;

            // Only pay for a vision model when a clip actually needs an image.
            const useVision = imageDescriptors.length > 0;
            const content = [{ type: 'text', text: promptText }];
            if (useVision) {
                for (const d of imageDescriptors) {
                    content.push({ type: 'text', text: `\n[frame for clip id: ${d.id}]` });
                    content.push({
                        type: 'image_url',
                        image_url: { url: `data:image/jpeg;base64,${d.frame}`, detail: 'low' },
                    });
                }
            }

            const completion = await openai.chat.completions.create({
                model:           useVision ? 'gpt-4o-mini' : 'gpt-4o',
                messages:        [{ role: 'user', content }],
                response_format: { type: 'json_object' },
                temperature:     0.15,
                max_tokens:      1200,
            });

            let parsed;
            try { parsed = JSON.parse(completion.choices[0].message.content); }
            catch { return res.status(500).json({ error: 'GPT returned malformed JSON.' }); }

            const orderedIds = (parsed.orderedIds || []).filter(id => clips.some(c => c.id === id));
            const clipMeta   = (parsed.clipMeta   || parsed.clips || []).filter(m => m && m.id);
            const rationale  = parsed.rationale || '';

            // Append any IDs GPT dropped
            const seen = new Set(orderedIds);
            clips.forEach(c => { if (!seen.has(c.id)) orderedIds.push(c.id); });

            // Merge whatever structured signal each clip had into the returned meta
            const enrichedMeta = clipMeta.map(m => {
                const clip    = clips.find(c => c.id === m.id);
                const profile = clip && clip.assetId ? profilesById[clip.assetId] : null;
                return {
                    ...(mlById[m.id] || {}),
                    ...(profile ? {
                        clip_type: profile.scene_type,
                        energy:    profile.emotional_tone,
                        summary:   profile.content_description,
                    } : {}),
                    ...m,
                    signal: (descriptors.find(d => d.id === m.id) || {}).source || 'none',
                };
            });

            console.log(
                `[interviewRoutes] organize-clips (${pipeline}): ${clips.length} clips → order: ${orderedIds.join(' → ')}`
            );

            return res.json({
                clipMeta: enrichedMeta,
                orderedIds,
                rationale,
                pipeline,
                coverage,
                unanalyzedIds: unanalysedIds,
            });
        }

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
            roles    = {},          // { SPEAKER_00: 'interviewer'|'guest' } from identify-speakers (optional)
            hostSide: forcedHostSide,
        } = req.body;
        const requestUserId = resolveRequestUserId(req);

        if (!words.length) {
            return res.status(400).json({ error: 'words array is required. Run speaker diarization first.' });
        }
        if (!speakers.length) {
            return res.status(400).json({ error: 'speakers array is required.' });
        }

        // ── 0. Host ordering + scene layout ──────────────────────────────────
        // If identify-speakers assigned roles, make the interviewer speakers[0]
        // (the "host") instead of blindly trusting diarization label order.
        const orderedSpeakers = [...speakers];
        const interviewerId = Object.keys(roles).find(k => roles[k] === 'interviewer');
        if (interviewerId && orderedSpeakers.includes(interviewerId) && orderedSpeakers[0] !== interviewerId) {
            orderedSpeakers.splice(orderedSpeakers.indexOf(interviewerId), 1);
            orderedSpeakers.unshift(interviewerId);
            console.log(`[virtual-multicam] host reordered to ${interviewerId} (role=interviewer)`);
        }

        // Primary vision pass: real face anchors + on-screen person count.
        // Everything downstream degrades gracefully when this returns null.
        const layout = await detectSceneLayout(words, orderedSpeakers, filename, requestUserId);

        // Voice-off interviewer: diarization hears 2 speakers but only 1 person
        // is ever on camera → left/right duo crops would frame empty space.
        // Frame the single visible person solo instead (cuts still follow the
        // conversation rhythm since chunking happens on the full word stream).
        const effectiveSolo =
            speakers.length === 1 ||
            (layout !== null && layout.onScreenCount === 1);

        if (effectiveSolo && speakers.length > 1) {
            console.log('[virtual-multicam] 2+ diarized speakers but 1 person on screen — using SOLO framing');
        }

        // Face-anchored camera builder: centers the crop on the detected face,
        // placing it at ~40% of crop height (headroom) and clamping in-bounds.
        // Falls back to centered/fixed cameras when no anchor is available.
        const anchorCam = (scale, anchor) => {
            if (!anchor) return null;
            const h = 1.0 / scale;
            return {
                scale,
                x: anchor.cx - 0.5,
                y: (anchor.cy + 0.10 * h) - 0.5, // face at upper 40% of the crop
            };
        };

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

        // ── Path a2: derive hostSide from scene-layout anchors (best) ──────────
        // If the layout pass returned an anchor for each speaker's frame, the
        // host's horizontal position tells us the side directly — no second
        // Vision call needed.
        if (!hostSide && !effectiveSolo && layout) {
            const hostFrame  = layout.frames.find(f => f.speaker === orderedSpeakers[0]);
            const guestFrame = layout.frames.find(f => f.speaker === orderedSpeakers[1]);
            if (hostFrame?.anchor && guestFrame?.anchor
                && Math.abs(hostFrame.anchor.cx - guestFrame.anchor.cx) > 0.08) {
                hostSide     = hostFrame.anchor.cx < guestFrame.anchor.cx ? 'left' : 'right';
                faceDetected = true;
                console.log(`[virtual-multicam] hostSide="${hostSide}" via scene-layout anchors`);
            }
        }

        // ── Path b: GPT-4o-mini Vision (primary — no extra service needed) ──────
        // Extracts one frame per speaker at their longest solo turn, sends both
        // to GPT-4o-mini in a single call, and asks which side each active speaker
        // is on. Requires OPENAI_API_KEY and a resolvable filename (GCS or local).
        if (!hostSide && filename && speakers.length >= 2 && !effectiveSolo) {
            const visionSide = await detectHostSideViaVision(words, orderedSpeakers, filename, requestUserId);
            if (visionSide) {
                hostSide     = visionSide;
                faceDetected = true;
                console.log(`[virtual-multicam] hostSide="${hostSide}" via GPT-4o-mini Vision`);
            }
        }

        // ── Path c: pyannote MediaPipe (secondary — if DIARIZE_SERVICE_URL set) ─
        // Cross-checks the Vision result. If both agree, confidence is high.
        // If only pyannote is available (no OpenAI key), it acts as primary.
        if (!hostSide && filename && diarizeServiceUrl && speakers.length >= 2 && !effectiveSolo) {
            const speakerSides = await detectSpeakerSides(words, orderedSpeakers, filename, diarizeServiceUrl, requestUserId);
            if (speakerSides?.[orderedSpeakers[0]]) {
                hostSide     = speakerSides[orderedSpeakers[0]];
                faceDetected = true;
                console.log(`[virtual-multicam] hostSide="${hostSide}" via pyannote MediaPipe`);
            }
        }

        // ── Path d: default ───────────────────────────────────────────────────
        if (!hostSide) {
            hostSide = 'left';
            console.log('[virtual-multicam] hostSide defaulting to "left" (no face detection available)');
        }

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
        // Duo cameras: prefer REAL face anchors from the layout pass — the crop
        // centers on where each person actually sits rather than assuming they
        // are at exactly ±28% from center. Fixed offsets remain as fallback.
        let duoLeftAnchor = null, duoRightAnchor = null;
        if (!effectiveSolo && layout) {
            const duoAnchors = layout.frames.map(f => f.anchor).filter(Boolean);
            if (duoAnchors.length === 2 && Math.abs(duoAnchors[0].cx - duoAnchors[1].cx) > 0.08) {
                const sorted   = [...duoAnchors].sort((a, b) => a.cx - b.cx);
                duoLeftAnchor  = sorted[0];
                duoRightAnchor = sorted[1];
                console.log(
                    `[virtual-multicam] duo cameras anchored: left@(${duoLeftAnchor.cx.toFixed(2)},${duoLeftAnchor.cy.toFixed(2)}) ` +
                    `right@(${duoRightAnchor.cx.toFixed(2)},${duoRightAnchor.cy.toFixed(2)})`
                );
            }
        }

        const VIRTUAL_CAMERAS = {
            wide:      { scale: 1.00, x:  0.00, y:  0.00 },
            speakerA:  anchorCam(2.50, duoLeftAnchor)  || { scale: 2.50, x: -0.28, y: -0.10 },  // left speaker, standard single
            speakerB:  anchorCam(2.50, duoRightAnchor) || { scale: 2.50, x: +0.28, y: -0.10 },  // right speaker, standard single
            reactionA: anchorCam(1.60, duoLeftAnchor)  || { scale: 1.60, x: -0.15, y: -0.05 },  // left speaker listening (OTS)
            reactionB: anchorCam(1.60, duoRightAnchor) || { scale: 1.60, x: +0.15, y: -0.05 },  // right speaker listening (OTS)
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

        // Raw scene facts for the client. `detect_scene` surfaces these so a user
        // can ask "what's in the shot?" and get an actual answer (people on
        // camera, where faces sit, whether framing was detected) instead of only
        // an angle-count summary. Null when the Vision pass was unavailable.
        const layoutSummary = layout ? {
            onScreenCount: layout.onScreenCount,
            facesDetected: layout.frames.filter(f => f.anchor).length,
            framesSampled: layout.frames.length,
            anchors: layout.frames.map(f => ({
                speaker: f.speaker,
                people:  f.people,
                anchor:  f.anchor ? { cx: +f.anchor.cx.toFixed(3), cy: +f.anchor.cy.toFixed(3), h: +f.anchor.h.toFixed(3) } : null,
            })),
        } : null;

        // ── SOLO MODE: one person on camera → wide / mid / close angles ─────
        // Entered when diarization found 1 speaker OR when the layout pass saw
        // only 1 person on screen (voice-off interviewer). Simulates a 3-camera
        // shoot pointed at the same person: wide (full frame), mid (1.30x),
        // close (1.75x), cutting at natural speech pauses. Cameras center on
        // the DETECTED face anchor when available — an off-center subject gets
        // correctly framed crops instead of blind center zooms.
        if (effectiveSolo) {
            // Average all detected anchors (subject may shift slightly between frames)
            const soloAnchors = (layout?.frames || []).map(f => f.anchor).filter(Boolean);
            const soloAnchor  = soloAnchors.length
                ? {
                    cx: soloAnchors.reduce((s, a) => s + a.cx, 0) / soloAnchors.length,
                    cy: soloAnchors.reduce((s, a) => s + a.cy, 0) / soloAnchors.length,
                    h:  soloAnchors.reduce((s, a) => s + a.h,  0) / soloAnchors.length,
                }
                : null;

            const SOLO_CAMERAS = {
                wide:  { scale: 1.00, x: 0, y: 0.00 },
                mid:   anchorCam(1.30, soloAnchor) || { scale: 1.30, x: 0, y: -0.05 },
                close: anchorCam(1.75, soloAnchor) || { scale: 1.75, x: 0, y: -0.10 },
            };
            if (soloAnchor) {
                console.log(
                    `[virtual-multicam] SOLO cameras anchored on face @(${soloAnchor.cx.toFixed(2)},${soloAnchor.cy.toFixed(2)})`
                );
            }

            // Chunk continuous speech into shot-length pieces, cutting
            // preferentially at pauses so angle changes feel motivated.
            const TARGET_SHOT = 7;    // ideal shot length (s)
            const MAX_SHOT    = 12;   // force a cut beyond this
            const PAUSE_GAP   = 0.35; // a gap this long is a natural cut point

            const chunks = [];
            let cs = null;
            for (const w of words) {
                if (!w.speaker || typeof w.start !== 'number' || typeof w.end !== 'number') continue;
                if (!cs) { cs = { start: w.start, end: w.end }; continue; }
                const gap = w.start - cs.end;
                const len = cs.end - cs.start;
                if ((gap >= PAUSE_GAP && len >= TARGET_SHOT * 0.6) || len >= MAX_SHOT) {
                    chunks.push(cs);
                    cs = { start: w.start, end: w.end };
                } else {
                    cs.end = w.end;
                }
            }
            if (cs) chunks.push(cs);

            if (!chunks.length) {
                return res.status(400).json({ error: 'No usable speech segments found in words array.' });
            }

            // Angle cycle: mid → close → mid → wide … — never jumps directly
            // between wide and close (always bridged by mid), and the video
            // opens and closes on the wide to establish/settle the scene.
            const SOLO_CYCLE = ['mid', 'close', 'mid', 'wide'];
            const soloSegments = [];
            let cycleIdx = 0;

            for (let i = 0; i < chunks.length; i++) {
                const isFirst = i === 0;
                const isLast  = i === chunks.length - 1;
                let angle;
                if (isFirst || isLast) {
                    angle = 'wide';
                } else {
                    angle = SOLO_CYCLE[cycleIdx++ % SOLO_CYCLE.length];
                    // The final segment is forced wide — if the cycle put a close
                    // right before it, bridge with a mid to keep the "never jump
                    // wide↔close directly" rule intact.
                    if (i === chunks.length - 2 && angle === 'close') angle = 'mid';
                }
                const cam     = SOLO_CAMERAS[angle];
                const crop    = scaleToCrop(cam);
                soloSegments.push({
                    start:   parseFloat(chunks[i].start.toFixed(3)),
                    end:     parseFloat(chunks[i].end.toFixed(3)),
                    angle,
                    speaker: speakers[0],
                    scale:   cam.scale,
                    x:       cam.x,
                    y:       cam.y,
                    cropX:   crop.cropX,
                    cropY:   crop.cropY,
                    cropW:   crop.cropW,
                    cropH:   crop.cropH,
                });
            }

            const soloCounts = { wide: 0, mid: 0, close: 0 };
            soloSegments.forEach(s => { soloCounts[s.angle]++; });
            console.log(
                `[virtual-multicam] SOLO mode: ${soloSegments.length} segments — ` +
                `${soloCounts.wide}W / ${soloCounts.mid}M / ${soloCounts.close}C`
            );

            return res.json({
                segments:     soloSegments,
                mode:         'solo',
                hostSide:     'center',
                faceDetected: !!soloAnchor,
                host:         orderedSpeakers[0],
                guest:        null,
                layout:       layoutSummary,
            });
        }

        // Map speaker IDs to camera labels based on detected host side.
        //   hostSide='left' → host is speaker A (left), guest is speaker B (right)
        //   hostSide='right' → host is speaker B (right), guest is speaker A (left)
        // orderedSpeakers puts the identified interviewer first (see section 0).
        const host  = orderedSpeakers[0] || 'SPEAKER_00';
        const guest = orderedSpeakers[1] || 'SPEAKER_01';

        const speakerCam   = {};  // speaker → close-up camera name
        const reactionCam  = {};  // speaker → reaction camera (other side listening)

        if (hostSide === 'left') {
            speakerCam[host]   = 'speakerA';   reactionCam[host]   = 'reactionB';
            speakerCam[guest]  = 'speakerB';   reactionCam[guest]  = 'reactionA';
        } else {
            speakerCam[host]   = 'speakerB';   reactionCam[host]   = 'reactionA';
            speakerCam[guest]  = 'speakerA';   reactionCam[guest]  = 'reactionB';
        }

        // Speakers beyond host/guest: diarization frequently emits a spurious third
        // label (crosstalk, a cough, a brief interjection). Those turns used to fall
        // through `speakerCam[seg.speaker] || 'wide'` and render WIDE every time —
        // on a noisy diarization that alone could wash a whole video wide. Alternate
        // them across the two physical cameras instead so framing stays plausible.
        orderedSpeakers.slice(2).forEach((spk, i) => {
            const useA = i % 2 === 0;
            speakerCam[spk]  = useA ? 'speakerA'  : 'speakerB';
            reactionCam[spk] = useA ? 'reactionB' : 'reactionA';
        });
        if (orderedSpeakers.length > 2) {
            console.log(`[virtual-multicam] ${orderedSpeakers.length - 2} extra speaker label(s) mapped onto the two cameras`);
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

        res.json({ segments, mode: 'duo', hostSide, faceDetected, host, guest, layout: layoutSummary });

    } catch (err) {
        console.error('[interviewRoutes] /virtual-multicam error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/interview/classify-pauses
//
// The editorial intelligence behind silence removal. A raw gap-length rule
// can't tell a thinking pause before an answer, a dramatic beat after a key
// statement, or a mid-sentence hesitation apart from dead air — it cuts them
// all, which makes cleaned videos feel rough and robotic ("too aggressive").
//
// Body: {
//   pauses: [{ i, dur, before, after }]  — i: caller's index, dur: seconds,
//            before/after: ~10 words of transcript on each side of the pause
// }
// Returns: { decisions: [{ i, action: 'cut'|'keep'|'shorten' }] }
//   cut     — dead air / rambling gap: remove entirely
//   keep    — intentional beat (dramatic pause, emphasis): leave untouched
//   shorten — thinking pause with editorial value: keep a short natural beat
//
// Falls back are the CALLER's job (heuristics in MediaExecutionEngine) — this
// endpoint returns 503 rather than guessing when GPT is unavailable.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/classify-pauses', ...authAndGate, async (req, res) => {
    const { pauses = [] } = req.body || {};
    if (!Array.isArray(pauses) || pauses.length === 0) {
        return res.status(400).json({ error: 'pauses array is required' });
    }
    if (!isAIConfigured()) {
        return res.status(503).json({ error: 'OPENAI_API_KEY not configured' });
    }

    try {
        const OpenAI = require('openai');
        const openai = getAIClient({ timeout: 20_000 });

        // Compact per-pause objects — cap context length to keep the prompt small
        const compact = pauses.slice(0, 120).map(p => ({
            i:      p.i,
            dur:    parseFloat(Number(p.dur || 0).toFixed(2)),
            before: String(p.before || '').slice(-140),
            after:  String(p.after  || '').slice(0, 140),
        }));

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{
                role: 'user',
                content:
`You are a professional video editor reviewing pauses detected in a talking-head/interview video.
For each pause decide:
  "cut"     – dead air, rambling gap, false start, or filler silence: removing it tightens the video
  "keep"    – intentional beat: dramatic pause after a key statement, comedic timing, emphasis before a punchline
  "shorten" – a thinking pause before answering a question, or a natural breath mid-thought: has emotional value but is too long as-is

Guidelines:
- A pause right after a question (before the answer) is usually "shorten" — the hesitation is human and engaging, but 3s of it is not.
- A pause mid-sentence (the text before ends WITHOUT sentence-final punctuation) is usually "keep" or "shorten" — cutting it risks clipping speech.
- A pause after a completed sentence with low-content text around it is usually "cut".
- Pauses > 4s are almost always "cut" or "shorten", never "keep".

Return ONLY valid JSON: {"d":[{"i":N,"a":"cut"|"keep"|"shorten"}]}

Pauses: ${JSON.stringify(compact)}`,
            }],
            response_format: { type: 'json_object' },
            temperature: 0.1,
            max_tokens: 1500,
        });

        let decisions = [];
        try {
            const parsed = JSON.parse(completion.choices[0].message.content);
            decisions = (parsed.d || []).map(d => ({
                i:      d.i,
                action: ['cut', 'keep', 'shorten'].includes(d.a) ? d.a : 'cut',
            }));
        } catch (parseErr) {
            return res.status(502).json({ error: 'Could not parse pause classification' });
        }

        const counts = { cut: 0, keep: 0, shorten: 0 };
        decisions.forEach(d => { counts[d.action]++; });
        console.log(`[interviewRoutes] classify-pauses: ${pauses.length} pauses → ${counts.cut} cut / ${counts.keep} keep / ${counts.shorten} shorten`);

        res.json({ decisions });
    } catch (err) {
        console.error('[interviewRoutes] /classify-pauses error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/interview/refine-cut-frames
//
// classify-pauses decides WHICH pauses to cut using transcript context alone —
// it has no idea what's on screen at the exact millisecond the cut lands.
// A cut chosen purely from word timing can land mid-blink, mid-gesture, or on
// a motion-blurred frame, which reads as a jump-cut glitch even though the
// audio edit was correct. This endpoint nudges each candidate cut point (up to
// ~130ms either way, always within the pause/silence being removed — never
// into kept speech) onto a nearby frame with low motion and reasonable
// sharpness.
//
// Deliberately NOT a GPT Vision call: sending 2-3 frames per cut point through
// gpt-4o-mini for a batch of 20-40 cuts would mean dozens of blocking ffmpeg
// extractions (see extractVideoFrame's execSync) PLUS real added latency and
// token cost, for a judgment ("is this frame mid-blink") that plain motion +
// edge-energy scoring answers just as well. Instead this does ONE streamed
// ffmpeg decode (spawn, not execSync — does not block the event loop) covering
// the whole span of requested points at a small size/fps, then scores every
// sampled frame in memory. Local, fast, free, and — importantly, given R24 —
// doesn't add another blocking/heavy call into the same process that's already
// tight on memory during multi-file uploads.
//
// Body: { filename, points: [{ id, t }] }  — t: candidate cut timestamp (sec)
//   in the SOURCE file's time base (same base as the segments being cut).
// Returns: { picks: [{ id, offsetSec, reason }] }
//   offsetSec — signed adjustment to apply to t, 0 if the original frame was
//   already fine. reason — 'clean' | 'motion' | 'blur' | 'motion+blur' | 'no_data'
// ─────────────────────────────────────────────────────────────────────────────
const CUT_FRAME_FPS       = 15;   // ~66ms between samples — enough to dodge a blink
const CUT_FRAME_W         = 64;
const CUT_FRAME_H         = 36;
const CUT_FRAME_BYTES     = CUT_FRAME_W * CUT_FRAME_H; // gray8
const CUT_FRAME_MAX_BUF   = 30 * 1024 * 1024; // 30MB raw-frame safety cap
const CUT_FRAME_MAX_POINTS = 80;
const CUT_FRAME_MAX_OFFSET = 0.15; // never move a cut more than this

function frameMotionScore(buf, prevBuf) {
    if (!prevBuf) return 0;
    let sum = 0;
    for (let i = 0; i < CUT_FRAME_BYTES; i++) sum += Math.abs(buf[i] - prevBuf[i]);
    return sum / CUT_FRAME_BYTES / 255; // 0..1
}

function frameSharpnessScore(buf) {
    // Cheap edge-energy proxy: mean absolute difference between horizontally
    // adjacent pixels. Blur flattens local contrast, so this drops on blurry
    // frames without needing a real Laplacian/convolution pass.
    let sum = 0, n = 0;
    for (let y = 0; y < CUT_FRAME_H; y++) {
        const row = y * CUT_FRAME_W;
        for (let x = 1; x < CUT_FRAME_W; x++) {
            sum += Math.abs(buf[row + x] - buf[row + x - 1]);
            n++;
        }
    }
    return n ? (sum / n / 255) : 0; // 0..1
}

router.post('/refine-cut-frames', ...authOnly, async (req, res) => {
    const { filename, points = [] } = req.body || {};
    if (!filename) return res.status(400).json({ error: 'filename is required' });
    if (!Array.isArray(points) || points.length === 0) {
        return res.status(400).json({ error: 'points array is required' });
    }
    const requestUserId = resolveRequestUserId(req);

    const capped = points.slice(0, CUT_FRAME_MAX_POINTS).filter(p => p && typeof p.t === 'number' && p.t >= 0);
    if (capped.length === 0) return res.json({ picks: [] });

    try {
        const inputArg = await resolveFfmpegInputArg(filename, requestUserId);
        if (!inputArg) {
            return res.status(404).json({ error: `Could not locate source video: ${filename}` });
        }

        // Decode only the span the points actually cover, with headroom for the
        // ±0.15s search window on each end.
        const minT = Math.min(...capped.map(p => p.t));
        const maxT = Math.max(...capped.map(p => p.t));
        const windowStart = Math.max(0, minT - CUT_FRAME_MAX_OFFSET - 0.1);
        const windowDur   = Math.min(20 * 60, (maxT - minT) + 2 * (CUT_FRAME_MAX_OFFSET + 0.1)); // 20-min safety cap

        const rawBuf = await new Promise((resolve, reject) => {
            const args = [
                '-ss', windowStart.toFixed(3),
                '-i', inputArg,
                '-t', windowDur.toFixed(3),
                '-vf', `fps=${CUT_FRAME_FPS},scale=${CUT_FRAME_W}:${CUT_FRAME_H},format=gray`,
                '-f', 'rawvideo',
                '-pix_fmt', 'gray',
                'pipe:1',
            ];
            // stderr IS captured (unlike the write-only pipe below) — this endpoint
            // was shipping blind (stdio: [..., 'ignore']) and every production
            // failure came back as a bare 500 with no way to tell a missing binary
            // from a bad seek from a source that doesn't support HTTP range reads.
            const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
            const chunks = [];
            let total = 0;
            let settled = false;
            let stderrTail = '';

            const finish = (err, buf) => {
                if (settled) return;
                settled = true;
                clearTimeout(killTimer);
                if (err) reject(err); else resolve(buf);
            };

            // Raw phone .MOV uploads routinely put the moov atom at the END of the
            // file, which makes an -ss seek over a signed HTTP URL slow or outright
            // unsupported (server-side Range support varies). A single-frame grab
            // (extractVideoFrame) tolerates that; a multi-second window read here
            // doesn't always. Failing fast (8s, not 25s) matters because this runs
            // once per asset inside a job with a shared time budget (see
            // useJobStore's EXECUTING timeout) — a slow failure here shouldn't eat
            // a big chunk of it for what's a best-effort polish pass.
            const killTimer = setTimeout(() => {
                proc.kill('SIGKILL');
                finish(new Error(`refine-cut-frames: ffmpeg decode timed out. stderr: ${stderrTail.slice(-400)}`));
            }, 8_000);

            proc.stdout.on('data', chunk => {
                total += chunk.length;
                if (total > CUT_FRAME_MAX_BUF) {
                    proc.kill('SIGKILL');
                    finish(new Error('refine-cut-frames: decoded frame buffer exceeded safety cap'));
                    return;
                }
                chunks.push(chunk);
            });
            proc.stderr.on('data', chunk => { stderrTail = (stderrTail + chunk.toString()).slice(-2000); });
            proc.on('error', err => finish(new Error(`ffmpeg spawn failed: ${err.message}`)));
            proc.on('close', code => {
                if (code !== 0 && chunks.length === 0) {
                    finish(new Error(`ffmpeg exited ${code} with no frame data. stderr: ${stderrTail.slice(-400)}`));
                } else {
                    finish(null, Buffer.concat(chunks));
                }
            });
        });

        const frameCount = Math.floor(rawBuf.length / CUT_FRAME_BYTES);
        if (frameCount === 0) {
            return res.json({ picks: capped.map(p => ({ id: p.id, offsetSec: 0, reason: 'no_data' })) });
        }

        const frames = new Array(frameCount);
        for (let i = 0; i < frameCount; i++) {
            frames[i] = rawBuf.subarray(i * CUT_FRAME_BYTES, (i + 1) * CUT_FRAME_BYTES);
        }
        const motion    = frames.map((f, i) => frameMotionScore(f, i > 0 ? frames[i - 1] : null));
        const sharpness = frames.map(f => frameSharpnessScore(f));
        const sharpSorted = [...sharpness].sort((a, b) => a - b);
        const blurThreshold = sharpSorted[Math.floor(sharpSorted.length * 0.2)] ?? 0; // bottom 20% = blurry

        const frameTimeAt = (idx) => windowStart + idx / CUT_FRAME_FPS;
        const idxAt = (t) => Math.min(frameCount - 1, Math.max(0, Math.round((t - windowStart) * CUT_FRAME_FPS)));

        const STEP = 1 / CUT_FRAME_FPS;
        const picks = capped.map(p => {
            const baseIdx = idxAt(p.t);
            // Candidate offsets in frame-steps, clamped so the total shift never
            // exceeds CUT_FRAME_MAX_OFFSET.
            const maxSteps = Math.max(1, Math.floor(CUT_FRAME_MAX_OFFSET / STEP));
            const candidates = [];
            for (let d = -maxSteps; d <= maxSteps; d++) {
                const idx = baseIdx + d;
                if (idx < 0 || idx >= frameCount) continue;
                candidates.push({ idx, offsetSec: frameTimeAt(idx) - p.t });
            }
            if (candidates.length === 0) return { id: p.id, offsetSec: 0, reason: 'no_data' };

            let best = null;
            for (const c of candidates) {
                const m = motion[c.idx];
                const s = sharpness[c.idx];
                const blurry = s < blurThreshold;
                // Motion weighted higher than blur — a gesture mid-cut reads
                // worse than mild softness. Small bias toward offset 0 so we
                // don't drift the cut for a marginal improvement.
                const badness = m * 1.5 + (blurry ? 0.35 : 0) + Math.abs(c.offsetSec) * 0.1;
                if (!best || badness < best.badness) best = { ...c, badness, blurry, motion: m };
            }

            const originalBadness = (() => {
                const c = candidates.find(c => c.idx === baseIdx) || candidates[0];
                const blurry = sharpness[c.idx] < blurThreshold;
                return motion[c.idx] * 1.5 + (blurry ? 0.35 : 0);
            })();

            // Only move the cut if the best alternative is meaningfully better
            // than staying put — avoids churn on already-clean cuts.
            if (!best || best.idx === baseIdx || best.badness >= originalBadness - 0.05) {
                return { id: p.id, offsetSec: 0, reason: 'clean' };
            }
            const reason = best.motion > 0.12 && best.blurry ? 'motion+blur' : (best.motion > 0.12 ? 'motion' : 'blur');
            return {
                id: p.id,
                offsetSec: parseFloat(best.offsetSec.toFixed(3)),
                reason,
            };
        });

        const moved = picks.filter(p => p.offsetSec !== 0).length;
        console.log(`[interviewRoutes] refine-cut-frames: ${capped.length} point(s), ${frameCount} frames sampled, ${moved} nudged`);

        res.json({ picks });
    } catch (err) {
        console.error('[interviewRoutes] /refine-cut-frames error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/interview/identify-speakers
// Body: { words: [{word, start, end, speaker}], speakers: string[] }
//
// Analyzes speech patterns to assign roles to anonymous speaker labels.
// Looks at: question frequency, turn length, who speaks first, monologue ratio.
// Returns: { SPEAKER_00: { role: 'interviewer'|'guest', confidence: number } }
//
// Non-blocking — called after split_speakers to enrich the speakerMap.
// Falls back gracefully if GPT is unavailable or analysis is inconclusive.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/identify-speakers', ...authAndGate, async (req, res) => {
    try {
        const { words = [], speakers = [] } = req.body;

        if (!words.length || speakers.length < 2) {
            return res.status(400).json({ error: 'words and at least 2 speakers are required' });
        }

        if (!isAIConfigured()) {
            return res.status(503).json({ error: 'OPENAI_API_KEY not configured' });
        }

        // ── Compute per-speaker statistics for the prompt ──────────────────────
        const stats = {};
        for (const spk of speakers) {
            stats[spk] = { wordCount: 0, turnCount: 0, questionCount: 0, longestTurnWords: 0 };
        }

        // Group consecutive words into turns per speaker
        let curSpeaker = null;
        let curTurnWords = 0;

        for (const w of words) {
            const spk = w.speaker;
            if (!spk || !stats[spk]) continue;

            stats[spk].wordCount++;

            if (spk !== curSpeaker) {
                // Close previous turn
                if (curSpeaker && stats[curSpeaker]) {
                    stats[curSpeaker].turnCount++;
                    stats[curSpeaker].longestTurnWords = Math.max(stats[curSpeaker].longestTurnWords, curTurnWords);
                }
                curSpeaker = spk;
                curTurnWords = 1;
            } else {
                curTurnWords++;
            }

            // Simple question detection — ends with '?' or starts with a question word
            const text = (w.word || '').trim();
            if (text.endsWith('?') || /^(who|what|where|when|why|how|do|did|does|can|could|would|is|are|was|were|have|has)\b/i.test(text)) {
                stats[spk].questionCount++;
            }
        }
        // Close final turn
        if (curSpeaker && stats[curSpeaker]) {
            stats[curSpeaker].turnCount++;
            stats[curSpeaker].longestTurnWords = Math.max(stats[curSpeaker].longestTurnWords, curTurnWords);
        }

        // ── Build a compact summary for GPT ───────────────────────────────────
        // Sample 200 chars of each speaker's actual words so GPT can read speech style
        const samples = {};
        for (const spk of speakers) {
            const spkWords = words.filter(w => w.speaker === spk).map(w => w.word).join(' ');
            samples[spk] = spkWords.slice(0, 200);
        }

        const statLines = speakers.map(spk => {
            const s = stats[spk];
            return `${spk}: ${s.wordCount} words, ${s.turnCount} turns, ${s.questionCount} questions, longest turn ${s.longestTurnWords} words\nSample: "${samples[spk]}"`;
        }).join('\n\n');

        const OpenAI = require('openai');
        const openai = getAIClient({ timeout: 15_000 });

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{
                role: 'user',
                content:
`Analyze these two speakers from an interview/podcast and identify who is the interviewer (asks questions, shorter turns) vs the guest (gives long answers, monologues).

${statLines}

Return ONLY valid JSON:
{
  "${speakers[0]}": { "role": "interviewer"|"guest", "confidence": 0.0-1.0 },
  "${speakers[1]}": { "role": "interviewer"|"guest", "confidence": 0.0-1.0 }
}

Rules:
- If one speaker has significantly more questions, they are the interviewer
- If one speaker has much longer average turns, they are the guest
- Roles must be different — assign one interviewer and one guest
- If truly indistinguishable, set confidence to 0.5 for both`,
            }],
            response_format: { type: 'json_object' },
            temperature: 0,
            max_tokens: 120,
        });

        const parsed = JSON.parse(completion.choices[0].message.content);

        // Validate structure
        const result = {};
        for (const spk of speakers) {
            const r = parsed[spk];
            if (r?.role && ['interviewer', 'guest'].includes(r.role)) {
                result[spk] = { role: r.role, confidence: Math.min(1, Math.max(0, r.confidence || 0.7)) };
            }
        }

        // Fallback: if GPT output was malformed, default by word count (more words = guest)
        if (Object.keys(result).length < 2) {
            const sorted = [...speakers].sort((a, b) => (stats[b]?.wordCount || 0) - (stats[a]?.wordCount || 0));
            result[sorted[0]] = { role: 'guest',       confidence: 0.5 };
            result[sorted[1]] = { role: 'interviewer', confidence: 0.5 };
        }

        console.log('[interviewRoutes] identify-speakers result:', JSON.stringify(result));
        res.json(result);

    } catch (err) {
        console.error('[interviewRoutes] /identify-speakers error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

// Pure helpers exported for regression testing (scripts/test_organize_v2.js).
// Attached to the router rather than replacing module.exports so every existing
// `require('./routes/interviewRoutes')` mount site keeps working unchanged.
module.exports._buildOrganizeDescriptors = buildOrganizeDescriptors;
module.exports._describeAssetProfile     = describeAssetProfile;
module.exports._ASSET_ANALYSIS_DONE      = ASSET_ANALYSIS_DONE;
