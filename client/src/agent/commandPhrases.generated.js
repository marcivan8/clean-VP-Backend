/**
 * client/src/agent/commandPhrases.generated.js
 *
 * GENERATED — do not edit. Run: npm run catalog:generate
 * Source: client/src/agent/CommandRegistry.js (via the capability catalogue).
 *
 * id → the canonical natural-language phrase for that command, each one
 * verified to resolve back to its own id through resolveCommand().
 *
 * Why phrases and not ids: the executor takes English. EditJobManager hands a
 * prompt to IntentParser, and several handlers read parameters out of that
 * text (polish_short resolves its platform from the prompt and defaults to
 * 'tiktok' when nothing is named). A planner inserting a step therefore has to
 * emit a phrase, not an id.
 */

export const COMMAND_PHRASE = Object.freeze({
    "detect_scene": "analyze the framing",
    "detect_speakers": "Detect speakers",
    "add_sfx": "Add a sound effect",
    "add_sticker": "Add an icon or emoji",
    "adjust_volume": "lower the volume",
    "denoise_audio": "Reduce noise",
    "enhance_audio": "Enhance the voice",
    "normalize_audio": "Normalise audio",
    "create_video_from_assets": "create a video from the attached images and video clips",
    "create_video_from_script": "create a video from this script",
    "extract_short": "Extract a short",
    "remove_filler_words": "Remove filler words",
    "remove_repetition": "Remove repetition",
    "remove_speaker": "remove the interviewer",
    "repurpose_shorts": "Repurpose into shorts",
    "resume_failed_job": "Continue the edit",
    "semantic_cut": "remove the part where",
    "silence_removal": "Remove silences",
    "split_by_speaker": "split at speaker changes",
    "sync_cutaways": "sync b roll to the words",
    "queue_export": "Export",
    "apply_style_recipe": "Apply a style recipe",
    "macro_clean_and_polish": "clean it up and make it dynamic",
    "macro_multicam": "Full multicam pass",
    "add_motion_component": "add a title sequence",
    "add_template": "add an underline",
    "add_text_overlay": "Add text",
    "auto_captions": "Add captions",
    "clear_keywords": "Remove key word highlights",
    "design_scene": "Design a graphics sequence",
    "emphasize_keywords": "Highlight key words",
    "place_contextual_illustrations": "Add contextual vector illustrations",
    "set_brand_kit": "Set the brand colours and fonts",
    "storyboard_video": "Storyboard the whole video",
    "add_transition": "add a transition",
    "organize_clips": "Organise clips",
    "remove_clip": "delete the selected clip",
    "set_aspect_ratio": "change the aspect ratio",
    "set_clip_speed": "change the speed",
    "split_clip": "Split at playhead",
    "undo_action": "Undo",
    "add_blur_zone": "add a blur zone",
    "add_shadow": "Add a shadow",
    "animate_automatically": "Animate automatically",
    "apply_angle": "Apply camera angles",
    "apply_lut": "Apply a LUT",
    "apply_motion_effect_stack": "add motion effects to footage",
    "clear_lut": "clear the lut",
    "color_grade": "Colour grade",
    "compose_motion": "Design the motion",
    "crop_clip": "Crop / punch in",
    "layout_fullscreen": "Full-screen cutaway",
    "layout_picture_in_picture": "Picture in picture",
    "layout_split_screen": "Split screen",
    "polish_short": "Pro short finish",
    "recommend_luts": "Recommend LUTs",
    "remove_background": "Remove the background",
    "remove_blur_zone": "Remove the blur zone",
    "remove_shadow": "Remove the shadow",
    "reset_crop": "Reset framing",
    "rhythm_zoom": "Add zoom rhythm",
    "sandwich_text": "Place text behind speaker",
    "track_speaker": "Track the speaker",
    "zoom_speaker": "Zoom to the speaker"
});

/** The executable phrase for a command id, or null. */
export function phraseFor(id) {
    return COMMAND_PHRASE[id] || null;
}

export default { COMMAND_PHRASE, phraseFor };
