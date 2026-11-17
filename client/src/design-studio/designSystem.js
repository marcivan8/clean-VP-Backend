/**
 * client/src/design-studio/designSystem.js
 *
 * Professional Design System Engine: Reusable Components,
 * Instances, Variants, Variables/Tokens (with Mode Themes),
 * and Property Copy/Paste Clipboard.
 *
 * Strictly zero emojis.
 */

// ── Theme Variables & Design Tokens ──────────────────────────────────────────

export const THEME_MODES = {
    dark: {
        id: 'dark',
        label: 'Dark Studio',
        colors: {
            brand: '#00E5FF',
            brandDark: '#0B7C91',
            accent: '#C85A17',
            surface: '#0D0F12',
            surfaceAlt: '#161920',
            surfaceCard: '#1E222B',
            text: '#EDEAE3',
            textMuted: '#9CA3AF',
            border: '#2A2E39',
        },
    },
    light: {
        id: 'light',
        label: 'Light Studio',
        colors: {
            brand: '#0B7C91',
            brandDark: '#044350',
            accent: '#C85A17',
            surface: '#EDEAE3',
            surfaceAlt: '#FFFFFF',
            surfaceCard: '#F7F5F0',
            text: '#111827',
            textMuted: '#6B7280',
            border: '#D8D4CC',
        },
    },
    editorial: {
        id: 'editorial',
        label: 'Editorial Warm',
        colors: {
            brand: '#C85A17',
            brandDark: '#8F3F0D',
            accent: '#00E5FF',
            surface: '#F4EDE2',
            surfaceAlt: '#EAE1D3',
            surfaceCard: '#DFD4C4',
            text: '#1F140E',
            textMuted: '#7A6B5F',
            border: '#D0C1B0',
        },
    },
};

export const TYPOGRAPHY_STYLES = {
    display: {
        id: 'display',
        name: 'Display Bold',
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: 800,
        fontSize: 72,
        lineHeight: 1.1,
        letterSpacing: -1.5,
    },
    headline: {
        id: 'headline',
        name: 'Headline',
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: 700,
        fontSize: 48,
        lineHeight: 1.2,
        letterSpacing: -0.5,
    },
    serifTitle: {
        id: 'serifTitle',
        name: 'Editorial Serif',
        fontFamily: 'Instrument Serif',
        fontWeight: 400,
        fontSize: 56,
        lineHeight: 1.15,
        letterSpacing: 0,
    },
    body: {
        id: 'body',
        name: 'Body Medium',
        fontFamily: 'Geist',
        fontWeight: 400,
        fontSize: 16,
        lineHeight: 1.5,
        letterSpacing: 0,
    },
    mono: {
        id: 'mono',
        name: 'Code Mono',
        fontFamily: 'JetBrains Mono',
        fontWeight: 500,
        fontSize: 14,
        lineHeight: 1.4,
        letterSpacing: 0,
    },
};

export const EFFECT_STYLES = {
    cardElevation: {
        id: 'cardElevation',
        name: 'Card Elevation',
        dropShadow: { x: 0, y: 8, blur: 24, spread: 0, color: 'rgba(0, 0, 0, 0.35)' },
    },
    cyanGlow: {
        id: 'cyanGlow',
        name: 'Cyan Glow',
        dropShadow: { x: 0, y: 0, blur: 20, spread: 2, color: 'rgba(0, 229, 255, 0.45)' },
    },
    glassmorphism: {
        id: 'glassmorphism',
        name: 'Glassmorphism',
        backdropBlur: 16,
        fill: 'rgba(255, 255, 255, 0.08)',
        stroke: 'rgba(255, 255, 255, 0.15)',
        strokeWidth: 1,
    },
    subtleInner: {
        id: 'subtleInner',
        name: 'Subtle Inset',
        innerShadow: { x: 0, y: 2, blur: 4, color: 'rgba(0, 0, 0, 0.25)' },
    },
};

// ── Built-in Starter Components ───────────────────────────────────────────────

