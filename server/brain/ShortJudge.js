/**
 * server/brain/ShortJudge.js
 *
 * The judge, pointed at the one decision in the app it can most improve:
 * WHICH PASSAGE of a long video becomes a short.
 *
 * WHY HERE
 * --------
 * R158's evaluation of shorts generation found the pick is an argmax over a
 * deterministic heuristic: detected moments, speech density, a 20-phrase
 * hook-opener regex, and closeness to a target length. That is good at
 * producing a well-formed short — sentence-aligned, correctly sized,
 * platform-legal — and blind to whether the passage is actually worth
 * posting. It cannot tell that a passage needs the five minutes before it to
 * make sense, that it stops mid-thought instead of landing, or that it is a
 * tangent rather than the point of the video. Those are exactly the
 * judgements a cheap model can make from a few hundred characters.
 *
 * So: the heuristic proposes, the judge arbitrates. Same shape as R156/R157's
 * suggestion arbitration, and the same four rules, which is why this module
 * borrows the call loop from JudgeService rather than writing its own:
 *
 *   1. It FAILS CLOSED. No judge configured, malformed reply, rate limit,
 *      timeout -> null, and the picker keeps today's argmax exactly.
 *   2. It cannot INVENT a passage. Every id is checked against the ids that
 *      went in. A ranking layer that could propose a window would be a
 *      picker, and an unvalidated one.
 *   3. It cannot ADMIT a passage the heuristic refused. Enforced on the
 *      client side (shortPicker applies its quality floor to the base score
 *      as well as the blended one), so a verdict can veto a weak pick but
 *      never promote one.
 *   4. Scores are clamped to the rubric's range.
 *
 * WHAT IT IS NOT GIVEN
 * --------------------
 * No project map, no story map, no media intelligence. Those are GPT-4o
 * derivations and this call sits in front of a button the user already
 * pressed; a judge that is not cheap is not a judge. It gets the passage's
 * own opening and closing words, its length, and a couple of lines about the
 * video. Everything else it is told to score 2.
 */

'use strict';

const { schemaFor, scoreWithRubric } = require('./JudgeService');

/**
 * The rubric. Four axes again, but NOT the four from JudgeService — those ask
 * whether an edit serves the cut. These ask what makes a passage survive on
 * its own in a feed, which is a different question with different failure
 * modes:
 *
 *   self_contained — the commonest way a heuristic pick fails. A passage can
 *                    be the densest, best-hooked minute in the video and still
 *                    be unpostable because it answers a question asked four
 *                    minutes earlier.
 *   opens_strong   — what HOOK_OPENERS is a 20-phrase approximation of. A
 *                    model reads the actual sentence.
 *   has_payoff     — nothing in the heuristic looks at how a window ENDS. A
 *                    window that stops mid-argument scores identically to one
 *                    that lands.
 *   serves_through_line — a tangent can be locally strong. Scored 2 when no
 *                    through-line is known, rather than guessed.
 */
const SHORT_RUBRIC = Object.freeze([
    { key: 'self_contained',      text: 'Does it make sense to someone who has not seen the rest of the video?' },
    { key: 'opens_strong',        text: 'Does the first line make someone stay past three seconds?' },
    { key: 'has_payoff',          text: 'Does it land somewhere, rather than just stopping?' },
    { key: 'serves_through_line', text: 'Is it about what this video is actually about?' },
]);

/**
 * Never send more than this many passages in one call.
 *
 * Eight is the number R158 recommended and it is also about the point where
 * the prompt stops being cheap: eight passages of opener + tail runs ~2.5k
 * characters, which is a judge. Thirty would be a summariser.
 */
const MAX_WINDOWS = 8;

/** How much of a passage the judge is shown. Enough to score, not to read. */
const OPENER_CHARS = 180;
const TAIL_CHARS = 140;

const SHORT_JUDGE_SCHEMA = schemaFor('short_window_verdicts', SHORT_RUBRIC);

const clock = (t) => {
    const n = Math.max(0, Math.round(Number(t) || 0));
    return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};

const trim = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * Build the prompt.
 *
 * @param {Object[]} windows [{ id, start, end, opener, tail, words }]
 * @param {Object} context
 * @returns {string}
 */
function buildShortJudgePrompt(windows, context = {}) {
    const c = context || {};
    const lines = [
        'You are choosing which passage of one long video would make the best short.',
        'You do NOT cut anything and you do NOT propose passages of your own.',
        'Score only the passages listed.',
        '',
        'THE VIDEO',
        `  Length: ${Math.round(Number(c.duration) || 0)}s`,
        `  Editing style: ${c.styleId || '(none)'}`,
        `  Target platform: ${c.platform || '(none)'}`,
        `  What it is about: ${trim(c.throughLine, 240) || '(not established — score through-line 2)'}`,
    ];

    if (c.opening) {
        lines.push(`  How the video itself opens: "${trim(c.opening, 220)}"`);
    }

    lines.push(
        '',
        'RUBRIC — score each passage 0 to 5 on every axis:',
        ...SHORT_RUBRIC.map(r => `  ${r.key}: ${r.text}`),
        '  A 0 means actively wrong as a short. A 5 means clearly the best passage here.',
        '  If you have no basis for an axis, score it 2. Do not guess high.',
        '',
        'PASSAGES',
    );

    for (const w of windows) {
        const dur = Math.max(0, Math.round(Number(w.end) - Number(w.start)));
        const words = Number(w.words) > 0 ? `, ${Math.round(Number(w.words))} words` : '';
        lines.push(`  ${w.id} — ${dur}s${words}, at ${clock(w.start)}`);
        lines.push(`      opens: "${trim(w.opener, OPENER_CHARS)}"`);
        if (w.tail) lines.push(`      ends: "${trim(w.tail, TAIL_CHARS)}"`);
    }

    lines.push(
        '',
        'Return a verdict for EVERY passage id above, and no other id.',
    );

    return lines.join('\n');
}

/**
 * Score candidate windows. Returns a map of id -> verdict, or null.
 *
 * null means "no judgement available" and is the normal, expected answer on
 * any project where no judge model is configured. The caller must be correct
 * in that case, not merely survive it.
 *
 * @param {Object} opts
 * @param {Object[]} opts.windows [{ id, start, end, opener, tail, words }]
 * @param {Object} [opts.context]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<Object|null>}
 */
async function judgeShortWindows({ windows = [], context = {}, signal = null } = {}) {
    const usable = (Array.isArray(windows) ? windows : [])
        .filter(w => w && typeof w.id === 'string' && w.id
            && Number.isFinite(Number(w.start)) && Number.isFinite(Number(w.end))
            && Number(w.end) > Number(w.start))
        .slice(0, MAX_WINDOWS);

    // One passage cannot be arbitrated against anything: there is no ordering
    // to change, so the call would only cost money. Same rule /analyze uses.
    if (usable.length < 2) return null;

    return scoreWithRubric({
        rubric: SHORT_RUBRIC,
        schema: SHORT_JUDGE_SCHEMA,
        prompt: buildShortJudgePrompt(usable, context),
        ids: usable.map(w => w.id),
        signal,
        system: 'You score candidate passages of a video against a rubric. Return only JSON.',
        tag: 'ShortJudge',
    });
}

module.exports = {
    SHORT_RUBRIC,
    SHORT_JUDGE_SCHEMA,
    MAX_WINDOWS,
    OPENER_CHARS,
    TAIL_CHARS,
    buildShortJudgePrompt,
    judgeShortWindows,
};
