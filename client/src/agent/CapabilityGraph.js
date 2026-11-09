/**
 * client/src/agent/CapabilityGraph.js
 *
 * Makes CommandRegistry's `requires` metadata REAL, and adds the `provides`
 * half that was missing.
 *
 * WHY THIS EXISTS
 * ---------------
 * CommandRegistry declared `requires: ['transcript']` on five commands and
 * `requires: ['diarization']` on two — and nothing in the codebase ever read
 * it. A grep for consumers returns the registry itself and nothing else. So
 * preconditions were only ever discovered at EXECUTION time, inside
 * MediaExecutionEngine, which means nothing upstream could answer the two
 * questions every planning decision needs:
 *
 *     1. Can this command do its job right now?
 *     2. If not, what has to run first?
 *
 * Without (2) there is no way to order a multi-step plan from first
 * principles, which is why StyleAutopilot carries a hardcoded step list per
 * editing style and SuggestionEngine carries hand-assigned priority integers.
 *
 * This module answers both from declared data:
 *   - RESOURCES   — the state facts commands consume and produce
 *   - CAPABILITIES— per-command { requires, prefers, provides }
 *   - deriveResources() — which resources the live project actually has
 *   - isEligible() / missingRequirements() — question (1)
 *   - planFor() — question (2): a prerequisite-complete, correctly ordered plan
 *
 * SCOPE — PLANNING ONLY (deliberate)
 * ----------------------------------
 * Nothing here gates execution. MediaExecutionEngine keeps its own runtime
 * checks and remains the authority on what actually runs; a graph that vetoed
 * commands would change the behaviour of every existing flow at once. This
 * layer informs planners and the Editorial Brain's capability catalogue. Its
 * job is to be RIGHT about ordering, not to be in the way.
 *
 * SINGLE SOURCE OF TRUTH
 * ----------------------
 * `requires` stays declared in CommandRegistry where its header says command
 * metadata lives. CAPABILITIES below MERGES with it (union, never override),
 * and test_capability_graph.mjs asserts:
 *   - every registry command is covered here
 *   - nothing here references a command that does not exist
 *   - no entry contradicts the registry's own `requires`
 * so the two can never silently drift apart.
 */

import { COMMANDS, COMMAND_BY_ID, expandMacro } from './CommandRegistry.js';

/**
 * The resource vocabulary: state facts that commands consume and produce.
 * Every one of these is DERIVABLE from the live store — see deriveResources().
 * A resource nothing can detect would make eligibility a guess, so there are
 * deliberately none of those here.
 */
export const RESOURCES = Object.freeze({
    CLIPS:            'clips',            // at least one clip on a video track
    ASSETS:           'assets',           // at least one video/image asset in the bin
    TRANSCRIPT:       'transcript',       // word-level transcript available
    CAPTION_CLIPS:    'captionClips',     // caption clips placed on a text track
    DIARIZATION:      'diarization',      // speaker map / per-asset diarization
    SCENE_ANALYSIS:   'sceneAnalysis',    // vision pass (faces, framing) done
    SELECTION:        'selection',        // at least one clip selected
    COLOR_GRADE:      'colorGrade',       // a LUT or per-clip grading applied
    KEYWORD_EMPHASIS: 'keywordEmphasis',  // key words highlighted on captions
    SHADOW:           'shadow',           // at least one clip carries a drop shadow
    BLUR_ZONE:        'blurZone',         // at least one clip carries a zone blur
    BRAND_KIT:        'brandKit',         // a brand kit is stored on the project
    HISTORY:          'history',          // there is something to undo
});

const R = RESOURCES;

/**
 * Per-command capability contract.
 *
 *   requires — hard: without it the command cannot do the job it advertises.
 *              An unmet requirement is a planning error, not a style choice.
 *   prefers  — soft: the command runs, but does measurably better work with
 *              it. Never blocks; surfaces as an optional upgrade step.
 *   provides — resources that exist after it succeeds. This is what makes
 *              prerequisite ordering derivable instead of hardcoded.
 *
 * Macros declare nothing: their contract is COMPUTED from their expansion by
 * macroContract() below, so a macro can never fall out of step with the atomic
 * commands it is sugar for.
 */
