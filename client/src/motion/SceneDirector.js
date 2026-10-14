/**
 * client/src/motion/SceneDirector.js
 *
 * R95 — PHASE 4: a brief becomes a designed scene.
 *
 * "Make this product reveal feel like a premium technology launch. Introduce
 * the product, highlight three benefits, and finish with a strong call to
 * action."
 *
 * Phases 1-3 gave us a scene, a validator, a layout system and coordinated
 * motion. What was still missing is the decision: WHAT should be on screen,
 * in what order, in what voice, and where it can go without covering the
 * person speaking. That is this module.
 *
 *   1. READ THE BRIEF — tone, the narrative beats asked for, how many of
 *      each, the pacing (`planFromBrief`). Deterministic; an AI plan can be
 *      passed in and wins where it has something to say.
 *   2. CHOOSE THE ART DIRECTION — a look per beat from `SceneComposer.LOOKS`,
 *      a palette, a typographic hierarchy.
 *   3. COMPOSE — each beat becomes a group in ONE scene, timed in sequence,
 *      placed where the subject of the shot is not (`placementAvoiding`).
 *
 * What it deliberately does NOT do: invent claims. A brief that asks for
 * "three benefits" without saying what they are gets three EDITABLE
 * placeholders, and the caller is told so. Writing marketing copy the user
 * never approved into their video would be worse than an empty slot.
 */

import { composeComponentScene } from './SceneComposer.js';
import { contentRectFor, resolveFrame } from './SceneLayout.js';
import { createScene, createGroup, normalizeScene, sceneContentDuration } from './SceneSchema.js';

/** The kinds of beat a graphic sequence is built from. */
export const BEAT_KINDS = ['intro', 'point', 'stat', 'quote', 'cta', 'outro'];

/** Which composed component plays each beat, and in which look. */
const BEAT_COMPONENT = {
    intro: { component: 'TitleSequence', share: 1.5 },
    point: { component: 'KineticTitle', share: 1 },
    stat:  { component: 'StatCallout', share: 1 },
    quote: { component: 'TitleSequence', share: 1.3 },
    cta:   { component: 'KineticTitle', share: 1.1 },
    outro: { component: 'TitleSequence', share: 1 },
};

/**
 * Tone → art direction. The preset per beat kind is what gives a sequence one
 * voice: a premium launch opens cinematic and closes with a confident push,
 * where a viral hook slams in all the way through.
 */
export const TONES = {
    premium: {
        label: 'premium',
        match: /premium|luxur|high[- ]end|elegant|refined|sophisticat|apple|flagship/,
        presets: { intro: 'cinematic', point: 'creator', stat: 'metric-callout', quote: 'minimal', cta: 'creator', outro: 'minimal' },
        palette: { text: '#ffffff', sub: '#E2E8F0', accent: '#C8A96A' },
        pacing: 'measured',
    },
    technology: {
        label: 'technology',
        match: /technolog|tech\b|launch|product reveal|engineer|futur|ai\b|software|platform/,
        presets: { intro: 'cinematic', point: 'creator', stat: 'metric-callout', quote: 'minimal', cta: 'punchy', outro: 'minimal' },
        palette: { text: '#ffffff', sub: '#E2E8F0', accent: '#00E5FF' },
        pacing: 'measured',
    },
    viral: {
        label: 'punchy',
        match: /viral|hook|tiktok|reel|short|punchy|hype|energetic|fast|aggressive/,
        presets: { intro: 'modern-bold', point: 'punchy', stat: 'metric-callout', quote: 'modern-bold', cta: 'punchy', outro: 'modern-bold' },
        palette: { text: '#ffffff', sub: '#ffffff', accent: '#FFE500' },
        pacing: 'rapid',
    },
    editorial: {
        label: 'editorial',
        match: /explain|editorial|documentar|investigat|essay|analysis|report|teach|tutorial/,
        presets: { intro: 'minimal', point: 'creator', stat: 'growth', quote: 'minimal', cta: 'creator', outro: 'minimal' },
        palette: { text: '#ffffff', sub: '#A0AEC0', accent: '#38BDF8' },
        pacing: 'deliberate',
    },
    warm: {
        label: 'warm',
        match: /warm|friendly|human|personal|story|vlog|cosy|calm|gentle/,
        presets: { intro: 'cinematic', point: 'creator', stat: 'growth', quote: 'minimal', cta: 'creator', outro: 'minimal' },
        palette: { text: '#ffffff', sub: '#E8DCC8', accent: '#E8C27A' },
        pacing: 'calm',
    },
};

const TONE_KEYS = Object.keys(TONES);

