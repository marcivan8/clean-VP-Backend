/**
 * client/src/motion/Storyboard.js
 *
 * R112 — PHASE 2: a plan for the WHOLE video, before any graphic is built.
 *
 * `SceneDirector` (R95) designs one scene from one brief: beats in sequence,
 * a look per beat, placed away from the subject. It is the right machine, and
 * it has never been told what the video is actually about — the caller hands
 * it a sentence, and the sequence it builds is as long as it needs to be and
 * lands wherever it is dropped.
 *
 * A reference-grade edit works the other way round. The editor reads the whole
 * piece first and decides, for each moment: stay on the speaker, push in, put
 * a card up, split the screen, cut to the evidence, go clean again. The
 * graphics are consequences of that plan. This module is that plan.
 *
 * INPUT   what was said and when (MomentAnalyzer), where the picture changes
 *         (ShotSampler), the frame, the tone, and where the subject is.
 * OUTPUT  an ordered list of BEATS, each with a layout, a graphic kind, the
 *         speaker's own words, and a start and end.
 *
 * It composes nothing. The beats it emits are the input SceneDirector and the
 * component library already take, which is the point: this adds the editorial
 * decision VIBED was missing without replacing the engine underneath it.
 *
 * THE RULES IT ENFORCES, each one a defect in the reference comparison:
 *
 *   - DENSITY. At most `maxPerMinute` graphic beats, spaced by `minGap`. More
 *     than that and every one of them stops meaning anything.
 *   - READ TIME. A beat holds at least long enough to read it (TextCraft's
 *     MIN_READ_HOLD_S), and longer for more words.
 *   - NO REPEAT. The same layout never runs twice in a row, and the same
 *     graphic kind never runs twice in a row. The references change scale and
 *     composition constantly; one design applied throughout is the tell of a
 *     template.
 *   - ON THE CUT. A beat whose start is within `snapWindow` of a shot
 *     boundary moves ONTO it. Landing two frames after a cut reads as a
 *     mistake, and this is free to fix.
 *   - CLEAN AIR. The opening `leadIn` seconds and the gaps between beats stay
 *     on the speaker with nothing over them.
 *
 * Pure: no DOM, no network. Imports only pure modules.
 */

import { findMoments, capMoments } from './MomentAnalyzer.js';
import { nearestBoundary } from '../vision/ShotSampler.js';
import { MIN_READ_HOLD_S } from './TextCraft.js';
import { TEMPLATE_KINDS } from './TemplateGraphics.js';
import { COMPONENT_IDS } from './ComponentLibrary.js';

/**
 * How a beat is framed. `clean` is the speaker with nothing over them.
 *
 * R112 round C: `broll` was removed. It meant "cut away to other footage",
 * nothing supplied that footage, and nothing consumed the layout — so a beat
 * could be planned as a cutaway, report success, and render as an ordinary
 * card. A layout nothing implements is worse than one fewer layout.
 *
 * What each one actually does today:
 *   clean/card/pip/split  position the graphic (StoryboardBridge.LAYOUT_POSITION)
 *   punch                 ALSO pushes the camera in (StoryboardFraming)
 *   split                 does NOT yet halve the frame — see StoryboardFraming
 */
export const LAYOUTS = Object.freeze(['clean', 'punch', 'card', 'split', 'pip']);

/**
 * What each moment kind wants on screen, in preference order, and which
 * framings suit it. The first entry whose graphic is not already on screen
 * (and whose layout did not just run) is taken, so a repeated kind varies
 * itself instead of pasting the same card three times.
 */
export const KIND_PLAN = Object.freeze({
    stat:     { graphics: ['kpi-stat-callout', 'stat-grid', 'data-counter', 'donut-chart'], layouts: ['card', 'punch', 'split'] },
    list:     { graphics: ['step-card', 'checklist', 'process-flow', 'cycle-diagram', 'kinetic-title'], layouts: ['card', 'split', 'punch'] },
    contrast: { graphics: ['split-label', 'comparison-card', 'comparison-matrix', 'h-bar-chart'], layouts: ['split', 'card'] },
    question: { graphics: ['question-card', 'kinetic-title'],                               layouts: ['punch', 'card'] },
    quote:    { graphics: ['quote-card', 'comment-bubble', 'dm-bubble'],                    layouts: ['card', 'clean'] },
    product:  { graphics: ['screenshot-card', 'profile-portrait', 'ui-card', 'video-thumbnail', 'logo-card'], layouts: ['pip', 'card', 'punch'] },
    cta:      { graphics: ['cta-widget', 'cta-banner', 'social-notification', 'engagement-counter'], layouts: ['card', 'punch'] },
    claim:    { graphics: ['kinetic-title', 'status-label', 'highlight-box'],               layouts: ['punch', 'clean'] },
    emphasis: { graphics: ['word-cycle', 'status-label', 'underline'],                      layouts: ['punch', 'clean'] },
});/**
 * A storyboard graphic name → the thing that can actually draw it.
 *
 * Every name in KIND_PLAN must resolve here, and a check asserts exactly that.
 * This is ADR-001 at the planning layer: a planner that can name a graphic
 * nothing builds produces a beat that validates, reports success, and renders
 * an empty rectangle. Cheaper to make impossible than to debug later.
 *
 * @param {string} name
 * @returns {{ source:'template'|'component', id:string }|null}
 */
