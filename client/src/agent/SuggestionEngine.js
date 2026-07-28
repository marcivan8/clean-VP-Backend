/**
 * client/src/agent/SuggestionEngine.js
 *
 * Resolves "what should the user do next" from the LIVE state of the project
 * rather than from a fixed per-operation lookup.
 *
 * WHY THIS EXISTS
 * ---------------
 * Next-step guidance used to come from OPERATION_META in WorkflowController.js:
 * a hardcoded map of operation → one fixed suggestion. `virtual_multicam` always
 * proposed "Add captions" even when captions already existed; `silence_removal`
 * always proposed "Make it more dynamic" even when a zoom rhythm was already on
 * every clip. The suggestion could not react to anything that had happened.
 *
 * This module instead:
 *   1. Derives FACTS from the timeline (coverage of each effect, not just booleans)
 *   2. Evaluates ordered RULES with real prerequisites, so nothing is proposed
 *      before the step it depends on, and nothing already done is proposed again
 *   3. Merges Editorial Brain suggestions when the server returned any, filtering
 *      out anything the facts show is already satisfied
 *
 * The rule engine is deterministic and works with no network — the Brain's LLM
 * guidance layers on top when available rather than being required.
 *
 * Pipeline order encoded here matches CLAUDE.md R18 / the command-chaining rules:
 *   transcript → cleanup → (split speakers) → multicam → rhythm → polish → export
 * Each stage only becomes available once its prerequisite is genuinely satisfied.
 */

import useTimelineStore from '../store/useTimelineStore';

/**
 * Derive the facts the rules reason over.
 * Coverage numbers (not booleans) matter: "multicam on 3 of 40 clips" should not
 * count as done, and a partially-applied effect is worth surfacing.
 *
 * @param {object} [state] optional pre-read store state (avoids a second read)
 * @returns {object} facts
 */
export function deriveFacts(state = null) {
    const s = state || useTimelineStore.getState();

    const tracks      = s.tracks || [];
    const videoTracks = tracks.filter(t => t.type === 'video');
    const textTracks  = tracks.filter(t => t.type === 'text');
    const audioTracks = tracks.filter(t => t.type === 'audio');

    const videoClips = videoTracks.flatMap(t => t.clips || []);
    const clipCount  = videoClips.length;

    const withVirtualCam = videoClips.filter(c => c.virtualCam).length;
    const withRhythm     = videoClips.filter(c => c.keyframes?.scale?.length > 0).length;

    const editHistory = s.editHistory || [];
    const opsApplied  = new Set(editHistory.map(e => e.op).filter(Boolean));

    // An op counts as "done" if it's in the ledger OR its effect is visible on
    // the timeline — the ledger can be empty for projects edited before the
    // ledger existed, or restored from a save.
    const didOp = (...names) => names.some(n => opsApplied.has(n));

    const speakerMap   = s.speakerMap || {};
    const speakerCount = Object.keys(speakerMap).length;

    const captions   = s.captions || [];
    const hasTranscript = captions.length > 0 || Object.keys(s.transcripts || {}).length > 0 || speakerCount > 0;
    const hasCaptionClips = textTracks.some(t => (t.clips || []).length > 0);

    const assets = s.assets || [];
    const videoAssets = assets.filter(a => (a.type || '').toLowerCase().includes('video'));
    const assetsOnTimeline = new Set(videoClips.map(c => c.assetId).filter(Boolean));
    const unusedAssets = videoAssets.filter(a => !assetsOnTimeline.has(a.id)).length;

    const cleanupDone = didOp(
        'silence_removal', 'remove_filler', 'remove_filler_words',
        'compound_clean_dynamic', 'compound_clean_virtual_multicam', 'remove_repetition'
    );

    return {
        clipCount,
        videoTrackCount: videoTracks.length,
        multicamClips:   withVirtualCam,
        rhythmClips:     withRhythm,
        multicamCoverage: clipCount ? withVirtualCam / clipCount : 0,
        rhythmCoverage:   clipCount ? withRhythm / clipCount : 0,
        hasTranscript,
        hasCaptionClips,
        speakerCount,
        multiSpeaker:  speakerCount >= 2,
        diarized:      speakerCount > 0 || Object.keys(s.diarizationByAsset || {}).length > 0,
        cleanupDone,
        hasMusic:      audioTracks.some(t => (t.clips || []).some(c => c.assetId)),
        hasColorGrade: !!s.projectLUTId,
        exported:      didOp('export', 'nle_export'),
        unusedAssets,
        assetCount:    videoAssets.length,
        duration:      s.duration || 0,
        opsApplied,
        editHistory,
    };
}

