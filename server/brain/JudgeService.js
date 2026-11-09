/**
 * server/brain/JudgeService.js
 *
 * The arbitration layer: a small, fast model scores candidates the
 * deterministic policy already produced.
 *
 * WHY A SEPARATE, CHEAP MODEL
 * ---------------------------
 * EditPolicy ranks by declared facts — eligibility, what is already done,
 * what a style sets aside, what a step unlocks. That is the right basis for
 * ordering, and it is pure and testable. What it cannot weigh is whether a
 * candidate actually serves THIS video: whether the hook finding is real,
 * whether a cut helps the through-line, whether now is the moment.
 *
 * The Editorial Brain can weigh that, but it is one large call per turn, so
 * it cannot be asked about every candidate. A judge is the opposite shape:
 * a handful of tokens per candidate, a bounded rubric, numbers out. That is
 * what makes it affordable to run on every candidate on every turn.
 *
 * THE RULES THIS SERVICE ENFORCES
 * ------------------------------
 *  1. It FAILS CLOSED. No configured judge, a malformed reply, a timeout, a
 *     rate limit — every one returns null and the caller keeps its own
 *     deterministic ranking. A judge is an improvement on the ordering, never
 *     a dependency of it.
 *  2. It cannot INVENT a candidate. Every id in the reply is checked against
 *     the ids that went in; anything else is dropped. A ranking layer that
 *     could add an action would be a planner, and an unvalidated one.
 *  3. It cannot make a blocked candidate runnable. Eligibility is a fact
 *     about project state, not a judgement, so `blocked` candidates are never
 *     sent and a verdict about one is ignored.
 *  4. Scores are clamped to the rubric's range, so one bad number cannot
 *     dominate the blend.
 *
 * R157 wired this in: POST /api/brain/analyze judges the suggestions it is
 * about to return and sends the verdicts with them.
 *
 * R159 split the loop that enforces those four rules out of `judgeCandidates`
 * into `scoreWithRubric`, so a second rubric — ShortJudge, which scores
 * transcript passages rather than edit suggestions — gets the same rules
 * rather than its own partial copy of them.
 */

'use strict';

const { getAIFor, isAIConfigured } = require('../../services/AIProvider');
// The judge scores against editorial craft, not four generic axes. The
// knowledge library turns measured project state into named situations with a
// craft note each, so "is this the right call" has something concrete behind
// it. Without this the rubric is just four adjectives.
const { craftNotes, detectSituations } = require('../knowledge/editorialKnowledge');

/** The rubric. Four axes, 0–5 each, so a verdict is cheap to produce and read. */
const RUBRIC = Object.freeze([
    { key: 'serves_through_line', text: 'Does this serve what the video is actually about?' },
    { key: 'right_for_style',     text: 'Is this right for the chosen editing style?' },
    { key: 'evidence_is_real',    text: 'Is the finding behind it real, or guessed?' },
    { key: 'right_moment',        text: 'Is now the moment for it, rather than later?' },
]);

const SCORE_MIN = 0;
const SCORE_MAX = 5;

/** Never send the model more than this many candidates in one call. */
const MAX_CANDIDATES = 12;

/**
 * The reply schema for a rubric, BUILT from the rubric rather than written out
 * beside it.
 *
 * Written out, a new rubric ships with a schema that can quietly forget one of
 * its axes. The model is then free to omit that axis, and `clamp(undefined)`
 * reads as 0 — the harshest possible score — on an axis nobody ever asked
 * about. Deriving it means the schema cannot disagree with the rubric.
 */
function schemaFor(name, rubric) {
    const props = { id: { type: 'string' } };
    for (const r of rubric) props[r.key] = { type: 'number' };
    props.why = { type: 'string' };
    return {
        type: 'json_schema',
        json_schema: {
            name,
            strict: true,
            schema: {
                type: 'object',
                properties: {
                    verdicts: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: props,
                            required: Object.keys(props),
                            additionalProperties: false,
                        },
                    },
                },
                required: ['verdicts'],
                additionalProperties: false,
            },
        },
    };
}

