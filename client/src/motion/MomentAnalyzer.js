/**
 * client/src/motion/MomentAnalyzer.js
 *
 * R112 — PHASE 1 of the storyboard work: a time-aligned reading of what is
 * being SAID, so a graphic can be placed because of the sentence it belongs
 * to rather than on a fixed cadence.
 *
 * Until now the engine knew two things about a video: the transcript (words
 * with timestamps) and one sampled frame (palette, subject box). Nothing
 * connected "the speaker is making a claim right here" to "put a graphic
 * here". `shortPolish.spokenNumbers` was the only piece of that idea in the
 * codebase, and it looks for exactly one thing — a figure.
 *
 * This module widens that to the moment kinds a short-form edit actually
 * decorates, each with the timestamp it occupies and the evidence it carries:
 *
 *   stat      a figure, price or percentage               → a counter, a chart
 *   list      "three things", "first", "and then"         → a step card
 *   contrast  "but", "instead", "the problem is"          → a comparison
 *   claim     a strong assertion about a result            → a headline
 *   question  a question put to the viewer                 → a question card
 *   product   a named thing being shown                    → a UI/screenshot card
 *   quote     reported speech                              → a quote card
 *   cta       "follow", "link in bio", "comment"           → a CTA
 *   emphasis  a superlative with nothing more specific     → a kinetic word
 *
 * DESIGN RULES, stated because each one is a defect that would otherwise ship:
 *
 * 1. NOTHING IS INVENTED. Every moment carries the speaker's OWN words in
 *    `text`, sliced from the transcript. A module that writes copy the user
 *    never said is the failure mode SceneDirector already refuses (R95).
 * 2. A moment is a POINT with a span, not a region. `t` is where the idea
 *    lands; `end` is the end of the phrase that carries it. A graphic placed
 *    at `t` is on time BY CONSTRUCTION — which is the "animation begins before
 *    the relevant moment" defect, closed at the source.
 * 3. FRENCH AND ENGLISH, as the rest of the agent does. A French recording is
 *    Marc's own benchmark, and a rules layer that only reads English would
 *    silently return nothing for half the users.
 * 4. PURE AND IMPORT-FREE. No DOM, no network, no imports — so it loads in the
 *    Node test harness and in the concatenating caption suites alike.
 *
 * What it does NOT do: look at the picture. Shot boundaries and what is
 * visible come from `vision/ShotSampler.js`; `Storyboard.js` is what puts the
 * two together.
 */

/** A moment kind, strongest first — ties resolve toward the more specific. */
export const MOMENT_KINDS = Object.freeze([
    'stat', 'list', 'contrast', 'question', 'quote', 'product', 'cta', 'claim', 'emphasis',
]);

/** How much each kind is worth when two land in the same hold window. */
export const KIND_WEIGHT = Object.freeze({
    stat: 10, list: 8, contrast: 7, question: 6, quote: 6, product: 6, cta: 9, claim: 4, emphasis: 2,
});

/**
 * Two moments closer than this are the same beat as far as a viewer is
 * concerned; the weaker one is dropped. Below it, graphics stack and read as
 * noise however well each one is timed on its own.
 */
export const MIN_MOMENT_GAP_S = 1.8;

/** A phrase longer than this is a paragraph, not a beat to put on screen. */
export const MAX_PHRASE_WORDS = 9;

/**
 * A silence this long between two words ends the phrase. Punctuation is the
 * obvious clause boundary, but not every transcription provider returns it
 * (and none returns it reliably in French), so the pause is the signal that
 * always exists. Without it a phrase runs straight through a breath into the
 * next sentence, and the graphic quotes words the speaker had moved on from.
 */
export const PHRASE_PAUSE_S = 0.6;

