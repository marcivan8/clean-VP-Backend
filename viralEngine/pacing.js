/**
 * Pacing & Dead Moment Engine — Viral Pilot Phase 7
 *
 * Scores pacing and detects dead moments — segments where energy, speech,
 * and visual activity all drop below thresholds simultaneously.
 *
 * @param {Object} pacingData - Output from pacingAnalyzer.js
 * @param {string} platform   - Target platform (optional)
 * @param {Object} rawData    - Full multimodal data for dead moment detection
 * @returns {Object} - Pacing score, feedback, and deadMoments[]
 */
function scorePacing(pacingData, platform = 'general', rawData = {}) {
    const { averageShotLength, cutsPerMinute, pacingScore, shotLengths } = pacingData;
    const { audioAnalysis, visualAnalysis, duration } = rawData;

    let score = pacingScore;
    let feedback = '';

    // ── Platform-adjusted pacing feedback ──────────────────────────────
    if (platform === 'TikTok' || platform === 'YouTubeShorts' || platform === 'Instagram') {
        if (averageShotLength > 5) {
            score -= 20;
            feedback = 'Pacing is too slow for short-form content. Aim for cuts every 2–3 seconds.';
        } else if (averageShotLength < 1.5) {
            score += 5;
            feedback = 'Excellent fast pacing — great for retention.';
        } else {
            feedback = 'Good pacing for this platform.';
        }
    } else if (platform === 'YouTube') {
        if (averageShotLength < 2) {
            feedback = 'Pacing might be too fast for long-form. Ensure viewers can follow.';
        } else if (averageShotLength > 10) {
            score -= 10;
            feedback = 'Consider adding B-roll or cuts to maintain visual interest.';
        } else {
            feedback = 'Comfortable pacing for long-form content.';
        }
    }

    // ── Dead Moment Detection ───────────────────────────────────────────
    const deadMoments = detectDeadMoments(audioAnalysis, visualAnalysis, duration);

    // Penalise score for dead moments
    if (deadMoments.length > 0) {
        const totalDeadTime = deadMoments.reduce((sum, dm) => sum + (dm.end - dm.start), 0);
        const deadPct = duration > 0 ? totalDeadTime / duration : 0;

        if (deadPct > 0.3) {
            score -= 20;
            feedback += ' ⚠ Over 30% of the video has low engagement moments — consider heavy cuts.';
        } else if (deadPct > 0.1) {
            score -= 10;
            feedback += ' Consider trimming low-energy segments.';
        }
    }

    return {
        score: Math.min(100, Math.max(0, score)),
        feedback,
        metrics: {
            averageShotLength,
            cutsPerMinute
        },
        deadMoments
    };
}

/**
 * Detect dead moments in a video.
 * A dead moment is a window where BOTH audio energy AND visual activity are low.
 *
 * @param {Object} audioAnalysis  - Audio analysis data
 * @param {Object} visualAnalysis - Visual analysis data
 * @param {number} duration       - Video duration in seconds
 * @returns {Array} deadMoments   - [{ start, end, severity, reasons }]
 */
function detectDeadMoments(audioAnalysis, visualAnalysis, duration) {
    if (!duration || duration <= 0) return [];

    const WINDOW_SIZE = 2;  // seconds per analysis window
    const STEP        = 1;  // sliding step in seconds
    const deadMoments = [];

    const audioSegments    = audioAnalysis?.segments || [];
    const sceneBoundaries  = visualAnalysis?.sceneBoundaries || [];
    const frames           = visualAnalysis?.frames || [];

    // Pre-build lookup: for each window, is there speech?
    const hasSpeechAt = (start, end) =>
        audioSegments.some(s => s.start < end && (s.start + (s.duration || 2)) > start && s.text?.length > 0);

    // Is there a scene cut in this window?
    const hasCutAt = (start, end) =>
        sceneBoundaries.some(t => t >= start && t < end);

    // Is there a face in this window?
    const hasFaceAt = (start, end) =>
        frames.some(f => f.time >= start && f.time < end && f.facesDetected > 0);

    let pendingStart = null;
    let pendingReasons = [];

    for (let t = 0; t + WINDOW_SIZE <= duration; t += STEP) {
        const wStart = t;
        const wEnd   = t + WINDOW_SIZE;

        const speech = hasSpeechAt(wStart, wEnd);
        const cut    = hasCutAt(wStart, wEnd);
        const face   = hasFaceAt(wStart, wEnd);

        const isDeadWindow = !speech && !cut && !face;

        if (isDeadWindow) {
            const reasons = [];
            if (!speech) reasons.push('no_speech');
            if (!cut)    reasons.push('no_visual_cut');
            if (!face)   reasons.push('no_face');

            if (pendingStart === null) {
                pendingStart   = wStart;
                pendingReasons = reasons;
            }
            // Extend current dead zone
        } else {
            // Close pending dead zone
            if (pendingStart !== null) {
                const end = t + STEP;
                const length = end - pendingStart;
                if (length >= 1.5) { // Only report moments > 1.5s
                    deadMoments.push({
                        start: parseFloat(pendingStart.toFixed(2)),
                        end:   parseFloat(end.toFixed(2)),
                        length: parseFloat(length.toFixed(2)),
                        severity: length > 5 ? 'HIGH' : length > 3 ? 'MEDIUM' : 'LOW',
                        reasons: pendingReasons
                    });
                }
                pendingStart = null;
                pendingReasons = [];
            }
        }
    }

    // Close any trailing dead zone
    if (pendingStart !== null) {
        const end    = duration;
        const length = end - pendingStart;
        if (length >= 1.5) {
            deadMoments.push({
                start: parseFloat(pendingStart.toFixed(2)),
                end:   parseFloat(end.toFixed(2)),
                length: parseFloat(length.toFixed(2)),
                severity: length > 5 ? 'HIGH' : length > 3 ? 'MEDIUM' : 'LOW',
                reasons: pendingReasons
            });
        }
    }

    return deadMoments;
}

module.exports = { scorePacing, detectDeadMoments };