/** How long a beat is allowed to sit on screen, by pacing. */
const PACING_SECONDS = { rapid: [1.4, 2.4], measured: [2.2, 3.6], deliberate: [2.6, 4.2], calm: [2.6, 4.5] };

const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const round = (v, p = 3) => Math.round(num(v, 0) * 10 ** p) / 10 ** p;

/** The tone the brief asks for, by first match, else technology. */
export function toneFromBrief(brief) {
    const s = String(brief || '').toLowerCase();
    let best = null;
    for (const key of TONE_KEYS) {
        const at = s.search(TONES[key].match);
        if (at >= 0 && (best === null || at < best.at)) best = { key, at };
    }
    return TONES[best?.key || 'technology'];
}

/** "three benefits" / "3 reasons" → 3. Capped, because a title per second is noise. */
function countNear(text, pattern, fallback) {
    const s = String(text || '').toLowerCase();
    const re = new RegExp(`\\b(\\d{1,2}|${Object.keys(WORD_NUMBERS).join('|')})\\s+(?:\\w+\\s+){0,2}?(?:${pattern})`, 'i');
    const m = s.match(re);
    if (!m) return fallback;
    const n = Number(m[1]) || WORD_NUMBERS[m[1]] || fallback;
    return Math.max(1, Math.min(6, n));
}

/**
 * Read a brief into an ordered list of beats.
 *
 * Each beat is `{ kind, text, kicker, value, label }`. `text` is null when the
 * brief asked for a beat without saying what it should say — the caller is
 * expected to surface those as editable placeholders rather than let this
 * module invent the words.
 *
 * @param {string} brief
 * @param {{plan?:object, title?:string, items?:string[], duration?:number, tone?:string}} [opts]
 * @returns {{tone:object, beats:Array, pacing:string, placeholders:number, rationale:string[]}}
 */
export function planFromBrief(brief, opts = {}) {
    const text = String(brief || '');
    const s = text.toLowerCase();
    const plan = opts.plan && typeof opts.plan === 'object' ? opts.plan : null;
    // Tone resolution, most specific wins: an explicit opts.tone (the editor
    // picked one), then the AI's own read of the brief (plan.tone, cleaned
    // server-side against this same TONES table), then the regex fallback.
    const tone = (opts.tone && TONES[opts.tone]) ? TONES[opts.tone]
        : (plan?.tone && TONES[plan.tone]) ? TONES[plan.tone]
        : toneFromBrief(text);
    const rationale = [];
    const beats = [];

    // An AI plan, when there is one, supplies the words. It never decides the
    // structure on its own: the brief does, so the result still matches what
    // was asked for.
    const planBeats = Array.isArray(plan?.beats) ? plan.beats : [];
    const planTitle = typeof plan?.title === 'string' && plan.title.trim() ? plan.title.trim() : null;
    const planPoints = Array.isArray(plan?.points) ? plan.points.filter(p => typeof p === 'string' && p.trim()) : [];
    const planCta = typeof plan?.cta === 'string' && plan.cta.trim() ? plan.cta.trim() : null;
    const items = Array.isArray(opts.items) ? opts.items.filter(i => typeof i === 'string' && i.trim()) : [];

    if (planBeats.length) {
        // The plan already describes the sequence beat by beat.
        for (const b of planBeats.slice(0, 8)) {
            const kind = BEAT_KINDS.includes(b?.kind) ? b.kind : 'point';
            beats.push({
                kind,
                text: typeof b?.text === 'string' && b.text.trim() ? b.text.trim() : null,
                kicker: typeof b?.kicker === 'string' ? b.kicker.trim() || null : null,
                value: typeof b?.value === 'string' ? b.value.trim() || null : null,
                label: typeof b?.label === 'string' ? b.label.trim() || null : null,
            });
        }
        rationale.push(`The sequence follows the ${beats.length} beats in the plan.`);
    } else {
        const pointWords = 'benefit|benefits|reason|reasons|point|points|feature|features|step|steps|pillar|pillars|tip|tips|way|ways';
        const wantsPoints = new RegExp(`\\b(?:${pointWords})\\b`).test(s);
        const wantsStat = /\bstat|\bnumber|\bmetric|\bresult|%|\bgrowth|\broi\b/.test(s);
        const wantsQuote = /\bquote|\btestimonial|\bsaid\b/.test(s);
        const wantsCta = /call to action|\bcta\b|subscribe|sign ?up|follow|buy|order|book|download|get started|learn more/.test(s);
        // An opening because the brief asks for one, or because nothing else
        // was asked for. `beats.length === 0` here would always be true (the
        // list is still empty at this point), so every brief got an intro
        // whether it wanted one or not.
        const wantsIntro = /introduc|open(?:ing|s)?\b|start with|set ?up|reveal|title/.test(s)
            || !(wantsPoints || wantsStat || wantsQuote || wantsCta);

        if (wantsIntro) {
            beats.push({ kind: 'intro', text: planTitle || opts.title || null, kicker: null });
            rationale.push('It opens with a title, because the brief asks for an introduction.');
        }
        if (wantsPoints) {
            const n = countNear(s, pointWords, 3);
            for (let i = 0; i < n; i++) {
                beats.push({ kind: 'point', text: planPoints[i] || items[i] || null, kicker: String(i + 1).padStart(2, '0') });
            }
            rationale.push(`${n} points, numbered, so the viewer can count along.`);
        }
        if (wantsStat) {
            beats.push({ kind: 'stat', text: null, value: null, label: planPoints[0] || null });
            rationale.push('One figure gets a callout of its own.');
        }
        if (wantsQuote) beats.push({ kind: 'quote', text: planPoints[0] || null });
        if (wantsCta) {
            beats.push({ kind: 'cta', text: planCta || null, kicker: null });
            rationale.push('It closes on the call to action.');
        }
        if (beats.length === 0) {
            beats.push({ kind: 'intro', text: planTitle || opts.title || null });
            rationale.push('Nothing specific was asked for, so it is a single title.');
        }
    }

    rationale.unshift(`The tone reads as ${tone.label}, so the look and the pacing follow that.`);
    return {
        tone,
        pacing: tone.pacing,
        beats,
        placeholders: beats.filter(b => !b.text && b.kind !== 'stat').length,
        rationale,
    };
}

