/**
 * server/knowledge/vibedMotionKnowledge.js
 *
 * VIBED Motion & Video Knowledge Library - Version 1.1.0
 *
 * Synthesizes the core architectural principles, motion recipes, and AI guidance from:
 *   1. Remotion prompt-to-motion: 2-stage classification, modular skill injection,
 *      constants-first architecture, responsive layout formulas, follow-up editing.
 *   2. Animation Techniques Kit: 33-technique intent cookbook, reference-match loop,
 *      measured contracts, kinetic text, emphasis hits, camera reframes, dataviz.
 *   3. Motion Canvas: scene orchestration coroutines (all, sequence, chain),
 *      vector path animation, stroke dash trim, spatial anchors, reactive primitives.
 *   4. Motion for React & JS (Motion Division): spring physics solver, bounce-to-damping
 *      SwiftUI mapping, relative timeline sequencing (<, +delta, -delta), multi-origin staggers.
 *   5. Official Remotion Agent Skills: frame-driven determinism, explicit DOs/DON'Ts,
 *      individual transform properties, seconds-to-frames timing contracts.
 *   6. Marketing Videos: reference-video analysis, hook architecture (0-2.5s),
 *      kinetic proof/metric reveals, feature callout cadence, audio/SFX synchronization.
 *
 * Pure, deterministic, dependency-free.
 */

'use strict';

const VIBED_MOTION_KNOWLEDGE_VERSION = '1.1.0';

/**
 * ─── 1. SKILL SELECTORS & INTENT CLASSIFICATION ─────────────────────────────
 * Maps creator prompts and briefs into modular knowledge domains so prompts receive
 * targeted, high-signal guidance without context bloat.
 */

const SKILL_DOMAINS = Object.freeze({
    HOOK_TITLE:       'hook-title',
    KINETIC_TYPE:     'kinetic-type',
    METRIC_STAT:      'metric-stat',
    FEATURE_CARD:     'feature-card',
    SOCIAL_SHORT:     'social-short',
    MARKETING_STORY:  'marketing-story',
    CALL_TO_ACTION:   'call-to-action',
    SPRING_PHYSICS:   'spring-physics',
    CAMERA_MOVE:      'camera-move',
    EMPHASIS_ACCENT:  'emphasis-accent',
    SCENE_TRANSITION: 'scene-transition',
    DEVICE_MOCKUP:    'device-mockup',
});

const INTENT_PATTERNS = [
    {
        domain: SKILL_DOMAINS.HOOK_TITLE,
        regex: /\b(hook|headline|opening|intro|titre|accroche|first second|stop scrolling|attention|slam|punchy title)\b/i,
        weight: 1.2,
    },
    {
        domain: SKILL_DOMAINS.KINETIC_TYPE,
        regex: /\b(typewriter|kinetic|word reveal|word carousel|text animation|type-on|karaoke|subtitles|quote|highlight|words|stagger)\b/i,
        weight: 1.1,
    },
    {
        domain: SKILL_DOMAINS.METRIC_STAT,
        regex: /\b(\d+([.,]\d+)?%|\d+x|[\$€£]\d+|\bnumber|chiffre|stat|stats|metric|growth|results?|retention|conversion|chart|graph|odometer|progress ring)\b/i,
        weight: 1.3,
    },
    {
        domain: SKILL_DOMAINS.FEATURE_CARD,
        regex: /\b(steps?|raisons?|benefits?|features?|cards?|points?|avantages?|list|grid|comparison|before after|stack)\b/i,
        weight: 1.0,
    },
    {
        domain: SKILL_DOMAINS.SOCIAL_SHORT,
        regex: /\b(tiktok|reels?|shorts?|vertical|9:16|mobile|instagram|feed|viral|creator)\b/i,
        weight: 1.0,
    },
    {
        domain: SKILL_DOMAINS.MARKETING_STORY,
        regex: /\b(saas|product|launch|explain|demo|presentation|commercial|ad|problem|solution|workflow|founder|brand)\b/i,
        weight: 1.1,
    },
    {
        domain: SKILL_DOMAINS.CALL_TO_ACTION,
        regex: /\b(cta|call to action|subscribe|follow|sign up|try|get started|telecharger|decouvrez|visitez|link in bio|outro|close)\b/i,
        weight: 1.2,
    },
    {
        domain: SKILL_DOMAINS.CAMERA_MOVE,
        regex: /\b(camera|zoom|push-in|pull-back|pan|dolly|parallax|rack focus|ken burns|reframe)\b/i,
        weight: 1.1,
    },
    {
        domain: SKILL_DOMAINS.EMPHASIS_ACCENT,
        regex: /\b(emphasize|underline|highlight|glow|bloom|spark|particle|ripple|press|accent|celebrate)\b/i,
        weight: 1.2,
    },
    {
        domain: SKILL_DOMAINS.SCENE_TRANSITION,
        regex: /\b(transition|morph|cut|dissolve|match-cut|defocus|whip-pan|smear|handoff|scene change)\b/i,
        weight: 1.1,
    },
    {
        domain: SKILL_DOMAINS.DEVICE_MOCKUP,
        regex: /\b(phone|screen|mockup|device|app demo|scroll inside|isometric|bezel|frame)\b/i,
        weight: 1.1,
    },
];

/**
 * Classify a brief into matching skill domains with confidence scores.
 *
 * @param {string} prompt - Raw brief or user request
 * @param {object} [context] - Optional video context (platform, transcript, duration)
 * @returns {Array<{ domain: string, score: number }>}
 */