/** Cues per kind, in both languages. Matched on a lowercased, deaccented word. */
const CUES = Object.freeze({
    list: [
        /^(first|firstly|second|secondly|third|thirdly|finally|lastly|next)$/,
        /^(premierement|deuxiemement|troisiemement|dabord|ensuite|enfin|puis)$/,
        /^(one|two|three|four|five)$/, /^(un|deux|trois|quatre|cinq)$/,
    ],
    contrast: [
        /^(but|however|instead|although|though|yet|whereas|unless)$/,
        /^(mais|pourtant|cependant|sauf|alors|tandis|malgre)$/,
    ],
    cta: [
        /^(follow|subscribe|comment|share|link|bio|dm|save)$/,
        /^(abonne|abonnez|suivez|commente|commentez|partage|partagez|lien)$/,
    ],
    quote: [/^(said|says|told|quote|quoted)$/, /^(dit|disait|cite|citation|repondu)$/],
    emphasis: [
        /^(best|worst|biggest|fastest|hardest|easiest|never|always|everyone|nobody|huge|insane|crazy)$/,
        /^(meilleur|meilleure|pire|plus|jamais|toujours|tout|personne|enorme|fou|dingue)$/,
    ],
    claim: [
        /^(because|result|results|means|proves|discovered|learned|realised|realized|works|worked)$/,
        /^(parce|resultat|resultats|prouve|decouvert|appris|compris|marche|fonctionne)$/,
    ],
});

/** A word that cannot end a phrase without leaving it dangling. */
const DANGLING = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with', 'that', 'is', 'was', 'my', 'your',
    'le', 'la', 'les', 'un', 'une', 'de', 'du', 'des', 'et', 'ou', 'mais', 'que', 'qui', 'a', 'au', 'aux', 'en', 'mon', 'ton',
]);

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const round = (v, p = 3) => Math.round(num(v, 0) * 10 ** p) / 10 ** p;

/** The raw string of a transcript word, whichever field it uses. */
export function wordText(w) {
    return String(w?.word ?? w?.text ?? '').trim();
}

/** Lowercased, deaccented, punctuation-free — what the cue tables match on. */
export function normalizeWord(raw) {
    return String(raw || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/[^a-z0-9%$€£]/g, '');
}

/**
 * A figure worth showing, from this word and the one after it (which may be
 * the unit: "forty percent", "ten thousand"). Returns the display text, or
 * null. Deliberately the same shape of rule as shortPolish.spokenNumbers —
 * widened to spell out numbers, which that one cannot read.
 */
export function figureAt(words, i) {
    const raw = wordText(words[i]).replace(/[.,;:!?]+$/, '');
    let next = normalizeWord(wordText(words[i + 1]));
    // French writes the unit as two words ("quarante pour cent"), so the unit
    // has to be read across the pair or every French percentage loses its
    // sign and shows as a bare number.
    const after = normalizeWord(wordText(words[i + 2]));
    if (next === 'pour' && after === 'cent') next = 'pourcent';
    const SPELLED = {
        ten: 10, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
        hundred: 100, thousand: 1000, million: 1000000,
        dix: 10, vingt: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60, cent: 100, mille: 1000,
    };
    let text = null;
    if (/^[$€£]?\d[\d\s,.]*\s*(?:k|m|%|€|\$)?$/i.test(raw)) {
        const n = Number(raw.replace(/[^\d.]/g, ''));
        // A bare small number is a count ("two things"), not a figure to show,
        // unless a unit follows it.
        const unitFollows = /^(percent|pourcent|pour ?cent|dollars?|euros?|k|thousand|mille|million|times|fois|x)$/.test(next);
        if (!Number.isFinite(n)) return null;
        if (n < 10 && !/[%$€£]/.test(raw) && !unitFollows) return null;
        text = raw;
    } else {
        const spelled = SPELLED[normalizeWord(raw)];
        if (!spelled || spelled < 10) return null;
        text = String(spelled);
    }
    if (/^(percent|pourcent|pour ?cent)$/.test(next)) text += '%';
    else if (/^dollars?$/.test(next)) text = `$${text.replace(/^[$€£]/, '')}`;
    else if (/^euros?$/.test(next)) text = `${text.replace(/[€]$/, '')}€`;
    else if (/^(thousand|mille|k)$/.test(next)) text = `${text}K`;
    else if (/^million$/.test(next)) text = `${text}M`;
    return text;
}

/** Does any cue table for `kind` match this normalized word? */
export function cueMatches(kind, normalized) {
    const list = CUES[kind];
    if (!list || !normalized) return false;
    for (const re of list) if (re.test(normalized)) return true;
    return false;
}

/**
 * The phrase carrying the moment at word index `i`: up to `maxWords` words
 * from `i`, stopping at a sentence end, and never ending on a dangling
 * connector. Returns `{ text, end, lastIndex }`, or null when nothing usable.
 */
