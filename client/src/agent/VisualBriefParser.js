/**
 * VisualBriefParser.js — R125.
 *
 * Sibling to CaptionBriefParser.js (see that file's header for the full
 * "why this exists" — same root problem: a long, detailed creative brief has
 * nowhere for its visual-direction language to land before this). This one
 * covers sections 2/5/6/10 of the kind of brief this was built for: the
 * overall visual/color mood, and whether contextual motion graphics
 * (b-roll cutaways, "bring it to life" style animation) were actually asked
 * for in terms specific enough to act on.
 *
 * Deliberately narrower than CaptionBriefParser on one axis: picking a LUT /
 * color grade changes how the user's own footage LOOKS, which is a bigger
 * default to take than adding captions or b-roll — so colorMoodQuery is only
 * ever set when the brief uses actual mood/color language, never a generic
 * fallback the way clean-modern is for captions.
 *
 * Pure function, no store/network access.
 */

const BROLL_SIGNALS = [
    'b-roll', 'b roll', 'broll', 'cutaway', 'supporting imagery', 'supporting visual',
    'floating card', 'contextual motion graphic', 'contextual graphic',
    'visually communicate', 'bring it to life', 'bring this to life', 'make it come alive',
];

const MOTION_GRAPHICS_SIGNALS = [
    'motion graphic', 'callout', 'emphasis callout', 'animated arrow', 'typography animation',
    'statistic', 'animated number', 'progress bar', 'comparison', 'floating card',
];

// Mood/style word → a short query VideoEditorTools.applyLUT()'s search can
// resolve to a real LUT. Order matters: more specific phrases are checked
// first so "warm, golden hour, vintage" isn't shadowed by a later, broader
// match.
const COLOR_MOOD_SIGNALS = [
    { query: 'warm golden hour vintage film', words: ['golden hour', 'vintage', 'retro', 'film grain', 'warm tone'] },
    { query: 'cool blue cold tone', words: ['cool tone', 'cold tone', 'blue tone'] },
    { query: 'black and white desaturated', words: ['black and white', 'b&w', 'desaturate', 'desaturated', 'monochrome'] },
    { query: 'vibrant saturated punchy', words: ['vibrant', 'saturated', 'punchy color', 'pop color'] },
    { query: 'cinematic moody dramatic', words: ['cinematic', 'moody', 'dramatic lighting', 'documentary look'] },
];

function norm(text) {
    return String(text || '').toLowerCase().replace(/[‘’]/g, "'");
}

// A small, deliberately short list — just enough to catch an EXPLICITLY named
// brand/accent color ("our accent color is teal", "brand color: #1a73e8").
// This is NOT a general color-word detector: it only fires when "accent" or
// "brand" appears within a few words of the color, so a brief that merely
// describes footage containing a red car, say, doesn't get read as a brand
// instruction. See findAccentColorHex below.
const NAMED_COLORS = {
    red: '#d1202f', orange: '#ff9500', yellow: '#ffd400', green: '#00b140',
    teal: '#0d9488', cyan: '#00e5ff', blue: '#1e40ff', navy: '#1e2761',
    purple: '#7b2cbf', violet: '#7b2cbf', pink: '#ff4fa3', black: '#000000', white: '#ffffff',
};

/**
 * An explicit, named brand/accent color — a hex code or a plain color word —
 * but only when it is actually framed as a brand/accent instruction, not an
 * incidental color mention anywhere else in a long brief.
 * @returns {string|null} a hex color, or null if nothing explicit was named.
 */
function findAccentColorHex(text) {
    const brandWindows = text.match(/\b(?:accent|brand)[^.\n]{0,40}/g) || [];
    for (const window of brandWindows) {
        const hexMatch = window.match(/#[0-9a-f]{6}\b/);
        if (hexMatch) return hexMatch[0];
        for (const [name, hex] of Object.entries(NAMED_COLORS)) {
            if (new RegExp(`\\b${name}\\b`).test(window)) return hex;
        }
    }
    return null;
}

function anyIncluded(haystack, needles) {
    return needles.some(n => haystack.includes(n));
}

/**
 * @param {string} promptText — the user's raw, original request (any length).
 * @returns {{
 *   wantsContextualBroll: boolean,
 *   wantsMotionGraphics: boolean,
 *   colorMoodQuery: string|null,
 * }}
 */
export function parseVisualBrief(promptText) {
    const text = norm(promptText);

    const wantsContextualBroll = anyIncluded(text, BROLL_SIGNALS);
    const wantsMotionGraphics = anyIncluded(text, MOTION_GRAPHICS_SIGNALS);

    let colorMoodQuery = null;
    for (const { query, words } of COLOR_MOOD_SIGNALS) {
        if (anyIncluded(text, words)) { colorMoodQuery = query; break; }
    }

    const accentColorHex = findAccentColorHex(text);

    return { wantsContextualBroll, wantsMotionGraphics, colorMoodQuery, accentColorHex };
}

export const VisualBriefParser = { parseVisualBrief };
export default VisualBriefParser;
