/**
 * EditingStyles.js (R91): the editing styles picked under the chat box, like
 * picking a model in a chatbot. Pure module, no imports.
 *
 * A style steers the brain in two ways:
 *  - Normal mode: it is sent as context with every prompt and fills the
 *    defaults a request leaves open (which recipe, which zoom rhythm, which
 *    transition, how long a reel should be). Nothing runs on its own.
 *  - Auto mode: "edit it" runs the style's playbook from start to finish
 *    (agent/StyleAutopilot.js), each step through the normal pipeline,
 *    all of it one undo step.
 *
 * Recipes are the bundles in motion/StyleRecipes.js (R90).
 */

export const EDITING_STYLE_IDS = ['vlog', 'talking_head', 'interview', 'podcast', 'reel'];
export const EDITING_MODES = ['normal', 'auto'];

export const EDITING_STYLES = {
    vlog: {
        id: 'vlog',
        // Silence removal: shortest pause that gets cut, and breathing room kept around speech.
        pacing: { minSilence: 0.6, padding: 0.1 },
        recipeId: 'travel',
        rhythmZoom: 'subtle',
        transition: 'speed-lines',
        targetDuration: null,
        guidance: 'Vlog: keep story order and natural breaths, use relevant b-roll and occasional location/subject vector illustrations, with relaxed motion and light upbeat energy.',
    },
    talking_head: {
        id: 'talking_head',
        // Silence removal: shortest pause that gets cut, and breathing room kept around speech.
        pacing: { minSilence: 0.35, padding: 0.05 },
        recipeId: 'punchy',
        rhythmZoom: 'dynamic',
        transition: 'flash',
        targetDuration: null,
        guidance: 'Talking head: one speaker to camera. Cut silences and filler tightly; use punch-ins, bold captions, relevant b-roll, restrained animated graphics, and occasional topic-matched vector illustrations.',
    },
    interview: {
        id: 'interview',
        // Silence removal: shortest pause that gets cut, and breathing room kept around speech.
        pacing: { minSilence: 0.7, padding: 0.15 },
        recipeId: 'explainer',
        rhythmZoom: 'subtle',
        transition: 'dip',
        targetDuration: null,
        guidance: 'Interview: preserve complete questions and answers, switch to the active speaker, and use clean captions, restrained b-roll, subtle motion, and occasional topic-matched vector illustrations.',
    },
    podcast: {
        id: 'podcast',
        // Silence removal: shortest pause that gets cut, and breathing room kept around speech.
        pacing: { minSilence: 0.8, padding: 0.15 },
        recipeId: 'podcast',
        rhythmZoom: 'subtle',
        transition: 'dip',
        targetDuration: null,
        guidance: 'Podcast: keep the natural flow and clear audio; use readable captions, gentle motion, restrained b-roll, subtle animated quote/topic graphics, and occasional vector illustrations. Avoid flashy effects.',
    },
    reel: {
        id: 'reel',
        // Silence removal: shortest pause that gets cut, and breathing room kept around speech.
        pacing: { minSilence: 0.3, padding: 0.05 },
        recipeId: 'punchy',
        rhythmZoom: 'dynamic',
        transition: 'whip-left',
        // Instagram Reels' own ideal range (PlatformProfiles.js 'reels':
        // length.ideal [15, 30]) is 15-30s -- used only as a soft starting
        // point (e.g. normal-mode "make a short" with no explicit length and
        // no platform named). The real output length follows the source
        // video: extract_short keeps the whole thing untouched when it's
        // already within maxDuration, and only trims down -- to the
        // strongest content, not an arbitrary fixed number -- when the
        // source runs longer than that cap. See maxDuration below.
        targetDuration: 22,
        // Hard ceiling regardless of source length or targetDuration above:
        // Instagram's own Reels limit is a few minutes, but 2 minutes keeps
        // the format tight. A source under this length is never force-cut
        // down to a fixed duration -- see MediaExecutionEngine.js
        // 'extract_short', which checks this cap, not targetDuration.
        maxDuration: 120,
        guidance: 'Reel: lead with the strongest moment, use vertical 9:16, tight cuts, bold captions, fast relevant b-roll, kinetic motion, and varied topic-matched vector illustrations.',
    },
};

