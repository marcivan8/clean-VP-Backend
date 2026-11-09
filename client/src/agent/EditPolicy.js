/**
 * client/src/agent/EditPolicy.js
 *
 * One decision layer: given the project as it stands and a set of goals,
 * decide WHAT to do, in WHAT ORDER, and say WHY.
 *
 * WHY THIS EXISTS
 * ---------------
 * Three separate things decided "what next", and none of them could see what
 * the others knew:
 *
 *   SuggestionEngine   ranks the next action from live facts — but only ever
 *                      produces chips for a human to click, and its ordering is
 *                      hand-assigned priority integers (100, 95, 90, …).
 *   StyleAutopilot     actually runs a multi-step edit — from a hardcoded step
 *                      list per editing style, built once up front from facts
 *                      sniffed by regex over the request text, then executed
 *                      open-loop. The same style ran the same steps whether or
 *                      not they were possible, or already done.
 *   EditorialBrain     reasons over the story/project maps — on the server,
 *                      advisory only.
 *
 * So Auto mode could run "Remove silences" on a project with no transcript
 * (the step fails and is reported as skipped), or re-run a cleanup that was
 * already applied, because nothing checked preconditions or prior state before
 * committing to the plan.
 *
 * This module is the shared answer. It is PURE and deterministic: same
 * situation in, same decision out, no network and no model call. That matters
 * because it is the layer a cheap judge model should eventually RANK the output
 * of (see `scoreOf` / `explain`), not the layer that should itself be guessing.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does not execute anything, and it never vetoes a user's explicit request.
 * `decide()` reports `skipped` with a reason and lets the caller choose. A
 * planner that silently dropped what the user asked for would be worse than
 * the open loop it replaces.
 */

import {
    contractFor,
    deriveResources,
    isEligible,
    missingRequirements,
    missingPreferences,
    planFor,
    producerOf as graphProducerOf,
} from './CapabilityGraph.js';
import { COMMAND_BY_ID, resolveCommand } from './CommandRegistry.js';
import { deriveFacts } from './SuggestionEngine.js';
import { stylePolicy } from './stylePolicy.generated.js';
import { phraseFor } from './commandPhrases.generated.js';
// The judge blend lives in its own dependency-free module: SuggestionEngine
// needs it too, and this file already imports SuggestionEngine, so keeping it
// here would have forced a circular import. Re-exported below so EditPolicy's
// public surface is unchanged.
import { blendJudge, JUDGE_SPAN } from './judgeBlend.js';

/**
 * Which commands each style predicate governs.
 *
 * Derived from the PREDICATES in stylePolicy.generated.js — never from the
 * prose in `aside`/`priorities`. That boundary is deliberate: the booleans are
 * a contract that a test can pin, while "flashy transitions" is a sentence
 * written for a language model and would have to be re-interpreted here to be
 * useful, which is how a fourth, drifting copy of the style rules gets born.
 */
const GOVERNS = Object.freeze({
    // sfxLevel === 'none' — podcast and interview take no sound effects.
    sfx: ['add_sfx'],
    // keepsRecordedOrder — vlog, interview and podcast tell the story in the
    // order it was recorded, so anything that promotes a later moment to the
    // front works against the format.
    reorder: ['organize_clips', 'extract_short', 'repurpose_shorts'],
    // allowPunchIns === false — calm styles change framing at topic
    // boundaries, not on single words. Constrained, never banned: the zoom
    // itself is fine, the punch-in intensity is not.
    punchIns: ['rhythm_zoom'],
    // calm — "flashy transitions" are explicitly set aside for podcast.
    flashy: ['add_transition'],
});