export function resolveGraphic(name) {
    const id = String(name || '');
    if (TEMPLATE_KINDS.includes(id)) return { source: 'template', id };
    // 'kinetic-title' → 'KineticTitle', 'cta-widget' → 'CTAWidget'.
    const pascal = id.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
    const match = COMPONENT_IDS.find(c => c.toLowerCase() === pascal.toLowerCase());
    return match ? { source: 'component', id: match } : null;
}

/** Defaults. Every one is overridable per call; none is a magic number in code. */
export const DEFAULTS = Object.freeze({
    /** Graphic beats per minute of video. Twelve is one every five seconds. */
    maxPerMinute: 12,
    /** Seconds between the START of two beats. */
    minGap: 2.2,
    /** A beat never holds longer than this, however long its phrase. */
    maxHold: 4.5,
    /**
     * And never shorter than this. TextCraft's MIN_READ_HOLD_S (0.6s) is the
     * floor for one swapped WORD inside a line that is already on screen; a
     * whole graphic has to arrive, be read and leave, so a two-word stat card
     * held for 0.6s would flash. This is the floor for a beat.
     */
    minHold: 1.6,
    /** Seconds of clean speaker before the first graphic. */
    leadIn: 1.2,
    /** A beat start this close to a cut snaps onto it. */
    snapWindow: 0.45,
    /** Extra hold per word beyond the first three. */
    holdPerWord: 0.16,
});

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/**
 * How much of `b`'s words already appeared in `a`, 0 to 1.
 *
 * Two moments can be found inside ONE sentence — "first you record, second
 * you upload, third you publish" is three list cues — and far enough apart in
 * time to survive the gap rule. The second beat then puts words on screen
 * that the first beat is still showing. Measured on words rather than
 * characters so word order and punctuation do not matter.
 */
export function phraseOverlap(a, b) {
    const words = (v) => new Set(String(v || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean));
    const prev = words(a);
    const next = words(b);
    if (next.size === 0) return 0;
    let shared = 0;
    for (const w of next) if (prev.has(w)) shared += 1;
    return shared / next.size;
}

/** Past this share of repeated words, a beat is saying what the last one said. */
export const MAX_PHRASE_OVERLAP = 0.6;
const round = (v, p = 3) => Math.round(num(v, 0) * 10 ** p) / 10 ** p;

/**
 * How long a beat carrying `text` must stay up to be readable.
 * Floors at TextCraft's own minimum so the storyboard and the text engine
 * cannot disagree about what "long enough to read" means.
 */
export function holdFor(text, opts = {}) {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
    const perWord = num(opts.holdPerWord, DEFAULTS.holdPerWord);
    const maxHold = num(opts.maxHold, DEFAULTS.maxHold);
    const minHold = Math.max(MIN_READ_HOLD_S, num(opts.minHold, DEFAULTS.minHold));
    const want = minHold + Math.max(0, words - 3) * perWord;
    return round(Math.min(maxHold, Math.max(minHold, want)));
}

/**
 * Pick the graphic and layout for a moment, avoiding what just ran.
 * Returns `{ graphic, layout }`; never null — every kind has a first choice,
 * and falling back to it is better than dropping the beat.
 */
export function chooseFor(kind, prev = {}, kindPlan = KIND_PLAN) {
    const plan = kindPlan?.[kind] || KIND_PLAN[kind] || KIND_PLAN.claim;
    // Only graphics something can draw are offered. A name that stops
    // resolving (a template renamed, a component removed) drops out of the
    // rotation instead of planning a beat nobody can build.
    const usable = plan.graphics.filter(g => resolveGraphic(g));
    const graphics = usable.length ? usable : plan.graphics;
    const graphic = graphics.find(g => g !== prev.graphic) || graphics[0];
    const layout = plan.layouts.find(l => l !== prev.layout) || plan.layouts[0];
    return { graphic, layout };
}

/**
 * The storyboard.
 *
 * @param {object} input
 * @param {Array}  [input.words]     transcript words (MomentAnalyzer reads these)
 * @param {Array}  [input.moments]   moments, if they were found elsewhere
 * @param {number[]} [input.cuts]    shot boundaries from ShotSampler
 * @param {number} input.duration    seconds of video being planned
 * @param {object} [input.opts]      overrides of DEFAULTS
 * @returns {{ beats:Array, reasoning:string[], density:number, skipped:number }}
 */
