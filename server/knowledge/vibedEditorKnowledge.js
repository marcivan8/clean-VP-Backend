/**
 * server/knowledge/vibedEditorKnowledge.js
 *
 * VIBED Editor Tools & Autonomous Agent Knowledge Engine — Version 1.0.0
 *
 * Provides a comprehensive, versioned, zero-dependency craft and execution
 * registry for all video editor tools across the platform.
 *
 * This knowledge layer powers the Editorial Brain (ROKA), the intent reasoning
 * layer, the edit planner, and the autonomous execution supervisors. It bridges
 * raw command execution with high-level editorial intelligence:
 *   1. Tool Semantic Taxonomy: Purpose, preconditions, postconditions, and cost.
 *   2. Multi-Mode Usage: The different creative and technical ways to use each tool
 *      (e.g., subtle emphasis vs dramatic cut substitute; audio ducking vs leveling).
 *   3. Autonomous Workflows / Recipes: Composable multi-step production pipelines
 *      executed as atomic, single-undo transactions.
 *   4. Safe Boundaries & Heuristics: Explicit when-to-use, when-NOT-to-use, and
 *      common anti-patterns to prevent destructive hallucinations.
 *
 * Pure, deterministic, dependency-free.
 */

'use strict';

const VIBED_EDITOR_KNOWLEDGE_VERSION = '1.0.0';

/**
 * ─── 1. TOOL DISCIPLINE & SKILL DOMAINS ──────────────────────────────────────
 */
const EDITOR_SKILL_DOMAINS = Object.freeze({
    TIMELINE_CUTS:       'timeline-cuts',
    PACING_CLEANUP:      'pacing-cleanup',
    VISUAL_FRAMING:      'visual-framing',
    BROLL_COVERAGE:      'broll-coverage',
    AUDIO_INTELLIGENCE:  'audio-intelligence',
    COLOR_FINISHING:     'color-finishing',
    CAPTIONS_TYPOGRAPHY: 'captions-typography',
    ASSEMBLY_MACROS:     'assembly-macros',
});

/**
 * ─── 2. COMPREHENSIVE TOOL REGISTRY & USAGE CONTRACTS ───────────────────────
 */
