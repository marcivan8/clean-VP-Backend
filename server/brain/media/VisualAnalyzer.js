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
const { getAIFor, isAIConfigured, describeAIError } = require('../../../services/AIProvider');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');
const ffmpeg = require('fluent-ffmpeg');

const execFileAsync = promisify(execFile);

let ffmpegPath;
try {
    ffmpegPath = require('ffmpeg-static');
} catch {
    ffmpegPath = 'ffmpeg';
}

// Same pattern as server/audio-engine/export/AudioExportService.js and
// jobs/exportProcessor.js — point fluent-ffmpeg at the bundled ffprobe binary
// rather than relying on one being on PATH.
try {
    const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
    ffmpeg.setFfprobePath(ffprobeInstaller.path);
} catch {
    // fall back to whatever ffprobe fluent-ffmpeg finds on PATH
}

const OpenAI = require('openai');

const MAX_BUFFER = 1024 * 1024 * 50;
const RETRYABLE_VISION_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_VISION_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN']);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function isRetryableVisionError(err) {
    const status = Number(err?.status || err?.statusCode);
    return RETRYABLE_VISION_STATUSES.has(status) || RETRYABLE_VISION_CODES.has(err?.code);
}

/** Retry only transient provider/network errors; invalid requests fail fast. */
async function completeVisionWithRetry(client, payload, { attempts = 3 } = {}) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
            return await client.chat.completions.create(payload, { timeout: 60_000, maxRetries: 0 });
        } catch (err) {
            lastError = err;
            const status = Number(err?.status || err?.statusCode);
            if (!isRetryableVisionError(err) || attempt === attempts - 1) throw err;
            const retryAfter = Number(err?.headers?.['retry-after']);
            const delay = Number.isFinite(retryAfter) && retryAfter > 0
                ? Math.min(5000, retryAfter * 1000)
                : 400 * (2 ** attempt);
            console.warn(`[VisualAnalyzer] Vision request returned ${status || err.code}; retry ${attempt + 2}/${attempts} in ${delay}ms`);
            await sleep(delay);
        }
    }
    throw lastError;
}

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

const STYLE_ENUMS = {
    motionEnergy: new Set(['low', 'medium', 'high', 'unknown']),
    captionTreatment: new Set(['none', 'minimal', 'clean', 'bold', 'word_highlight', 'boxed', 'kinetic', 'unknown']),
    titleTreatment: new Set(['none', 'minimal', 'top_card', 'centered', 'large_kinetic', 'lower_third', 'editorial_serif', 'unknown']),
    graphicsDensity: new Set(['sparse', 'balanced', 'dense', 'unknown']),
    transitionPacing: new Set(['slow', 'medium', 'fast', 'unknown']),
    visualTone: new Set(['cinematic', 'editorial', 'warm', 'viral', 'technology', 'unknown']),
};
const STYLE_FONTS = new Set(['Inter', 'Anton', 'Montserrat', 'Poppins', 'DM Sans', 'Playfair Display', 'Cormorant Garamond', 'Rajdhani', 'JetBrains Mono', 'Oswald', 'Bebas Neue']);
const STYLE_ANIMATIONS = new Set(['fade', 'slide-up', 'slide-down', 'pop', 'scale-reveal', 'blur-reveal', 'glow-reveal', 'typewriter', 'unknown']);
const STYLE_TRANSITIONS = new Set(['flash', 'dip', 'whip-left', 'whip-right', 'zoom-punch', 'glitch', 'speed-lines', 'circle-wipe', 'bar-wipe', 'blinds', 'diagonal-wipe', 'soft-blur', 'push-left', 'push-right', 'color-flash', 'unknown']);
const isHexColor = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);

