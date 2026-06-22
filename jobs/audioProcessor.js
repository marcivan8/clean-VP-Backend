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
            .audioFilters('loudnorm=I=-16:TP=-1.5:LRA=11') // Normalize audio to ensure Whisper hears faint speech
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
            console.log(`[Job ${job.id}] 🎙️ Speaker diarization via WhisperX: ${inputPath}`);
            const DiarizeService = require('../services/DiarizeService');

            if (!DiarizeService.isAvailable) {
                throw new Error('DIARIZE_SERVICE_URL is not configured — cannot run speaker diarization');
            }

            await job.updateProgress(5);

            // Extract a mono 16 kHz WAV for WhisperX — reduces file size and ensures
            // compatibility across all audio codecs (AAC/MP4, MOV, etc.)
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

            // minSpeakers=2 is a critical default for interview/podcast content:
            // pyannote will NOT collapse two distinct voices into one speaker when
            // it knows there are at least 2. Without this, single-speaker detection
            // is often returned for content with obvious speaker changes.
            // Override via job.data.minSpeakers if the caller knows the speaker count.
            const minSpeakers = job.data.minSpeakers ?? 2;
            const maxSpeakers = job.data.maxSpeakers ?? 10;

            let result;
            try {
                result = await DiarizeService.diarize(wavPath, language || null, { minSpeakers, maxSpeakers });
            } finally {
                if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
            }

            await job.updateProgress(100);

            if (!result.diarizationRan) {
                // Diarization pipeline didn't load on the Python side — most likely
                // HF_TOKEN is missing. Surface this as a job warning in the result
                // so the client can inform the user.
                console.warn(`[Job ${job.id}] ⚠️  Diarization skipped — no speaker labels. Check HF_TOKEN on diarize-service.`);
                return {
                    words:           result.words,
                    speakers:        [],
                    language:        result.language,
                    diarizationRan:  false,
                    warning:         'Speaker separation did not run. Set HF_TOKEN in the diarize-service Railway Variables and accept the pyannote model terms at https://huggingface.co/pyannote/speaker-diarization-3.1',
                };
            }

            console.log(`[Job ${job.id}] ✅ Diarization complete: ${result.words.length} words, ${result.speakers.length} speakers: ${result.speakers.join(', ')}`);
            return result;
        }

        default:
            throw new Error(`Unknown audio action: ${action}`);
    }
};
