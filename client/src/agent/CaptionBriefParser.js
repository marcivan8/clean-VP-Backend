/**
 * CaptionBriefParser.js — R124.
 *
 * Extracts a structured captions brief from a raw, free-text user request.
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * CommandRegistry/IntentParser's local matching, and the server LLM's
 * `long_form_edit` schema, both collapse a request down to one flat
 * operation + a handful of named params (editMode/platform/targetDuration).
 * A long, detailed creative brief — "generate accurate, synchronized
 * captions... highlight important keywords using an accent color, weight
 * change, scale animation... keep captions clear of the speaker's face" —
 * has no field to land in, so none of that detail reached execution: the
 * long-form pipeline never even generated captions, let alone emphasized
 * keywords or picked a deliberate look.
 *
 * This module is the one place that reads the ORIGINAL prompt text (however
 * long) and pulls out what it's actually asking for about captions, so that
 * detail survives into the long-form plan regardless of which path
 * (registry / local-first / server LLM) resolved the operation. See
 * IntentParser.validateAndNormalize(), which calls this unconditionally for
 * any `long_form_edit` result and attaches it as `constraints.captionBrief`.
 *
 * Pure function, no store/network access — same discipline as
 * utils/captionEmphasis.js's planAutoEmphasis(), so it is directly
 * unit-testable (see scripts/test_caption_brief_parser.mjs).
 */

// Keyword → CAPTION_STYLES id. Mirrors the presets in
// components/Assistant/captionStylePacks.js (not imported directly — that
// file lives under components/ and pulls in motion/CaptionModel; keeping
// this list local keeps CaptionBriefParser dependency-free and testable
// without the browser polyfills a component import would need).
const STYLE_SIGNALS = [
    { id: 'bold-impact', words: ['bold', 'impact', 'viral', 'tiktok', 'high-contrast', 'high contrast', 'punchy', 'energetic'] },
    { id: 'cinematic', words: ['cinematic', 'documentary', 'moody', 'film', 'dramatic'] },
    { id: 'soft-rounded', words: ['soft', 'rounded', 'lifestyle', 'gentle', 'friendly'] },
    { id: 'handwritten', words: ['handwritten', 'authentic', 'personal', 'casual'] },
    { id: 'motivational', words: ['motivational', 'coaching', 'inspirational'] },
    { id: 'editorial', words: ['editorial', 'luxury', 'elegant', 'sophisticated'] },
    // "Clean Modern" is deliberately checked LAST and with the broadest net —
    // "modern"/"contemporary"/"clean" are common filler words in creative
    // briefs that otherwise don't name a specific look, and it's VIBED's own
    // "Universal" default pack, so it's the right catch-all rather than a
    // false-positive risk for a more distinctive style.
    { id: 'clean-modern', words: ['clean', 'modern', 'contemporary', 'universal', 'professional', 'polished'] },
];

const EMPHASIS_SIGNALS = [
    'highlight important keyword', 'highlight the important keyword', 'highlight keyword',
    'selective color emphasis', 'keyword emphasis', 'emphasize important', 'emphasise important',
    'emphasize keyword', 'emphasise keyword', 'accent color', 'accent colour',
    'scale animation', 'spring animation', 'pop animation',
];

const CAPTIONS_SIGNALS = [
    'caption', 'subtitle', 'closed caption', 'cc ',
];

const FACE_CLEAR_SIGNALS = [
    "speaker's face", 'speakers face', 'the face', 'mouth', 'subject\'s face',
    'avoid the face', 'avoid covering', 'keep clear of', 'clear of the face',
];

const SAFE_MARGIN_SIGNALS = [
    'safe margin', 'platform-safe', 'platform safe', 'safe zone',
];

/**
 * Normalize for matching: lowercase, fold curly quotes to straight ones so
 * "speaker's face" matches whether the source used a straight or curly
 * apostrophe (both appear in real user text — Word/Notion/iMessage paste
 * curly quotes by default).
 */
function norm(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[‘’]/g, "'");
}

function anyIncluded(haystack, needles) {
    return needles.some(n => haystack.includes(n));
}

/**
 * @param {string} promptText — the user's raw, original request (any length).
 * @returns {{
 *   wantsCaptions: boolean,
 *   wantsKeywordEmphasis: boolean,
 *   stylePresetId: string|null,
 *   keepClearOfFace: boolean,
 *   safeMargins: boolean,
 * }}
 */
export function parseCaptionBrief(promptText) {
    const text = norm(promptText);

    const wantsCaptions = anyIncluded(text, CAPTIONS_SIGNALS);
    const wantsKeywordEmphasis = anyIncluded(text, EMPHASIS_SIGNALS);
    const keepClearOfFace = anyIncluded(text, FACE_CLEAR_SIGNALS);
    const safeMargins = anyIncluded(text, SAFE_MARGIN_SIGNALS);

    let stylePresetId = null;
    for (const { id, words } of STYLE_SIGNALS) {
        if (anyIncluded(text, words)) { stylePresetId = id; break; }
    }

    return { wantsCaptions, wantsKeywordEmphasis, stylePresetId, keepClearOfFace, safeMargins };
}

export const CaptionBriefParser = { parseCaptionBrief };
export default CaptionBriefParser;