/**
 * Compound operations that IntentParser produces but CommandRegistry does not
 * declare, so CapabilityGraph has no contract for them.
 *
 * Without this the most common Auto step of all is opaque. The talking-head,
 * interview and podcast playbooks all open with "Clean up the video", which
 * IntentParser's `cleanEdit` vocabulary turns into `long_form_edit` with
 * actions [silence_removal, remove_filler_words, remove_repetition,
 * enhance_audio] — three of which need word timings. On a fresh upload the
 * step therefore cannot work, and the planner could not see that, so it could
 * not put captions first.
 *
 * `triggers` are a SUBSET of IntentParser's own NLP_MAP.cleanEdit list, not a
 * new vocabulary. test_edit_policy.mjs reads IntentParser.js and asserts every
 * trigger below still appears there, so this cannot drift into a second,
 * disagreeing definition of what "clean up" means.
 */
export const COMPOUND_OPERATIONS = Object.freeze({
    long_form_edit: {
        id: 'long_form_edit',
        triggers: [
            'clean up the video', 'clean up my video', 'clean up this video',
            'clean this video', 'clean the video', 'clean it up', 'clean up',
            'full cleanup', 'full clean up', 'clean and polish', 'tidy up the video',
        ],
        // Its own actions need a transcript; enhance_audio alone would not.
        requires: ['clips', 'transcript'],
        provides: [],
        // The ledger records the compound, not the individual actions.
        satisfiedBy: ['long_form_edit', 'compound_clean_dynamic'],
        label: 'Clean up the video',
    },
});

/** Longest trigger first, so "clean up the video" wins over "clean up". */
const COMPOUND_TRIGGERS = Object.freeze(
    Object.values(COMPOUND_OPERATIONS)
        .flatMap(op => op.triggers.map(t => ({ trigger: t.toLowerCase(), id: op.id })))
        .sort((a, b) => b.trigger.length - a.trigger.length),
);

/**
 * A contract for either a registry command or one of the compounds above.
 * @param {string} id
 * @returns {{requires: string[], prefers: string[], provides: string[], destructive: boolean, readOnly: boolean}|null}
 */
function contractOf(id) {
    const compound = COMPOUND_OPERATIONS[id];
    if (compound) {
        return {
            requires: compound.requires,
            prefers: [],
            provides: compound.provides,
            destructive: true,
            readOnly: false,
        };
    }
    return contractFor(id);
}

/** Verdicts a style can return for a command. */
export const FIT = Object.freeze({
    NEUTRAL:     'neutral',      // the style has no opinion
    PREFERRED:   'preferred',    // squarely what this style is for
    CONSTRAINED: 'constrained',  // do it, but gently
    DISCOURAGED: 'discouraged',  // works against the format
});

/**
 * Commands each style actively wants, from STYLE_FOCUS.priorities' intent.
 * Kept small and obvious on purpose — a long list here would be a second
 * playbook, which is the thing this module exists to remove.
 */
const PREFERRED_BY_STYLE = Object.freeze({
    talking_head: ['silence_removal', 'remove_filler_words', 'rhythm_zoom', 'auto_captions', 'enhance_audio'],
    podcast:      ['enhance_audio', 'normalize_audio', 'silence_removal', 'auto_captions', 'repurpose_shorts'],
    interview:    ['silence_removal', 'auto_captions', 'apply_angle', 'detect_speakers'],
    vlog:         ['silence_removal', 'enhance_audio', 'add_transition', 'auto_captions'],
    reel:         ['extract_short', 'set_aspect_ratio', 'auto_captions', 'polish_short', 'rhythm_zoom'],
});

/**
 * How a style feels about a command.
 *
 * @param {string} commandId
 * @param {string|null} styleId
 * @returns {{fit: string, reason: string|null}}
 */