const TOOL_REGISTRY = Object.freeze({
    // ═════════════════════════════════════════════════════════════════════════
    // A. TIMELINE & CUT CRAFT
    // ═════════════════════════════════════════════════════════════════════════
    split_clip: {
        id: 'split_clip',
        label: 'Split clip',
        domain: EDITOR_SKILL_DOMAINS.TIMELINE_CUTS,
        destructive: true,
        cost: 'local',
        purpose: 'Divides a single video or audio clip into two independent segments at an exact timestamp or landmark without losing media frames.',
        usageWays: [
            { mode: 'at_playhead', description: 'Split under current cursor time for immediate editing.' },
            { mode: 'at_timestamp', description: 'Split at a calculated seconds offset to isolate a take or sentence.' },
            { mode: 'rhythm_midpoint', description: 'Split at midpoint/thirds to reframe or isolate different speaker reactions.' },
        ],
        whenToUse: 'When isolating a specific sentence, preparing an edit point for a B-roll cutaway, or changing framing on one half of a shot.',
        whenNotToUse: 'Do not split clips continuously without purpose; every split creates an edit point that can distract if unmotivated.',
        preconditions: ['At least one clip on the timeline.', 'Timestamp is within the target clip boundaries.'],
        parameters: {
            clipId: { type: 'string', required: false, description: 'Target clip ID. Defaults to clip under playhead.' },
            timestamp: { type: 'number', required: false, description: 'Timeline time in seconds to split.' },
            mode: { type: 'string', enum: ['playhead', 'timestamp', 'midpoint'], default: 'playhead' },
        },
    },

    remove_clip: {
        id: 'remove_clip',
        label: 'Remove clip',
        domain: EDITOR_SKILL_DOMAINS.TIMELINE_CUTS,
        destructive: true,
        cost: 'local',
        purpose: 'Deletes a selected or targeted clip from the timeline, closing or maintaining gaps according to ripple settings.',
        usageWays: [
            { mode: 'ripple_delete', description: 'Removes clip and shifts subsequent clips left to maintain continuous flow.' },
            { mode: 'lift_delete', description: 'Removes clip leaving blank space for intentional pacing or replacement.' },
        ],
        whenToUse: 'When a clip has been identified as redundant, out-of-order, or superseded by a better take.',
        whenNotToUse: 'Do not remove the primary A-roll spine clip without replacing it or confirming narrative continuity.',
        preconditions: ['Target clip exists on the timeline.'],
        parameters: {
            clipId: { type: 'string', required: false, description: 'Clip to remove. Defaults to selected clip.' },
            ripple: { type: 'boolean', default: true, description: 'Whether to close timeline gap.' },
        },
    },

    set_clip_speed: {
        id: 'set_clip_speed',
        label: 'Change speed',
        domain: EDITOR_SKILL_DOMAINS.TIMELINE_CUTS,
        destructive: false,
        cost: 'local',
        purpose: 'Retimes clip playback speed from slow motion (0.25x-0.75x) to hyperlapse/fast forward (1.5x-8.0x) while preserving audio pitch.',
        usageWays: [
            { mode: 'slow_motion', description: '0.25x-0.5x for dramatic emphasis, emotional gravity, or action beauty shots.' },
            { mode: 'fast_forward', description: '2x-8x for condensing repetitive screen recordings, walking, or setup montages.' },
            { mode: 'pacing_tighten', description: '1.05x-1.12x for subtly speeding up a sluggish delivery without sounding robotic.' },
        ],
        whenToUse: 'To add energy to montages, condense screen walkthroughs, or savor high-frame-rate B-roll moments.',
        whenNotToUse: 'Do not apply heavy slow-motion (<0.5x) to 24fps/30fps footage where frame interpolation produces jitter.',
        preconditions: ['Target clip exists on the timeline.'],
        parameters: {
            speed: { type: 'number', required: true, min: 0.1, max: 10, description: 'Speed multiplier (e.g. 0.5 for half speed, 2.0 for double speed).' },
            clipId: { type: 'string', required: false },
        },
    },

    add_transition: {
        id: 'add_transition',
        label: 'Add transition',
        domain: EDITOR_SKILL_DOMAINS.TIMELINE_CUTS,
        destructive: false,
        cost: 'local',
        purpose: 'Connects two adjacent clips with a cinematic or energetic visual transition (fade, cross-dissolve, wipe, dip-to-black, whip-pan).',
        usageWays: [
            { mode: 'crossfade_subtle', description: '0.3-0.5s gentle cross-dissolve between related visual thoughts.' },
            { mode: 'dip_to_black', description: '0.6-1.0s dip indicating a major scene change, time lapse, or chapter end.' },
            { mode: 'whip_pan_whip_cut', description: '0.2-0.3s dynamic kinetic transition matching fast camera moves or high-energy cuts.' },
        ],
        whenToUse: 'At scene boundaries, temporal shifts, topic changes, or between distinct speaker segments.',
        whenNotToUse: 'Never place transitions between every single cut in a fast dialogue scene; jump cuts must remain hard and clean.',
        preconditions: ['At least two adjacent clips on the main video track.'],
        parameters: {
            type: { type: 'string', enum: ['fade', 'dissolve', 'dip-to-black', 'whip-pan', 'zoom-in', 'glitch'], default: 'fade' },
            duration: { type: 'number', default: 0.5, min: 0.1, max: 3.0 },
            apply_at: { type: 'string', enum: ['selected_cut', 'section_boundaries', 'all_cuts'], default: 'selected_cut' },
        },
    },

    organize_clips: {
        id: 'organize_clips',
        label: 'Organise clips on the timeline',
        domain: EDITOR_SKILL_DOMAINS.TIMELINE_CUTS,
        destructive: true,
        cost: 'local',
        purpose: 'Restructures, sorts, and aligns timeline clips chronologically, by scene topic, or into a logical multi-track narrative spine.',
        usageWays: [
            { mode: 'chronological', description: 'Align all footage in time-code / capture order.' },
            { mode: 'role_layered', description: 'Separate primary A-roll to track 1, B-roll to track 2, graphics to track 3.' },
            { mode: 'gap_collapse', description: 'Close all accidental gaps across the entire sequence.' },
        ],
        whenToUse: 'When beginning a project with scattered rushes or after bulk cut operations left fragmented gaps.',
        whenNotToUse: 'When the editor has carefully placed intentional pacing holds or complex overlapping multi-track sync.',
        preconditions: ['Clips exist on the timeline.'],
        parameters: {
            mode: { type: 'string', enum: ['close_gaps', 'sort_chronological', 'layer_by_role'], default: 'close_gaps' },
        },
    },

    // ═════════════════════════════════════════════════════════════════════════
    // B. PACING & SPOKEN CLEANUP
    // ═════════════════════════════════════════════════════════════════════════
    silence_removal: {
        id: 'silence_removal',
        label: 'Remove silences',
        domain: EDITOR_SKILL_DOMAINS.PACING_CLEANUP,
        destructive: true,
        cost: 'analysis_or_compute',
        purpose: 'Analyzes speech waveform and word timings to strip dead air and pauses between spoken sentences, dramatically increasing viewer retention.',
        usageWays: [
            { mode: 'snappy_social', description: 'Aggressive cutoff (threshold -30dB, min duration 0.3s) for TikTok, Reels, and YouTube Shorts.' },
            { mode: 'natural_interview', description: 'Moderate cutoff (threshold -35dB, min duration 0.6s) preserving natural conversational breaths.' },
            { mode: 'deliberate_calm', description: 'Conservative cutoff (threshold -40dB, min duration 1.0s) for essays, documentaries, and audiobooks.' },
        ],
        whenToUse: 'The foundational first pass on any talking-head, vlog, interview, or tutorial footage.',
        whenNotToUse: 'Do not strip silences from dramatic acting, musical pauses, comedic timing beats, or contemplation moments.',
        preconditions: ['Timeline has audio/video clips containing speech.', 'Transcript or waveform available.'],
        parameters: {
            threshold: { type: 'string', default: '-30dB', description: 'Audio decibel threshold below which sound is considered silence.' },
            minSilenceDuration: { type: 'number', default: 0.35, description: 'Minimum duration in seconds to trigger a cut.' },
            padding: { type: 'number', default: 0.08, description: 'Buffer in seconds kept around words to prevent clipped consonants.' },
        },
    },

    remove_filler_words: {
        id: 'remove_filler_words',
        label: 'Remove filler words',
        domain: EDITOR_SKILL_DOMAINS.PACING_CLEANUP,
        destructive: true,
        cost: 'analysis_or_compute',
        purpose: 'Detects and extracts vocal hesitations ("um", "uh", "like", "you know", "euh", "genre") using phoneme and word timestamp matching.',
        usageWays: [
            { mode: 'all_fillers', description: 'Extract all detected filler words across the entire sequence.' },
            { mode: 'hesitations_only', description: 'Extract only non-lexical sounds ("um", "uh") while leaving conversational phrases intact.' },
        ],
        whenToUse: 'To make the speaker sound polished, authoritative, and concise without manual razor-blade editing.',
        whenNotToUse: 'When a conversational hesitation is clearly intentional or provides comedic value.',
        preconditions: ['Transcript is generated with word-level timestamps.'],
        parameters: {
            fillers: { type: 'array', items: { type: 'string' }, description: 'Specific filler words to target (defaults to standard catalog).' },
        },
    },

    remove_repetition: {
        id: 'remove_repetition',
        label: 'Remove repetition',
        domain: EDITOR_SKILL_DOMAINS.PACING_CLEANUP,
        destructive: true,
        cost: 'analysis',
        purpose: 'Identifies false starts, restarted sentences, and repeated takes, keeping only the final (best) delivery of each thought.',
        usageWays: [
            { mode: 'restart_take_culling', description: 'Detects identical sentence starts within 15 seconds and keeps the last successful take.' },
            { mode: 'semantic_redundancy', description: 'Highlights restated paragraphs or duplicated points in long-form lectures.' },
        ],
        whenToUse: 'When working with unscripted raw takes where the speaker frequently stumbles and repeats the sentence.',
        whenNotToUse: 'When an orator repeats a phrase for rhetorical emphasis ("I have a dream", "Never, never, never give up").',
        preconditions: ['Transcript is generated.'],
        parameters: {
            threshold: { type: 'number', default: 0.82, description: 'Text similarity threshold for take clustering.' },
        },
    },

    find_hook: {
        id: 'find_hook',
        label: 'Find hook',
        domain: EDITOR_SKILL_DOMAINS.PACING_CLEANUP,
        destructive: false,
        cost: 'analysis',
        purpose: 'Analyzes spoken content for high-curiosity statements, counter-intuitive claims, or emotional revelations suitable for opening 0-3 seconds.',
        usageWays: [
            { mode: 'locate_and_mark', description: 'Locates hook timestamp and moves playhead to review.' },
            { mode: 'extract_to_front', description: 'Splits hook sentence and repositions it at 0:00 as a cold open.' },
        ],
        whenToUse: 'When the recorded video opens with boring throat-clearing ("Hey guys, welcome back...") but buries the punchline at 45 seconds.',
        whenNotToUse: 'When the video already has a punchy, scripted opening hook at 0:00.',
        preconditions: ['Transcript exists with sentence metadata.'],
        parameters: {
            promoteToFront: { type: 'boolean', default: false, description: 'Whether to move the discovered hook to the start of the video.' },
        },
    },

    identify_quotable_moments: {
        id: 'identify_quotable_moments',
        label: 'Identify quotable moments',
        domain: EDITOR_SKILL_DOMAINS.PACING_CLEANUP,
        destructive: false,
        cost: 'analysis',
        purpose: 'Extracts self-contained, high-impact statements and insights from long-form video suitable for social soundbites or shorts.',
        usageWays: [
            { mode: 'candidate_list', description: 'Returns timestamped candidate list with viral scores and rationale.' },
            { mode: 'bookmark_markers', description: 'Places timeline markers at each strong quotable boundary.' },
        ],
        whenToUse: 'For repurposing 30-60 minute podcasts, keynote presentations, or educational webinars.',
        whenNotToUse: 'On short clips under 60 seconds that are already focused on one topic.',
        preconditions: ['Transcript exists.'],
        parameters: {
            limit: { type: 'number', default: 5, max: 20 },
            minScore: { type: 'number', default: 0.7 },
        },
    },

    // ═════════════════════════════════════════════════════════════════════════
    // C. FRAMING & VISUAL DYNAMICS
    // ═════════════════════════════════════════════════════════════════════════
    apply_zoom: {
        id: 'apply_zoom',
        label: 'Apply zoom',
        domain: EDITOR_SKILL_DOMAINS.VISUAL_FRAMING,
        destructive: false,
        cost: 'local',
        purpose: 'Applies static or dynamic digital scale/crop to create framing diversity on single-camera setups.',
        usageWays: [
            { mode: 'subtle_punch_in', description: '1.12x-1.18x punch-in on critical words or key takeaways.' },
            { mode: 'dramatic_close_up', description: '1.30x-1.45x close-up for intimate storytelling or intense revelations.' },
            { mode: 'slow_push_in', description: 'Continuous keyframed slow creep (1.0x to 1.15x over 5s) building suspense.' },
        ],
        whenToUse: 'To prevent single-angle visual fatigue in videos longer than 30 seconds.',
        whenNotToUse: 'Do not scale 1080p footage past 1.35x on 1080p canvas, or 4K footage past 1.8x, without verifying pixel softness.',
        preconditions: ['Target video clip exists.'],
        parameters: {
            scale: { type: 'number', default: 1.18, min: 1.0, max: 2.5 },
            clipId: { type: 'string', required: false },
            duration: { type: 'number', required: false },
        },
    },

    apply_smart_zoom: {
        id: 'apply_smart_zoom',
        label: 'Apply smart zoom',
        domain: EDITOR_SKILL_DOMAINS.VISUAL_FRAMING,
        destructive: false,
        cost: 'analysis',
        purpose: 'Uses speaker facial tracking to center zooms precisely on the subject eyes/head instead of dumb canvas center cropping.',
        usageWays: [
            { mode: 'speaker_centered_emphasis', description: 'Punches in centered on the speaker face to avoid decapitation.' },
            { mode: 'multi_speaker_alternating', description: 'Zooms alternately between left and right speakers in interviews.' },
        ],
        whenToUse: 'Whenever zooming in on off-center speakers or talking-head footage in 9:16 vertical repurposing.',
        whenNotToUse: 'On macro shots, landscape scenery, or screen recordings where no face is present.',
        preconditions: ['Video clip has detected face or person.'],
        parameters: {
            intensity: { type: 'number', default: 1.2, min: 1.05, max: 1.6 },
            clipIds: { type: 'array', items: { type: 'string' }, required: false },
        },
    },

    zoom_speaker: {
        id: 'zoom_speaker',
        label: 'Zoom to the speaker',
        domain: EDITOR_SKILL_DOMAINS.VISUAL_FRAMING,
        destructive: false,
        cost: 'analysis',
        purpose: 'Tracks and dynamically centers framing on the active speaker across dialogue.',
        usageWays: [
            { mode: 'speaker_centered_emphasis', description: 'Punches in centered on the speaker face to avoid decapitation.' },
        ],
        whenToUse: 'Whenever zooming in on off-center speakers or talking-head footage in 9:16 vertical repurposing.',
        whenNotToUse: 'On macro shots, landscape scenery, or screen recordings where no face is present.',
        preconditions: ['Video clip has detected face or person.'],
        parameters: {
            scale: { type: 'number', default: 1.2, min: 1.05, max: 1.6 },
        },
    },

    crop_clip: {
        id: 'crop_clip',
        label: 'Crop clip',
        domain: EDITOR_SKILL_DOMAINS.VISUAL_FRAMING,
        destructive: false,
        cost: 'local',
        purpose: 'Adjusts framing bounds to isolate subjects or remove unwanted borders.',
        usageWays: [
            { mode: 'reframe_subject', description: 'Crops canvas to emphasize main subject.' },
        ],
        whenToUse: 'To remove letterbox black bars or reframe off-center subjects.',
        whenNotToUse: 'When camera tracking is needed; use zoom_speaker instead.',
        preconditions: ['Video clip exists on the timeline.'],
        parameters: {
            clipId: { type: 'string', required: false },
        },
    },

    rhythm_zoom: {
        id: 'rhythm_zoom',
        label: 'Apply rhythm zoom',
        domain: EDITOR_SKILL_DOMAINS.VISUAL_FRAMING,
        destructive: false,
        cost: 'local',
        purpose: 'Automates alternating wide/punch-in cuts synchronized with sentence cadence or audio beats every 3-6 seconds.',
        usageWays: [
            { mode: 'sentence_cadence', description: 'Alternate between wide and medium shot on each new sentence.' },
            { mode: 'beat_synchronized', description: 'Punch in on musical downbeats during musical montages.' },
        ],
        whenToUse: 'Long monologues or educational tutorials where the viewer needs constant visual stimulation.',
        whenNotToUse: 'Calm, contemplative documentaries or serious corporate announcements.',
        preconditions: ['Clips on timeline.'],
        parameters: {
            frequency: { type: 'string', enum: ['sentence', 'beat', 'periodic'], default: 'sentence' },
            scale: { type: 'number', default: 1.15 },
        },
    },

    layout_split_screen: {
        id: 'layout_split_screen',
        label: 'Split-screen layout',
        domain: EDITOR_SKILL_DOMAINS.VISUAL_FRAMING,
        destructive: false,
        cost: 'local',
        purpose: 'Arranges two visual sources side-by-side or top-and-bottom with controllable ratio, border, and divider styling.',
        usageWays: [
            { mode: 'interview_reaction', description: 'Show both interviewer and guest speaking and reacting concurrently.' },
            { mode: 'tutorial_demonstration', description: 'Show the instructor on one side and their screen/software on the other.' },
            { mode: 'before_after_comparison', description: 'Side-by-side comparison of color grading, cleanup, or transformation.' },
        ],
        whenToUse: 'When both speaker expression and demonstrative media must be seen simultaneously.',
        whenNotToUse: 'On mobile 9:16 screens if both subjects become uncomfortably narrow; prefer vertical stack.',
        preconditions: ['Two video or image assets.'],
        parameters: {
            ratio: { type: 'number', default: 0.5, min: 0.2, max: 0.8 },
            orientation: { type: 'string', enum: ['horizontal', 'vertical'], default: 'horizontal' },
            assetId: { type: 'string', required: true },
        },
    },

    layout_picture_in_picture: {
        id: 'layout_picture_in_picture',
        label: 'Picture-in-picture layout',
        domain: EDITOR_SKILL_DOMAINS.VISUAL_FRAMING,
        destructive: false,
        cost: 'local',
        purpose: 'Places a secondary video source in a corner thumbnail window over the primary footage, complete with border and rounded corners.',
        usageWays: [
            { mode: 'commentary_reaction', description: 'Speaker in bottom corner reacting to full-screen video.' },
            { mode: 'software_presentation', description: 'Speaker facecam in corner over full-frame slides or demo.' },
        ],
        whenToUse: 'Reaction videos, gaming streams, software walkthroughs, and executive presentations.',
        whenNotToUse: 'When the PiP overlay covers essential subtitles, text, or interface buttons on the background media.',
        preconditions: ['Two media clips.'],
        parameters: {
            position: { type: 'string', enum: ['bottom_right', 'bottom_left', 'top_right', 'top_left'], default: 'bottom_right' },
            scale: { type: 'number', default: 0.28, min: 0.15, max: 0.5 },
            assetId: { type: 'string', required: true },
        },
    },

    // ═════════════════════════════════════════════════════════════════════════
    // D. B-ROLL & ASSET PLACEMENT
    // ═════════════════════════════════════════════════════════════════════════
    place_contextual_broll: {
        id: 'place_contextual_broll',
        label: 'Place contextual B-roll',
        domain: EDITOR_SKILL_DOMAINS.BROLL_COVERAGE,
        destructive: false,
        cost: 'network',
        purpose: 'Matches spoken transcript entities (products, places, concepts, emotions) with uploaded or stock footage and places cutaways on track 2.',
        usageWays: [
            { mode: 'concept_illustration', description: 'Cuts away to B-roll when the speaker describes an abstract topic.' },
            { mode: 'jump_cut_masking', description: 'Places a 2-second B-roll cutaway directly over an unavoidable jump cut.' },
            { mode: 'atmospheric_pacing', description: 'Inserts scenic establishing B-roll at chapter transitions.' },
        ],
        whenToUse: 'Whenever a talking head speaks for more than 8-10 seconds without visual change.',
        whenNotToUse: 'Do not cover high-emotion personal storytelling where the viewer needs to see the speaker eyes and sincerity.',
        preconditions: ['Transcript is available.', 'Eligible B-roll assets in bin or stock service connected.'],
        parameters: {
            query: { type: 'string', required: false, description: 'Optional search theme or focus topic.' },
            limit: { type: 'number', default: 6, max: 20 },
            cutawayDuration: { type: 'number', default: 2.4, min: 1.0, max: 6.0 },
        },
    },

    fetch_stock_broll: {
        id: 'fetch_stock_broll',
        label: 'Search stock B-roll',
        domain: EDITOR_SKILL_DOMAINS.BROLL_COVERAGE,
        destructive: false,
        cost: 'network',
        purpose: 'Queries licensed stock libraries for high-resolution supplementary footage matching exact descriptive criteria.',
        usageWays: [
            { mode: 'targeted_visual', description: 'Search for specific visual objects ("coffee brewing in morning sunlight").' },
            { mode: 'ambient_background', description: 'Search for atmospheric texture ("cyberpunk city neon rain").' },
        ],
        whenToUse: 'When the creator lacks footage of a concept, location, or historical event mentioned in the script.',
        whenNotToUse: 'When personal branding or authenticity demands real footage of the creator or their team.',
        preconditions: ['Stock provider configured or network available.'],
        parameters: {
            query: { type: 'string', required: true },
            limit: { type: 'number', default: 5 },
        },
    },

    sync_cutaways: {
        id: 'sync_cutaways',
        label: 'Sync cutaways',
        domain: EDITOR_SKILL_DOMAINS.BROLL_COVERAGE,
        destructive: false,
        cost: 'local',
        purpose: 'Aligns secondary B-roll clips to audio downbeats, speech pauses, or narration landmarks with automated audio ducking.',
        usageWays: [
            { mode: 'beat_lock', description: 'Snaps in and out points of B-roll to nearest music transients.' },
            { mode: 'dialogue_envelope', description: 'Starts cutaways 0.2s after dialogue starts and ends 0.3s before sentence finish.' },
        ],
        whenToUse: 'After placing multiple B-roll clips to ensure they feel musically and rhythmically locked to the timeline.',
        whenNotToUse: 'When cutaways must sync to specific off-screen sound effects rather than general timeline rhythm.',
        preconditions: ['Clips on overlay track.'],
        parameters: {
            snapTo: { type: 'string', enum: ['beat', 'speech', 'sentence'], default: 'speech' },
        },
    },

    // ═════════════════════════════════════════════════════════════════════════
    // E. AUDIO INTELLIGENCE & MIXING
    // ═════════════════════════════════════════════════════════════════════════
    normalize_audio: {
        id: 'normalize_audio',
        label: 'Normalise audio',
        domain: EDITOR_SKILL_DOMAINS.AUDIO_INTELLIGENCE,
        destructive: false,
        cost: 'local',
        purpose: 'Brings dialogue to standardized platform loudness targets (e.g. -14 LUFS for YouTube, -16 LUFS for TikTok/Podcasts) preventing quiet or clipping audio.',
        usageWays: [
            { mode: 'platform_target', description: 'Normalizes master timeline to target platform LUFS specification.' },
            { mode: 'clip_leveling', description: 'Balances varying microphone volumes across multiple clips.' },
        ],
        whenToUse: 'Essential finishing step on every export to ensure consistent volume against other platform videos.',
        whenNotToUse: 'Do not re-normalize already mastered music tracks alongside raw uncompressed dialogue without separate gain staging.',
        preconditions: ['Audio track exists.'],
        parameters: {
            targetLufs: { type: 'number', default: -14, min: -24, max: -9 },
        },
    },

    denoise_audio: {
        id: 'denoise_audio',
        label: 'Clean audio / Denoise',
        domain: EDITOR_SKILL_DOMAINS.AUDIO_INTELLIGENCE,
        destructive: false,
        cost: 'analysis_or_compute',
        purpose: 'Attenuates HVAC hum, fan noise, microphone hiss, room echo, and outdoor wind without muffling vocal frequencies.',
        usageWays: [
            { mode: 'adaptive_spectral', description: 'Removes stationary background hiss and computer fan hum.' },
            { mode: 'de_reverb', description: 'Reduces hollow room reflections recorded in untreated spaces.' },
        ],
        whenToUse: 'Whenever footage was recorded on phone mics, untreated rooms, or noisy public environments.',
        whenNotToUse: 'When audio was already captured in a treated studio on a high-end dynamic mic; over-denoising causes metallic phasing.',
        preconditions: ['Audio track exists.'],
        parameters: {
            intensity: { type: 'number', default: 0.65, min: 0.1, max: 1.0 },
        },
    },

    add_sfx: {
        id: 'add_sfx',
        label: 'Add sound effect',
        domain: EDITOR_SKILL_DOMAINS.AUDIO_INTELLIGENCE,
        destructive: false,
        cost: 'local',
        purpose: 'Places acoustic emphasis (whoosh, hit, pop, riser, click) perfectly synchronized with graphic reveals, transitions, or text animations.',
        usageWays: [
            { mode: 'motion_accent', description: 'Whoosh or swish on card entrances, wipes, and fast camera pans.' },
            { mode: 'metric_impact', description: 'Bass thump or metallic ding on stat and number pop-ups.' },
            { mode: 'ui_feedback', description: 'Mechanical keyboard clicks or crisp pops on lower thirds and typewriter text.' },
        ],
        whenToUse: 'To give tactile physical weight to titles, motion graphics, and sudden visual transitions.',
        whenNotToUse: 'Never spam loud generic hits every two seconds; SFX must be mixed -12dB to -18dB relative to dialogue.',
        preconditions: ['Target graphic or timeline timestamp.'],
        parameters: {
            sfxId: { type: 'string', required: false },
            category: { type: 'string', enum: ['whoosh', 'impact', 'pop', 'riser', 'ui_click', 'sub_bass'], default: 'whoosh' },
            time: { type: 'number', required: false },
            volume: { type: 'number', default: 0.35, min: 0.05, max: 1.0 },
        },
    },

    // ═════════════════════════════════════════════════════════════════════════
    // F. COLOR & LOOK
    // ═════════════════════════════════════════════════════════════════════════
    apply_lut: {
        id: 'apply_lut',
        label: 'Apply a colour grade',
        domain: EDITOR_SKILL_DOMAINS.COLOR_FINISHING,
        destructive: false,
        cost: 'local',
        purpose: 'Applies a 3D LUT (Look-Up Table) transformation to harmonize skin tones, contrast, and color palette across the sequence.',
        usageWays: [
            { mode: 'cinematic_teal_orange', description: 'Separates warm skin tones from cool shadows for high production value.' },
            { mode: 'warm_golden_hour', description: 'Gentle warm glow for vlogs, personal storytelling, and lifestyle content.' },
            { mode: 'moody_editorial', description: 'Desaturated, high-contrast look for documentaries and investigative pieces.' },
        ],
        whenToUse: 'To unify shots from different cameras or elevate flat log/phone footage into polished filmic aesthetics.',
        whenNotToUse: 'Do not apply extreme stylized LUTs over heavily clipped highlights or severely underexposed footage.',
        preconditions: ['Video clips on timeline.'],
        parameters: {
            lutId: { type: 'string', required: false, default: 'cinematic' },
            intensity: { type: 'number', default: 0.8, min: 0.1, max: 1.0 },
        },
    },

    recommend_luts: {
        id: 'recommend_luts',
        label: 'Recommend colour grades',
        domain: EDITOR_SKILL_DOMAINS.COLOR_FINISHING,
        destructive: false,
        cost: 'local',
        purpose: 'Analyzes project genre, tone, and lighting conditions to suggest the 3 most complementary color grading looks.',
        usageWays: [
            { mode: 'palette_recommendation', description: 'Suggests looks based on footage color temperature and contrast.' },
        ],
        whenToUse: 'When the creator asks "what look should I use?" or when raw log footage is detected.',
        whenNotToUse: 'When the project already has an approved brand-kit color grade applied.',
        preconditions: ['Project exists.'],
        parameters: {},
    },

    // ═════════════════════════════════════════════════════════════════════════
    // G. CAPTIONS & OVERLAY TEXT
    // ═════════════════════════════════════════════════════════════════════════
    auto_captions: {
        id: 'auto_captions',
        label: 'Add captions',
        domain: EDITOR_SKILL_DOMAINS.CAPTIONS_TYPOGRAPHY,
        destructive: false,
        cost: 'analysis_or_compute',
        purpose: 'Generates animated, per-word synchronized subtitles formatted for 80%+ sound-off mobile social viewing.',
        usageWays: [
            { mode: 'karaoke_active_word', description: 'Highlights current spoken word in bright accent color with punch scale.' },
            { mode: 'sentence_pop', description: 'Renders 2-4 words per line with dynamic entrance animation.' },
            { mode: 'minimal_lower_third', description: 'Clean, non-distracting subtitling for corporate and educational content.' },
        ],
        whenToUse: 'Critical mandatory step for all TikTok, Instagram Reels, and YouTube Shorts content.',
        whenNotToUse: 'On videos where full-screen cinematic immersion is prioritized and audio is required (e.g. music videos).',
        preconditions: ['Speech audio present.'],
        parameters: {
            style: { type: 'string', enum: ['karaoke_bold', 'minimal_clean', 'hormozi_pop', 'editorial_serif'], default: 'karaoke_bold' },
            position: { type: 'string', enum: ['middle', 'lower', 'upper'], default: 'middle' },
        },
    },

    emphasize_keywords: {
        id: 'emphasize_keywords',
        label: 'Emphasize keywords in captions',
        domain: EDITOR_SKILL_DOMAINS.CAPTIONS_TYPOGRAPHY,
        destructive: false,
        cost: 'local',
        purpose: 'Scans subtitle text for emotionally or factually charged keywords and enlarges or highlights them with brand accent colors.',
        usageWays: [
            { mode: 'color_and_scale', description: 'Scales target words 1.25x and colors them with high-contrast yellow/cyan.' },
            { mode: 'box_highlight', description: 'Puts an animated highlighter box behind crucial nouns and statistics.' },
        ],
        whenToUse: 'To guide viewer eye tracking and emphasize core arguments in fast-paced short-form content.',
        whenNotToUse: 'Do not highlight every single word; keep emphasis to 1-2 words per sentence.',
        preconditions: ['Captions are generated on the timeline.'],
        parameters: {
            color: { type: 'string', default: '#FFE500' },
        },
    },

    design_scene: {
        id: 'design_scene',
        label: 'Design a graphics sequence',
        domain: EDITOR_SKILL_DOMAINS.CAPTIONS_TYPOGRAPHY,
        destructive: false,
        cost: 'analysis_or_compute',
        purpose: 'Designs a complete After Effects grade motion graphics sequence (intro, points, metrics, CTA) from natural language brief.',
        usageWays: [
            { mode: 'product_launch', description: 'Cinematic title sequence, 3 feature cards, metric pop, and call to action.' },
            { mode: 'educational_explainer', description: 'Numbered technical breakdown with leader line annotations and device frames.' },
            { mode: 'cartographic_travel', description: 'Vehicle route motion path across waypoint coordinates with location stamps.' },
            { mode: 'vox_documentary', description: '12fps tactile paper stop-motion with analog film grain and Playfair typography.' },
        ],
        whenToUse: 'Whenever the user wants a professional graphic segment created from scratch.',
        whenNotToUse: 'Do not use when only a single text label or small watermark is needed; use add_text_overlay.',
        preconditions: ['Brief describing desired sequence.'],
        parameters: {
            brief: { type: 'string', required: true, description: 'Creative brief detailing tone, content, and visual demands.' },
            asCompound: { type: 'boolean', default: false, description: 'Package as a single draggable compound clip on timeline.' },
        },
    },

    add_text_overlay: {
        id: 'add_text_overlay',
        label: 'Add text overlay',
        domain: EDITOR_SKILL_DOMAINS.CAPTIONS_TYPOGRAPHY,
        destructive: false,
        cost: 'local',
        purpose: 'Places an individual headline, lower-third tag, chapter marker, or watermark on the overlay track.',
        usageWays: [
            { mode: 'chapter_title', description: 'Centered header announcing a new section.' },
            { mode: 'lower_third_name', description: 'Name and title card identifying a speaker.' },
        ],
        whenToUse: 'For simple single-element text placements.',
        whenNotToUse: 'When a coordinated multi-element sequence with animations is requested; use design_scene.',
        preconditions: ['Text content provided.'],
        parameters: {
            text: { type: 'string', required: true },
            position: { type: 'string', enum: ['top', 'center', 'bottom', 'lower_third'], default: 'lower_third' },
            duration: { type: 'number', default: 3.5 },
        },
    },

    // ═════════════════════════════════════════════════════════════════════════
    // H. ASSEMBLY & MACROS
    // ═════════════════════════════════════════════════════════════════════════
    repurpose_shorts: {
        id: 'repurpose_shorts',
        label: 'Turn into a Short',
        domain: EDITOR_SKILL_DOMAINS.ASSEMBLY_MACROS,
        destructive: true,
        cost: 'analysis_or_compute',
        purpose: 'Converts horizontal 16:9 video into high-engagement 9:16 vertical video with speaker tracking, captions, and smart pacing.',
        usageWays: [
            { mode: 'smart_crop_center', description: 'Reframe with facial tracking centering speaker on 9:16 canvas.' },
            { mode: 'split_stack', description: 'Stack gameplay/B-roll on bottom and webcam on top.' },
        ],
        whenToUse: 'Transforming YouTube videos or podcasts into TikToks, Instagram Reels, and Shorts.',
        whenNotToUse: 'When the primary video is already 9:16 vertical.',
        preconditions: ['Horizontal video footage.'],
        parameters: {
            targetDuration: { type: 'number', default: 58, max: 90 },
            style: { type: 'string', enum: ['fast_paced', 'clean', 'cinematic'], default: 'fast_paced' },
        },
    },

    extract_short: {
        id: 'extract_short',
        label: 'Extract a Short',
        domain: EDITOR_SKILL_DOMAINS.ASSEMBLY_MACROS,
        destructive: true,
        cost: 'analysis_or_compute',
        purpose: 'Finds the highest-potential 30-60 second segment in long-form video and extracts it as an independent short.',
        usageWays: [
            { mode: 'best_soundbite', description: 'Extracts the highest-scoring hook and explanation segment.' },
        ],
        whenToUse: 'Extracting viral soundbites from long podcasts or lectures.',
        whenNotToUse: 'On videos that are already under 60 seconds.',
        preconditions: ['Long-form video with transcript.'],
        parameters: {
            duration: { type: 'number', default: 55, max: 60 },
        },
    },

    macro_clean_and_polish: {
        id: 'macro_clean_and_polish',
        label: 'Clean and polish the edit',
        domain: EDITOR_SKILL_DOMAINS.ASSEMBLY_MACROS,
        destructive: true,
        cost: 'analysis_or_compute',
        purpose: 'One-click autonomous master pipeline: dead air removal, filler culling, voice normalization, audio denoise, and captioning.',
        usageWays: [
            { mode: 'full_autonomous_pass', description: 'Executes the standard professional editing pipeline as an atomic transaction.' },
        ],
        whenToUse: 'When the user says "clean this up", "make this good", "edit my video", or "polish this project".',
        whenNotToUse: 'When the user asks for a surgical change on a single isolated clip.',
        preconditions: ['Raw footage on timeline.'],
        parameters: {
            style: { type: 'string', enum: ['podcast', 'vlog', 'reel', 'talking_head'], default: 'talking_head' },
        },
    },
});

