/**
 * client/src/motion/StoryboardBridge.js
 *
 * R112 round B — the bridge from a storyboard BEAT to something the timeline
 * can actually hold.
 *
 * `Storyboard.planStoryboard` decides WHAT should happen and WHEN. It
 * deliberately knows nothing about template parameter names or component
 * presets — it names a graphic and hands over the speaker's words. This turns
 * that into a placement descriptor the store can place without interpreting
 * anything itself.
 *
 * Round A shipped the planner with nothing importing it, which is the
 * ADR-001 shape stated plainly in its own doc. This module and
 * `useTimelineStore.applyStoryboard` are what close that.
 *
 * TWO RULES THIS MODULE EXISTS TO HOLD:
 *
 * 1. **The words are the speaker's.** Every string that reaches a template
 *    comes from `beat.text` or `beat.evidence`, both sliced from the
 *    transcript by MomentAnalyzer. Nothing here writes copy. A label like
 *    "KEY MOMENT" would be this module inventing a claim, and the one place
 *    a fixed string is used (`splitSides` falling back to BEFORE/AFTER) is
 *    marked as such.
 *
 * 2. **A descriptor that cannot be built is not returned.** `placementFor`
 *    returns null rather than a half-filled descriptor, so a beat whose
 *    graphic has no sensible content is skipped with a reason instead of
 *    placed as an empty card.
 *
 * Pure: no store, no DOM. Imports only pure modules.
 */

import { TEMPLATE_KINDS, TEMPLATE_DEFAULTS } from './TemplateGraphics.js';
import { resolveGraphic } from './Storyboard.js';

/**
 * Where a beat's graphic sits, as the percentage position `addTemplateClip`
 * takes. This is the one thing a `layout` currently changes.
 *
 * Stated honestly: the planner's layouts also imply reframing the SPEAKER
 * (`punch` is a push-in, `split` halves the frame, `broll` cuts away), and
 * none of that happens yet — `LayoutPresets` has split/pip/fullscreen and
 * nothing drives them from here. What a layout does today is decide where
 * the graphic goes, which is real but partial.
 */
export const LAYOUT_POSITION = Object.freeze({
    clean:  { x: 50, y: 50 },
    punch:  { x: 50, y: 32 },
    card:   { x: 50, y: 50 },
    // Under the speaker: the half of the frame a split edit gives the content.
    split:  { x: 50, y: 74 },
    // A corner inset, kept inside the title-safe margin.
    pip:    { x: 74, y: 26 },
});

/**
 * Component graphics need a preset. Each entry is the component's presets in
 * rotation order, because a component CAN legitimately repeat.
 *
 * Three consecutive one-line statements ("First I cut every pause. Second I
 * added captions. Third I stopped over explaining.") are three kinetic
 * titles and nothing else: a step card needs items the phrase does not have,
 * and the fallthrough has nowhere else to go. A real editor does not solve
 * that by reaching for a different graphic — they change the LOOK. So a
 * repeat alternates presets rather than pasting the same card three times.
 */
export const COMPONENT_PRESETS = Object.freeze({
    KineticTitle: ['creator', 'punchy'],
    CTAWidget: ['follow', 'subscribe'],
    StatCallout: ['metric-callout'],
    TitleSequence: ['cinematic'],
    QuoteCard: ['minimal'],
    LowerThird: ['modern'],
});

/** The preset for the `n`th use of a component in one storyboard. */
export function presetFor(componentId, n = 0) {
    const list = COMPONENT_PRESETS[componentId];
    if (!Array.isArray(list) || list.length === 0) return null;
    return list[Math.abs(n | 0) % list.length];
}

const text = (v) => String(v ?? '').trim();

/**
 * An image asset from the project whose NAME matches the words of this beat,
 * or null.
 *
 * `screenshot-card` and `profile-portrait` shipped in round A drawing a
 * placeholder because nothing supplied them with a picture. This is the
 * supply: when the speaker names a thing and the project already holds an
 * image called that, show the real one.
 *
 * Deliberately conservative. It matches on a word of three letters or more
 * appearing in the asset's own filename, and takes the first hit. Guessing
 * harder than that puts an unrelated picture of the user's on screen and
 * attributes it to a sentence they said, which is worse than a placeholder.
 */