function classifyPromptSkills(prompt = '', context = {}) {
    const text = `${prompt} ${context.transcript || ''} ${context.platform || ''}`.trim();
    if (!text) return [{ domain: SKILL_DOMAINS.MARKETING_STORY, score: 0.5 }];

    const scores = new Map();

    for (const { domain, regex, weight } of INTENT_PATTERNS) {
        const matches = text.match(new RegExp(regex.source, 'gi'));
        if (matches) {
            const count = matches.length;
            scores.set(domain, (scores.get(domain) || 0) + count * weight);
        }
    }

    // Always include spring physics for natural motion if any animation domain matched
    if (scores.size > 0 && !scores.has(SKILL_DOMAINS.SPRING_PHYSICS)) {
        scores.set(SKILL_DOMAINS.SPRING_PHYSICS, 1.0);
    }

    // Default to marketing story and hook if nothing matched
    if (scores.size === 0) {
        scores.set(SKILL_DOMAINS.MARKETING_STORY, 1.0);
        scores.set(SKILL_DOMAINS.HOOK_TITLE, 0.9);
        scores.set(SKILL_DOMAINS.SPRING_PHYSICS, 0.8);
    }

    return Array.from(scores.entries())
        .map(([domain, score]) => ({ domain, score: Number(score.toFixed(2)) }))
        .sort((a, b) => b.score - a.score);
}

/**
 * ─── 2. PRACTICAL ANIMATION RECIPES & PHYSICS CONSTANTS ──────────────────────
 * Concrete mathematical parameters, easing curves, and layout formulas.
 */

const SPRING_PRESETS = Object.freeze({
    SNAPPY: {
        id: 'snappy',
        damping: 20,
        stiffness: 200,
        mass: 1.0,
        useCase: 'UI elements, cards, and rapid kinetic switches where bounce would cause delay',
        overshoot: 1.04,
    },
    BOUNCY: {
        id: 'bouncy',
        damping: 8,
        stiffness: 120,
        mass: 1.0,
        useCase: 'Stickers, playful callouts, badges, and attention-grabbing accents',
        overshoot: 1.18,
    },
    SMOOTH: {
        id: 'smooth',
        damping: 180,
        stiffness: 100,
        mass: 1.0,
        useCase: 'Subtle corporate / luxury reveals, opacity crossfades, background drifts',
        overshoot: 1.0,
    },
    HEAVY: {
        id: 'heavy',
        damping: 15,
        stiffness: 70,
        mass: 2.2,
        useCase: 'Large structural hero items, massive titles, high-inertia camera impacts',
        overshoot: 1.10,
    },
    POP: {
        id: 'pop',
        damping: 12,
        stiffness: 160,
        mass: 0.8,
        useCase: 'Number pops, stat badges, word emphasis tags',
        overshoot: 1.14,
    },
});

const ANIMATION_RECIPES = Object.freeze({
    // 1. Kinetic Headline Slam
    HOOK_SLAM: {
        id: 'hook_slam',
        domain: SKILL_DOMAINS.HOOK_TITLE,
        title: 'Kinetic Slam Headline',
        verbs: { enter: 'slam-in', emphasis: 'punch', exit: 'whip-out' },
        timing: { enterFrames: 12, holdFrames: 45, exitFrames: 8 },
        principles: [
            'Initial scale starts at 2.4x with slight blur (12px), snapping to 1.0x with snappy spring.',
            'Overshoot serves as reverse anticipation: no pre-entry delay.',
            'Exit whips laterally (-120% X) over 6-8 frames before next scene arrives.',
        ],
    },

    // 2. Typewriter with String Slicing & Smooth Blink
    TYPEWRITER_PRECISION: {
        id: 'typewriter_precision',
        domain: SKILL_DOMAINS.KINETIC_TYPE,
        title: 'Precision Typewriter with Smooth Blink',
        verbs: { enter: 'typewriter', emphasis: 'nod', exit: 'fade-out' },
        principles: [
            'Always use string slicing (text.slice(0, count)): NEVER per-character opacity, which breaks cursor flow.',
            'Smooth caret blink uses cosine/sine curve over 16 frames, never binary 0/1 flash.',
            'Hold finished text for at least 1.2s so viewers comfortably absorb the statement.',
        ],
    },

    // 3. Counter Roll & Metric Reveal
    METRIC_COUNTER_ROLL: {
        id: 'metric_counter_roll',
        domain: SKILL_DOMAINS.METRIC_STAT,
        title: 'Impact Metric & Counter Roll',
        verbs: { enter: 'pop-in', emphasis: 'pulse', exit: 'shrink-out' },
        timing: { countUpFrames: 24, settleFrames: 30 },
        principles: [
            'Value counts up with easeOutExpo or snappy spring from 0 to target.',
            'Accompany the metric with a short, 2-to-4-word kicker label positioned above or below.',
            'Always maintain fixed tabular-nums or container width to prevent layout jitter as digits roll.',
            'Trigger an audio impact or click sound exactly as the counter hits the target value.',
        ],
    },

    // 4. Staggered Feature Cards with Depth Sandwiching
    FEATURE_CARD_STACK: {
        id: 'feature_card_stack',
        domain: SKILL_DOMAINS.FEATURE_CARD,
        title: 'Staggered Card Stack with Depth Hierarchy',
        verbs: { enter: 'rise-in', emphasis: null, exit: 'sink-out' },
        staggerSeconds: 0.12,
        principles: [
            'Sibling cards stagger by 3-5 frames (0.10s-0.16s), not all at once.',
            'Backdrop arrives first with lower energy; card contents land 3 frames later.',
            'Reverse-stagger exits: last card in leaves FIRST so cards do not disappear on the same frame.',
        ],
    },

    // 5. Magnetic Call to Action
    MAGNETIC_CTA: {
        id: 'magnetic_cta',
        domain: SKILL_DOMAINS.CALL_TO_ACTION,
        title: 'Magnetic High-Conversion CTA',
        verbs: { enter: 'rise-in', emphasis: 'pulse', exit: 'fade-out' },
        principles: [
            'Decelerates from high-energy sequence into calm, focused resolution.',
            'Clean brand lockup with high contrast button (WCAG compliant >= 4.5:1).',
            'Subtle continuous pulse (scale 1.0 to 1.03 via sine wave) draws eye directly to action.',
        ],
    },
});

