const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { audioQueue } = require('../queue/queues');
const { authenticateUser } = require('../middleware/auth');
const { aiGate } = require('../middleware/usageGate');
const storageConfig = require('../config/storage');
const rateLimit = require('express-rate-limit');
const { getAIClient, isAIConfigured, resolveModel } = require('../services/AIProvider');

/**
 * POST /api/captions/generate
 * Transcribes the video with Whisper and returns word-level timestamps.
 * The client polls /api/jobs/:jobId for the result, which is:
 *   { text: string, words: [{ word, start, end }] }
 */
router.post('/generate', authenticateUser, aiGate, async (req, res) => {
    try {
        const { filename, language = 'en' } = req.body;

        if (!filename || typeof filename !== 'string') {
            return res.status(400).json({ error: 'filename is required' });
        }

        const uploadsDir = path.resolve(__dirname, '../uploads');
        const normalizedFilename = filename.startsWith('/') ? filename.slice(1) : filename;
        let filePath = path.resolve(uploadsDir, normalizedFilename);

        if (!filePath.startsWith(uploadsDir)) {
            const tempPath = path.resolve(uploadsDir, 'temp', path.basename(normalizedFilename));
            if (tempPath.startsWith(uploadsDir)) {
                filePath = tempPath;
            } else {
                return res.status(403).json({ error: 'Access denied: invalid file path' });
            }
        }

        if (!fs.existsSync(filePath)) {
            const tempPath = path.resolve(uploadsDir, 'temp', path.basename(normalizedFilename));
            if (fs.existsSync(tempPath)) {
                filePath = tempPath;   // found in temp/ subdir — use it
            } else {
                // File missing locally. In production the worker will download from GCS.
                // In dev, fail fast so the error is visible.
                if (storageConfig.bucket && !storageConfig.useLocalStorage) {
                    console.warn(`[captionRoutes] File not found locally (${filePath}); worker will attempt GCS download.`);
                } else {
                    return res.status(404).json({ error: `File not found: ${filename}` });
                }
            }
        }

        const userId = req.user?.id || null;
        const uniqueJobId = `caption-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
        // Preserve the GCS-relative prefix (e.g. "raw/{userId}/...") so workers can
        // construct the correct GCS download path without guessing the userId.
        const jobFilename = normalizedFilename.startsWith('raw/') || normalizedFilename.startsWith('temp/')
            ? normalizedFilename
            : path.basename(filePath);
        const job = await audioQueue.add('transcribe-audio', {
            action: 'transcribe',
            filename: jobFilename,
            filePath,
            userId,
            language,
        }, {
            jobId: uniqueJobId,
            attempts: 4,
            backoff: { type: 'exponential', delay: 10_000 }, // 10s, 20s, 40s between retries
            removeOnComplete: { age: 3600 }, // keep result for 1h so polling always finds it
            removeOnFail: { age: 3600 },
        });

        res.json({ jobId: job.id, status: 'queued' });

    } catch (err) {
        console.error('[captionRoutes] /generate error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─── POST /api/captions/keywords (R88, to-do A2) ────────────────────────────
// LLM fallback for keyword emphasis. The client picks keywords with free JS
// rules first (CaptionModel.pickKeywords) and only sends the phrases where the
// top candidates were too close to call. Runs on the configured free provider
// (Groq/Gemini, R84). It does not count against the user's monthly AI
// operations: it is a small assist on an edit the rules already made, and the
// client keeps the rule pick whenever this fails.
const keywordsLimiter = rateLimit({
    windowMs: 60_000, max: 10,
    standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many keyword requests. Please wait a moment.' },
});

const MAX_PHRASES = 60;
const MAX_PHRASE_CHARS = 240;

router.post('/keywords', authenticateUser, keywordsLimiter, async (req, res) => {
    const phrases = Array.isArray(req.body?.phrases) ? req.body.phrases : null;
    if (!phrases || phrases.length === 0) return res.status(400).json({ error: 'phrases must be a non-empty array' });
    if (phrases.length > MAX_PHRASES) return res.status(400).json({ error: `at most ${MAX_PHRASES} phrases per request` });

    const clean = [];
    for (const ph of phrases) {
        const id = typeof ph?.id === 'string' ? ph.id.slice(0, 80) : null;
        const text = typeof ph?.text === 'string' ? ph.text.slice(0, MAX_PHRASE_CHARS) : '';
        if (!id || !text.trim()) continue;
        clean.push({ id, words: text.split(' ').filter(Boolean) });
    }
    if (clean.length === 0) return res.status(400).json({ error: 'no usable phrases' });

    if (!isAIConfigured()) return res.status(503).json({ error: 'AI provider not configured', fallback: true });

    try {
        const client = getAIClient({ capability: 'chat' });
        const listing = clean
            .map(c => `[id: ${c.id}] ${c.words.map((w, i) => `${i}:${w}`).join(' ')}`)
            .join('\n');
        const response = await client.chat.completions.create({
            model: resolveModel('gpt-4o-mini', 'chat'),
            max_tokens: 800,
            response_format: { type: 'json_object' },
            messages: [
                {
                    role: 'system',
                    content: 'You pick the single most important word in short video captions, the word a creator would '
                        + 'highlight on screen: the number, the outcome, the surprising or emotional word. Never a filler or '
                        + 'function word. Captions may be French or English. Words are given as index:word. '
                        + 'Answer JSON only: {"picks":[{"id":"<id>","index":<number>}]} with one pick per caption.',
                },
                { role: 'user', content: listing },
            ],
        });
        const raw = response?.choices?.[0]?.message?.content || '{}';
        let parsed;
        try { parsed = JSON.parse(raw); } catch (_) { parsed = {}; }
        const byId = new Map(clean.map(c => [c.id, c.words.length]));
        const picks = (Array.isArray(parsed.picks) ? parsed.picks : [])
            .map(p => ({ id: String(p?.id || ''), index: Number(p?.index) }))
            .filter(p => byId.has(p.id) && Number.isInteger(p.index) && p.index >= 0 && p.index < byId.get(p.id));
        return res.json({ picks });
    } catch (err) {
        console.error('[captionRoutes] /keywords error:', err.message);
        return res.status(502).json({ error: 'keyword service unavailable', fallback: true });
    }
});

module.exports = router;
