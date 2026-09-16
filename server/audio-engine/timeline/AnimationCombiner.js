'use strict';

/**
 * server/audio-engine/timeline/AnimationCombiner.js
 *
 * "Layer 3" continued — R81 stopped the brain from always picking the SAME
 * preset at the SAME magnitude for a given event type. This file stops it
 * from always picking a SINGLE preset, period. MotionResolver.js already
 * composites multiple simultaneous Animation entries on one clip per-property
 * (add/multiply/max/min — see MotionSchema.COMPOSITION_RULES), and that same
 * resolver drives live preview AND export (server/compositor/
 * CaptionCompiler.js, client/src/motion/CaptionCompiler.js both use it) — so
 * "layer two presets together" is not new rendering work, it's assembling two
 * Animation[] arrays that the existing renderer already knows how to combine.
 *
 * ─── WHY EXACTLY TWO, NOT THREE-OR-MORE ─────────────────────────────────────
 * A primary (R81's intensity-picked preset) plus ONE complementary secondary
 * from a DIFFERENT animation-type channel (scale+glow, translate+fade,
 * scale+rotate, ...) reliably reads as "one considered motion", not a pile-up.
 * Stacking a third risked a cluttered, un-premium result across combinations
 * nobody had actually looked at — two is the largest number this file commits
 * to without eyeballing every result.
 *
 * ─── THE COMBINATION MAP IS HAND-CURATED, NOT GENERATED ─────────────────────
 * Every value below is a REAL client/src/motion/MotionPresets.js preset id
 * (drift-checked in scripts/test_animation_combiner.js against the actual
 * MOTION_PRESETS keys), chosen deliberately from a channel the primary
 * doesn't already occupy — never two presets that both drive `scale`, for
 * instance, since MotionSchema's 'multiply' composition rule would compound
 * them into a result nobody designed. Only the 21 preset ids
 * AnimationKnowledgeGraph.js's ANIMATION_KNOWLEDGE_GRAPH actually resolves to
 * as a PRIMARY get an entry here — narrower than the full 26-preset library,
 * same scoping choice R81 and R79 both made before it (ship the curated
 * subset that's actually reachable, not a speculative full matrix). A
 * secondary VALUE may be a preset that's never itself a primary in the graph
 * (e.g. 'wiggle', 'camera-whip') — that's fine, it's still a real preset.
 *
 * ─── "STYLE/TOPIC" IS TWO FREE SIGNALS, NEVER A NEW PAID CALL ───────────────
 * `computeStyleSeed` builds its seed from (a) whatever text this SPECIFIC
 * event's own metadata already carries for free — the matched keyword/caption
 * text on REVEAL/EMOTIONAL_BEAT, the chapter label on CHAPTER_START (zero new
 * cost, same signals AnimationIntensity.js already reads) and (b) the
 * project's cached `tone` classification (server/brain/ProjectIntelligence.js
 * `getMap()`) WHEN IT ALREADY EXISTS for that project — a plain read of an
 * already-computed row, never a trigger for a fresh one. `getMap` is the only
 * ProjectIntelligence method this file (or anything that calls it) may use;
 * `ensureMap`/`deriveMap` call OpenAI and must never be reached from this
 * path — see the user's explicit, durable constraint recorded at CLAUDE.md's
 * R80 revert entry. scripts/test_animation_combiner.js asserts the route only
 * ever calls `getMap`.
 *
 * The seed is hashed deterministically (no Math.random anywhere in this
 * file) — the SAME event, on the SAME clip, in the SAME project, always
 * resolves to the SAME secondary. Re-running "animate automatically" on an
 * unchanged edit does not reshuffle combinations underneath the user.
 */

/**
 * Primary preset id → ordered list of complementary secondary preset ids,
 * each from a DIFFERENT animation-type channel than the primary. When a
 * primary has more than one candidate, `pickSecondaryPreset` chooses among
 * them by hashing the style seed — real variety, not a fixed always-first.
 *
 * @type {Record<string, string[]>}
 */
