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
    'pop':            ['glow-reveal', 'slide-up', 'flip-3d', 'glitch-stutter'], // scale entrance + glow flourish, lift, 3D flip, or micro-stutter
    'scale-reveal':   ['glow-reveal', 'flip-3d', 'glitch-stutter'],              // scale reveal + soft glow accent, 3D flip, or micro-stutter
    'blur-reveal':    ['fade', 'elastic-snap', 'flip-3d'],                      // focus-pull + fade, snap, or 3D tilt
    'glow-reveal':    ['slide-up', 'elastic-snap', 'flip-3d'],                  // glow + subtle lift, snap, or 3D tilt
    'fade':           ['blur-reveal', 'split-reveal', 'flip-3d'],               // plain fade + soft focus-pull, split reveal, or 3D tilt
    'mask-reveal':    ['slide-up', 'elastic-snap'],                             // wipe-reveal + lift or elastic bounce
    'slide-up':       ['fade', 'elastic-snap', 'glow-reveal'],                  // lift + fade, elastic bounce, or glow accent
    'flip-3d':        ['glow-reveal', 'slide-up', 'elastic-snap'],              // 3D rotation flip + glow accent, lift, or elastic snap
    'elastic-snap':   ['glow-reveal', 'glitch-stutter', 'slide-up'],            // damped spring snap + glow flash, micro-stutter, or lift
    'kinetic-slam':   ['camera-shake', 'glow-reveal', 'camera-whip'],           // high impact slam + camera shake, glow hit, or whip blur
    'split-reveal':   ['slide-up', 'glow-reveal', 'fade'],                      // split mask wipe + vertical lift, glow accent, or soft fade
    'glitch-stutter': ['glow-reveal', 'pulse', 'pop'],                          // rapid jitter + glow flare or pulsing scale

    // ── IMAGE (IMAGE_PRESETS) ──
    'reveal':    ['pan'],       // scale-in + a slow pan
    'ken-burns': ['float'],     // slow push + a gentle drift — premium, unhurried
    'zoom':      ['parallax'],  // punchy zoom + parallax drift
    'parallax':  ['zoom'],      // drift + a punch — reciprocal of 'zoom' above
    'pan':       ['reveal'],    // pan + a scale-in pop
    'float':     ['ken-burns'], // gentle drift + a slow push

    // ── STICKER (STICKER_PRESETS) ──
    'sticker-pop': ['wiggle', 'glitch-stutter'], // pop-in + playful wiggle or glitch
    'bounce':      ['pulse', 'elastic-snap'],   // bounce entrance + pulsing scale or elastic snap
    'shake':       ['pulse', 'glow-reveal'],    // comedic shake + pulse or glow accent
    'pulse':       ['wiggle', 'glitch-stutter'], // pulse + wiggle or stutter

    // ── CAMERA (CAMERA_PRESETS) ──
    'camera-push':  ['camera-whip', 'camera-shake'], // push-in + whip pan or impact shake
    'camera-shake': ['camera-zoom'],                 // shake + a punch zoom — stacked punch, for a hard hit
    'camera-zoom':  ['camera-shake'],                // punch zoom + shake — reciprocal of 'camera-shake' above
    'camera-pull':  ['camera-whip', 'camera-shake'], // pull-out + whip or settling shake
};

/** Preferred secondary animations tailored to each editing style */
const STYLE_SECONDARY_PREFERENCES = {
    talking_head: ['glow-reveal', 'slide-up', 'fade', 'blur-reveal', 'float'],
    reel:         ['elastic-snap', 'glitch-stutter', 'flip-3d', 'camera-shake', 'camera-zoom', 'pulse', 'wiggle'],
    vlog:         ['float', 'slide-up', 'glow-reveal', 'fade', 'ken-burns'],
    repurposing:  ['split-reveal', 'slide-up', 'glow-reveal', 'blur-reveal'],
    podcast:      ['fade', 'blur-reveal', 'float', 'glow-reveal'],
    explainer:    ['split-reveal', 'slide-up', 'glow-reveal', 'flip-3d'],
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
 * this primary has no curated pairing (e.g. a preset outside the curated map
 * or a bare/unknown id). Optionally style-aware when style parameter is provided.
 *
 * @param {?string} primaryPresetId
 * @param {string} seed — from computeStyleSeed
 * @param {?string} [style] — optional editing style ('talking_head', 'reel', 'vlog', etc.)
 * @returns {?string}
 */
function pickSecondaryPreset(primaryPresetId, seed, style = null) {
    if (!primaryPresetId) return null;
    const candidates = SECONDARY_PRESETS[primaryPresetId];
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    // If a known style preference exists and matches any candidate, bias selection towards it
    if (style && STYLE_SECONDARY_PREFERENCES[style]) {
        const preferred = STYLE_SECONDARY_PREFERENCES[style];
        const matches = candidates.filter(c => preferred.includes(c));
        if (matches.length > 0) {
            const idx = hashString(seed) % matches.length;
            return matches[idx];
        }
    }

    const idx = hashString(seed) % candidates.length;
    return candidates[idx];
}

module.exports = {
    SECONDARY_PRESETS,
    STYLE_SECONDARY_PREFERENCES,
    computeStyleSeed,
    pickSecondaryPreset,
};
