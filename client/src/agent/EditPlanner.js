/**
 * EditPlanner Agent
 *
 * FIX: planViaAPI() was calling fetch('/api/ai/generate-plan', ...) without an
 *      Authorization header. In production this returned 401, so every operation
 *      that fell through to the API (complex or unrecognized operations) silently
 *      failed with "Could not generate an edit plan."
 *
 *      All fetch() calls replaced with authFetch().
 */

import { authFetch } from '../utils/authFetch.js';
import { ContextGenerator } from './ContextGenerator.js';
import useTimelineStore from '../store/useTimelineStore.js';
import { ClarificationGenerator } from './ClarificationGenerator.js';
import { normalizeTransitionType, transitionFromText } from '../motion/TransitionFX.js';
import { templateFromText } from '../motion/TemplateGraphics.js';
import { recipeFromText } from '../motion/StyleRecipes.js';
import { getEditingStyle, stylePacing, zoomStyleFromText } from './EditingStyles.js';

export const ACTIONS = {
    COMPUTE_SPLIT_TIMESTAMP: 'compute_split_timestamp',
    COMPUTE_TRIM_BOUNDS: 'compute_trim_bounds',
    COMPUTE_SEGMENT_RANGE: 'compute_segment_range',
    VALIDATE_CLIP_EXISTS: 'validate_clip_exists',
    VALIDATE_TRACK_EXISTS: 'validate_track_exists',
    GET_PLAYHEAD_POSITION: 'get_playhead_position',
    SPLIT_CLIP: 'split_clip',
    REMOVE_CLIP: 'remove_clip',
    TRIM_CLIP_START: 'trim_clip_start',
    TRIM_CLIP_END: 'trim_clip_end',
    MOVE_CLIP: 'move_clip',
    DUPLICATE_CLIP: 'duplicate_clip',
    SET_CLIP_SPEED: 'set_clip_speed',
    SET_ASPECT_RATIO: 'set_aspect_ratio',
    RIPPLE_DELETE: 'ripple_delete',
    SILENCE_REMOVAL: 'silence_removal',
    ADJUST_VOLUME: 'adjust_volume',
    MUTE_CLIP: 'mute_clip',
    UNLINK_AUDIO: 'unlink_audio',
    ADD_TRANSITION: 'add_transition',
    ADD_FILTER: 'add_filter',
    ADD_TEXT_OVERLAY: 'add_text_overlay',
    COLOR_GRADE: 'color_grade',
    PREPARE_EXPORT: 'prepare_export',
    VALIDATE_EXPORT_SETTINGS: 'validate_export_settings',
    QUEUE_EXPORT: 'queue_export',
    CREATE_SNAPSHOT: 'create_snapshot',
    COMPARE_SNAPSHOTS: 'compare_snapshots',
    UNDO_ACTION: 'undo_action',
    REDO_ACTION: 'redo_action'
};

// Words that say "grade it" but not WHICH look; what's left is the look.
const COLOR_FILLER_WORDS = new Set(['color', 'colour', 'colors', 'colours', 'grade', 'grading', 'graded',
    'apply', 'a', 'an', 'the', 'look', 'make', 'it', 'its', 'my', 'this', 'video', 'clip', 'clips',
    'footage', 'please', 'give', 'me', 'add', 'some', 'to', 'up', 'down', 'more', 'bit', 'of', 'and',
    'with', 'style', 'feel', 'vibe', 'lut', 'filter', 'can', 'you', 'go', 'for', 'into', 'like']);

/** The LUT search text for a colour-grade request ("cinematic" when none is given). */
export function colorLookQuery(constraints, originalPrompt = '') {
    const lookWords = (text) => (String(text || '').toLowerCase().match(/[a-zà-ÿ-]+/g) || [])
        .filter(w => !COLOR_FILLER_WORDS.has(w));
    // The registry's free-text `style` param can be a stray word ("add" from
    // "add a color grade"), so it is filtered the same way as the prompt.
    const explicit = lookWords(constraints?.style || constraints?.look || constraints?.query);
    if (explicit.length) return explicit.join(' ');
    const rest = lookWords(originalPrompt);
    return rest.length ? rest.join(' ') : 'cinematic';
}

import { sfxQueryFromText } from './sfxCues.js'; // R92 round A
import { stickerQueryFromText } from './stickerQuery.js'; // R97
import { zoneFromText } from './zoneQuery.js'; // R99
import { platformsFromText, shortCountFromText, autoShortCount, getPlatformProfile } from './PlatformProfiles.js'; // R92 round B
// R106 — the one-minute floor for anything presented as a "short".
import { MIN_SHORT_SECONDS } from './shortLength.js';

export class EditPlanner {

    static async generatePlan(intent, signal = null) {
        console.log('[AG_DEBUG] [EditPlanner] Generating plan for:', intent?.intent);

        if (!intent) {
            console.error('[AG_DEBUG] [EditPlanner] Error: No intent provided');
            return { success: false, error: 'No intent provided' };
        }

        if (intent.needs_clarification) {
            console.warn('[AG_DEBUG] [EditPlanner] Clarification needed:', intent.reason);
            return {
                success: true,
                status: 'clarification_needed',
                questions: intent.questions || [{ question: intent.reason || 'Could you clarify your request?', parameter: 'clarify_0', type: 'text' }],
                originalIntent: intent
            };
        }

        if (intent.confidence !== 'HIGH') {
            console.log(`[EditPlanner] Intent confidence is ${intent.confidence}. Requesting clarification.`);
            const questions = ClarificationGenerator.generate(intent);
            return {
                status: 'clarification_needed',
                missingParameters: intent.missingParameters,
                message: 'I need a few more details to proceed.',
                questions,
                originalIntent: intent
            };
        }

        const planId = this.generatePlanId();
        const state = useTimelineStore.getState();

        const durationCheck = this.validateDurationLogic(intent, state);
        if (durationCheck) {
            console.warn('[EditPlanner] Duration logic violation:', durationCheck);
            return {
                status: 'clarification_needed',
                missingParameters: [],
                message: durationCheck,
                questions: [],
                originalIntent: intent
            };
        }

        try {
            console.log(`[AG_DEBUG] [EditPlanner] Creating plan (ID: ${planId}) for operation: ${intent.operation}`);
            const plan = this.createPlan(intent, state, planId);

            if (!plan) {
                console.log('[AG_DEBUG] [EditPlanner] No local plan found, attempting API plan...');
                return await this.planViaAPI(intent, signal, planId);
            }

            console.log(`[AG_DEBUG] [EditPlanner] Plan generated successfully. Steps: ${plan.steps.length}`);
            return { success: true, plan };

        } catch (error) {
            if (error.name === 'AbortError') throw error;
            console.error('[EditPlanner] Error:', error);
            return { success: false, error: error.message };
        }
    }

    static validateDurationLogic(intent, state) {
        const { tracks, activeClipId } = state;

        let activeClip = null;
        for (const track of tracks) {
            const found = track.clips?.find(c => c.id === activeClipId);
            if (found) { activeClip = found; break; }
        }

        if (!activeClip) return null;

        const clipDuration = activeClip.duration || 0;
        // Source this clip shows: its timeline length × its speed (NOT the
        // asset's sourceDuration, which is the whole file).
        const sourceDuration = clipDuration * (Number(activeClip.speed) || 1);
        const params = intent.parameters || intent.args || {};

        if (intent.operation === 'trim_clip' || intent.operation === 'set_duration') {
            const targetDuration = params.targetDuration || params.duration;
            if (targetDuration && targetDuration > clipDuration) {
                return `The selected clip is currently ${clipDuration.toFixed(1)} seconds long, so it cannot be trimmed to ${targetDuration} seconds. Would you like to extend it using slow motion, or select a different segment?`;
            }
        }

        if (intent.operation === 'set_clip_speed') {
            const speed = params.speed;
            if (speed && speed > 0) {
                const newDuration = sourceDuration / speed;
                if (newDuration > 3600) {
                    return `Setting speed to ${speed}x would make the clip ${(newDuration / 60).toFixed(0)} minutes long. This seems unintended. Did you mean a faster speed?`;
                }
            }
        }

        return null;
    }