/**
 * ─── 3. AUTONOMOUS MULTI-TOOL RECIPES ────────────────────────────────────────
 * Defines proven multi-step editing pipelines that ROKA can orchestrate as
 * single-undo atomic transactions.
 */
const AUTONOMOUS_RECIPES = Object.freeze({
    FULL_PRODUCTION_POLISH: {
        id: 'FULL_PRODUCTION_POLISH',
        label: 'Master Autonomous Production Chain',
        description: 'Complete end-to-end transformation from raw footage to published-ready edit.',
        steps: [
            { command: 'silence_removal', why: 'Eliminate dead air and establish energetic pacing spine.' },
            { command: 'remove_filler_words', why: 'Eliminate vocal hesitations for crisp, authoritative delivery.' },
            { command: 'denoise_audio', why: 'Remove background noise and room acoustic reflections.' },
            { command: 'normalize_audio', why: 'Bring master dialogue to platform loudness target.' },
            { command: 'rhythm_zoom', why: 'Introduce visual dynamics across alternating sentences.' },
            { command: 'sync_cutaways', why: 'Cut away to relevant B-roll over spoken concepts.' },
            { command: 'auto_captions', why: 'Generate synchronized per-word subtitles.' },
            { command: 'emphasize_keywords', why: 'Color and scale key emotional words in subtitles.' },
            { command: 'apply_lut', why: 'Harmonize skin tones and apply cinematic color grade.' },
        ],
    },

    VIRAL_SHORT_ACCELERATOR: {
        id: 'VIRAL_SHORT_ACCELERATOR',
        label: 'Viral Short Extraction & Polish',
        description: 'Repurposes and polishes high-retention vertical short-form content.',
        steps: [
            { command: 'set_aspect_ratio', params: { ratio: '9:16' }, why: 'Reframe canvas for mobile vertical consumption.' },
            { command: 'extract_short', why: 'Locate highest-curiosity moment and place at 0:00.' },
            { command: 'silence_removal', params: { threshold: '-30dB', minSilenceDuration: 0.28 }, why: 'Tighten pauses aggressively for mobile attention spans.' },
            { command: 'zoom_speaker', why: 'Keep speaker face centered in vertical format.' },
            { command: 'auto_captions', params: { style: 'karaoke_bold' }, why: 'Deliver bold karaoke subtitles for sound-off viewing.' },
            { command: 'emphasize_keywords', why: 'Highlight punch words in bright neon accents.' },
            { command: 'add_sfx', params: { category: 'whoosh' }, why: 'Add acoustic hit on hook entrance.' },
        ],
    },

    INTERVIEW_DIALOGUE_MASTERY: {
        id: 'INTERVIEW_DIALOGUE_MASTERY',
        label: 'Interview & Podcast Flow Optimization',
        description: 'Polishes two-person interviews with turn-taking pacing and clean vocal tracks.',
        steps: [
            { command: 'detect_speakers', why: 'Diarize distinct voices in conversation.' },
            { command: 'silence_removal', params: { minSilenceDuration: 0.6 }, why: 'Trim awkward turn-taking pauses while preserving natural breath.' },
            { command: 'normalize_audio', why: 'Level volume balance between both speakers.' },
            { command: 'denoise_audio', why: 'Clean room reverberation.' },
            { command: 'auto_captions', params: { style: 'editorial_serif' }, why: 'Add elegant speaker-differentiated subtitles.' },
            { command: 'apply_lut', params: { lutId: 'cinematic' }, why: 'Unify lighting differences across camera angles.' },
        ],
    },
});

