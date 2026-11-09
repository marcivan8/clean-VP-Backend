import { resolveEffectParameter } from './EffectTiming.js';
import { isGpuClipEffect } from '../effects/ClipEffectAdapter.js';

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
    { id: 'film-grain', name: 'Film Grain', filter: 'url(#vibed-film-grain)' },
    { id: 'chromatic-aberration', name: 'Chromatic Shift', filter: 'url(#vibed-chromatic-aberration)' },
    { id: 'motion-blur', name: 'Motion Blur', filter: 'url(#vibed-motion-blur)' },
    { id: 'lens-distortion', name: 'Lens Distortion', filter: 'url(#vibed-lens-distortion)' },
]);

function readEffectParam(effect, key, fallback, time = 0, context = {}) {
    const params = effect?.params || {};
    return resolveEffectParameter(effect, key, fallback, time, context);
}

function isEffectActiveAtTime(effect, time) {
    const start = effect?.startTime == null || effect.startTime === '' ? -Infinity : Number(effect.startTime);
    const end = effect?.endTime == null || effect.endTime === '' ? Infinity : Number(effect.endTime);
    return !(Number.isFinite(start) && time < start) && !(Number.isFinite(end) && time >= end);
}

function fadeColor(value) {
    if (Array.isArray(value)) {
        const channels = value.slice(0, 3).map(channel => {
            const number = Number(channel);
            if (!Number.isFinite(number)) return 0;
            return Math.round(Math.max(0, Math.min(1, number <= 1 ? number : number / 255)) * 255);
        });
        while (channels.length < 3) channels.push(0);
        return `rgb(${channels.join(' ')})`;
    }
    return typeof value === 'string' && value.trim() ? value : '#000000';
}

/** Color overlays for the footage fades that the export compositor renders. */
export function resolveTimelineFadeOverlays(effects = [], time = 0, context = {}) {
    const now = Number.isFinite(Number(time)) ? Number(time) : 0;
    const clipStart = Number.isFinite(Number(context.clipStart)) ? Number(context.clipStart) : 0;
    const clipDuration = Math.max(0, Number(context.clipDuration) || 0);
    const clipEnd = clipStart + clipDuration;
    const overlays = [];
    for (const effect of Array.isArray(effects) ? effects : []) {
        if (!effect || effect.enabled === false) continue;
        const kind = effect.kind || effect.type;
        if (!['fade_in', 'fade_out'].includes(kind)) continue;
        const authoredStart = effect.startTime == null || effect.startTime === '' ? clipStart : Number(effect.startTime);
        const authoredEnd = effect.endTime == null || effect.endTime === '' ? clipEnd : Number(effect.endTime);
        const start = Number.isFinite(authoredStart) ? authoredStart : clipStart;
        const end = Number.isFinite(authoredEnd) && authoredEnd > start ? authoredEnd : clipEnd;
        const params = effect.params || {};
        const rawDuration = params.duration?.value ?? params.duration;
        const duration = Math.max(0.05, Math.min(5, Number(rawDuration) || 0.5));
        const fadeDuration = Math.min(duration, Math.max(0.05, end - start));
        const fadeStart = kind === 'fade_in' ? start : Math.max(start, end - fadeDuration);
        const fadeEnd = kind === 'fade_in' ? start + fadeDuration : end;
        if (!(fadeEnd > fadeStart) || now < fadeStart || now >= fadeEnd) continue;
        const progress = Math.max(0, Math.min(1, (now - fadeStart) / (fadeEnd - fadeStart)));
        const opacity = kind === 'fade_in' ? 1 - progress : progress;
        if (opacity <= 0) continue;
        const rawColor = params.color?.value ?? params.color;
        overlays.push({ color: fadeColor(rawColor), opacity });
    }
    return overlays;
}