    static createPlan(intent, state, planId) {
        const operation = intent.operation;
        const targets = intent.targets || [];
        const constraints = intent.constraints || {};
        const trackId = intent.target_track_id;

        let clipId = targets[0];
        let clip = this.findClip(state, clipId);

        if (!clip && !clipId) {
            const firstClip = this.findFirstClip(state);
            if (firstClip) {
                clip = firstClip;
                clipId = firstClip.id;
                console.log('[EditPlanner] Auto-selected clip:', clipId);
            }
        }

        const track = this.findTrack(state, trackId || clip?.trackId);

        switch (operation) {
            case 'split_clip': return this.planSplit(planId, clip, track, constraints, state);
            case 'cut_at_playhead': return this.planCutAtPlayhead(planId, clip, track, state);
            case 'cut_at_timestamp': return this.planCutAtTimestamp(planId, clip, track, constraints);
            case 'cut_segment': return this.planCutSegment(planId, constraints);
            case 'remove_clip': return this.planRemove(planId, clipId, track);
            case 'trim_clip': return this.planTrim(planId, clip, track, constraints);
            case 'duplicate_clip': return this.planDuplicate(planId, clip, track);
            case 'set_clip_speed': return this.planSpeedChange(planId, clip, track, constraints);
            case 'set_aspect_ratio': return this.planAspectRatio(planId, constraints);
            case 'silence_removal': return this.planSilenceRemoval(planId, constraints);
            case 'remove_filler_words': return this.planFillerRemoval(planId);
            case 'audio_denoise':
            case 'denoise_audio': return this.planAudioDenoise(planId, constraints);
            case 'normalize_audio': return this.planNormalizeAudio(planId, constraints);
            case 'auto_captions': return this.planAutoCaptions(planId, constraints);
            case 'locate_visual_targets': return this.planLocateVisualTargets(planId, constraints);
            case 'apply_target_ranges': return this.planApplyTargetRanges(planId, constraints);
            case 'adjust_volume': return this.planVolumeAdjust(planId, clip, constraints);
            case 'add_transition': return this.planAddTransition(planId, clip, constraints, intent.originalPrompt);
            case 'add_filter': return this.planAddFilter(planId, clip, constraints);
            case 'add_text': return this.planAddText(planId, constraints);
            case 'color_grade': return this.planColorGrade(planId, clip, constraints, intent.originalPrompt);
            case 'export_video': return this.planExport(planId, constraints);
            case 'compare_versions': return this.planCompare(planId);
            case 'undo_action': return this.planUndo(planId);
            case 'redo_action': return this.planRedo(planId);
            case 'analyze_structure': return this.planAnalyzeStructure(planId, constraints);
            case 'long_form_edit': return this.planLongFormEdit(planId, constraints);
            case 'build_from_rushes': return this.planLongFormEdit(planId, { ...constraints, editMode: 'FULL_BUILD' });
            case 'find_hook': return this.planFindHook(planId);
            case 'place_contextual_broll': return this.planPlaceContextualBroll(planId);
            case 'fetch_stock_broll': return this.planFetchStockBroll(planId, constraints);
            case 'remove_repetition': return this.planRemoveRepetition(planId);
            case 'chat': return this.planChat(planId, intent.message);
            case 'reorder_segment': return this.planReorderSegment(planId, constraints);
            case 'reorder_clips': return this.planReorderClips(planId, constraints);
            case 'organize_clips': return this.planOrganizeClips(planId, state, constraints);
            case 'rhythm_zoom': return this.planRhythmZoom(planId, constraints, intent.originalPrompt);
            case 'crop_clip':   return this.planCropClip(planId, constraints);
            case 'sync_cutaways': {
                const txt = String(intent.originalPrompt || '').toLowerCase();
                const layout = /split|partag/.test(txt) ? 'split' : /picture in picture|\bpip\b|incrust|corner|coin/.test(txt) ? 'pip' : 'fullscreen';
                const numbersOnly = /number|price|prix|chiffre/.test(txt) && !/b ?roll|cutaway|plan de coupe|plans de coupe/.test(txt);
                return this.buildPlan(planId, 'sync_cutaways', [
                    { step_id: 'step_1', action: 'sync_cutaways', args: { layout, broll: !numbersOnly, numberPops: true }, reason: 'Place cutaways and number pops on the words' },
                ]);
            }
            case 'extract_short': {
                // R91: "a 30 second short" → 30; otherwise the style's target (Reel: 22, Instagram Reels' own 15-30s ideal).
                const m = String(intent.originalPrompt || '').match(/(\d{2,3})\s*(?:s\b|sec|second|seconde)/i);
                const activeStyle = getEditingStyle(useTimelineStore.getState().editingStyle);
                const styleTarget = activeStyle?.targetDuration;
                // R93: a style can cap how long the output is ALLOWED to be
                // (Reel: 120s, Instagram's own ceiling) without forcing every
                // short down to that number -- MediaExecutionEngine's
                // extract_short keeps the source video's own length whenever
                // it already fits under this cap, and only trims to it when
                // the source runs longer.
                const styleMax = activeStyle?.maxDuration;
                // R92 round B: "a short for TikTok" → the middle of TikTok's sweet spot.
                const named = getPlatformProfile(platformsFromText(intent.originalPrompt)[0]);
                // R106 — a short runs a minute at minimum, so the platform's
                // attention-span midpoint (TikTok's was 27 s) is no longer the
                // target. `shortForm.min` is the floor the Shorts panel uses;
                // this path trims the main edit but produces the same kind of
                // artefact, and leaving it at 27 s while the panel makes 90 s
                // would be two answers to one question.
                const platformTarget = named ? (named.shortForm?.min || MIN_SHORT_SECONDS) : null;
                // An explicit number in the request ("a 30 second short") is an
                // exact ask and wins over the floor as well as over the style's
                // cap. A minimum the user cannot override is not a default.
                const target = m
                    ? Math.min(180, Math.max(10, Number(m[1])))
                    : Math.max(MIN_SHORT_SECONDS, platformTarget || styleTarget || MIN_SHORT_SECONDS);
                const max = m ? target : Math.max(target, styleMax || target);
                return this.buildPlan(planId, 'extract_short', [
                    { step_id: 'step_1', action: 'extract_short', args: { target, max, explicit: Boolean(m) }, reason: max > target ? `Keep the strongest moment, up to ${max} s` : `Keep the strongest ${target} s as a short` },
                ]);
            }
            case 'remove_background': {
                // R92: the look comes from the words; the Background panel tunes it.
                const bg = backgroundFromText(intent.originalPrompt);
                return this.buildPlan(planId, 'remove_background', [
                    { step_id: 'step_1', action: 'remove_background', args: bg, reason: `Background: ${bg.mode}` },
                ]);
            }
            case 'zoom_speaker':
            case 'track_speaker': {
                return this.buildPlan(planId, operation, [
                    { step_id: 'step_1', action: operation, args: {}, reason: operation === 'zoom_speaker' ? 'Frame the speaker' : 'Keep the speaker framed' },
                ]);
            }
            case 'sandwich_text': {
                return this.buildPlan(planId, 'sandwich_text', [
                    { step_id: 'step_1', action: 'sandwich_text', args: {}, reason: 'Place text behind speaker in sandwich layer' },
                ]);
            }
            case 'polish_short': {
                return this.buildPlan(planId, 'polish_short', [
                    { step_id: 'step_1', action: 'polish_short', args: { brief: String(intent.originalPrompt || '').slice(0, 300) }, reason: 'Give the short a pro finish for its platform' },
                ]);
            }
            case 'repurpose_shorts': {
                // R92 round B: count and platforms come from the words.
                // R101: with no explicit count, the default scales with how
                // much video there actually is (autoShortCount) instead of a
                // flat 3, so a long upload yields real variety instead of
                // always stopping at the same three shorts.
                const text = intent.originalPrompt || '';
                const platforms = platformsFromText(text);
                const requested = shortCountFromText(text);
                const total = (useTimelineStore.getState().tracks || [])
                    .reduce((m, t) => Math.max(m, ...(t.clips || []).map(c => (Number(c.start) || 0) + (Number(c.duration) || 0))), 0);
                const count = /\b(?:one|a|1)\s+(?:for\s+)?each\b/.test(text.toLowerCase()) && platforms.length
                    ? platforms.length
                    : Math.max(requested ?? autoShortCount(total), platforms.length || 0);
                return this.buildPlan(planId, 'repurpose_shorts', [
                    { step_id: 'step_1', action: 'repurpose_shorts', args: { count, platforms }, reason: `Find ${count} short(s) for ${platforms.length ? platforms.join(', ') : 'TikTok, Reels and YouTube Shorts'}` },
                ]);
            }
            case 'enhance_audio': {
                return this.buildPlan(planId, 'enhance_audio', [
                    { step_id: 'step_1', action: 'enhance_audio', reason: 'Enhance the voice: less noise, even level, standard loudness' },
                ]);
            }
            case 'add_sticker': {
                // R97: icon/emoji insert. A literal emoji the user typed
                // wins outright; otherwise resolve a keyword against the
                // sticker library; otherwise fall back to a default glyph
                // at execution time (see MediaExecutionEngine's add_sticker).
                const parsed = stickerQueryFromText(intent.originalPrompt) || {};
                const reason = parsed.emoji
                    ? `Add the ${parsed.emoji} emoji`
                    : parsed.keyword
                        ? `Add a ${parsed.keyword} ${parsed.kind || 'icon/emoji'}`
                        : 'Add an icon or emoji';
                return this.buildPlan(planId, 'add_sticker', [
                    { step_id: 'step_1', action: 'add_sticker', args: { emoji: parsed.emoji || null, query: parsed.keyword || null, kind: parsed.kind || null }, reason },
                ]);
            }
            case 'add_sfx': {
                // R92: "add a whoosh" → that sound at the playhead; "add sound
                // effects" → sound the whole edit (transitions, pops), at the
                // level the editing style allows.
                const query = sfxQueryFromText(intent.originalPrompt) || constraints?.query || null;
                if (query) {
                    return this.buildPlan(planId, 'add_sfx', [
                        { step_id: 'step_1', action: 'place_sfx', args: { query }, reason: `Add a ${query} sound at the playhead` },
                    ]);
                }
                return this.buildPlan(planId, 'add_sfx', [
                    { step_id: 'step_1', action: 'auto_sfx', args: {}, reason: 'Add sound effects on the transitions and pops' },
                ]);
            }
            case 'compose_motion': {
                // R92: the request itself is the motion brief.
                const brief = String(intent.originalPrompt || '').slice(0, 600);
                return this.buildPlan(planId, 'compose_motion', [
                    { step_id: 'step_1', action: 'compose_motion', args: { brief }, reason: 'Write custom motion for the requested layers' },
                ]);
            }
            case 'apply_style_recipe': {
                const recipeId = recipeFromText(intent.originalPrompt)
                    // R91: "apply my style" → the recipe of the style picked under the chat box.
                    || getEditingStyle(useTimelineStore.getState().editingStyle)?.recipeId
                    || null;
                return this.buildPlan(planId, 'apply_style_recipe', [
                    { step_id: 'step_1', action: 'apply_style_recipe', args: { recipeId }, reason: recipeId ? `Apply the ${recipeId} style recipe` : 'Apply a style recipe' },
                ]);
            }
            case 'add_template': {
                // R89: kind and values come from the request ("day 14 of 30",
                // "15-20€", quoted code); defaults fill the rest.
                const tpl = templateFromText(intent.originalPrompt) || { kind: 'counter', params: {} };
                return this.buildPlan(planId, 'add_template', [
                    { step_id: 'step_1', action: 'add_template', args: tpl, reason: `Add a ${tpl.kind} template` },
                ]);
            }
            case 'set_brand_kit': {
                // The colour IS in the sentence. Hex first, then a small table
                // of names — enough to cover "make it red" without pretending
                // to be a colour parser.
                const said = String(intent.originalPrompt || '');
                const NAMED = {
                    red: '#ff3b30', orange: '#ff9500', yellow: '#ffe500', green: '#10b981',
                    teal: '#00e5ff', cyan: '#00e5ff', blue: '#2f6bff', indigo: '#5856d6',
                    purple: '#a855f7', violet: '#8a2be2', pink: '#ff3b5c', magenta: '#ff3b5c',
                    white: '#ffffff', black: '#0b0e14', gold: '#c8a96a',
                    rouge: '#ff3b30', orange_fr: '#ff9500', jaune: '#ffe500', vert: '#10b981',
                    bleu: '#2f6bff', violet_fr: '#8a2be2', rose: '#ff3b5c', noir: '#0b0e14', blanc: '#ffffff',
                };
                const hex = (said.match(/#[0-9a-fA-F]{6}\b/) || [])[0] || null;
                let named = null;
                if (!hex) {
                    const low = said.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                    for (const [word, value] of Object.entries(NAMED)) {
                        const bare = word.replace(/_fr$/, '');
                        if (new RegExp(`\\b${bare}\\b`).test(low)) { named = value; break; }
                    }
                }
                const accent = hex || named;
                return this.buildPlan(planId, 'set_brand_kit', [
                    {
                        step_id: 'step_1',
                        action: 'set_brand_kit',
                        args: { ...(accent ? { accent } : {}), said },
                        reason: accent ? `Set the brand accent to ${accent}` : 'Report what the brand kit needs',
                    },
                ]);
            }
            case 'storyboard_video': {
                // Nothing about the CONTENT is decided here: the planner reads
                // the project's own transcript and duration from the store at
                // execution time, so there is no brief to parse.
                //
                // One thing IS decided — whether to place the storyboard or
                // only show it. Dropping a dozen graphics onto someone's
                // timeline is a big edit, and "show me the storyboard" is a
                // request to look, not to act. The same command answers both;
                // a review run touches nothing.
                const asked = String(intent.originalPrompt || '').toLowerCase();
                const dryRun = /\b(show|preview|plan(?!\s+to)|what would|suggest|montre|planifie|propose)\b/.test(asked)
                    && !/\b(do it|apply|place|add them|go ahead|fais le|applique)\b/.test(asked);
                return this.buildPlan(planId, 'storyboard_video', [
                    {
                        step_id: 'step_1',
                        action: 'storyboard_video',
                        args: { dryRun },
                        reason: dryRun
                            ? 'Plan a graphic for each moment worth showing, and report the plan without changing the edit'
                            : 'Plan a graphic for each moment worth showing, across the whole video',
                    },
                ]);
            }
            case 'design_scene': {
                // The brief IS the prompt: the director reads its tone and
                // beats (motion/SceneDirector.js), so nothing is decided here
                // beyond passing the words through intact.
                const brief = String(intent.originalPrompt || intent.constraints?.brief || '').trim();
                return this.buildPlan(planId, 'design_scene', [
                    { step_id: 'step_1', action: 'design_scene', args: { brief }, reason: 'Design the graphics sequence this brief describes' },
                ]);
            }
            case 'add_motion_component': {
                const raw = String(intent.originalPrompt || '');
                const text = raw.toLowerCase();
                let component = 'TitleSequence';
                let preset = 'cinematic';
                const params = {};
                // The words to show: quoted text, or what follows "saying" / "that says" / "with the text".
                const quoted = raw.match(/["“”«]([^"“”«»]{1,80})["“”»]/);
                const said = raw.match(/\b(?:saying|that says|which says|with the text|reading|disant)\s*:?\s+(.{1,80})$/i);
                const shown = (quoted?.[1] || said?.[1] || '').trim().replace(/[.!]+$/, '');
                if (shown) params.title = shown;
                const figure = raw.match(/[+-]?[$€£]?\d[\d,.]*\s*(?:%|x|k|m|€|\$)?/i);
                if (text.includes('kinetic')) {
                    component = 'KineticTitle';
                    preset = text.includes('creator') ? 'creator' : 'punchy';
                } else if (text.includes('stat') || text.includes('metric') || text.includes('growth')) {
                    component = 'StatCallout';
                    preset = text.includes('growth') ? 'growth' : 'metric-callout';
                    if (figure) params.value = figure[0].replace(/\s+/g, '');
                    if (shown) { params.label = shown; delete params.title; }
                } else if (text.includes('lower third')) {
                    component = 'LowerThird';
                    preset = text.includes('modern') ? 'modern-line' : 'pro-minimal';
                } else {
                    component = 'TitleSequence';
                    preset = text.includes('bold') ? 'modern-bold' : text.includes('minimal') ? 'minimal' : 'cinematic';
                }
                return this.buildPlan(planId, 'add_motion_component', [
                    { step_id: 'step_1', action: 'addMotionComponent', args: { component, preset, params }, reason: `Add a ${component} (${preset}) motion component` },
                ]);
            }
            case 'layout_split_screen':       return this.planSingleStep(planId, 'layout_split_screen', 'Split screen: speaker top, b-roll bottom');
            case 'layout_picture_in_picture': return this.planSingleStep(planId, 'layout_picture_in_picture', 'Picture in picture');
            case 'layout_fullscreen':         return this.planSingleStep(planId, 'layout_fullscreen', 'Full-screen cutaway');
            case 'emphasize_keywords': return this.planSingleStep(planId, 'emphasize_keywords', 'Highlight the key word of each caption');
            case 'clear_keywords':     return this.planSingleStep(planId, 'clear_keywords', 'Remove key word highlights from the captions');
            case 'add_shadow':    return this.planSingleStep(planId, 'add_shadow', 'Add a drop shadow');
            case 'remove_shadow': return this.planSingleStep(planId, 'remove_shadow', 'Remove the drop shadow');
            case 'add_blur_zone': {
                // R99: freeform zone blur. The location (a named corner or
                // edge, optionally a size word) is parsed from the prompt;
                // a prompt naming no location at all gets the default
                // top-right corner (zoneQuery.js) rather than failing --
                // same "no keyword -> sensible default" rule add_sticker
                // (R97) established.
                const zone = zoneFromText(intent.originalPrompt);
                return this.buildPlan(planId, 'add_blur_zone', [
                    { step_id: 'step_1', action: 'add_blur_zone', args: { zone }, reason: 'Blur a zone of the frame' },
                ]);
            }
            case 'remove_blur_zone': return this.planSingleStep(planId, 'remove_blur_zone', 'Remove the blur zone');
            case 'apply_lut':      return this.planApplyLUT(planId, constraints, intent.originalPrompt);
            case 'clear_lut':      return this.planClearLUT(planId, constraints);
            case 'recommend_luts': return this.planRecommendLUTs(planId, constraints);
            case 'detect_speakers': return this.planSingleStep(planId, 'detect_speakers', 'Detect who is speaking (no timeline changes)');
            case 'detect_scene':    return this.planSingleStep(planId, 'detect_scene', 'Analyse framing and plan camera angles (no timeline changes)');
            case 'apply_angle':     return this.planSingleStep(planId, 'apply_angle', 'Apply the planned camera angles to the clips');
            case 'animate_automatically': return this.planSingleStep(planId, 'animate_automatically', 'Detect and animate the most interesting moments — reveals, punchlines, emphasis, and emotional beats');
            case 'create_video_from_script': {
                // The script IS the prompt, same pattern as design_scene's
                // brief: SceneSegmenter/createVideoFromScript reads the raw
                // text itself, nothing is decided or stripped here.
                const script = String(intent.originalPrompt || intent.constraints?.script || '').trim();
                return this.buildPlan(planId, 'create_video_from_script', [
                    { step_id: 'step_1', action: 'create_video_from_script', args: { script }, reason: 'Build a cartoonish-style video from this script using stock vectors/video/photo, with no footage needed' },
                ]);
            }
            case 'resume_failed_job': return this.planSingleStep(planId, 'resume_failed_job', 'Continue the last edit from where it stopped'); // R131
            case 'reset_crop':  return this.planResetCrop(planId);
            case 'split_speakers': return this.planSplitSpeakers(planId);
            case 'compound_clean_dynamic': return this.planCompoundCleanDynamic(planId, constraints, intent.originalPrompt);
            case 'compound_clean_virtual_multicam': return this.planCompoundCleanVirtualMulticam(planId);
            case 'compound_split_speakers_virtual_multicam': return this.planSplitSpeakersVirtualMulticam(planId);
            default:
                console.warn(`[EditPlanner] Unhandled operation: ${operation}`);
                return null;
        }
    }

    // ── Plan Generators ───────────────────────────────────────────────────────

    static planSplit(planId, clip, track, constraints, state) {
        if (!clip || !track) return this.errorPlan(planId, 'No clip selected for split');

        const steps = [];
        let stepNum = 1;

        steps.push({ step_id: `step_${stepNum++}`, action: ACTIONS.VALIDATE_CLIP_EXISTS, clip_id: clip.id, track_id: track.id });

        const mode = constraints.mode || 'midpoint';
        let timestamp = null;

        if (mode === 'timestamp' && constraints.timestamp !== undefined) {
            timestamp = constraints.timestamp;
        } else if (mode === 'playhead') {
            steps.push({ step_id: `step_${stepNum++}`, action: ACTIONS.GET_PLAYHEAD_POSITION, output: 'split_timestamp' });
        } else {
            steps.push({ step_id: `step_${stepNum++}`, action: ACTIONS.COMPUTE_SPLIT_TIMESTAMP, clip_id: clip.id, clip_start: clip.start, clip_duration: clip.duration, mode, output: 'split_timestamp' });
        }

        steps.push({ step_id: `step_${stepNum++}`, action: ACTIONS.SPLIT_CLIP, clip_id: clip.id, track_id: track.id, timestamp, use_computed: timestamp === null ? 'split_timestamp' : null });

        return this.buildPlan(planId, 'split_clip', steps);
    }

    static planCutAtPlayhead(planId, clip, track, state) {
        return this.buildPlan(planId, 'cut_at_playhead', [
            { step_id: 'step_1', action: ACTIONS.GET_PLAYHEAD_POSITION, output: 'cut_timestamp' },
            { step_id: 'step_2', action: ACTIONS.SPLIT_CLIP, clip_id: clip?.id, track_id: track?.id, use_computed: 'cut_timestamp' }
        ]);
    }

    static planCutAtTimestamp(planId, clip, track, constraints) {
        if (constraints.timestamp === undefined) return this.errorPlan(planId, 'No timestamp specified for cut');
        return this.buildPlan(planId, 'cut_at_timestamp', [
            { step_id: 'step_1', action: ACTIONS.SPLIT_CLIP, clip_id: clip?.id, track_id: track?.id, timestamp: constraints.timestamp }
        ]);
    }

    static planCutSegment(planId, constraints) {
        if (!constraints.start || !constraints.end) return this.errorPlan(planId, 'No time range specified for segment cut');
        return this.buildPlan(planId, 'cut_segment', [
            { step_id: 'step_1', action: ACTIONS.COMPUTE_SEGMENT_RANGE, start: constraints.start, end: constraints.end, output: 'segment_info' },
            { step_id: 'step_2', action: ACTIONS.SPLIT_CLIP, at_time: constraints.start, reason: 'segment_start' },
            { step_id: 'step_3', action: ACTIONS.SPLIT_CLIP, at_time: constraints.end, reason: 'segment_end' },
            { step_id: 'step_4', action: ACTIONS.REMOVE_CLIP, use_computed: 'segment_info', reason: 'remove_cut_segment' },
            { step_id: 'step_5', action: ACTIONS.RIPPLE_DELETE, at_time: constraints.start, reason: 'close_gap' }
        ]);
    }

    static planRemove(planId, clipId, track) {
        if (!clipId) return this.errorPlan(planId, 'No clip specified for removal');
        return this.buildPlan(planId, 'remove_clip', [
            { step_id: 'step_1', action: ACTIONS.VALIDATE_CLIP_EXISTS, clip_id: clipId },
            { step_id: 'step_2', action: ACTIONS.REMOVE_CLIP, clip_id: clipId, track_id: track?.id }
        ]);
    }

    static planTrim(planId, clip, track, constraints) {
        if (!clip) return this.errorPlan(planId, 'No clip selected for trim');

        let trimAmount = constraints.duration;
        if (constraints.targetDuration !== undefined) {
            trimAmount = clip.duration - constraints.targetDuration;
            if (trimAmount <= 0) return this.errorPlan(planId, `Clip is already ${clip.duration.toFixed(1)}s, cannot trim to ${constraints.targetDuration}s`);
        }

        const steps = [
            { step_id: 'step_1', action: ACTIONS.COMPUTE_TRIM_BOUNDS, clip_id: clip.id, current_start: clip.start, current_duration: clip.duration, trim_amount: trimAmount, target_duration: constraints.targetDuration, trim_from: constraints.from || 'end' }
        ];

        if (constraints.from === 'start') {
            steps.push({ step_id: 'step_2', action: ACTIONS.TRIM_CLIP_START, clip_id: clip.id, track_id: track?.id, use_computed: 'trim_bounds' });
        } else {
            steps.push({ step_id: 'step_2', action: ACTIONS.TRIM_CLIP_END, clip_id: clip.id, track_id: track?.id, use_computed: 'trim_bounds' });
        }

        return this.buildPlan(planId, 'trim_clip', steps);
    }

    static planDuplicate(planId, clip, track) {
        if (!clip) return this.errorPlan(planId, 'No clip selected to duplicate');
        return this.buildPlan(planId, 'duplicate_clip', [
            { step_id: 'step_1', action: ACTIONS.DUPLICATE_CLIP, clip_id: clip.id, track_id: track?.id, insert_after: true }
        ]);
    }

    static planSpeedChange(planId, clip, track, constraints) {
        return this.buildPlan(planId, 'set_clip_speed', [
            { step_id: 'step_1', action: ACTIONS.SET_CLIP_SPEED, clip_id: clip?.id, track_id: track?.id, speed: constraints.speed || 1.0, maintain_pitch: true }
        ]);
    }

    static planAspectRatio(planId, constraints) {
        return this.buildPlan(planId, 'set_aspect_ratio', [
            // R91: Reel style → 9:16 by default, filled with a crop on the speaker.
            { step_id: 'step_1', action: ACTIONS.SET_ASPECT_RATIO,
              ratio: constraints.ratio || (useTimelineStore.getState().editingStyle === 'reel' ? '9:16' : '16:9'),
              reframe_mode: useTimelineStore.getState().editingStyle === 'reel' ? 'face' : 'auto_center' }
        ]);
    }

    // ── Per-asset step builder ────────────────────────────────────────────────
    // Groups timeline clips by assetId so we always generate 1 step per UNIQUE
    // SOURCE FILE — not 1 step per clip. This prevents the step explosion when
    // silence removal has already segmented the timeline into hundreds of clips:
    // each clip group shares the same assetId, so they collapse back to 1 step.
    static _buildPerAssetSteps(state, action, extraFields = {}) {
        const freshTracks = state.manager?.toLegacyTracks() || state.tracks || [];
        const videoTracks = freshTracks.filter(t => t.type === 'video');
        const allClips = videoTracks
            .flatMap(t => (t.clips || []))
            .sort((a, b) => a.start - b.start);

        // Deduplicate by assetId (or sourceUrl as fallback)
        const assetMap = new Map();
        for (const clip of allClips) {
            const key = clip.assetId || clip.sourceUrl || clip.id;
            if (!assetMap.has(key)) {
                const asset = state.assets?.find(a => a.id === clip.assetId);
                assetMap.set(key, { firstClip: clip, asset });
            }
        }

        const uniqueAssets = [...assetMap.values()];
        console.log(`[EditPlanner] _buildPerAssetSteps(${action}): ${uniqueAssets.length} unique asset(s) across ${allClips.length} clip(s)`);

        // Extract GCS-relative raw path from any URL format the asset might store.
        // Handles: "raw/…", full HTTPS GCS URL, "/api/proxy/gcs-media/proxies/…" API URL.
        const toGcsRawPath = (url) => {
            if (!url) return null;
            if (url.startsWith('raw/') || url.startsWith('temp/')) return url;
            const m = url.match(/\/(raw\/[^?#]+)/);
            if (m) return m[1];
            const p = url.match(/\/api\/proxy\/gcs-media\/proxies\/([^/]+)\/([^/]+)/);
            if (p) return `raw/${p[1]}/${p[2]}`;
            return null;
        };

        return uniqueAssets.map(({ firstClip, asset }, i) => {
            const filePath = toGcsRawPath(asset?.sourceUrl)
                || toGcsRawPath(firstClip.sourceUrl)
                || toGcsRawPath(asset?.proxyUrl)
                || null;

            return {
                step_id: `step_${i + 1}`,
                action,
                ...extraFields,
                asset_id:  firstClip.assetId || null, // replace ALL clips of this asset
                file_path: filePath,                  // source file to send to backend
            };
        });
    }

    /**
     * R91: silence-removal pacing. An explicit value wins, then the editing
     * style's pacing (podcast cuts only long pauses, reel cuts tight), then
     * the long-standing default.
     */
    static _silencePacing(constraints = {}) {
        const pace = stylePacing(useTimelineStore.getState().editingStyle);
        return {
            min_duration: constraints.min_duration || pace?.minSilence || 0.5,
            padding:      constraints.padding      || pace?.padding    || 0.1,
        };
    }

    static planSilenceRemoval(planId, constraints) {
        const state = useTimelineStore.getState();
        const pace = this._silencePacing(constraints);
        const steps = this._buildPerAssetSteps(state, ACTIONS.SILENCE_REMOVAL, {
            threshold:    constraints.threshold    || '-30dB',
            min_duration: pace.min_duration,
            padding:      pace.padding,
        });

        if (steps.length === 0) {
            return this.buildPlan(planId, 'silence_removal', [
                { step_id: 'step_1', action: ACTIONS.SILENCE_REMOVAL, threshold: constraints.threshold || '-30dB', min_duration: pace.min_duration, padding: pace.padding }
            ]);
        }

        // Single asset — drop the asset_id / file_path so the executor uses the
        // simpler $uploaded_file path (avoids issues with missing proxy URLs).
        if (steps.length === 1) {
            return this.buildPlan(planId, 'silence_removal', [
                { step_id: 'step_1', action: ACTIONS.SILENCE_REMOVAL, threshold: constraints.threshold || '-30dB', min_duration: pace.min_duration, padding: pace.padding }
            ]);
        }

        return this.buildPlan(planId, 'silence_removal', steps);
    }

    static planFillerRemoval(planId) {
        const state = useTimelineStore.getState();
        const steps = this._buildPerAssetSteps(state, 'remove_filler_words');

        if (steps.length <= 1) {
            return this.buildPlan(planId, 'remove_filler_words', [{ step_id: 'step_1', action: 'remove_filler_words' }]);
        }

        return this.buildPlan(planId, 'remove_filler_words', steps);
    }

    static planAudioDenoise(planId, constraints) {
        return this.buildPlan(planId, 'denoise_audio', [{ step_id: 'step_1', action: 'denoise_audio', strength: constraints?.strength || 0.7 }]);
    }

    static planNormalizeAudio(planId, constraints) {
        return this.buildPlan(planId, 'normalize_audio', [{ step_id: 'step_1', action: 'normalize_audio', target_lufs: constraints?.target_lufs || -14 }]);
    }

    static planAutoCaptions(planId, constraints) {
        const selected = useTimelineStore.getState().selectedTimelineRange;
        const rangeStart = Number(constraints?.range_start ?? (constraints?.scope === 'range' ? selected?.start : NaN));
        const rangeEnd = Number(constraints?.range_end ?? (constraints?.scope === 'range' ? selected?.end : NaN));
        const clipId = constraints?.clip_id || null;
        return this.buildPlan(planId, 'auto_captions', [{
            step_id: 'step_1', action: 'auto_captions',
            language: constraints?.language || 'en', style: constraints?.style || 'default',
            ...(Number.isFinite(rangeStart) && Number.isFinite(rangeEnd) && rangeEnd > rangeStart
                ? { scope: 'range', range_start: rangeStart, range_end: rangeEnd }
                : clipId ? { scope: 'clip', clip_id: clipId } : {}),
        }]);
    }

    static planLocateVisualTargets(planId, constraints = {}) {
        return this.buildPlan(planId, 'locate_visual_targets', [{
            step_id: 'step_1', action: 'locate_visual_targets',
            query: String(constraints.query || '').trim(),
            ...(constraints.asset_id ? { asset_id: constraints.asset_id } : {}),
            reason: 'Search video frames for timestamped visual matches and return them for review',
        }], { requiresApproval: false });
    }

    static planApplyTargetRanges(planId, constraints = {}) {
        return this.buildPlan(planId, 'apply_target_ranges', [{
            step_id: 'step_1', action: 'apply_target_ranges',
            operation: constraints.operation === 'broll' ? 'broll' : 'cut',
            target_ids: Array.isArray(constraints.target_ids) ? constraints.target_ids : [],
            confirmed: constraints.confirmed === true,
            reason: 'Apply an explicitly confirmed edit only to reviewed target ranges',
        }], { requiresApproval: false });
    }

    static planVolumeAdjust(planId, clip, constraints) {
        return this.buildPlan(planId, 'adjust_volume', [
            { step_id: 'step_1', action: ACTIONS.ADJUST_VOLUME, clip_id: clip?.id, volume: constraints.volume, normalize: constraints.normalize || false }
        ]);
    }

    static planAddTransition(planId, clip, constraints, originalPrompt = '') {
        return this.buildPlan(planId, 'add_transition', [
            // R89: the type is resolved onto the pack here (free text → pack
            // name); "between all the clips" → every cut, else the selected clip's end.
            { step_id: 'step_1', action: ACTIONS.ADD_TRANSITION, clip_id: constraints.target === 'all' ? '$ALL_CLIPS' : clip?.id, type: normalizeTransitionType(constraints.type) || transitionFromText(constraints.type) || transitionFromText(originalPrompt) || getEditingStyle(useTimelineStore.getState().editingStyle)?.transition || 'dip', duration: constraints.duration || null, position: 'between_clips' }
        ]);
    }

    static planAddFilter(planId, clip, constraints) {
        return this.buildPlan(planId, 'add_filter', [
            { step_id: 'step_1', action: ACTIONS.ADD_FILTER, clip_id: clip?.id, filter_type: constraints.type, intensity: constraints.intensity || 0.5 }
        ]);
    }

    static planAddText(planId, constraints) {
        return this.buildPlan(planId, 'add_text', [
            { step_id: 'step_1', action: ACTIONS.ADD_TEXT_OVERLAY, text: constraints.text, position: constraints.position || 'center', duration: constraints.duration || 5.0, style: constraints.style || 'default' }
        ]);
    }

    /**
     * "color grade", "make it cinematic", "warm it up" → a LUT look from the
     * LUT library, applied to every video clip. The old step wrote
     * brightness/contrast/saturation/temperature (all undefined for typed
     * requests, and `saturation`/`temperature` are keys nothing reads) into
     * ONE clip's grading, which the export never applies anyway: only the
     * project LUT reaches the exported video. apply_lut sets per-clip grading
     * for the preview AND projectLUTId for the export.
     */
    static planColorGrade(planId, clip, constraints, originalPrompt = '') {
        const query = colorLookQuery(constraints, originalPrompt);
        return this.buildPlan(planId, 'color_grade', [
            {
                step_id: 'step_1',
                action: 'apply_lut',
                lut_id: constraints?.lutId || constraints?.lut_id || null,
                query,
                apply_to_all: false,
                reason: `Apply a "${query}" colour look to the video`,
            }
        ]);
    }

    static planExport(planId, constraints) {
        return this.buildPlan(planId, 'export_video', [
            { step_id: 'step_1', action: ACTIONS.VALIDATE_EXPORT_SETTINGS, format: constraints.format || 'mp4', quality: constraints.quality || '1080p' },
            { step_id: 'step_2', action: ACTIONS.PREPARE_EXPORT, format: constraints.format || 'mp4', quality: constraints.quality || '1080p', codec: 'h264', audio_codec: 'aac' },
            { step_id: 'step_3', action: ACTIONS.QUEUE_EXPORT }
        ]);
    }

    static planCompare(planId) {
        return this.buildPlan(planId, 'compare_versions', [
            { step_id: 'step_1', action: ACTIONS.CREATE_SNAPSHOT, snapshot_type: 'current_state' },
            { step_id: 'step_2', action: ACTIONS.COMPARE_SNAPSHOTS, compare_mode: 'side_by_side' }
        ]);
    }

    static planUndo(planId) {
        return this.buildPlan(planId, 'undo', [{ step_id: 'step_1', action: ACTIONS.UNDO_ACTION }]);
    }

    static planRedo(planId) {
        return {
            plan_id: planId, operation: 'redo', step_count: 1, requiresApproval: false,
            steps: [{ step_id: 'step_1', action: 'redo_action' }]
        };
    }

    static planChat(planId, message) {
        return {
            plan_id: planId, operation: 'chat', step_count: 1, requiresApproval: false,
            steps: [{ step_id: 'step_1', action: 'chat', message: message || 'I am here to help.' }]
        };
    }

    static planAnalyzeStructure(planId, constraints) {
        return {
            plan_id: planId, operation: 'analyze_structure', step_count: 1, requiresApproval: true,
            steps: [{ step_id: 'step_1', action: 'analyze_structure', platform: constraints?.platform || null, targetDuration: constraints?.targetDuration || null, reason: 'Semantic content analysis — results will be shown for approval before any edits are made' }]
        };
    }

    static planLongFormEdit(planId, constraints) {
        const editMode = constraints?.editMode || 'CLEAN_EDIT';
        const actions   = constraints?.actions || [];

        // CLEAN_EDIT = "clean up" / "remove silences" / "remove filler" type requests.
        // Route to direct operations instead of the long_form_edit VideoEditorTool,
        // which requires ContentAnalyzer (a 30-60 s GPT-4 call) and can timeout on
        // long videos. Direct ops are faster, more reliable, and produce correct results.
        if (editMode === 'CLEAN_EDIT') {
            const state = useTimelineStore.getState();
            const steps = [];

            // Silence removal is always included for CLEAN_EDIT.
            // Use per-asset steps so a timeline that was already segmented by a
            // previous silence removal doesn't explode into N×assets steps.
            const wantsSilence = actions.length === 0 || actions.some(a =>
                a === 'silence_removal' || a === 'remove_silences');
            if (wantsSilence) {
                const pace = this._silencePacing(constraints);
                const silenceSteps = this._buildPerAssetSteps(state, 'silence_removal', {
                    threshold: '-30dB', min_duration: pace.min_duration, padding: pace.padding,
                    reason: 'Remove dead air and long pauses',
                });
                // Single asset: omit asset_id / file_path (use $uploaded_file fallback)
                if (silenceSteps.length <= 1) {
                    steps.push({ step_id: `step_${steps.length + 1}`, action: 'silence_removal', threshold: '-30dB', min_duration: pace.min_duration, padding: pace.padding, reason: 'Remove dead air and long pauses' });
                } else {
                    silenceSteps.forEach(s => { s.step_id = `step_${steps.length + 1}`; steps.push(s); });
                }
            }

            // Filler removal — always include unless only pacing was requested
            const wantsFiller = actions.length === 0 || actions.some(a =>
                a === 'remove_filler_words' || a === 'filler');
            if (wantsFiller) {
                const fillerSteps = this._buildPerAssetSteps(state, 'remove_filler_words', {
                    reason: 'Remove ums, uhs, and filler phrases',
                });
                if (fillerSteps.length <= 1) {
                    steps.push({ step_id: `step_${steps.length + 1}`, action: 'remove_filler_words', reason: 'Remove ums, uhs, and filler phrases' });
                } else {
                    fillerSteps.forEach(s => { s.step_id = `step_${steps.length + 1}`; steps.push(s); });
                }
            }

            // Repeated takes / false starts — part of a full "clean up"
            // (asked explicitly, or no specific action list). Optional: a
            // video with no re-takes must not fail the whole clean-up.
            const wantsRepetition = actions.length === 0 || actions.some(a =>
                a === 'remove_repetition' || a === 'remove_repeated_takes');
            if (wantsRepetition) {
                // FIRST: you review the retakes before anything else is cut,
                // and they are detected on the untouched recording.
                steps.unshift({
                    step_id: 'step_0',
                    action: 'remove_repeated_takes',
                    lookback_window: 60,
                    similarity_threshold: 0.72,
                    optional: true,
                    reason: 'Remove repeated takes and false starts, keeping the best take',
                });
            }

            // R92: a full "clean up" also enhances the voice (denoise, level,
            // loudness). LAST, after every cut, and optional: a missing source
            // file must not fail the cuts already made.
            const wantsEnhance = actions.length === 0 || actions.some(a => a === 'enhance_audio');
            if (wantsEnhance) {
                steps.push({ step_id: 'step_x', action: 'enhance_audio', optional: true, reason: 'Enhance the voice: less noise, even level, standard loudness' });
            }

            steps.forEach((st, n) => { st.step_id = `step_${n + 1}`; });
            return {
                plan_id: planId,
                operation: 'long_form_edit',
                step_count: steps.length,
                requiresApproval: true,
                steps,
            };
        }

        // SMART_CLEANUP — semantic pass on existing timeline clips.
        // Uses the transcript + GPT-4o to remove false starts, word-level
        // repetitions, and non-speech content. Does NOT restructure the video.
        if (editMode === 'SMART_CLEANUP') {
            return {
                plan_id: planId,
                operation: 'long_form_edit',
                step_count: 1,
                requiresApproval: true,
                approvalMessage: 'The AI will analyze the transcript of each segment and remove repetitions, false starts, and non-speech content. The overall flow and meaning will be preserved.',
                steps: [{
                    step_id: 'step_1',
                    action: 'smart_cleanup',
                    reason: 'Semantic cleanup — remove repetitions, false starts, and non-speech while preserving natural flow',
                }],
            };
        }

        // FULL_BUILD / YOUTUBE_OPTIMIZED — keep the full ContentAnalyzer pipeline
        return {
            plan_id: planId,
            operation: 'long_form_edit',
            step_count: 1,
            requiresApproval: true,
            constraints: constraints || {},
            steps: [{
                step_id: 'step_1',
                action: 'long_form_edit',
                editMode,
                platform: constraints?.platform || null,
                targetDuration: constraints?.targetDuration || null,
                // R124: carried from IntentParser.validateAndNormalize() (via
                // CaptionBriefParser) all the way through to
                // LongFormEditPlanner, so a creative brief's caption
                // instructions actually reach execution instead of being
                // dropped at this step boundary.
                captionBrief: constraints?.captionBrief || null,
                visualBrief: constraints?.visualBrief || null, // R125
                reason: `Full ${editMode} edit — content analysis + structural rebuild`,
            }],
        };
    }

    static planFindHook(planId) {
        return {
            plan_id: planId, operation: 'find_hook', step_count: 1, requiresApproval: true,
            steps: [{ step_id: 'step_1', action: 'find_hook', reason: 'Scan content analysis for the highest-energy opening segment' }]
        };
    }

    // Matches b-roll clips already on the timeline to moments in the spoken
    // dialogue using each clip's already-computed visual content profile
    // (VisualAnalyzer, via GET /api/brain/broll-profiles) against word-level
    // transcript timestamps — no new LLM call. Gated by the same
    // requiresApproval:true → EditJobManager approval-dialog mechanism every
    // other real-edit ANALYZE operation here uses (find_hook, analyze_structure).
    // "find stock footage of X" — a single fetch_stock_broll step carrying
    // the search query through to VideoEditorTools.fetchStockBroll, which
    // calls services/PexelsService.js (via /api/stock/search) and drops the
    // result on a B-Roll track. Distinct from place_contextual_broll below,
    // which only matches footage ALREADY in the project.
    static planFetchStockBroll(planId, constraints) {
        const query = String(constraints?.query || '').trim();
        return {
            plan_id: planId, operation: 'fetch_stock_broll', step_count: 1, requiresApproval: false,
            steps: [{
                step_id: 'step_1',
                action: 'fetch_stock_broll',
                query,
                reason: query ? `Search Pexels stock footage for "${query}" and add it as b-roll` : 'Search Pexels stock footage',
            }],
        };
    }

    static planPlaceContextualBroll(planId) {
        return {
            plan_id: planId, operation: 'place_contextual_broll', step_count: 1, requiresApproval: true,
            steps: [{ step_id: 'step_1', action: 'place_contextual_broll', reason: 'Match b-roll (video and images, on the timeline or still in the media bin) to spoken dialogue and chapter transitions using their stored visual content profile' }]
        };
    }

    // Routes to `remove_repeated_takes`, NOT the legacy `remove_repetition`
    // action, which was a guaranteed no-op that still reported success:
    // it delegated to VideoEditorTools.removeRepetition(), which filters
    // ContentAnalyzer segments by `importance_score < 0.3 || type === 'filler'`.
    // ContentAnalyzer falls back to _localAnalysis() whenever the backend call
    // fails OR there's no transcript, and that fallback hardcodes EVERY segment
    // to `importance_score: 0.5, type: VALUE` — so the filter matched nothing,
    // 100% of the time, and the tool returned `success: true` with
    // "Removed 0 low-value segment(s)". That's the "said complete, changed
    // nothing" symptom. It was also clip-granular (it can only delete whole
    // clips), so on a single unsplit clip it had nothing it could ever remove.
    //
    // `remove_repeated_takes` is the real implementation and was already fully
    // built but unreachable — nothing routed to it. It hits
    // POST /api/ai/detect-repeated-takes (embedding similarity scan → GPT-4o
    // arbitration over which take to keep) and returns `activeSegments`, the
    // same shape silence/filler removal produce, so it flows through
    // _applySegmentsToTimeline and re-segments a single source clip into kept
    // pieces — the pipeline the user's own logs prove works.
    static planRemoveRepetition(planId) {
        return {
            plan_id: planId, operation: 'remove_repetition', step_count: 1, requiresApproval: true,
            steps: [{
                step_id: 'step_1',
                action: 'remove_repeated_takes',
                lookback_window: 60,
                similarity_threshold: 0.72,
                reason: 'Detect repeated takes / restated points in the transcript and cut the weaker version',
            }]
        };
    }

    static planReorderClips(planId, constraints) {
        const prompt = constraints?.prompt || constraints?.userPrompt || 'reorganize for better flow';
        return {
            plan_id: planId,
            operation: 'reorder_clips',
            step_count: 1,
            requiresApproval: true,
            approvalMessage: `AI will semantically reorder your clips: "${prompt}"`,
            steps: [{
                step_id: 'step_1',
                action:  'reorder_clips',
                prompt,
                reason:  'Reorder clips based on transcript content and user intent',
            }],
        };
    }

    static planReorderSegment(planId, constraints) {
        if (!constraints?.clipId && !constraints?.segmentIndex) return this.errorPlan(planId, 'No segment specified for reorder');
        return {
            plan_id: planId, operation: 'reorder_segment', step_count: 1, requiresApproval: true,
            steps: [{ step_id: 'step_1', action: 'reorder_segment', clip_id: constraints.clipId, track_id: constraints.trackId, target_position: constraints.targetPosition ?? 0, reason: constraints.reason || 'Reorder segment for narrative structure' }]
        };
    }

    /**
     * Atomic spatial crop. One step, no bundled behaviour — it composes with
     * angles and zoom rhythm rather than replacing them (see R23).
     */
    /**
     * Generic one-step plan. Atomic commands (R23) are all shaped the same way —
     * a single action with no bundled stages — so they don't each need a bespoke
     * planner function.
     */
    static planSingleStep(planId, action, reason) {
        return this.buildPlan(planId, action, [
            { step_id: 'step_1', action, reason }
        ]);
    }

    static planCropClip(planId, constraints) {
        const amount  = constraints?.amount  ?? 1.5;
        const speaker = constraints?.speaker ?? null;
        return this.buildPlan(planId, 'crop_clip', [
            {
                step_id: 'step_1',
                action:  'crop_clip',
                amount,
                speaker,
                reason: speaker
                    ? `Crop to ${Math.round(amount * 100)}% where ${speaker} is speaking`
                    : `Crop to ${Math.round(amount * 100)}%`,
            }
        ]);
    }

    static planResetCrop(planId) {
        return this.buildPlan(planId, 'reset_crop', [
            { step_id: 'step_1', action: 'reset_crop', reason: 'Clear crop back to the full frame' }
        ]);
    }

    static planApplyLUT(planId, constraints, originalPrompt = '') {
        const lutId       = constraints?.lutId || constraints?.lut_id || null;
        // "apply a lut" with no description used to compile to nothing (a
        // validation error, no edit). Same default look as colour grade.
        const query       = constraints?.query || (lutId ? '' : colorLookQuery(constraints, originalPrompt));
        const applyToAll  = constraints?.target === 'all';
        return this.buildPlan(planId, 'apply_lut', [
            {
                step_id: 'step_1',
                action:  'apply_lut',
                lut_id:  lutId,
                query,
                apply_to_all: applyToAll,
                reason: query
                    ? `Apply a LUT matching: "${query}"${applyToAll ? ' (all clips)' : ''}`
                    : `Apply LUT${lutId ? `: ${lutId}` : ''}${applyToAll ? ' (all clips)' : ''}`,
            }
        ]);
    }

    static planClearLUT(planId, constraints) {
        const applyToAll = constraints?.target === 'all';
        return this.buildPlan(planId, 'clear_lut', [
            {
                step_id: 'step_1',
                action:  'clear_lut',
                apply_to_all: applyToAll,
                reason: `Clear LUT${applyToAll ? ' (all clips)' : ''}`,
            }
        ]);
    }

    static planRecommendLUTs(planId, constraints) {
        const limit = constraints?.limit || 3;
        return this.buildPlan(planId, 'recommend_luts', [
            {
                step_id: 'step_1',
                action:  'recommend_luts',
                limit,
                reason: 'Fetch LUT recommendations based on the current project',
            }
        ]);
    }

    static planRhythmZoom(planId, constraints, originalPrompt = '') {
        // R91: a preset named in the request wins, then the editing style's, then 'dynamic'.
        const style = constraints?.style || zoomStyleFromText(originalPrompt)
            || getEditingStyle(useTimelineStore.getState().editingStyle)?.rhythmZoom || 'dynamic';
        return this.buildPlan(planId, 'rhythm_zoom', [
            {
                step_id: 'step_1',
                action: 'rhythm_zoom',
                style,
                reason: `Add dynamic zoom rhythm — ${style} style`,
            }
        ]);
    }

    static planSplitSpeakers(planId) {
        return this.buildPlan(planId, 'split_speakers', [
            {
                step_id: 'step_1',
                action: 'split_speakers',
                language: null,
                reason: 'Separate speaker tracks using diarization',
            }
        ]);
    }

    /**
     * Compound: clean up silences + filler words, then add zoom rhythm.
     * Runs as a two-step plan so both execute sequentially.
     */
    static planCompoundCleanDynamic(planId, constraints, originalPrompt = '') {
        // R91: the editing style's zoom preset and pacing when none is named.
        const style = constraints?.style || zoomStyleFromText(originalPrompt)
            || getEditingStyle(useTimelineStore.getState().editingStyle)?.rhythmZoom || 'dynamic';
        const pace = this._silencePacing(constraints || {});
        return this.buildPlan(planId, 'compound_clean_dynamic', [
            {
                step_id: 'step_1',
                action: 'silence_removal',
                threshold: '-30dB',
                min_duration: pace.min_duration,
                padding: pace.padding,
                reason: 'Remove silences',
            },
            {
                step_id: 'step_2',
                action: 'rhythm_zoom',
                style,
                reason: `Add dynamic zoom rhythm — ${style} style`,
            },
        ]);
    }

    /**
     * Compound: remove silences first, then apply virtual multicam close-up angles.
     */
    static planCompoundCleanVirtualMulticam(planId) {
        const pace = this._silencePacing({});
        return this.buildPlan(planId, 'compound_clean_virtual_multicam', [
            {
                step_id: 'step_1',
                action: 'silence_removal',
                threshold: '-30dB',
                min_duration: pace.min_duration,
                padding: pace.padding,
                reason: 'Remove silences to create clean clip segments',
            },
            {
                step_id: 'step_2',
                action: 'virtual_multicam',
                reason: 'Apply virtual multicam close-up angles using diarization',
            },
        ]);
    }

    /**
     * Compound: diarize + split speakers onto separate tracks, then apply
     * virtual multicam close-up angles driven by speaker turns.
     * "split speakers and add multicam" → this plan.
     */
    static planSplitSpeakersVirtualMulticam(planId) {
        return this.buildPlan(planId, 'compound_split_speakers_virtual_multicam', [
            {
                step_id: 'step_1',
                action: 'split_speakers',
                language: null,
                reason: 'Separate speakers onto individual tracks using diarization',
            },
            {
                step_id: 'step_2',
                action: 'virtual_multicam',
                reason: 'Apply virtual multicam close-up angles — zooming in on whichever speaker is active',
            },
        ]);
    }

    static planOrganizeClips(planId, state, constraints) {
        // Collect all video clips across all video tracks with their track id
        const videoTracks = (state.tracks || []).filter(t => t.type === 'video');
        const allClips = videoTracks.flatMap(t => (t.clips || []).map(c => ({ ...c, trackId: t.id })));

        if (allClips.length === 0) {
            return this.planChat(planId, 'The timeline has no video clips to organize. Please add your clips first.');
        }
        if (allClips.length === 1) {
            return this.planChat(planId, 'There is only one clip on the timeline — nothing to separate into b-roll.');
        }

        // Sort descending by duration; longest = main clip
        const sorted = [...allClips].sort((a, b) => (b.duration || 0) - (a.duration || 0));
        const mainClip = sorted[0];
        const brollClips = sorted.slice(1);

        // Re-use an existing secondary video track, or mark one for creation
        const secondaryTrack = videoTracks.find(t => t.id !== mainClip.trackId);
        const brollTrackId = secondaryTrack?.id || `track-broll-${planId}`;

        const steps = [];

        if (!secondaryTrack) {
            steps.push({
                step_id: 'step_create_broll',
                action: 'create_broll_track',
                track_id: brollTrackId,
                reason: 'Create a B-Roll track for secondary footage',
            });
        }

        brollClips.forEach((clip, i) => {
            steps.push({
                step_id: `step_move_${i + 1}`,
                action: 'move_clip_to_track',
                clip_id: clip.id,
                from_track_id: clip.trackId,
                to_track_id: brollTrackId,
                reason: `Move "${clip.name || clip.id}" (${(clip.duration || 0).toFixed(1)}s) to B-Roll`,
            });
        });

        return {
            plan_id: planId,
            operation: 'organize_clips',
            step_count: steps.length,
            requiresApproval: false,
            steps,
        };
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    static buildPlan(planId, operation, steps, options = {}) {
        return { plan_id: planId, operation, step_count: steps.length, ...options, steps };
    }

    static errorPlan(planId, error) {
        return { plan_id: planId, operation: 'error', error, steps: [] };
    }

    static generatePlanId() {
        return `plan_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    }

    static findClip(state, clipId) {
        if (!clipId) return null;
        for (const track of state.tracks || []) {
            const clip = track.clips?.find(c => c.id === clipId);
            if (clip) return { ...clip, trackId: track.id };
        }
        return null;
    }

    static findTrack(state, trackId) {
        if (!trackId) return null;
        return state.tracks?.find(t => t.id === trackId) || null;
    }

    static findFirstClip(state) {
        for (const track of state.tracks || []) {
            if (track.clips && track.clips.length > 0) {
                return { ...track.clips[0], trackId: track.id };
            }
        }
        return null;
    }

    /**
     * Call API for complex planning
     * FIX: was fetch('/api/ai/generate-plan', ...) — no auth → 401 in production
     */
    static async planViaAPI(intent, signal, planId) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        if (signal) {
            signal.addEventListener('abort', () => controller.abort());
        }

        try {
            const context = ContextGenerator.getTimelineContext();

            // FIX: replaced fetch() with authFetch()
            const response = await authFetch('/api/ai/generate-plan', {
                method: 'POST',
                body: JSON.stringify({ intent, context }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                return { success: false, error: 'API planning failed' };
            }

            const result = await response.json();
            return {
                success: true,
                plan: { plan_id: planId, ...result.plan }
            };

        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') throw error;
            return { success: false, error: error.message };
        }
    }
}

export default EditPlanner;

/**
 * R92: read the wanted background look from a request.
 * "blur" → blur; "dim/darken" → dim; "green screen" / a colour → color;
 * plain "remove" → a dark backdrop (an mp4 cannot be transparent).
 */
export function backgroundFromText(text) {
    const s = String(text || '').toLowerCase();
    const all = /\b(all|every|each)\b|\btous\b|\btoutes\b/.test(s);
    const hex = (s.match(/#[0-9a-f]{6}\b/) || [])[0];
    const COLORS = { black: '#000000', noir: '#000000', white: '#ffffff', blanc: '#ffffff', green: '#00b140', vert: '#00b140',
        blue: '#1e40ff', bleu: '#1e40ff', grey: '#3a3a40', gray: '#3a3a40', gris: '#3a3a40', red: '#d1202f', rouge: '#d1202f',
        yellow: '#ffd400', jaune: '#ffd400', pink: '#ff4fa3', rose: '#ff4fa3', purple: '#7b2cbf', violet: '#7b2cbf' };
    const named = Object.keys(COLORS).find(k => new RegExp(`\\b${k}\\b`).test(s));

    let reveal = 'none';
    if (/rack focus/.test(s)) reveal = 'rack-focus';
    else if (/focus pull/.test(s)) reveal = 'focus-pull';
    else if (/dim spotlight|spotlight/.test(s)) reveal = 'dim-spotlight';
    else if (/flash reveal|flash/.test(s)) reveal = 'flash-reveal';
    else if (/zoom drift|drift/.test(s)) reveal = 'zoom-drift';

    const res = { mode: 'blur', all };
    if (reveal !== 'none') res.reveal = reveal;

    if (/green screen|chroma/.test(s)) { res.mode = 'color'; res.color = '#00b140'; return res; }
    if (hex || named) { res.mode = 'color'; res.color = hex || COLORS[named]; return res; }
    if (/\bdim\b|darken|assombri/.test(s) || reveal === 'dim-spotlight') { res.mode = 'dim'; return res; }
    if (/blur|flou|floute/.test(s) || reveal === 'rack-focus' || reveal === 'focus-pull') { res.mode = 'blur'; return res; }
    if (/remove|cut out|enleve|supprime|replace|remplace|change/.test(s)) { res.mode = 'color'; res.color = '#101014'; return res; }
    return res;
}
