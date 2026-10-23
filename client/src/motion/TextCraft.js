/**
 * client/src/motion/TextCraft.js
 *
 * R107 — the craft rules for text in motion.
 *
 * The motion library (server/audio-engine/library/starterMotionLibrary.js)
 * says what a beat should DO: which verb, what timing, how much energy. It is
 * a vocabulary of good moves. What it has never carried is the opposite list:
 * the handful of ways animated text goes wrong even when the verb and the
 * timing are right. Those are not style opinions, they are defects with a
 * visible symptom:
 *
 *   A caret that toggles on and off on a frame boundary reads as a dropped
 *   frame rather than a blink, because nothing else in a rendered video
 *   changes state instantly.
 *
 *   A slot that cycles through words and takes its width from the CURRENT
 *   word makes everything around it jump. The layout is being driven by the
 *   content instead of reserved for it.
 *
 *   A reveal that is still typing when the layer starts to leave never gets
 *   read. The animation finished; the sentence did not.
 *
 *   A highlight that switches colour and scale on one frame pops. The word
 *   was legible before and after, and illegible for the frame in between.
 *
 * Each rule here is a measurement, so each one can be checked. `auditScene`
 * is the checkable subset: the rules whose symptom is visible in a scene
 * graph before anything is rendered.
 *
 * Module format: ESM (frontend).
 */

/**
 * One full blink, in seconds. 0.53 s is a hair under two cycles a second,
 * which is where a caret stops reading as a flashing warning and starts
 * reading as a resting cursor. At 30 fps it is 16 frames, so the ramp has
 * eight frames in each direction — enough that the fade is visible.
 */
export const CARET_PERIOD_S = 0.53;

/** The floor a caret fades to. Never 0: a caret that disappears looks lost. */
export const CARET_MIN_ALPHA = 0.12;

/** How long a finished line must sit still before its layer starts leaving. */
export const MIN_READ_HOLD_S = 0.6;

/** The shortest a cycled word can hold and still be read. */
export const MIN_SWAP_DWELL_S = 0.45;

/** The overlap between the outgoing and incoming word in a swap. */
export const SWAP_CROSSFADE_S = 0.22;

/** How long a highlight takes to come in, rather than appearing on one frame. */
export const HIGHLIGHT_RAMP_S = 0.18;

// Named `limit`/`asNumber` rather than `clamp`/`num` on purpose: several
// caption suites load the client modules by concatenating their sources with
// the imports stripped (scripts/test_raster_captions.js), so a module-private
// helper whose name another module in that chain also uses stops the whole
// chain from parsing. Easing.js already exports a `clamp`.
const limit = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const asNumber = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/**
 * Caret alpha at time `t`, as a ramp rather than a toggle.
 *
 * While the text is still arriving the caret is solid — a blinking caret
 * during typing competes with the letters for attention. It only starts
 * breathing once the line is done, which is also the cue that it is done.
 *
 * @param {number} t seconds since the layer started
 * @param {{ typing?: boolean, period?: number, min?: number }} opts
 * @returns {number} 0..1
 */
export function caretOpacity(t, opts = {}) {
    const period = Math.max(0.12, asNumber(opts.period, CARET_PERIOD_S));
    const min = limit(asNumber(opts.min, CARET_MIN_ALPHA), 0, 1);
    if (opts.typing) return 1;
    const phase = ((asNumber(t) % period) + period) % period;
    const half = period / 2;
    // Triangle: 1 at the start of the cycle, `min` at the half, 1 again at
    // the end. Linear on purpose - an eased blink reads as a pulse.
    // Distance from the nearest end of the cycle, 0..1: 0 at both ends
    // (solid), 1 at the half (dimmest).
    const away = (phase <= half ? phase : period - phase) / half;
    return min + (1 - min) * (1 - away);
}

/**
 * How much room a swap slot needs beyond the widest word it holds.
 *
 * A word that exactly fills its slot still clips under the arrival offset or
 * an accent scale, so the slot is the widest word plus this much.
 * `TextMeasurement.reserveSlotWidth` does the measuring; the rule lives here.
 */
export const SWAP_SLOT_PAD = 0.04;

/** Which of the `words` is the widest, given their measured widths. */
export function widestIndex(widths) {
    const list = Array.isArray(widths) ? widths : [];
    let best = -1;
    for (let i = 0; i < list.length; i += 1) {
        if (Number.isFinite(list[i]) && (best < 0 || list[i] > list[best])) best = i;
    }
    return best;
}

