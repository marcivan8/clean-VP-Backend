/**
 * Context-aware, deterministic visual direction for generated transcript captions.
 * Variation is deliberately restrained: a video keeps a coherent base voice,
 * while meaningful spoken moments earn a different type, accent, placement,
 * or caption treatment. Explicitly styled caption packs remain user-owned.
 */

const FONT_SETS = {
    punchy: ['Anton', 'Montserrat', 'Oswald'],
    travel: ['Montserrat', 'Anton', 'Poppins'],
    explainer: ['Poppins', 'DM Sans', 'Inter'],
    podcast: ['DM Sans', 'Inter', 'Montserrat'],
    editorial: ['Playfair Display', 'DM Sans', 'Cormorant Garamond'],
    luxury: ['Cormorant Garamond', 'Playfair Display', 'Inter'],
    tech: ['Rajdhani', 'Inter', 'JetBrains Mono'],
    default: ['Montserrat', 'DM Sans', 'Inter'],
};

const PALETTES = {
    punchy: ['#FFE500', '#FFFFFF', '#FF6B6B'],
    travel: ['#FFFFFF', '#FDE68A', '#7DD3FC'],
    explainer: ['#FFFFFF', '#4ADE80', '#38BDF8'],
    podcast: ['#FFFFFF', '#00E5FF', '#FDE68A'],
    editorial: ['#F5F5F0', '#E8C27A', '#FFFFFF'],
    luxury: ['#F0E6D2', '#D4AF6A', '#FFFFFF'],
    tech: ['#FFFFFF', '#00E5FF', '#34D399'],
    default: ['#FFFFFF', '#FACC15', '#4ADE80'],
};