/**
 * ─── 4. INTENT CLASSIFICATION & KNOWLEDGE RETRIEVAL APIS ────────────────────
 */

/**
 * Classifies a user prompt into relevant editor skill domains with confidence scores.
 *
 * @param {string} prompt
 * @returns {Array<{ domain: string, score: number }>}
 */
function classifyEditorSkills(prompt) {
    const s = String(prompt || '').toLowerCase();
    const hits = [];

    const patterns = [
        { domain: EDITOR_SKILL_DOMAINS.TIMELINE_CUTS, regex: /\b(cut|split|trim|remove clip|reorder|ripple|transition|fade|dissolve|speed|slow[- ]?mo|timelapse)\b/i, weight: 1.2 },
        { domain: EDITOR_SKILL_DOMAINS.PACING_CLEANUP, regex: /\b(silence|dead air|pause|filler|um|uh|repetition|repeated|clean up|tighten|hook|quotable)\b/i, weight: 1.3 },
        { domain: EDITOR_SKILL_DOMAINS.VISUAL_FRAMING, regex: /\b(zoom|punch[- ]?in|framing|reframe|split[- ]?screen|picture in picture|pip|facecam|crop)\b/i, weight: 1.1 },
        { domain: EDITOR_SKILL_DOMAINS.BROLL_COVERAGE, regex: /\b(b[- ]?roll|cutaway|stock footage|footage of|illustrat|asset|coverage|footage)\b/i, weight: 1.2 },
        { domain: EDITOR_SKILL_DOMAINS.AUDIO_INTELLIGENCE, regex: /\b(audio|volume|sound|denoise|noise|clean audio|normalize|loudness|sfx|sound effect|whoosh|hit)\b/i, weight: 1.2 },
        { domain: EDITOR_SKILL_DOMAINS.COLOR_FINISHING, regex: /\b(color|grade|lut|cinematic look|warm|moody|filter|saturation|contrast)\b/i, weight: 1.1 },
        { domain: EDITOR_SKILL_DOMAINS.CAPTIONS_TYPOGRAPHY, regex: /\b(caption|subtitles?|karaoke|text|headline|title|keyword|lower third|words|motion graphic)\b/i, weight: 1.3 },
        { domain: EDITOR_SKILL_DOMAINS.ASSEMBLY_MACROS, regex: /\b(short|repurpose|tiktok|reel|polish|master|script to video|montage|auto edit)\b/i, weight: 1.2 },
    ];

    for (const p of patterns) {
        if (p.regex.test(s)) {
            hits.push({ domain: p.domain, score: p.weight });
        }
    }

    return hits.sort((a, b) => b.score - a.score);
}

