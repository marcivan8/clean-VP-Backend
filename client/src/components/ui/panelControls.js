/**
 * client/src/components/ui/panelControls.js
 *
 * R116 - the pure half of the panel control kit.
 *
 * Everything in here is arithmetic and string work: clamping a value to a
 * range, turning one into a track percentage, rounding to a step, reading a
 * typed hex, deciding where an arrow key moves in a segmented control. It is
 * separated from the JSX for one reason - this is the half that can be WRONG,
 * and a Node test can load it. The components in PanelControls.jsx are thin
 * wrappers around these functions.
 *
 * No imports, no DOM.
 */

/** Clamp, with NaN and junk treated as "no value given". */
export function clampTo(value, min, max) {
    const n = Number(value);
    const lo = Number.isFinite(Number(min)) ? Number(min) : -Infinity;
    const hi = Number.isFinite(Number(max)) ? Number(max) : Infinity;
    if (!Number.isFinite(n)) return lo === -Infinity ? 0 : lo;
    if (lo > hi) return lo;
    return Math.min(hi, Math.max(lo, n));
}

/**
 * Where the handle sits on the track, 0..100.
 *
 * A zero-width range (min === max) is a real case - a slider over a parameter
 * whose bounds collapsed - and dividing by it gives NaN, which CSS silently
 * drops, leaving a handle stuck at the left with no error anywhere. It returns
 * 0 instead.
 */
export function percentOf(value, min, max) {
    const lo = Number(min), hi = Number(max);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi === lo) return 0;
    return clampTo(((clampTo(value, lo, hi) - lo) / (hi - lo)) * 100, 0, 100);
}

/**
 * Snap to the nearest step from `min`, then clamp.
 *
 * Rounded to 6 decimals because floating point turns a 0.1 step into
 * 0.30000000000000004, which then renders as "0.30000000000000004" in a
 * number box.
 */
export function snapTo(value, min, max, step) {
    const s = Number(step);
    const v = clampTo(value, min, max);
    if (!Number.isFinite(s) || s <= 0) return v;
    const lo = Number.isFinite(Number(min)) ? Number(min) : 0;
    const snapped = lo + Math.round((v - lo) / s) * s;
    return clampTo(Number(snapped.toFixed(6)), min, max);
}

/**
 * How a number reads in a box. Decimals follow the STEP, not the value, so a
 * slider does not flicker between "1" and "1.25" as it is dragged.
 */
export function formatValue(value, step = 1, unit = '') {
    const n = Number(value);
    if (!Number.isFinite(n)) return '';
    const s = Number(step);
    const decimals = !Number.isFinite(s) || s >= 1 ? 0 : Math.min(3, String(s).split('.')[1]?.length || 1);
    return `${n.toFixed(decimals)}${unit || ''}`;
}

/**
 * A hex the colour inputs will accept, or null.
 *
 * Takes it with or without the `#`, 3 or 6 digits, and expands the short form,
 * because a person typing a colour into a box types "fff" as often as
 * "#FFFFFF". Returns uppercase so two spellings of one colour compare equal.
 */
export function normalizeHex(input) {
    const raw = String(input ?? '').trim().replace(/^#/, '');
    if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(raw)) return null;
    const full = raw.length === 3 ? raw.split('').map(c => c + c).join('') : raw;
    return `#${full.toUpperCase()}`;
}

/** Luminance 0..1, for deciding whether a swatch needs a light or dark outline. */
export function hexLuminance(hex) {
    const h = normalizeHex(hex);
    if (!h) return 0;
    const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
    const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Where an arrow key moves inside a segmented control.
 *
 * Wraps at both ends, and Home/End jump. Returns the CURRENT index for a key
 * the control does not handle, so the caller can tell "no move" from "moved to
 * 0" - returning null for both is how a Home key ends up doing nothing.
 */
export function segmentedKeyMove(key, at, count) {
    const n = Math.max(0, Number(count) || 0);
    if (n === 0) return 0;
    const i = clampTo(at, 0, n - 1);
    switch (key) {
        case 'ArrowRight': case 'ArrowDown': return (i + 1) % n;
        case 'ArrowLeft': case 'ArrowUp': return (i - 1 + n) % n;
        case 'Home': return 0;
        case 'End': return n - 1;
        default: return i;
    }
}

/**
 * The CSS for a slider track.
 *
 * `tint` is a list of colours painted along the whole track (the white-balance
 * and hue sliders in the reference), and the filled part is drawn OVER it at
 * low opacity rather than replacing it - a temperature slider that loses its
 * blue-to-yellow ramp as you drag is just a grey bar.
 */
export function trackBackground(tint) {
    if (!Array.isArray(tint) || tint.length < 2) return null;
    return `linear-gradient(90deg, ${tint.join(', ')})`;
}

/**
 * Is this value the default? Used to decide whether a section's Reset is live.
 * Compares numbers with a tolerance, since a slider can land on 0.1+0.2.
 */
export function isDefault(value, fallback) {
    if (typeof value === 'number' && typeof fallback === 'number') {
        return Math.abs(value - fallback) < 1e-6;
    }
    return value === fallback;
}

/** Which of `values` differ from `defaults`. Drives the per-section Reset. */
export function changedKeys(values, defaults) {
    if (!values || !defaults) return [];
    return Object.keys(defaults).filter(k => !isDefault(values[k], defaults[k]));
}

export default {
    clampTo, percentOf, snapTo, formatValue, normalizeHex, hexLuminance,
    segmentedKeyMove, trackBackground, isDefault, changedKeys,
};