/**
 * Where a graphic can go without covering the subject of the shot.
 *
 * @param {{cx:number, cy:number, w:number, h:number}|null} subject fractions of the frame
 * @param {object} frameOrAspect
 * @returns {{anchor:'top'|'centre'|'bottom', x:number, rect:object, reason:string}}
 */
export function placementAvoiding(subject, frameOrAspect, safeZone = null) {
    const frame = resolveFrame(frameOrAspect);
    const rect = contentRectFor(frame, safeZone);
    if (!subject || !Number.isFinite(num(subject.cy, NaN))) {
        return { anchor: 'centre', x: 50, rect, reason: 'Nothing is tracked in the shot, so the graphic sits in the middle.' };
    }
    const top = num(subject.cy, 0.5) - num(subject.h, 0.4) / 2;
    const bottom = num(subject.cy, 0.5) + num(subject.h, 0.4) / 2;
    const roomAbove = Math.max(0, top - rect.y / frame.h);
    const roomBelow = Math.max(0, (rect.y + rect.h) / frame.h - bottom);
    // A third of the frame is enough for a title block; take the roomier side.
    if (roomAbove >= 0.22 && roomAbove >= roomBelow) {
        return { anchor: 'top', x: 50, rect: { ...rect, h: Math.max(1, top * frame.h - rect.y) }, reason: 'The subject is low in the shot, so the graphic goes above them.' };
    }
    if (roomBelow >= 0.22) {
        const y = bottom * frame.h;
        return { anchor: 'bottom', x: 50, rect: { ...rect, y, h: Math.max(1, rect.y + rect.h - y) }, reason: 'The subject is high in the shot, so the graphic goes below them.' };
    }
    // The subject fills the frame: offset sideways rather than over their face.
    const cx = num(subject.cx, 0.5);
    const x = cx > 0.5 ? 30 : 70;
    return { anchor: 'centre', x, rect, reason: 'The subject fills the frame, so the graphic sits to one side of them.' };
}

/** The subject's median box from a clip's tracked mask, or null. */
export function subjectFromClips(clips) {
    const samples = [];
    for (const clip of clips || []) {
        const track = clip?.layerMask?.bboxTrack;
        if (Array.isArray(track)) {
            for (const s of track) if (s && Number.isFinite(Number(s.cx))) samples.push(s);
        }
    }
    if (samples.length === 0) return null;
    const median = (list) => {
        const sorted = [...list].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length / 2)];
    };
    return {
        cx: median(samples.map(s => num(s.cx, 0.5))),
        cy: median(samples.map(s => num(s.cy, 0.5))),
        w: median(samples.map(s => num(s.w, 0.4))),
        h: median(samples.map(s => num(s.h, 0.5))),
    };
}

/** Placeholder text for a beat the brief did not fill in. */
function placeholderFor(beat, index) {
    switch (beat.kind) {
        case 'intro': return 'YOUR HEADLINE';
        // Numbered by its own place among the points, not by its place in the
        // whole sequence: "Point 1" after the intro, not "Point 2".
        case 'point': return `Point ${Number(beat.kicker) || index}`;
        case 'cta': return 'YOUR CALL TO ACTION';
        case 'quote': return 'Your quote here';
        case 'outro': return 'THANK YOU';
        default: return `Beat ${index}`;
    }
}