/** Layer opacity for image/sticker fades, which must preserve transparent pixels. */
export function resolveTimelineFadeOpacity(effects = [], time = 0, context = {}) {
    const now = Number.isFinite(Number(time)) ? Number(time) : 0;
    const clipStart = Number.isFinite(Number(context.clipStart)) ? Number(context.clipStart) : 0;
    const clipDuration = Math.max(0, Number(context.clipDuration) || 0);
    const clipEnd = clipStart + clipDuration;
    let opacity = 1;
    for (const effect of Array.isArray(effects) ? effects : []) {
        if (!effect || effect.enabled === false) continue;
        const kind = effect.kind || effect.type;
        if (!['fade_in', 'fade_out'].includes(kind)) continue;
        const authoredStart = effect.startTime == null || effect.startTime === '' ? clipStart : Number(effect.startTime);
        const authoredEnd = effect.endTime == null || effect.endTime === '' ? clipEnd : Number(effect.endTime);
        const start = Number.isFinite(authoredStart) ? authoredStart : clipStart;
        const end = Number.isFinite(authoredEnd) && authoredEnd > start ? authoredEnd : clipEnd;
        const params = effect.params || {};
        const rawDuration = params.duration?.value ?? params.duration;
        const duration = Math.max(0.05, Math.min(5, Number(rawDuration) || 0.5));
        const fadeDuration = Math.min(duration, Math.max(0.05, end - start));
        const fadeStart = kind === 'fade_in' ? start : Math.max(start, end - fadeDuration);
        const fadeEnd = kind === 'fade_in' ? start + fadeDuration : end;
        if (!(fadeEnd > fadeStart) || now < fadeStart) {
            if (kind === 'fade_in' && now < fadeStart) opacity = 0;
            continue;
        }
        if (now >= fadeEnd) {
            if (kind === 'fade_out') opacity = 0;
            continue;
        }
        const progress = Math.max(0, Math.min(1, (now - fadeStart) / (fadeEnd - fadeStart)));
        opacity *= kind === 'fade_in' ? progress : 1 - progress;
    }
    return Math.max(0, Math.min(1, opacity));
}