const clean = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const hash = value => { let h = 2166136261; for (const c of String(value || '')) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

function styleFamily(style) {
    const s = clean(style);
    if (/hormozi|mrbeast|punch|viral|creator-pop|bold-impact/.test(s)) return 'punchy';
    if (/travel|voyage|vlog/.test(s)) return 'travel';
    if (/explainer|tutorial|education|ali-abdaal/.test(s)) return 'explainer';
    if (/podcast|interview/.test(s)) return 'podcast';
    if (/editorial|documentary|cinematic|story/.test(s)) return 'editorial';
    if (/luxury|premium|elegant/.test(s)) return 'luxury';
    if (/tech|gaming|modern-tech/.test(s)) return 'tech';
    return 'default';
}

function emotionOf(cap, visualTone) {
    const eventType = String(cap?.intelligenceCue?.eventType || '').toUpperCase();
    if (eventType === 'PUNCHLINE_DETECTED' || eventType === 'EMPHASIS_MOMENT') return 'high';
    if (eventType === 'EMOTIONAL_BEAT') return 'soft';
    if (eventType === 'REVEAL') return 'focus';
    const explicit = clean(cap?.intelligenceCue?.emotion || cap?.emotion || cap?.emotionalTone || cap?.sentiment);
    if (/anger|angry|frustrat|urgent|fear|surpris|excited|joy|energetic|colere|peur|surpris|enthousias/.test(explicit)) return 'high';
    if (/calm|sad|serious|reflect|warm|gentle|triste|calme|serieux|soft|emotional/.test(explicit)) return 'soft';
    if (/reveal|focus|narrative|story/.test(explicit)) return 'focus';
    const visual = clean(visualTone);
    if (/energetic|humorous|tense|dramatic/.test(visual)) return 'high';
    if (/calm|serious|intimate|melancholic/.test(visual)) return 'soft';
    return 'neutral';
}

function placementFor({ subject, emotion, index, aspectRatio }) {
    const vertical = String(aspectRatio || '').includes(':') && (() => {
        const [w, h] = String(aspectRatio).split(':').map(Number); return h > w;
    })();
    const cx = Number(subject?.cx), cy = Number(subject?.cy), sh = Number(subject?.h);
    const hasSubject = [cx, cy, sh].every(Number.isFinite);
    // Most dialogue captions remain low. Only a strong beat relocates, and
    // only to a region opposite the tracked speaker box.
    if (emotion === 'high' || emotion === 'focus') {
        if (hasSubject && cy > 0.58) return { x: 50, y: vertical ? 25 : 22, position: 'top' };
        if (hasSubject && cy < 0.38) return { x: 50, y: vertical ? 76 : 78, position: 'bottom' };
        if (hasSubject && sh > 0.58) return { x: cx > 0.5 ? 24 : 76, y: 50, position: 'center' };
        if (index % 2 === 1) return { x: 50, y: vertical ? 28 : 24, position: 'top' };
    }
    return { x: 50, y: vertical ? 82 : 84, position: 'bottom' };
}

/** Resolve supported clip fields for one generated caption segment. */
export function resolveCaptionArtDirection(cap, context = {}) {
    const family = styleFamily(context.editingStyle || context.captionPack || context.style || '');
    const emotion = emotionOf(cap, context.visualTone);
    const token = hash(`${context.seed || ''}|${cap?.start || 0}|${cap?.text || cap?.content || ''}`);
    const fonts = FONT_SETS[family] || FONT_SETS.default;
    const colors = PALETTES[family] || PALETTES.default;
    const accent = colors[emotion === 'high' ? 0 : emotion === 'focus' ? 1 : (token % colors.length)];
    const placement = placementFor({ subject: context.subject, emotion, index: context.index || 0, aspectRatio: context.aspectRatio });
    const treatment = emotion === 'high' && family !== 'editorial' && family !== 'luxury'
        ? { animationPreset: 'pop', wordHighlight: { mode: 'color', color: accent, scale: 1.1 } }
        : emotion === 'focus'
            ? { animationPreset: family === 'tech' ? 'blur-reveal' : 'slide-up', wordHighlight: { mode: 'color', color: accent, scale: 1.04 } }
            : { animationPreset: family === 'punchy' ? 'pop' : 'fade', wordHighlight: { mode: 'color', color: accent, scale: 1.02 } };
    const tokens = String(cap?.text || cap?.content || '').split(/\s+/).filter(Boolean);
    const emphasizedAt = emotion === 'neutral' ? -1 : tokens.findIndex(token =>
        /\d/.test(token) || /^(never|always|best|worst|huge|insane|crazy|jamais|toujours|meilleur|pire|incroyable|enorme)[!?.,]*$/i.test(token));
    const emphasis = emphasizedAt >= 0 ? [emphasizedAt] : undefined;
    const cue = cap?.intelligenceCue;
    const cueAt = Number(cue?.timelineTime);
    const localCueTime = Number.isFinite(cueAt) ? Math.max(0, cueAt - (Number(cap?.start) || 0)) : 0;
    const life = Math.max(0.3, Number(context.duration) || ((Number(cap?.end) || 0) - (Number(cap?.start) || 0)) || 1);
    const hasNarrativeCue = ['PUNCHLINE_DETECTED', 'EMPHASIS_MOMENT', 'EMOTIONAL_BEAT', 'REVEAL'].includes(String(cue?.eventType || '').toUpperCase());
    const direction = token % 2 === 0 ? -1 : 1;
    const movement = hasNarrativeCue ? [{
        id: `caption-intelligence-${Math.round((Number(cap?.start) || 0) * 1000)}`,
        source: 'caption-intelligence',
        type: 'translate',
        startTime: Math.min(localCueTime, Math.max(0, life - 0.36)),
        duration: Math.min(0.36, life),
        easing: 'easeOutCubic',
        anchor: 'moment',
        keyframes: [
            { time: 0, properties: { x: direction * (emotion === 'high' ? 16 : 10), y: emotion === 'high' ? 4 : 2, opacity: 0.35 } },
            { time: Math.min(0.24, life), properties: { x: direction * 2, y: -1, opacity: 1 } },
            { time: Math.min(0.36, life), properties: { x: 0, y: 0, opacity: 1 } },
        ],
    }] : [];
    return {
        fontFamily: fonts[token % fonts.length],
        fontWeight: emotion === 'high' ? 800 : (family === 'editorial' || family === 'luxury' ? 500 : 650),
        fontSize: emotion === 'high' ? 54 : 48,
        color: family === 'punchy' && emotion === 'neutral' ? '#FFFFFF' : accent,
        textShadow: '0 2px 8px rgba(0,0,0,0.72)',
        stroke: { width: emotion === 'high' ? 2 : 1, color: '#000000' },
        textAlign: placement.x < 40 ? 'left' : placement.x > 60 ? 'right' : 'center',
        ...placement,
        captionStyle: { packId: null, contextFamily: family, emotion, ...treatment },
        animations: movement,
        ...(emphasis ? { emphasis: { indices: emphasis, source: 'auto' } } : {}),
        meta: { contextFamily: family, emotion, rationale: `caption direction from ${family} style and ${emotion} transcript cues` },
    };
}

export default { resolveCaptionArtDirection };