export const CAPABILITIES = Object.freeze({
    // ── Cleanup / cutting ────────────────────────────────────────────────────
    silence_removal:     { requires: [R.CLIPS, R.TRANSCRIPT] },
    remove_filler_words: { requires: [R.CLIPS, R.TRANSCRIPT] },
    remove_repetition:   { requires: [R.CLIPS, R.TRANSCRIPT] },
    split_by_speaker:    { requires: [R.CLIPS, R.DIARIZATION] },
    extract_short:       { requires: [R.CLIPS, R.TRANSCRIPT] },
    repurpose_shorts:    { requires: [R.CLIPS, R.TRANSCRIPT] },
    sync_cutaways:       { requires: [R.CLIPS, R.TRANSCRIPT], prefers: [R.ASSETS, R.SCENE_ANALYSIS] },

    // Build the timeline from nothing / from the bin.
    create_video_from_assets: { requires: [R.ASSETS], provides: [R.CLIPS] },
    // Script-to-video is the one build path with no footage precondition at
    // all — fetching its own visuals is the whole feature (R132).
    create_video_from_script: { requires: [], provides: [R.CLIPS] },
    organize_clips:           { requires: [R.ASSETS], provides: [R.CLIPS] },
    // Recovery: resumes whatever the last incomplete run left behind (R131).
    resume_failed_job:        { requires: [] },

    // ── Analysis (these are the prerequisite PRODUCERS) ──────────────────────
    detect_speakers: { requires: [R.CLIPS], provides: [R.DIARIZATION] },
    detect_scene:    { requires: [R.CLIPS], provides: [R.SCENE_ANALYSIS] },

    // ── Framing / motion ─────────────────────────────────────────────────────
    crop_clip:            { requires: [R.CLIPS] },
    reset_crop:           { requires: [R.CLIPS] },
    apply_angle:          { requires: [R.CLIPS, R.DIARIZATION], prefers: [R.SCENE_ANALYSIS] },
    rhythm_zoom:          { requires: [R.CLIPS, R.TRANSCRIPT] },
    animate_automatically:{ requires: [R.CLIPS], prefers: [R.TRANSCRIPT] },
    compose_motion:       { requires: [R.CLIPS] },
    remove_background:    { requires: [R.CLIPS], prefers: [R.SCENE_ANALYSIS] },
    sandwich_text:        { requires: [R.CLIPS], prefers: [R.SCENE_ANALYSIS] },
    zoom_speaker:         { requires: [R.CLIPS], prefers: [R.SCENE_ANALYSIS] },
    track_speaker:        { requires: [R.CLIPS], prefers: [R.SCENE_ANALYSIS] },

    // ── Layouts (need something to lay out against) ──────────────────────────
    layout_split_screen:       { requires: [R.CLIPS], prefers: [R.ASSETS] },
    layout_picture_in_picture: { requires: [R.CLIPS], prefers: [R.ASSETS] },
    layout_fullscreen:         { requires: [R.CLIPS], prefers: [R.ASSETS] },

    // ── Captions / text / graphics ───────────────────────────────────────────
    // auto_captions is the single most load-bearing producer in the graph: it
    // is what unlocks every transcript-gated cleanup and cutting command.
    auto_captions:       { requires: [R.CLIPS], provides: [R.TRANSCRIPT, R.CAPTION_CLIPS] },
    emphasize_keywords:  { requires: [R.CAPTION_CLIPS], provides: [R.KEYWORD_EMPHASIS] },
    clear_keywords:      { requires: [R.KEYWORD_EMPHASIS] },
    add_text_overlay:    { requires: [R.CLIPS] },
    add_template:        { requires: [R.CLIPS] },
    add_motion_component:{ requires: [R.CLIPS] },
    storyboard_video:    { requires: [R.CLIPS, R.TRANSCRIPT] },
    place_contextual_illustrations: { requires: [R.CLIPS, R.TRANSCRIPT] },
    // Designs from a written brief, so it needs no timeline state of its own.
    design_scene:        { requires: [] },
    set_brand_kit:       { requires: [], provides: [R.BRAND_KIT] },

    // ── Short-form finishing ─────────────────────────────────────────────────
    polish_short:        { requires: [R.CLIPS], prefers: [R.TRANSCRIPT, R.CAPTION_CLIPS] },

    // ── Audio ────────────────────────────────────────────────────────────────
    normalize_audio: { requires: [R.CLIPS] },
    denoise_audio:   { requires: [R.CLIPS] },
    enhance_audio:   { requires: [R.CLIPS] },
    adjust_volume:   { requires: [R.CLIPS] },

    // ── Overlays / decoration ────────────────────────────────────────────────
    add_sticker:       { requires: [R.CLIPS] },
    add_sfx:           { requires: [R.CLIPS] },
    add_shadow:        { requires: [R.SELECTION], provides: [R.SHADOW] },
    remove_shadow:     { requires: [R.SHADOW] },
    add_blur_zone:     { requires: [R.CLIPS], provides: [R.BLUR_ZONE] },
    remove_blur_zone:  { requires: [R.BLUR_ZONE] },

    // ── Colour ───────────────────────────────────────────────────────────────
    color_grade:    { requires: [R.CLIPS], provides: [R.COLOR_GRADE] },
    apply_lut:      { requires: [R.CLIPS], provides: [R.COLOR_GRADE] },
    clear_lut:      { requires: [R.COLOR_GRADE] },
    recommend_luts: { requires: [R.CLIPS] },

    // ── Timeline mechanics ───────────────────────────────────────────────────
    split_clip:       { requires: [R.CLIPS] },
    remove_clip:      { requires: [R.CLIPS] },
    set_clip_speed:   { requires: [R.CLIPS] },
    add_transition:   { requires: [R.CLIPS] },
    set_aspect_ratio: { requires: [R.CLIPS] },
    undo_action:      { requires: [R.HISTORY] },
    queue_export:     { requires: [R.CLIPS] },

    // ── Bundles ──────────────────────────────────────────────────────────────
    apply_style_recipe: { requires: [R.CLIPS], prefers: [R.TRANSCRIPT, R.CAPTION_CLIPS] },
});

