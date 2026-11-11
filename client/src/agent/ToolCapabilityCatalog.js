const READ_ONLY = new Set(['search_uploaded_assets', 'locate_visual_targets', 'identify_quotable_moments', 'recommend_luts']);
const ANALYSIS = new Set(['locate_visual_targets', 'identify_quotable_moments', 'auto_captions']);
const NETWORK = new Set(['fetch_stock_broll', 'create_video_from_script', 'create_video_from_assets', 'place_contextual_broll']);
const EXPENSIVE = new Set(['create_video_from_script', 'create_video_from_assets', 'auto_captions', 'silence_removal', 'remove_filler_words']);

/** Attach a machine-readable execution contract to every callable tool. */
export function describeToolCapabilities(definitions = []) {
    return definitions.map(definition => {
        const name = String(definition.name || '');
        const readOnly = READ_ONLY.has(name);
        const analysis = ANALYSIS.has(name);
        const footageEffects = name === 'apply_motion_effect_stack';
        const sceneDesign = name === 'design_scene';
        const motionComponent = name === 'add_motion_component';
        const customMotion = name === 'compose_motion';
        const effects = readOnly
            ? ['Reads project or media analysis; does not modify the timeline.']
            : footageEffects
                ? ['Appends an ordered effect stack to targeted video clips, or replaces it when replaceExisting is true. Existing effects are preserved by default.']
                : sceneDesign
                    ? ['Creates a checked, editable scene and places its flattened layers on the timeline.']
                    : motionComponent
                        ? ['Creates a scene-backed motion component and places its editable layers on the timeline.']
                        : customMotion
                            ? ['Adds validated keyframe animation to compatible timeline layers.']
                            : ['May modify the active project timeline or asset state.'];
        const verification = readOnly
            ? 'Return typed findings or an explicit empty result with evidence/status.'
            : footageEffects
                ? 'Return success only after every target clip contains every requested effect ID; return an explicit failure when validation or persistence fails.'
                : sceneDesign || motionComponent
                    ? 'Verify that the returned scene ID exists and that its expected timeline layers were placed before reporting success.'
                    : customMotion
                        ? 'Verify that at least one target layer now has the requested animation; report failure if no compatible layer was changed.'
                        : 'Return success only after the operation reports completion; verify the resulting timeline or asset postcondition.';
        const params = definition.parameters || {};
        return {
            name,
            description: definition.description || '',
            inputs: params,
            preconditions: [
                'The active project is available.',
                ...((params.required || []).length ? [`Required inputs are present: ${params.required.join(', ')}.`] : []),
                ...(analysis ? ['Required source assets are available and analysis is complete or can be started.'] : []),
                ...(footageEffects ? ['A target video clip is selected or the playhead overlaps a video clip.', 'Every requested effect and parameter is supported by the shared preview/export effect adapter.'] : []),
                ...(motionComponent ? ['The requested component is in the engine component catalogue.', 'Any requested media assets already exist in the project asset manifest.'] : []),
                ...(customMotion ? ['At least one compatible title, caption, shape, sticker, image, or graphic is on the timeline.'] : []),
            ],
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