export function planStoryboard({ words, moments, cuts = [], duration, opts = {} } = {}) {
    const total = num(duration, 0);
    const cfg = { ...DEFAULTS, ...(opts || {}) };
    const kindPlan = cfg.kindPlan || KIND_PLAN;
    const reasoning = [];
    if (!(total > 0)) return { beats: [], reasoning: ['There is no duration to plan over.'], density: 0, skipped: 0 };

    const found = Array.isArray(moments) && moments.length
        ? moments
        : findMoments(words || [], { minGap: cfg.minGap });
    if (found.length === 0) {
        return {
            beats: [],
            reasoning: ['Nothing in the transcript reads as a moment worth a graphic, so the speaker stays clean.'],
            density: 0,
            skipped: 0,
        };
    }

    // The cap is a RATE, not a count: a 20s short and a 3min video should not
    // get the same number of graphics.
    const budget = Math.max(1, Math.round((total / 60) * cfg.maxPerMinute));
    const chosen = capMoments(found, { minGap: cfg.minGap, max: budget });
    if (chosen.length < found.length) {
        reasoning.push(`${found.length} moments found, ${chosen.length} kept — ${cfg.maxPerMinute} graphics a minute is the ceiling, so the weakest were dropped rather than crowded in.`);
    }

    const beats = [];
    let skipped = 0;
    let prev = {};
    for (const m of chosen) {
        let start = num(m.t, 0);

        // The opening stays clean: a graphic over the first words is on screen
        // before the viewer knows who is talking.
        if (start < cfg.leadIn) { skipped += 1; continue; }

        const snapped = nearestBoundary(cuts, start, cfg.snapWindow);
        if (snapped !== null && snapped < total) {
            if (snapped !== start) reasoning.push(`The beat at ${round(start, 1)}s moved to the cut at ${round(snapped, 1)}s.`);
            start = snapped;
        }

        const last = beats[beats.length - 1];
        if (last && start - last.start < cfg.minGap) { skipped += 1; continue; }
        if (last && phraseOverlap(last.text, m.text) > MAX_PHRASE_OVERLAP) {
            reasoning.push(`The beat at ${round(start, 1)}s repeated the words already on screen, so it was left clean.`);
            skipped += 1;
            continue;
        }

        const { graphic, layout } = chooseFor(m.kind, prev, kindPlan);
        const hold = holdFor(m.text, cfg);
        // A beat never runs past the end of the video, and never past the
        // start of the next one: overlapping graphics are the "elements arrive
        // simultaneously" defect in its worst form.
        let end = Math.min(total, start + hold);
        if (end - start < 0.4) { skipped += 1; continue; }

        const resolved = resolveGraphic(graphic);
        beats.push({
            id: `beat-${beats.length + 1}`,
            start: round(start),
            end: round(end),
            kind: m.kind,
            layout,
            graphic,
            // Which half of the engine builds it, so the caller does not have
            // to guess from the name.
            source: resolved?.source || null,
            builds: resolved?.id || null,
            // The speaker's own words. Nothing here was written for them.
            text: m.text,
            evidence: m.evidence || null,
            onCut: snapped !== null,
            reason: `${m.kind} at ${round(start, 1)}s — ${graphic} in a ${layout} framing, held ${round(hold, 1)}s.`,
        });
        prev = { graphic, layout };
    }

    // Trim any beat that would still overlap the next one's start.
    for (let i = 0; i < beats.length - 1; i++) {
        if (beats[i].end > beats[i + 1].start) beats[i].end = round(beats[i + 1].start);
    }

    const density = total > 0 ? round((beats.length / total) * 60, 2) : 0;
    reasoning.unshift(`${beats.length} graphic beats over ${round(total, 1)}s (${density} a minute); the rest of the video stays on the speaker.`);
    if (skipped > 0) reasoning.push(`${skipped} moment${skipped === 1 ? ' was' : 's were'} left clean — too early, too close to the beat before, already said, or with no room left.`);
    return { beats, reasoning, density, skipped };
}

/**
 * The stretches with NO graphic over them. The storyboard is as much about
 * where nothing happens as where something does, and a caller that wants to
 * punch in on the speaker needs to know which seconds are free.
 */
export function cleanSpans(beats, duration) {
    const total = num(duration, 0);
    const spans = [];
    let at = 0;
    for (const b of [...(beats || [])].sort((a, b) => a.start - b.start)) {
        if (b.start > at) spans.push({ start: round(at), end: round(b.start) });
        at = Math.max(at, num(b.end, at));
    }
    if (total > at) spans.push({ start: round(at), end: round(total) });
    return spans;
}

export default { LAYOUTS, KIND_PLAN, DEFAULTS, MAX_PHRASE_OVERLAP, resolveGraphic, phraseOverlap, holdFor, chooseFor, planStoryboard, cleanSpans };