/** Read-only commands: safe to run at any time, never change the timeline. */
const READ_ONLY = new Set(['detect_speakers', 'detect_scene', 'recommend_luts']);

/**
 * The ONLY commands a planner may insert on its own to satisfy a missing
 * requirement.
 *
 * This allowlist exists because "what produces this resource?" and "what may
 * I silently run to get it?" are different questions, and conflating them
 * produces absurd plans. `create_video_from_script` provides `clips` without
 * needing any footage — so a naive producer lookup would answer a missing-clips
 * requirement by INVENTING A WHOLE VIDEO from a script the user never wrote.
 *
 * The three below are the safe ones: two read-only analysis passes, plus
 * transcription, which is a prerequisite in every editing pipeline this app
 * has and is already what the UI nudges first. Anything else that produces a
 * resource is a GOAL the user has to choose, so a plan that needs it reports
 * `unreachable` and lets the caller say "upload footage first" instead of
 * fabricating content. (R30: a step that cannot do the job must say so.)
 */
const AUTO_INSERTABLE = new Set(['auto_captions', 'detect_speakers', 'detect_scene']);

const uniq = (list) => [...new Set((list || []).filter(Boolean))];

/**
 * A macro's contract, computed from the atomic steps it expands to.
 *
 * requires = everything the chain needs that an EARLIER step in the same chain
 *            does not already produce (so macro_multicam requires only clips,
 *            not diarization — its own detect_speakers step provides that).
 * provides = everything any step provides.
 *
 * @param {string} id
 * @returns {{requires: string[], prefers: string[], provides: string[]}|null}
 */
