const READ_ONLY = new Set([
    'search_uploaded_assets', 'locate_visual_targets', 'identify_quotable_moments',
    'recommend_luts', 'recommend_sfx', 'recommend_presets', 'search_assets',
    'search_sfx', 'search_luts', 'search_presets', 'analyze_structure', 'find_hook'
]);

const ANALYSIS = new Set([
    'locate_visual_targets', 'identify_quotable_moments', 'auto_captions',
    'find_hook', 'detect_speakers', 'detect_scene', 'analyze_structure'
]);

const NETWORK = new Set([
    'fetch_stock_broll', 'create_video_from_script', 'create_video_from_assets',
    'place_contextual_broll'
]);

const EXPENSIVE = new Set([
    'create_video_from_script', 'create_video_from_assets', 'auto_captions',
    'silence_removal', 'remove_filler_words', 'repurpose_shorts', 'macro_clean_and_polish',
    'macro_multicam', 'apply_style_recipe'
]);

/** Attach a machine-readable execution contract to every callable tool. */
export function describeToolCapabilities(definitions = []) {
    return definitions.map(definition => {
        const name = String(definition.name || '');
        const readOnly = READ_ONLY.has(name);
        const analysis = ANALYSIS.has(name);

        let effects;
        let verification;
        let preconditions = [
            'The active project is available.',
            ...((definition.parameters?.required || []).length ? [`Required inputs are present: ${definition.parameters.required.join(', ')}.`] : []),
        ];

        // Specific tool contract descriptions
        if (readOnly) {
            effects = ['Reads project or media analysis; does not modify the timeline.'];
            verification = 'Return typed findings or an explicit empty result with evidence/status.';
        } else if (name === 'silence_removal') {
            effects = ['Splits and removes pauses/dead air below threshold from speech clips, shifting subsequent clips left.'];
            verification = 'Verify timeline duration is reduced, clip count increased, and no word boundaries were clipped.';
            preconditions.push('Timeline has spoken audio/video clips and transcript/waveform available.');
        } else if (name === 'remove_filler_words') {
            effects = ['Splits and deletes detected verbal filler words ("um", "uh", "like") from speech clips.'];
            verification = 'Verify targeted filler timestamp ranges were removed from timeline speech clips.';
            preconditions.push('Word-level transcript timestamps are present.');
        } else if (name === 'remove_repetition') {
            effects = ['Culls repeated false starts and restated takes, keeping the best/final take.'];
            verification = 'Verify redundant take clusters are removed while narrative continuity remains intact.';
            preconditions.push('Transcript is available.');
        } else if (name === 'apply_zoom' || name === 'apply_smart_zoom' || name === 'rhythm_zoom') {
            effects = ['Applies digital scale/crop (1.1x–1.5x) or facial tracking punch-in to target video clips.'];
            verification = 'Verify target video clip contains updated transform scale and position coordinates.';
            preconditions.push('At least one video clip exists on the timeline.');
        } else if (name === 'place_contextual_broll') {
            effects = ['Places relevant illustrative stock or bin footage cutaways on the overlay track matching spoken concepts.'];
            verification = 'Verify overlay track contains new cutaway clips aligned with transcript timestamps.';
            preconditions.push('Transcript and eligible B-roll assets are available.');
        } else if (name === 'normalize_audio') {
            effects = ['Adjusts clip gain / master timeline volume to platform target loudness (-14 to -16 LUFS).'];
            verification = 'Verify audio track or clips reflect updated target volume level without digital clipping.';
            preconditions.push('At least one audio or video clip with sound exists on the timeline.');
        } else if (name === 'denoise_audio') {
            effects = ['Applies spectral noise reduction and de-reverberation to vocal tracks.'];
            verification = 'Verify denoise filter is applied with valid intensity and audio playback is clean.';
            preconditions.push('Audio track with dialogue exists.');
        } else if (name === 'add_sfx') {
            effects = ['Places an acoustic effect (whoosh, impact, riser, pop) on the audio track synchronized with visual event.'];
            verification = 'Verify an SFX audio clip is placed at the specified timestamp at balanced mix volume.';
            preconditions.push('Audio track is available.');
        } else if (name === 'apply_lut' || name === 'color_grade_clip') {
            effects = ['Applies 3D LUT or primary color grading matrix to video clips for unified cinematic look.'];
            verification = 'Verify target clips have lutId or color grade parameters registered in timeline state.';
            preconditions.push('Video clips exist on the timeline.');
        } else if (name === 'auto_captions') {
            effects = ['Generates synchronized per-word subtitles on the text/caption track.'];
            verification = 'Verify caption track exists and contains synchronized subtitle word blocks.';
            preconditions.push('Spoken dialogue audio is present on the timeline.');
        } else if (name === 'emphasize_keywords') {
            effects = ['Applies punchy scale, highlight boxes, or accent colors to high-impact words in captions.'];
            verification = 'Verify caption words contain keyword emphasis styling attributes.';
            preconditions.push('Captions are present on the timeline.');
        } else if (name === 'design_scene') {
            effects = ['Creates a checked, editable multi-layer motion graphics scene and places flattened layers on the timeline.'];
            verification = 'Verify that the returned scene ID exists and that its expected timeline layers were placed before reporting success.';
        } else if (name === 'add_motion_component') {
            effects = ['Creates a scene-backed motion component and places its editable layers on the timeline.'];
            verification = 'Verify that the returned component scene exists and its layers are placed.';
        } else if (name === 'compose_motion') {
            effects = ['Adds validated keyframe animation to compatible timeline layers.'];
            verification = 'Verify that at least one target layer now has the requested animation; report failure if no compatible layer was changed.';
        } else if (name === 'apply_motion_expression') {
            effects = ['Applies an evaluated sandbox motion expression (wiggle, loopOut, audioAmp, spring) to target property.'];
            verification = 'Verify that the expression is syntactically valid and saved to the target clip expressions map.';
        } else if (name === 'set_track_matte') {
            effects = ['Configures alpha or luminance track matte mask to cut out or reveal target layer.'];
            verification = 'Verify that both target and source layers exist and trackMatte is configured.';
        } else if (name === 'set_layer_parent') {
            effects = ['Links child layer to parent layer with relative coordinate inheritance and cycle check.'];
            verification = 'Verify that parent exists, no cyclic reference is created, and parentId is applied.';
        } else if (name === 'set_vector_trim') {
            effects = ['Configures trimStart, trimEnd, and trimOffset kinetic stroke animation on vector layers.'];
            verification = 'Verify that trim properties or kinetic draw-on keyframes are applied to target clip.';
        } else if (name === 'apply_aesthetic_preset') {
            effects = ['Applies a complete creator aesthetic look across color grade, effect rack, and typography.'];
            verification = 'Verify that color grade, effects rack, and typography updates are saved.';
        } else if (name === 'apply_motion_effect_stack') {
            effects = ['Appends an ordered effect stack to targeted video clips, or replaces it when replaceExisting is true. Existing effects are preserved by default.'];
            verification = 'Return success only after every target clip contains every requested effect ID; return an explicit failure when validation or persistence fails.';
        } else if (name === 'split_clip' || name === 'cut_clip') {
            effects = ['Splits target clip into two contiguous segments at the designated time.'];
            verification = 'Verify target track contains two adjacent clips with split boundary matching the timestamp.';
            preconditions.push('Target clip is present on the specified track.');
        } else if (name === 'reorder_clips') {
            effects = ['Rearranges selected clips in the specified chronological or narrative order.'];
            verification = 'Verify clips appear in the target sequence without missing frames.';
            preconditions.push('Specified clip IDs exist on the timeline.');
        } else if (name === 'layout_split_screen' || name === 'layout_picture_in_picture') {
            effects = ['Configures multi-source spatial layout (side-by-side or picture-in-picture frame).'];
            verification = 'Verify secondary asset is placed on overlay track with correct positioning and scale.';
            preconditions.push('Both primary and secondary media assets are available.');
        } else if (name === 'repurpose_shorts' || name === 'macro_clean_and_polish') {
            effects = ['Executes master multi-step pipeline (aspect ratio, silence, zooms, captions, grade) as an atomic transaction.'];
            verification = 'Verify timeline state reflects the completed macro goals and history allows single-step rollback.';
            preconditions.push('Source video footage is present.');
        } else {
            effects = ['Modifies the active project timeline, track hierarchy, or asset state.'];
            verification = 'Return success only after the operation reports completion; verify the resulting timeline postcondition.';
        }

        const params = definition.parameters || {};
        return {
            name,
            description: definition.description || '',
            inputs: params,
            preconditions,
            effects,
            cost: NETWORK.has(name) ? 'network' : EXPENSIVE.has(name) ? 'analysis_or_compute' : analysis ? 'analysis' : 'local',
            verification,
            mutatesProject: !readOnly,
        };
    });
}

export function validateToolInvocation(definition, args = {}) {
    if (!definition) return { success: false, error: 'Tool is not registered.' };
    const required = definition.parameters?.required || [];
    const missing = required.filter(key => args[key] === undefined || args[key] === null || args[key] === '');
    return missing.length
        ? { success: false, error: `Missing required tool input(s): ${missing.join(', ')}.` }
        : { success: true };
}
