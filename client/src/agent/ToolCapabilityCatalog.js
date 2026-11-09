const READ_ONLY = new Set(['locate_visual_targets', 'identify_quotable_moments', 'recommend_luts']);
const ANALYSIS = new Set(['locate_visual_targets', 'identify_quotable_moments', 'auto_captions']);
const NETWORK = new Set(['fetch_stock_broll', 'create_video_from_script', 'create_video_from_assets', 'place_contextual_broll']);
const EXPENSIVE = new Set(['create_video_from_script', 'create_video_from_assets', 'auto_captions', 'silence_removal', 'remove_filler_words']);

/** Attach a machine-readable execution contract to every callable tool. */
export function describeToolCapabilities(definitions = []) {
    return definitions.map(definition => {
        const name = String(definition.name || '');
        const readOnly = READ_ONLY.has(name);
        const analysis = ANALYSIS.has(name);
        const params = definition.parameters || {};
        return {
            name,
            description: definition.description || '',
            inputs: params,
            preconditions: [
                'The active project is available.',
                ...((params.required || []).length ? [`Required inputs are present: ${params.required.join(', ')}.`] : []),
                ...(analysis ? ['Required source assets are available and analysis is complete or can be started.'] : []),
            ],
            effects: readOnly ? ['Reads project or media analysis; does not modify the timeline.'] : ['May modify the active project timeline or asset state.'],
            cost: NETWORK.has(name) ? 'network' : EXPENSIVE.has(name) ? 'analysis_or_compute' : analysis ? 'analysis' : 'local',
            verification: readOnly
                ? 'Return typed findings or an explicit empty result with evidence/status.'
                : 'Return success only after the operation reports completion; verify the resulting timeline or asset postcondition.',
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
