/**
 * Engagement Scoring Engine — Viral Pilot Phase 7
 *
 * Aggregates hook, pacing, emotion, structure, and platform fit scores
 * into a single viral engagement score (0–100) with a tier label and
 * a detailed breakdown for UI display.
 *
 * Tiers:
 *   VIRAL  — score ≥ 80
 *   HIGH   — score ≥ 65
 *   MEDIUM — score ≥ 45
 *   LOW    — score < 45
 */

// Weighted contribution of each signal to the final score
const WEIGHTS = {
    hook:        0.30,  // First impression is critical for short-form
    pacing:      0.20,  // Editing rhythm matters a lot
    emotion:     0.20,  // Emotional resonance drives sharing
    structure:   0.15,  // Good structure aids retention
    platformFit: 0.15   // Alignment with the best-fit platform
};

/**
 * Compute the engagement score.
 *
 * @param {Object} signals
 * @param {Object} signals.hook        - Result from analyzeHook()
 * @param {Object} signals.pacing      - Result from scorePacing()
 * @param {Object} signals.emotion     - Result from analyzeEmotion()
 * @param {Object} signals.structure   - Result from analyzeStructure()
 * @param {Object} signals.platformFit - Result from calculatePlatformFit()
 * @returns {Object} Engagement result
 */
function computeEngagementScore(signals) {
    const { hook, pacing, emotion, structure, platformFit } = signals;

    // Extract raw scores, defaulting to 50 if absent
    const hookScore      = hook?.score ?? 50;
    const pacingScore    = pacing?.score ?? 50;
    const emotionScore   = emotion?.score ?? 50;
    const structureScore = structure?.score ?? 50;

    // Best platform score = highest of all platforms
    const bestPlatformScore = platformFit
        ? Math.max(...Object.values(platformFit).filter(v => typeof v === 'number'))
        : 50;

    // Weighted aggregate
    const rawScore =
        hookScore      * WEIGHTS.hook        +
        pacingScore    * WEIGHTS.pacing      +
        emotionScore   * WEIGHTS.emotion     +
        structureScore * WEIGHTS.structure   +
        bestPlatformScore * WEIGHTS.platformFit;

    const finalScore = Math.round(Math.min(100, Math.max(0, rawScore)));

    // ── Tier ──────────────────────────────────────────────────────────
    let tier;
    if      (finalScore >= 80) tier = 'VIRAL';
    else if (finalScore >= 65) tier = 'HIGH';
    else if (finalScore >= 45) tier = 'MEDIUM';
    else                       tier = 'LOW';

    // ── Tier color (for UI) ───────────────────────────────────────────
    const tierColors = {
        VIRAL:  '#a855f7',  // Purple
        HIGH:   '#22c55e',  // Green
        MEDIUM: '#f59e0b',  // Amber
        LOW:    '#ef4444'   // Red
    };

    // ── Breakdown (for UI display) ────────────────────────────────────
    const breakdown = [
        {
            label: 'Hook',
            score: hookScore,
            weight: WEIGHTS.hook,
            contribution: Math.round(hookScore * WEIGHTS.hook),
            grade: hook?.grade || gradeFromScore(hookScore),
            suggestion: hook?.suggestion || null
        },
        {
            label: 'Pacing',
            score: pacingScore,
            weight: WEIGHTS.pacing,
            contribution: Math.round(pacingScore * WEIGHTS.pacing),
            grade: gradeFromScore(pacingScore),
            suggestion: pacing?.feedback || null
        },
        {
            label: 'Emotion',
            score: emotionScore,
            weight: WEIGHTS.emotion,
            contribution: Math.round(emotionScore * WEIGHTS.emotion),
            grade: gradeFromScore(emotionScore),
            suggestion: emotion?.feedback || null
        },
        {
            label: 'Structure',
            score: structureScore,
            weight: WEIGHTS.structure,
            contribution: Math.round(structureScore * WEIGHTS.structure),
            grade: gradeFromScore(structureScore),
            suggestion: structure?.feedback || null
        },
        {
            label: 'Platform Fit',
            score: bestPlatformScore,
            weight: WEIGHTS.platformFit,
            contribution: Math.round(bestPlatformScore * WEIGHTS.platformFit),
            grade: gradeFromScore(bestPlatformScore),
            suggestion: null
        }
    ];

    // ── Top 3 action items ───────────────────────────────────────────
    const actionItems = generateActionItems(signals, breakdown, tier);

    return {
        score: finalScore,
        tier,
        tierColor: tierColors[tier],
        breakdown,
        actionItems,
        weights: WEIGHTS
    };
}

/**
 * Generate top 3 prioritised action items from the analysis.
 */
function generateActionItems(signals, breakdown, tier) {
    const items = [];
    const { hook, pacing, emotion, structure } = signals;

    // Sort breakdown by lowest score (biggest opportunity)
    const sorted = [...breakdown].sort((a, b) => a.score - b.score);

    for (const signal of sorted) {
        if (items.length >= 3) break;
        if (signal.score < 70 && signal.suggestion) {
            items.push({
                priority: items.length + 1,
                area: signal.label,
                action: signal.suggestion,
                impact: signal.weight >= 0.25 ? 'HIGH' : signal.weight >= 0.15 ? 'MEDIUM' : 'LOW'
            });
        }
    }

    // Add dead moment action if present
    if (pacing?.deadMoments?.length > 0 && items.length < 3) {
        const highSeverity = pacing.deadMoments.filter(dm => dm.severity === 'HIGH');
        if (highSeverity.length > 0) {
            items.push({
                priority: items.length + 1,
                area: 'Dead Moments',
                action: `Remove or re-energise ${highSeverity.length} dead segment(s) — the longest is at ${highSeverity[0].start.toFixed(1)}s.`,
                impact: 'HIGH'
            });
        }
    }

    return items;
}

function gradeFromScore(score) {
    if (score >= 85) return 'A';
    if (score >= 70) return 'B';
    if (score >= 50) return 'C';
    return 'F';
}

module.exports = { computeEngagementScore };
