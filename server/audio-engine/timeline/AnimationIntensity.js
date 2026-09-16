'use strict';

/**
 * server/audio-engine/timeline/AnimationIntensity.js
 *
 * "Layer 3" — the zero-cost, rule-based bespoke animation synthesizer.
 *
 * ─── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 * R68/R79's pipeline (TimelineEventDetector.js → AnimationKnowledgeGraph.js →
 * `/api/audio/animate-automatically` → MediaExecutionEngine.js →
 * ClipAdapter.applyPresetToClip) always picked `animationsForEventType(...)[0]`
 * — the SAME preset, at the SAME fixed magnitude, for every instance of a
 * given semantic event. Two EMPHASIS_MOMENT events — one a barely-qualifying
 * loud line, one a genuine shout — got byte-identical animations. That's a
 * near-good feature doing basic static animation, not a brain that reacts to
 * what actually happened in the footage.
 *
 * This file closes that gap using signals the detector ALREADY computes —
 * no new detection logic, no LLM call, no external service, $0 forever (the
 * user's explicit, durable constraint — see CLAUDE.md R80's revert entry):
 *   PUNCHLINE_DETECTED → metadata.db (loudness) + metadata.silenceGapS (the
 *                        setup pause before the payoff)
 *   EMPHASIS_MOMENT     → metadata.db
 *   EMOTIONAL_BEAT      → metadata.durationS (how long the pause held)
 *   REVEAL              → metadata.zoomLevel when the push-in variant fired;
 *                        the keyword variant carries no numeric signal
 *   CHAPTER_START        → no numeric signal exists yet (marker/label only)
 *
 * Each is normalized to a 0..1 `intensity` against the SAME threshold
 * constants TimelineEventDetector.js already uses to decide the event fires
 * at all (PUNCHLINE_PEAK_DB, EMPHASIS_PEAK_DB, EMOTIONAL_SILENCE_S,
 * REVEAL_ZOOM_THRESHOLD) — this file does not invent new cutoffs, it scales
 * against the ones the detector already committed to.
 *
 * `intensity` is DELIBERATELY centered so 0.5 is neutral: every consumer of
 * this value (client/src/motion/AnimationSynthesizer.js's `scaleAnimations`)
 * treats 0.5 as "apply the preset exactly as authored" — so an event with no
 * usable signal (missing metadata, the keyword REVEAL variant, a chapter
 * transition) falls back to 0.5 and reproduces the EXACT pre-Layer-3 output,
 * byte for byte. That is what keeps this an additive, low-risk change: every
 * existing caller/test that never passed metadata keeps working unmodified.
 */

const { TimelineEventType } = require('../types.js');

// Mirrors TimelineEventDetector.js's own thresholds — kept in sync manually
// (like layerKindForClip's deliberate duplication below) because this file
// only cares about the NORMALIZATION range, not the fire/no-fire decision
// itself, which stays the detector's job alone.
const PUNCHLINE_PEAK_DB   = -8;   // TimelineEventDetector.PUNCHLINE_PEAK_DB — the floor a punchline can fire at
const EMPHASIS_PEAK_DB    = -4;   // TimelineEventDetector.EMPHASIS_PEAK_DB — the floor emphasis can fire at
const LOUDEST_DB          = 0;    // 0dBFS — full scale, the ceiling for both
const PUNCHLINE_GAP_CEILING_S = 1.2; // TimelineEventDetector.PUNCHLINE_PEAK_WINDOW_S — the widest qualifying gap
const EMOTIONAL_SILENCE_FLOOR_S   = 1.0; // TimelineEventDetector.EMOTIONAL_SILENCE_S — the shortest qualifying pause
const EMOTIONAL_SILENCE_CEILING_S = 3.0; // a pause this long already reads as maximally weighted — design choice, not a hard limit anywhere else
const REVEAL_ZOOM_FLOOR   = 1.3;  // TimelineEventDetector.REVEAL_ZOOM_THRESHOLD — the smallest qualifying push-in
const REVEAL_ZOOM_CEILING = 2.0;  // a push this big already reads as a maximal reveal — design choice

/** Neutral fallback — see file header: 0.5 must reproduce the pre-Layer-3 preset exactly. */
const NEUTRAL_INTENSITY = 0.5;