export function macroContract(id) {
    const steps = expandMacro(id);
    if (!Array.isArray(steps) || steps.length === 0) return null;
    // A macro that expands to itself is not a macro — guard against the
    // infinite recursion that would otherwise cause.
    if (steps.length === 1 && steps[0] === id) return null;

    const produced = new Set();
    const requires = [];
    const prefers  = [];
    const provides = [];

    for (const stepId of steps) {
        const step = contractFor(stepId);
        if (!step) continue;
        for (const need of step.requires) {
            if (!produced.has(need)) requires.push(need);
        }
        for (const want of step.prefers) {
            if (!produced.has(want)) prefers.push(want);
        }
        for (const made of step.provides) {
            produced.add(made);
            provides.push(made);
        }
    }

    return {
        requires: uniq(requires),
        // Anything the chain itself produces is not a precondition to prefer.
        prefers:  uniq(prefers).filter(p => !produced.has(p)),
        provides: uniq(provides),
    };
}

/**
 * The merged contract for one command: CAPABILITIES unioned with the
 * registry's own `requires`, or a computed contract for a macro.
 *
 * Returns null for an unknown id rather than an empty contract — an unknown
 * command must never look runnable.
 *
 * @param {string} id
 * @returns {{id: string, requires: string[], prefers: string[], provides: string[], destructive: boolean, readOnly: boolean, macro: string[]|null}|null}
 */
export function contractFor(id) {
    const cmd = COMMAND_BY_ID[id];
    if (!cmd) return null;

    const steps = Array.isArray(cmd.macro) ? cmd.macro : null;
    if (steps) {
        const computed = macroContract(id);
        if (computed) {
            return {
                id,
                requires: computed.requires,
                prefers:  computed.prefers,
                provides: computed.provides,
                destructive: !!cmd.destructive,
                readOnly: false,
                macro: steps,
            };
        }
    }

    const declared = CAPABILITIES[id] || {};
    return {
        id,
        // Union with the registry's own declaration — never override it.
        requires: uniq([...(declared.requires || []), ...(cmd.requires || [])]),
        prefers:  uniq(declared.prefers),
        provides: uniq(declared.provides),
        destructive: !!cmd.destructive,
        readOnly: READ_ONLY.has(id),
        macro: steps,
    };
}

/**
 * Which resources the live project actually has.
 *
 * Reuses SuggestionEngine's `facts` when the caller already derived them, so
 * the two never disagree and nothing is computed twice. Everything facts does
 * not cover is read straight off the store state here.
 *
 * @param {object} state  timeline store state (tracks, assets, …)
 * @param {object} [facts] optional pre-derived SuggestionEngine facts
 * @returns {Set<string>}
 */
