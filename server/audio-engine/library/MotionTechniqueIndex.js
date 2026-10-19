'use strict';

/**
 * server/audio-engine/library/MotionTechniqueIndex.js
 *
 * R103 — retrieval over the Motion Design Knowledge Base.
 *
 * Deterministic, dependency-free, pure. Given a brief (and optionally the
 * tone, platform, beat kind, timeline event or energy already decided), it
 * ranks `starterMotionLibrary.js`'s techniques and hands back a shortlist.
 *
 * WHY NOT THE EXISTING ASSET SEARCH ENGINE
 * ----------------------------------------
 * `server/audio-engine/search/AssetSearchEngine.js` is the three-pass
 * (embeddings → taxonomy → keyword) search that already serves SFX and LUTs,
 * and `AssetType.ANIMATION` is already declared in `types.js` — so the
 * long-run home for these rows is that table and that engine. It is not the
 * home yet for one concrete reason: every row here carries executable motion
 * (`{enter, emphasis, exit, energy}`, plus component/preset/stagger) and the
 * `assets` table has no column or child table to hold it. SFX put their
 * specifics in `sound_effects`, LUTs in `luts`, presets in `presets`;
 * animations would need the same, which is a migration against the live
 * database.
 *
 * So this file is the deliberate near-term half: the SAME taxonomy fields the
 * DB rows use, scored locally, with no migration and no network. When the
 * `animations` child table lands, `findTechniques` becomes a thin wrapper over
 * the real engine and callers do not change — which is why the return shape
 * here is already row-plus-score rather than anything local-specific.
 *
 * Scoring is weighted keyword overlap plus exact matches on the structured
 * fields, with ties broken by name so the output is stable. Stable output is
 * not cosmetic: the scene-plan prompt is built from this list, and a prompt
 * that reshuffles between identical requests makes model behaviour
 * unreproducible and the tests meaningless.
 */

const { MOTION_TECHNIQUES } = require('./starterMotionLibrary.js');

/** Lowercase, strip accents, split on anything that is not a letter or digit. */
function tokenize(value) {
    return String(value == null ? '' : value)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
}

// Words that carry no retrieval signal. Bilingual, like the DISCOURSE/STOP
// sets in services/retakeDetector.js — a French brief is a first-class input
// in this app, not an edge case.
const STOP = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'from', 'by',
    'is', 'are', 'was', 'be', 'it', 'this', 'that', 'these', 'those', 'as', 'into', 'then', 'than',
    'make', 'makes', 'making', 'want', 'wants', 'need', 'needs', 'should', 'would', 'could', 'like',
    'video', 'clip', 'text', 'something', 'thing', 'please', 'some', 'any', 'more', 'very', 'really',
    'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'ou', 'mais', 'dans', 'sur', 'pour',
    'avec', 'est', 'sont', 'ce', 'cette', 'ces', 'qui', 'que', 'au', 'aux', 'en', 'il', 'elle',
    'faire', 'fais', 'veux', 'avoir', 'plus', 'tres', 'vraiment', 'video', 'texte', 'truc',
]);

/**
 * French → English token folding, applied after accent stripping. Keeps the
 * library's `searchKeywords` in one language instead of doubling every row,
 * and means "mets un gros chiffre percutant" reaches the same techniques as
 * "add a big punchy number".
 */
