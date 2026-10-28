/**
 * captionStylePacks.js — the caption style packs (fonts, colours, stroke,
 * shadow) shown by the desktop Roka card (ReasoningPanel CaptionStylesCard),
 * the mobile Caption style sheet, and the chat box's Styles menu. One list,
 * three pickers (see motion/CaptionModel.js: LEGACY_PACK_MOTION is keyed by
 * these ids).
 *
 * R116 also moves the FIELDS a pack sets in here. Before, the desktop card and
 * the mobile sheet each built that object by hand and they had already
 * diverged: the desktop one looped `updateClip` per clip (no transaction, so
 * undoing a style change took one undo per caption) and dropped the user's
 * spoken-word-highlight choice, while the mobile one went through
 * `applyCaptionStyleToAll` and kept it. A third picker copying either would
 * have made it worse, so there is now one builder and one apply path.
 *
 * `captionPackUpdates` is pure and imports only CaptionModel (which itself
 * imports nothing), so the Node test harness can load it.
 */

import { legacyPackToCaptionStyle } from '../../motion/CaptionModel.js';

// Caption style presets for TASK 3
export const CAPTION_STYLES = [
    {
        id: 'bold-impact',  name: 'Bold Impact',  font: 'Anton',            weight: 900,
        fontLabel: 'Anton',             tag: 'TikTok / viral',
        color: '#FACC15',   stroke: { width: 2, color: '#000000' },
        textShadow: '2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000',
        transform: 'uppercase', sample: 'AHA',
    },
    {
        id: 'clean-modern', name: 'Clean Modern', font: 'Montserrat',       weight: 800,
        fontLabel: 'Montserrat 800',    tag: 'Universal',
        color: '#FFFFFF',   stroke: null, textShadow: '0 2px 8px rgba(0,0,0,0.7)',
        transform: 'uppercase', sample: 'Aha',
    },
    {
        id: 'soft-rounded', name: 'Soft Rounded', font: 'Nunito',           weight: 700,
        fontLabel: 'Nunito Bold',       tag: 'Lifestyle',
        color: '#FFFFFF',   stroke: null, textShadow: '0 2px 12px rgba(0,0,0,0.5)',
        transform: 'none',  sample: 'Aha',
    },
    {
        id: 'cinematic',    name: 'Cinematic',    font: 'Playfair Display', weight: 700,
        fontLabel: 'Playfair Italic',   tag: 'Documentary',
        style: 'italic',    color: '#F5E6C8', stroke: null,
        textShadow: '0 2px 16px rgba(0,0,0,0.8)', transform: 'none', sample: 'Aha',
    },
    {
        id: 'handwritten',  name: 'Handwritten',  font: 'Caveat',           weight: 700,
        fontLabel: 'Caveat Bold',       tag: 'Authentic',
        color: '#FFFFFF',   stroke: null, textShadow: '0 2px 6px rgba(0,0,0,0.4)',
        transform: 'none',  sample: 'Aha',
    },
    {
        id: 'motivational', name: 'Motivational', font: 'Oswald',           weight: 700,
        fontLabel: 'Oswald Bold',       tag: 'Coaching',
        color: '#FFFFFF',   stroke: { width: 1.5, color: '#000000' },
        textShadow: '0 2px 8px rgba(0,0,0,0.6)', transform: 'uppercase', sample: 'AHA',
    },
    {
        id: 'modern-tech',  name: 'Modern Tech',  font: 'Inter',            weight: 800,
        fontLabel: 'Inter ExtraBold',   tag: 'Tech / Media',
        color: '#FFFFFF',   stroke: null,
        textShadow: '0 2px 12px rgba(0,0,0,0.8)', transform: 'none', sample: 'Aha',
    },
    {
        id: 'extended-bold', name: 'Extended Bold', font: 'Unbounded',      weight: 900,
        fontLabel: 'Unbounded Black',   tag: 'Brand / Logo',
        color: '#FFFFFF',   stroke: null,
        textShadow: 'none', transform: 'uppercase', sample: 'DO',
    },
    {
        id: 'platform-sans', name: 'Platform Sans', font: 'DM Sans',        weight: 600,
        fontLabel: 'DM Sans SemiBold',  tag: 'App / Native',
        color: '#FFFFFF',   stroke: null,
        textShadow: '0 1px 6px rgba(0,0,0,0.6)', transform: 'none', sample: 'Aha',
    },
    {
        id: 'editorial',    name: 'Editorial',    font: 'Cormorant Garamond', weight: 700,
        fontLabel: 'Cormorant Bold Italic', tag: 'Editorial / Luxury',
        style: 'italic',    color: '#F5E6D3', stroke: null,
        textShadow: '0 2px 16px rgba(0,0,0,0.85)', transform: 'none', sample: 'grace',
    },
];

