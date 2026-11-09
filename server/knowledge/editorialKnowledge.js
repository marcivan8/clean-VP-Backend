/**
 * server/knowledge/editorialKnowledge.js
 *
 * VIBED Editorial Knowledge Library — version 1.0.0
 *
 * WHY THIS EXISTS
 * ---------------
 * `vibedMotionKnowledge.js` gives motion a structured, versioned, queryable
 * body of craft: 12 skill domains, intent patterns, spring presets, animation
 * recipes. Editorial craft — cutting, pacing, structure, coverage, the actual
 * job of an editor — had no equivalent. It lived as prose inside one large
 * system prompt, which means it could not be composed, tested, or scored
 * against. A model either repeated it or quietly didn't.
 *
 * The difference in shape from the motion library is deliberate and is the
 * whole point: motion knowledge is PROMPT-driven (a brief mentions a hook, so
 * inject hook recipes). Editorial knowledge is STATE-driven. Nobody asks for
 * "a sagging middle"; you find one by reading the cut. So this library maps
 * the project's measured state onto named SITUATIONS, and each situation
 * carries the craft note and the ordered remedies for it.
 *
 * THE RULE THAT DEFINES THIS FILE
 * ------------------------------
 * A remedy either names a command that EXISTS, or it is explicitly advisory
 * (`advisory: true`, no command). There is no third option. This is the same
 * rule DirectorIntelligence enforces for proposals, and the reason for it is
 * the one R157 removed: `server/brain/strategies/` confidently emitted
 * `remove_silence`, `generate_captions` and `apply_smart_zoom`, none of which
 * exist, so its plans were lists of no-ops. test_editorial_knowledge.mjs
 * validates every remedy command against the generated catalogue.
 *
 * Pure, deterministic, dependency-free.
 */

'use strict';

const EDITORIAL_KNOWLEDGE_VERSION = '1.0.0';

/** Named situations, detected from measured project state. */
const SITUATIONS = Object.freeze({
    NO_TRANSCRIPT:        'no_transcript',
    DEAD_AIR:             'dead_air',
    BURIED_HOOK:          'buried_hook',
    SAGGING_MIDDLE:       'sagging_middle',
    THROUGH_LINE_LOST:    'through_line_lost',
    MONO_FRAMING:         'mono_framing',
    UNDIFFERENTIATED_SPEAKERS: 'undifferentiated_speakers',
    WEAK_AUDIO:           'weak_audio',
    UNREADABLE_SOUND_OFF: 'unreadable_sound_off',
    WRONG_ASPECT:         'wrong_aspect',
    OVERLONG_FOR_FORMAT:  'overlong_for_format',
    CUTS_TOO_SLOW:        'cuts_too_slow',
    CUTS_TOO_FAST:        'cuts_too_fast',
    THIN_COVERAGE:        'thin_coverage',
    UNUSED_FOOTAGE:       'unused_footage',
    FLAT_LOOK:            'flat_look',
});