/**
 * ─── 3. MOTION CANVAS & MOTION DIVISION ORCHESTRATION MECHANICS ─────────────
 * Coroutines, relative timeline sequencing, vector trim paths, and spatial anchors.
 */

const ORCHESTRATION_MECHANICS = Object.freeze({
    // Coroutine execution flow (inspired by Motion Canvas)
    FLOW: {
        ALL: 'all',          // run parallel concurrent branches (yield* all(...))
        SEQUENCE: 'sequence', // run staggered serial sequences with fixed delay
        CHAIN: 'chain',      // strictly sequential execution (step 1 then step 2)
        WAIT_FOR: 'waitFor', // explicit frame/second rest hold
    },

    // Relative timeline operators (inspired by Motion / Framer Motion)
    TIMING_OPERATORS: {
        SAME_TIME: '<',      // start simultaneously with previous item start
        RELATIVE_AFTER: '+', // start +delta seconds after previous item finishes
        RELATIVE_BEFORE: '-',// start -delta seconds before previous item finishes (lead-in/overlap)
    },

    // Multi-directional stagger origins
    STAGGER_ORIGINS: {
        FIRST: 'first',      // index 0 -> N-1
        LAST: 'last',        // index N-1 -> 0 (essential for reverse-stagger exits)
        CENTER: 'center',    // ripple outwards from center item
        EDGES: 'edges',      // converge inwards from outside items
    },

    // Vector Trim Path & Morphing formulas
    VECTOR_TRIM_PATH: {
        formula: 'strokeDashoffset = pathLength * (1 - progress)',
        usage: 'Hand-drawn underlines, progress rings, and growth curve line draw-ons',
    },

    // Spatial Anchors for 2D Camera & Layout
    SPATIAL_ANCHORS: {
        TOP_LEFT: [-1, -1],
        TOP_CENTER: [0, -1],
        CENTER: [0, 0],
        BOTTOM_CENTER: [0, 1],
        CTA_CORNER: [0.78, 0.22],
    },
});

/**
 * ─── 4. SEARCHABLE INTENT-TO-TECHNIQUE COOKBOOK (~33 TECHNIQUES) ────────────
 * Mapped from Animation Techniques Kit by creative intention.
 */