export function getEditingStyle(id) {
    return EDITING_STYLES[id] || null;
}

/** Silence removal defaults for the style, or null (planner keeps its own). */
export function stylePacing(styleId) {
    return getEditingStyle(styleId)?.pacing || null;
}

/** Zoom preset named in a request ('subtle' | 'cinematic' | 'dynamic'), or null. */
export function zoomStyleFromText(text) {
    const t = String(text || '').toLowerCase();
    if (/\b(subtle|gentle|soft|calm|doux|douce|l[ée]ger|l[ée]g[eè]re)\b/.test(t)) return 'subtle';
    if (/\b(cinematic|cin[ée]matique)\b/.test(t)) return 'cinematic';
    if (/\b(punchy|aggressive|intense|percutant)\b/.test(t)) return 'dynamic';
    return null;
}

export function normalizeEditingMode(mode) {
    return mode === 'auto' ? 'auto' : 'normal';
}

// A request that only says "go": the playbook alone is the edit.
const GENERIC_REQUEST = /^(please\s+)?(edit|edit it|edit this|edit this video|edit this clip|edit the video|edit my video|edit my clip|go|start|do it|run|auto edit|make it|make the edit|fais le montage|monte la vid[eé]o|monte|vas[- ]y|lance|lance le montage|[eé]dite|[eé]dite la vid[eé]o|[eé]dite ma vid[eé]o)[\s.!]*$/i;
// A reference-guided edit is still an instruction to run the selected style's
// Auto playbook. Previously this full sentence fell through as a bespoke
// command, whose planner asked for clarification instead of editing:
// "I want to edit my video just like this reference video".
const REFERENCE_GUIDED_EDIT = /^(?:please\s+)?(?:(?:i|we)\s+(?:want|would like|need)\s+to\s+)?edit\s+(?:my|the|this|a)\s+(?:video|clip)\b.*\b(?:like|match|mimic|in the style of|based on|according to|inspired by)\b.*\b(?:reference|example|attached)\b/i;

export function isGenericEditRequest(text) {
    const s = String(text || '').split(/\n\n(?:Reference documents supplied by the user|Media attached to this request and available in the project Media Bin|Reference media supplied by the user for guidance only \(not source footage\)):/i, 1)[0].trim();
    return s === '' || GENERIC_REQUEST.test(s) || REFERENCE_GUIDED_EDIT.test(s);
}