/**
 * The two opacities of a swap at time `t`: what is leaving and what arrives.
 *
 * Two layers crossfading is not the same as one layer whose text changes.
 * Changing the text means there is a frame where the old word and the new
 * word are the same pixel-for-nothing — the swap is invisible and the slot
 * appears to stutter. Overlapping them means the eye is handed from one to
 * the other.
 *
 * @param {number} t seconds since the layer started
 * @param {number} at when the swap begins
 * @param {number} duration how long the overlap lasts
 * @returns {{ out: number, in: number }}
 */
export function crossfadeWeights(t, at, duration = SWAP_CROSSFADE_S) {
    const d = Math.max(0.01, asNumber(duration, SWAP_CROSSFADE_S));
    const p = limit((asNumber(t) - asNumber(at)) / d, 0, 1);
    return { out: 1 - p, in: p };
}

/**
 * Highlight strength at `t`, 0..1, for blending a colour and a scale in.
 *
 * The caller blends with it rather than branching on it, which is the whole
 * point: `p === 1 ? HIGHLIGHT : BASE` is the pop this replaces.
 */
export function highlightRamp(t, at, duration = HIGHLIGHT_RAMP_S) {
    const d = Math.max(0.01, asNumber(duration, HIGHLIGHT_RAMP_S));
    const p = limit((asNumber(t) - asNumber(at)) / d, 0, 1);
    // easeOutCubic: fastest at the start, so the word is already legibly
    // highlighted well before the ramp formally ends.
    return 1 - Math.pow(1 - p, 3);
}

/**
 * How long the ramp may take for a highlight that holds for `dwell` seconds.
 *
 * `HIGHLIGHT_RAMP_S` is right for a keyword that lands once and stays. An
 * active-word tracker moves every 0.3 s or so, and a 0.18 s ramp on a 0.3 s
 * word is most of that word's life — the highlight would never be fully on.
 * So the span is a quarter of the dwell, floored at 0.05 s (any shorter is
 * inside one frame at 30 fps and the ramp is a cut again) and capped at
 * `HIGHLIGHT_RAMP_S`.
 */
export function highlightRampSpan(dwell) {
    const d = asNumber(dwell, 0);
    if (!(d > 0)) return HIGHLIGHT_RAMP_S;
    return limit(d * 0.25, 0.05, HIGHLIGHT_RAMP_S);
}

/**
 * The ramp, QUANTISED to three values.
 *
 * Why quantised: the preview resolves the highlight at the playhead, but the
 * export pre-renders one PNG per distinct word state
 * (`CaptionCompiler.buildWordStates` → `RasterCaptionCompiler`), so a
 * continuous ramp there would cost one image per frame. Quantising to a fixed
 * set of steps makes the ramp a step function of time with known breakpoints:
 * the export renders one image per step, the preview reads the same step at
 * any time inside it, and the two agree by construction instead of by
 * accident. That is the part worth protecting - a highlight that eases in the
 * preview and cuts in the export is a worse bug than one that cuts in both.
 *
 * The first step is 0.35, not 0: a highlight that is fully off for the first
 * frame of the word it marks LAGS the audio, which is a worse artefact than
 * the pop being removed. The ramp starts already a third of the way in and
 * finishes inside the span.
 */
export const HIGHLIGHT_MIX_STEPS = Object.freeze([0.35, 0.72, 1]);

/** The times at which the highlight of a word starting at `start` changes. */
export function highlightBreakpoints(start, dwell) {
    const span = highlightRampSpan(dwell);
    const s = asNumber(start, 0);
    const n = HIGHLIGHT_MIX_STEPS.length;
    // Evenly spaced across the span: step i begins at start + i*span/n.
    return HIGHLIGHT_MIX_STEPS.map((_, i) => s + (span * i) / n);
}

/**
 * The quantised highlight strength of a word that became active at `start`
 * and holds for `dwell`. Constant between breakpoints, by design.
 */