export function styleFit(commandId, styleId) {
    const policy = stylePolicy(styleId);
    if (!policy || !commandId) return { fit: FIT.NEUTRAL, reason: null };

    if (policy.sfxLevel === 'none' && GOVERNS.sfx.includes(commandId)) {
        return { fit: FIT.DISCOURAGED, reason: `${policy.label} takes no sound effects.` };
    }
    if (policy.keepsRecordedOrder && GOVERNS.reorder.includes(commandId)) {
        return {
            fit: FIT.DISCOURAGED,
            reason: `${policy.label} keeps the recorded order, so it does not reorder to lead with the strongest moment.`,
        };
    }
    if (policy.calm && GOVERNS.flashy.includes(commandId)) {
        return { fit: FIT.DISCOURAGED, reason: `${policy.label} is calm on purpose — no flashy transitions.` };
    }
    if (!policy.allowPunchIns && GOVERNS.punchIns.includes(commandId)) {
        return {
            fit: FIT.CONSTRAINED,
            reason: `${policy.label} changes framing at topic boundaries — use slow push-ins, not punch-ins.`,
        };
    }
    if ((PREFERRED_BY_STYLE[styleId] || []).includes(commandId)) {
        return { fit: FIT.PREFERRED, reason: `${policy.label} leads with this.` };
    }
    return { fit: FIT.NEUTRAL, reason: null };
}

/**
 * Operation names that count as having satisfied a command.
 *
 * The ledger records the OPERATION that ran, which is not always the registry
 * id (`split_by_speaker` executes `split_speakers`), and several compound
 * operations satisfy more than one command at once. Without this map an
 * already-cleaned project looks un-cleaned and the planner proposes the work
 * again — which is the bug SuggestionEngine's own comment describes.
 */
const SATISFIED_BY = Object.freeze({
    silence_removal:     ['silence_removal', 'compound_clean_dynamic', 'compound_clean_virtual_multicam', 'long_form_edit'],
    remove_filler_words: ['remove_filler_words', 'remove_filler', 'compound_clean_dynamic', 'long_form_edit'],
    remove_repetition:   ['remove_repetition'],
    auto_captions:       ['auto_captions', 'add_captions'],
    rhythm_zoom:         ['rhythm_zoom', 'dynamic_rhythm', 'compound_clean_dynamic'],
    apply_angle:         ['apply_angle', 'virtual_multicam', 'compound_clean_virtual_multicam', 'compound_split_speakers_virtual_multicam'],
    split_by_speaker:    ['split_by_speaker', 'split_speakers', 'compound_split_speakers_virtual_multicam'],
    detect_speakers:     ['detect_speakers', 'split_speakers'],
    detect_scene:        ['detect_scene'],
    organize_clips:      ['organize_clips'],
    extract_short:       ['extract_short'],
    repurpose_shorts:    ['repurpose_shorts'],
    set_aspect_ratio:    ['set_aspect_ratio'],
    apply_style_recipe:  ['apply_style_recipe', 'auto_edit'],
    queue_export:        ['queue_export', 'export'],
    emphasize_keywords:  ['emphasize_keywords'],
    polish_short:        ['polish_short'],
    macro_multicam:      ['virtual_multicam', 'compound_split_speakers_virtual_multicam'],
    macro_clean_and_polish: ['compound_clean_dynamic'],
});

/** Coverage-based completion, where a boolean would be wrong. */
const COVERAGE = Object.freeze({
    apply_angle:    (f) => (f.multicamCoverage || 0) >= 0.5,
    macro_multicam: (f) => (f.multicamCoverage || 0) >= 0.5,
    rhythm_zoom:    (f) => (f.rhythmCoverage || 0) >= 0.5,
    auto_captions:  (f) => !!(f.hasTranscript && f.hasCaptionClips),
    set_aspect_ratio: (f, situation) => situation.targetAspect
        ? f.aspectRatio === situation.targetAspect
        : false,
});

/**
 * Has this command's work already been done?
 *
 * Two independent signals, because either alone is wrong: the ledger can be
 * empty for a restored project, and coverage can read as partial for an effect
 * that was deliberately applied to a few clips.
 *
 * @param {string} commandId
 * @param {object} situation
 * @returns {boolean}
 */