export function deriveResources(state, facts = null) {
    const s = state || {};
    const tracks = Array.isArray(s.tracks) ? s.tracks : [];
    const videoClips = tracks.filter(t => t.type === 'video').flatMap(t => t.clips || []);
    const textClips  = tracks.filter(t => t.type === 'text').flatMap(t => t.clips || []);
    const assets     = Array.isArray(s.assets) ? s.assets : [];

    const have = new Set();

    // Prefer the caller's facts where they overlap; fall back to the store.
    const clipCount = Number.isFinite(facts?.clipCount) ? facts.clipCount : videoClips.length;
    if (clipCount > 0) have.add(R.CLIPS);

    const usableAssets = assets.filter(a => ['video', 'image'].includes(a?.type));
    if (usableAssets.length > 0) have.add(R.ASSETS);

    const hasTranscript = typeof facts?.hasTranscript === 'boolean'
        ? facts.hasTranscript
        : ((Array.isArray(s.captions) && s.captions.length > 0)
            || Object.keys(s.transcripts || {}).length > 0);
    if (hasTranscript) have.add(R.TRANSCRIPT);

    const hasCaptionClips = typeof facts?.hasCaptionClips === 'boolean'
        ? facts.hasCaptionClips
        : textClips.length > 0;
    if (hasCaptionClips) have.add(R.CAPTION_CLIPS);

    const diarized = typeof facts?.diarized === 'boolean'
        ? facts.diarized
        : (Object.keys(s.speakerMap || {}).length > 0
            || Object.keys(s.diarizationByAsset || {}).length > 0);
    if (diarized) have.add(R.DIARIZATION);

    if (Object.keys(s.sceneAnalysisByAsset || {}).length > 0) have.add(R.SCENE_ANALYSIS);
    if ((Array.isArray(s.selectedClipIds) ? s.selectedClipIds : []).length > 0) have.add(R.SELECTION);

    // A grade is either project-wide (projectLUTId) or per-clip (clip.grading)
    // — clearLUT clears the second, so both count as "a grade is applied".
    const hasGrade = (typeof facts?.hasColorGrade === 'boolean' ? facts.hasColorGrade : !!s.projectLUTId)
        || videoClips.some(c => c?.grading);
    if (hasGrade) have.add(R.COLOR_GRADE);

    // clip.emphasis = { indices, source } on a caption clip (captionEmphasis.js)
    if (textClips.some(c => c?.emphasis)) have.add(R.KEYWORD_EMPHASIS);
    if (videoClips.some(c => c?.shadow))   have.add(R.SHADOW);
    if (videoClips.some(c => c?.blurZone)) have.add(R.BLUR_ZONE);
    if (s.brandKit) have.add(R.BRAND_KIT);
    if ((Array.isArray(s.editHistory) ? s.editHistory : []).length > 0) have.add(R.HISTORY);

    return have;
}

/**
 * Hard requirements this command is missing right now.
 * An unknown command reports as unsatisfiable rather than runnable.
 *
 * @param {string} id
 * @param {Set<string>|string[]} have
 * @returns {string[]}
 */
export function missingRequirements(id, have) {
    const contract = contractFor(id);
    if (!contract) return ['unknown_command'];
    const owned = have instanceof Set ? have : new Set(have || []);
    return contract.requires.filter(r => !owned.has(r));
}

/** Soft preferences this command is missing right now (never blocking). */
export function missingPreferences(id, have) {
    const contract = contractFor(id);
    if (!contract) return [];
    const owned = have instanceof Set ? have : new Set(have || []);
    return contract.prefers.filter(r => !owned.has(r));
}

/** True when every hard requirement is already satisfied. */
export function isEligible(id, have) {
    return missingRequirements(id, have).length === 0;
}

/**
 * The command that produces a resource, preferring the cheapest producer.
 * Read-only analysis passes are preferred over anything that mutates the
 * timeline: needing diarization should run detect_speakers, never reach for a
 * destructive command that happens to produce it as a side effect.
 *
 * @param {string} resource
 * @returns {string|null}
 */
export function producerOf(resource, opts = {}) {
    const { have = null, insertableOnly = false } = opts || {};
    const owned = have instanceof Set ? have : (have ? new Set(have) : null);

    let producers = COMMANDS
        .map(c => contractFor(c.id))
        .filter(c => c && c.provides.includes(resource));

    if (insertableOnly) producers = producers.filter(c => AUTO_INSERTABLE.has(c.id));
    if (producers.length === 0) return null;

    const rank = (c) => {
        if (c.readOnly) return 0;
        if (c.macro) return 3;          // a whole macro to get one resource: last resort
        if (c.destructive) return 2;
        return 1;
    };

    // A producer whose OWN requirements are already met beats a nominally
    // cheaper one that cannot run yet — otherwise the planner picks a producer
    // and immediately reports it unreachable.
    const blocked = (c) => (owned ? (c.requires.some(r => !owned.has(r)) ? 1 : 0) : 0);

    producers.sort((a, b) =>
        blocked(a) - blocked(b) || rank(a) - rank(b) || a.id.localeCompare(b.id));
    return producers[0].id;
}

