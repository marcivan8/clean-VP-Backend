import { vectorMatteDataUrl } from './VectorGraphics.js';

const SHAPE_MASKS = new Set(['ellipse', 'circle', 'rectangle', 'rounded-rectangle', 'capsule', 'polygon', 'star', 'arrow']);
const numeric = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

/** CSS mask styles shared by media, vector and template previews. */
export function sceneMaskCss(mask) {
    if (mask?.kind !== 'shape' || !SHAPE_MASKS.has(mask.shape)) return {};
    const inset = Math.max(0, Math.min(0.45, Number(mask.inset) || 0)) * 100;
    const hasX = numeric(mask.x), hasY = numeric(mask.y);
    const x = (hasX ? Number(mask.x) : inset / 100) * 100;
    const y = (hasY ? Number(mask.y) : inset / 100) * 100;
    const w = (numeric(mask.w) ? Number(mask.w) : 1 - x / 100 - (hasX ? 0 : inset / 100)) * 100;
    const h = (numeric(mask.h) ? Number(mask.h) : 1 - y / 100 - (hasY ? 0 : inset / 100)) * 100;
    const ellipse = `ellipse(${w / 2}% ${h / 2}% at ${x + w / 2}% ${y + h / 2}%)`;
    const rounded = `inset(${y}% ${100 - x - w}% ${100 - y - h}% ${x}% round ${Math.max(0, Math.min(50, Number(mask.radius ?? mask.roundness ?? 0.12) * Math.min(w, h)))}%)`;
    const feather = Math.max(0, Math.min(0.25, Number(mask.feather) || 0));
    if (feather > 0 || ['capsule', 'polygon', 'star', 'arrow'].includes(mask.shape) || mask.invert) {
        const size = 1000;
        const shapeRadius = Math.min(w, h) * size / 100 * 0.5;
        const outer = Math.max(1, Math.min(shapeRadius, Number(mask.outerRadius ?? mask.radius ?? 0.5) * Math.min(w, h) * size / 100));
        const inner = Math.max(1, Math.min(outer, Number(mask.innerRadius ?? 0.25) * Math.min(w, h) * size / 100));
        const image = vectorMatteDataUrl({
            kind: mask.shape === 'circle' ? 'ellipse' : mask.shape === 'rectangle' ? 'rect' : mask.shape,
            w: size, h: size,
            maskBounds: { x: x / 100, y: y / 100, w: w / 100, h: h / 100 },
            sides: mask.sides, points: mask.points,
            outerRadius: mask.shape === 'star' ? outer : undefined,
            innerRadius: mask.shape === 'star' ? inner : undefined,
            radius: mask.shape === 'capsule' ? Math.min(w, h) * size / 100 / 2
                : mask.shape === 'rounded-rectangle' ? Number(mask.radius ?? mask.roundness ?? 0.12) * Math.min(w, h) * size / 100
                    : (mask.shape === 'polygon' ? outer : undefined),
            headLength: mask.shape === 'arrow' ? size * 0.42 : undefined,
            headWidth: mask.shape === 'arrow' ? size * 0.8 : undefined,
            tailWidth: mask.shape === 'arrow' ? size * 0.32 : undefined,
            rotation: mask.rotation,
            feather: feather * size,
        }, size, size);
        if (!image) return {};
        const common = { maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat', maskMode: 'alpha', WebkitMaskMode: 'alpha' };
        if (!mask.invert) return {
            ...common, maskImage: `url("${image}")`, WebkitMaskImage: `url("${image}")`,
            maskSize: '100% 100%', WebkitMaskSize: '100% 100%', maskPosition: '0 0', WebkitMaskPosition: '0 0',
        };
        const images = `linear-gradient(#fff 0 0), url("${image}")`;
        const sizes = '100% 100%, 100% 100%';
        const positions = '0 0, 0 0';
        return { ...common, maskImage: images, WebkitMaskImage: images, maskSize: sizes, WebkitMaskSize: sizes,
            maskPosition: positions, WebkitMaskPosition: positions, maskComposite: 'exclude', WebkitMaskComposite: 'xor' };
    }
    const isEllipse = mask.shape === 'ellipse' || mask.shape === 'circle';
    if (!mask.invert) {
        return { clipPath: isEllipse ? ellipse : mask.shape === 'rounded-rectangle' ? rounded : `inset(${y}% ${100 - x - w}% ${100 - y - h}% ${x}%)` };
    }
    if (isEllipse) {
        const inverseEllipse = `radial-gradient(${ellipse.replace(/^ellipse\(/, '').replace(/\)$/, '')}, transparent 99%, #000 100%)`;
        return { maskImage: inverseEllipse, WebkitMaskImage: inverseEllipse };
    }
    return {
        maskImage: 'linear-gradient(#000 0 0), linear-gradient(#000 0 0)',
        WebkitMaskImage: 'linear-gradient(#000 0 0), linear-gradient(#000 0 0)',
        maskSize: `100% 100%, ${w}% ${h}%`,
        WebkitMaskSize: `100% 100%, ${w}% ${h}%`,
        maskPosition: `0 0, ${x}% ${y}%`, WebkitMaskPosition: `0 0, ${x}% ${y}%`,
        maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat',
        maskComposite: 'exclude', WebkitMaskComposite: 'xor',
    };
}