export function highlightMixAt(t, start, dwell) {
    const span = highlightRampSpan(dwell);
    const elapsed = asNumber(t) - asNumber(start, 0);
    if (!(elapsed >= 0)) return 0;
    if (elapsed >= span) return 1;
    // Walked rather than divided, so each comparison uses the SAME expression
    // `highlightBreakpoints` builds its times from, with an epsilon because
    // `(start + x) - start` is not exactly `x` in floating point and a
    // breakpoint would otherwise read as the step below it. Computing the step index
    // as `floor(elapsed / span * n)` instead puts the boundary one float
    // epsilon away from the breakpoint, and the export then samples the step
    // below the one the preview shows at that exact time.
    const n = HIGHLIGHT_MIX_STEPS.length;
    let out = HIGHLIGHT_MIX_STEPS[0];
    for (let i = 1; i < n; i += 1) {
        if (elapsed + 1e-9 >= (span * i) / n) out = HIGHLIGHT_MIX_STEPS[i];
    }
    return out;
}

/**
 * The plan for a slot that cycles through words.
 *
 * Returns one entry per word with its dwell and its swap, so the caller
 * never has to work out whether the last word has time to be read: if the
 * words do not fit the duration at a readable dwell, `fits` is false and
 * `advised` says how many do.
 *
 * @param {string[]} words
 * @param {number} duration seconds the slot is on screen
 * @param {{ dwell?: number, crossfade?: number }} opts
 */
export function planWordCycle(words, duration, opts = {}) {
    const list = (Array.isArray(words) ? words : []).map((w) => String(w == null ? '' : w)).filter(Boolean);
    const total = Math.max(0.1, asNumber(duration, 0));
    const crossfade = Math.max(0, asNumber(opts.crossfade, SWAP_CROSSFADE_S));
    const n = list.length;
    if (n === 0) return { steps: [], fits: false, advised: 0, dwell: 0 };
    const requested = asNumber(opts.dwell, 0);
    const dwell = requested > 0 ? requested : total / n;
    const fits = n <= 1 || dwell >= MIN_SWAP_DWELL_S;
    const advised = Math.max(1, Math.floor(total / MIN_SWAP_DWELL_S));
    const steps = list.map((word, i) => ({
        word,
        at: i * dwell,
        until: (i + 1) * dwell,
        // The last word does not swap out — the layer's own exit takes it.
        swapAt: i < n - 1 ? Math.max(0, (i + 1) * dwell - crossfade) : null,
    }));
    return { steps, fits, advised, dwell, crossfade };
}

/**
 * The rules, as data, so they can be surfaced in a prompt or a panel rather
 * than living only in whichever function happens to enforce them.
 *
 * `checkable` marks the ones `auditScene` can see in a scene graph. The rest
 * are renderer-level and are enforced where they are drawn.
 */
export const TEXT_CRAFT_RULES = [
    {
        id: 'caret-ramp',
        defect: 'A caret that switches on and off on a frame boundary.',
        rule: `Fade it over ${CARET_PERIOD_S}s to ${CARET_MIN_ALPHA}, and hold it solid while the line is still arriving.`,
        why: 'Nothing else in a rendered frame changes state instantly, so an instant change reads as a dropped frame.',
        checkable: false,
    },
    {
        id: 'swap-slot-reserved',
        defect: 'A slot that cycles words and takes its width from the current word.',
        rule: 'Reserve the width of the widest alternative and let the words move through that box.',
        why: 'Otherwise the content drives the layout and everything beside it jumps on every swap.',
        checkable: true,
    },
    {
        id: 'swap-dwell',
        defect: 'Cycled words that leave before they can be read.',
        rule: `Give every word at least ${MIN_SWAP_DWELL_S}s on screen; drop words rather than speed the cycle up.`,
        why: 'A list nobody can read is a list nobody read, however well it animates.',
        checkable: true,
    },
    {
        id: 'read-hold',
        defect: 'A progressive reveal still typing when its layer starts to leave.',
        rule: `A reveal must finish at least ${MIN_READ_HOLD_S}s before the exit begins.`,
        why: 'The animation completes but the sentence is never read, which is the only thing it was for.',
        checkable: true,
    },
    {
        id: 'highlight-ramp',
        defect: 'A highlight that changes colour and scale on a single frame.',
        rule: `Blend it in over at most ${HIGHLIGHT_RAMP_S}s - a quarter of how long it holds - instead of branching between two states.`,
        why: 'A one-frame switch pops: the word is legible before and after, and smeared in between.',
        checkable: false,
    },
    {
        id: 'swap-crossfade',
        defect: 'A swap done by changing one layer’s text.',
        rule: `Overlap the outgoing and incoming word for ${SWAP_CROSSFADE_S}s.`,
        why: 'Replacing text in place gives no frame where the change is visible, so the slot appears to stutter.',
        checkable: false,
    },
];

