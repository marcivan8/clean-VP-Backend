/**
 * server/brain/editingStyles.js (R91 round 2)
 *
 * The editing style the user picked under the chat box (client:
 * client/src/agent/EditingStyles.js). When set, it OVERRIDES the format the
 * brain detects on its own (speaker count, bin heuristics): the user told us
 * what they are making. These are the server-side rules each intelligence
 * reads: Editorial Brain, Project Intelligence, Story Intelligence, the
 * animate and rhythm-zoom routes.
 *
 * Pure, no I/O.
 */

'use strict';

const EDITING_STYLE_IDS = ['vlog', 'talking_head', 'interview', 'podcast', 'reel'];

const STYLE_LABEL = {
    vlog: 'Vlog', talking_head: 'Talking head', interview: 'Interview', podcast: 'Podcast', reel: 'Reel',
};

/** A known style id, or null (anything else the client sends is ignored). */
function sanitizeEditingStyle(value) {
    const id = typeof value === 'string' ? value : (value && typeof value === 'object' ? value.id : null);
    return EDITING_STYLE_IDS.includes(id) ? id : null;
}

/** Platform implied by the style when the project has none set. */
function platformForStyle(styleId) {
    if (styleId === 'reel') return 'instagram_reels';
    if (styleId === 'podcast') return 'podcast';
    return null;
}

/** Styles where the order of the recording is the story (no hook-first reorder). */
function keepsRecordedOrder(styleId) {
    return styleId === 'vlog' || styleId === 'interview' || styleId === 'podcast';
}

/** Styles that are calm on purpose: no impact SFX, softer motion. */
function isCalmStyle(styleId) {
    return styleId === 'podcast' || styleId === 'interview';
}

/** Music is not expected for these (a podcast without a music bed is complete). */
function expectsMusic(styleId) {
    return !(styleId === 'podcast' || styleId === 'interview' || styleId === 'talking_head');
}

const BRAIN_RULES = {
    vlog: [
        'The story follows the order it was filmed: never recommend moving a later moment to the front.',
        'B-roll on what is being described, light background music and speed-line or whip cuts suit it.',
        'Two people talking in a vlog is still a vlog, not an interview.',
    ],
    talking_head: [
        'One person to camera: tight silence and filler removal, punch-in zoom rhythm, bold captions with key words.',
        'A strong first sentence matters; suggesting a better opening line is fine.',
        'B-roll and music are optional, never a gap.',
    ],
    interview: [
        'Keep each question with its answer; never cut a speaker mid-sentence; do not reorder the conversation.',
        'Clean captions, soft dips between topics, angle switches on the active speaker.',
        'Do not push impact sound effects, music beds or flashy transitions; b-roll is optional, never a gap.',
    ],
    podcast: [
        'Long calm conversation: remove dead air and filler but keep the natural flow; do not reorder it.',
        'Clear, levelled audio and readable captions matter most.',
        'Do NOT suggest b-roll, reaction shots, music beds, impact sound effects, flashy transitions or aggressive zooms; static framing is intended.',
    ],
    reel: [
        'Short vertical social cut, usually repurposed from a longer video: 15 to 60 seconds, 9:16.',
        'The strongest moment must open the video (hook in the first 2 seconds); cuts very tight; bold captions.',
        'Do not suggest long-form structure (intro, chapters, outro).',
    ],
};

/** Section for the Editorial Brain system prompt, or '' with no style. */
function brainStyleSection(styleId) {
    const id = sanitizeEditingStyle(styleId);
    if (!id) return '';
    return `═══════════════════════════════════════════════
EDITING STYLE (chosen by the user — takes precedence)
═══════════════════════════════════════════════
The user picked the ${STYLE_LABEL[id]} style for this project. It OVERRIDES the
detected format above and the generic format rules below: describe the video as
${STYLE_LABEL[id].toLowerCase()} content and only suggest what fits it.
${BRAIN_RULES[id].map(r => `  • ${r}`).join('\n')}`;
}

/** Line for the Project Intelligence derivation prompt, or ''. */
function projectMapStyleNote(styleId) {
    const id = sanitizeEditingStyle(styleId);
    if (!id) return '';
    const gapRule = {
        podcast: 'Static framing and long talk are intended: do NOT list missing cutaways, b-roll, music, intro/outro or establishing shots as gaps.',
        interview: 'Cutaways and b-roll are optional for an interview: do not list them as gaps.',
        talking_head: 'Cutaways and music are optional for a talking head: do not list them as gaps.',
        vlog: 'A vlog benefits from b-roll of what is described; a long stretch with no cutaway can be a gap.',
        reel: 'A reel is one short vertical cut: do not list intro, outro or establishing shots as gaps.',
    }[id];
    return `Editing style: ${STYLE_LABEL[id]} (chosen by the user). ${gapRule}`;
}

/** Line for the Story Intelligence derivation prompt, or ''. */
function storyMapStyleNote(styleId) {
    const id = sanitizeEditingStyle(styleId);
    if (!id) return '';
    if (keepsRecordedOrder(id)) {
        return `Editing style: ${STYLE_LABEL[id]} (chosen by the user). The cut follows the recorded order on purpose: judge it in that order, and do NOT suggest moving a later moment to the front. Report where the hook is, but a late hook is not an issue to fix by reordering.`;
    }
    return `Editing style: ${STYLE_LABEL[id]} (chosen by the user). The hook must land in the first ${id === 'reel' ? 2 : 3} seconds; a later hook is a high-severity issue.`;
}

/**
 * Rhythm-zoom route: how the LLM shot planner should behave for this style.
 * @returns {{promptLine: string, allowPunchIns: boolean, motions: string[]|null}}
 */
function rhythmZoomStyle(styleId) {
    const id = sanitizeEditingStyle(styleId);
    if (isCalmStyle(id)) {
        return {
            promptLine: `Style: ${STYLE_LABEL[id]}. Calm and steady: change framing only at topic or sentence boundaries, prefer slow push-ins, no punch-ins on single words.`,
            allowPunchIns: false,
            motions: ['push_in', 'static'],
        };
    }
    if (id === 'vlog') {
        return { promptLine: 'Style: Vlog. Light energy: vary framing moderately, punch-ins only on clear emphasis.', allowPunchIns: true, motions: null };
    }
    return { promptLine: '', allowPunchIns: true, motions: null };
}

module.exports = {
    EDITING_STYLE_IDS,
    STYLE_LABEL,
    sanitizeEditingStyle,
    platformForStyle,
    keepsRecordedOrder,
    isCalmStyle,
    expectsMusic,
    brainStyleSection,
    projectMapStyleNote,
    storyMapStyleNote,
    rhythmZoomStyle,
};
