/**
 * designVariations.js — real variations of the design in progress (R170).
 *
 * The Variations tray used to show four hard-coded sample directions ("The
 * 94° rule"...) whatever was on the canvas, and "Regenerate" re-ran the brief
 * through the command parser. Now every card is the USER'S layers, restyled:
 *
 *   buildLocalVariations()   instant, free, offline: palette, typography,
 *                            mirrored layout, emphasis. A new `round` gives a
 *                            different mix, so Regenerate always changes.
 *   applyVariationPatches()  turns the AI's per-layer patches into layers,
 *                            keeping only known layers and safe values.
 *
 * Pure: no React, no store, no network. Layers are never mutated.
 */

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const SAFE_FILL = /^(#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\([\d\s.,%]+\)|(linear|radial)-gradient\([#\w\s.,%()-]+\)|transparent)$/i;
export const isSafeFill = (v) => typeof v === 'string' && v.length <= 200 && SAFE_FILL.test(v.trim());

const DISPLAY_FONTS = ['Plus Jakarta Sans', 'Instrument Serif', 'Anton', 'Montserrat', 'Bebas Neue', 'Playfair Display', 'Inter', 'Oswald'];

/** Palettes, each a full set so a variation reads as one look. */
const PALETTES = [
    { name: 'Midnight', bg: 'linear-gradient(160deg, #0B1220 0%, #1E293B 100%)', text: '#F8FAFC', accent: '#00E5FF', accent2: '#8A2BE2' },
    { name: 'Paper', bg: 'linear-gradient(170deg, #F5EFEB 0%, #E7DDD5 100%)', text: '#1A1C22', accent: '#C8622F', accent2: '#1F140E' },
    { name: 'Signal', bg: '#111111', text: '#FFFFFF', accent: '#FBBF24', accent2: '#EF4444' },
    { name: 'Forest', bg: 'linear-gradient(160deg, #0F2A1F 0%, #1E4D3A 100%)', text: '#ECFDF5', accent: '#34D399', accent2: '#FDE68A' },
    { name: 'Coral', bg: 'linear-gradient(150deg, #FFF1EC 0%, #FFD7C9 100%)', text: '#3B1408', accent: '#F25C3B', accent2: '#1F2937' },
    { name: 'Electric', bg: 'linear-gradient(135deg, #1B0B3A 0%, #3B0D6B 100%)', text: '#FFFFFF', accent: '#22D3EE', accent2: '#F472B6' },
];

const clone = (layers) => (Array.isArray(layers) ? layers : []).map(l => ({ ...l }));
const isText = (l) => l.type === 'text';
const isBg = (l) => l.type === 'bg';
const isAccentShape = (l) => ['badge', 'rect', 'ellipse', 'circle', 'star', 'polygon', 'line'].includes(l.type);

/** The largest text layer: what the eye reads first. */
function headlineOf(layers) {
    return layers.filter(isText).sort((a, b) => (Number(b.fontSize) || 0) - (Number(a.fontSize) || 0))[0] || null;
}

function paletteVariation(layers, palette) {
    return layers.map(l => {
        if (isBg(l)) return { ...l, fill: palette.bg };
        if (isText(l)) return { ...l, fill: palette.text };
        if (isAccentShape(l)) {
            const next = { ...l };
            if (l.fill && l.fill !== 'transparent') next.fill = l.type === 'badge' ? palette.accent : palette.accent2;
            if (l.stroke && l.stroke !== 'transparent') next.stroke = palette.accent;
            return next;
        }
        return l;
    });
}

function typographyVariation(layers, font, { upper = false, tighter = false } = {}) {
    const head = headlineOf(layers);
    return layers.map(l => {
        if (!isText(l)) return l;
        const isHead = l.id === head?.id;
        return {
            ...l,
            fontFamily: isHead ? font : l.fontFamily,
            ...(isHead && upper ? { textTransform: 'uppercase' } : {}),
            ...(isHead && tighter ? { letterSpacing: -1, lineHeight: 0.95 } : {}),
        };
    });
}

/** Mirror every positioned layer across the vertical centre line. */
function mirroredVariation(layers, format) {
    const W = Number(format?.w) || 1280;
    return layers.map(l => {
        if (isBg(l) || !Number.isFinite(Number(l.x)) || !Number.isFinite(Number(l.w))) return l;
        const x = Math.round(W - Number(l.x) - Number(l.w));
        const align = l.textAlign === 'left' ? 'right' : l.textAlign === 'right' ? 'left' : l.textAlign;
        return { ...l, x: Math.max(0, x), ...(align ? { textAlign: align } : {}) };
    });
}

/** Push the hierarchy: headline bigger, secondary text quieter. */
function emphasisVariation(layers, format) {
    const W = Number(format?.w) || 1280;
    const head = headlineOf(layers);
    return layers.map(l => {
        if (!isText(l)) return l;
        if (l.id === head?.id) {
            const fontSize = Math.round(Math.min((Number(l.fontSize) || 48) * 1.3, 220));
            const w = Math.round(Math.min((Number(l.w) || 400) * 1.25, W - (Number(l.x) || 0) - 24));
            return { ...l, fontSize, w: Math.max(Number(l.w) || 0, w), fontWeight: 800 };
        }
        return { ...l, opacity: Math.min(Number(l.opacity ?? 100), 82) };
    });
}

/**
 * Four variations of the current design. `round` picks a different palette,
 * font and combination, so each Regenerate shows something new.
 * @returns {Array<{ id, title, style, layers, source: 'local' }>}
 */
export function buildLocalVariations(layers, { format, brandKit, round = 0 } = {}) {
    const base = clone(layers);
    if (base.length === 0) return [];
    const r = Math.abs(Math.floor(Number(round) || 0));
    const pal = (k) => PALETTES[(r * 2 + k) % PALETTES.length];
    const brandPalette = brandKit && HEX.test(brandKit.accent || '') ? {
        name: brandKit.name || 'Brand kit', bg: brandKit.surface || '#111111', text: brandKit.text || '#FFFFFF',
        accent: brandKit.accent, accent2: brandKit.accent2 || brandKit.accent,
    } : null;
    const font = (k) => DISPLAY_FONTS[(r * 3 + k) % DISPLAY_FONTS.length];
    const firstPalette = r === 0 && brandPalette ? brandPalette : pal(0);

    const out = [
        { title: `${firstPalette.name} palette`, style: 'Colour', layers: paletteVariation(base, firstPalette) },
        { title: `${font(0)} headline`, style: 'Typography', layers: typographyVariation(base, font(0), { upper: r % 2 === 0, tighter: true }) },
        { title: 'Mirrored layout', style: 'Layout', layers: paletteVariation(mirroredVariation(base, format), pal(1)) },
        { title: 'Bigger statement', style: 'Emphasis', layers: typographyVariation(emphasisVariation(base, format), font(1)) },
    ];
    return out.map((v, i) => ({ ...v, id: `local-${r}-${i}`, source: 'local' }));
}

// ── AI variations: patches → layers ─────────────────────────────────────────

const NUMERIC = { x: [-2000, 6000], y: [-2000, 6000], w: [1, 6000], h: [1, 6000], fontSize: [6, 400], opacity: [0, 100], rotation: [-360, 360], cornerRadius: [0, 400], strokeWidth: [0, 60], letterSpacing: [-20, 40], lineHeight: [0.6, 3], fontWeight: [100, 900] };
const STRING = { text: 400, fontFamily: 60, textAlign: 10, textTransform: 12 };

/** Keep only fields the canvas understands, with values it can draw. */
export function sanitizeLayerPatch(patch) {
    const out = {};
    if (!patch || typeof patch !== 'object') return out;
    for (const [k, [lo, hi]] of Object.entries(NUMERIC)) {
        const v = Number(patch[k]);
        if (patch[k] !== undefined && Number.isFinite(v)) out[k] = Math.min(hi, Math.max(lo, v));
    }
    for (const [k, max] of Object.entries(STRING)) {
        if (typeof patch[k] === 'string' && patch[k].trim()) out[k] = patch[k].slice(0, max);
    }
    if (out.textAlign && !['left', 'center', 'right'].includes(out.textAlign)) delete out.textAlign;
    if (out.textTransform && !['none', 'uppercase', 'lowercase', 'capitalize'].includes(out.textTransform)) delete out.textTransform;
    if (isSafeFill(patch.fill)) out.fill = patch.fill.trim();
    if (isSafeFill(patch.stroke)) out.stroke = patch.stroke.trim();
    return out;
}

/**
 * One AI variation = `{ title, style, patches: { [layerId]: patch } }`.
 * Patches naming a layer that does not exist are ignored (a model must not
 * invent layers here); a variation that changes nothing is dropped.
 */
export function applyVariationPatches(layers, variations) {
    const base = clone(layers);
    const ids = new Set(base.map(l => l.id));
    return (Array.isArray(variations) ? variations : []).slice(0, 4).map((v, i) => {
        const patches = v && typeof v.patches === 'object' && !Array.isArray(v.patches) ? v.patches : {};
        let changed = 0;
        const next = base.map(l => {
            if (!ids.has(l.id) || !patches[l.id]) return l;
            const p = sanitizeLayerPatch(patches[l.id]);
            const diff = Object.keys(p).some(k => p[k] !== l[k]);
            if (diff) changed++;
            return diff ? { ...l, ...p } : l;
        });
        if (!changed) return null;
        return {
            id: `ai-${Date.now()}-${i}`,
            title: String(v.title || `Direction ${i + 1}`).slice(0, 40),
            style: String(v.style || 'AI direction').slice(0, 30),
            layers: next,
            source: 'ai',
        };
    }).filter(Boolean);
}