/**
 * Compose a whole graphic sequence from a brief.
 *
 * Every beat becomes a GROUP inside one scene, timed one after another, so the
 * result is a single editable thing: drag a group to retime that beat, open a
 * node to change its words, and the clips on the timeline follow.
 *
 * @param {string} brief
 * @param {{aspectRatio?:string, frame?:object, safeZone?:object, duration?:number,
 *          plan?:object, title?:string, items?:string[], tone?:string,
 *          subject?:object, clips?:Array, palette?:object, start?:number}} [opts]
 * @returns {{scene:object, plan:object, placement:object, placeholders:string[]}|null}
 */
export function composeSceneFromBrief(brief, opts = {}) {
    // Nothing to read means nothing to design: refused here rather than
    // quietly producing a title nobody asked for.
    if (!String(brief || '').trim()) return null;
    const frame = resolveFrame(opts.frame || opts.aspectRatio || '16:9');
    const plan = planFromBrief(brief, opts);
    if (plan.beats.length === 0) return null;

    const subject = opts.subject || subjectFromClips(opts.clips);
    const placement = placementAvoiding(subject, frame, opts.safeZone || null);

    // Share the time out by beat weight, inside the pacing's comfortable range.
    const [minBeat, maxBeat] = PACING_SECONDS[plan.pacing] || PACING_SECONDS.measured;
    const weights = plan.beats.map(b => BEAT_COMPONENT[b.kind]?.share || 1);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const asked = num(opts.duration, 0);
    const natural = plan.beats.reduce((sum, b, i) => sum + Math.min(maxBeat, Math.max(minBeat, weights[i] * ((minBeat + maxBeat) / 2))), 0);
    const total = asked > 0 ? asked : natural;

    const placeholders = [];
    const groups = [];
    let cursor = 0;
    plan.beats.forEach((beat, i) => {
        const share = (weights[i] / totalWeight) * total;
        const duration = round(Math.min(maxBeat * 1.6, Math.max(minBeat * 0.8, share)));
        const spec = BEAT_COMPONENT[beat.kind] || BEAT_COMPONENT.point;
        const preset = plan.tone.presets[beat.kind] || Object.keys({})[0];
        const text = beat.text || placeholderFor(beat, i + 1);
        if (!beat.text && beat.kind !== 'stat') placeholders.push(text);

        const params = {
            duration,
            x: placement.x,
            anchor: placement.anchor,
            color: opts.palette?.text || plan.tone.palette.text,
            subColor: opts.palette?.sub || plan.tone.palette.sub,
            accentColor: opts.palette?.accent || opts.palette?.primary || plan.tone.palette.accent,
        };
        if (beat.kind === 'stat') {
            params.value = beat.value || '+00%';
            params.label = beat.label || text;
            if (!beat.value) placeholders.push(params.value);
        } else {
            params.title = text;
            if (beat.kicker) params.kicker = beat.kicker;
            if (beat.sub) params.subtitle = beat.sub;
        }

        const beatScene = composeComponentScene(spec.component, preset, params, { frame, safeZone: opts.safeZone });
        if (!beatScene) return;
        // The component's own group becomes this beat's group, placed in time.
        const inner = beatScene.nodes[0];
        groups.push(createGroup({
            name: `${i + 1}. ${beat.kind}`,
            transform: { x: 0, y: 0 },
            start: round(cursor),
            duration,
            children: inner.children,
            // A beat arrives as one move: its layers stagger inside it.
            motion: { stagger: plan.pacing === 'rapid' ? 0.08 : 0.12, order: 'forward' },
            origin: { beat: beat.kind, index: i, component: spec.component, preset },
        }));
        cursor = round(cursor + duration);
    });

    if (groups.length === 0) return null;
    const scene = normalizeScene(createScene({
        name: `Sequence (${plan.tone.label})`,
        frame,
        duration: sceneContentDuration(groups),
        nodes: groups,
        meta: {
            director: true,
            brief: String(brief || '').slice(0, 300),
            tone: plan.tone.label,
            pacing: plan.pacing,
            beats: plan.beats.map(b => b.kind),
            rationale: [...plan.rationale, placement.reason],
            placeholders: placeholders.length,
        },
    }));
    return { scene, plan, placement, placeholders };
}

export default {
    BEAT_KINDS,
    TONES,
    toneFromBrief,
    planFromBrief,
    placementAvoiding,
    subjectFromClips,
    composeSceneFromBrief,
};