/** Keep provider output inside the documented profile contract before caching it. */
function normalizeVisualStyleProfile(raw, { mediaKind, frames, duration }) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const enumValue = (key, value) => {
        const normalized = String(value || '').toLowerCase().replace(/[ -]+/g, '_');
        return STYLE_ENUMS[key]?.has(normalized) ? normalized : 'unknown';
    };
    const normalizeTextStyle = value => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const color = isHexColor(value.color) ? value.color.toUpperCase() : null;
        const accentColor = isHexColor(value.accentColor) ? value.accentColor.toUpperCase() : null;
        const x = Number.isFinite(Number(value.x)) && Number(value.x) >= 0 && Number(value.x) <= 100 ? Number(value.x) : null;
        const y = Number.isFinite(Number(value.y)) && Number(value.y) >= 0 && Number(value.y) <= 100 ? Number(value.y) : null;
        const weight = [400, 500, 600, 700, 800, 900].includes(Number(value.fontWeight)) ? Number(value.fontWeight) : null;
        const fontFamily = STYLE_FONTS.has(value.fontFamily) ? value.fontFamily : 'unknown';
        const animationIn = STYLE_ANIMATIONS.has(value.animationIn) ? value.animationIn : 'unknown';
        return { fontFamily, fontWeight: weight, color, accentColor, x, y, animationIn };
    };
    const sampleTimes = (frames || []).map(frame => Number(frame.timestamp)).filter(Number.isFinite);
    const validSampleTime = time => {
        if (!Number.isFinite(Number(time)) || mediaKind !== 'video' || !sampleTimes.length) return null;
        const value = Number(time);
        const nearest = sampleTimes.reduce((best, candidate) => Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best, sampleTimes[0]);
        return Math.abs(nearest - value) <= Math.max(1.5, Number(duration || 0) * 0.08) ? Math.max(0, Math.min(Number(duration) || value, value)) : null;
    };
    const sceneDirections = (Array.isArray(raw.sceneDirections) ? raw.sceneDirections : []).slice(0, 9).map(item => {
        if (!item || typeof item !== 'object') return null;
        const time = validSampleTime(item.time);
        const confidence = Number.isFinite(Number(item.confidence)) ? Math.max(0, Math.min(1, Number(item.confidence))) : null;
        const role = ['hook', 'title', 'caption', 'graphic', 'transition', 'unknown'].includes(item.role) ? item.role : 'unknown';
        return {
            ...(time !== null ? { time } : {}),
            role,
            ...normalizeTextStyle({ ...item, color: item.textColor }),
            textColor: isHexColor(item.textColor) ? item.textColor.toUpperCase() : null,
            transitionAfter: STYLE_TRANSITIONS.has(item.transitionAfter) ? item.transitionAfter : 'unknown',
            confidence,
        };
    }).filter(item => item && item.time !== undefined && (item.confidence === null || item.confidence >= 0.45));
    const confidence = Number.isFinite(Number(raw.confidence)) ? Math.max(0, Math.min(1, Number(raw.confidence))) : 0;
    return {
        profileVersion: 3,
        mediaKind,
        confidence,
        sampleCount: sampleTimes.length,
        sampledAtSec: sampleTimes.slice(0, 12),
        durationSec: Number.isFinite(Number(duration)) ? Number(duration) : null,
        motionEnergy: enumValue('motionEnergy', raw.motionEnergy),
        captionTreatment: enumValue('captionTreatment', raw.captionTreatment),
        titleTreatment: enumValue('titleTreatment', raw.titleTreatment),
        graphicsDensity: enumValue('graphicsDensity', raw.graphicsDensity),
        transitionPacing: enumValue('transitionPacing', raw.transitionPacing),
        visualTone: enumValue('visualTone', raw.visualTone),
        colorPalette: [...new Set((Array.isArray(raw.colorPalette) ? raw.colorPalette : []).filter(isHexColor).map(color => color.toUpperCase()))].slice(0, 5),
        motifs: (Array.isArray(raw.motifs) ? raw.motifs : []).map(value => String(value || '').trim().slice(0, 100)).filter(Boolean).slice(0, 8),
        titleStyle: normalizeTextStyle(raw.titleStyle),
        captionStyle: normalizeTextStyle(raw.captionStyle),
        transitionTypes: [...new Set((Array.isArray(raw.transitionTypes) ? raw.transitionTypes : []).filter(value => STYLE_TRANSITIONS.has(value) && value !== 'unknown'))].slice(0, 6),
        sceneDirections,
    };
}

class VisualAnalyzer {

