/**
 * client/src/utils/lutGrading.js
 *
 * Converts a LUT asset's warmth/contrast/saturation/highlights/shadows
 * columns into the `grading` shape VideoPlayer reads every frame (and the
 * FFmpeg export filter, per R55b) — the live, proven grading path.
 *
 * FIX (R75): This formula used to live only inline in AssetPanel.jsx's
 * handleLUTApply, so the ONLY way to get a LUT's real per-clip grade was to
 * click the manual "Apply" button. VideoEditorTools.applyLUT() — the AI's
 * version — never wrote `grading` at all, only a project-level CSS-filter
 * preview, which VideoPlayer/export do NOT consume for the actual look.
 * Extracted here so both paths compute the identical grade from the same
 * formula instead of two implementations drifting apart.
 *
 * setGrading()-consuming code takes PERCENTAGES (it divides by 100); the LUT
 * columns are on a -3..+3 scale. The 1 + x/10 mapping matches the CSS preview
 * and the FFmpeg export filter by construction — do not change one without
 * the other two.
 */

/**
 * @param {object} lut — { id, highlights, shadows, contrast, saturation, warmth, name, display_name }
 * @returns {object} grading — { brightness, contrast, saturate, hueRotate, _lutId, _lutName }
 */
export function lutToGrading(lut) {
    const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    return {
        // Shadows/highlights nudge overall brightness — a coarse stand-in
        // for a tone curve, matching what the export's gamma term does.
        brightness: Math.round(100 * (1 + (n(lut.highlights) - n(lut.shadows)) / 60)),
        contrast:   Math.round(100 * (1 + n(lut.contrast)   / 10)),
        saturate:   Math.round(100 * (1 + n(lut.saturation) / 10)),
        // Warmth as a small hue shift: positive = toward orange.
        hueRotate:  Math.round(n(lut.warmth) * -3),
        _lutId:     lut.id,             // so clearing can tell a LUT grade from a manual one
        _lutName:   lut.name || lut.display_name || null, // shown by the Colour panel's "based on" badge
    };
}

export default lutToGrading;