export function isSatisfied(commandId, situation) {
    const facts = situation?.facts || {};
    const ops = facts.opsApplied instanceof Set
        ? facts.opsApplied
        : new Set(Array.isArray(facts.opsApplied) ? facts.opsApplied : []);

    const coverage = COVERAGE[commandId];
    if (coverage) {
        try { if (coverage(facts, situation)) return true; } catch { /* fall through to the ledger */ }
    }

    const compound = COMPOUND_OPERATIONS[commandId];
    const names = compound ? compound.satisfiedBy : (SATISFIED_BY[commandId] || [commandId]);
    for (const op of names) {
        if (ops.has(op)) return true;
    }
    return false;
}

/**
 * Resolve free text to a command id, so a suggestion written in English can be
 * checked structurally instead of by regex over its label.
 *
 * This became possible once the Brain's catalogue started emitting phrases
 * verified to route (scripts/generate_capability_catalog.mjs): a suggestion the
 * Brain copied verbatim resolves here to exactly the command it names.
 *
 * @param {string} text
 * @returns {string|null}
 */
export function commandIdFor(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    if (COMMAND_BY_ID[raw] || COMPOUND_OPERATIONS[raw]) return raw;

    const r = resolveCommand(raw);
    // A low-confidence registry match is a guess; a decision layer must not
    // act on one. The caller keeps the text and lets the full parser decide.
    if (r.match && r.confidence === 'high') return r.match.id;

    // The registry did not resolve it — try the compound vocabulary, matching
    // the way IntentParser does (substring on the lowercased prompt).
    const lower = raw.toLowerCase();
    for (const { trigger, id } of COMPOUND_TRIGGERS) {
        if (lower.includes(trigger)) return id;
    }
    return null;
}

/**
 * The whole situation, in one object, derived once.
 *
 * @param {object} state      timeline store state
 * @param {object} [extra]    { targetAspect, styleId }
 * @returns {{facts: object, resources: Set<string>, styleId: string|null, policy: object|null, targetAspect: string|null}}
 */
export function situationOf(state, extra = {}) {
    const facts = deriveFacts(state || {});
    const styleId = extra.styleId || facts.style || null;
    return {
        facts,
        resources: deriveResources(state || {}, facts),
        styleId,
        policy: stylePolicy(styleId),
        targetAspect: extra.targetAspect || null,
    };
}

/**
 * The insertable producer of a resource, or null when none may be inserted.
 * Thin wrapper over the graph so the compound path and the registry path
 * resolve prerequisites the same way.
 */
function producerFor(resource, owned) {
    return graphProducerOf(resource, { have: owned, insertableOnly: true });
}

/** Scoring weights. Deterministic, and tuned to be explainable, not clever. */
const WEIGHT = Object.freeze({
    PREFERRED:   30,   // the style leads with this
    CONSTRAINED: -5,   // allowed, but not the obvious next move
    DISCOURAGED: -60,  // works against the format; below any neutral candidate
    UNLOCKS:     8,    // per command this would make possible
    DESTRUCTIVE: -6,   // prefer a reversible step when both fit
    READ_ONLY:   4,    // analysis is cheap and unlocks things
    UPGRADE:     -3,   // per missing soft preference
});

/**
 * Score one candidate command for this situation. Higher is a better next
 * move. Returns the score and the reasons that produced it, so a ranking can
 * always be explained — and so a judge model has something to check rather
 * than a bare number.
 *
 * @param {string} commandId
 * @param {object} situation
 * @returns {{id: string, score: number, eligible: boolean, satisfied: boolean, fit: string, missing: string[], unlocks: string[], reasons: string[]}}
 */
