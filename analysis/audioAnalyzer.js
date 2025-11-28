const fs = require('fs');
const OpenAI = require('openai');
const ffmpeg = require('fluent-ffmpeg');

const openai = process.env.OPENAI_API_KEY ? new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
}) : null;

/**
 * Analyzes audio from a video file.
 * @param {string} videoPath - Path to the video file.
 * @returns {Promise<Object>} - Audio analysis results including transcript and metadata.
 */
async function analyzeAudio(videoPath) {
    try {
        console.log('🎤 Starting audio analysis...');

        // Mock if no API key
        if (!openai) {
            console.warn('⚠️ No OpenAI API Key found. Using mock audio analysis.');
            return {
                transcript: "This is a mock transcript for testing purposes. The video contains some speech about viral content.",
                language: "en",
                duration: 5.0,
                wpm: 120,
                fillerCount: 2,
                silences: [],
                segments: [{ start: 0, end: 5, text: "This is a mock transcript for testing purposes." }],
                words: []
            };
        }

        // 1. Extract audio to a temporary file
        const audioPath = videoPath.replace(/\.[^/.]+$/, '.mp3');
        await new Promise((resolve, reject) => {
            ffmpeg(videoPath)
                .toFormat('mp3')
                .on('end', resolve)
                .on('error', reject)
                .save(audioPath);
        });

        // 2. Transcribe using Whisper
        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(audioPath),
            model: "whisper-1",
            response_format: "verbose_json",
            timestamp_granularities: ["word", "segment"]
        });

        // 3. Cleanup temp audio file
        fs.unlinkSync(audioPath);

        // 4. Analyze transcript for basic features
        const words = transcription.words || [];
        const segments = transcription.segments || [];

        // Calculate speech speed (words per minute)
        const duration = transcription.duration;
        const wordCount = words.length;
        const wpm = (wordCount / duration) * 60;

        // Detect filler words (basic list)
        const fillerWords = ['um', 'uh', 'like', 'you know', 'sort of', 'kind of', 'euh', 'ben', 'genre'];
        const fillerCount = words.filter(w => fillerWords.includes(w.word.toLowerCase().trim())).length;

        // Detect silence/pauses (gaps between segments > 1s)
        const silences = [];
        for (let i = 0; i < segments.length - 1; i++) {
            const gap = segments[i + 1].start - segments[i].end;
            if (gap > 1.0) {
                silences.push({ start: segments[i].end, end: segments[i + 1].start, duration: gap });
            }
        }

        return {
            transcript: transcription.text,
            language: transcription.language,
            duration,
            wpm: Math.round(wpm),
            fillerCount,
            silences,
            segments: segments.map(s => ({
                start: s.start,
                end: s.end,
                text: s.text
            })),
            words: words // Keep detailed word timestamps for later alignment
        };

    } catch (error) {
        console.error('❌ Error analyzing audio:', error);
        return {
            transcript: "",
            error: error.message
        };
    }
}

module.exports = { analyzeAudio };
