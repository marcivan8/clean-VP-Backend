import { blur, brightness, contrast, grayscale, hue, invert, saturate, sepia } from '@revideo/2d';
import { isEffectActiveAt } from './EffectWindows.js';
import { resolveRevideoEffectParameter } from './EffectParameters.js';

const FILTERS = { blur, brightness, contrast, grayscale, hue, invert, saturate, sepia };

function numeric(value, fallback) {
    const raw = value && typeof value === 'object' && !Array.isArray(value) && 'value' in value ? value.value : value;
    if (raw === null || raw === undefined || typeof raw === 'boolean' || (typeof raw === 'string' && raw.trim() === '')) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
}

/** Resolve the CSS-compatible portion of a timeline effect stack for a Revideo node. */
export function createRevideoEffectFilters(effects, clipStart = 0, duration = 0, getTime = () => 0) {
    const result = [];
    for (const effect of Array.isArray(effects) ? effects : []) {
        if (!effect || effect.enabled === false) continue;
        const kind = effect?.kind || effect?.type;
        const p = effect?.params || {};
        const read = (key, fallback) => numeric(p[key], fallback);
        const activeValue = (key, fallback, identity, min, max) => () => {
            if (!isEffectActiveAt(effect, clipStart, duration, numeric(getTime(), 0))) return identity;
            return Math.max(min, Math.min(max, resolveRevideoEffectParameter(
                effect, key, fallback, clipStart, numeric(getTime(), 0), duration,
            )));
        };
        switch (kind) {
            case 'invert':
                result.push(invert(activeValue('amount', read('value', 1), 0, 0, 1)));
                break;
            case 'blur': case 'blur_gaussian':
                result.push(blur(activeValue('radius', read('amount', 0), 0, 0, 50)));
                break;
            case 'brightness':
                result.push(brightness(activeValue('amount', read('value', 1), 1, 0, 2)));
                break;
            case 'contrast':
                result.push(contrast(activeValue('amount', read('value', 1), 1, 0, 4)));
                break;
            case 'saturation': case 'saturate':
                result.push(saturate(activeValue('amount', read('value', 1), 1, 0, 5)));
                break;
            case 'hue': case 'hue-rotate':
                result.push(hue(activeValue('degrees', read('amount', 0), 0, -360, 360)));
                break;
            case 'grayscale':
                result.push(grayscale(activeValue('amount', read('value', 1), 0, 0, 1)));
                break;
            case 'sepia':
                result.push(sepia(activeValue('amount', read('value', 1), 0, 0, 1)));
                break;
            default:
                break;
        }
    }
    return result;
}

/** Resolve the single shadow channel supported by Revideo nodes from a stack.
 * Multiple active shadows are folded into one visible shadow; offsets add and
 * blur uses the strongest requested radius. All numeric controls remain live
 * signals so keyframes and effect windows are evaluated during rendering.
 */
export function createRevideoEffectShadowProps(effects, clipStart = 0, duration = 0, getTime = () => 0) {
    const shadows = (Array.isArray(effects) ? effects : []).filter(effect =>
        effect && effect.enabled !== false && ['shadow', 'drop-shadow'].includes(effect.kind || effect.type),
    );
    if (!shadows.length) return {};

    const active = effect => isEffectActiveAt(effect, clipStart, duration, numeric(getTime(), 0));
    const resolve = (effect, key, fallback) => resolveRevideoEffectParameter(
        effect, key, fallback, clipStart, numeric(getTime(), 0), duration,
    );
    const resolveColor = effect => {
        const value = effect?.params?.color;
        const color = value && typeof value === 'object' && !Array.isArray(value) && 'value' in value
            ? value.value : value;
        const opacity = Math.max(0, Math.min(1, resolve(effect, 'opacity', 0.55)));
        if (Array.isArray(color) && color.length >= 3) {
            const channels = color.slice(0, 3).map(channel => Math.round(Math.max(0, Math.min(255,
                Number(channel) <= 1 ? Number(channel) * 255 : Number(channel)))));
            return `rgba(${channels.join(', ')}, ${opacity})`;
        }
        if (typeof color !== 'string' || !color.trim()) return `rgba(0, 0, 0, ${opacity})`;
        const hex = color.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i);
        if (hex) {
            const value = hex[1].length === 3 ? [...hex[1]].map(channel => channel + channel).join('') : hex[1];
            const channels = [0, 2, 4].map(index => parseInt(value.slice(index, index + 2), 16));
            return `rgba(${channels.join(', ')}, ${opacity})`;
        }
        const rgb = color.trim().match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
        if (rgb) {
            const sourceAlpha = rgb[4] == null ? 1 : Math.max(0, Math.min(1, Number(rgb[4])));
            return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${opacity * sourceAlpha})`;
        }
        return color;
    };

    return {
        shadowColor: () => {
            const effect = [...shadows].reverse().find(active);
            return effect ? resolveColor(effect) : 'rgba(0, 0, 0, 0)';
        },
        shadowBlur: () => shadows.reduce((radius, effect) => active(effect)
            ? Math.max(radius, Math.max(0, Math.min(100, resolve(effect, 'blur', 12))))
            : radius, 0),
        shadowOffsetX: () => shadows.reduce((offset, effect) => active(effect)
            ? offset + Math.max(-200, Math.min(200, resolve(effect, 'x', resolve(effect, 'offsetX', 0))))
            : offset, 0),
        shadowOffsetY: () => shadows.reduce((offset, effect) => active(effect)
            ? offset + Math.max(-200, Math.min(200, resolve(effect, 'y', resolve(effect, 'offsetY', 0))))
            : offset, 0),
    };
}

export default { createRevideoEffectFilters, createRevideoEffectShadowProps };
