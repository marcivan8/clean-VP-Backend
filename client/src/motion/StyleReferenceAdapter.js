/**
 * Turn the bounded vision profile for an explicit style reference into
 * existing, supported creative choices. We never accept arbitrary model
 * values as component, font, animation, transition, or asset identifiers.
 */
const ENUMS = {
    motionEnergy: new Set(['low', 'medium', 'high']),
    captionTreatment: new Set(['none', 'minimal', 'clean', 'bold', 'word_highlight', 'boxed', 'kinetic']),
    titleTreatment: new Set(['none', 'minimal', 'top_card', 'centered', 'large_kinetic', 'lower_third', 'editorial_serif']),
    graphicsDensity: new Set(['sparse', 'balanced', 'dense']),
    transitionPacing: new Set(['slow', 'medium', 'fast']),
    visualTone: new Set(['cinematic', 'editorial', 'warm', 'viral', 'technology']),
};
const FONTS = new Set(['Inter', 'Anton', 'Montserrat', 'Poppins', 'DM Sans', 'Playfair Display', 'Cormorant Garamond', 'Rajdhani', 'JetBrains Mono', 'Oswald', 'Bebas Neue']);
const ANIMATIONS = new Set(['fade', 'slide-up', 'slide-down', 'pop', 'scale-reveal', 'blur-reveal', 'glow-reveal', 'typewriter']);
const TRANSITIONS = new Set(['flash', 'dip', 'whip-left', 'whip-right', 'zoom-punch', 'glitch', 'speed-lines', 'circle-wipe', 'bar-wipe', 'blinds', 'diagonal-wipe', 'soft-blur', 'push-left', 'push-right', 'color-flash']);

const validEnum = (value, allowed) => {
    const normalized = String(value || '').toLowerCase().replace(/[ -]+/g, '_');
    return allowed.has(normalized) ? normalized : null;
};
const validIdentifier = (value, allowed) => {
    const normalized = String(value || '').trim().toLowerCase().replace(/[ _]+/g, '-');
    return allowed.has(normalized) ? normalized : null;
};
const hex = value => /^#[\da-f]{6}$/i.test(String(value || '').trim()) ? String(value).trim().toUpperCase() : null;
const bounded = (value, min, max) => Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max ? Number(value) : null;
const textStyle = raw => {
    if (!raw || typeof raw !== 'object') return null;
    const fontFamily = FONTS.has(raw.fontFamily) ? raw.fontFamily : null;
    const fontWeight = [400, 500, 600, 700, 800, 900].includes(Number(raw.fontWeight)) ? Number(raw.fontWeight) : null;
    const color = hex(raw.color || raw.textColor);
    const accentColor = hex(raw.accentColor);
    const x = bounded(raw.x, 8, 92);
    const y = bounded(raw.y, 8, 92);
    const animationIn = validIdentifier(raw.animationIn, ANIMATIONS);
    if (![fontFamily, fontWeight, color, accentColor, x, y, animationIn].some(Boolean)) return null;
    return { ...(fontFamily ? { fontFamily } : {}), ...(fontWeight ? { fontWeight } : {}), ...(color ? { color } : {}), ...(accentColor ? { accentColor } : {}), ...(x !== null ? { x } : {}), ...(y !== null ? { y } : {}), ...(animationIn ? { animationIn } : {}) };
};
const luminance = color => {
    const channels = String(color || '').slice(1).match(/.{2}/g)?.map(value => parseInt(value, 16) / 255) || [];
    if (channels.length !== 3) return 0;
    const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
};

