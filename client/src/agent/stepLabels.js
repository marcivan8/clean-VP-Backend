import { COMMAND_BY_ID } from './CommandRegistry.js';

/**
 * A human name for a command that is about to run.
 *
 * Most engine actions share an id with a CommandRegistry entry, which already
 * carries a written label ("Remove silences"). The ones that do not are either
 * listed below or humanised from the action name, so a progress list never
 * shows a raw snake_case token to someone who just uploaded a video.
 */

// Engine actions with no registry entry that a user is likely to see in an
// Auto run. Everything else falls through to humanise().
const OVERRIDES = {
    smart_cleanup:               'Clean it up',
    semantic_cut:                'Cut to the point',
    cut_source_range:            'Trim the source',
    apply_smart_zoom:            'Add the zoom',
    apply_zoom:                  'Add the zoom',
    auto_sfx:                    'Add the sound',
    place_sfx:                   'Add the sound',
    blur_background:             'Blur the background',
    put_text_behind_speaker:     'Put the text behind the speaker',
    virtual_multicam:            'Build the angles',
    split_speakers:              'Split the speakers',
    separate_speaker:            'Separate the speaker',
    remove_speaker:              'Remove the speaker',
    identify_quotable_moments:   'Find the best moments',
    add_transitions_to_sections: 'Add the transitions',
    queue_export:                'Export it',
    seek_to:                     null,   // housekeeping — never shown
    chat:                        null,
    undo:                        null,
    redo:                        null,
};

const humanise = (action) => {
    const words = String(action || '').replace(/[_-]+/g, ' ').trim();
    if (!words) return 'Working';
    return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * @param   {object} command  a compiled command ({ action, meta, engine })
 * @returns {string|null}     the label, or null for steps not worth showing
 */
export function stepLabel(command) {
    if (!command) return null;
    const action = command.action || command.engine;

    // an explicit label from the compiler always wins
    if (command.meta?.label) return command.meta.label;

    if (Object.prototype.hasOwnProperty.call(OVERRIDES, action)) return OVERRIDES[action];

    const known = COMMAND_BY_ID[action];
    if (known?.label) return known.label;

    if (command.meta?.description) return command.meta.description;
    return humanise(action);
}

export default stepLabel;