/**
 * Returns the complete craft contract for a given tool ID.
 *
 * @param {string} toolId
 * @returns {object|null}
 */
function getToolContract(toolId) {
    return TOOL_REGISTRY[toolId] || null;
}

/**
 * Returns all tools belonging to a skill domain.
 *
 * @param {string} domain
 * @returns {Array<object>}
 */
function getToolsByDomain(domain) {
    return Object.values(TOOL_REGISTRY).filter(tool => tool.domain === domain);
}

/**
 * Synthesizes an intelligent craft guidance block for the Editorial Brain (ROKA).
 * Injected into ROKA system prompts so the AI understands not just tool names,
 * but why, how, and in what combinations to deploy them.
 *
 * @param {Array<string>} availableCommandIds
 * @param {object} [context]
 * @returns {string}
 */
function buildEditorKnowledgePrompt(availableCommandIds = [], context = {}) {
    const readySet = new Set(availableCommandIds);
    const relevantTools = Object.values(TOOL_REGISTRY).filter(t => readySet.has(t.id));

    const domainSections = [];
    const grouped = new Map();
    for (const tool of relevantTools) {
        if (!grouped.has(tool.domain)) grouped.set(tool.domain, []);
        grouped.get(tool.domain).push(tool);
    }

    for (const [domain, tools] of grouped.entries()) {
        const toolSummaries = tools.map(t => {
            const usageModes = (t.usageWays || []).map(u => `      • ${u.mode}: ${u.description}`).join('\n');
            return `  ▸ ${t.id} ("${t.label}"):
    Purpose: ${t.purpose}
    Optimal When: ${t.whenToUse}
    Anti-pattern / Avoid When: ${t.whenNotToUse}
    Distinct Usage Modes:
${usageModes}`;
        }).join('\n\n');

        domainSections.push(`[${domain.toUpperCase()}]\n${toolSummaries}`);
    }

    return `═══════════════════════════════════════════════
AUTONOMOUS EDITOR CRAFT & TOOL INTELLIGENCE (ROKA Engine)
═══════════════════════════════════════════════
You have deep editorial mastery over every editor tool. Do not simply pick random tools.
Execute with intention, respect temporal logic, and apply multi-step production pipelines.

CORE EDITORIAL PRINCIPLES:
1. Pacing First: Remove dead air (silence_removal) and hesitation before adding cosmetics. A clean spine multiplies the impact of every visual layer.
2. Purposeful Framing: Never zoom without reason. Use subtle punch-ins (1.15x) for rhetorical emphasis and smart facial zooms to reframe.
3. Audio Grounding: Voice clarity and volume consistency outrank visual effects. Always normalize to platform standards (-14 LUFS) and clean room hiss.
4. Cutaway Timing: Contextual B-roll must illustrate spoken thoughts or cover unavoidable jump cuts. Never obscure emotional eye contact.
5. Atomic Transactions: All multi-step edits execute as an atomic unit — one single undo restores the project cleanly.

RELEVANT TOOL MASTERY (Ready for this project):
${domainSections.length ? domainSections.join('\n\n') : 'All standard editor tools available; verify preconditions against active timeline state.'}

STANDARD AUTONOMOUS COMPOSITION RECIPES:
• Full Polish Pipeline: silence_removal → remove_filler_words → denoise_audio → normalize_audio → rhythm_zoom → sync_cutaways → auto_captions → emphasize_keywords → apply_lut.
• Viral Short Pipeline: set_aspect_ratio (9:16) → extract_short → silence_removal (-30dB) → zoom_speaker → auto_captions (karaoke) → emphasize_keywords → add_sfx (whoosh).
• Interview Pacing: detect_speakers → silence_removal (0.6s) → normalize_audio → denoise_audio → auto_captions (editorial).`;
}

module.exports = {
    VIBED_EDITOR_KNOWLEDGE_VERSION,
    EDITOR_SKILL_DOMAINS,
    TOOL_REGISTRY,
    AUTONOMOUS_RECIPES,
    classifyEditorSkills,
    getToolContract,
    getToolsByDomain,
    buildEditorKnowledgePrompt,
};