// Questions stay normal chat even in Auto mode.
export function isQuestion(text) {
    const s = String(text || '').trim().toLowerCase();
    if (!s) return false;
    if (/\?\s*$/.test(s)) return true;
    return /^(what|why|how|who|where|when|which|can you explain|explain|describe|tell me|qu[e']|quoi|pourquoi|comment|qui|o[uù] |quand|est-ce que)/.test(s);
}

/**
 * The Auto playbook: plain prompts, each run through the normal pipeline.
 *
 * R92 round A: a SPECIFIC request in Auto mode ("animate it", "remove the
 * repetitions") runs on its own, hands-free, as one undo. Only a generic
 * request ("edit it", "do your thing") runs the style's whole playbook.
 * Before, "animate" in Auto mode also ran silences, fillers, captions and the
 * recipe, which read as "animate runs clean up".
 *
 * Order in a playbook matters:
 *  - cuts first, captions AFTER them: caption clips are placed on the timeline
 *    as it is, and a later cut does not move them;
 *  - "Clean up the video" is the full clean up: silences, filler words,
 *    repeated takes, then voice enhancement (after the cuts);
 *  - the style recipe is the single final motion pass, after cuts/captions;
 *  - Reel picks its moment from the transcript; with no transcript yet it
 *    transcribes first.
 * @param {string} styleId
 * @param {string} request what the user typed
 * @param {{hasTranscript?: boolean}} facts
 * @returns {Array<{key: string, prompt: string}>}
 */
export function buildAutopilotSteps(styleId, request, facts = {}) {
    const style = getEditingStyle(styleId);
    if (!style) return [];
    if (!isGenericEditRequest(request)) {
        const custom = String(request || '').trim();
        return custom ? [{ key: 'request', prompt: custom }] : [];
    }
    if (facts.visualOnly) {
        const sourcePrompt = facts.videoOnly
            ? 'Create a video from the uploaded video clips only'
            : 'Create a video from the uploaded images and event footage';
        const steps = [{ key: 'montage', prompt: sourcePrompt }];
        if (style.id === 'reel') steps.push({ key: 'vertical', prompt: 'Set the aspect ratio to 9:16' });
        return steps;
    }
    const steps = [];
    if (style.id === 'reel') {
        if (!facts.hasTranscript) steps.push({ key: 'transcript', prompt: 'Add captions' });
        // No fixed number: the length should follow the source video, capped
        // at maxDuration -- see EditPlanner.js/MediaExecutionEngine.js extract_short.
        steps.push({ key: 'short', prompt: 'Extract a short of the strongest moment' });
        steps.push({ key: 'vertical', prompt: 'Set the aspect ratio to 9:16' });
    }
    if (style.id === 'vlog') {
        // A vlog keeps its natural "ums": silences only, plus the voice.
        steps.push({ key: 'silences', prompt: 'Remove silences' });
        steps.push({ key: 'enhance', prompt: 'Enhance the audio' });
    } else {
        steps.push({ key: 'cleanup', prompt: 'Clean up the video' });
    }
    // Captions run after cuts for styles that use a standalone recipe. The
    // recipe is the one coordinated motion pass for Vlog/Talking Head/
    // Interview/Podcast; it owns cutaways, illustrations, graphics,
    // transitions, motion and matching sounds.
    // Reel Pro Finish owns caption generation/styling and the creative
    // treatment, so standalone caption and recipe steps would duplicate work
    // and stack competing designs over the same moments.
    if (style.id === 'reel') {
        // Names the platform explicitly: MediaExecutionEngine's polish_short
        // handler resolves the platform from the prompt text first and only
        // falls back to re-deriving it from the live editingStyle store value
        // when nothing is named (a fallback that silently defaults to
        // 'tiktok' whenever that store value isn't exactly 'reel' at the
        // moment this step executes — the last Auto step). Naming it
        // here removes that fragility for the one path that matters most.
        steps.push({
            key: 'finish',
            prompt: facts.hasStyleReference
                ? 'Pro finish for Instagram Reels. Match the attached reference video’s typography, colors, pacing, captions, graphics, motion, and transitions. Choose relevant b-roll, animated vector illustrations, and SFX for the source content. Use only source footage on the timeline; never add the reference video as footage.'
                : 'Pro finish for Instagram Reels',
        });
    } else {
        steps.push({ key: 'captions', prompt: 'Add captions' });
        steps.push({
            key: 'recipe',
            prompt: facts.hasStyleReference
                ? `Apply the ${style.recipeId} style recipe. Match the attached reference video’s typography, colors, pacing, captions, graphics, motion, and transitions. Choose relevant b-roll, animated vector illustrations, and SFX for the source content. Use only source footage on the timeline; never add the reference video as footage.`
                : `Apply the ${style.recipeId} style recipe`,
        });
    }
    return steps;
}

/** Context line for the LLM (ContextGenerator). */
export function styleContext(styleId, mode) {
    const style = getEditingStyle(styleId);
    if (!style) return null;
    return { id: style.id, mode: normalizeEditingMode(mode), guidance: style.guidance, recipe: style.recipeId, targetDurationSec: style.targetDuration, maxDurationSec: style.maxDuration };
}

export default { EDITING_STYLES, EDITING_STYLE_IDS, EDITING_MODES, getEditingStyle, stylePacing, zoomStyleFromText, normalizeEditingMode, isGenericEditRequest, isQuestion, buildAutopilotSteps, styleContext };