const JUDGE_SCHEMA = schemaFor('judge_verdicts', RUBRIC);

/** True when a judge can actually be called. */
function isJudgeConfigured() {
    try {
        if (!isAIConfigured()) return false;
        const { client } = getAIFor('judge', 'gpt-4o-mini');
        return !!client;
    } catch {
        return false;
    }
}

const clamp = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return SCORE_MIN;
    return Math.min(SCORE_MAX, Math.max(SCORE_MIN, v));
};

/**
 * Build the prompt. Deliberately short: the judge's job is to apply a rubric
 * to candidates someone else generated, not to reason about the whole project.
 *
 * @param {Object[]} candidates
 * @param {Object} context
 * @returns {string}
 */
function buildJudgePrompt(candidates, context = {}) {
    const c = context || {};
    const lines = [
        'You are scoring edit suggestions a planner already produced for one video.',
        'You do NOT choose actions and you do NOT add any. Score only what is listed.',
        '',
        'THE VIDEO',
        `  Style chosen by the user: ${c.styleId || '(none)'}`,
        `  Platform: ${c.platform || '(none)'}`,
        `  What it is about: ${c.throughLine || '(not established — treat through-line scores as 2)'}`,
        `  Length: ${c.duration || 0}s across ${c.clipCount || 0} clip(s)`,
        `  Already applied: ${(c.editsDone || []).join(', ') || 'nothing yet'}`,
    ];

    if (Array.isArray(c.findings) && c.findings.length > 0) {
        lines.push('  Findings about this cut:');
        for (const f of c.findings.slice(0, 6)) {
            lines.push(`    - ${String(f).slice(0, 160)}`);
        }
    }

    // Craft notes for the situations this project is measurably in. Derived
    // here rather than passed in, so every judge call gets them without the
    // call site having to remember.
    let notes = Array.isArray(c.craftNotes) ? c.craftNotes : null;
    if (!notes && c.facts) {
        try { notes = craftNotes(c.facts, { styleId: c.styleId || null }); }
        catch { notes = null; }
    }
    if (notes && notes.length > 0) {
        lines.push(
            '',
            'WHAT THIS EDIT NEEDS (measured from the project, worst first):',
            ...notes.map(n => `  - ${String(n).slice(0, 320)}`),
            '  Score a candidate highly when it addresses one of these, and low when it',
            '  does not — however reasonable it sounds in the abstract.',
        );
    }

    lines.push(
        '',
        'RUBRIC — score each candidate 0 to 5 on every axis:',
        ...RUBRIC.map(r => `  ${r.key}: ${r.text}`),
        '  A 0 means actively wrong here. A 5 means clearly the right call.',
        '  If you have no basis for an axis, score it 2. Do not guess high.',
        '',
        'CANDIDATES',
        ...candidates.map(x => `  ${x.id} — ${x.summary || x.label || x.id}`
            + (x.reasons && x.reasons.length ? ` [planner said: ${x.reasons.join(' ')}]` : '')),
        '',
        'Return a verdict for EVERY candidate id above, and no other id.',
    );

    return lines.join('\n');
}

/**
 * Score candidates. Returns a map of id → verdict, or null.
 *
 * null is not an error the caller has to handle specially: it means "no
 * judgement available", and the deterministic ranking stands.
 *
 * @param {Object}   opts
 * @param {Object[]} opts.candidates  [{ id, summary, reasons, blocked }]
 * @param {Object}   [opts.context]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<Object|null>}
 */
