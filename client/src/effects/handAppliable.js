/**
 * client/src/effects/handAppliable.js
 *
 * Which footage effects a PERSON may add by hand, as one exported rule.
 *
 * R166 — the effects panel went live and its add-effect menu offered all 20
 * registry entries. Six of them cannot render on any live path: `smart_zoom`,
 * `beat_sync` and `emotion_frame` live in engines/AIEffects.js, which is only
 * reachable through the client WebGL runtime that nothing mounts (R165), and
 * `speed_change`, `audio_normalize` and `audio_denoise` are retiming and audio
 * work rather than footage looks. Offering those would have added controls
 * that silently do nothing.
 *
 * It lives in its own module rather than inside EffectsPanel.jsx so the rule
 * can be asserted directly by scripts/test_effects_panel_wiring.mjs. A
 * predicate defined privately inside a component is a predicate no test can
 * check, and the bug it guards against — a filter that silently matches
 * nothing — looks identical to a filter that works.
 */

import { isGpuClipEffect } from './ClipEffectAdapter.js';

/**
 * `lut_apply` is a GPU clip effect and renders in preview, but the export
 * compositor has no branch for it: a LUT reaches ffmpeg through the dedicated
 * apply_lut / recommend_luts path instead. Two ways to set a LUT is how preview
 * and export came apart in R14, R16, R53 and R56.
 */
export const HAND_EXCLUDED_EFFECTS = Object.freeze(['lut_apply']);
// These effects use dedicated live timeline renderers instead of a GPU
// footage shader. Keep them in the same capability rule so the UI and ROKA
// can expose effects that already have verified preview and export paths.
export const HAND_SPECIAL_EFFECTS = Object.freeze(['shake']);

/**
 * True when `type` is a footage effect a person can add and actually see,
 * in the editor preview and in the export.
 *
 * Same predicate the AI's apply_motion_effect_stack applies
 * (agent/VideoEditorTools.js), so the hand tool and the AI cannot drift apart.
 *
 * @param {string} type registry effect type
 * @returns {boolean}
 */
export function isHandAppliableEffect(type) {
    if (!type || typeof type !== 'string') return false;
    if (HAND_EXCLUDED_EFFECTS.includes(type)) return false;
    return isGpuClipEffect(type) || HAND_SPECIAL_EFFECTS.includes(type);
}

export default { isHandAppliableEffect, HAND_EXCLUDED_EFFECTS, HAND_SPECIAL_EFFECTS };