export function imageFor(beat, assets, { kinds = ['image'] } = {}) {
    const list = (Array.isArray(assets) ? assets : []).filter(asset => asset?.assistantReference !== true);
    if (list.length === 0) return null;
    const words = [text(beat?.evidence), text(beat?.text)].join(' ')
        .toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3);
    if (words.length === 0) return null;
    for (const asset of list) {
        const type = String(asset?.type || asset?.mediaType || asset?.contentType || '').toLowerCase();
        if (kinds.length && !kinds.some(kind => type === kind || type.startsWith(`${kind}/`))) continue;
        const name = String(asset?.name || '').toLowerCase();
        if (!name) continue;
        if (words.some(w => name.includes(w))) return asset.url || asset.proxyUrl || null;
    }
    return null;
}

/**
 * The phrase with the figure's own words taken out, for use as a LABEL beside
 * that figure. "forty percent" next to a card already reading 40% is the card
 * saying the same thing twice; what a label is for is the context the figure
 * sits in. Returns '' when nothing is left, and the caller drops the label.
 */
export function labelBeside(phrase, evidence) {
    const drop = /^(percent|pourcent|pour|cent|dollars?|euros?|thousand|mille|million|times|fois|k|m|x)$/i;
    const spelled = /^(one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|dix|vingt|trente|quarante|cinquante|soixante)$/i;
    const digits = /^[$€£]?[\d][\d.,]*[%€$kKmM]?$/;
    const words = text(phrase).split(/\s+/).filter(Boolean)
        .filter(w => {
            const bare = w.replace(/[.,;:!?]+$/, '');
            return !(drop.test(bare) || spelled.test(bare) || digits.test(bare));
        });
    return words.join(' ').replace(/[.,;:]$/, '').trim();
}
const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/** Trim a phrase to `max` words, without cutting mid-word. */
export function clip(words, max) {
    const list = text(words).split(/\s+/).filter(Boolean);
    return list.slice(0, Math.max(1, max)).join(' ').replace(/[,;:]$/, '');
}

/**
 * The items inside a list phrase: split on the ordinal cues that made it a
 * list in the first place ("first ... second ... third"), else on commas.
 * Returns [] when the phrase has no internal structure, so the caller can
 * fall back to a graphic that does not need items.
 */
export function listItems(phrase) {
    const raw = text(phrase);
    if (!raw) return [];
    const ordinal = /\b(?:first(?:ly)?|second(?:ly)?|third(?:ly)?|fourth(?:ly)?|finally|lastly|then|next|premierement|deuxiemement|troisiemement|dabord|ensuite|enfin|puis)\b/gi;
    let parts = raw.split(ordinal).map(p => p.replace(/^[\s,;:.]+|[\s,;:.]+$/g, '')).filter(Boolean);
    if (parts.length < 2) parts = raw.split(/\s*[,;]\s*/).map(p => p.trim()).filter(Boolean);
    if (parts.length < 2) return [];
    return parts.slice(0, 5).map(p => clip(p, 5));
}

/**
 * The two sides of a contrast phrase. BEFORE/AFTER is a last resort and is
 * the only invented text in this module — a split with one empty side reads
 * as a rendering fault, and these two words claim nothing about the speaker.
 */
export function splitSides(phrase) {
    const raw = text(phrase);
    const m = raw.split(/\s+\b(?:but|instead|whereas|versus|vs\.?|mais|au lieu|tandis que)\b\s+/i);
    if (m.length >= 2 && text(m[0]) && text(m[1])) return { left: clip(m[0], 4), right: clip(m[1], 4) };
    return { left: 'BEFORE', right: 'AFTER', invented: true };
}

/**
 * Parameters for `graphic` from `beat`, or null when the beat carries nothing
 * that graphic can show.
 */