const INTENT_TECHNIQUE_RECIPES = Object.freeze({
    // ── Category A: Kinetic Typography ──
    SEQUENTIAL_WORD_STAGGER: {
        id: 'sequential_word_stagger',
        intentCategory: 'kinetic_typography',
        intent: 'safe legible value-prop headline',
        displayName: 'Sequential Word/Line Stagger',
        feel: 'Words fade-rise in with calm dwell',
        timing: { enterFrames: 14, staggerFrames: 3, holdFrames: 45 },
        verbs: { enter: 'rise-in', emphasis: null, exit: 'fade-out' },
        craftPrinciples: [
            'Fade-rise entry: opacity 0 -> 1 coupled with Y translate +20px -> 0px.',
            'Stagger words by 3 frames; clamp final rest state for high legibility.',
        ],
    },
    WORD_TAGLINE_FADE_UP: {
        id: 'word_tagline_fade_up',
        intentCategory: 'kinetic_typography',
        intent: 'quietest setup reveal before a louder beat',
        displayName: 'Word-by-Word Tagline Fade-Up',
        feel: 'Pure opacity, no slide',
        timing: { enterFrames: 10, staggerFrames: 4, holdFrames: 30 },
        verbs: { enter: 'fade-in', emphasis: null, exit: 'fade-out' },
        craftPrinciples: [
            'Zero spatial displacement: pure opacity ramp to preserve absolute calm.',
        ],
    },
    TYPEWRITER_REVEAL: {
        id: 'typewriter_reveal',
        intentCategory: 'kinetic_typography',
        intent: 'ai-prompt or search staging',
        displayName: 'Typewriter Reveal with Blinking Caret',
        feel: 'Characters type in, caret blinks steady',
        timing: { charsPerSec: 18, holdFrames: 40 },
        verbs: { enter: 'typewriter', emphasis: 'nod', exit: 'fade-out' },
        craftPrinciples: [
            'Slice string by frame count: text.slice(0, count).',
            'Caret uses continuous cosine wave over 16 frames.',
        ],
    },
    STROKE_TO_FILL: {
        id: 'stroke_to_fill',
        intentCategory: 'kinetic_typography',
        intent: 'single hero-word anticipation reveal',
        displayName: 'Stroke-to-Fill Word Reveal',
        feel: 'Hollow stroke holds, then solid ink floods in',
        timing: { outlineFrames: 16, fillDelayFrames: 6, fillFrames: 12 },
        verbs: { enter: 'pop-in', emphasis: 'flash', exit: 'fade-out' },
        craftPrinciples: [
            'Render outline SVG text initially, fill floods in on key emphasis downbeat.',
        ],
    },
    MOTION_BLUR_SMEAR_SWAP: {
        id: 'motion_blur_smear_swap',
        intentCategory: 'kinetic_typography',
        intent: 'energetic hook or rapid word cycling',
        displayName: 'Motion-Blur Smear Word Swap',
        feel: 'Words streak sideways, dissolve, and re-crisp',
        timing: { streakFrames: 6, settleFrames: 12 },
        verbs: { enter: 'whip-in', emphasis: null, exit: 'whip-out' },
        craftPrinciples: [
            'Coupled X-velocity and directional horizontal blur (16px -> 0px).',
        ],
    },
    SCALE_EMPHASIS_HERO: {
        id: 'scale_emphasis_hero',
        intentCategory: 'kinetic_typography',
        intent: 'closing payoff or end card',
        displayName: 'Scale-Emphasis Hero Word Build',
        feel: 'Small intro line, then massive hero word reveal',
        timing: { introHoldFrames: 20, heroSlamFrames: 14 },
        verbs: { enter: 'slam-in', emphasis: 'pulse', exit: 'sink-out' },
        craftPrinciples: [
            'Hierarchical scale jump: 1.0x kicker leads into 2.2x hero statement.',
        ],
    },

    // ── Category B: Emphasis & Accents ──
    UNDERLINE_DRAW_ON: {
        id: 'underline_draw_on',
        intentCategory: 'emphasis_accent',
        intent: 'emphasize one benefit word',
        displayName: 'Hand-Drawn Underline Draw-On',
        feel: 'Organic wavy marker strokes on under keyword',
        timing: { delayAfterTextFrames: 6, drawFrames: 24 },
        verbs: { enter: 'rise-in', emphasis: 'pulse', exit: 'fade-out' },
        craftPrinciples: [
            'Trim-path reveal via strokeDashoffset on pre-baked wavy SVG path.',
            'Stroke width thickens from 3.5px to 5.0px at the tail for marker press effect.',
            'Fire ONLY after headline has completely settled.',
        ],
    },
    HIGHLIGHTER_SWEEP: {
        id: 'highlighter_sweep',
        intentCategory: 'emphasis_accent',
        intent: 'keyword wash emphasis',
        displayName: 'Translucent Highlighter Sweep',
        feel: 'Translucent neon wash band wipes behind keyword',
        timing: { sweepFrames: 14, holdFrames: 45 },
        verbs: { enter: 'slide-in', emphasis: null, exit: 'fade-out' },
        craftPrinciples: [
            'Backdrop layer positioned directly behind text, wipe scaleX 0 -> 1 from left.',
        ],
    },
    SCALE_DOWN_PRESS_CONFIRM: {
        id: 'scale_down_press_confirm',
        intentCategory: 'emphasis_accent',
        intent: 'primary CTA press confirmation',
        displayName: 'Scale-Down Press & Color Confirm',
        feel: 'Button compresses, recolors, springs back',
        timing: { pressFrames: 4, bounceFrames: 16 },
        verbs: { enter: 'rise-in', emphasis: 'punch', exit: 'fade-out' },
        craftPrinciples: [
            'Compress scale to 0.94x over 4 frames, spring release to 1.0x with overshoot 1.04x.',
        ],
    },
    GLOW_BLOOM_FLARE: {
        id: 'glow_bloom_flare',
        intentCategory: 'emphasis_accent',
        intent: 'celebration reward or done state',
        displayName: 'Glow-Bloom Flare & Particle Burst',
        feel: 'Soft radial halo blooms, sparks fling outward',
        timing: { bloomFrames: 6, decayFrames: 18, emitCount: 11 },
        verbs: { enter: 'pop-in', emphasis: 'flash', exit: 'fade-out' },
        craftPrinciples: [
            'Two-phase staging: radial glow peaks at alpha 0.55 first, particles emit second.',
            'Keep particle count <= 11 to preserve clean premium aesthetic.',
        ],
    },
    TAP_RIPPLE_CONFIRM: {
        id: 'tap_ripple_confirm',
        intentCategory: 'emphasis_accent',
        intent: 'press confirmation or hero CTA',
        displayName: 'Tap-Ripple Press Confirmation',
        feel: 'Soft ring expands and fades on tap',
        timing: { expandFrames: 16 },
        verbs: { enter: 'pop-in', emphasis: 'pulse', exit: 'fade-out' },
        craftPrinciples: [
            'Ring scale 0.5x -> 1.8x while opacity ramps 0.6 -> 0.0.',
        ],
    },

    // ── Category C: Scene & UI Transitions ──
    DIP_TO_COLOR: {
        id: 'dip_to_color',
        intentCategory: 'scene_transition',
        intent: 'register change between light and dark acts',
        displayName: 'Dip-to-Color Transition',
        feel: 'Frame dips through solid color between scenes',
        timing: { dipInFrames: 6, holdFrames: 2, dipOutFrames: 6 },
        verbs: { enter: 'fade-in', emphasis: null, exit: 'fade-out' },
        craftPrinciples: [
            'Fast 6-frame ramp to solid #0A0A0A or #FFFFFF, then 6-frame reveal.',
        ],
    },
    DEFOCUS_DISSOLVE: {
        id: 'defocus_dissolve',
        intentCategory: 'scene_transition',
        intent: 'calm hand-off or processing to done state',
        displayName: 'Defocus Dissolve',
        feel: 'Soft-focus lens dissolve, blur-clear',
        timing: { blurFrames: 12 },
        verbs: { enter: 'blur-in', emphasis: null, exit: 'blur-out' },
        craftPrinciples: [
            'Coupled blur (20px -> 0px) and opacity (0 -> 1).',
        ],
    },
    MATCH_CUT: {
        id: 'match_cut',
        intentCategory: 'scene_transition',
        intent: 'reorganize surroundings while subject stays anchored',
        displayName: 'Match Cut',
        feel: 'One element locked, everything else cuts instantly',
        timing: { cutFrame: 0 },
        verbs: { enter: 'fade-in', emphasis: null, exit: null },
        craftPrinciples: [
            'Anchor element shares identical screen-space coordinates across cut.',
        ],
    },
    UI_MORPH: {
        id: 'ui_morph',
        intentCategory: 'scene_transition',
        intent: 'list to detail card expansion',
        displayName: 'UI Morph & Layout Transition',
        feel: 'Card reshapes smoothly with corners intact',
        timing: { morphFrames: 18 },
        verbs: { enter: 'zoom-in', emphasis: null, exit: 'fade-out' },
        craftPrinciples: [
            'Interpolate width, height, and border-radius independently (FLIP pattern).',
        ],
    },
    MATCH_ZOOM: {
        id: 'match_zoom',
        intentCategory: 'scene_transition',
        intent: 'zoom into element until it becomes whole scene',
        displayName: 'Match-Zoom Transition',
        feel: 'Continuous camera dive into subject',
        timing: { zoomFrames: 20 },
        verbs: { enter: 'zoom-in', emphasis: null, exit: 'whip-out' },
        craftPrinciples: [
            'Exponential scale ramp toward focal point; swap asset at 3.0x scale.',
        ],
    },
    WHIP_PAN_SMEAR: {
        id: 'whip_pan_smear',
        intentCategory: 'scene_transition',
        intent: 'fast screen-to-screen montage',
        displayName: 'Whip-Pan Smear Swap',
        feel: 'Screens streak out sideways and resolve from smear',
        timing: { smearOutFrames: 6, smearInFrames: 6 },
        verbs: { enter: 'whip-in', emphasis: null, exit: 'whip-out' },
        craftPrinciples: [
            'Ultra-fast 6-frame lateral translate with 24px directional blur.',
        ],
    },

    // ── Category D: Camera Moves ──
    SLOW_PUSH_IN: {
        id: 'slow_push_in',
        intentCategory: 'camera_move',
        intent: 'reveal product elegantly and lean in',
        displayName: 'Slow Push-In Dolly',
        feel: 'One continuous slow breath toward subject',
        timing: { durationSec: 2.5, scaleDelta: 0.12 },
        verbs: { enter: 'zoom-in', emphasis: null, exit: null },
        craftPrinciples: [
            'Sub-perceptual scale growth 1.0 -> 1.12 over 2.5s with Easing.inOutCubic.',
            'Slight downward tilt via translateY +14px with transformOrigin: 50% 45%.',
        ],
    },
    PUSH_PULL_TO_CTA: {
        id: 'push_pull_to_cta',
        intentCategory: 'camera_move',
        intent: 'strongest way to end a marketing promo',
        displayName: 'Push-Pull Reframe to CTA',
        feel: 'Pull back to reveal context, collapse into CTA',
        timing: { pullSec: 0.8, holdSec: 0.2, pushSec: 1.0 },
        verbs: { enter: 'zoom-in', emphasis: 'pulse', exit: 'fade-out' },
        craftPrinciples: [
            'Scale down 1.0 -> 0.80 to reveal overview, brief hold, then dive 0.8 -> 1.25 to CTA.',
            'Pan frame toward button anchor (top-right) during final push.',
        ],
    },
    HERO_LIFT_RACK_FOCUS: {
        id: 'hero_lift_rack_focus',
        intentCategory: 'camera_move',
        intent: 'spotlight hero element against crowded scene',
        displayName: 'Hero-Lift Rack Focus',
        feel: 'Hero scales up sharp, background blurs and dims',
        timing: { liftFrames: 14 },
        verbs: { enter: 'rise-in', emphasis: 'punch', exit: null },
        craftPrinciples: [
            'Foreground hero scales 1.0 -> 1.08; background gains 8px blur and dims by 25%.',
        ],
    },
    KEN_BURNS_STILL: {
        id: 'ken_burns_still',
        intentCategory: 'camera_move',
        intent: 'default resting state for any static image',
        displayName: 'Ken Burns Ambient Drift',
        feel: 'Sub-perceptual slow zoom and diagonal pan',
        timing: { scaleDelta: 0.05, panDeltaPx: 12 },
        verbs: { enter: 'fade-in', emphasis: null, exit: 'fade-out' },
        craftPrinciples: [
            'Scale 1.0 -> 1.05 combined with subtle diagonal drift over entire shot.',
        ],
    },
    PARALLAX_MULTIPLANE: {
        id: 'parallax_multiplane',
        intentCategory: 'camera_move',
        intent: 'add cinematic depth without true 3d',
        displayName: 'Parallax Multiplane Drift',
        feel: 'Layered planes truck at varying speeds',
        timing: { backgroundRatio: 0.3, midRatio: 0.7, foregroundRatio: 1.2 },
        verbs: { enter: 'slide-in', emphasis: null, exit: null },
        craftPrinciples: [
            'Differential lateral translate speeds based on simulated layer depth.',
        ],
    },

    // ── Category E: Data Visualization & Annotations ──
    GROWTH_CURVE_DRAW: {
        id: 'growth_curve_draw',
        intentCategory: 'dataviz_annotation',
        intent: 'show data growth or retention spike',
        displayName: 'Draw-On Line Growth Curve',
        feel: 'Line draws itself climbing up-and-right',
        timing: { drawFrames: 24, glowSettleFrames: 12 },
        verbs: { enter: 'pop-in', emphasis: 'pulse', exit: 'fade-out' },
        craftPrinciples: [
            'Trim-path strokeDashoffset animated from 100% to 0% with easeOutExpo.',
            'Pulsing glowing head dot tracks exact current coordinates of the line tip.',
        ],
    },
    ODOMETER_TICKER: {
        id: 'odometer_ticker',
        intentCategory: 'dataviz_annotation',
        intent: 'stats totals and milestone numbers',
        displayName: 'Odometer Count-Up Ticker',
        feel: 'Stat rolls fast then snaps onto round number',
        timing: { rollFrames: 28, settleFrames: 20 },
        verbs: { enter: 'pop-in', emphasis: 'punch', exit: 'shrink-out' },
        craftPrinciples: [
            'Tabular numerals with easeOutExpo easing.',
            'Audio snap or cash register chime fires on exact frame digits hit target.',
        ],
    },
    SYNCED_BAR_COUNT: {
        id: 'synced_bar_count',
        intentCategory: 'dataviz_annotation',
        intent: 'progress and completion metric',
        displayName: 'Synced Count-Up and Fill Bar',
        feel: 'Bar and number land on round value together',
        timing: { fillFrames: 26 },
        verbs: { enter: 'slide-in', emphasis: 'nod', exit: 'fade-out' },
        craftPrinciples: [
            'Progress bar width and text percentage share single normalized progress 0..1.',
        ],
    },
    PROGRESS_RING_SWEEP: {
        id: 'progress_ring_sweep',
        intentCategory: 'dataviz_annotation',
        intent: 'goal rings and session completion',
        displayName: 'Progress Ring Sweep',
        feel: 'Arc sweeps clockwise to percentage with centered count',
        timing: { sweepFrames: 30 },
        verbs: { enter: 'spin-in', emphasis: 'pulse', exit: 'shrink-out' },
        craftPrinciples: [
            'SVG circle strokeDashoffset clockwise sweep; center counter rolls in sync.',
        ],
    },

    // ── Category F: Device & UI Staging ──
    RACK_FOCUS_PHONE: {
        id: 'rack_focus_phone',
        intentCategory: 'device_ui',
        intent: 'calm here-is-the-app reveal',
        displayName: 'Rack-Focus Phone Entrance',
        feel: 'Phone materializes low in blur and rises to sharp',
        timing: { enterFrames: 8, floatHz: 0.8, exitFrames: 6 },
        verbs: { enter: 'rise-in', emphasis: null, exit: 'sink-out' },
        craftPrinciples: [
            'Coupled blur (18px -> 0px) and Y translate (+40px -> 0px) on single progress value.',
            'Floor shadow opacity scales 0 -> 0.4 in parallel; ambient sine float after rest.',
        ],
    },
    IN_FRAME_SCROLL: {
        id: 'in_frame_scroll',
        intentCategory: 'device_ui',
        intent: 'demonstrate feed or list flow without moving camera',
        displayName: 'In-Frame Screen Scroll',
        feel: 'Phone holds static while internal screen scrolls',
        timing: { holdFrames: 40, scrollFrames: 15, travelPx: 260 },
        verbs: { enter: 'slide-in', emphasis: null, exit: null },
        craftPrinciples: [
            'Device frame remains completely static; internal masked content translates upward.',
        ],
    },
    DEPTH_DEVICE_ARRAY: {
        id: 'depth_device_array',
        intentCategory: 'device_ui',
        intent: 'multi-device ecosystem presentation',
        displayName: 'Depth-Staggered Device Array',
        feel: 'Isometric or layered device bed with parallax shift',
        timing: { staggerStepFrames: 4 },
        verbs: { enter: 'rise-in', emphasis: null, exit: 'sink-out' },
        craftPrinciples: [
            'Stagger phone, tablet, and desktop layers with varying elevation shadows.',
        ],
    },
});