export function scoreOf(commandId, situation) {
    const contract = contractOf(commandId);
    const reasons = [];

    if (!contract) {
        return {
            id: commandId, score: -Infinity, eligible: false, satisfied: false,
            fit: FIT.NEUTRAL, missing: ['unknown_command'], unlocks: [],
            reasons: ['Not a known command.'],
        };
    }

    const missing = missingRequirements(commandId, situation.resources);
    const eligible = missing.length === 0;
    const satisfied = isSatisfied(commandId, situation);
    const { fit, reason: fitReason } = styleFit(commandId, situation.styleId);

    let score = 0;

    if (!eligible) {
        reasons.push(`Needs ${missing.join(', ')} first.`);
        score -= 1000;   // never outranks anything runnable
    }
    if (satisfied) {
        reasons.push('Already done on this project.');
        score -= 500;
    }

    if (fit === FIT.PREFERRED)        { score += WEIGHT.PREFERRED; reasons.push(fitReason); }
    else if (fit === FIT.CONSTRAINED) { score += WEIGHT.CONSTRAINED; reasons.push(fitReason); }
    else if (fit === FIT.DISCOURAGED) { score += WEIGHT.DISCOURAGED; reasons.push(fitReason); }

    // What this command would make possible that is blocked right now.
    const unlocks = [];
    if (contract.provides.length > 0) {
        const after = new Set([...situation.resources, ...contract.provides]);
        for (const id of Object.keys(COMMAND_BY_ID)) {
            if (id === commandId) continue;
            if (!isEligible(id, after)) continue;
            if (isEligible(id, situation.resources)) continue;
            unlocks.push(id);
        }
    }
    if (unlocks.length > 0) {
        score += unlocks.length * WEIGHT.UNLOCKS;
        reasons.push(`Unlocks ${unlocks.length} more operation(s).`);
    }

    if (contract.readOnly)    { score += WEIGHT.READ_ONLY; reasons.push('Read-only — changes nothing.'); }
    if (contract.destructive) { score += WEIGHT.DESTRUCTIVE; reasons.push('Removes material.'); }

    const upgrades = missingPreferences(commandId, situation.resources);
    if (upgrades.length > 0) {
        score += upgrades.length * WEIGHT.UPGRADE;
        reasons.push(`Would do better with ${upgrades.join(', ')}.`);
    }

    return { id: commandId, score, eligible, satisfied, fit, missing, unlocks, reasons: reasons.filter(Boolean) };
}

/**
 * Decide a plan.
 *
 * Goals are what the caller WANTS (a style playbook, a user request, a set of
 * Brain suggestions). The decision is which of them to keep, what to run first
 * so each becomes possible, and what to leave alone — each with a reason.
 *
 * @param {object} opts
 * @param {string[]} opts.goals              command ids, in the caller's preferred order
 * @param {object}   opts.state              timeline store state
 * @param {object}   [opts.situation]        pre-derived situation (avoids a second derive)
 * @param {boolean}  [opts.skipSatisfied]    drop goals whose work is already done (default true)
 * @param {boolean}  [opts.respectStyle]     drop goals the style discourages (default false —
 *                                           an explicit request must not be silently vetoed)
 * @returns {{steps: string[], inserted: string[], skipped: Array<{id,reason}>, unreachable: Array<{id,missing}>, upgrades: Array<{id,missing}>, scores: object[]}}
 */
