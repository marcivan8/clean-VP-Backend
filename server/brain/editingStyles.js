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

/**
 * R92: sound-effect level. Reel and Vlog: full. Talking head: soft (no impact
 * hits). Podcast and Interview: none. No style: full (the old behaviour).
 */
function sfxLevel(styleId) {
    if (styleId === 'podcast' || styleId === 'interview') return 'none';
    if (styleId === 'talking_head') return 'subtle';
    return 'full';
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

/**
 * R92 round B: the Brain's context, segmented by style. Each style looks at
 * different things first, measured from the project, and leaves some aside.
 * The rules above say HOW to edit; this says WHAT to check, in order, with
 * the current numbers next to each item.
 */
const has = (ctx, ...ops) => (Array.isArray(ctx?.editsDone) ? ctx.editsDone : []).some(op => ops.includes(String(op)));
const pct = n => `${Math.round((Number(n) || 0) * 100)}%`;
const STYLE_FOCUS = {
    talking_head: {
        label: 'Talking head',
        priorities: ['Pacing: silences, filler words and repeated takes', 'Zoom rhythm to hold attention on a single speaker', 'Captions for sound-off viewing', 'Voice clarity and loudness'],
        checks: ctx => [
            `cut rate ${ctx.cutRate || 0}/min (aim for 4 to 10)`,
            `speaking pace ${ctx.speakingPace || '?'} wpm`,
            `clean up ${has(ctx, 'long_form_edit', 'silence_removal', 'remove_filler_words') ? 'done' : 'not done'}`,
            `zoom rhythm on ${pct(ctx.rhythmCoverage)} of clips`,
            `captions ${ctx.hasCaptions ? 'yes' : 'no'}`,
            `voice enhanced ${has(ctx, 'enhance_audio', 'denoise_audio', 'normalize_audio') ? 'yes' : 'no'}`,
        ],
        aside: ['music beds unless asked', 'heavy b-roll'],
    },
    podcast: {
        label: 'Podcast',
        priorities: ['Audio: clean voices at standard loudness', 'Dead air between turns', 'Readable captions', 'The best exchanges as shorts for social'],
        checks: ctx => [
            `${ctx.detectedSpeakers || ctx.effects?.speakerCount || 0} speaker(s)`,
            `voice enhanced ${has(ctx, 'enhance_audio', 'denoise_audio', 'normalize_audio') ? 'yes' : 'no'}`,
            `clean up ${has(ctx, 'long_form_edit', 'silence_removal') ? 'done' : 'not done'}`,
            `captions ${ctx.hasCaptions ? 'yes' : 'no'}`,
            `shorts picked ${has(ctx, 'repurpose_shorts', 'extract_short') ? 'yes' : 'no'}`,
        ],
        aside: ['impact sound effects', 'fast zooms', 'music beds', 'flashy transitions', 'reordering the conversation'],
    },
    interview: {
        label: 'Interview',
        priorities: ['Keep every question with its answer, in order', 'Trim dead air between turns', 'Camera angle on the active speaker', 'Quotable moments for social'],
        checks: ctx => [
            `${ctx.detectedSpeakers || ctx.effects?.speakerCount || 0} speaker(s)`,
            `camera angles on ${pct(ctx.multicamCoverage)} of clips`,
            `clean up ${has(ctx, 'long_form_edit', 'silence_removal') ? 'done' : 'not done'}`,
            `captions ${ctx.hasCaptions ? 'yes' : 'no'}`,
        ],
        aside: ['hook-first reordering', 'impact sound effects', 'music beds'],
    },
    vlog: {
        label: 'Vlog',
        priorities: ['The story in recorded order, with clear beats', 'B-roll and transitions between places', 'A music bed under the talking', 'Natural pacing (keep the personality, cut only dead air)'],
        checks: ctx => [
            `${ctx.clipCount || 0} clips, ${ctx.duration || 0}s`,
            `music ${ctx.hasMusic ? 'yes' : 'no'}`,
            `transitions ${has(ctx, 'add_transition', 'apply_style_recipe') ? 'added' : 'none yet'}`,
            `captions ${ctx.hasCaptions ? 'yes' : 'no'}`,
        ],
        aside: ['removing every filler word', 'hook-first reordering'],
    },
    reel: {
        label: 'Reel',
        priorities: ['Hook in the first 2 seconds', 'Length in the platform sweet spot (TikTok 21 to 34 s, Reels 15 to 30 s, Shorts 30 to 50 s)', '9:16 with the speaker framed', 'Bold captions kept clear of the app buttons', 'Energy: tight cuts, zooms, sound effects'],
        checks: ctx => [
            `${ctx.duration || 0}s long${(ctx.duration || 0) > 60 ? ' (too long for a short: extract one or repurpose into shorts)' : ''}`,
            `aspect ${ctx.aspectRatio || 'unknown'}${ctx.aspectRatio && ctx.aspectRatio !== '9:16' ? ' (should be 9:16)' : ''}`,
            `cut rate ${ctx.cutRate || 0}/min (aim for 15 to 30)`,
            `captions ${ctx.hasCaptions ? 'yes' : 'no'}`,
            `animation ${has(ctx, 'animate_automatically', 'compose_motion') ? 'yes' : 'no'}`,
        ],
        aside: ['long-form structure (intro, chapters, outro)'],
    },
};

/** "STYLE FOCUS" section for the Brain, with the project's current numbers. '' with no style. */
function styleFocusSection(styleId, ctx = {}) {
    const id = sanitizeEditingStyle(styleId);
    const f = id ? STYLE_FOCUS[id] : null;
    if (!f) return '';
    let checks = [];
    try { checks = f.checks(ctx || {}); } catch { checks = []; }
    return `═══════════════════════════════════════════════
STYLE FOCUS: ${f.label}
Look at these first, in this order:
${f.priorities.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}
Where the project stands now: ${checks.join('; ')}.
Leave aside unless the user asks: ${f.aside.join(', ')}.
Rank every suggestion by this focus. Anything outside it goes last.`;
}

/** Recent edits with why and impact, for the Brain. '' when none. */
function ledgerSection(ledger) {
    const rows = (Array.isArray(ledger) ? ledger : []).filter(e => e && e.op).slice(-8);
    if (rows.length === 0) return '';
    return `Recent edits (what, why, impact):\n${rows.map(e => `  - ${e.op}${e.why ? `: ${String(e.why).slice(0, 160)}` : ''}${e.impact ? ` [${String(e.impact).slice(0, 200)}]` : ''}`).join('\n')}`;
}

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
    sfxLevel,
    styleFocusSection,
    ledgerSection,
    STYLE_FOCUS,
    expectsMusic,
    brainStyleSection,
    projectMapStyleNote,
    storyMapStyleNote,
    rhythmZoomStyle,
};