/**
 * Ordered rules. First matching rules (by priority) become the suggestions.
 * `when` returns true only when the action is BOTH useful and not already done.
 * Keep `label` short — it renders on a button.
 */
const RULES = [
    {
        id: 'import',
        priority: 100,
        when: f => f.clipCount === 0 && f.assetCount === 0,
        label: 'Upload a video',
        prompt: null,
        tab: 'media',
        reason: 'Nothing on the timeline yet.',
    },
    {
        id: 'place_assets',
        priority: 95,
        when: f => f.clipCount === 0 && f.assetCount > 0,
        label: 'Organize my clips',
        prompt: 'Organize my clips',
        reason: 'You have footage in the bin that isn’t on the timeline yet.',
    },
    {
        id: 'place_remaining',
        priority: 62,
        when: f => f.clipCount > 0 && f.unusedAssets > 0,
        label: 'Organize my clips',
        prompt: 'Organize my clips',
        reason: f => `${f.unusedAssets} clip(s) in your bin aren’t on the timeline.`,
    },
    {
        id: 'transcript',
        priority: 90,
        // Cleanup and rhythm both need word timings; get them first.
        when: f => f.clipCount > 0 && !f.hasTranscript,
        label: 'Add captions',
        prompt: 'Add captions',
        reason: 'A transcript unlocks silence removal, angles and zoom rhythm.',
    },
    {
        id: 'cleanup',
        priority: 80,
        when: f => f.clipCount > 0 && f.hasTranscript && !f.cleanupDone,
        label: 'Clean it up',
        prompt: 'Remove silences and filler words',
        reason: 'Tightening the cut first means every later effect lands on the final structure.',
    },
    {
        id: 'multicam',
        priority: 70,
        // Only once the cut is settled, and only if it isn't already covered.
        when: f => f.clipCount > 0 && f.hasTranscript && f.cleanupDone && f.multicamCoverage < 0.5,
        label: f => (f.multiSpeaker ? 'Add interview angles' : 'Add camera angles'),
        prompt: 'Apply virtual multicam',
        reason: f => f.multiSpeaker
            ? `${f.speakerCount} speakers detected — cut between them like a multi-camera shoot.`
            : 'Turn the single angle into wide / mid / close shots.',
    },
    {
        id: 'rhythm',
        priority: 65,
        // Rhythm goes last of the motion effects: it's the most fragile to
        // re-segmentation, so anything that re-cuts clips should already be done.
        when: f => f.clipCount >= 2 && f.hasTranscript && f.cleanupDone && f.rhythmCoverage < 0.5,
        label: 'Make it more dynamic',
        prompt: 'Make it more dynamic',
        reason: 'Adds push-ins and punch-ins on your emphasised words.',
    },
    {
        id: 'style_captions',
        priority: 55,
        when: f => f.hasTranscript && !f.hasCaptionClips,
        label: 'Style your captions',
        prompt: null,
        tab: 'captions',
        reason: 'Burned-in captions lift retention on silent autoplay.',
    },
    {
        id: 'color',
        priority: 40,
        when: f => f.clipCount > 0 && !f.hasColorGrade && f.cleanupDone,
        label: 'Add a color grade',
        prompt: null,
        tab: 'effects',
        reason: 'A consistent look across shots.',
    },
    {
        id: 'music',
        priority: 35,
        when: f => f.clipCount > 0 && !f.hasMusic && f.cleanupDone,
        label: 'Add background music',
        prompt: 'Add background music',
        reason: 'Music ducked under your voice adds energy.',
    },
    {
        id: 'export',
        priority: 20,
        // Only propose exporting once the core edit is actually in good shape.
        when: f => f.clipCount > 0 && f.hasTranscript && f.cleanupDone && !f.exported,
        label: 'Export',
        prompt: 'Export for YouTube',
        reason: 'The edit looks complete — render it out.',
    },
    {
        id: 'review',
        priority: 10,
        when: f => f.clipCount > 0,
        label: 'Review the timeline',
        prompt: null,
        reason: 'Scrub through and check the cuts.',
    },
];

const resolve = (v, f) => (typeof v === 'function' ? v(f) : v);

/**
 * Rank the next best actions for the CURRENT project state.
 *
 * @param {object}   [opts]
 * @param {string}   [opts.justCompleted]      operation that just finished (deprioritised)
 * @param {Array}    [opts.brainSuggestions]   suggestions returned by /api/brain/*
 * @param {number}   [opts.limit]
 * @param {object}   [opts.state]              pre-read store state
 * @returns {Array<{id,label,prompt,tab,reason,source}>}
 */
