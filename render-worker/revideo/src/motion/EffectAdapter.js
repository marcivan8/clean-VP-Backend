import { blur, brightness, contrast, grayscale, hue, saturate, sepia } from '@revideo/2d';
import { isEffectActiveAt } from './EffectWindows.js';
import { resolveRevideoEffectParameter } from './EffectParameters.js';

const FILTERS = { blur, brightness, contrast, grayscale, hue, saturate, sepia };

function numeric(value, fallback) {
    const raw = value && typeof value === 'object' && !Array.isArray(value) ? value.value : value;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
}

/** Resolve the CSS-compatible portion of a timeline effect stack for a Revideo node. */
export function createRevideoEffectFilters(effects, clipStart = 0, duration = 0, getTime = () => 0) {
    const result = [];
    for (const effect of Array.isArray(effects) ? effects : []) {
        const kind = effect?.kind || effect?.type;
        const p = effect?.params || {};
        const read = (key, fallback) => numeric(p[key], fallback);
        const activeValue = (key, fallback, identity, min, max) => () => {
            if (!isEffectActiveAt(effect, clipStart, duration, Number(getTime()))) return identity;
            return Math.max(min, Math.min(max, resolveRevideoEffectParameter(
                effect, key, fallback, clipStart, Number(getTime()), duration,
            )));
        };
        switch (kind) {
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

export default { createRevideoEffectFilters };