/**
 * ─── 5. REFERENCE-MATCH LOOP PRINCIPLES ──────────────────────────────────────
 * How to systematically deconstruct reference videos into measured contracts.
 */

const REFERENCE_MATCH_PRINCIPLES = Object.freeze({
    MOVE_1_MEASURED_CONTRACT: {
        name: 'Tear References into a Measured Contract',
        hardFacts: [
            'Shot count, per-shot duration distribution, cut cadence (cuts/sec).',
            'Per-frame motion magnitude (static vs slow push vs whip).',
            'Cross-beat repetition score (anti-repetition diversity).',
            'Dead-air percentage and audio downbeat hits.',
        ],
        softFacts: [
            'Beat map: hook -> problem -> solution -> CTA with exact timecodes.',
            'Energy curve: rated 1 to 5 per beat.',
            'Recurring motion grammar and the ONE hero move.',
        ],
    },
    MOVE_2_SKELETON_RESKIN: {
        name: 'Replicate the Skeleton, Then Re-Skin',
        rule: 'Keep the mechanism, swap the palette.',
        explanation: 'A motion technique is colorless. If a reference underlines with a sweeping gradient, keep the sweep and apply your brand palette.',
    },
    MOVE_3_SCORED_LOOP: {
        name: 'Score Output Against Reference Ranges',
        rule: 'Judge against measured target ranges, not abstract taste.',
        metrics: ['Cadence adherence', 'Cross-beat variety', 'Pacing delta'],
    },
});