export function resolveTimelineEffectFilter(effects = [], time = 0, context = {}) {
    const activeEffects = (Array.isArray(effects) ? effects : [])
        .map((effect, index) => ({ effect, index }))
        .sort((a, b) => (Number(a.effect?.order) || 0) - (Number(b.effect?.order) || 0) || a.index - b.index)
        .map(({ effect }) => effect)
        .filter(effect => effect && effect.enabled !== false && isEffectActiveAtTime(effect, time)
            && !(context.gpuPreview && isGpuClipEffect(effect.kind || effect.type)));
    const filterNames = {
        color_grade: 'color-grade', grain: 'film-grain', film_grain: 'film-grain', 'film-grain': 'film-grain',
        rgb_split: 'chromatic-aberration', 'chromatic-aberration': 'chromatic-aberration',
        blur_motion: 'motion-blur', 'motion-blur': 'motion-blur', distortion: 'lens-distortion', 'lens-distortion': 'lens-distortion',
        glitch: 'glitch', glow: 'highlight-glow',
    };
    return activeEffects
        .map((effect, index) => {
            const p = effect.params || {};
            const read = (key, fallback) => Number(readEffectParam(effect, key, fallback, time, context));
            const kind = effect.kind || effect.type || effect.id;
            const filterId = filterNames[kind] ? `vibed-${filterNames[kind]}-${index}` : null;
            if (effect.filter) return filterId && String(effect.filter).startsWith('url(#vibed-')
                ? `url(#${filterId})` : effect.filter;
            const amount = read('amount', read('value', 1));
            switch (kind) {
                case 'blur': case 'blur_gaussian': return `blur(${Math.max(0, Math.min(50, read('radius', amount)))}px)`;
                // Radial blur has a zoom-sampling GPU shader. A Gaussian SVG
                // approximation reads as directional blur, so leave this to
                // the GPU path or the native fallback's canvas renderer.
                case 'blur_radial': return '';
                case 'blur_motion': return `url(#vibed-motion-blur)`;
                case 'brightness': return `brightness(${Number.isFinite(amount) ? Math.max(0, Math.min(2, amount)) : 1})`;
                case 'contrast': return `contrast(${Number.isFinite(amount) ? Math.max(0, Math.min(4, amount)) : 1})`;
                case 'saturation': case 'saturate': return `saturate(${Number.isFinite(amount) ? Math.max(0, Math.min(5, amount)) : 1})`;
                case 'hue': case 'hue-rotate': return `hue-rotate(${Math.max(-360, Math.min(360, read('degrees', amount) || 0))}deg)`;
                case 'color_grade': {
                    const hue = Math.max(-180, Math.min(180, read('hueRotate', 0)));
                    const temperature = Math.max(-100, Math.min(100, read('temperature', 0)));
                    const tint = Math.max(-100, Math.min(100, read('tint', 0)));
                    return `${temperature || tint ? `url(#${filterId})` : ''} brightness(${Math.max(0, Math.min(2, read('brightness', 100) / 100))}) contrast(${Math.max(0, Math.min(2, read('contrast', 100) / 100))}) saturate(${Math.max(0, Math.min(2, read('saturation', 100) / 100))})${hue ? ` hue-rotate(${hue}deg)` : ''}`.trim();
                }
                case 'grain': case 'film_grain': case 'film-grain': return `url(#${filterId})`;
                case 'chromatic-aberration': case 'rgb_split': return `url(#${filterId})`;
                case 'blur_motion': case 'motion-blur': return `url(#${filterId})`;
                case 'distortion': case 'lens-distortion': return `url(#${filterId})`;
                case 'glitch': return `url(#${filterId})`;
                case 'glow': return `url(#${filterId})`;
                default: return '';
            }
        })
        .filter(Boolean)
        .join(' ');
}

/** Parameterized SVG filters need one definition per effect instance so stacked
 * copies keep their own values instead of all inheriting the last instance. */
export function resolveTimelineSvgEffectInstances(effects = [], time = 0, context = {}) {
    const definitions = {
        color_grade: 'color-grade', grain: 'film-grain', film_grain: 'film-grain', 'film-grain': 'film-grain',
        rgb_split: 'chromatic-aberration', 'chromatic-aberration': 'chromatic-aberration',
        blur_motion: 'motion-blur', 'motion-blur': 'motion-blur', distortion: 'lens-distortion', 'lens-distortion': 'lens-distortion',
        glitch: 'glitch', glow: 'highlight-glow',
    };
    return (Array.isArray(effects) ? effects : [])
        .map((effect, index) => ({ effect, index }))
        .sort((a, b) => (Number(a.effect?.order) || 0) - (Number(b.effect?.order) || 0) || a.index - b.index)
        .map(({ effect }) => effect)
        .filter(effect => effect && effect.enabled !== false && isEffectActiveAtTime(effect, time)
            && !(context.gpuPreview && isGpuClipEffect(effect.kind || effect.type)))
        .map((effect, index) => {
            const kind = effect.kind || effect.type || effect.id;
            const filterName = definitions[kind];
            return filterName ? {
                id: `vibed-${filterName}-${index}`,
                kind,
                params: resolveTimelineSvgEffectParams([effect], time, context),
            } : null;
        }).filter(Boolean);
}

/** Parameterized SVG filter values used by the live footage preview. */
export function resolveTimelineSvgEffectParams(effects = [], time = 0, context = {}) {
    const resolved = {
        grain: { intensity: 0.15, size: 1.5, seed: 9, animated: true },
        chromatic: { amount: 1.5, angle: 0 },
        motion: { amount: 1.2 },
        distortion: { amount: 5 },
        colorGrade: { temperature: 0, tint: 0 },
        radial: { intensity: 0, centerX: 0.5, centerY: 0.5, samples: 12 },
        glitch: { amount: 8, seed: 17 },
        glow: { threshold: 0.7, intensity: 1, radius: 10, color: 'rgb(255 255 255)' },
    };
    const read = (effect, key, fallback) => {
        const value = Number(readEffectParam(effect, key, fallback, time, context));
        return Number.isFinite(value) ? value : fallback;
    };
    for (const effect of Array.isArray(effects) ? effects : []) {
        if (!effect || effect.enabled === false || !isEffectActiveAtTime(effect, time)) continue;
        if (effect.filter && !effect.params) continue;
        const kind = effect.kind || effect.type || effect.id;
        const p = effect.params || {};
        const amount = read(effect, 'amount', read(effect, 'value', 1));
        if (kind === 'grain' || kind === 'film_grain' || kind === 'film-grain') {
            const grain = p.intensity != null ? read(effect, 'intensity', 0.15) : amount / 48;
            resolved.grain.intensity = Math.max(0, Math.min(1, grain));
            resolved.grain.size = Math.max(0.5, Math.min(5, read(effect, 'size', 1.5)));
            resolved.grain.seed = Math.max(0, Math.min(2147483647, Math.floor(read(effect, 'seed', 9))));
            const animated = p.animated?.value ?? p.animated;
            resolved.grain.animated = animated == null ? true : Boolean(animated);
        } else if (kind === 'chromatic-aberration' || kind === 'rgb_split') {
            resolved.chromatic.amount = Math.max(0, Math.min(12, read(effect, 'amount', kind === 'rgb_split' ? 5 : 1.5)));
            resolved.chromatic.angle = kind === 'rgb_split' ? read(effect, 'angle', 0) : 0;
        } else if (kind === 'blur_radial') {
            resolved.radial.intensity = Math.max(0, Math.min(1, read(effect, 'intensity', 0.3)));
            resolved.radial.centerX = Math.max(0, Math.min(1, read(effect, 'centerX', 0.5)));
            resolved.radial.centerY = Math.max(0, Math.min(1, read(effect, 'centerY', 0.5)));
            resolved.radial.samples = Math.max(1, Math.min(16, Math.round(read(effect, 'samples', 12))));
        } else if (kind === 'motion-blur' || kind === 'blur_motion') {
            resolved.motion.amount = Math.max(0, Math.min(8, read(effect, 'intensity', read(effect, 'radius', amount))));
        } else if (kind === 'distortion' || kind === 'lens-distortion' || kind === 'glitch') {
            if (kind === 'glitch') {
                resolved.glitch.amount = Math.max(0, Math.min(32, read(effect, 'amount', read(effect, 'intensity', 0.2) * 40)));
                resolved.glitch.seed = Math.max(0, Math.min(1000, read(effect, 'seed', 17)));
            } else {
                const displacement = kind === 'distortion' && Math.abs(amount) <= 0.2 ? Math.abs(amount) * (5 / 0.018) : amount;
                resolved.distortion.amount = Math.max(0, Math.min(20, displacement));
            }
        } else if (kind === 'color_grade') {
            resolved.colorGrade.temperature = Math.max(-100, Math.min(100, read(effect, 'temperature', 0)));
            resolved.colorGrade.tint = Math.max(-100, Math.min(100, read(effect, 'tint', 0)));
        } else if (kind === 'glow') {
            resolved.glow.threshold = Math.max(0, Math.min(0.99, read(effect, 'threshold', 0.7)));
            resolved.glow.intensity = Math.max(0, Math.min(3, read(effect, 'intensity', 1)));
            resolved.glow.radius = Math.max(0.1, Math.min(40, read(effect, 'radius', 10)));
            const rawColor = readEffectParam(effect, 'color', [1, 1, 1], time, context);
            resolved.glow.color = Array.isArray(rawColor)
                ? `rgb(${rawColor.slice(0, 3).map(channel => Math.round(Math.max(0, Math.min(1, Number(channel) || 0)) * 255)).join(' ')})`
                : String(rawColor || 'rgb(255 255 255)');
        }
    }
    return resolved;
}

/** Deterministic clip-local camera shake transform shared by preview and export. */
export function resolveTimelineEffectTransform(effects = [], time = 0, frameWidth = 1080, keyframeTime = time, context = {}) {
    const transforms = [];
    const t = Math.max(0, Number(time) || 0);
    const widthScale = Math.max(0.25, (Number(frameWidth) || 1080) / 1080);
    for (const effect of Array.isArray(effects) ? effects : []) {
        if (!effect || effect.enabled === false || !isEffectActiveAtTime(effect, keyframeTime) || (effect.kind || effect.type) !== 'shake') continue;
        const p = effect.params || {};
        const read = (key, fallback) => Number(readEffectParam(effect, key, fallback, keyframeTime, context));
        const intensity = Math.max(0, Math.min(50, read('intensity', read('amount', 5)))) * widthScale;
        const frequency = Math.max(1, Math.min(60, read('frequency', 10)));
        const seed = read('randomSeed', 0);
        const rotation = Math.max(0, Math.min(10, read('rotationAmount', 0)));
        const phase = t * frequency * Math.PI * 2;
        const x = (Math.sin(phase * 1.17 + seed * 12.9898) * 0.72 + Math.sin(phase * 0.73 + seed * 7.31) * 0.28) * intensity;
        const y = (Math.sin(phase * 0.91 + 100 + seed * 3.17) * 0.68 + Math.sin(phase * 1.31 + seed * 9.2) * 0.32) * intensity;
        const r = Math.sin(phase * 0.83 + 200 + seed * 5.13) * rotation;
        if (Math.abs(x) > 0.001 || Math.abs(y) > 0.001 || Math.abs(r) > 0.001) {
            transforms.push(`translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${r.toFixed(3)}deg)`);
        }
    }
    return transforms.join(' ');
}

/** A frame-edge tint overlay for the registry's vignette footage effect. */
export function resolveTimelineVignetteStyle(effects = [], time = 0, context = {}) {
    if (context.gpuPreview) return null;
    const vignette = (Array.isArray(effects) ? effects : [])
        .filter(effect => effect?.enabled !== false && isEffectActiveAtTime(effect, time) && (effect?.kind || effect?.type) === 'vignette')
        .at(-1);
    if (!vignette) return null;
    const p = vignette.params || {};
    const read = (key, fallback) => Number(readEffectParam(vignette, key, fallback, time, context));
    const intensity = Math.max(0, Math.min(1, read('intensity', 0.5)));
    const radius = Math.max(0.1, Math.min(1.5, read('radius', 0.7)));
    const softness = Math.max(0, Math.min(1, read('softness', 0.5)));
    if (intensity <= 0) return null;
    const rawColor = readEffectParam(vignette, 'color', [0, 0, 0], time, context);
    const color = Array.isArray(rawColor)
        ? `rgb(${rawColor.slice(0, 3).map(channel => Math.round(Math.max(0, Math.min(1, Number(channel) || 0)) * 255)).join(' ')})`
        : String(rawColor || '#000000');
    const clearAt = Math.round(Math.max(0, Math.min(95, radius * 60)));
    const falloff = Math.round(8 + softness * 24);
    const edgeAt = Math.min(100, clearAt + falloff);
    return {
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: `radial-gradient(ellipse at center, transparent ${clearAt}%, color-mix(in srgb, ${color} ${Math.round(intensity * 100)}%, transparent) ${edgeAt}%, color-mix(in srgb, ${color} ${Math.round(intensity * 100)}%, transparent) 100%)`,
    };
}

export function combinePreviewFilters(...filters) {
    const parts = filters.map(value => String(value || '').trim())
        .filter(value => value && value !== 'none');
    return parts.length ? parts.join(' ') : 'none';
}