export function phraseAt(words, i, maxWords = MAX_PHRASE_WORDS) {
    const picked = [];
    let last = i;
    for (let k = i; k < words.length && picked.length < maxWords; k++) {
        const raw = wordText(words[k]);
        if (!raw) continue;
        // A pause BEFORE this word ends the phrase at the previous one.
        if (k > i) {
            const gap = num(words[k]?.start, 0) - num(words[k - 1]?.end, 0);
            if (gap >= PHRASE_PAUSE_S) break;
        }
        picked.push(raw);
        last = k;
        if (/[.!?]$/.test(raw) && picked.length >= 3) break;
    }
    while (picked.length > 2 && DANGLING.has(normalizeWord(picked[picked.length - 1]))) {
        picked.pop();
        last -= 1;
    }
    if (picked.length === 0) return null;
    const end = num(words[last]?.end, num(words[last]?.start, 0));
    return { text: picked.join(' ').replace(/\s+/g, ' ').trim(), end: round(end), lastIndex: last };
}

/**
 * The phrase ENDING at word `end`: walk backwards to the start of the clause,
 * then take it forward.
 *
 * Round B found this the hard way. The first version simply called
 * `phraseAt(words, end - maxWords + 1, …)`, which starts somewhere in the
 * PREVIOUS sentence and then breaks forward at the first pause — the sentence
 * boundary — so it returned the tail of the sentence before and never reached
 * the word it was supposed to end on. A stat card for "published 200 videos"
 * came out labelled "nearly killed my channel". Walking backwards and
 * stopping at the boundary is the only version of this that is correct.
 */
export function phraseEndingAt(words, end, maxWords = MAX_PHRASE_WORDS) {
    if (end < 0 || end >= words.length) return null;
    let start = end;
    for (let k = end; k > 0 && end - k < maxWords - 1; k--) {
        const prevRaw = wordText(words[k - 1]);
        // A sentence that ended, or a silence, is where this clause began.
        if (/[.!?]$/.test(prevRaw)) break;
        const gap = num(words[k]?.start, 0) - num(words[k - 1]?.end, 0);
        if (gap >= PHRASE_PAUSE_S) break;
        start = k - 1;
    }
    const picked = [];
    for (let k = start; k <= end; k++) {
        const raw = wordText(words[k]);
        if (raw) picked.push(raw);
    }
    // Only a LEADING connector is dropped here: the phrase's last word is the
    // one it was built to end on and is never trimmed away.
    while (picked.length > 2 && DANGLING.has(normalizeWord(picked[0]))) picked.shift();
    if (picked.length === 0) return null;
    const endT = num(words[end]?.end, num(words[end]?.start, 0));
    return { text: picked.join(' ').replace(/\s+/g, ' ').trim(), end: round(endT), lastIndex: end };
}

/** A product-ish name: a capitalised run that is not the first word of a sentence. */
function productAt(words, i) {
    const raw = wordText(words[i]);
    if (!/^[A-Z][A-Za-z0-9]*$/.test(raw) || raw.length < 3) return null;
    const prev = wordText(words[i - 1]);
    // Sentence-initial capitals are grammar, not a name.
    if (i === 0 || /[.!?]$/.test(prev)) return null;
    const parts = [raw];
    if (/^[A-Z][A-Za-z0-9]*$/.test(wordText(words[i + 1]) || '')) parts.push(wordText(words[i + 1]));
    return parts.join(' ');
}

/**
 * Every moment in a transcript, in time order, strongest kept where two
 * collide.
 *
 * @param {Array<{word?:string,text?:string,start:number,end:number}>} words
 * @param {{ minGap?:number, max?:number, from?:number, to?:number }} [opts]
 * @returns {Array<{t:number,end:number,kind:string,text:string,evidence:string|null,weight:number}>}
 */