/** True when a planner is allowed to insert this command as a prerequisite. */
export function isAutoInsertable(id) {
    return AUTO_INSERTABLE.has(id);
}

/**
 * Build a prerequisite-complete, correctly ordered plan for a set of goals.
 *
 * This is the piece that lets a planner stop carrying a hardcoded step list:
 * ask for ['silence_removal', 'rhythm_zoom'] on a project with no transcript
 * and you get ['auto_captions', 'silence_removal', 'rhythm_zoom'], because
 * auto_captions is the declared producer of the transcript both need.
 *
 * Guarantees:
 *   - every step's hard requirements are satisfied by the project state or by
 *     an EARLIER step in the returned plan
 *   - no duplicates, and a goal already satisfiable keeps its requested order
 *   - a goal whose requirements cannot be produced by anything is reported in
 *     `unreachable` instead of being silently dropped (R30: a step that cannot
 *     work must say so, not quietly vanish)
 *
 * @param {string[]} goals
 * @param {Set<string>|string[]} have
 * @returns {{steps: string[], inserted: string[], unreachable: Array<{id: string, missing: string[]}>, upgrades: Array<{id: string, missing: string[]}>}}
 */
export function planFor(goals, have) {
    const owned = new Set(have instanceof Set ? [...have] : (have || []));
    const steps = [];
    const inserted = [];
    const unreachable = [];
    const upgrades = [];
    const queued = new Set();

    /**
     * Resolve one goal, inserting producers for anything it is missing.
     * `seen` guards against a cycle in the producer graph.
     */
    const resolve = (id, seen) => {
        if (queued.has(id)) return true;
        const contract = contractFor(id);
        if (!contract) {
            unreachable.push({ id, missing: ['unknown_command'] });
            return false;
        }
        if (seen.has(id)) {
            // Cyclic prerequisite — report rather than recurse forever.
            unreachable.push({ id, missing: contract.requires.filter(r => !owned.has(r)) });
            return false;
        }
        seen.add(id);

        for (const need of contract.requires) {
            if (owned.has(need)) continue;
            const producer = producerOf(need, { have: owned, insertableOnly: true });
            if (!producer || producer === id) {
                unreachable.push({ id, missing: [need] });
                seen.delete(id);
                return false;
            }
            if (!resolve(producer, seen)) {
                unreachable.push({ id, missing: [need] });
                seen.delete(id);
                return false;
            }
            inserted.push(producer);
        }

        seen.delete(id);
        queued.add(id);
        steps.push(id);
        for (const made of contract.provides) owned.add(made);

        const wants = contract.prefers.filter(p => !owned.has(p));
        if (wants.length > 0) upgrades.push({ id, missing: wants });
        return true;
    };

    for (const goal of (Array.isArray(goals) ? goals : [])) {
        resolve(goal, new Set());
    }

    return {
        steps,
        // Only report as "inserted" what was actually added as a prerequisite
        // and was not itself one of the caller's goals.
        inserted: uniq(inserted).filter(id => !(goals || []).includes(id)),
        unreachable,
        upgrades,
    };
}

/**
 * Every command's contract, for a catalogue or a prompt. Sorted by category
 * then id so generated output is stable and diffs stay readable.
 *
 * @returns {Array<object>}
 */
export function describeAll() {
    return COMMANDS
        .map(c => {
            const contract = contractFor(c.id);
            return {
                id: c.id,
                category: c.category,
                label: c.label || c.id,
                summary: c.summary || '',
                requires: contract.requires,
                prefers: contract.prefers,
                provides: contract.provides,
                destructive: contract.destructive,
                readOnly: contract.readOnly,
                macro: contract.macro,
            };
        })
        .sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id));
}

export default {
    RESOURCES,
    CAPABILITIES,
    contractFor,
    macroContract,
    deriveResources,
    missingRequirements,
    missingPreferences,
    isEligible,
    producerOf,
    isAutoInsertable,
    planFor,
    describeAll,
};
