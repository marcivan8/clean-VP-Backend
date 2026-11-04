/* Shared timings, so every animated section settles with the same character:
   a short, slightly damped move rather than a long ease. */
export const EASE = [0.22, 0.61, 0.36, 1];
export const DUR = 0.55;

/** True when the visitor has asked the system to reduce motion. */
export function prefersReducedMotion() {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
        return false;
    }
}

export default prefersReducedMotion;
