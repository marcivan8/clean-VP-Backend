/**
 * Adapts the timeline footage-effect schema to the GPU effect graph used by
 * real-time playback. Keep this list explicit: an effect may only bypass its
 * CSS preview approximation when a matching shader is available.
 */
const GPU_CLIP_EFFECT_TYPES = Object.freeze({
    blur: 'blur_gaussian',
    blur_gaussian: 'blur_gaussian',
    blur_radial: 'blur_radial',
    blur_motion: 'blur_motion',
    'motion-blur': 'blur_motion',
    glow: 'glow',
    vignette: 'vignette',
    rgb_split: 'rgb_split',
    'chromatic-aberration': 'rgb_split',
    film_grain: 'film_grain',
    'film-grain': 'film_grain',
    grain: 'film_grain',
    glitch: 'glitch',
    color_grade: 'color_grade',
    lut_apply: 'lut_apply',
    fade_in: 'fade_in',
    fade_out: 'fade_out',
});

// The old footage `motion-blur` control represented a small pixel radius.
// The shader uses a normalized shutter travel (0..1); 31.176px of Gaussian
// sigma corresponds to one full intensity unit at the 1080px reference width.
const LEGACY_MOTION_BLUR_SIGMA_PER_INTENSITY = 31.176914536;

function rawParam(params, key) {
    const value = params?.[key];
    return value && typeof value === 'object' && !Array.isArray(value) && 'value' in value
        ? value.value
        : value;
}

export function createGpuClipEffectConfigs(clipId, effects = [], placement = {}) {
    if (!clipId || !Array.isArray(effects)) return [];
    // Fade transitions are rendered by VideoPlayer/GraphicOverlay as a color
    // wash (and layer alpha for transparent media). Running their color-mix
    // shader here as well would apply the transition twice in the preview.
    return effects.flatMap((effect, index) => {
        if (!effect || effect.enabled === false) return [];
        const kind = effect.kind || effect.type;
        if (kind === 'fade_in' || kind === 'fade_out') return [];
        const type = GPU_CLIP_EFFECT_TYPES[kind];
        if (!type) return [];
        // Footage effect keyframes are authored at the project playhead (the
        // export compositor uses those times directly). Keep their clock
        // intact, while normalizing wrapped values and nested keyframe tracks.
        const params = Object.fromEntries(Object.entries(effect.params || {}).map(([key, value]) => [key, rawParam(effect.params, key)]));
        const expressions = Object.fromEntries(Object.entries(effect.params || {})
            .map(([key, value]) => [key, value && typeof value === 'object' ? value.expression : null])
            .filter(([, expression]) => typeof expression === 'string' && expression.trim()));
        Object.assign(expressions, Object.fromEntries(Object.entries(effect.expressions || {})
            .filter(([, expression]) => typeof expression === 'string' && expression.trim())));
        const keyframes = Object.fromEntries(Object.entries(effect.keyframes || {}).map(([key, track]) => [key,
            Array.isArray(track) ? track.map(frame => ({ ...frame })) : track,
        ]));
        for (const [key, raw] of Object.entries(effect.params || {})) {
            if (!keyframes[key] && Array.isArray(raw?.keyframes)) {
                keyframes[key] = raw.keyframes.map(frame => ({ ...frame }));
            }
        }
        const readNumber = (key, fallback) => {
            const raw = rawParam(params, key);
            const value = Number(raw);
            return Number.isFinite(value) ? value : fallback;
        };
        if (type === 'rgb_split' && kind === 'chromatic-aberration') {
            params.angle ??= 0;
            params.centerX ??= 0.5;
            params.centerY ??= 0.5;
        }
        if (type === 'film_grain' && params.intensity == null && params.amount != null) {
            params.intensity = Math.max(0, Math.min(1, readNumber('amount', 0) / 48));
        }
        if (type === 'glitch' && params.intensity == null && params.amount != null) {
            params.intensity = Math.max(0, Math.min(1, readNumber('amount', 0) / 32));
        }
        const legacyAmountScale = type === 'film_grain' ? 48 : type === 'glitch' ? 32 : null;
        if (legacyAmountScale && Array.isArray(keyframes.amount) && !Array.isArray(keyframes.intensity)) {
            keyframes.intensity = keyframes.amount.map(frame => ({
                ...frame,
                value: Math.max(0, Math.min(1, Number(frame.value) / legacyAmountScale)),
            }));
        }
        if (params.intensity == null && params.amount != null) {
            const amount = Number(rawParam(params, 'amount'));
            if (type === 'blur_motion') params.intensity = Number.isFinite(amount)
                ? Math.max(0, Math.min(1, amount / LEGACY_MOTION_BLUR_SIGMA_PER_INTENSITY))
                : 0;
            if (!keyframes.intensity && Array.isArray(keyframes.amount)) {
                keyframes.intensity = keyframes.amount.map(frame => ({
                    ...frame,
                    value: Math.max(0, Math.min(1, Number(frame.value) / LEGACY_MOTION_BLUR_SIGMA_PER_INTENSITY)),
                }));
            }
        }
        if (['glow', 'vignette'].includes(type)) {
            const color = rawParam(params, 'color');
            if (typeof color === 'string') {
                const match = color.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i);
                if (match) {
                    const hex = match[1].length === 3 ? [...match[1]].map(channel => channel + channel).join('') : match[1];
                    params.color = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
                }
            }
        }
        return [{
            id: `clip-preview:${clipId}:${effect.id || index}`,
            type,
            name: effect.name || kind,
            engine: 'gpu',
            targetId: clipId,
            targetType: 'placement',
            enabled: true,
            order: Number.isFinite(Number(effect.order)) ? Number(effect.order) : index,
            startTime: effect.startTime ?? null,
            endTime: effect.endTime ?? null,
            params,
            expressions,
            keyframes,
        }];
    });
}

export function isGpuClipEffect(kind) {
    return Object.prototype.hasOwnProperty.call(GPU_CLIP_EFFECT_TYPES, kind);
}

/** Resolve the concrete shader type used for a timeline footage effect. */
export function resolveGpuClipEffectType(kind) {
    return GPU_CLIP_EFFECT_TYPES[kind] || null;
}
