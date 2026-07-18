/**
 * server/brain/media/VisualAnalyzer.js
 *
 * Extracts frames from a video file and analyses them with GPT-4o Vision.
 * Temp files are ALWAYS cleaned up in a finally block.
 *
 * Cost control: all frames use detail='low'.
 */

'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execFileAsync = promisify(execFile);

let ffmpegPath;
try {
    ffmpegPath = require('ffmpeg-static');
} catch {
    ffmpegPath = 'ffmpeg';
}

const OpenAI = require('openai');

const MAX_BUFFER = 1024 * 1024 * 50;

/** Default result returned on any error */
const ERROR_RESULT = {
    error: true,
    sceneType: 'unknown',
    cameraAngle: null,
    subjectCount: null,
    hasMainSpeaker: null,
    hasFaces: null,
    isBroll: null,
    isScreenRecording: null,
    locationType: null,
    lightingQuality: null,
    stability: null,
    emotionalTone: null,
    contentDescription: null,
    suggestedLabel: null,
};

class VisualAnalyzer {

    constructor() {
        this.openai = process.env.OPENAI_API_KEY
            ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
            : null;
    }

    /**
     * Analyse a video file visually using frame extraction + GPT-4o Vision.
     *
     * @param {string} filePath  - Absolute path to video file
     * @param {number} duration  - Video duration in seconds
     * @returns {Promise<Object>} Visual analysis result
     */
    async analyze(filePath, duration) {
        const tempFiles = [];

        try {
            if (!fs.existsSync(filePath)) {
                console.warn('[VisualAnalyzer] File not found:', filePath);
                return ERROR_RESULT;
            }

            if (!this.openai) {
                console.warn('[VisualAnalyzer] No OpenAI key — skipping vision analysis');
                return { ...ERROR_RESULT, error: false, sceneType: 'unknown' };
            }

            const frames = await this.extractFrames(filePath, duration || 0, tempFiles);
            if (!frames.length) return ERROR_RESULT;

            const result = await this.analyzeWithVision(frames);
            return result;

        } catch (err) {
            console.error('[VisualAnalyzer] analyze error:', err.message);
            return ERROR_RESULT;
        } finally {
            // ALWAYS clean up temp files
            for (const f of tempFiles) {
                try { fs.unlinkSync(f); } catch { /* ignore */ }
            }
        }
    }

    /**
     * Extract 3 frames at 10%, 50%, 90% of the video duration.
     * Writes to /tmp and adds each path to tempFiles for cleanup.
     *
     * @param {string} filePath
     * @param {number} duration
     * @param {string[]} tempFiles  - Mutated to track files for cleanup
     * @returns {Promise<{ timestamp: number, base64: string }[]>}
     */
    async extractFrames(filePath, duration, tempFiles) {
        const positions = [0.1, 0.5, 0.9];
        const frames = [];
        const ts = Date.now();

        for (const pct of positions) {
            const t = Math.max(0.1, (duration || 10) * pct);
            const outPath = path.join('/tmp', `frame_${ts}_${Math.round(t * 10)}.jpg`);
            tempFiles.push(outPath);

            try {
                await execFileAsync(ffmpegPath, [
                    '-ss', String(t),
                    '-i', filePath,
                    '-frames:v', '1',
                    '-q:v', '5',       // decent JPEG quality
                    '-y',
                    outPath,
                ], { maxBuffer: MAX_BUFFER });

                if (fs.existsSync(outPath)) {
                    const base64 = fs.readFileSync(outPath).toString('base64');
                    frames.push({ timestamp: t, base64 });
                }
            } catch (err) {
                console.warn(`[VisualAnalyzer] Frame extraction failed at ${t}s:`, err.message);
            }
        }

        return frames;
    }

    /**
     * Send extracted frames to GPT-4o Vision and parse the JSON response.
     *
     * @param {{ timestamp: number, base64: string }[]} frames
     * @returns {Promise<Object>}
     */
    async analyzeWithVision(frames) {
        try {
            const imageMessages = frames.map(f => ({
                type: 'image_url',
                image_url: {
                    url: `data:image/jpeg;base64,${f.base64}`,
                    detail: 'low', // cost control
                },
            }));

            const prompt = `Analyse these video frames and return a JSON object with this exact shape:
{
  "sceneType": "talking_head|interview|broll|screen_recording|podcast|vlog|tutorial|product|unknown",
  "cameraAngle": "close_up|medium|wide|overhead|unknown",
  "subjectCount": <number>,
  "hasMainSpeaker": <boolean>,
  "hasFaces": <boolean>,
  "isBroll": <boolean>,
  "isScreenRecording": <boolean>,
  "locationType": "indoor|outdoor|studio|unknown",
  "lightingQuality": "excellent|good|fair|poor",
  "stability": "stable|slightly_shaky|shaky",
  "emotionalTone": "energetic|calm|serious|humorous|neutral",
  "contentDescription": "<one sentence describing the video content>",
  "suggestedLabel": "<short label for the media bin, 2-4 words>"
}
Return ONLY the JSON object, no explanation.`;

            const response = await this.openai.chat.completions.create({
                model: 'gpt-4o',
                max_tokens: 400,
                response_format: { type: 'json_object' },
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: prompt },
                            ...imageMessages,
                        ],
                    },
                ],
            });

            const raw = response.choices[0]?.message?.content;
            if (!raw) return ERROR_RESULT;

            const parsed = JSON.parse(raw);
            return {
                error: false,
                sceneType:          parsed.sceneType          || 'unknown',
                cameraAngle:        parsed.cameraAngle        || null,
                subjectCount:       parsed.subjectCount       ?? null,
                hasMainSpeaker:     parsed.hasMainSpeaker     ?? null,
                hasFaces:           parsed.hasFaces           ?? null,
                isBroll:            parsed.isBroll            ?? null,
                isScreenRecording:  parsed.isScreenRecording  ?? null,
                locationType:       parsed.locationType       || null,
                lightingQuality:    parsed.lightingQuality    || null,
                stability:          parsed.stability          || null,
                emotionalTone:      parsed.emotionalTone      || null,
                contentDescription: parsed.contentDescription || null,
                suggestedLabel:     parsed.suggestedLabel     || null,
            };

        } catch (err) {
            console.error('[VisualAnalyzer] analyzeWithVision error:', err.message);
            return ERROR_RESULT;
        }
    }
}

module.exports = { VisualAnalyzer };
