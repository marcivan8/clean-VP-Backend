/**
 * client/src/agent/DirectorIntelligence.js
 *
 * Sprint 7. The last level of the intelligence stack:
 *
 *   media_assets         → what is each clip?              (R21/R38)
 *   project_intelligence → what is this PROJECT?           (R44)
 *   story_intelligence   → does the CUT tell that story?   (R51)
 *   this file            → so what should we DO about it?  (R52)
 *
 * Turns the FINDINGS already computed by the story and project maps into ranked
 * PROPOSALS. It is deliberately deterministic and synchronous — no model call.
 * The maps were derived by a model; re-interpreting them with a second one
 * would reintroduce exactly the double-interpretation problem R37 removed, and
 * a proposal that disagreed with the map it came from would be indefensible.
 *
 * ── THE RULE THAT DEFINES THIS MODULE ────────────────────────────────────────
 * A proposal may only advertise itself as APPLICABLE if it resolves to a real
 * command in CommandRegistry. Everything else is advice, rendered without an
 * action and without implying the app can do it.
 *
 * This is not hypothetical caution. The pre-existing CreativeDirector.js emits
 * `action.operation` values for 14 operations, of which TWELVE do not exist in
 * the registry — add_background_music, add_hook_text, add_ken_burns,
 * add_zoom_punch, apply_color_grade, extend_key_clips, generate_captions,
 * reorder_for_hook, split_long_clips, suggest_transition_points, trim_opening,
 * vary_clip_durations. Wiring that module up would have produced a panel of
 * Apply buttons routing to handlers that do not exist: R23 requires every
 * command to reach a real handler, and R30 requires a command that changes
 * nothing to report failure. Twelve confident proposals that silently do
 * nothing is the worst version of both.
 *
 * So: `buildProposals()` checks every candidate against COMMAND_BY_ID, and the
 * regression asserts that no proposal can carry `applicable: true` without one.
 */

import { COMMAND_BY_ID } from './CommandRegistry.js';

/** Ranked highest-impact first. Ties break by declaration order below. */
export const PRIORITY = { critical: 0, high: 1, medium: 2, low: 3 };

const SEVERITY_TO_PRIORITY = { high: 'critical', medium: 'high', low: 'medium' };

// Maps ProjectIntelligence's closed `tone` vocabulary to words that actually
// exist in server/audio-engine/library/taxonomyMaps.js's LUT_KEYWORD_MAP —
// the raw tone word itself ("dramatic", "educational") mostly doesn't appear
// there, so passing it straight through as a search query would silently
// fall back to a generic/no-op search. This is the same phrase that gets
// embedded in the proposal's title (see lut_suggestion below) and round-trips
// through BOTH CommandRegistry.extractParams (client) and QueryParser (server
// /api/luts/search) — so it has to be real keyword vocabulary on both ends.
const TONE_TO_LUT_MOOD = {
    educational:    'clean corporate',
    conversational: 'natural clean',
    promotional:    'vivid punchy',
    personal:       'warm vintage',
    dramatic:       'moody dark',
};

/**
 * Does this command actually exist and reach a handler?
 * The single gate every proposal passes through.
 */
export function isExecutable(commandId) {
    return !!(commandId && COMMAND_BY_ID[commandId]);
}

/**
 * Build a proposal, verifying executability. NEVER trust the caller's claim.
 *
 * A candidate naming a command that doesn't exist is not dropped — it is
 * DEMOTED to advice. The observation is still true and worth telling the user;
 * what changes is that we stop pretending we can act on it.
 */
function proposal({ id, title, why, priority, command = null, params = null, atSec = null, source }) {
    const applicable = isExecutable(command);
    return {
        id,
        title,
        why,                       // always traceable to a stored finding
        priority,
        source,                    // 'story' | 'project' — which map produced it
        atSec,
        // `command` is only surfaced when it resolves. Otherwise null, so a UI
        // that keys its Apply button off this field cannot render a dead one.
        command:    applicable ? command : null,
        params:     applicable ? (params || {}) : null,
        applicable,
        // When a real observation has no command behind it, say so explicitly
        // rather than leaving the UI to infer it from a null.
        advisoryReason: applicable
            ? null
            : (command
                ? `No "${command}" command exists yet — this is an observation, not something the editor can apply.`
                : 'This is an observation, not an applicable action.'),
    };
}

/**
 * Derive ranked proposals from the maps.
 *
 * PURE and synchronous — no I/O, no model call — so the regression executes the
 * real ranking and verification rather than pattern-matching source.
 *
 * @param {Object} args
 * @param {Object} [args.storyMap]   - story_intelligence row (R51)
 * @param {Object} [args.projectMap] - project_intelligence row (R44)
 * @returns {{ proposals: Array, executableCount: number, advisoryCount: number, basis: string }}
 */