/** Returns null for weak/invalid evidence so normal style defaults take over. */
export function buildStyleReferencePlan(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const confidence = Number(raw.confidence);
    if (!Number.isFinite(confidence) || confidence < 0.35) return null;
    const motionEnergy = validEnum(raw.motionEnergy, ENUMS.motionEnergy);
    const captionTreatment = validEnum(raw.captionTreatment, ENUMS.captionTreatment);
    const titleTreatment = validEnum(raw.titleTreatment, ENUMS.titleTreatment);
    const graphicsDensity = validEnum(raw.graphicsDensity, ENUMS.graphicsDensity);
    const transitionPacing = validEnum(raw.transitionPacing, ENUMS.transitionPacing);
    const visualTone = validEnum(raw.visualTone, ENUMS.visualTone);
    const colors = [...new Set((Array.isArray(raw.colorPalette) ? raw.colorPalette : []).map(hex).filter(Boolean))].slice(0, 3);
    const motifs = (Array.isArray(raw.motifs) ? raw.motifs : []).map(x => String(x || '').trim()).filter(Boolean).slice(0, 4);
    const titleStyle = textStyle(raw.titleStyle);
    const captionStyle = textStyle(raw.captionStyle);
    const transitionTypes = [...new Set((Array.isArray(raw.transitionTypes) ? raw.transitionTypes : [])
        .map(value => validIdentifier(value, TRANSITIONS)).filter(Boolean))].slice(0, 4);
    const sceneDirections = (Array.isArray(raw.sceneDirections) ? raw.sceneDirections : []).slice(0, 9).map(item => {
        if (!item || typeof item !== 'object') return null;
        const directionStyle = textStyle({ ...item, color: item.textColor });
        const role = validEnum(item.role, new Set(['hook', 'title', 'caption', 'graphic', 'transition', 'unknown']));
        const transitionAfter = validIdentifier(item.transitionAfter, TRANSITIONS);
        const time = bounded(item.time, 0, 24 * 60 * 60);
        const confidence = bounded(item.confidence, 0, 1);
        return { ...(time !== null ? { time } : {}), ...(role ? { role } : {}), ...(directionStyle || {}), ...(transitionAfter ? { transitionAfter } : {}), ...(confidence !== null ? { confidence } : {}) };
    }).filter(item => item && (item.confidence === undefined || item.confidence >= 0.45));
    const evidenceCount = [motionEnergy, captionTreatment, titleTreatment, graphicsDensity, transitionPacing, visualTone]
        .filter(Boolean).length + (colors.length ? 1 : 0) + (motifs.length ? 1 : 0)
        + (titleStyle ? 1 : 0) + (captionStyle ? 1 : 0) + (transitionTypes.length ? 1 : 0)
        + (sceneDirections.length ? 1 : 0);
    if (evidenceCount < 2) return null;

    const captionPack = ({
        bold: 'hormozi',
        word_highlight: 'mrbeast',
        boxed: 'editorial-boxed',
        kinetic: 'gaming',
        clean: 'ali-abdaal',
        minimal: 'apple',
    })[captionTreatment] || null;
    const title = ({
        large_kinetic: { component: 'KineticTitle', preset: 'punchy' },
        centered: { component: 'KineticTitle', preset: 'creator' },
        top_card: { component: 'TitleSequence', preset: 'minimal' },
        lower_third: { component: 'TitleSequence', preset: 'minimal' },
        minimal: { component: 'TitleSequence', preset: 'minimal' },
        editorial_serif: { component: 'TitleSequence', preset: 'editorial-serif' },
    })[titleTreatment] || null;
    const recipe = transitionPacing === 'fast' || motionEnergy === 'high'
        ? 'punchy'
        : transitionPacing === 'slow' || motionEnergy === 'low' ? 'explainer' : 'travel';
    const motionScale = ({ low: 0.65, medium: 0.85, high: 1.05 })[motionEnergy] || 0.85;
    const graphicsMax = ({ sparse: 1, balanced: 2, dense: 4 })[graphicsDensity] || 2;
    // The first swatch is the reference's lead color and sets caption contrast.
    // UI-card surfaces use the palette's median luminance instead: a light
    // secondary surface should be able to make device/UI graphics light even
    // when the lead brand color is dark, while one white text swatch should
    // not flip an otherwise dark palette.
    const dominantLuminance = colors.length ? luminance(colors[0]) : 0;
    const paletteLuminances = colors.map(luminance).sort((a, b) => a - b);
    const middle = Math.floor(paletteLuminances.length / 2);
    const paletteMedian = paletteLuminances.length === 0 ? 0
        : paletteLuminances.length % 2 === 0
            ? (paletteLuminances[middle - 1] + paletteLuminances[middle]) / 2
            : paletteLuminances[middle];
    const surface = paletteMedian >= 0.4 ? 'light' : 'dark';
    const captionSurface = dominantLuminance >= 0.5 ? 'light' : 'dark';
    const textColor = colors.length
        ? (captionSurface === 'light'
            ? colors.slice().sort((a, b) => luminance(a) - luminance(b))[0]
            : colors.slice().sort((a, b) => luminance(b) - luminance(a))[0])
        : null;
    const captionTextColor = captionTreatment === 'boxed' ? '#171923' : textColor;

    return {
        confidence,
        motionEnergy,
        motionScale,
        captionTreatment,
        captionPack,
        titleTreatment,
        titleComponent: title?.component || null,
        titlePreset: title?.preset || null,
        graphicsDensity,
        graphicsMax,
        surface,
        transitionPacing,
        recipe,
        visualTone,
        accent: colors[0] || null,
        textColor,
        captionTextColor,
        motifs,
        titleStyle,
        captionStyle,
        transitionTypes,
        sceneDirections,
    };
}

export default { buildStyleReferencePlan };
