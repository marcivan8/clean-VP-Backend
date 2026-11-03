/** Small CSS effects that work on both the editor preview and the web export. */
export const TIMELINE_EFFECTS = Object.freeze([
    { id: 'warm-film', name: 'Warm Film', filter: 'sepia(0.24) saturate(1.18) contrast(1.06)' },
    { id: 'vivid', name: 'Vivid', filter: 'saturate(1.45) contrast(1.08)' },
    { id: 'noir', name: 'Noir', filter: 'grayscale(1) contrast(1.22)' },
    { id: 'dreamy', name: 'Dreamy', filter: 'brightness(1.08) saturate(0.88) blur(0.6px)' },
    { id: 'soft-contrast', name: 'Soft Contrast', filter: 'brightness(0.94) contrast(1.06)' },
    { id: 'cool-tone', name: 'Cool Tone', filter: 'hue-rotate(12deg) saturate(0.92) contrast(1.04)' },
    { id: 'soft-focus', name: 'Soft Focus', filter: 'blur(1px) saturate(0.92)' },
    { id: 'bright-pop', name: 'Bright Pop', filter: 'brightness(1.12) saturate(1.24)' },
    { id: 'golden-hour', name: 'Golden Hour', filter: 'sepia(0.16) saturate(1.3) hue-rotate(-8deg) brightness(1.05)' },
    { id: 'cinematic', name: 'Cinematic', filter: 'contrast(1.16) saturate(0.86) brightness(0.96)' },
    { id: 'matte', name: 'Matte', filter: 'contrast(0.88) brightness(1.05) saturate(0.9)' },
    { id: 'high-contrast', name: 'High Contrast', filter: 'contrast(1.34) saturate(1.08)' },
    { id: 'sepia', name: 'Sepia', filter: 'sepia(0.78) saturate(0.9)' },
    { id: 'mono', name: 'Monochrome', filter: 'grayscale(1)' },
    { id: 'blue-mono', name: 'Blue Mono', filter: 'grayscale(1) sepia(0.2) hue-rotate(175deg) saturate(1.25)' },
    { id: 'teal-shift', name: 'Teal Shift', filter: 'hue-rotate(155deg) saturate(0.78)' },
    { id: 'rose-toned', name: 'Rose Toned', filter: 'sepia(0.14) hue-rotate(315deg) saturate(1.18)' },
    { id: 'sunset', name: 'Sunset', filter: 'sepia(0.23) hue-rotate(-18deg) saturate(1.42)' },
    { id: 'faded-film', name: 'Faded Film', filter: 'contrast(0.82) saturate(0.78) brightness(1.08)' },
    { id: 'crisp', name: 'Crisp', filter: 'contrast(1.18) saturate(1.08)' },
    { id: 'moody', name: 'Moody', filter: 'brightness(0.82) contrast(1.18) saturate(0.82)' },
    { id: 'shadow-lift', name: 'Shadow Lift', filter: 'brightness(1.1) contrast(0.9)' },
    { id: 'bright-airy', name: 'Bright Airy', filter: 'brightness(1.16) contrast(0.92) saturate(0.9)' },
    { id: 'cool-night', name: 'Cool Night', filter: 'hue-rotate(18deg) brightness(0.8) saturate(0.82)' },
    { id: 'warm-shadow', name: 'Warm Shadow', filter: 'sepia(0.12) brightness(0.9) contrast(1.08)' },
    { id: 'soft-warm', name: 'Soft Warm', filter: 'sepia(0.12) saturate(0.92) brightness(1.04)' },
    { id: 'vintage', name: 'Vintage', filter: 'sepia(0.32) contrast(0.92) saturate(0.78)' },
    { id: 'washed', name: 'Washed', filter: 'brightness(1.08) contrast(0.78) saturate(0.78)' },
    { id: 'punchy', name: 'Punchy', filter: 'contrast(1.24) saturate(1.34)' },
    { id: 'pastel', name: 'Pastel', filter: 'saturate(0.72) brightness(1.08) contrast(0.88)' },
    { id: 'amber', name: 'Amber', filter: 'sepia(0.24) hue-rotate(-10deg) saturate(1.22)' },
    { id: 'aqua', name: 'Aqua', filter: 'hue-rotate(155deg) saturate(1.18) brightness(1.02)' },
    { id: 'lavender', name: 'Lavender', filter: 'hue-rotate(265deg) saturate(0.78) brightness(1.04)' },
    { id: 'sports', name: 'Sports', filter: 'contrast(1.22) saturate(1.3) brightness(1.02)' },
]);

export function resolveTimelineEffectFilter(effects = []) {
    return (Array.isArray(effects) ? effects : [])
        .filter(effect => effect && effect.enabled !== false && effect.filter)
        .map(effect => effect.filter)
        .join(' ');
}

export function combinePreviewFilters(...filters) {
    const parts = filters.map(value => String(value || '').trim())
        .filter(value => value && value !== 'none');
    return parts.length ? parts.join(' ') : 'none';
}