export function getNextActions({ justCompleted = null, brainSuggestions = [], limit = 4, state = null } = {}) {
    const facts = deriveFacts(state);

    const ruleActions = RULES
        .filter(r => {
            try { return !!r.when(facts); } catch { return false; }
        })
        // Never immediately re-propose what just ran, even if coverage is partial —
        // the user just did it and wants to see the result, not run it again.
        .filter(r => !(justCompleted && ruleMatchesOperation(r.id, justCompleted)))
        .sort((a, b) => b.priority - a.priority)
        .map(r => ({
            id:     r.id,
            label:  resolve(r.label, facts),
            prompt: resolve(r.prompt, facts),
            tab:    r.tab || null,
            reason: resolve(r.reason, facts),
            source: 'rules',
        }));

    // Brain suggestions layer on top: they carry LLM reasoning about THIS
    // project, but must still be filtered against the facts so the Brain can't
    // propose something already done (its context can lag by one operation).
    const brainActions = (brainSuggestions || [])
        .map(normalizeBrainSuggestion)
        .filter(Boolean)
        .filter(a => !isAlreadySatisfied(a, facts))
        .filter(a => !(justCompleted && ruleMatchesOperation(a.id, justCompleted)));

    // Brain first (it reasons about content), then rules, de-duplicated by id/label.
    const seen = new Set();
    const merged = [];
    for (const a of [...brainActions, ...ruleActions]) {
        const key = (a.id || a.label || '').toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        merged.push(a);
        if (merged.length >= limit) break;
    }
    return merged;
}

/** Convenience: the single best next action, or null. */
export function getNextAction(opts = {}) {
    return getNextActions({ ...opts, limit: 1 })[0] || null;
}

/** Quick chips shown above the prompt bar — same engine, shorter labels. */
export function getQuickChips(opts = {}) {
    const actions = getNextActions({ ...opts, limit: 4 });
    return actions.filter(a => a.prompt).map(a => a.prompt);
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Maps a rule id to the operation names that satisfy it. */
const RULE_OPS = {
    transcript:      ['auto_captions', 'add_captions'],
    cleanup:         ['silence_removal', 'remove_filler', 'remove_filler_words',
                      'compound_clean_dynamic', 'compound_clean_virtual_multicam', 'remove_repetition'],
    multicam:        ['virtual_multicam', 'compound_clean_virtual_multicam',
                      'compound_split_speakers_virtual_multicam', 'split_speakers'],
    rhythm:          ['rhythm_zoom', 'dynamic_rhythm', 'compound_clean_dynamic'],
    music:           ['music'],
    color:           ['color_grade'],
    export:          ['export', 'nle_export'],
    place_assets:    ['organize_clips'],
    place_remaining: ['organize_clips'],
};

function ruleMatchesOperation(ruleId, operation) {
    return (RULE_OPS[ruleId] || []).includes(operation);
}

/** Normalise the various shapes the Brain may return into an action. */
function normalizeBrainSuggestion(s) {
    if (!s) return null;
    if (typeof s === 'string') return { id: null, label: s, prompt: s, tab: null, reason: null, source: 'brain' };
    const label  = s.label || s.title || s.text || s.suggestion || null;
    const prompt = s.prompt || s.command || s.suggestionPrompt || label;
    if (!label) return null;
    return {
        id:     s.type || s.id || null,
        label,
        prompt,
        tab:    s.tab || null,
        reason: s.reason || s.rationale || s.why || null,
        source: 'brain',
    };
}

/**
 * Guard against the Brain proposing work the timeline shows is already done.
 * Matching is intentionally loose (label text) because Brain suggestion shapes
 * vary; a false negative just means one extra suggestion, never a wrong edit.
 */
function isAlreadySatisfied(action, f) {
    const text = `${action.id || ''} ${action.label || ''} ${action.prompt || ''}`.toLowerCase();
    if (/caption/.test(text) && f.hasCaptionClips && f.hasTranscript) return true;
    if (/(silence|filler|clean)/.test(text) && f.cleanupDone) return true;
    if (/(multicam|angle|multi-cam)/.test(text) && f.multicamCoverage >= 0.5) return true;
    if (/(dynamic|zoom|rhythm)/.test(text) && f.rhythmCoverage >= 0.5) return true;
    if (/music/.test(text) && f.hasMusic) return true;
    if (/(color|colour|grade|lut)/.test(text) && f.hasColorGrade) return true;
    if (/export|render/.test(text) && f.exported) return true;
    return false;
}

export default { deriveFacts, getNextActions, getNextAction, getQuickChips };