const RULE_BY_ID = new Map(TEXT_CRAFT_RULES.map((r) => [r.id, r]));

/** One rule, by id. Null rather than undefined so a caller can test it. */
export function ruleById(id) {
    return RULE_BY_ID.get(String(id || '')) || null;
}

/**
 * Check a composed scene against the checkable rules.
 *
 * Reads the shape SceneComposer produces: nodes with a `duration`, optional
 * `animations` (each with `type`/`presetId`/`startTime`/`duration`/`anchor`)
 * and, for a cycling slot, `alternatives` plus `slotWidth`.
 *
 * Returns findings, never throws, and says nothing about a node it cannot
 * measure — a silent pass on missing data is better than a false positive
 * that teaches people to ignore the audit.
 *
 * @param {{ nodes?: Array }|Array} scene
 * @returns {Array<{ rule: string, nodeId: string|null, detail: string }>}
 */
export function auditScene(scene) {
    const nodes = Array.isArray(scene) ? scene : (Array.isArray(scene?.nodes) ? scene.nodes : []);
    const findings = [];
    const add = (rule, node, detail) => {
        findings.push({ rule, nodeId: node?.id != null ? String(node.id) : null, detail });
    };

    for (const node of nodes) {
        if (!node || typeof node !== 'object') continue;
        const duration = asNumber(node.duration, 0);
        const anims = Array.isArray(node.animations) ? node.animations : [];

        // swap-slot-reserved / swap-dwell
        const alts = Array.isArray(node.alternatives)
            ? node.alternatives.map((w) => String(w == null ? '' : w)).filter(Boolean)
            : [];
        if (alts.length > 1) {
            if (!(asNumber(node.slotWidth, 0) > 0)) {
                add('swap-slot-reserved', node, `${alts.length} alternatives and no reserved slot width`);
            }
            if (duration > 0) {
                const dwell = asNumber(node.dwell, 0) > 0 ? asNumber(node.dwell, 0) : duration / alts.length;
                if (dwell < MIN_SWAP_DWELL_S) {
                    const advised = Math.max(1, Math.floor(duration / MIN_SWAP_DWELL_S));
                    add('swap-dwell', node, `${dwell.toFixed(2)}s per word over ${duration}s; ${advised} word(s) fit`);
                }
            }
        }

        // read-hold
        if (duration > 0) {
            const reveals = anims.filter((a) => {
                if (!a || typeof a !== 'object') return false;
                const type = String(a.type || '').toLowerCase();
                const preset = String(a.presetId || '').toLowerCase();
                return type === 'reveal' || /typewriter|word-reveal/.test(preset);
            });
            for (const a of reveals) {
                // An out-anchored reveal is not a reveal in the sense this
                // rule is about, and its startTime means something else
                // entirely (see MotionResolver on out anchoring).
                if (String(a.anchor || '') === 'out') continue;
                const ends = asNumber(a.startTime, 0) + asNumber(a.duration, 0);
                const exits = anims
                    .filter((x) => x && String(x.anchor || '') === 'out')
                    .map((x) => duration - asNumber(x.startTime, 0) - asNumber(x.duration, 0));
                const exitAt = exits.length > 0 ? Math.min(...exits) : duration;
                const hold = exitAt - ends;
                if (hold < MIN_READ_HOLD_S) {
                    add('read-hold', node, `reveal ends at ${ends.toFixed(2)}s, exit begins at ${exitAt.toFixed(2)}s (${hold.toFixed(2)}s hold)`);
                }
            }
        }
    }
    return findings;
}

export default {
    CARET_PERIOD_S,
    CARET_MIN_ALPHA,
    MIN_READ_HOLD_S,
    MIN_SWAP_DWELL_S,
    SWAP_CROSSFADE_S,
    HIGHLIGHT_RAMP_S,
    SWAP_SLOT_PAD,
    HIGHLIGHT_MIX_STEPS,
    caretOpacity,
    widestIndex,
    crossfadeWeights,
    highlightRamp,
    highlightRampSpan,
    highlightBreakpoints,
    highlightMixAt,
    planWordCycle,
    auditScene,
    ruleById,
    TEXT_CRAFT_RULES,
};