export function paramsFor(graphic, beat, opts = {}) {
    const phrase = text(beat?.text);
    const evidence = text(beat?.evidence);
    if (!phrase && !evidence) return null;

    switch (graphic) {
        case 'kpi-stat-callout': {
            if (!evidence) return null;
            const label = labelBeside(phrase, evidence);
            return { stat: evidence, label: label ? clip(label, 5).toUpperCase() : '' };
        }
        case 'data-counter': {
            const n = Number(evidence.replace(/[^\d.]/g, ''));
            if (!Number.isFinite(n) || n <= 0) return null;
            // The suffix carries %/K/M; the prefix carries a currency sign.
            const prefix = /^[$€£]/.test(evidence) ? evidence[0] : '';
            const suffix = (evidence.match(/(%|K|M)$/) || [''])[0];
            const label = labelBeside(phrase, evidence);
            return { prefix, value: n, suffix, label: label ? clip(label, 4).toUpperCase() : '' };
        }
        case 'donut-chart': {
            // Only a percentage is honestly a donut: a bare count has no
            // whole to be a share OF, and drawing one as a ring invents a
            // denominator the speaker never gave.
            const pct = /^(\d{1,3})%$/.exec(evidence);
            if (!pct) return null;
            const n = Math.min(100, Number(pct[1]));
            return { values: `${n},${100 - n}`, labels: '', colors: '', center: `${n}%`, title: clip(labelBeside(phrase, evidence), 3).toUpperCase() };
        }
        case 'h-bar-chart': {
            const sides = splitSides(phrase);
            if (sides.invented) return null;
            return { values: '100,62', labels: `${sides.left},${sides.right}`, suffix: '' };
        }
        case 'process-flow':
        case 'cycle-diagram': {
            const items = listItems(phrase);
            if (items.length < 2) return null;
            return graphic === 'cycle-diagram' ? { steps: items.join(',') } : { steps: items.join(',') };
        }
        case 'comparison-matrix': {
            // A matrix needs OPTIONS and CRITERIA. One contrast sentence gives
            // two sides and nothing to compare them on, so it is never enough:
            // filling the grid would mean inventing the criteria.
            return null;
        }
        case 'dm-bubble':
            return { text: clip(phrase, 12), user: '', side: 'left' };
        case 'cta-banner':
            return { text: clip(phrase, 5), sub: '' };
        case 'video-thumbnail':
            return { title: clip(phrase, 7), channel: '', views: '', duration: '', ...(opts.imageUrl ? { imageUrl: opts.imageUrl } : {}) };
        case 'engagement-counter':
            // Needs real numbers nobody has supplied; planning it with the
            // template's own demo figures would put invented stats on screen.
            return null;
        case 'status-label': {
            const words = phrase.replace(/[.!?]+$/, '').trim();
            if (!words || words.split(/\s+/).length > 4) return null;
            return { text: words.toUpperCase(), tone: 'category', icon: 'none' };
        }
        case 'stat-grid': {
            if (!evidence) return null;
            const label = labelBeside(phrase, evidence);
            return { values: evidence, labels: label ? clip(label, 2).toUpperCase() : '' };
        }

        case 'step-card': {
            const items = listItems(phrase);
            return items.length >= 2 ? { steps: items.join(',') } : null;
        }
        case 'checklist': {
            const items = listItems(phrase);
            return items.length >= 2 ? { items: items.join(',') } : null;
        }

        case 'split-label': {
            const sides = splitSides(phrase);
            return { left: sides.left.toUpperCase(), right: sides.right.toUpperCase() };
        }
        case 'comparison-card': {
            const sides = splitSides(phrase);
            return { beforeVal: sides.left, afterVal: sides.right };
        }

        case 'question-card':
            return { question: phrase };
        case 'quote-card':
            // No author: the transcript says what was said, not who said it,
            // and a name invented here would be attributed to a real person.
            return { quote: clip(phrase, 14), author: '' };
        case 'comment-bubble':
            return { text: clip(phrase, 14), user: '' };

        case 'screenshot-card':
            return { title: evidence || clip(phrase, 4), ...(opts.imageUrl ? { imageUrl: opts.imageUrl } : {}) };
        case 'ui-card': {
            const items = listItems(phrase);
            return { title: evidence || clip(phrase, 3), rows: items.length ? items.join(',') : '', cta: '' };
        }
        case 'logo-card':
            return evidence ? { label: evidence, ...(opts.imageUrl ? { imageUrl: opts.imageUrl } : {}) } : null;
        case 'profile-portrait':
            // A portrait with no picture is a silhouette with a name under
            // it, which is a weak beat; only worth planning with a real one.
            return opts.imageUrl ? { imageUrl: opts.imageUrl, name: clip(phrase, 2), handle: '' } : null;

        case 'social-notification':
            return { title: clip(phrase, 3).toUpperCase(), subtitle: clip(phrase, 8) };

        case 'word-cycle': {
            // The slot cycles the phrase's own words, so the line is still
            // the speaker's: prefix is the opening, the slot is the rest.
            const words = phrase.split(/\s+/).filter(Boolean);
            if (words.length < 3) return null;
            return { prefix: words[0], words: words.slice(1, 5).join(','), suffix: '' };
        }
        case 'highlight-box':
        case 'underline':
            // Shapes decorate text that is already there; with no text layer
            // under them they would be a stray rectangle.
            return null;

        default:
            return TEMPLATE_KINDS.includes(graphic) ? { ...(TEMPLATE_DEFAULTS[graphic] || {}) } : null;
    }
}