/**
 * ─── 6. SEARCHABLE INTERNAL KNOWLEDGE LIBRARY FOR GEMINI / LLM ─────────────
 * Search across the ~33 techniques by intent, query, or category.
 *
 * @param {string} query - Creative intention or search phrase (e.g. "emphasize word", "product reveal")
 * @param {object} [filters={}] - Optional filters (category, limit)
 * @returns {Array<{ technique: object, score: number, matchReason: string }>}
 */
function searchMotionKnowledge(query = '', filters = {}) {
    const q = String(query || '').toLowerCase().trim();
    if (!q) return [];

    const results = [];
    const tokens = q.split(/\s+/).filter(Boolean);

    for (const recipe of Object.values(INTENT_TECHNIQUE_RECIPES)) {
        let score = 0;
        const reasons = [];

        // Exact intent match or key tokens in intent
        if (recipe.intent.toLowerCase().includes(q)) {
            score += 10.0;
            reasons.push('exact_intent_match');
        } else {
            const stopWords = new Set(['a', 'an', 'the', 'this', 'that', 'to', 'for', 'in', 'on', 'of', 'with', 'one', 'some']);
            const keyTokens = tokens.filter(t => !stopWords.has(t));
            if (keyTokens.length > 0 && keyTokens.every(t => recipe.intent.toLowerCase().includes(t))) {
                score += 8.0;
                reasons.push('key_tokens_in_intent');
            }
        }

        // Category filter
        if (filters.category && recipe.intentCategory === filters.category) {
            score += 3.0;
            reasons.push('category_filter_match');
        }

        // Token matching against id, displayName, feel, and principles
        const searchableCorpus = `${recipe.id} ${recipe.displayName} ${recipe.feel} ${recipe.intent} ${recipe.craftPrinciples.join(' ')}`.toLowerCase();
        for (const token of tokens) {
            if (searchableCorpus.includes(token)) {
                score += 2.0;
                reasons.push(`token_match:${token}`);
            }
        }

        if (score > 0) {
            results.push({
                technique: recipe,
                score: Number(score.toFixed(2)),
                matchReason: reasons.join(', '),
            });
        }
    }

    results.sort((a, b) => b.score - a.score);
    const limit = Number(filters.limit) > 0 ? Number(filters.limit) : 8;
    return results.slice(0, limit);
}

