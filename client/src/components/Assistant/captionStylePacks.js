/**
 * captionStylePacks.js — the caption style packs (fonts, colours, stroke,
 * shadow) shown by the desktop Roka card (ReasoningPanel CaptionStylesCard)
 * and the mobile Caption style sheet. Moved here unchanged from
 * ReasoningPanel so both pickers share one list (see motion/CaptionModel.js:
 * LEGACY_PACK_MOTION is keyed by these ids).
 */

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