const SYNONYMS = {
    // French
    accroche: 'hook', titre: 'title', chiffre: 'number', chiffres: 'number', nombre: 'number',
    prix: 'price', pourcentage: 'percent', citation: 'quote', mot: 'word', mots: 'word',
    cle: 'key', debut: 'intro', fin: 'close', ouverture: 'opening', revelation: 'reveal',
    percutant: 'punchy', punchy: 'punchy', elegant: 'elegant', sobre: 'minimal', doux: 'soft',
    rapide: 'fast', lent: 'slow', fort: 'impact', calme: 'calm', dynamique: 'energetic',
    serieux: 'serious', drole: 'funny', luxe: 'luxury', marque: 'brand', liste: 'list',
    etapes: 'steps', raisons: 'reasons', avantages: 'benefits', abonne: 'follow',
    abonnez: 'follow', suivez: 'follow', flou: 'blur', secousse: 'shake', rebond: 'bounce',
    // English shorthand people actually type
    cta: 'cta', stat: 'stat', stats: 'stat', num: 'number', nums: 'number', pct: 'percent',
    subscribe: 'follow', sub: 'follow', bold: 'impact', loud: 'impact', soft: 'soft',
};

function foldToken(token) {
    // A spoken figure is the single strongest signal that a stat beat is
    // coming — "40000", "15", "184" — but a digit string matches no keyword in
    // any library row, so without this a transcript entirely about a number
    // retrieved no stat technique at all (observed on a real brief: the
    // shortlist came back all hook and cta). Currency symbols and percent
    // signs are already stripped by tokenize, so the digits are what is left
    // to read.
    if (/^\d+$/.test(token)) return 'number';
    return SYNONYMS[token] || token;
}

/** Query tokens: normalised, stopped, folded, de-duplicated. */
function queryTokens(text) {
    const out = [];
    for (const raw of tokenize(text)) {
        if (STOP.has(raw)) continue;
        const token = foldToken(raw);
        if (!out.includes(token)) out.push(token);
    }
    return out;
}

/**
 * Per-row token bags, weighted by how much a hit in that field means. Built
 * once at module load — the library is static, so rebuilding per request would
 * be pure waste on a route that already pays for an LLM call.
 */
const FIELD_WEIGHTS = { keyword: 6, name: 5, facet: 4, prose: 2, note: 1 };

const INDEX = MOTION_TECHNIQUES.map((technique) => {
    const bag = new Map(); // token → best weight seen for this row
    const add = (value, weight) => {
        for (const raw of tokenize(value)) {
            if (STOP.has(raw)) continue;
            const token = foldToken(raw);
            if ((bag.get(token) || 0) < weight) bag.set(token, weight);
        }
    };
    for (const k of technique.searchKeywords || []) add(k, FIELD_WEIGHTS.keyword);
    add(technique.name, FIELD_WEIGHTS.name);
    add(technique.displayName, FIELD_WEIGHTS.name);
    for (const s of technique.style || []) add(s, FIELD_WEIGHTS.facet);
    add(technique.category, FIELD_WEIGHTS.facet);
    add(technique.subCategory, FIELD_WEIGHTS.facet);
    add(technique.mood, FIELD_WEIGHTS.facet);
    add(technique.description, FIELD_WEIGHTS.prose);
    for (const u of technique.bestUseCases || []) add(u, FIELD_WEIGHTS.prose);
    add(technique.note, FIELD_WEIGHTS.note);
    return { technique, bag };
});

const BY_NAME = new Map(INDEX.map((e) => [e.technique.name, e.technique]));

/** energyLevel is 1-5; a motion `energy` is 0-1. Compare on the 0-1 scale. */
function energyDistance(technique, wanted) {
    if (!Number.isFinite(wanted)) return null;
    const asked = wanted > 1 ? (wanted - 1) / 4 : wanted;
    return Math.abs(technique.motion.energy - Math.min(1, Math.max(0, asked)));
}

/**
 * Rank techniques for a request.
 *
 * @param {string} query free text — a brief, a command, a few words
 * @param {{tone?:string, platform?:string, beatKind?:string, eventType?:string,
 *          intents?:string[], emotions?:string[], energy?:number, limit?:number}} [opts]
 * @returns {Array<{technique:object, score:number, reasons:string[]}>}
 */