/**
 * Call the judge and turn its reply into verdicts, or null.
 *
 * This is the ONE implementation of rules 1-4 in the header, and it is
 * deliberately rubric-agnostic: the rules are the valuable part, not the four
 * axes. A second rubric that re-implemented this loop would eventually
 * re-implement it with one rule missing, and the missing one would stay
 * invisible until a model said something strange on a real project.
 *
 * @param {Object} opts
 * @param {Object[]} opts.rubric   axes to clamp and total
 * @param {Object} opts.schema     the matching response_format
 * @param {string} opts.prompt     the user message
 * @param {Iterable<string>} opts.ids  the ONLY ids a verdict may name
 * @returns {Promise<Object|null>} id -> verdict, or null for "no judgement"
 */
async function scoreWithRubric({
    rubric, schema, prompt, ids,
    signal = null,
    maxTokens = 900,
    system = 'You score edit suggestions against a rubric. Return only JSON.',
    tag = 'JudgeService',
} = {}) {
    const allowed = ids instanceof Set ? ids : new Set(ids || []);
    if (allowed.size === 0) return null;

    let client, model;
    try {
        ({ client, model } = getAIFor('judge', 'gpt-4o-mini'));
    } catch (err) {
        console.warn(`[${tag}] no judge client:`, err.message);
        return null;
    }
    if (!client) return null;

    try {
        const reply = await client.chat.completions.create({
            model,
            // Judgement, not invention: near-deterministic.
            temperature: 0.1,
            max_tokens: maxTokens,
            response_format: schema,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: prompt },
            ],
        }, signal ? { signal } : undefined);

        const raw = reply?.choices?.[0]?.message?.content;
        if (!raw) return null;

        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (err) {
            console.warn(`[${tag}] unparseable verdict JSON:`, err.message);
            return null;
        }

        const verdicts = Array.isArray(parsed?.verdicts) ? parsed.verdicts : [];
        if (verdicts.length === 0) return null;

        const out = {};
        for (const v of verdicts) {
            const id = typeof v?.id === 'string' ? v.id : null;
            // Rule 2: a judge cannot introduce a candidate.
            if (!id || !allowed.has(id) || out[id]) continue;
            const axes = {};
            for (const r of rubric) axes[r.key] = clamp(v[r.key]);
            const total = rubric.reduce((sum, r) => sum + axes[r.key], 0);
            out[id] = {
                id,
                ...axes,
                // Normalised 0..1 so the blend does not depend on axis count.
                confidence: total / (rubric.length * SCORE_MAX),
                why: typeof v.why === 'string' ? v.why.slice(0, 240) : '',
            };
        }

        return Object.keys(out).length > 0 ? out : null;
    } catch (err) {
        // Rate limit, timeout, abort, provider outage - all the same answer.
        console.warn(`[${tag}] judging failed, keeping the deterministic ranking:`, err.message);
        return null;
    }
}

/**
 * Score candidates. Returns a map of id -> verdict, or null.
 *
 * null is not an error the caller has to handle specially: it means "no
 * judgement available", and the deterministic ranking stands.
 *
 * @param {Object}   opts
 * @param {Object[]} opts.candidates  [{ id, summary, reasons, blocked }]
 * @param {Object}   [opts.context]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<Object|null>}
 */
async function judgeCandidates({ candidates = [], context = {}, signal = null } = {}) {
    // Eligibility is a fact, not a judgement: a blocked candidate is never
    // sent, so a verdict can never argue one into the plan.
    const runnable = (Array.isArray(candidates) ? candidates : [])
        .filter(x => x && x.id && !x.blocked)
        .slice(0, MAX_CANDIDATES);

    if (runnable.length === 0) return null;

    return scoreWithRubric({
        rubric: RUBRIC,
        schema: JUDGE_SCHEMA,
        prompt: buildJudgePrompt(runnable, context),
        ids: runnable.map(x => x.id),
        signal,
    });
}

module.exports = {
    RUBRIC,
    clamp,
    schemaFor,
    scoreWithRubric,
    detectSituations,
    SCORE_MIN,
    SCORE_MAX,
    MAX_CANDIDATES,
    JUDGE_SCHEMA,
    isJudgeConfigured,
    buildJudgePrompt,
    judgeCandidates,
};
