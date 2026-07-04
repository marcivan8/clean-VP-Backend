const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const path = require('path');
const fs = require('fs');
const { detectBeats } = require('../analysis/beatDetector');
const { OpenAI } = require('openai');
const storageConfig = require('../config/storage');

ffmpeg.setFfmpegPath(ffmpegPath);

let openaiInstance = null;
function getOpenAI() {
    if (!openaiInstance) {
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY environment variable is missing.');
        }
        openaiInstance = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            timeout: 300_000, // 5-min per request — Whisper on long videos can be slow
            maxRetries: 0,    // BullMQ handles job-level retries; let 429s surface immediately
        });
    }
    return openaiInstance;
}

/**
 * Returns true if an OpenAI error is a quota/rate-limit error that
 * should NOT be retried (the key is exhausted, not temporarily busy).
 */
function isQuotaExhausted(err) {
    return err?.status === 429 &&
        (err?.code === 'insufficient_quota' || err?.type === 'insufficient_quota');
}

const WHISPER_LIMIT = 25 * 1024 * 1024; // 25 MB

/**
 * Upload a processed audio/video file to GCS (or local fallback) and return
 * a server-proxied URL that works in any deployment topology.
 * Deletes the local temp file afterwards.
 */
async function uploadProcessedAudio(localFilePath, userId, prefix) {
    const { bucket, useLocalStorage } = storageConfig;
    const basename = path.basename(localFilePath);
    const destPath = `processed/${userId || 'anonymous'}/${prefix}-${basename}`;

    try {
        if (!useLocalStorage && bucket) {
            await bucket.upload(localFilePath, {
                destination: destPath,
                metadata: { cacheControl: 'no-store' },
            });
            try { await bucket.file(destPath).makePublic(); } catch (_) { /* uniform-ACL bucket */ }
            return `/api/proxy/gcs-media/${destPath}`;
        } else {
            // Local fallback: keep the file where it is — Express already serves /uploads
            return `/uploads/audio_temp/${basename}`;
        }
    } finally {
        // Clean up local temp file (best-effort) — the canonical copy is now on GCS
        if (!useLocalStorage && bucket) {
            try { fs.unlinkSync(localFilePath); } catch (_) { /* ignore */ }
        }
    }
}

/**
 * Extracts a mono 16kHz MP3 from any video/audio file.
 * The result is always well under 25 MB for typical video lengths.
 * Caller is responsible for deleting the returned temp file.
 */
async function extractAudioForWhisper(inputPath, tempDir) {
    const outPath = path.join(tempDir, `whisper_audio_${Date.now()}.mp3`);
    await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .noVideo()
            // dynaudnorm: single-pass streaming normalizer — no full-file buffering unlike loudnorm.
            // Saves 3-5s on short clips (loudnorm is an offline integrated-loudness algorithm).
            .audioFilters('dynaudnorm=f=150:g=15')
            .audioCodec('libmp3lame')
            .audioChannels(1)
            .audioFrequency(16000)
            .audioBitrate('64k')
            .format('mp3')
            .output(outPath)
            .on('end', resolve)
            .on('error', (err, stdout, stderr) => {
                console.error('[extractAudioForWhisper] FFmpeg error:', err.message);
                console.error('[extractAudioForWhisper] FFmpeg stderr:', stderr);
                reject(err);
            })
            .run();
    });
    return outPath;
}

// ── Micro-padding (same logic as silenceProcessor) ──────────────────────────────────────
function applyPaddingToSegments(segments, padding, totalDuration) {
    if (!padding || padding <= 0) return segments;
    return segments.map(seg => ({
        start:    Math.max(0, seg.start - padding),
        end:      Math.min(totalDuration || Infinity, seg.end + padding),
        duration: Math.min(totalDuration || Infinity, seg.end + padding) - Math.max(0, seg.start - padding),
    }));
}