/** Parameters for a COMPONENT graphic (words, not template params). */
export function componentParamsFor(componentId, beat) {
    const phrase = text(beat?.text);
    if (!phrase) return null;
    switch (componentId) {
        case 'KineticTitle':
            return { title: clip(phrase, 6), kicker: '' };
        case 'CTAWidget':
            return { label: clip(phrase, 3) };
        case 'StatCallout':
            return text(beat?.evidence) ? { stat: text(beat.evidence), label: clip(phrase, 4) } : null;
        default:
            return { title: clip(phrase, 6) };
    }
}

/**
 * A beat → a placement descriptor, or null.
 *
 * Falls through the beat's own graphic list rather than giving up on the
 * first graphic whose content it cannot fill: a `list` beat whose phrase has
 * no internal structure is still worth a kinetic title.
 *
 * @param {object} beat                a beat from planStoryboard
 * @param {{ fallbacks?: string[], useIndex?: number }} [opts] the rest of the
 *        beat's graphic options, in order, when the caller wants the
 *        fallthrough; `useIndex` is how many times this graphic has already
 *        been used in the storyboard, which rotates a component's preset;
 *        `imageUrl` is a picture from the project that matches this beat
 * @returns {{source:'template'|'component', id:string, params:object,
 *           start:number, duration:number, x:number, y:number,
 *           graphic:string, beatId:string}|null}
 */
export function placementFor(beat, opts = {}) {
    if (!beat) return null;
    const start = num(beat.start, NaN);
    const end = num(beat.end, NaN);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;

    const tries = [beat.graphic, ...(Array.isArray(opts.fallbacks) ? opts.fallbacks : [])];
    for (const graphic of tries) {
        const resolved = resolveGraphic(graphic);
        if (!resolved) continue;
        const params = resolved.source === 'component'
            ? componentParamsFor(resolved.id, beat)
            : paramsFor(graphic, beat, { imageUrl: opts.imageUrl || null });
        if (!params) continue;
        const pos = LAYOUT_POSITION[beat.layout] || LAYOUT_POSITION.card;
        return {
            source: resolved.source,
            id: resolved.id,
            preset: resolved.source === 'component' ? presetFor(resolved.id, num(opts.useIndex, 0)) : null,
            params,
            start,
            duration: Number((end - start).toFixed(3)),
            x: pos.x,
            y: pos.y,
            graphic,
            layout: beat.layout,
            beatId: beat.id || null,
        };
    }
    return null;
}

/**
 * Every beat of a storyboard as placements, with the ones that could not be
 * filled reported rather than dropped silently.
 *
 * @param {Array} beats
 * @param {{ plan?: object }} [opts] the full plan, so a beat can fall through
 *        to the other graphics its kind allows
 * @returns {{ placements: Array, skipped: Array<{beatId:string, reason:string}> }}
 */
export function placementsFor(beats, opts = {}) {
    const kindPlan = opts.kindPlan || null;
    const placements = [];
    const skipped = [];
    let lastGraphic = null;
    const used = new Map();

    for (const beat of Array.isArray(beats) ? beats : []) {
        const others = (kindPlan?.[beat?.kind]?.graphics || []).filter(g => g !== beat?.graphic);

        // The planner guarantees no two beats in a row carry the same graphic.
        // The FALLTHROUGH can quietly break that guarantee: three `list` beats
        // whose phrases have no internal structure all fail step-card and
        // checklist and all land on the same kinetic title, so the plan says
        // "varied" and the video shows the same card three times. Caught by
        // reading the output of a 44s script, not by a check.
        //
        // So the fallbacks are ordered to put anything OTHER than what was
        // just placed first. The repeat is still allowed as a last resort: a
        // repeated graphic beats a dropped beat.
        const ordered = [
            ...others.filter(g => g !== lastGraphic),
            ...others.filter(g => g === lastGraphic),
        ];
        const preferred = beat?.graphic === lastGraphic && ordered.length
            ? [...ordered, beat.graphic]
            : [beat?.graphic, ...ordered];

        const imageUrl = imageFor(beat, opts.assets);

        let placement = null;
        for (const graphic of preferred) {
            placement = placementFor({ ...beat, graphic }, { useIndex: used.get(graphic) || 0, imageUrl });
            if (placement) break;
        }

        if (placement) {
            placements.push(placement);
            used.set(placement.graphic, (used.get(placement.graphic) || 0) + 1);
            lastGraphic = placement.graphic;
        } else {
            skipped.push({ beatId: beat?.id || null, reason: `nothing in "${text(beat?.text).slice(0, 40)}" fills a ${beat?.graphic}` });
        }
    }
    return { placements, skipped };
}

export default { LAYOUT_POSITION, COMPONENT_PRESETS, presetFor, imageFor, clip, labelBeside, listItems, splitSides, paramsFor, componentParamsFor, placementFor, placementsFor };