const clamp01 = (n) => Math.max(0, Math.min(1, n));

/** Linearly map `value` from [floor, ceiling] to [0, 1], clamped at both ends. */
function normalize(value, floor, ceiling) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    if (ceiling === floor) return null;
    return clamp01((value - floor) / (ceiling - floor));
}

/**
 * Compute a 0..1 intensity for one detected event, from whatever real signal
 * its `metadata` already carries. Returns NEUTRAL_INTENSITY (0.5) whenever no
 * usable signal exists — see file header for why that's the safe default.
 *
 * Pure, synchronous, no dependencies beyond the constants above.
 *
 * @param {string} eventType — a TimelineEventType value
 * @param {object} [metadata] — the event's own `metadata`, as TimelineEventDetector.js produces it
 * @returns {number} 0..1
 */
function computeIntensity(eventType, metadata) {
    const meta = metadata || {};

    switch (eventType) {
        case TimelineEventType.PUNCHLINE_DETECTED: {
            const dbIntensity  = normalize(meta.db, PUNCHLINE_PEAK_DB, LOUDEST_DB);
            const gapIntensity = normalize(meta.silenceGapS, 0, PUNCHLINE_GAP_CEILING_S);
            // A punchline is bigger both the louder the payoff lands AND the more
            // deliberate the pause before it was — average the two so neither
            // alone can swing intensity to an extreme off a single noisy reading.
            const parts = [dbIntensity, gapIntensity].filter((v) => v !== null);
            if (parts.length === 0) return NEUTRAL_INTENSITY;
            return parts.reduce((a, b) => a + b, 0) / parts.length;
        }

        case TimelineEventType.EMPHASIS_MOMENT: {
            const dbIntensity = normalize(meta.db, EMPHASIS_PEAK_DB, LOUDEST_DB);
            return dbIntensity === null ? NEUTRAL_INTENSITY : dbIntensity;
        }

        case TimelineEventType.EMOTIONAL_BEAT: {
            const durationIntensity = normalize(meta.durationS, EMOTIONAL_SILENCE_FLOOR_S, EMOTIONAL_SILENCE_CEILING_S);
            return durationIntensity === null ? NEUTRAL_INTENSITY : durationIntensity;
        }

        case TimelineEventType.REVEAL: {
            // Only the push-in variant carries a numeric signal (zoomLevel).
            // The keyword variant ({ via: 'keyword', text }) has nothing to
            // scale off honestly — neutral, not a guess.
            if (meta.via !== 'push-in') return NEUTRAL_INTENSITY;
            const zoomIntensity = normalize(meta.zoomLevel, REVEAL_ZOOM_FLOOR, REVEAL_ZOOM_CEILING);
            return zoomIntensity === null ? NEUTRAL_INTENSITY : zoomIntensity;
        }

        case TimelineEventType.CHAPTER_START:
            // R79's retargeting only ever adds { markerClipId, label } — no
            // loudness/duration/zoom signal exists for a topic change yet.
            // Recorded here plainly rather than silently guessing.
            return NEUTRAL_INTENSITY;

        default:
            return NEUTRAL_INTENSITY;
    }
}

/**
 * Pick which priority-ordered candidate preset id to use for a given
 * intensity. AnimationKnowledgeGraph.js's own header already documents its
 * `animations` arrays as "priority-ordered" — this is the first caller that
 * actually uses the ordering as anything other than "take index 0".
 *
 * Deliberately a plain binary split, not a fake continuous "AI" choice: at
 * or above the neutral midpoint, use the primary (fuller/more assertive)
 * preset; below it, drop to the next one down when the event's family
 * actually offers an alternate. This stays honest about being a heuristic,
 * matching this codebase's stated approach everywhere else in this pipeline.
 *
 * @param {string[]} candidates — animationsForEventType(...)'s return value
 * @param {number} intensity — 0..1, from computeIntensity
 * @returns {string|null}
 */
function pickPresetForIntensity(candidates, intensity) {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];
    const clamped = typeof intensity === 'number' && Number.isFinite(intensity) ? intensity : NEUTRAL_INTENSITY;
    return clamped >= NEUTRAL_INTENSITY ? candidates[0] : candidates[1];
}

module.exports = {
    NEUTRAL_INTENSITY,
    computeIntensity,
    pickPresetForIntensity,
};