// ── GPT-4o semantic filler analysis ──────────────────────────────────────────────────
// Sends the full word-timestamp list to GPT-4o and gets back a list of ranges
// to cut, with per-range confidence scores (0–1). Cuts with confidence >= 0.75
// are applied; lower-confidence cuts are silently skipped (conservative).
async function gptSemanticFillerAnalysis(words, openai) {
    // Build a compact representation: index, start, end, word
    const wordList = words.map((w, i) => ({
        i,
        s: parseFloat((w.start || 0).toFixed(3)),
        e: parseFloat((w.end   || 0).toFixed(3)),
        w: w.word,
    }));

    const prompt = `You are an expert video editor. Below is a word-level transcript with timestamps.

Your task: identify time ranges that should be CUT from the final video.

Identify and mark as CUT:
1. Genuine filler words/phrases that add NO meaning in context:
   - "um", "uh", "ah", "er", "hmm" — almost always fillers
   - "like", "you know", "I mean", "kind of", "sort of", "basically", "literally" — ONLY when used as hesitation padding, not as meaningful content
     Example CUT: "you know, like, the thing is..."
     Example KEEP: "do you know what I mean?" or "I like this idea"
2. Immediate word repetitions that are NOT for emphasis:
   - "I I wanted" → CUT the duplicate "I"
   - "the the thing" → CUT the duplicate "the"
   - "really really important" → KEEP (intentional emphasis)
3. Clear false starts where the speaker restarts a sentence:
   - "I was going to — anyway, the point is" → CUT everything up to the restart
4. Pauses between complete thoughts (gap >= 0.5s between words) that interrupt flow → CUT the gap

DO NOT CUT:
- Content said only once, even if imperfect
- Intentional callbacks or repetition for emphasis
- Anything you are not confident about (confidence < 0.75)
- Never cut mid-sentence unless it is a clear false start

Words (JSON array with index i, start s, end e, word w):
${JSON.stringify(wordList)}

Respond ONLY with valid JSON:
{
  "cuts": [
    { "start": <float>, "end": <float>, "reason": "<short reason>", "confidence": <0.0-1.0> }
  ]
}`;

    try {
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
            temperature: 0.1,
            max_tokens: 4096,
        }, { timeout: 45_000 });

        const parsed = JSON.parse(completion.choices[0].message.content);
        const cuts = (parsed.cuts || []).filter(c =>
            typeof c.start === 'number' &&
            typeof c.end   === 'number' &&
            c.end > c.start &&
            (c.confidence ?? 1) >= 0.75
        );
        console.log(`[gptSemanticFiller] GPT-4o returned ${parsed.cuts?.length || 0} cuts, ${cuts.length} above confidence threshold`);
        return cuts;
    } catch (err) {
        if (isQuotaExhausted(err)) {
            console.warn('[gptSemanticFiller] OpenAI quota exhausted — using keyword fallback immediately');
        } else {
            console.warn('[gptSemanticFiller] GPT-4o call failed, using keyword fallback:', err.message);
        }
        return null; // triggers fallback
    }
}

// ── Keyword-set fallback (original logic, preserved) ──────────────────────────────────────
function keywordFillerSpans(words) {
    const FILLER_WORDS = new Set([
        'um', 'uh', 'ah', 'er', 'eh', 'hmm', 'hm',
        'like', 'basically', 'literally',
        'you know', 'i mean', 'kind of', 'sort of',
        'euh', 'ben', 'genre', 'voilà', 'bah',
    ]);
    const MERGE_GAP = 0.15;
    const spans = [];
    let current = null;

    for (const w of words) {
        const token = w.word.toLowerCase().replace(/[^a-zàâéèêëîïôùûüç ]/g, '').trim();
        const isFiller = FILLER_WORDS.has(token);

        if (isFiller) {
            if (current && w.start - current.end <= MERGE_GAP) {
                current.end = w.end;
            } else {
                if (current) spans.push(current);
                current = { start: w.start, end: w.end };
            }
        } else {
            if (current) { spans.push(current); current = null; }
        }
    }
    if (current) spans.push(current);
    return spans;
}

// ── Build activeSegments by inverting cut spans ──────────────────────────────────────────────
function invertCutsToSegments(cutSpans, totalDuration) {
    // Sort cut spans ascending
    const sorted = [...cutSpans].sort((a, b) => a.start - b.start);
    const active = [];
    let cursor = 0;

    for (const span of sorted) {
        if (span.start > cursor + 0.01) {
            active.push({ start: cursor, end: span.start, duration: span.start - cursor });
        }
        cursor = Math.max(cursor, span.end);
    }
    if (cursor < totalDuration - 0.01) {
        active.push({ start: cursor, end: totalDuration, duration: totalDuration - cursor });
    }
    return active;
}

