const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const path = require('path');
const fs = require('fs');
const { detectBeats } = require('../analysis/beatDetector');
const { OpenAI } = require('openai');

ffmpeg.setFfmpegPath(ffmpegPath);

let openaiInstance = null;
function getOpenAI() {
    if (!openaiInstance) {
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY environment variable is missing.');
        }
        openaiInstance = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return openaiInstance;
}

const WHISPER_LIMIT = 25 * 1024 * 1024; // 25 MB

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
            .audioChannels(1)
            .audioFrequency(16000)
            .audioBitrate('32k')
            .format('mp3')
            .output(outPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
    });
    return outPath;
}

async function detectFillerWords(inputPath, language = 'en', tempDir = null) {
    const FILLER_WORDS = new Set([
        'um', 'uh', 'ah', 'er', 'eh', 'hmm', 'hm',
        'like', 'basically', 'literally',
        'you know', 'i mean', 'kind of', 'sort of',
        'euh', 'ben', 'genre', 'voilà', 'bah',
    ]);

    let tempAudio = null;

    if (!tempDir) throw new Error('tempDir required to extract audio');
    console.log(`[detectFillerWords] Extracting audio for Whisper to ensure compatibility and speed...`);
    tempAudio = await extractAudioForWhisper(inputPath, tempDir);
    let whisperPath = tempAudio;

    try {
        const openai = getOpenAI();
        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(whisperPath),
            model: 'whisper-1',
            response_format: 'verbose_json',
            timestamp_granularities: ['word'],
            language: language === 'auto' ? undefined : language,
        });

        const words = transcription.words || [];
        const totalDuration = transcription.duration || (words.length ? words[words.length - 1].end : 0);

        const MERGE_GAP = 0.15;
        const fillerSpans = [];
        let current = null;

        for (const w of words) {
            const token = w.word.toLowerCase().replace(/[^a-zàâéèêëîïôùûüç ]/g, '').trim();
            const isFiller = FILLER_WORDS.has(token);

            if (isFiller) {
                if (current && w.start - current.end <= MERGE_GAP) {
                    current.end = w.end;
                } else {
                    if (current) fillerSpans.push(current);
                    current = { start: w.start, end: w.end };
                }
            } else {
                if (current) { fillerSpans.push(current); current = null; }
            }
        }
        if (current) fillerSpans.push(current);

        const activeSegments = [];
        let cursor = 0;
        for (const span of fillerSpans) {
            if (span.start > cursor + 0.01) {
                activeSegments.push({ start: cursor, end: span.start, duration: span.start - cursor });
            }
            cursor = span.end;
        }
        if (cursor < totalDuration - 0.01) {
            activeSegments.push({ start: cursor, end: totalDuration, duration: totalDuration - cursor });
        }

        return {
            fillerCount: fillerSpans.length,
            removedSegments: fillerSpans.map(s => ({ ...s, duration: s.end - s.start })),
            activeSegments,
            transcript: transcription.text,
            totalDuration,
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
        if (storageConfig.bucket && userId && filename) {
            console.log(`[Job ${job.id}] Local file missing, downloading from GCS...`);
            const gcsPath = `raw/${userId}/${path.basename(filename)}`;
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
            await job.updateProgress(100);
            return { url: `/uploads/audio_temp/${path.basename(outputPath)}`, message: "Noise reduction applied successfully." };
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
            await job.updateProgress(100);
            return { url: `/uploads/audio_temp/${path.basename(outputPath)}`, message: "Audio normalized to -16 LUFS." };
        }

        case 'beat-detect': {
            console.log(`[Job ${job.id}] 🥁 Detecting Beats for: ${inputPath}`);
            const result = await detectBeats(inputPath);
            await job.updateProgress(100);
            return result;
        }

        case 'transcribe': {
            console.log(`[Job ${job.id}] 🎙️ Transcribing with Whisper: ${inputPath}`);
            let tTempAudio = null;
            
            console.log(`[Job ${job.id}] Extracting audio for Whisper to ensure compatibility and speed...`);
            tTempAudio = await extractAudioForWhisper(inputPath, tempDir);
            let tWhisperPath = tTempAudio;
            
            try {
                const openai = getOpenAI();
                const transcription = await openai.audio.transcriptions.create({
                    file: fs.createReadStream(tWhisperPath),
                    model: 'whisper-1',
                    response_format: 'verbose_json',
                    timestamp_granularities: ['word', 'segment']
                });
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
            const result = await detectFillerWords(inputPath, language || 'en', tempDir);
            await job.updateProgress(100);
            return result;
        }

        default:
            throw new Error(`Unknown audio action: ${action}`);
    }
};