export const STARTER_COMPONENTS = [
    {
        id: 'cmp_cta_button',
        name: 'Primary CTA Button',
        category: 'Buttons',
        w: 200,
        h: 48,
        layers: [
            {
                id: 'bg',
                name: 'Button Background',
                type: 'rect',
                x: 0,
                y: 0,
                w: 200,
                h: 48,
                fill: '#00E5FF',
                cornerRadius: 24,
                stroke: 'transparent',
                strokeWidth: 0,
            },
            {
                id: 'label',
                name: 'Button Label',
                type: 'text',
                x: 0,
                y: 14,
                w: 200,
                h: 20,
                text: 'GET STARTED',
                fontFamily: 'Plus Jakarta Sans',
                fontWeight: 700,
                fontSize: 14,
                fill: '#0D0F12',
                textAlign: 'center',
            },
        ],
    },
    {
        id: 'cmp_duration_badge',
        name: 'Duration Badge',
        category: 'Badges',
        w: 64,
        h: 28,
        layers: [
            {
                id: 'badge_bg',
                name: 'Pill Background',
                type: 'rect',
                x: 0,
                y: 0,
                w: 64,
                h: 28,
                fill: '#C85A17',
                cornerRadius: 6,
            },
            {
                id: 'badge_text',
                name: 'Time Text',
                type: 'text',
                x: 0,
                y: 6,
                w: 64,
                h: 16,
                text: '0:30',
                fontFamily: 'JetBrains Mono',
                fontWeight: 700,
                fontSize: 12,
                fill: '#FFFFFF',
                textAlign: 'center',
            },
        ],
    },
    {
        id: 'cmp_stat_callout',
        name: 'Stat Callout Card',
        category: 'Cards',
        w: 240,
        h: 110,
        layers: [
            {
                id: 'card_bg',
                name: 'Card Background',
                type: 'rect',
                x: 0,
                y: 0,
                w: 240,
                h: 110,
                fill: 'rgba(255, 255, 255, 0.05)',
                stroke: 'rgba(255, 255, 255, 0.12)',
                strokeWidth: 1,
                cornerRadius: 12,
            },
            {
                id: 'metric_value',
                name: 'Metric Number',
                type: 'text',
                x: 16,
                y: 16,
                w: 208,
                h: 40,
                text: '94° C',
                fontFamily: 'Plus Jakarta Sans',
                fontWeight: 800,
                fontSize: 32,
                fill: '#00E5FF',
            },
            {
                id: 'metric_label',
                name: 'Metric Description',
                type: 'text',
                x: 16,
                y: 62,
                w: 208,
                h: 24,
                text: 'Optimal water temperature',
                fontFamily: 'Geist',
                fontWeight: 400,
                fontSize: 13,
                fill: '#9CA3AF',
            },
        ],
    },
];

// ── Property Copy / Paste Clipboard ──────────────────────────────────────────

let styleClipboard = null;

/**
 * Copies visual styling and typography properties from a layer.
 *
 * @param {object} layer
 * @returns {object} Extracted property bag
 */
export function copyLayerProperties(layer) {
    if (!layer) return null;

    styleClipboard = {
        fill: layer.fill,
        gradient: layer.gradient ? { ...layer.gradient } : null,
        opacity: layer.opacity !== undefined ? layer.opacity : 100,
        blendMode: layer.blendMode || 'normal',
        stroke: layer.stroke,
        strokeWidth: layer.strokeWidth,
        strokeCap: layer.strokeCap,
        strokeJoin: layer.strokeJoin,
        strokeStyle: layer.strokeStyle,
        cornerRadius: layer.cornerRadius,
        dropShadow: layer.dropShadow ? { ...layer.dropShadow } : null,
        innerShadow: layer.innerShadow ? { ...layer.innerShadow } : null,
        layerBlur: layer.layerBlur,
        backdropBlur: layer.backdropBlur,
        // Typography properties
        fontFamily: layer.fontFamily,
        fontSize: layer.fontSize,
        fontWeight: layer.fontWeight,
        lineHeight: layer.lineHeight,
        letterSpacing: layer.letterSpacing,
        textAlign: layer.textAlign,
        textDecoration: layer.textDecoration,
        textTransform: layer.textTransform,
    };

    return styleClipboard;
}

/**
 * Pastes clipboard properties onto a target layer.
 *
 * @param {object} targetLayer
 * @param {object|null} properties
 * @returns {object} Updated layer
 */
export function pasteLayerProperties(targetLayer, properties = null) {
    const props = properties || styleClipboard;
    if (!targetLayer || !props) return targetLayer;

    const updated = { ...targetLayer };

    if (props.fill !== undefined) updated.fill = props.fill;
    if (props.gradient !== undefined) updated.gradient = props.gradient;
    if (props.opacity !== undefined) updated.opacity = props.opacity;
    if (props.blendMode !== undefined) updated.blendMode = props.blendMode;
    if (props.stroke !== undefined) updated.stroke = props.stroke;
    if (props.strokeWidth !== undefined) updated.strokeWidth = props.strokeWidth;
    if (props.strokeCap !== undefined) updated.strokeCap = props.strokeCap;
    if (props.strokeJoin !== undefined) updated.strokeJoin = props.strokeJoin;
    if (props.strokeStyle !== undefined) updated.strokeStyle = props.strokeStyle;
    if (props.cornerRadius !== undefined) updated.cornerRadius = props.cornerRadius;
    if (props.dropShadow !== undefined) updated.dropShadow = props.dropShadow;
    if (props.innerShadow !== undefined) updated.innerShadow = props.innerShadow;
    if (props.layerBlur !== undefined) updated.layerBlur = props.layerBlur;
    if (props.backdropBlur !== undefined) updated.backdropBlur = props.backdropBlur;

    // Apply text styling only if target is a text/badge layer
    if (targetLayer.type === 'text' || targetLayer.type === 'badge') {
        if (props.fontFamily) updated.fontFamily = props.fontFamily;
        if (props.fontSize) updated.fontSize = props.fontSize;
        if (props.fontWeight) updated.fontWeight = props.fontWeight;
        if (props.lineHeight) updated.lineHeight = props.lineHeight;
        if (props.letterSpacing !== undefined) updated.letterSpacing = props.letterSpacing;
        if (props.textAlign) updated.textAlign = props.textAlign;
        if (props.textDecoration) updated.textDecoration = props.textDecoration;
        if (props.textTransform) updated.textTransform = props.textTransform;
    }

    return updated;
}