    constructor() {
        // capability: 'vision' — frames go out as image_url content parts.
        // Under AI_VISION_PROVIDER=gemini this is served free; groq has no
        // free vision model, so vision never routes there (see AIProvider.js).
        //
        // R117 - the client and the model name are taken TOGETHER. Fetching
        // them separately is what sent a Gemini model name to Groq's endpoint
        // from the interview routes; this was already consistent, and
        // `getAIFor` makes it impossible to drift.
        const vision = getAIFor('vision', 'gpt-4o');
        this.openai = vision.client;
        this.visionModel = vision.model;
        this.visionProvider = vision.provider;
    }

    /**
     * Analyse a video file visually using frame extraction + GPT-4o Vision.
     *
     * @param {string} filePath  - Absolute path to video file
     * @param {number} duration  - Video duration in seconds
     * @returns {Promise<Object>} Visual analysis result
     */
    async analyze(filePath, duration, { styleReference = false } = {}) {
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

            // MediaIntelligencePipeline.analyzeAsset() has never had a real
            // duration to pass here — it always calls `analyze(localPath, null)`
            // — so extractFrames() silently fell back to a hardcoded `duration
            // || 10` and sampled at ~1s/5s/9s on every clip regardless of its
            // actual length. A 10-minute interview and a 10-second clip got the
            // exact same three frames near the start. Probe the real duration
            // when the caller doesn't have one; only fall back to the 10s
            // default (inside extractFrames) if ffprobe itself fails.
            const realDuration = duration || await this.probeDuration(filePath);

            // A style reference needs enough temporal coverage to distinguish
            // persistent typography from one-off cards and to compare motion
            // across adjacent moments. Keep the ordinary asset pass cheap.
            const samplePositions = styleReference
                ? [0.04, 0.15, 0.26, 0.37, 0.48, 0.59, 0.70, 0.81, 0.92]
                : undefined;
            const frames = await this.extractFrames(filePath, realDuration, tempFiles, samplePositions);
            if (!frames.length) return ERROR_RESULT;

            const result = await this.analyzeWithVision(frames, 'video', { styleReference, durationSec: realDuration });
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
     * Search a video for a user-described visual subject/event using timestamped
     * snapshots. Whole-video upload is avoided; small batches keep vision calls
     * predictable and make every result traceable to sampled evidence.
     */
    async locateTarget(filePath, { query, start = 0, end = null, onProgress = null } = {}) {
        const target = String(query || '').trim();
        if (!target) throw new Error('A visual target description is required.');
        if (!fs.existsSync(filePath)) throw new Error('The video file is unavailable for visual search.');
        if (!this.openai) throw new Error('Visual target search is not configured.');

        const realDuration = await this.probeDuration(filePath);
        if (!(realDuration > 0)) throw new Error('Could not read the video duration.');
        const rangeStart = Math.max(0, Math.min(realDuration, Number(start) || 0));
        const rangeEnd = Math.max(rangeStart, Math.min(realDuration, Number(end) > rangeStart ? Number(end) : realDuration));
        if (rangeEnd - rangeStart < 0.25) throw new Error('The requested search range is too short.');

        const maxSamples = 120;
        const sampleInterval = Math.max(1, Math.ceil((rangeEnd - rangeStart) / maxSamples));
        const sampleCount = Math.min(maxSamples, Math.ceil((rangeEnd - rangeStart) / sampleInterval));
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibed-target-'));
        const framePattern = path.join(tempDir, 'frame-%04d.jpg');
        const { rangesFromFrameMatches } = require('./visualTargetRanges');

        try {
            await execFileAsync(ffmpegPath, [
                '-hide_banner', '-loglevel', 'error', '-ss', String(rangeStart), '-i', filePath,
                '-t', String(rangeEnd - rangeStart), '-vf', `fps=1/${sampleInterval},scale=640:-2`,
                '-frames:v', String(sampleCount), '-q:v', '7', '-y', framePattern,
            ], { maxBuffer: MAX_BUFFER, timeout: 120_000 });

            const frameFiles = fs.readdirSync(tempDir)
                .filter(name => /^frame-\d+\.jpg$/.test(name))
                .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
            if (frameFiles.length === 0) throw new Error('No video snapshots could be extracted.');

            const frameMatches = [];
            const batchSize = 8;
            for (let offset = 0; offset < frameFiles.length; offset += batchSize) {
                const batchFiles = frameFiles.slice(offset, offset + batchSize);
                const batch = batchFiles.map((name, i) => {
                    const frameNumber = offset + i;
                    return {
                        index: frameNumber,
                        timestamp: Math.min(rangeEnd, rangeStart + frameNumber * sampleInterval),
                        base64: fs.readFileSync(path.join(tempDir, name)).toString('base64'),
                    };
                });
                const parts = [{
                    type: 'text',
                    text: `Find visual matches for this target: ${JSON.stringify(target)}. These are sampled video frames; each frame label gives its source timestamp. Return JSON only: {"matches":[{"index":<frame index>,"match":true|false,"confidence":0..1,"evidence":"brief visible evidence"}]}. Include one result for each frame. Mark uncertain/ambiguous frames false. Do not infer a match from dialogue or from another frame.`,
                }];
                for (const frame of batch) {
                    parts.push({ type: 'text', text: `Frame index ${frame.index}, source time ${frame.timestamp.toFixed(2)} seconds.` });
                    parts.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${frame.base64}`, detail: 'low' } });
                }
                const response = await this.openai.chat.completions.create({
                    model: this.visionModel,
                    max_tokens: 900,
                    temperature: 0,
                    response_format: { type: 'json_object' },
                    messages: [{ role: 'user', content: parts }],
                }, { timeout: 25_000, maxRetries: 0 });
                const raw = response.choices?.[0]?.message?.content || '{}';
                let parsed;
                try { parsed = JSON.parse(raw); } catch { throw new Error('Visual target search returned invalid structured data.'); }
                for (const hit of Array.isArray(parsed.matches) ? parsed.matches : []) {
                    const frame = batch.find(f => f.index === Number(hit.index));
                    if (!frame || hit.match !== true) continue;
                    frameMatches.push({
                        timestamp: frame.timestamp,
                        confidence: Math.max(0, Math.min(1, Number(hit.confidence) || 0)),
                        evidence: String(hit.evidence || '').slice(0, 240),
                    });
                }
                if (typeof onProgress === 'function') await onProgress(Math.min(95, Math.round(((offset + batch.length) / frameFiles.length) * 95)));
            }

            const ranges = rangesFromFrameMatches(frameMatches, sampleInterval, rangeEnd, rangeStart)
                .map((range, index) => ({
                    id: `visual-target-${index + 1}`,
                    kind: 'visual',
                    query: target,
                    sourceStart: range.start,
                    sourceEnd: range.end,
                    confidence: range.confidence,
                    evidence: range.evidence,
                    sampleCount: range.sampleCount,
                    reviewRequired: true,
                }));
            return {
                query: target,
                assetDuration: realDuration,
                searchedRange: { start: rangeStart, end: rangeEnd },
                sampleInterval,
                ranges,
                note: ranges.length ? 'Frame-sampled candidates; review each range before editing.' : 'No visual matches were found in the sampled frames.',
            };
        } finally {
            try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* best-effort temp cleanup */ }
        }
    }

    /**
     * Probe the file's real duration via ffprobe.
     *
     * @param {string} filePath
     * @returns {Promise<number>} duration in seconds, or 0 on failure (caller
     *   falls back to the old fixed-window sampling behaviour)
     */
    async probeDuration(filePath) {
        return new Promise((resolve) => {
            try {
                ffmpeg.ffprobe(filePath, (err, metadata) => {
                    if (err) {
                        console.warn('[VisualAnalyzer] ffprobe failed, falling back to default sampling window:', err.message);
                        return resolve(0);
                    }
                    const d = Number(metadata?.format?.duration);
                    resolve(Number.isFinite(d) && d > 0 ? d : 0);
                });
            } catch (err) {
                console.warn('[VisualAnalyzer] ffprobe threw, falling back to default sampling window:', err.message);
                resolve(0);
            }
        });
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
    async extractFrames(filePath, duration, tempFiles, requestedPositions = null) {
        const positions = Array.isArray(requestedPositions) && requestedPositions.length
            ? requestedPositions
            : [0.1, 0.5, 0.9];
        const frames = [];
        const ts = Date.now();

        for (const pct of positions) {
            const safeDuration = Math.max(0.1, Number(duration) || 10);
            const latestSafeTime = Math.max(0, safeDuration - Math.min(0.05, safeDuration * 0.08));
            const t = Math.max(0, Math.min(latestSafeTime, safeDuration * pct));
            if (frames.some(frame => Math.abs(frame.timestamp - t) < 0.04)) continue;
            const outPath = path.join('/tmp', `frame_${ts}_${frames.length}_${Math.round(t * 1000)}.jpg`);
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
    async analyzeWithVision(frames, mediaKind = 'video', { styleReference = false, durationSec = null } = {}) {
        try {
            const imageMessages = frames.map(f => ({
                type: 'image_url',
                image_url: {
                    url: `data:image/jpeg;base64,${f.base64}`,
                    detail: styleReference ? 'high' : 'low', // Read typography and graphic treatment only for explicit references.
                },
            }));

            const subject = mediaKind === 'image' ? 'this photograph' : 'these video frames';
            const prompt = `Analyse ${subject} and return a JSON object with this exact shape:
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
}${styleReference ? `
Also return "visualStyleProfile" describing only the visible editing/design grammar (do not infer the story content): {
  "confidence": <0 to 1; lower if frames do not show enough overlays>,
  "motionEnergy": "low|medium|high|unknown",
  "captionTreatment": "none|minimal|clean|bold|word_highlight|boxed|kinetic|unknown",
  "titleTreatment": "none|minimal|top_card|centered|large_kinetic|lower_third|editorial_serif|unknown",
  "graphicsDensity": "sparse|balanced|dense|unknown",
  "transitionPacing": "slow|medium|fast|unknown",
  "visualTone": "cinematic|editorial|warm|viral|technology|unknown",
  "colorPalette": ["#RRGGBB", "#RRGGBB"],
  "motifs": ["short visible design motif", "another motif"],
  "titleStyle": {
    "fontFamily": "closest supported font name or unknown",
    "fontWeight": 400|500|600|700|800|900|null,
    "color": "#RRGGBB or null",
    "accentColor": "#RRGGBB or null",
    "x": 0-100|null,
    "y": 0-100|null,
    "animationIn": "fade|slide-up|slide-down|pop|scale-reveal|blur-reveal|glow-reveal|typewriter|unknown"
  },
  "captionStyle": {
    "fontFamily": "closest supported font name or unknown",
    "fontWeight": 400|500|600|700|800|900|null,
    "color": "#RRGGBB or null",
    "accentColor": "#RRGGBB or null",
    "x": 0-100|null,
    "y": 0-100|null,
    "animationIn": "fade|slide-up|slide-down|pop|scale-reveal|blur-reveal|glow-reveal|typewriter|unknown"
  },
  "transitionTypes": ["flash|dip|whip-left|whip-right|zoom-punch|glitch|speed-lines|circle-wipe|bar-wipe|blinds|diagonal-wipe|soft-blur|push-left|push-right|color-flash"],
  "sceneDirections": [{
    "time": <source timestamp in seconds from the label>,
    "role": "hook|title|caption|graphic|transition|unknown",
    "x": 0-100|null, "y": 0-100|null,
    "fontFamily": "closest supported font name or unknown",
    "fontWeight": 400|500|600|700|800|900|null,
    "textColor": "#RRGGBB or null", "accentColor": "#RRGGBB or null",
    "animationIn": "supported animation id or unknown",
    "transitionAfter": "supported transition id or unknown",
    "confidence": 0-1
  }]
}
For captionTreatment, use these visual definitions: "boxed" means caption words sit on a visible solid or translucent filled panel; "clean" means plain text without a panel; "word_highlight" means one spoken word is singled out with a distinct color or shape; "bold" means consistently heavy caption text without a panel; "kinetic" means the words visibly change position or scale. Choose the treatment repeated most consistently across the sampled frames. A one-off title card is not the caption treatment. If the frames do not show enough captions, use "unknown". For titleTreatment, use "editorial_serif" when the reference repeatedly uses a high-contrast serif display face for its main titles, even if captions use sans-serif; reserve "minimal" for restrained sans-serif titles.
For fontFamily choose only from: Inter, Anton, Montserrat, Poppins, DM Sans, Playfair Display, Cormorant Garamond, Rajdhani, JetBrains Mono, Oswald, Bebas Neue. Describe the closest visual match, not a claimed exact font identification. Measure x/y as the text block's center in frame percentages (origin top-left); use null when it is not visible. Color values must be sampled visually and may be null. sceneDirections must correspond to the timestamped sampled frames, be chronological, and contain at most 9 entries. transitionAfter may only name a transition when adjacent samples show evidence; otherwise use unknown. Still frames cannot prove the exact animation or transition, so leave unknown when the evidence is weak. Do not infer story content or transcribe text. Motifs may describe visible patterns such as social proof metrics, comment or DM cards, product or document cards, archive-photo layouts, split-screen comparisons, large two-tone headlines, speaker cutouts, or phone frames. Do not claim to see sound effects from still frames.` : ''}
Return ONLY the JSON object, no explanation.`;

            const request = {
                model: this.visionModel,
                max_tokens: styleReference ? 1800 : 400,
                temperature: 0,
                response_format: { type: 'json_object' },
                messages: [
                    {
                        role: 'user',
                        content: styleReference
                            ? [
                                { type: 'text', text: prompt },
                                ...frames.flatMap((frame, index) => [
                                    { type: 'text', text: `Sample ${index + 1}, source timestamp ${Number(frame.timestamp).toFixed(2)} seconds:` },
                                    imageMessages[index],
                                ]),
                            ]
                            : [{ type: 'text', text: prompt }, ...imageMessages],
                    },
                ],
            };

            let response;
            try {
                response = await completeVisionWithRetry(this.openai, request);
            } catch (primaryError) {
                // A second Gemini model can absorb temporary capacity spikes
                // without changing the prompt, sampled frames, or provider key.
                // Invalid requests and auth/configuration failures still fail fast.
                const fallbackModel = this.visionProvider === 'gemini'
                    ? (process.env.GEMINI_VISION_FALLBACK_MODEL || 'gemini-3.1-flash-lite').trim()
                    : '';
                if (!fallbackModel || fallbackModel === this.visionModel || !isRetryableVisionError(primaryError)) {
                    throw primaryError;
                }

                console.warn(
                    `[VisualAnalyzer] ${this.visionModel} failed transiently (${describeAIError(primaryError)}); ` +
                    `trying Gemini vision fallback ${fallbackModel}`
                );
                response = await completeVisionWithRetry(this.openai, { ...request, model: fallbackModel }, { attempts: 2 });
                console.info(`[VisualAnalyzer] Vision analysis completed with fallback model ${fallbackModel}`);
            }

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
                ...(styleReference && parsed.visualStyleProfile && typeof parsed.visualStyleProfile === 'object'
                    ? { visualStyleProfile: normalizeVisualStyleProfile(parsed.visualStyleProfile, { mediaKind, frames, duration: durationSec }) }
                    : {}),
            };

        } catch (err) {
            // describeAIError() unwraps Gemini's array-wrapped error body —
            // see services/AIProvider.js for why err.message alone was only
            // ever showing "404 status code (no body)" here, no matter what
            // actually went wrong (bad model name, bad key, quota).
            console.error('[VisualAnalyzer] analyzeWithVision error:', describeAIError(err));
            return ERROR_RESULT;
        }
    }

    /**
     * Analyse a still IMAGE with GPT-4o Vision — no ffmpeg, no frame
     * extraction, no temp files. Reuses the exact same analyzeWithVision()
     * call and JSON schema as video analysis (one frame instead of three)
     * so the result lands in the identical media_assets columns and
     * GET /api/brain/broll-profiles / place_contextual_broll need zero
     * changes to also match against images.
     *
     * @param {string} base64  - Raw base64-encoded image bytes (no data: URI prefix)
     * @returns {Promise<Object>} Visual analysis result (same shape as analyze())
     */
    async analyzeImageBase64(base64, { styleReference = false } = {}) {
        try {
            if (!base64) {
                console.warn('[VisualAnalyzer] analyzeImageBase64 called with no image data');
                return ERROR_RESULT;
            }
            if (!this.openai) {
                console.warn('[VisualAnalyzer] No OpenAI key — skipping image vision analysis');
                return { ...ERROR_RESULT, error: false, sceneType: 'unknown' };
            }

            return await this.analyzeWithVision([{ timestamp: 0, base64 }], 'image', { styleReference, durationSec: null });
        } catch (err) {
            console.error('[VisualAnalyzer] analyzeImageBase64 error:', err.message);
            return ERROR_RESULT;
        }
    }
}

module.exports = { VisualAnalyzer };