export function buildProposals({ storyMap = null, projectMap = null } = {}) {
    const out = [];

    const storyReadable = storyMap && storyMap.status === 'ok';
    const projectReadable = projectMap && projectMap.status === 'ok';

    // ── From the STORY map — strongest material, because it describes the
    //    sequence the user actually built.
    if (storyReadable) {
        // 1. Buried hook. The single most valuable finding: the cut HAS a hook,
        //    it is just in the wrong place. There is no dedicated
        //    reorder_for_hook command, but organize_clips already does full
        //    semantic reordering — routing through it WITH the hook location
        //    as a hint (see server/routes/interviewRoutes.js storyHints
        //    handling) turns this from permanently-advisory into a real,
        //    executable fix instead of a repeat of the context-free ordering
        //    pass organize already ran once.
        if (typeof storyMap.hook_at_sec === 'number' && storyMap.hook_at_sec > 3) {
            out.push(proposal({
                id: 'hook_buried',
                title: `Your hook lands at ${storyMap.hook_at_sec}s — move it to the front`,
                why: storyMap.hook_note
                    || 'The strongest opening moment is not the first thing a viewer sees.',
                priority: 'critical',
                command: 'organize_clips',
                params: {
                    storyHints: {
                        hook: { atSec: storyMap.hook_at_sec, note: storyMap.hook_note || null },
                    },
                },
                atSec: storyMap.hook_at_sec,
                source: 'story',
            }));
        } else if (storyMap.hook_strength === 'absent' || storyMap.hook_strength === 'weak') {
            out.push(proposal({
                id: 'hook_weak',
                title: 'The opening does not hook',
                why: storyMap.hook_note || 'Nothing in the first seconds gives a reason to keep watching.',
                priority: 'critical',
                command: 'add_text_overlay',   // real: a hook line on screen
                params: { position: 'start' },
                atSec: 0,
                source: 'story',
            }));
        }

        // 2. Through-line buried. Outranks everything except the hook — the cut
        //    contains every piece and still misses the point.
        if (storyMap.delivers_through_line === false) {
            out.push(proposal({
                id: 'through_line_buried',
                title: 'This order does not deliver the point',
                why: storyMap.through_line_note
                    || 'The cut contains what it needs, but the order buries the payoff.',
                priority: 'critical',
                command: 'organize_clips',     // real: re-orders from asset profiles
                params: {
                    storyHints: {
                        throughLineNote: storyMap.through_line_note || null,
                        sagWindows: storyMap.sag_windows || [],
                    },
                },
                source: 'story',
            }));
        }

        // 3. Sags — each one a concrete time range with a real remedy.
        for (const sag of (storyMap.sag_windows || [])) {
            const len = Math.max(0, (sag.endSec ?? 0) - (sag.startSec ?? 0));
            out.push(proposal({
                id: `sag_${sag.startSec}`,
                title: `Drags from ${sag.startSec}s to ${sag.endSec}s${len ? ` (${Math.round(len)}s)` : ''}`,
                why: sag.reason,
                priority: SEVERITY_TO_PRIORITY[sag.severity] || 'medium',
                // Silence removal is the honest remedy we can actually run; it
                // tightens dead air without pretending to restructure the edit.
                command: 'silence_removal',
                atSec: sag.startSec,
                source: 'story',
            }));
        }

        // 4. Everything else the story map flagged, carried through verbatim so
        //    the user sees the same wording the map stored.
        for (const issue of (storyMap.issues || [])) {
            out.push(proposal({
                id: `issue_${(issue.issue || '').slice(0, 24).replace(/\W+/g, '_')}`,
                title: issue.issue,
                why: issue.suggestion || 'Flagged when reading the assembled cut.',
                priority: SEVERITY_TO_PRIORITY[issue.severity] || 'medium',
                command: null,                 // advisory by construction
                atSec: issue.atSec ?? null,
                source: 'story',
            }));
        }
    }

    // ── From the PROJECT map — coverage gaps are things no per-clip view sees.
    if (projectReadable) {
        // 5. Content-aware LUT suggestion (R75). `tone` is the strongest single
        //    signal ProjectIntelligence derives about what the footage actually
        //    IS. Rather than a second "resolve a stored pick" mechanism, the
        //    mood words are embedded directly in the title — BrainPanel's
        //    Accept only ever resubmits `proposal.title` as free text (see
        //    handleAcceptProposal in BrainPanel.jsx, which drops `params`), so
        //    Accept re-resolves through the exact same content-aware apply_lut
        //    path (CommandRegistry query-extraction → VideoEditorTools.applyLUT
        //    → searchLUTs → QueryParser's LUT_KEYWORD_MAP) that a typed request
        //    would use. No stale stored id to go out of sync with the library.
        const mood = TONE_TO_LUT_MOOD[projectMap.tone];
        if (mood) {
            out.push(proposal({
                id: 'lut_suggestion',
                title: `Apply a ${mood} LUT`,
                why: `This footage reads as ${projectMap.tone}` +
                    (projectMap.through_line ? ` — "${projectMap.through_line}"` : '') +
                    '. A matching look can reinforce that instead of leaving the default color.',
                priority: 'low',
                command: 'apply_lut',
                params: { query: mood },
                source: 'project',
            }));
        }

        for (const gap of (projectMap.coverage_gaps || [])) {
            out.push(proposal({
                id: `gap_${(gap.gap || '').slice(0, 24).replace(/\W+/g, '_')}`,
                title: gap.gap,
                why: gap.suggestion || 'Identified when mapping the project.',
                priority: SEVERITY_TO_PRIORITY[gap.severity] || 'medium',
                // A missing shot cannot be conjured — this is inherently advice.
                command: null,
                source: 'project',
            }));
        }
    }

    // Stable, deterministic ranking: priority first, declaration order second.
    // Deliberately NOT sorted by applicability — a critical advisory finding
    // ("your hook is buried") must outrank a low-priority applicable tweak.
    // Ranking by what we can DO rather than by what matters would be a UI
    // convenience that quietly misleads.
    const ranked = out
        .map((p, i) => ({ p, i }))
        .sort((a, b) =>
            (PRIORITY[a.p.priority] ?? 9) - (PRIORITY[b.p.priority] ?? 9) || a.i - b.i)
        .map(({ p }) => p);

    return {
        proposals:       ranked,
        executableCount: ranked.filter(p => p.applicable).length,
        advisoryCount:   ranked.filter(p => !p.applicable).length,
        basis: storyReadable && projectReadable ? 'story+project'
             : storyReadable ? 'story'
             : projectReadable ? 'project'
             : 'none',
    };
}

export default { buildProposals, isExecutable, PRIORITY };