async function detectFillerWords(inputPath, language = 'en', tempDir = null, preExistingTranscript = null, paddingMs = 100) {
    const PADDING = paddingMs / 1000;

    let tempAudio = null;
    let words;
    let totalDuration;
    let transcriptText = '';

    if (preExistingTranscript && preExistingTranscript.length > 0) {
        console.log(`[detectFillerWords] Using provided transcript (${preExistingTranscript.length} words) — skipping Whisper`);
        words = preExistingTranscript;
        totalDuration = words[words.length - 1].end || 0;
    } else {
        if (!tempDir) throw new Error('tempDir required to extract audio');
        console.log(`[detectFillerWords] Extracting audio for Whisper...`);
        tempAudio = await extractAudioForWhisper(inputPath, tempDir);
        const whisperPath = tempAudio;

        const openai = getOpenAI();
        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(whisperPath),
            model: 'whisper-1',
            response_format: 'verbose_json',
            timestamp_granularities: ['word'],
            language: language === 'auto' ? undefined : language,
        });

        words = transcription.words || [];
        totalDuration = transcription.duration || (words.length ? words[words.length - 1].end : 0);
        transcriptText = transcription.text || '';
    }

    try {
        let cutSpans;

        // ── Stage B: GPT-4o semantic analysis (primary path) ──────────────────────
        let usedGPT = false;
        try {
            const openai = getOpenAI();
            const gptCuts = await gptSemanticFillerAnalysis(words, openai);
            if (gptCuts !== null) {
                cutSpans  = gptCuts;
                usedGPT   = true;
                console.log(`[detectFillerWords] 🤖 GPT-4o semantic pass: ${cutSpans.length} cuts identified`);
            }
        } catch (gptErr) {
            console.warn('[detectFillerWords] GPT-4o unavailable, using keyword fallback:', gptErr.message);
        }

        // ── Keyword fallback ────────────────────────────────────────────────────────────
        if (!usedGPT) {
            cutSpans = keywordFillerSpans(words);
            console.log(`[detectFillerWords] 📝 Keyword fallback: ${cutSpans.length} filler spans identified`);
        }

        const activeSegments = invertCutsToSegments(cutSpans, totalDuration);
        const paddedSegments = applyPaddingToSegments(activeSegments, PADDING, totalDuration);

        return {
            fillerCount:      cutSpans.length,
            removedSegments:  cutSpans.map(s => ({ ...s, duration: s.end - s.start })),
            activeSegments:   paddedSegments,
            transcript:       transcriptText,
            totalDuration,
            method: usedGPT ? 'gpt4o-semantic' : 'keyword-fallback',
        };
    } finally {
        if (tempAudio && fs.existsSync(tempAudio)) fs.unlinkSync(tempAudio);
    }
}

