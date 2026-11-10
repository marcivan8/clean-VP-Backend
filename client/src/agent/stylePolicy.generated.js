/**
 * client/src/agent/stylePolicy.generated.js
 *
 * GENERATED — do not edit. Run: npm run catalog:generate
 * Source: server/brain/editingStyles.js (the structured style predicates).
 *
 * Exists so the client planner can read what a style must NOT do. The server
 * held those rules (sfxLevel, expectsMusic, keepsRecordedOrder, isCalmStyle,
 * rhythmZoomStyle, STYLE_FOCUS.aside) in CommonJS; the client's own
 * EditingStyles.js holds only mechanical knobs. Copying them by hand would
 * have made a fourth definition of the same rules, so they are generated and
 * drift-tested instead.
 *
 * `aside` and `priorities` are prose for explanations. Decisions are made from
 * the booleans and `sfxLevel`, never by parsing those strings.
 */

export const STYLE_POLICY = Object.freeze({
    "vlog": {
        "id": "vlog",
        "label": "Vlog",
        "platform": null,
        "sfxLevel": "full",
        "expectsMusic": true,
        "keepsRecordedOrder": true,
        "calm": false,
        "allowPunchIns": true,
        "motions": null,
        "preferredCommands": [
            "silence_removal",
            "enhance_audio",
            "add_transition",
            "auto_captions",
            "place_contextual_illustrations"
        ],
        "aside": [
            "removing every filler word",
            "hook-first reordering"
        ],
        "priorities": [
            "The story in recorded order, with clear beats",
            "B-roll and transitions between places",
            "A music bed under the talking",
            "Natural pacing (keep the personality, cut only dead air)"
        ]
    },
    "talking_head": {
        "id": "talking_head",
        "label": "Talking head",
        "platform": null,
        "sfxLevel": "subtle",
        "expectsMusic": false,
        "keepsRecordedOrder": false,
        "calm": false,
        "allowPunchIns": true,
        "motions": null,
        "preferredCommands": [
            "silence_removal",
            "remove_filler_words",
            "remove_repetition",
            "rhythm_zoom",
            "auto_captions",
            "enhance_audio"
        ],
        "aside": [
            "music beds unless asked",
            "heavy b-roll"
        ],
        "priorities": [
            "Pacing: silences, filler words and repeated takes",
            "Zoom rhythm to hold attention on a single speaker",
            "Captions for sound-off viewing",
            "Voice clarity and loudness"
        ]
    },
    "interview": {
        "id": "interview",
        "label": "Interview",
        "platform": null,
        "sfxLevel": "none",
        "expectsMusic": false,
        "keepsRecordedOrder": true,
        "calm": true,
        "allowPunchIns": false,
        "motions": [
            "push_in",
            "static"
        ],
        "preferredCommands": [
            "silence_removal",
            "auto_captions",
            "apply_angle",
            "detect_speakers"
        ],
        "aside": [
            "hook-first reordering",
            "impact sound effects",
            "music beds"
        ],
        "priorities": [
            "Keep every question with its answer, in order",
            "Trim dead air between turns",
            "Camera angle on the active speaker",
            "Quotable moments for social"
        ]
    },
    "podcast": {
        "id": "podcast",
        "label": "Podcast",
        "platform": "podcast",
        "sfxLevel": "none",
        "expectsMusic": false,
        "keepsRecordedOrder": true,
        "calm": true,
        "allowPunchIns": false,
        "motions": [
            "push_in",
            "static"
        ],
        "preferredCommands": [
            "enhance_audio",
            "normalize_audio",
            "silence_removal",
            "auto_captions",
            "repurpose_shorts"
        ],
        "aside": [
            "impact sound effects",
            "fast zooms",
            "music beds",
            "flashy transitions",
            "reordering the conversation"
        ],
        "priorities": [
            "Audio: clean voices at standard loudness",
            "Dead air between turns",
            "Readable captions",
            "The best exchanges as shorts for social"
        ]
    },
    "reel": {
        "id": "reel",
        "label": "Reel",
        "platform": "instagram_reels",
        "sfxLevel": "full",
        "expectsMusic": true,
        "keepsRecordedOrder": false,
        "calm": false,
        "allowPunchIns": true,
        "motions": null,
        "preferredCommands": [
            "extract_short",
            "set_aspect_ratio",
            "auto_captions",
            "polish_short",
            "rhythm_zoom"
        ],
        "aside": [
            "long-form structure (intro, chapters, outro)"
        ],
        "priorities": [
            "Hook in the first 2 seconds",
            "Length in the platform sweet spot (TikTok 21 to 34 s, Reels 15 to 30 s, Shorts 30 to 50 s)",
            "9:16 with the speaker framed",
            "Bold captions kept clear of the app buttons",
            "Energy: tight cuts, zooms, sound effects"
        ]
    }
});

export const STYLE_POLICY_IDS = Object.freeze(["vlog","talking_head","interview","podcast","reel"]);

/** Policy for a style id, or null when none is set / it is unknown. */
export function stylePolicy(id) {
    return STYLE_POLICY[id] || null;
}

export default { STYLE_POLICY, STYLE_POLICY_IDS, stylePolicy };