const SEVERITY = Object.freeze({ CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', LOW: 'low' });

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const ops = (facts) => new Set(Array.isArray(facts?.editsDone) ? facts.editsDone : []);
const did = (facts, ...names) => { const o = ops(facts); return names.some(n => o.has(n)); };

/**
 * The library.
 *
 * detect(facts)  — reads the SERVER-side context shape (ContextEngine.build()
 *                  output plus projectMap/storyMap). Returns a boolean. Never
 *                  throws: an unreadable field reads as absent, because a
 *                  missing signal must never be reported as a finding (the
 *                  anti-hallucination rule the Brain prompt already enforces:
 *                  "do NOT invent a gap to fill this space").
 * craft          — one or two sentences of why it matters and what good looks
 *                  like. This is what a judge scores against.
 * remedies       — ordered best-first. Each has a real `command`, or
 *                  `advisory: true` when the app genuinely cannot do it.
 * rejectedBy     — styles for which this situation is NOT a problem, taken
 *                  from the predicates in editingStyles.js rather than
 *                  re-stated prose.
 */
const KNOWLEDGE = Object.freeze([
    {
        id: SITUATIONS.NO_TRANSCRIPT,
        title: 'No transcript yet',
        severity: SEVERITY.CRITICAL,
        detect: (f) => num(f.clipCount) > 0 && !f.hasCaptions,
        craft: 'Word timings are the substrate for most editing decisions: silence removal, '
            + 'filler cuts, zoom rhythm, short extraction and captions all read from them. '
            + 'Until they exist the edit can only be done by hand.',
        remedies: [{ command: 'auto_captions', why: 'Unlocks every transcript-gated operation.' }],
        rejectedBy: [],
    },
    {
        id: SITUATIONS.DEAD_AIR,
        title: 'Dead air between words',
        severity: SEVERITY.HIGH,
        detect: (f) => num(f.clipCount) > 0 && f.hasCaptions
            && !did(f, 'silence_removal', 'long_form_edit', 'compound_clean_dynamic'),
        craft: 'Removing silence is the single highest-yield edit on spoken footage: it raises '
            + 'the information density of every second without changing a word. Keep the breaths '
            + 'that carry meaning — a pause before a punchline is content, not dead air.',
        remedies: [
            { command: 'silence_removal', why: 'Cuts the gaps, keeps intentional pauses.' },
            { command: 'remove_filler_words', why: 'The same pass for ums and hesitations.' },
        ],
        rejectedBy: [],
    },
    {
        id: SITUATIONS.BURIED_HOOK,
        title: 'The hook lands late',
        severity: SEVERITY.CRITICAL,
        detect: (f) => {
            const s = f.storyMap;
            if (!s || s.status === 'failed' || s.status === 'insufficient_data') return false;
            const at = num(s.hook_at_sec);
            return at > 3 || s.hook_strength === 'weak';
        },
        craft: 'Attention is decided in the first seconds. A strong moment sitting at 0:40 is not '
            + 'a weak video, it is a misordered one — which is a different and much easier problem. '
            + 'Say WHERE the hook currently is; "add a hook" is wrong advice when one already exists.',
        remedies: [
            {
                advisory: true,
                why: 'Nothing reorders the timeline to lift a later moment to the front. '
                    + 'Tell the user which timestamp to move, and let them move it.',
            },
            { command: 'extract_short', why: 'For short-form, this selects a window that STARTS on the strongest moment.' },
            { command: 'add_text_overlay', why: 'A spoken hook that lands late can be fronted on screen instead.' },
        ],
        // Vlog, interview and podcast tell the story in recorded order, so a
        // late hook is a fact about the format, not a defect.
        rejectedBy: ['vlog', 'interview', 'podcast'],
    },
    {
        id: SITUATIONS.SAGGING_MIDDLE,
        title: 'The cut sags',
        severity: SEVERITY.HIGH,
        detect: (f) => Array.isArray(f.storyMap?.sag_windows) && f.storyMap.sag_windows.length > 0,
        craft: 'A sag is a property of the SEQUENCE, not of the footage — saying the material is '
            + 'weak is both wrong and unhelpful. Name the window, then tighten it, cut away from it, '
            + 'or move it. The fix is almost always subtraction.',
        remedies: [
            { command: 'silence_removal', why: 'Tightens the window without losing content.' },
            { command: 'sync_cutaways', why: 'Cutting away carries a stretch that cannot be shortened.' },
            { command: 'rhythm_zoom', why: 'A framing change re-engages attention on a long static take.' },
        ],
        rejectedBy: [],
    },
    {
        id: SITUATIONS.THROUGH_LINE_LOST,
        title: 'The cut does not deliver its point',
        severity: SEVERITY.CRITICAL,
        detect: (f) => f.storyMap?.delivers_through_line === false,
        craft: 'This outranks every pacing note. The pieces are present but the order buries the '
            + 'point, which is the single most useful thing to tell someone about their own edit. '
            + 'Nothing in the app can restructure a narrative; naming it precisely is the work.',
        remedies: [{
            advisory: true,
            why: 'Restructuring is a human decision. State what the video is about, and which '
                + 'section works against it.',
        }],
        rejectedBy: [],
    },
    {
        id: SITUATIONS.MONO_FRAMING,
        title: 'One unchanging framing throughout',
        severity: SEVERITY.MEDIUM,
        detect: (f) => num(f.clipCount) >= 2
            && num(f.rhythmCoverage) < 0.3 && num(f.multicamCoverage) < 0.3,
        craft: 'A single static framing for minutes reads as unedited, however good the content. '
            + 'Vary it on meaning — a push-in on an emphasised point — not on a timer; motion that '
            + 'does not follow the speech is noise.',
        remedies: [
            { command: 'rhythm_zoom', why: 'Push-ins timed to emphasised words.' },
            { command: 'apply_angle', why: 'Wide/mid/close variation across existing clips.' },
            { command: 'crop_clip', why: 'A single deliberate reframe when rhythm would be too much.' },
        ],
        // Podcast and interview are statically framed on purpose.
        rejectedBy: ['podcast', 'interview'],
    },
    {
        id: SITUATIONS.UNDIFFERENTIATED_SPEAKERS,
        title: 'Several speakers, one framing',
        severity: SEVERITY.HIGH,
        detect: (f) => num(f.detectedSpeakers) >= 2 && num(f.multicamCoverage) < 0.5,
        craft: 'In a conversation the cut should be on whoever is talking. Without that the viewer '
            + 'has to work out who is speaking from audio alone, which is the most common reason an '
            + 'interview feels amateur. Keep every question with its answer.',
        remedies: [
            { command: 'detect_speakers', why: 'Produces the diarization the rest needs.' },
            { command: 'apply_angle', why: 'Puts the framing on the active speaker.' },
            { command: 'split_by_speaker', why: 'Separate tracks per speaker when per-turn control is wanted.' },
        ],
        rejectedBy: [],
    },
    {
        id: SITUATIONS.WEAK_AUDIO,
        title: 'Audio not levelled',
        severity: SEVERITY.HIGH,
        detect: (f) => num(f.clipCount) > 0
            && !did(f, 'enhance_audio', 'normalize_audio', 'denoise_audio'),
        craft: 'Viewers forgive a soft picture and leave over bad sound. Level and clean the voice '
            + 'before spending any effort on the look, and hit the platform loudness standard — a '
            + 'quiet upload gets turned up by the platform along with its noise floor.',
        remedies: [
            { command: 'enhance_audio', why: 'Noise, level and loudness in one pass.' },
            { command: 'normalize_audio', why: 'Evens out loudness across clips.' },
            { command: 'denoise_audio', why: 'When the problem is hiss or hum specifically.' },
        ],
        rejectedBy: [],
    },
    {
        id: SITUATIONS.UNREADABLE_SOUND_OFF,
        title: 'No captions on the timeline',
        severity: SEVERITY.HIGH,
        detect: (f) => num(f.clipCount) > 0 && f.hasCaptions && !did(f, 'auto_captions'),
        craft: 'Most social viewing starts muted, so an uncaptioned cut is an unwatched one. '
            + 'Emphasising the one word that carries each line is what makes captions readable at '
            + 'a glance rather than a wall of text.',
        remedies: [
            { command: 'auto_captions', why: 'Word-timed captions on the timeline.' },
            { command: 'emphasize_keywords', why: 'Makes them scannable instead of a block.' },
        ],
        rejectedBy: [],
    },
    {
        id: SITUATIONS.WRONG_ASPECT,
        title: 'Wrong shape for the target',
        severity: SEVERITY.HIGH,
        detect: (f) => {
            const ratio = f.aspectRatio;
            if (!ratio) return false;
            const vertical = ['tiktok', 'instagram_reels', 'youtube_shorts', 'reels', 'shorts'];
            if (vertical.includes(f.platform)) return ratio !== '9:16';
            if (f.platform === 'youtube_long') return ratio !== '16:9';
            return false;
        },
        craft: 'Shape is not a preference, it is a requirement of the surface. A 16:9 cut posted '
            + 'vertically is letterboxed into a third of the screen. Reframe so the speaker stays '
            + 'in frame rather than cropping to centre and hoping.',
        remedies: [
            { command: 'set_aspect_ratio', why: 'Reframes the project for the platform.' },
            { command: 'track_speaker', why: 'Keeps the subject framed through the tighter crop.' },
        ],
        rejectedBy: [],
    },
    {
        id: SITUATIONS.OVERLONG_FOR_FORMAT,
        title: 'Too long for the format',
        severity: SEVERITY.HIGH,
        detect: (f) => {
            const d = num(f.duration);
            if (d <= 0) return false;
            const shortForm = ['tiktok', 'instagram_reels', 'youtube_shorts', 'reels', 'shorts'];
            return shortForm.includes(f.platform) && d > 90;
        },
        craft: 'Short form rewards one idea delivered completely, not a long video trimmed at the '
            + 'end. Select the strongest self-contained window; if several ideas are worth keeping, '
            + 'make several cuts rather than one compromise.',
        remedies: [
            { command: 'extract_short', why: 'Selects the strongest self-contained window.' },
            { command: 'repurpose_shorts', why: 'Several cuts when more than one moment earns one.' },
        ],
        rejectedBy: [],
    },
    {
        id: SITUATIONS.CUTS_TOO_SLOW,
        title: 'Cut rate below the format',
        severity: SEVERITY.MEDIUM,
        detect: (f) => num(f.clipCount) >= 2 && num(f.cutRate) > 0 && num(f.cutRate) < 3,
        craft: 'Cut rate is a symptom, never a target. A low rate on a tight, well-paced take is '
            + 'fine; a low rate with silence still in it is the silence, not the cutting. Fix the '
            + 'pacing and let the rate follow.',
        remedies: [
            { command: 'silence_removal', why: 'Usually the real cause of a slow-feeling cut.' },
            { command: 'remove_repetition', why: 'Repeated takes and restated points pad a cut.' },
        ],
        rejectedBy: ['podcast', 'interview'],
    },
    {
        id: SITUATIONS.CUTS_TOO_FAST,
        title: 'Cut rate above comprehension',
        severity: SEVERITY.MEDIUM,
        detect: (f) => num(f.cutRate) > 40,
        craft: 'Past roughly 40 cuts a minute the viewer stops following and starts enduring. '
            + 'Energy comes from cutting ON meaning; cutting faster than the speech can be parsed '
            + 'removes meaning instead of adding pace.',
        remedies: [{
            advisory: true,
            why: 'Nothing lengthens clips back out. Point at the densest stretch and let the user '
                + 'decide what to hold.',
        }],
        rejectedBy: [],
    },
    {
        id: SITUATIONS.THIN_COVERAGE,
        title: 'A gap in coverage',
        severity: SEVERITY.HIGH,
        detect: (f) => Array.isArray(f.projectMap?.coverage_gaps) && f.projectMap.coverage_gaps.length > 0,
        craft: 'A coverage gap is the one finding no per-clip view can see, which makes it worth '
            + 'more than another pacing tip. State it as missing COVERAGE, never as a flaw in the '
            + 'footage they already shot.',
        remedies: [
            { command: 'sync_cutaways', why: 'Uses b-roll already in the bin where it illustrates the words.' },
            { command: 'place_contextual_illustrations', why: 'Vector illustrations when no footage covers the point.' },
            { advisory: true, why: 'Some gaps can only be closed by shooting more — say so plainly.' },
        ],
        // B-roll is optional for these formats, never a gap.
        rejectedBy: ['podcast', 'interview', 'talking_head'],
    },
    {
        id: SITUATIONS.UNUSED_FOOTAGE,
        title: 'Footage in the bin, not on the timeline',
        severity: SEVERITY.MEDIUM,
        detect: (f) => (Array.isArray(f.unusedAssets) ? f.unusedAssets.length : 0) > 0,
        craft: 'Unused footage is either the answer to a gap or clutter. Decide which rather than '
            + 'leaving it ambiguous — and if it was shot deliberately, there is usually a place it '
            + 'belongs.',
        remedies: [
            { command: 'organize_clips', why: 'Places and orders what is still in the bin.' },
            { command: 'sync_cutaways', why: 'Places it where the words call for it.' },
        ],
        rejectedBy: [],
    },
    {
        id: SITUATIONS.FLAT_LOOK,
        title: 'No colour treatment',
        severity: SEVERITY.LOW,
        detect: (f) => num(f.clipCount) > 0 && !f.hasColorGrade && num(f.completionScore) > 60,
        craft: 'A grade is the last thing to do and the first thing to skip. It is worth real '
            + 'effort only once the cut, the audio and the captions are right — grading a cut that '
            + 'is about to change is wasted work.',
        remedies: [
            { command: 'recommend_luts', why: 'Content-aware suggestions rather than a generic look.' },
            { command: 'apply_lut', why: 'Applies a chosen look across the timeline.' },
        ],
        rejectedBy: [],
    },
]);

const BY_ID = Object.freeze(Object.fromEntries(KNOWLEDGE.map(k => [k.id, k])));

const SEVERITY_ORDER = Object.freeze({ critical: 0, high: 1, medium: 2, low: 3 });

/**
 * Which situations this project is actually in, worst first.
 *
 * @param {Object} facts   ContextEngine.build() output, plus projectMap/storyMap
 * @param {Object} [opts]
 * @param {string} [opts.styleId]  drops situations the chosen style rejects
 * @param {number} [opts.limit]
 * @returns {Array<Object>} matching KNOWLEDGE entries
 */
function detectSituations(facts, opts = {}) {
    const f = facts || {};
    const styleId = opts.styleId || f.editingStyle || null;

    const hits = [];
    for (const entry of KNOWLEDGE) {
        if (styleId && entry.rejectedBy.includes(styleId)) continue;
        let matched = false;
        try {
            matched = !!entry.detect(f);
        } catch {
            // An unreadable signal is an ABSENT signal. Reporting a finding we
            // could not actually measure is the failure mode this guards.
            matched = false;
        }
        if (matched) hits.push(entry);
    }

    hits.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    const limit = Number(opts.limit) || 0;
    return limit > 0 ? hits.slice(0, limit) : hits;
}

/**
 * The craft notes for the situations this project is in, as prompt lines.
 * This is what gives a judge something real to score against instead of four
 * generic axes.
 *
 * @param {Object} facts
 * @param {Object} [opts]
 * @returns {string[]}
 */
function craftNotes(facts, opts = {}) {
    return detectSituations(facts, { limit: 4, ...opts })
        .map(s => `${s.title} (${s.severity}): ${s.craft}`);
}

/**
 * Every command any remedy names. Used by the test that validates them all
 * against the generated catalogue.
 * @returns {string[]}
 */
function remedyCommands() {
    const out = new Set();
    for (const entry of KNOWLEDGE) {
        for (const r of entry.remedies) {
            if (r.command) out.add(r.command);
        }
    }
    return [...out].sort();
}

module.exports = {
    EDITORIAL_KNOWLEDGE_VERSION,
    SITUATIONS,
    SEVERITY,
    KNOWLEDGE,
    BY_ID,
    detectSituations,
    craftNotes,
    remedyCommands,
};