function findTechniques(query, opts = {}) {
    const safeOpts = opts && typeof opts === 'object' ? opts : {};
    const tokens = queryTokens(query);
    const platformTokens = queryTokens(safeOpts.platform);
    const limit = Number.isFinite(Number(safeOpts.limit)) ? Math.max(1, Math.min(24, Number(safeOpts.limit))) : 6;
    const intents = Array.isArray(safeOpts.intents) ? safeOpts.intents : [];
    const emotions = Array.isArray(safeOpts.emotions) ? safeOpts.emotions : [];

    const ranked = [];
    for (const { technique, bag } of INDEX) {
        let score = 0;
        const reasons = [];

        // An exact technique name in the text is an instruction, not a hint.
        if (tokens.length > 0 && String(query || '').toLowerCase().includes(technique.name)) {
            score += 100;
            reasons.push('named directly');
        }

        let keywordScore = 0;
        for (const token of tokens) keywordScore += bag.get(token) || 0;
        for (const token of platformTokens) keywordScore += (bag.get(token) || 0);
        if (keywordScore > 0) {
            score += keywordScore;
            reasons.push('wording');
        }

        if (safeOpts.tone && (technique.tones || []).includes(safeOpts.tone)) {
            score += 8;
            reasons.push('tone ' + safeOpts.tone);
        }
        if (safeOpts.beatKind && (technique.beatKinds || []).includes(safeOpts.beatKind)) {
            score += 8;
            reasons.push('fits a ' + safeOpts.beatKind + ' beat');
        }
        if (safeOpts.eventType && (technique.compatibleTimelineEvents || []).includes(safeOpts.eventType)) {
            score += 6;
            reasons.push('matches ' + safeOpts.eventType);
        }
        for (const intent of intents) {
            if ((technique.editingIntents || []).includes(intent)) { score += 4; reasons.push('intent ' + intent); }
        }
        for (const emotion of emotions) {
            if ((technique.emotionTags || []).includes(emotion)) { score += 3; reasons.push('emotion ' + emotion); }
        }
        const distance = energyDistance(technique, Number(safeOpts.energy));
        if (distance !== null) {
            score += Math.round((1 - distance) * 5);
            reasons.push('energy');
        }

        if (score > 0) ranked.push({ technique, score, reasons });
    }

    // Deterministic: score desc, then name asc. Never rely on array order.
    ranked.sort((a, b) => (b.score - a.score) || a.technique.name.localeCompare(b.technique.name));
    return ranked.slice(0, limit);
}

/**
 * A shortlist for a whole scene plan, rather than for one beat.
 *
 * `findTechniques` answers "what suits THIS request", which is the right
 * question for one beat and the wrong one for a plan: the model has not
 * decided its beats yet, so a purely score-ranked shortlist can leave it with
 * no stat technique to give the stat beat it is about to invent. That is not
 * hypothetical — a brief whose transcript was entirely about a figure came
 * back with a shortlist of five hook and cta techniques, because the generic
 * Pro Finish brief wording outscored everything the transcript implied.
 *
 * So: guarantee one slot per beat kind first, then fill the rest by score.
 * A kind that nothing scores for still gets the library's own best default
 * for it (score 0, so it sits last in the prompt) — the model should always
 * be choosing from a complete palette, never from a gap.
 *
 * @param {string} query
 * @param {{limit?:number, coverBeatKinds?:string[]}} [opts] — plus anything
 *        `findTechniques` accepts (tone, platform, intents, emotions, energy)
 * @returns {Array<{technique:object, score:number, reasons:string[]}>}
 */
