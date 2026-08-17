/**
 * services/ReplicateSAM2Service.js
 *
 * R67 — Object Intelligence Integration, "separate speaker" step.
 *
 * Thin axios wrapper around Replicate's prediction API for a SAM2 (Segment
 * Anything Model 2) VIDEO segmentation model. This project has zero GPU and
 * no Python inference runtime in its deployed image (confirmed against the
 * real Dockerfile before writing this — see ADR-001 and CLAUDE.md R67), so a
 * real SAM2 call can only happen as a hosted-API call, never self-hosted.
 * Replicate is used here because it is the only vendor with a maintained
 * public SAM2-video endpoint at the time this was written; swapping vendors
 * later only touches this one file.
 *
 * WHAT THIS DOES NOT DO: choose a click point for the model. That is the
 * caller's job (jobs/objectSegmentationProcessor.js derives it from the
 * existing face-anchor detection this codebase already has for
 * virtual-multicam — see detectSceneLayout in routes/interviewRoutes.js —
 * rather than duplicating vision logic here).
 *
 * CONFIGURATION: this reads three env vars.
 *   REPLICATE_API_TOKEN    — required. No fallback: a missing token throws a
 *                             clear, typed error the job processor turns into
 *                             a "not configured" job failure rather than a
 *                             silent no-op (this codebase's fail-open pattern
 *                             is for OPTIONAL enhancements degrading; a
 *                             feature the user explicitly invoked getting
 *                             silently skipped would be worse than a clear
 *                             error — see CLAUDE.md's "count what you
 *                             mutated" principle applied to failure, not just
 *                             success).
 *   REPLICATE_SAM2_MODEL   — "owner/name" of the Replicate model to call.
 *                             Defaults to 'zsxkib/sam2-video', the
 *                             community SAM2-video model available on
 *                             Replicate as of this writing. VERIFY THIS
 *                             MODEL'S CURRENT INPUT SCHEMA on Replicate's
 *                             model page before first real use — Replicate
 *                             model input parameter names occasionally
 *                             change between versions, and this is the ONE
 *                             place that assumption lives (see
 *                             `buildPredictionInput` below).
 *   REPLICATE_SAM2_VERSION — optional pinned version hash. If unset, the
 *                             model's current default version is used
 *                             (Replicate resolves this from `model` alone
 *                             when `version` is omitted from the request).
 */

const axios = require('axios');

const REPLICATE_API_BASE = 'https://api.replicate.com/v1';
const DEFAULT_MODEL = 'zsxkib/sam2-video';
const POLL_INTERVAL_MS = 3000;
const DEFAULT_MAX_WAIT_MS = 8 * 60 * 1000; // SAM2 video inference is minutes, not seconds

function isConfigured() {
    return !!(process.env.REPLICATE_API_TOKEN && process.env.REPLICATE_API_TOKEN.trim());
}

function getClient() {
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token || !token.trim()) {
        throw new Error(
            'REPLICATE_API_TOKEN is not set. Object Intelligence (SAM2 speaker/background ' +
            'separation) requires a Replicate API token — create one at ' +
            'https://replicate.com/account/api-tokens and set REPLICATE_API_TOKEN.'
        );
    }
    return axios.create({
        baseURL: REPLICATE_API_BASE,
        headers: {
            Authorization: `Bearer ${token.trim()}`,
            'Content-Type': 'application/json',
        },
        timeout: 30_000,
    });
}

/**
 * Build the Replicate prediction input payload for a SAM2-video call.
 *
 * THE ONE PLACE MODEL-SPECIFIC PARAM NAMES LIVE. `zsxkib/sam2-video`'s
 * published schema (as of this writing) accepts a source video URL, a
 * frame index to click on, and pixel click coordinates on that frame,
 * returning a segmented/matted output video plus per-object mask data.
 * If the configured model's schema differs, this is the only function
 * that needs to change.
 *
 * @param {string} videoUrl - publicly-fetchable (signed) URL to the source video
 * @param {{x:number, y:number}} clickPoint - pixel coords of the click, on frame `clickFrame`
 * @param {number} clickFrame - which frame index the click coordinates apply to
 */
function buildPredictionInput(videoUrl, clickPoint, clickFrame = 0) {
    if (!videoUrl) throw new Error('buildPredictionInput: videoUrl is required');
    if (!clickPoint || typeof clickPoint.x !== 'number' || typeof clickPoint.y !== 'number') {
        throw new Error('buildPredictionInput: clickPoint {x,y} is required');
    }
    return {
        input_video: videoUrl,
        click_coordinates: `${Math.round(clickPoint.x)},${Math.round(clickPoint.y)}`,
        click_frames: String(clickFrame),
        click_labels: '1', // 1 = positive (foreground) click, SAM2's convention
        mask_type: 'highlighted', // ask for a usable alpha/highlight output, not just raw logits
        output_video: true,
    };
}

/**
 * Create a prediction (fire-and-forget — does not wait for completion).
 * Returns the raw Replicate prediction object ({ id, status, urls, ... }).
 */
async function createPrediction(videoUrl, clickPoint, clickFrame = 0) {
    const client = getClient();
    const model = process.env.REPLICATE_SAM2_MODEL || DEFAULT_MODEL;
    const version = process.env.REPLICATE_SAM2_VERSION;

    const body = {
        input: buildPredictionInput(videoUrl, clickPoint, clickFrame),
    };
    if (version) {
        body.version = version;
    } else {
        body.model = model;
    }

    try {
        const { data } = await client.post(
            version ? '/predictions' : `/models/${model}/predictions`,
            body
        );
        return data;
    } catch (err) {
        const detail = err.response?.data?.detail || err.response?.data?.error || err.message;
        throw new Error(`Replicate createPrediction failed: ${detail}`);
    }
}

/** Fetch the current state of a prediction by id. */
async function getPrediction(predictionId) {
    const client = getClient();
    try {
        const { data } = await client.get(`/predictions/${predictionId}`);
        return data;
    } catch (err) {
        const detail = err.response?.data?.detail || err.response?.data?.error || err.message;
        throw new Error(`Replicate getPrediction failed: ${detail}`);
    }
}

/**
 * Poll a prediction until it reaches a terminal state (succeeded/failed/canceled)
 * or `maxWaitMs` elapses. `onProgress(prediction)` is called after every poll so
 * callers (the BullMQ job) can update job.progress without duplicating the loop.
 */
async function waitForPrediction(predictionId, { maxWaitMs = DEFAULT_MAX_WAIT_MS, onProgress } = {}) {
    const startedAt = Date.now();
    let prediction = await getPrediction(predictionId);

    while (prediction.status === 'starting' || prediction.status === 'processing') {
        if (Date.now() - startedAt > maxWaitMs) {
            throw new Error(
                `Replicate prediction ${predictionId} did not finish within ${Math.round(maxWaitMs / 1000)}s ` +
                `(last status: ${prediction.status})`
            );
        }
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        prediction = await getPrediction(predictionId);
        if (typeof onProgress === 'function') {
            try { onProgress(prediction); } catch { /* progress callback errors must never abort the poll */ }
        }
    }

    if (prediction.status === 'failed') {
        throw new Error(`Replicate prediction ${predictionId} failed: ${prediction.error || 'unknown error'}`);
    }
    if (prediction.status === 'canceled') {
        throw new Error(`Replicate prediction ${predictionId} was canceled`);
    }
    return prediction; // status === 'succeeded'
}

module.exports = {
    isConfigured,
    createPrediction,
    getPrediction,
    waitForPrediction,
    buildPredictionInput, // exported for unit testing without a network call
};
