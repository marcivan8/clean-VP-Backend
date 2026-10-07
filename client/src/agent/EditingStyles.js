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
        guidance: 'Vlog: keep the story in chronological order, tighten pauses without removing every breath, cut to b-roll on what is being described, light upbeat energy.',
    },
    talking_head: {
        id: 'talking_head',
        // Silence removal: shortest pause that gets cut, and breathing room kept around speech.
        pacing: { minSilence: 0.35, padding: 0.05 },
        recipeId: 'punchy',
        rhythmZoom: 'dynamic',
        transition: 'flash',
        targetDuration: null,
        guidance: 'Talking head: one speaker to camera. Cut silences and filler tightly, keep a fast rhythm with punch-in zooms, bold captions with key words.',
    },
    interview: {
        id: 'interview',
        // Silence removal: shortest pause that gets cut, and breathing room kept around speech.
        pacing: { minSilence: 0.7, padding: 0.15 },
        recipeId: 'explainer',
        rhythmZoom: 'subtle',
        transition: 'dip',
        targetDuration: null,
        guidance: 'Interview: two or more speakers. Keep questions and answers intact, never cut a speaker mid-sentence, switch angle on the active speaker, clean captions.',
    },
    podcast: {
        id: 'podcast',
        // Silence removal: shortest pause that gets cut, and breathing room kept around speech.
        pacing: { minSilence: 0.8, padding: 0.15 },
        recipeId: 'podcast',
        rhythmZoom: 'subtle',
        transition: 'dip',
        targetDuration: null,
        guidance: 'Podcast: long conversation. Remove dead air and filler but keep the natural flow, clear audio, readable captions, calm gentle zooms, no flashy effects.',
    },
    reel: {
        id: 'reel',
        // Silence removal: shortest pause that gets cut, and breathing room kept around speech.
        pacing: { minSilence: 0.3, padding: 0.05 },
        recipeId: 'punchy',
        rhythmZoom: 'dynamic',
        transition: 'whip-left',
        targetDuration: 60,
        guidance: 'Reel: short social cut, often repurposed from a longer video. Strongest moment first (hook in the first 2 seconds), 15 to 60 seconds, vertical 9:16, very tight cuts, bold captions.',
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
const GENERIC_REQUEST = /^(please\s+)?(edit|edit it|edit this|edit the video|edit my video|go|start|do it|run|auto edit|make it|make the edit|fais le montage|monte la vid[eé]o|monte|vas[- ]y|lance|lance le montage|[eé]dite|[eé]dite la vid[eé]o)[\s.!]*$/i;

export function isGenericEditRequest(text) {
    const s = String(text || '').trim();
    return s === '' || GENERIC_REQUEST.test(s);
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
 *  - animation last, so its moments and sound effects land on the final cut;
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
    const steps = [];
    if (style.id === 'reel') {
        if (!facts.hasTranscript) steps.push({ key: 'transcript', prompt: 'Add captions' });
        steps.push({ key: 'short', prompt: `Extract a short of ${style.targetDuration} seconds` });
        steps.push({ key: 'vertical', prompt: 'Set the aspect ratio to 9:16' });
    }
    if (style.id === 'vlog') {
        // A vlog keeps its natural "ums": silences only, plus the voice.
        steps.push({ key: 'silences', prompt: 'Remove silences' });
        steps.push({ key: 'enhance', prompt: 'Enhance the audio' });
    } else {
        steps.push({ key: 'cleanup', prompt: 'Clean up the video' });
    }
    steps.push({ key: 'captions', prompt: 'Add captions' });
    steps.push({ key: 'recipe', prompt: `Apply the ${style.recipeId} style recipe` });
    // Motion + sound effects: not for the calm styles. A Reel gets the full
    // pro short finish (R92 round C: hook title, platform captions, camera
    // punch-ins, pops, transitions, sounds) instead of the generic animation.
    if (style.id === 'reel') {
        steps.push({ key: 'finish', prompt: 'Pro finish' });
    } else if (style.id === 'vlog' || style.id === 'talking_head') {
        steps.push({ key: 'animate', prompt: 'Animate automatically' });
    }
    return steps;
}

/** Context line for the LLM (ContextGenerator). */
export function styleContext(styleId, mode) {
    const style = getEditingStyle(styleId);
    if (!style) return null;
    return { id: style.id, mode: normalizeEditingMode(mode), guidance: style.guidance, recipe: style.recipeId, targetDurationSec: style.targetDuration };
}

export default { EDITING_STYLES, EDITING_STYLE_IDS, EDITING_MODES, getEditingStyle, stylePacing, zoomStyleFromText, normalizeEditingMode, isGenericEditRequest, isQuestion, buildAutopilotSteps, styleContext };