function shortlistForPlan(query, opts = {}) {
    const safeOpts = opts && typeof opts === 'object' ? opts : {};
    const limit = Number.isFinite(Number(safeOpts.limit)) ? Math.max(1, Math.min(24, Number(safeOpts.limit))) : 8;
    const coverKinds = Array.isArray(safeOpts.coverBeatKinds) && safeOpts.coverBeatKinds.length > 0
        ? safeOpts.coverBeatKinds
        : ['intro', 'point', 'stat', 'cta'];

    const picked = [];
    const seen = new Set();
    const take = (entry) => {
        if (!entry || seen.has(entry.technique.name)) return;
        seen.add(entry.technique.name);
        picked.push(entry);
    };

    for (const kind of coverKinds) {
        // `beatKind` is a scoring BONUS inside findTechniques, not a filter —
        // so the top hit for a kind is frequently a row that cannot serve that
        // kind at all, and taking it blindly left the gap this function exists
        // to close. Walk the ranking and take the best row that genuinely
        // covers the kind.
        const scored = findTechniques(query, { ...safeOpts, beatKind: kind, limit: 24 })
            .find(entry => (entry.technique.beatKinds || []).includes(kind));
        if (scored) { take(scored); continue; }
        // Nothing scored for this kind. Fall back to the library itself, by
        // name so the choice is stable, preferring the asked-for tone.
        const candidates = MOTION_TECHNIQUES
            .filter(t => (t.beatKinds || []).includes(kind))
            .filter(t => !safeOpts.tone || (t.tones || []).includes(safeOpts.tone));
        const pool = candidates.length > 0
            ? candidates
            : MOTION_TECHNIQUES.filter(t => (t.beatKinds || []).includes(kind));
        const fallback = pool.slice().sort((a, b) => a.name.localeCompare(b.name))[0];
        if (fallback) take({ technique: fallback, score: 0, reasons: ['covers the ' + kind + ' beat'] });
    }

    for (const entry of findTechniques(query, { ...safeOpts, beatKind: safeOpts.beatKind, limit: 24 })) {
        if (picked.length >= limit) break;
        take(entry);
    }

    return picked
        .slice(0, limit)
        .sort((a, b) => (b.score - a.score) || a.technique.name.localeCompare(b.technique.name));
}

/** One technique by its slug, or null. */
function techniqueByName(name) {
    if (!name || typeof name !== 'string') return null;
    return BY_NAME.get(name) || null;
}

/**
 * The executable motion for a technique, as a fresh object so a caller
 * mutating what it got cannot corrupt the library for the rest of the
 * process. Returns null for an unknown name — the caller then leaves the
 * beat's motion unset and the look's own motion stands.
 */
function motionForTechnique(name) {
    const technique = techniqueByName(name);
    if (!technique) return null;
    const { enter, emphasis, exit, energy, anticipate } = technique.motion;
    // R103 round F — anticipation is a property of LOUD motion, and the same
    // rule the looks use applies here rather than a flag on all 34 rows: a
    // wind-up before a punch or a whip-out gives the move weight, while the
    // same gesture on a restrained technique reads as a stutter. A technique
    // that states the flag itself always wins.
    return {
        enter, emphasis, exit, energy,
        anticipate: typeof anticipate === 'boolean' ? anticipate : (Number(energy) || 0) >= 0.7,
    };
}

/**
 * Compact prompt lines for a shortlist: id, what it is, when to use it, and
 * the verbs, so the model picks a technique for a stated reason instead of
 * inventing verb names. Deliberately terse — this goes into every scene-plan
 * call and the craft `note` is the only part worth the tokens.
 */
function promptLines(list) {
    const rows = Array.isArray(list) ? list : [];
    return rows.map(({ technique }) => {
        const m = technique.motion;
        const verbs = [m.enter, m.emphasis || null, m.exit || null].filter(Boolean).join(' / ');
        const beats = (technique.beatKinds || []).join('|');
        return `- ${technique.name} (${beats}, energy ${m.energy}, ${verbs}): ${technique.displayName} — ${technique.note}`;
    });
}

function allTechniques() {
    return MOTION_TECHNIQUES.slice();
}

module.exports = {
    findTechniques,
    shortlistForPlan,
    techniqueByName,
    motionForTechnique,
    promptLines,
    allTechniques,
    // exported for tests
    queryTokens,
};
