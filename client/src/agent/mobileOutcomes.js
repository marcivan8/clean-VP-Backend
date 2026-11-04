import { runAutopilot } from './StyleAutopilot.js';
import useTimelineStore from '../store/useTimelineStore.js';

/**
 * The outcomes the mobile flow offers, and what each one means to the engine.
 *
 * This table is the whole of the "what are you making?" screen. A card is a
 * style plus a length, because those two choices are what a beginner can
 * actually answer and what the playbook needs. Changing the offer is an edit
 * here, not a change to any screen.
 *
 * `seconds` is passed as an explicit length, which drops the one-minute short
 * floor (R106). That is deliberate: the floor exists so a vague "make a short"
 * does not produce a 20-second stub, but a card that says 15-30s has already
 * answered the question.
 */
export const OUTCOMES = [
    {
        id: 'talking_head',
        styleId: 'talking_head',
        seconds: 40,
        // shown on the card; the range is what the user is promised, `seconds`
        // is what is asked for inside it
        range: '30 – 45s',
    },
    {
        id: 'reel',
        styleId: 'reel',
        seconds: 22,              // the Reel style's own targetDuration
        range: '15 – 30s',
    },
    {
        id: 'vlog',
        styleId: 'vlog',
        seconds: 40,
        range: '30 – 45s',
    },
    {
        id: 'howto',
        // No "how-to" editing style exists. It runs Talking head's playbook at
        // a longer length, which is the honest mapping until there is a real
        // one — the alternative was inventing a style that nothing implements.
        styleId: 'talking_head',
        seconds: 60,
        range: '45 – 75s',
    },
];

export const OUTCOME_BY_ID = Object.fromEntries(OUTCOMES.map(o => [o.id, o]));

/**
 * Start the edit for a picked outcome.
 *
 * @param {string} outcomeId  one of OUTCOMES
 * @param {{ request?: string, run?: Function }} [opts]
 *   `request` carries the user's own words from the "something else" card;
 *   anything else runs the style's playbook.
 */
export function startOutcome(outcomeId, opts = {}) {
    const outcome = OUTCOME_BY_ID[outcomeId];
    if (!outcome) throw new Error(`Unknown outcome: ${outcomeId}`);

    // The style is saved on the project, the way the desktop picker saves it,
    // so a later manual edit and the recipe steps see the same choice.
    useTimelineStore.getState().setEditingStyle?.(outcome.styleId);

    // "edit it" is the generic request that runs the whole playbook; a typed
    // request runs as itself instead (buildAutopilotSteps decides).
    const request = opts.request?.trim() || 'edit it';

    return runAutopilot(request, {
        styleId: outcome.styleId,
        shortTargetSeconds: outcome.seconds,
        ...(opts.run ? { run: opts.run } : {}),
    });
}

export default { OUTCOMES, OUTCOME_BY_ID, startOutcome };