module.exports = async function processAudioJob(job) {
    const { action, filename, filePath, userId, language } = job.data;

    // Resolve paths
    const uploadsDir = path.resolve(__dirname, '../uploads');
    const publicDir = path.resolve(__dirname, '../client/public');
    const tempDir = path.join(uploadsDir, 'audio_temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    // Delegate silence-detect to silenceProcessor
    if (action === 'silence-detect') {
        const processSilenceJob = require('./silenceProcessor');
        return processSilenceJob(job);
    }

    let inputPath = filePath;
    if (filename && !inputPath) {
        const normalizedFilename = filename.startsWith('/') ? filename.slice(1) : filename;
        inputPath = path.resolve(uploadsDir, normalizedFilename);

        if (!fs.existsSync(inputPath)) {
            inputPath = path.resolve(uploadsDir, 'temp', path.basename(filename));
        }
        if (!fs.existsSync(inputPath)) {
            inputPath = path.resolve(publicDir, normalizedFilename);
        }
    }

    if (!inputPath || (!inputPath.startsWith(uploadsDir) && !inputPath.startsWith(publicDir))) {
        throw new Error('Access denied: invalid file path');
    }

    // GCS fallback for distributed environments (e.g. separate Railway worker service)
    if (!fs.existsSync(inputPath)) {
        const storageConfig = require('../config/storage');
        if (storageConfig.bucket && filename && (userId || filename.startsWith('raw/'))) {
            console.log(`[Job ${job.id}] Local file missing, downloading from GCS...`);
            const gcsPath = filename.startsWith('raw/') ? filename : `raw/${userId}/${path.basename(filename)}`;
            const dir = path.dirname(inputPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            try {
                await storageConfig.bucket.file(gcsPath).download({ destination: inputPath });
                console.log(`[Job ${job.id}] Downloaded from GCS: ${gcsPath}`);
            } catch (err) {
                throw new Error(`File not found locally and GCS download failed: ${err.message}`);
            }
        } else {
            throw new Error(`File not found: ${filename || filePath}`);
        }
    }

    await job.updateProgress(10);

    switch (action) {
        case 'denoise': {
            console.log(`[Job ${job.id}] 🎧 Denoising: ${inputPath}`);
            const outputPath = path.join(tempDir, `denoised-${Date.now()}.mp4`);
            await new Promise((resolve, reject) => {
                ffmpeg(inputPath)
                    .audioFilters('afftdn=nf=-25')
                    .videoCodec('copy')
                    .output(outputPath)
                    .on('progress', (p) => p.percent && job.updateProgress(10 + p.percent * 0.8))
                    .on('end', resolve)
                    .on('error', reject)
                    .run();
            });
            await job.updateProgress(95);
            const denoiseUrl = await uploadProcessedAudio(outputPath, userId, 'denoised');
            await job.updateProgress(100);
            return { url: denoiseUrl, message: "Noise reduction applied successfully." };
        }

        case 'normalize': {
            console.log(`[Job ${job.id}] 🔊 Normalizing Audio for: ${inputPath}`);
            const outputPath = path.join(tempDir, `normalized-${Date.now()}.mp4`);
            await new Promise((resolve, reject) => {
                ffmpeg(inputPath)
                    .audioFilters('loudnorm=I=-16:TP=-1.5:LRA=11')
                    .videoCodec('copy')
                    .output(outputPath)
                    .on('progress', (p) => p.percent && job.updateProgress(10 + p.percent * 0.8))
                    .on('end', resolve)
                    .on('error', reject)
                    .run();
            });
            await job.updateProgress(95);
            const normalizeUrl = await uploadProcessedAudio(outputPath, userId, 'normalized');
            await job.updateProgress(100);
            return { url: normalizeUrl, message: "Audio normalized to -16 LUFS." };
        }

        case 'beat-detect': {
            console.log(`[Job ${job.id}] 🥁 Detecting Beats for: ${inputPath}`);
            const result = await detectBeats(inputPath);
            await job.updateProgress(100);
            return result;
        }

        case 'transcribe': {
            console.log(`[Job ${job.id}] 🎤 Transcribing with Whisper: ${inputPath}`);
            let tTempAudio = null;
            
            console.log(`[Job ${job.id}] Extracting audio for Whisper to ensure compatibility and speed...`);
            tTempAudio = await extractAudioForWhisper(inputPath, tempDir);
            let tWhisperPath = tTempAudio;
            
            try {
                const openai = getOpenAI();
                let transcription;
                try {
                    transcription = await openai.audio.transcriptions.create({
                        file: fs.createReadStream(tWhisperPath),
                        model: 'whisper-1',
                        prompt: 'This is a video transcript. The speech might be faint, or there may be long pauses.',
                        response_format: 'verbose_json',
                        timestamp_granularities: ['word', 'segment']
                    });
                } catch (whisperErr) {
                    if (isQuotaExhausted(whisperErr)) {
                        const fatal = new Error(
                            'OpenAI quota exceeded — captions cannot be generated until the API key is recharged. ' +
                            'Please top up at https://platform.openai.com/settings/billing'
                        );
                        fatal.unrecoverable = true;
                        throw fatal;
                    }
                    throw whisperErr;
                }
                await job.updateProgress(100);
                // Some Whisper API versions return words at top level; others nest them inside segments
                const topWords = transcription.words || [];
                const segWords = (transcription.segments || []).flatMap(s => s.words || []);
                const words = topWords.length > 0 ? topWords : segWords;
                console.log(`[Job ${job.id}] 📝 Transcription complete: ${words.length} words`);
                return { text: transcription.text, words };
            } finally {
                if (tTempAudio && fs.existsSync(tTempAudio)) fs.unlinkSync(tTempAudio);
            }
        }

        case 'filler-detect': {
            console.log(`[Job ${job.id}] 🔤 Filler detection: ${inputPath}`);
            const result = await detectFillerWords(inputPath, language || 'en', tempDir, job.data.transcript || null);
            await job.updateProgress(100);
            return result;
        }

        case 'diarize': {
            const AssemblyAIService = require('../services/AssemblyAIService');
            const DiarizeService    = require('../services/DiarizeService');

            if (!AssemblyAIService.isAvailable && !DiarizeService.isAvailable) {
                throw new Error(
                    'No diarization service configured — set ASSEMBLYAI_API_KEY (recommended) or DIARIZE_SERVICE_URL'
                );
            }

            await job.updateProgress(5);

            let result = null;

            // ── PRIMARY: AssemblyAI ──────────────────────────────────────────────
            if (AssemblyAIService.isAvailable) {
                console.log(`[Job ${job.id}] 🎙️ Diarization via AssemblyAI: ${inputPath}`);
                try {
                    result = await AssemblyAIService.diarize(inputPath, language || null);
                    console.log(`[Job ${job.id}] ✅ AssemblyAI: ${result.words.length} words, ${result.speakers.length} speakers`);
                } catch (aaiErr) {
                    console.error(`[Job ${job.id}] ⚠️ AssemblyAI failed (${aaiErr.message}) — trying pyannote fallback`);
                    result = null;
                }
            }

            // ── FALLBACK: pyannote / WhisperX self-hosted ────────────────────────
            if (!result) {
                if (!DiarizeService.isAvailable) {
                    throw new Error(
                        'AssemblyAI diarization failed and DIARIZE_SERVICE_URL is not configured — no fallback available'
                    );
                }
                console.log(`[Job ${job.id}] 🎙️ Diarization via pyannote (fallback): ${inputPath}`);

                // Extract a mono 16 kHz WAV for WhisperX
                const wavPath = path.join(tempDir, `diarize-${job.id}.wav`);
                await new Promise((resolve, reject) => {
                    ffmpeg(inputPath)
                        .audioChannels(1)
                        .audioFrequency(16000)
                        .format('wav')
                        .output(wavPath)
                        .on('end', resolve)
                        .on('error', reject)
                        .run();
                });

                await job.updateProgress(15);

                try {
                    result = await DiarizeService.diarize(wavPath, language || null);
                    console.log(`[Job ${job.id}] ✅ pyannote: ${result.words.length} words, ${result.speakers.length} speakers`);
                } finally {
                    if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
                }
            }

            await job.updateProgress(100);
            return result;
        }

        // ── interview-analyze ─────────────────────────────────────────────────
        case 'interview-analyze': {
            console.log(`[Job ${job.id}] 🎙️ Interview analysis: ${inputPath}`);

            // ── 1. Extract audio ──────────────────────────────────────────────
            await job.updateProgress(5);
            let iaTempAudio = null;
            let words = [];

            try {
                iaTempAudio = await extractAudioForWhisper(inputPath, tempDir);
                await job.updateProgress(20);

                // ── 2. Transcribe with Whisper (word-level) ───────────────────
                const openai = getOpenAI();
                let whisperPath = iaTempAudio;

                // Split if over 25 MB (same approach as transcribe case)
                const fileSize = fs.statSync(whisperPath).size;
                if (fileSize > WHISPER_LIMIT) {
                    console.log(`[Job ${job.id}] Audio is ${(fileSize/1024/1024).toFixed(1)} MB — over 25 MB limit, chunking...`);
                    // Extract first 10 minutes as a single chunk for now
                    // (full chunking is in the transcribe case; interview videos are typically shorter)
                    const chunkPath = path.join(tempDir, `ia_chunk_${job.id}.mp3`);
                    await new Promise((resolve, reject) => {
                        ffmpeg(whisperPath)
                            .setDuration(600)
                            .output(chunkPath)
                            .on('end', resolve)
                            .on('error', reject)
                            .run();
                    });
                    if (iaTempAudio) { try { fs.unlinkSync(iaTempAudio); } catch(_) {} }
                    iaTempAudio = chunkPath;
                    whisperPath = chunkPath;
                }

                await job.updateProgress(25);

                const transcription = await openai.audio.transcriptions.create({
                    file:             fs.createReadStream(whisperPath),
                    model:            'whisper-1',
                    language:         language || undefined,
                    response_format:  'verbose_json',
                    timestamp_granularities: ['word'],
                });

                await job.updateProgress(65);

                // Normalise word list — some Whisper versions nest under segments
                if (transcription.words?.length) {
                    words = transcription.words;
                } else if (transcription.segments?.length) {
                    for (const seg of transcription.segments) {
                        if (seg.words?.length) words.push(...seg.words);
                    }
                }
                console.log(`[Job ${job.id}] Whisper returned ${words.length} words`);

            } finally {
                if (iaTempAudio) { try { fs.unlinkSync(iaTempAudio); } catch(_) {} }
            }

            if (!words.length) {
                return {
                    words: [],
                    fillers: [],
                    pauses: [],
                    segments: { no_fillers: [], no_dead_air: [], clean: [] },
                    summary: { totalDuration: 0, fillerCount: 0, deadAirCount: 0, deadAirSaved: 0, thinkingCount: 0 },
                };
            }

            // ── 3. Pause classification ───────────────────────────────────────
            // Classify gaps between consecutive words.
            // < 0.3 s  → micro-pause  (skip — too short to notice)
            // 0.3–1.2 s → thinking    (flag for user review)
            // > 1.2 s  → dead_air     (suggest removal)

            const MICRO  = 0.3;
            const THINK  = 1.2;
            const pauses = [];

            for (let i = 1; i < words.length; i++) {
                const gap = words[i].start - words[i - 1].end;
                if (gap < MICRO) continue;
                pauses.push({
                    start:    words[i - 1].end,
                    end:      words[i].start,
                    duration: gap,
                    type:     gap > THINK ? 'dead_air' : 'thinking',
                });
            }

            // ── 4. Filler-word detection (keyword) ────────────────────────────
            const FILLER_SET = new Set([
                'um', 'uh', 'ah', 'er', 'eh', 'hmm', 'hm',
                'like', 'basically', 'literally',
                'euh', 'ben', 'genre', 'voilà', 'bah',
            ]);
            const FILLER_PHRASES = ['you know', 'i mean', 'kind of', 'sort of', 'you see'];

            const fillers = [];
            const fillerIndices = new Set();

            // Single-word fillers
            for (let i = 0; i < words.length; i++) {
                const token = words[i].word.toLowerCase().replace(/[^a-zàâéèêëîïôùûüç]/g, '').trim();
                if (FILLER_SET.has(token)) {
                    fillers.push({ start: words[i].start, end: words[i].end, word: words[i].word.trim() });
                    fillerIndices.add(i);
                }
            }

            // Multi-word filler phrases
            for (let i = 0; i < words.length - 1; i++) {
                const bigram = (words[i].word + ' ' + words[i+1].word).toLowerCase().replace(/[^a-z ]/g, '').trim();
                if (FILLER_PHRASES.includes(bigram)) {
                    // Remove single-word entries we already added for these indices
                    fillerIndices.add(i); fillerIndices.add(i + 1);
                    fillers.push({ start: words[i].start, end: words[i+1].end, word: bigram });
                }
            }

            await job.updateProgress(80);

            // ── 5. Build activeSegment sets ───────────────────────────────────
            // Given a list of { start, end } "cut" ranges, build the inverse
            // (keep ranges) from words[0].start to words[last].end.

            const PADDING    = 0.08; // 80 ms breathing room on each side of a cut
            const totalStart = words[0].start;
            const totalEnd   = words[words.length - 1].end;

            function buildKeepSegments(cutRanges) {
                // Merge overlapping cuts, then invert
                const sorted = [...cutRanges].sort((a, b) => a.start - b.start);
                const merged = [];
                for (const c of sorted) {
                    if (merged.length && c.start <= merged[merged.length - 1].end) {
                        merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, c.end);
                    } else {
                        merged.push({ ...c });
                    }
                }

                const keep = [];
                let cursor = totalStart;
                for (const cut of merged) {
                    const s = Math.max(cursor, cut.start - PADDING);
                    const e = Math.min(totalEnd, cut.end + PADDING);
                    if (s > cursor + 0.05) {
                        keep.push({ start: cursor, end: s, duration: s - cursor });
                    }
                    cursor = e;
                }
                if (cursor < totalEnd - 0.05) {
                    keep.push({ start: cursor, end: totalEnd, duration: totalEnd - cursor });
                }
                return keep;
            }

            const fillerCuts   = fillers.map(f => ({ start: f.start, end: f.end }));
            const deadAirCuts  = pauses.filter(p => p.type === 'dead_air').map(p => ({ start: p.start, end: p.end }));

            const segsNoFillers  = buildKeepSegments(fillerCuts);
            const segsNoDeadAir  = buildKeepSegments(deadAirCuts);
            const segsClean      = buildKeepSegments([...fillerCuts, ...deadAirCuts]);

            await job.updateProgress(100);

            const deadAirSaved = pauses
                .filter(p => p.type === 'dead_air')
                .reduce((sum, p) => sum + p.duration, 0);

            console.log(
                `[Job ${job.id}] ✅ Interview analysis done — ` +
                `${words.length} words, ${fillers.length} fillers, ` +
                `${pauses.filter(p => p.type === 'dead_air').length} dead-air gaps ` +
                `(${deadAirSaved.toFixed(1)}s), ` +
                `${pauses.filter(p => p.type === 'thinking').length} thinking pauses`
            );

            return {
                words,
                fillers,
                pauses,
                segments: {
                    no_fillers:  segsNoFillers,
                    no_dead_air: segsNoDeadAir,
                    clean:       segsClean,
                },
                summary: {
                    totalDuration:   totalEnd - totalStart,
                    fillerCount:     fillers.length,
                    deadAirCount:    pauses.filter(p => p.type === 'dead_air').length,
                    deadAirSaved:    parseFloat(deadAirSaved.toFixed(1)),
                    thinkingCount:   pauses.filter(p => p.type === 'thinking').length,
                },
            };
        }

        // ── rhythm-zoom ───────────────────────────────────────────────────────
        // Generates a scale-keyframe zoom rhythm for single-camera talking-head
        // videos, simulating a multi-camera feel.
        //
        // Algorithm:
        //  1. Extract per-second audio loudness (EBU R128) via FFmpeg
        //  2. Group the transcript into phrases (gaps > 0.35 s)
        //  3. Ask GPT-4o to score each phrase for emotional intensity
        //  4. Combine loudness + semantic score → target zoom scale per phrase
        //  5. Enforce rhythm constraints (min shot duration, max step size)
        //  6. Return zoom events ready for addTransformKeyframe()
        case 'rhythm-zoom': {
            const { words: providedWords = [], style = 'dynamic' } = job.data;

            console.log(`[Job ${job.id}] 🎥 Rhythm-zoom analysis: ${inputPath} style=${style}`);
            await job.updateProgress(5);

            // ── 1. Audio energy via FFmpeg EBU R128 ──────────────────────────
            // Output: [{ time, loudness }] in LUFS (momentary, every ~400ms)
            const audioEnergy = await new Promise(resolve => {
                const samples = [];
                ffmpeg(inputPath)
                    .audioFilters('ebur128=framelog=verbose')
                    .format('null')
                    .output('-')
                    .on('stderr', line => {
                        // Lines: "t: 2.4000 M: -21.3 S: ..."
                        const m = line.match(/t:\s*([\d.]+)\s+M:\s*(-?[\d.]+)/);
                        if (m) samples.push({ time: parseFloat(m[1]), lufs: parseFloat(m[2]) });
                    })
                    .on('end', () => resolve(samples))
                    .on('error', () => resolve([]))
                    .run();
            });

            await job.updateProgress(30);

            // Normalise LUFS to [0,1]. Typical speech: -30 (quiet) to -9 (loud).
            const LUFS_MIN = -35, LUFS_MAX = -9;
            function energyAt(t) {
                if (!audioEnergy.length) return 0.5;
                // Average loudness over a 1-second window
                const window = audioEnergy.filter(s => Math.abs(s.time - t) < 0.5);
                if (!window.length) return 0.5;
                const avg = window.reduce((s, e) => s + e.lufs, 0) / window.length;
                return Math.min(1, Math.max(0, (avg - LUFS_MIN) / (LUFS_MAX - LUFS_MIN)));
            }

            // ── 2. Phrase grouping ────────────────────────────────────────────
            let words = providedWords;

            // If no transcript passed in, transcribe now
            if (!words.length) {
                await job.updateProgress(35);
                let rzTempAudio = null;
                try {
                    rzTempAudio = await extractAudioForWhisper(inputPath, tempDir);
                    const openai = getOpenAI();
                    const tx = await openai.audio.transcriptions.create({
                        file: fs.createReadStream(rzTempAudio),
                        model: 'whisper-1',
                        response_format: 'verbose_json',
                        timestamp_granularities: ['word'],
                    });
                    words = tx.words || [];
                    if (!words.length && tx.segments?.length) {
                        for (const seg of tx.segments) if (seg.words?.length) words.push(...seg.words);
                    }
                } finally {
                    if (rzTempAudio) { try { fs.unlinkSync(rzTempAudio); } catch (_) {} }
                }
            }

            if (!words.length) {
                return { zoomEvents: [], summary: { phraseCount: 0, style } };
            }

            await job.updateProgress(50);

            // Group words into phrases by pause gaps > 0.35 s
            const GAP = 0.35;
            const phrases = [];
            let current = { words: [words[0]], start: words[0].start, end: words[0].end };

            for (let i = 1; i < words.length; i++) {
                const w = words[i];
                if (w.start - current.end > GAP) {
                    phrases.push({ ...current, text: current.words.map(w => w.word).join(' ').trim() });
                    current = { words: [w], start: w.start, end: w.end };
                } else {
                    current.words.push(w);
                    current.end = w.end;
                }
            }
            phrases.push({ ...current, text: current.words.map(w => w.word).join(' ').trim() });

            // ── 3. GPT-4o phrase scoring ──────────────────────────────────────
            // Limit to 60 phrases to keep the API call cheap (compact JSON)
            const SAMPLE_STEP = phrases.length > 60 ? Math.ceil(phrases.length / 60) : 1;
            const sampledPhrases = phrases.filter((_, i) => i % SAMPLE_STEP === 0);

            let gptScores = null;
            const openai = getOpenAI();
            try {
                const compact = sampledPhrases.map((p, i) => ({ i, s: p.start.toFixed(2), t: p.text.slice(0, 80) }));
                const completion = await openai.chat.completions.create({
                    model: 'gpt-4o-mini',   // fast + cheap for this classification task
                    messages: [{
                        role: 'user',
                        content: `You are a video editor analyzing a talking-head/interview video for camera zoom rhythm.

Rate each phrase for emotional intensity:
- 0.0 = pause, transition, quiet, hesitation, low energy sentence
- 0.5 = normal conversational tone
- 1.0 = key statement, emotional peak, emphasis, strong assertion, surprising fact

Also assign: "wide" (pull back), "medium" (standard), or "close" (push in)

Transcript phrases (i=index, s=start_time, t=text):
${JSON.stringify(compact)}

Return ONLY valid JSON: {"p":[{"i":N,"v":0.0-1.0,"z":"wide"|"medium"|"close"}]}`
                    }],
                    response_format: { type: 'json_object' },
                    temperature: 0.2,
                    max_tokens: 2048,
                });

                const parsed = JSON.parse(completion.choices[0].message.content);
                gptScores = {};
                (parsed.p || []).forEach(s => { gptScores[s.i] = { intensity: s.v ?? 0.5, zoom: s.z || 'medium' }; });
                console.log(`[Job ${job.id}] GPT scored ${Object.keys(gptScores).length} phrases`);
            } catch (err) {
                if (isQuotaExhausted(err)) {
                    console.warn(`[Job ${job.id}] GPT quota exhausted — falling back to audio-only scoring`);
                } else {
                    console.warn(`[Job ${job.id}] GPT scoring failed, audio-only fallback:`, err.message);
                }
            }

            await job.updateProgress(80);

            // ── 4. Style config ────────────────────────────────────────────────
            // min/max/step: scale range and max step between consecutive shots
            const STYLES = {
                subtle:    { min: 1.0, max: 1.10, step: 0.06, minShot: 2.5 },
                dynamic:   { min: 1.0, max: 1.20, step: 0.10, minShot: 2.0 },
                cinematic: { min: 1.0, max: 1.28, step: 0.14, minShot: 1.8 },
            };
            const cfg = STYLES[style] || STYLES.dynamic;

            // ── 5. Generate zoom events ────────────────────────────────────────
            const zoomEvents = [];
            let lastEventTime  = -cfg.minShot;
            let lastScale      = 1.0;

            // Always start wide
            zoomEvents.push({ videoTime: words[0].start, scale: 1.0, easing: 'linear' });

            for (let pi = 0; pi < phrases.length; pi++) {
                const phrase = phrases[pi];

                // Enforce minimum shot duration
                if (phrase.start - lastEventTime < cfg.minShot) continue;

                // Combine GPT score (60%) + audio energy (40%)
                const gpt     = gptScores?.[pi] ?? null;
                const audioPct = energyAt(phrase.start + (phrase.end - phrase.start) / 2);
                const gptPct   = gpt ? gpt.intensity : audioPct;
                const combined = gpt ? (gptPct * 0.6 + audioPct * 0.4) : audioPct;

                // Determine target scale
                let targetScale;
                const gptZoom = gpt?.zoom || (combined > 0.65 ? 'close' : combined > 0.35 ? 'medium' : 'wide');
                switch (gptZoom) {
                    case 'close':  targetScale = cfg.max; break;
                    case 'medium': targetScale = cfg.min + (cfg.max - cfg.min) * 0.5; break;
                    default:       targetScale = cfg.min; break;
                }

                // Don't jump more than one step at a time (no wide → close)
                if (targetScale > lastScale + cfg.step) targetScale = lastScale + cfg.step;
                if (targetScale < lastScale - cfg.step) targetScale = lastScale - cfg.step;

                // Round to avoid floating-point noise
                targetScale = Math.round(targetScale * 1000) / 1000;

                if (targetScale !== lastScale) {
                    zoomEvents.push({
                        videoTime: phrase.start,
                        scale:     targetScale,
                        easing:    targetScale > lastScale ? 'easeOutCubic' : 'linear',
                        // Debug metadata (stripped on the final return)
                        _reason: gptZoom,
                        _audio:  audioPct.toFixed(2),
                    });
                    lastEventTime = phrase.start;
                    lastScale     = targetScale;
                }
            }

            // Return to wide at the end for a clean finish
            const lastWord = words[words.length - 1];
            if (lastScale !== 1.0) {
                zoomEvents.push({ videoTime: lastWord.end, scale: 1.0, easing: 'linear' });
            }

            await job.updateProgress(100);
            console.log(`[Job ${job.id}] ✅ Rhythm-zoom: ${zoomEvents.length} events over ${phrases.length} phrases`);

            return {
                zoomEvents: zoomEvents.map(({ videoTime, scale, easing }) => ({ videoTime, scale, easing })),
                summary: {
                    phraseCount:   phrases.length,
                    eventCount:    zoomEvents.length,
                    style,
                    maxScale:      Math.max(...zoomEvents.map(e => e.scale)),
                },
            };
        }

        default:
            throw new Error(`Unknown audio action: ${action}`);
    }
};