/**
 * ─── 7. STRUCTURED AGENT DIRECTIVES (DOs & DONTs) ───────────────────────────
 */

const AGENT_DIRECTIVES = Object.freeze({
    CONSTANTS_FIRST: {
        rule: 'Constants-First Architecture',
        description: 'Expose all editable colors, timing, text strings, and layout margins at top of component in UPPER_SNAKE_CASE.',
        why: 'Permits non-destructive editor overrides, interactive tuning, and rapid programmatic style variations.',
    },
    FRAME_DRIVEN_DETERMINISM: {
        rule: 'Deterministic Frame Purity',
        description: 'Every visual state must be a pure mathematical function of frame and fps. Ban Date.now(), requestAnimationFrame, CSS transitions, and Tailwind animation classes.',
        why: 'Video exporters render offline frame-by-frame; asynchronous or wall-clock timers cause visual tearing and stutter.',
    },
    INDIVIDUAL_TRANSFORMS: {
        rule: 'Individual Transform Properties',
        description: 'Favor individual scale, translate, rotate properties over compound transform strings whenever possible.',
        why: 'Enables Studio timeline inspector to independently tweak position, scale, and angle without string parsing.',
    },
    RESPONSIVE_CANVAS_SAFE_ZONES: {
        rule: 'Safe-Zone Padding & Responsive Scaling',
        description: 'Keep all critical graphics within the 80% inner canvas. Minimum 12% top and 15% bottom margins for vertical (9:16) video.',
        why: 'Prevents platform UI overlays (TikTok buttons, Reels descriptions, YouTube Shorts headers) from occluding content.',
    },
    REVERSE_STAGGER_FOLLOW_THROUGH: {
        rule: 'Reverse Stagger Follow-Through on Exit',
        description: 'When multiple layers arrive sequentially (1 -> 2 -> 3), they must depart in reverse order (3 -> 2 -> 1).',
        why: 'Simultaneous vanishing of multi-layered stacks is the most prominent indicator of amateur machine-generated motion.',
    },
    SECONDARY_ACTION_OFFSET: {
        rule: 'Secondary Action Hierarchy',
        description: 'Never trigger background container and foreground text on the exact same frame. Plate arrives 2-4 frames earlier.',
        why: 'Establishes a physical surface for the text to land upon, creating perceived depth.',
    },
});

/**
 * ─── 8. MARKETING VIDEO CHOREOGRAPHY & STORY ARCHITECTURE ───────────────────
 */

const MARKETING_CHOREOGRAPHIES = Object.freeze({
    SAAS_GROWTH_REEL: {
        id: 'saas_growth_reel',
        targetDurationSec: 15,
        acts: [
            {
                act: '1. The Hook',
                timing: '0.0s - 2.5s',
                pacingSec: 2.5,
                visual: 'High-contrast headline slam, dark cinematic ground (#0A0A0A), glowing neon cyan (#00E5FF) accent.',
                audioSync: 'Heavy impact whoosh on slam; vocal dialogue starts within 0.2s.',
                recommendedTechnique: 'hook-slam-headline',
            },
            {
                act: '2. The Problem & Monotony Relief',
                timing: '2.5s - 6.5s',
                pacingSec: 2.0,
                visual: 'Side-by-side or split visual illustrating friction ("Before: 3 hours"). Monotony relief via camera punch.',
                audioSync: 'Subtle riser or ticking sound indicating lost time.',
                recommendedTechnique: 'point-slide-accent',
            },
            {
                act: '3. The Solution & Proof Metric',
                timing: '6.5s - 11.5s',
                pacingSec: 2.5,
                visual: 'Kinetic card reveal + counter roll ("After: 12 minutes" / "+184% speed"). Depth sandwiching behind speaker.',
                audioSync: 'Crisp mechanical snap / cash register / chime on stat reveal.',
                recommendedTechnique: 'stat-roll-large',
            },
            {
                act: '4. The Resolution & Magnetic CTA',
                timing: '11.5s - 15.0s',
                pacingSec: 3.5,
                visual: 'Clean brand logo lockup, glowing CTA pill button with subtle magnetic pulse.',
                audioSync: 'Whoosh sweep transitioning to crisp button click.',
                recommendedTechnique: 'cta-magnetic-pulse',
            },
        ],
    },
    LISTICLE_PUNCH: {
        id: 'listicle_punch',
        targetDurationSec: 12,
        acts: [
            { act: 'Hook', timing: '0.0s - 2.0s', visual: 'Top-anchored question / statement with word reveal.' },
            { act: 'Point 01', timing: '2.0s - 5.0s', visual: 'Kinetic card with kicker 01, bold headline.' },
            { act: 'Point 02', timing: '5.0s - 8.0s', visual: 'Kinetic card with kicker 02, staggered entrance.' },
            { act: 'Point 03 & CTA', timing: '8.0s - 12.0s', visual: 'Final takeaway + clear profile link directive.' },
        ],
    },
});

