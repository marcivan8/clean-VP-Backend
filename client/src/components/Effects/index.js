/**
 * NOT MOUNTED TODAY (R165). Nothing imports this barrel, which means
 * EffectsPanel, EffectControls and PresetBrowser are reachable from nothing —
 * a user cannot hand-pick an effect, edit its parameters or browse presets.
 * Only KeyframeEditor has real importers (MotionPanel, TransformPanel).
 *
 * This barrel is also why the first version of
 * scripts/test_module_reachability.mjs passed: it matched importers by
 * basename, so `./index` hit every index.js in the tree and these three looked
 * imported.
 *
 * The chain is current, not stale: EffectsPanel → hooks/useEffects.js →
 * timelineManager + TimelineActions + effectRegistry, all live infrastructure.
 * Mounting it is an entry in PanelRail's RAIL_TABS plus a render branch in
 * IDELayout — a product decision about whether effects are a hand tool as well
 * as an AI one, which today they are not.
 */
/**
 * Effects components index
 */

export { default as EffectsPanel } from './EffectsPanel';
export { default as EffectControls } from './EffectControls';
export { default as PresetBrowser } from './PresetBrowser';
export { default as KeyframeEditor } from './KeyframeEditor';
