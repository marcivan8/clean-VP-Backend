/**
 * client/src/agent/judgeBlend.js
 *
 * The pure rule for folding a judge's verdicts into a ranking.
 *
 * Lives in its own module rather than inside EditPolicy because BOTH sides of
 * the ranking need it and EditPolicy already imports SuggestionEngine
 * (`deriveFacts`). SuggestionEngine importing EditPolicy back would be a
 * circular import, which ESM tolerates only until one of the two grows a
 * top-level side effect. One tiny dependency-free module avoids the question.
 *
 * EditPolicy re-exports `blendJudge` and `JUDGE_SPAN` so its public surface is
 * unchanged.
 */

/**
 * How much a judge's verdict may move a ranking.
 *
 * Bounded on purpose. Deterministic scores encode FACTS — this is blocked,
 * this is already done, this style sets that aside — and a model's opinion
 * must not be able to overturn a fact. JUDGE_SPAN is small enough that a judge
 * reorders candidates WITHIN a tier and cannot lift one across the -500
 * (already done) or -1000 (ineligible) penalties EditPolicy applies.
 */
export const JUDGE_SPAN = 24;

/**
 * Blend judge verdicts into a deterministic ranking.
 *
 * Pure, and safe against every shape of bad input: an unknown id, a missing
 * verdict, a confidence outside 0..1, or no verdicts at all. With no verdicts
 * the ranking is simply re-sorted by its own scores, which is what makes the
 * judge optional rather than load-bearing.
 *
 * @param {object[]} scored      items with `{ id, score }` (e.g. scoreOf results)
 * @param {object|null} verdicts  id → { confidence, why } from the judge
 * @returns {object[]} re-sorted, each carrying `judge` and `blendedScore`
 */
export function blendJudge(scored, verdicts) {
    const list = Array.isArray(scored) ? scored : [];
    const byId = (verdicts && typeof verdicts === 'object') ? verdicts : {};

    const blended = list.map(s => {
        const v = byId[s.id];

        // `typeof === 'number'` is load-bearing: Number(null) is 0, so a
        // verdict of { confidence: null } coerced to a legitimate score of
        // ZERO and applied the full negative penalty — the judge's SILENCE
        // being read as its harshest possible verdict.
        const raw = (v && typeof v.confidence === 'number' && Number.isFinite(v.confidence))
            ? v.confidence
            : null;

        if (raw === null) {
            // No usable verdict: the candidate keeps its own score rather
            // than being penalised for the judge having nothing to say.
            return { ...s, judge: null, blendedScore: s.score };
        }

        const confidence = Math.min(1, Math.max(0, raw));
        // Centred on 0.5 so an average verdict is neutral: a confident
        // candidate gains, a poor one loses, and neither swings a tier.
        const delta = (confidence - 0.5) * 2 * JUDGE_SPAN;
        return {
            ...s,
            judge: { confidence, why: typeof v.why === 'string' ? v.why : '' },
            blendedScore: s.score + delta,
        };
    });

    // ALWAYS sorted, verdicts or not. Sorting only when verdicts happened to
    // be present made the no-judge path return whatever order the caller
    // passed in, so turning a judge on or off changed the ordering for reasons
    // that had nothing to do with the judge. Ties break on id for determinism.
    return blended.sort((a, b) =>
        b.blendedScore - a.blendedScore || String(a.id).localeCompare(String(b.id)));
}

export default { JUDGE_SPAN, blendJudge };