export function decide({ goals = [], state = null, situation = null, skipSatisfied = true, respectStyle = false } = {}) {
    const sit = situation || situationOf(state);
    const skipped = [];

    // A goal is kept as { id, prompt }. `prompt` is ALWAYS the caller's own
    // text when they supplied text.
    //
    // This is load-bearing, not tidiness: handlers read parameters out of the
    // prompt. StyleAutopilot's reel step is "Pro finish for Instagram Reels",
    // and polish_short resolves its platform with
    // `platformsFromText(args.brief)`, falling back to 'tiktok' when the text
    // names nothing. Rewriting that goal to the bare id `polish_short` — which
    // it does resolve to — would silently retarget the edit at TikTok. So the
    // resolved id is used for REASONING (eligible? satisfied? on-style?) and
    // the original text is what actually runs.
    const keep = [];
    const underspecified = [];

    for (const goal of goals) {
        const isId = !!COMMAND_BY_ID[goal];
        const id = isId ? goal : commandIdFor(goal);
        const prompt = isId ? (phraseFor(goal) || goal) : goal;

        // A bare id for a command that takes parameters loses them. None are
        // declared `required`, so this is a warning rather than a rejection —
        // but "change the aspect ratio" with no ratio, or "add a transition"
        // with no type, leaves the executor guessing. Reported so the caller
        // can pass text ("Set the aspect ratio to 9:16") instead.
        if (isId) {
            const params = (COMMAND_BY_ID[goal].params || []).map(prm => prm.name).filter(Boolean);
            if (params.length > 0) underspecified.push({ id: goal, params, prompt });
        }

        if (!id) {
            // Not resolvable — hand it back untouched rather than dropping it.
            // The full parser (API, FallbackParser, localParse) may still
            // understand what the registry could not.
            keep.push({ id: null, prompt: goal });
            continue;
        }
        if (skipSatisfied && isSatisfied(id, sit)) {
            skipped.push({ id, prompt, reason: 'Already done on this project.' });
            continue;
        }
        const { fit, reason } = styleFit(id, sit.styleId);
        if (respectStyle && fit === FIT.DISCOURAGED) {
            skipped.push({ id, prompt, reason: reason || 'The chosen editing style sets this aside.' });
            continue;
        }
        keep.push({ id, prompt });
    }

    // Walk the goals IN THE CALLER'S ORDER, resolving prerequisites against the
    // state as it accumulates.
    //
    // Resolving all goals in one planFor() call and appending the unresolvable
    // ones afterwards looked equivalent and was not: it moved every free-text
    // step to the end. The talking-head playbook is
    // ["Clean up the video", "Add captions", "Apply the punchy style recipe"],
    // and "Clean up the video" does not resolve through the registry (it is
    // handled by IntentParser's tryCombinedCleanup), so the plan came out as
    // captions → recipe → cleanup. The style recipe would have run over
    // un-cleaned footage and the cleanup landed last. Order is part of the
    // playbook's meaning, so a step the graph cannot reason about keeps its
    // place rather than being sorted around.
    const steps = [];
    const inserted = [];
    const unreachable = [];
    const upgrades = [];
    const emitted = new Set();
    const owned = new Set(sit.resources);

    // An unresolvable step is OPAQUE: it may well create what later steps
    // need. The montage step ("Create a video from the uploaded images…")
    // provides clips, but does not resolve, so treating the state as unchanged
    // across it would mark every following step blocked for want of clips.
    // After the first opaque step, blocked-ness is no longer trustworthy and
    // is reported as such instead of being acted on.
    let sawOpaque = false;

    for (const goal of keep) {
        if (!goal.id) {
            steps.push({ id: null, prompt: goal.prompt, inserted: false, blocked: false, missing: [], blockedTrusted: false });
            sawOpaque = true;
            continue;
        }
        if (emitted.has(goal.id)) continue;

        // A compound is not a registry command, so the graph cannot plan it.
        // Resolve its prerequisites directly, then emit the compound itself.
        if (COMPOUND_OPERATIONS[goal.id]) {
            const contract = contractOf(goal.id);
            const missing = contract.requires.filter(r => !owned.has(r));
            const prereqPlan = planFor(
                missing.map(r => producerFor(r, owned)).filter(Boolean), owned);

            for (const id of prereqPlan.steps) {
                if (emitted.has(id)) continue;
                emitted.add(id);
                steps.push({
                    id, prompt: phraseFor(id) || id, inserted: true,
                    blocked: false, missing: [], blockedTrusted: !sawOpaque,
                });
                inserted.push(id);
                for (const made of (contractOf(id)?.provides || [])) owned.add(made);
            }

            const stillMissing = contract.requires.filter(r => !owned.has(r));
            emitted.add(goal.id);
            steps.push({
                id: goal.id, prompt: goal.prompt, inserted: false,
                blocked: stillMissing.length > 0, missing: stillMissing,
                blockedTrusted: !sawOpaque,
            });
            if (stillMissing.length > 0) {
                unreachable.push({ id: goal.id, missing: stillMissing, trusted: !sawOpaque });
            }
            continue;
        }

        const sub = planFor([goal.id], owned);

        if (sub.unreachable.length > 0) {
            const missing = [...new Set(sub.unreachable.flatMap(u => u.missing))];
            // Kept, never dropped: a blocked step behaves exactly as it does
            // today (it runs and reports its own failure), and after an opaque
            // step the block may not even be real. The caller decides.
            steps.push({
                id: goal.id, prompt: goal.prompt, inserted: false,
                blocked: true, missing, blockedTrusted: !sawOpaque,
            });
            emitted.add(goal.id);
            unreachable.push({ id: goal.id, missing, trusted: !sawOpaque });
            continue;
        }

        for (const id of sub.steps) {
            if (emitted.has(id)) continue;
            emitted.add(id);
            const isGoal = id === goal.id;
            steps.push({
                id,
                // An inserted prerequisite has no caller text, so it uses the
                // canonical phrase — verified to route to exactly this command.
                prompt: isGoal ? goal.prompt : (phraseFor(id) || id),
                inserted: !isGoal,
                blocked: false,
                missing: [],
                blockedTrusted: !sawOpaque,
            });
            if (!isGoal) inserted.push(id);
            for (const made of (contractOf(id)?.provides || [])) owned.add(made);
        }
        upgrades.push(...sub.upgrades);
    }

    return {
        steps,
        /** Every step's prompt, in order. Nothing is lost here. */
        prompts: steps.map(st => st.prompt),
        /** Only the steps believed runnable now — what a cautious runner uses. */
        runnablePrompts: steps.filter(st => !(st.blocked && st.blockedTrusted)).map(st => st.prompt),
        inserted,
        skipped,
        unreachable,
        upgrades,
        // Goals passed as a bare id whose command takes parameters the phrase
        // cannot carry. Still planned, but the caller should prefer text.
        underspecified: underspecified.filter(u => steps.some(st => st.id === u.id)),
        scores: steps.filter(st => st.id).map(st => scoreOf(st.id, sit)),
    };
}