/**
 * ─── 9. KNOWLEDGE RETRIEVAL & PROMPT SYNTHESIZER ────────────────────────────
 * Builds a compact, high-signal knowledge injection block for Gemini/LLMs.
 */

/**
 * Generate a concise, contextual knowledge block for injection into model prompts.
 *
 * @param {string} prompt - Creator brief
 * @param {object} [context={}] - Platform, transcript, tone, duration
 * @returns {{
 *   version: string,
 *   selectedDomains: string[],
 *   promptBlock: string,
 *   recipes: object[],
 *   directives: object[],
 *   marketingChoreography: object|null,
 *   matchedTechniques: object[]
 * }}
 */
function getKnowledgeForBrief(prompt = '', context = {}) {
    const classifications = classifyPromptSkills(prompt, context);
    const topDomains = classifications.slice(0, 3).map(c => c.domain);

    // Search targeted techniques matching the brief's creative intent
    const matched = searchMotionKnowledge(prompt, { limit: 4 });

    // Collect relevant recipes
    const relevantRecipes = Object.values(ANIMATION_RECIPES).filter(r =>
        topDomains.includes(r.domain) || r.domain === SKILL_DOMAINS.SPRING_PHYSICS
    );

    // Determine relevant marketing choreography if marketing/social intent is present
    const isMarketing = topDomains.some(d =>
        d === SKILL_DOMAINS.MARKETING_STORY || d === SKILL_DOMAINS.SOCIAL_SHORT || d === SKILL_DOMAINS.HOOK_TITLE
    );
    const choreography = isMarketing ? MARKETING_CHOREOGRAPHIES.SAAS_GROWTH_REEL : null;

    // Build dense markdown lines for LLM prompt injection
    const lines = [
        `### VIBED Motion & Choreography Standards (v${VIBED_MOTION_KNOWLEDGE_VERSION})`,
        'Apply these proven craft patterns to your motion plan:',
        '',
        '1. **Constants-First & Responsive Sizing**:',
        '   - Define layout margins and text sizes as constants: `const TITLE_SIZE = Math.max(48, Math.round(width * 0.08));`',
        '   - Safe margins: top 12%, bottom 15% for vertical 9:16 formats to avoid platform UI clipping.',
        '',
        '2. **Spring Physics & Organic Timing**:',
        '   - Use spring physics for entrances: snappy (damping: 20, stiffness: 200) for UI/text; bouncy (damping: 8, stiffness: 120) for badges.',
        '   - Delayed entrances MUST offset frame: `spring({ frame: frame - DELAY, fps, ... })`.',
        '   - Relative sequencing: use "<" to align with previous start, "+delta" for post-gap, "-delta" for anticipation.',
        '   - Linear `interpolate()` is reserved for progress bars, timers, and opacity crossfades.',
        '',
        '3. **Choreography & Follow-Through Rules**:',
        '   - Secondary action: plates/backdrops arrive 3 frames BEFORE their text.',
        '   - Reverse stagger: elements that arrive sequentially MUST leave in reverse order (last in, first out).',
        '   - Text highlights: use smooth crossfades; typewriters use string slicing `text.slice(0, count)`.',
        '   - Vector trim paths: animate strokeDashoffset `PATH_LEN * (1 - progress)` for underlines and curves.',
    ];

    if (matched.length > 0) {
        lines.push('', '4. **Recommended Craft Recipes for This Brief**:');
        for (const { technique } of matched) {
            lines.push(`   - **${technique.displayName}** (${technique.intent}): ${technique.feel}`);
        }
    }

    if (choreography) {
        lines.push(
            '',
            `5. **Pacing Structure (${choreography.id})**:`,
            '   - 0.0-2.5s: Strong visual hook (overshoot slam / rise-in). Zero silent delay.',
            '   - 2.5-6.5s: Core premise / value statement with rhythm zoom or camera pan.',
            '   - 6.5-11.5s: Proof / metric callout (counter roll + kicker label + impact sync).',
            '   - 11.5-15.0s: Magnetic CTA with subtle continuous pulse (scale 1.0 -> 1.03).'
        );
    }

    return {
        version: VIBED_MOTION_KNOWLEDGE_VERSION,
        selectedDomains: topDomains,
        promptBlock: lines.join('\n'),
        recipes: relevantRecipes,
        directives: Object.values(AGENT_DIRECTIVES),
        marketingChoreography: choreography,
        matchedTechniques: matched.map(m => m.technique),
    };
}

module.exports = {
    VIBED_MOTION_KNOWLEDGE_VERSION,
    SKILL_DOMAINS,
    SPRING_PRESETS,
    ANIMATION_RECIPES,
    ORCHESTRATION_MECHANICS,
    INTENT_TECHNIQUE_RECIPES,
    REFERENCE_MATCH_PRINCIPLES,
    AGENT_DIRECTIVES,
    MARKETING_CHOREOGRAPHIES,
    classifyPromptSkills,
    searchMotionKnowledge,
    getKnowledgeForBrief,
};
