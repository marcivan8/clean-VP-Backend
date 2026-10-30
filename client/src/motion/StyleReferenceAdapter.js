/**
 * Turn the bounded vision profile for an explicit style reference into
 * existing, supported creative choices. We never accept arbitrary model
 * values as component, font, animation, transition, or asset identifiers.
 */
const ENUMS = {
    motionEnergy: new Set(['low', 'medium', 'high']),
    captionTreatment: new Set(['none', 'minimal', 'clean', 'bold', 'word_highlight', 'boxed', 'kinetic']),
    titleTreatment: new Set(['none', 'minimal', 'top_card', 'centered', 'large_kinetic', 'lower_third']),
    graphicsDensity: new Set(['sparse', 'balanced', 'dense']),
    transitionPacing: new Set(['slow', 'medium', 'fast']),
    visualTone: new Set(['cinematic', 'editorial', 'warm', 'viral', 'technology']),
};

const validEnum = (value, allowed) => {
    const normalized = String(value || '').toLowerCase().replace(/[ -]+/g, '_');
    return allowed.has(normalized) ? normalized : null;
};
const hex = value => /^#[\da-f]{6}$/i.test(String(value || '').trim()) ? String(value).trim().toUpperCase() : null;

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
    const evidenceCount = [motionEnergy, captionTreatment, titleTreatment, graphicsDensity, transitionPacing, visualTone]
        .filter(Boolean).length + (colors.length ? 1 : 0) + (motifs.length ? 1 : 0);
    if (evidenceCount < 2) return null;

    const captionPack = ({
        bold: 'hormozi',
        word_highlight: 'mrbeast',
        boxed: 'hormozi-bounce',
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
    })[titleTreatment] || null;
    const recipe = transitionPacing === 'fast' || motionEnergy === 'high'
        ? 'punchy'
        : transitionPacing === 'slow' || motionEnergy === 'low' ? 'explainer' : 'travel';
    const motionScale = ({ low: 0.65, medium: 0.85, high: 1.05 })[motionEnergy] || 0.85;
    const graphicsMax = ({ sparse: 1, balanced: 2, dense: 4 })[graphicsDensity] || 2;

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
        transitionPacing,
        recipe,
        visualTone,
        accent: colors[0] || null,
        textColor: colors.find(color => color !== colors[0]) || null,
        motifs,
    };
}

export default { buildStyleReferencePlan };