export function findMoments(words, opts = {}) {
    const list = Array.isArray(words) ? words : [];
    const minGap = num(opts.minGap, MIN_MOMENT_GAP_S);
    const from = num(opts.from, -Infinity);
    const to = num(opts.to, Infinity);
    const found = [];

    for (let i = 0; i < list.length; i++) {
        const w = list[i];
        const t = num(w?.start, NaN);
        if (!Number.isFinite(t) || t < from || t > to) continue;
        const raw = wordText(w);
        if (!raw) continue;
        const n = normalizeWord(raw);

        // A cue only counts where its clause BEGINS. "First I cut every
        // pause" enumerates; "all three in one pass" does not, and matching
        // the bare numeral anywhere turned every passing "three" and "one"
        // into a list beat.
        const prevRaw = wordText(list[i - 1]);
        const opensClause = i === 0
            || /[.!?,;:]$/.test(prevRaw)
            || num(w?.start, 0) - num(list[i - 1]?.end, 0) >= PHRASE_PAUSE_S;

        let kind = null;
        let evidence = null;

        const figure = figureAt(list, i);
        if (figure) { kind = 'stat'; evidence = figure; }
        else if (/\?$/.test(raw)) { kind = 'question'; }
        else {
            for (const k of ['cta', 'list', 'contrast', 'quote', 'emphasis', 'claim']) {
                if (!cueMatches(k, n)) continue;
                // `list` and `contrast` are STRUCTURAL cues: they mean
                // something only at the head of their clause.
                if ((k === 'list' || k === 'contrast') && !opensClause) continue;
                kind = k;
                break;
            }
            if (!kind) {
                const product = productAt(list, i);
                if (product) { kind = 'product'; evidence = product; }
            }
        }
        if (!kind) continue;

        // Where the phrase STARTS depends on where the cue sits in it.
        //
        //   question  the mark ends the sentence, so read backwards to it.
        //   stat      the figure is the payoff of its clause ("my revenue
        //             grew by forty percent"), so the context is BEFORE it.
        //             Reading forward gave "forty percent." and nothing else,
        //             which left a stat card with a figure and no label.
        //   the rest  the cue opens the phrase ("but ...", "first ...").
        let phrase;
        if (kind === 'question') {
            phrase = phraseEndingAt(list, i);
        } else if (kind === 'stat') {
            // Through the figure and its unit word ("forty percent"), back to
            // the start of the clause the figure belongs to.
            const unit = normalizeWord(wordText(list[i + 1]));
            const through = /^(percent|pourcent|pour|dollars?|euros?|k|thousand|mille|million|times|fois|x)$/.test(unit) ? i + 1 : i;
            phrase = phraseEndingAt(list, Math.min(through, list.length - 1));
        } else {
            phrase = phraseAt(list, i);
        }
        if (!phrase) continue;

        found.push({
            t: round(t),
            end: round(Math.max(phrase.end, t + 0.4)),
            kind,
            text: phrase.text,
            evidence,
            weight: KIND_WEIGHT[kind] || 1,
        });
    }

    return capMoments(found, { minGap, max: opts.max });
}

/**
 * Drop moments that crowd a stronger neighbour, then cap the count.
 * Exported on its own because the storyboard re-runs it after merging in
 * moments that came from somewhere else (timeline events, an AI plan).
 */
export function capMoments(moments, { minGap = MIN_MOMENT_GAP_S, max } = {}) {
    const sorted = [...(moments || [])]
        .filter(m => Number.isFinite(num(m?.t, NaN)))
        .sort((a, b) => a.t - b.t || (b.weight || 0) - (a.weight || 0));

    const kept = [];
    for (const m of sorted) {
        const prev = kept[kept.length - 1];
        if (prev && m.t - prev.t < minGap) {
            // Same beat: the stronger kind wins, and a tie keeps the earlier
            // one (it is already on time for its sentence).
            if ((m.weight || 0) > (prev.weight || 0)) kept[kept.length - 1] = m;
            continue;
        }
        kept.push(m);
    }
    if (!Number.isFinite(num(max, NaN))) return kept;
    // Trimming by weight, not by truncation: the last third of a video should
    // not lose every graphic because the first third was busy.
    return [...kept].sort((a, b) => (b.weight || 0) - (a.weight || 0) || a.t - b.t)
        .slice(0, Math.max(0, max | 0))
        .sort((a, b) => a.t - b.t);
}

export default {
    MOMENT_KINDS, KIND_WEIGHT, MIN_MOMENT_GAP_S, MAX_PHRASE_WORDS, PHRASE_PAUSE_S,
    wordText, normalizeWord, figureAt, cueMatches, phraseAt, phraseEndingAt, findMoments, capMoments,
};