/**
 * Rank candidates for "what should happen next", best first.
 * Ineligible and already-done candidates are kept but sink, so a caller can
 * show them greyed out with a reason instead of pretending they do not exist.
 *
 * @param {object} opts
 * @param {string[]} [opts.candidates]  command ids (defaults to every command)
 * @param {object}   opts.state
 * @param {object}   [opts.situation]
 * @param {number}   [opts.limit]
 * @returns {object[]} scoreOf() results, sorted
 */
export function rank({ candidates = null, state = null, situation = null, limit = 0 } = {}) {
    const sit = situation || situationOf(state);
    const ids = candidates && candidates.length ? candidates : Object.keys(COMMAND_BY_ID);
    const scored = ids
        .map(id => scoreOf(id, sit))
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    return limit > 0 ? scored.slice(0, limit) : scored;
}

export { blendJudge, JUDGE_SPAN };

/** One line explaining a decision, for a log or a chip tooltip. */
export function explain(scored) {
    if (!scored) return '';
    const head = scored.satisfied ? 'already done'
        : !scored.eligible ? `blocked (needs ${scored.missing.join(', ')})`
        : scored.fit === FIT.DISCOURAGED ? 'off-style'
        : 'available';
    return `${scored.id}: ${head} — ${scored.reasons.join(' ')}`.trim();
}

export default {
    FIT,
    COMPOUND_OPERATIONS,
    JUDGE_SPAN,
    blendJudge,
    styleFit,
    isSatisfied,
    commandIdFor,
    situationOf,
    scoreOf,
    decide,
    rank,
    explain,
};