const SECONDARY_PRESETS = {
    // ── TEXT (client/src/motion/MotionPresets.js TEXT_PRESETS) ──
    'pop':          ['glow-reveal', 'slide-up'], // scale entrance + a glow flourish, or a lift
    'scale-reveal': ['glow-reveal'],              // scale reveal + a soft glow accent
    'blur-reveal':  ['fade'],                     // focus-pull + fade — gentle, for softer moments
    'glow-reveal':  ['slide-up'],                 // glow + a subtle lift
    'fade':         ['blur-reveal'],              // plain fade + a soft focus-pull (emotional_beat's gentlest pairing)
    'mask-reveal':  ['slide-up'],                 // wipe-reveal + a lift — the two chapter_transition candidates, now layered instead of chosen between
    'slide-up':     ['fade'],                     // lift + fade — gentle alternative when slide-up is the primary

    // ── IMAGE (IMAGE_PRESETS) ──
    'reveal':    ['pan'],       // scale-in + a slow pan
    'ken-burns': ['float'],     // slow push + a gentle drift — premium, unhurried
    'zoom':      ['parallax'],  // punchy zoom + parallax drift
    'parallax':  ['zoom'],      // drift + a punch — reciprocal of 'zoom' above
    'pan':       ['reveal'],    // pan + a scale-in pop
    'float':     ['ken-burns'], // gentle drift + a slow push

    // ── STICKER (STICKER_PRESETS) ──
    'sticker-pop': ['wiggle'], // pop-in + a playful wiggle
    'bounce':      ['pulse'],  // bounce entrance + a pulsing scale
    'shake':       ['pulse'],  // comedic shake + pulse (punchline/emphasis stickers)
    'pulse':       ['wiggle'], // pulse + wiggle

    // ── CAMERA (CAMERA_PRESETS) ──
    'camera-push':  ['camera-whip'],  // push-in + a whip pan
    'camera-shake': ['camera-zoom'],  // shake + a punch zoom — stacked punch, for a hard hit
    'camera-zoom':  ['camera-shake'], // punch zoom + shake — reciprocal of 'camera-shake' above
    'camera-pull':  ['camera-whip'],  // pull-out + a whip — "opening up" into a new topic
};

/** DJB2 string hash. Deterministic, no dependencies, never Math.random. */
function hashString(str) {
    let h = 5381;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) + h + s.charCodeAt(i)) | 0; // h*33 + c
    }
    return Math.abs(h);
}

/**
 * Build the deterministic seed a combination choice hashes against.
 *
 * @param {{eventType?: string, clipId?: ?string, metadata?: object}} event
 * @param {?string} [tone] — ProjectIntelligence's cached tone, or null when
 *   no project_intelligence row exists yet (never fetched fresh here — see
 *   file header).
 * @returns {string}
 */
function computeStyleSeed(event, tone) {
    const metadata = event?.metadata || {};
    const text = metadata.text || metadata.label || '';
    return [
        event?.eventType || '',
        event?.clipId || '',
        text,
        tone || 'neutral',
    ].join('|');
}

/**
 * Pick a complementary secondary preset id for a given primary, or null when
 * this primary has no curated pairing (e.g. a preset outside the 21 the
 * knowledge graph resolves to, or a bare/unknown id).
 *
 * @param {?string} primaryPresetId
 * @param {string} seed — from computeStyleSeed
 * @returns {?string}
 */
function pickSecondaryPreset(primaryPresetId, seed) {
    if (!primaryPresetId) return null;
    const candidates = SECONDARY_PRESETS[primaryPresetId];
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];
    const idx = hashString(seed) % candidates.length;
    return candidates[idx];
}

module.exports = {
    SECONDARY_PRESETS,
    computeStyleSeed,
    pickSecondaryPreset,
};