export const FONT_STACK = (font) =>
    font === 'Caveat' ? `"${font}", cursive`
    : (font === 'Playfair Display' || font === 'Cormorant Garamond') ? `"${font}", serif`
    : `"${font}", sans-serif`;

/**
 * The clip fields a pack sets. Hand this straight to
 * `useTimelineStore.applyCaptionStyleToAll`.
 *
 * @param {object} style            one of CAPTION_STYLES
 * @param {object} [opts]
 * @param {boolean} [opts.highlight=true]  keep the spoken-word highlight. When
 *        false the pack's own highlight is switched off, which is what the
 *        mobile sheet does when the user has turned the highlight switch off.
 * @returns {object|null} null for anything that is not a pack
 */
export function captionPackUpdates(style, opts = {}) {
    if (!style || typeof style !== 'object' || !style.id) return null;
    const captionStyle = legacyPackToCaptionStyle(style.id);
    // `highlight` defaults to true: a picker that does not care about the
    // switch gets the pack's own highlight, which is what every pack author
    // intended.
    if (captionStyle && opts.highlight === false) {
        captionStyle.wordHighlight = { mode: 'none', scale: 1 };
    }
    return {
        fontFamily: style.font,
        fontWeight: style.weight,
        color: style.color,
        stroke: style.stroke || null,
        textShadow: style.textShadow || null,
        fontStyle: style.style || 'normal',
        // The MOTION half of a pack (R61). Without it a pack's `transform:
        // 'uppercase'` applies to nothing and picking a style never changes how
        // captions animate.
        captionStyle,
        // Clear any hand-authored per-clip animation, or the pack's own preset
        // visibly fails to take effect.
        animations: [],
        animation: 'none',
    };
}

/** The pack with this id, or null. */
export function packById(id) {
    return CAPTION_STYLES.find(s => s.id === id) || null;
}

/**
 * The CSS a preview needs to look like the pack. Shared so the Roka card, the
 * mobile sheet and the Styles menu cannot drift into three different previews
 * of the same pack.
 */
export function previewStyle(style, size = 20) {
    if (!style) return {};
    return {
        fontFamily: FONT_STACK(style.font),
        fontWeight: style.weight,
        fontStyle: style.style || 'normal',
        fontSize: style.id === 'handwritten' ? size + 2 : size,
        color: style.color,
        textShadow: style.textShadow || 'none',
        WebkitTextStroke: style.stroke ? `${style.stroke.width}px ${style.stroke.color}` : 'none',
        // CSS paints a text stroke OVER the fill and centred on the outline,
        // so a 1.5px black stroke on white text at preview size eats most of
        // the glyph — `motivational` rendered as hollow outlines, which is not
        // what that pack looks like in a video (where the stroke is behind).
        // `paint-order` puts the stroke back underneath.
        paintOrder: 'stroke fill',
        textTransform: style.transform || 'none',
        letterSpacing: (style.id === 'bold-impact' || style.id === 'motivational') ? '0.04em' : 'normal',
        lineHeight: 1,
    };
}
