/** Resolve effect activity against source timeline bounds or compositor output windows. */
const numeric = (value, fallback = NaN) => {
    if (value === null || value === undefined || typeof value === 'boolean' || (typeof value === 'string' && value.trim() === '')) return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
};

export function isEffectActiveAt(effect, clipStart, duration, time) {
    if (!effect || effect.enabled === false) return false;
    const startTime = numeric(clipStart, 0);
    const currentTime = numeric(time);
    if (!Number.isFinite(currentTime)) return false;
    if (Array.isArray(effect.outputWindows)) {
        const localTime = currentTime - startTime;
        return effect.outputWindows.some(window => {
            const start = numeric(window?.start), end = numeric(window?.end);
            return Number.isFinite(start) && Number.isFinite(end) && start <= localTime && localTime < end;
        });
    }
    const rawStart = numeric(effect.startTime);
    const rawEnd = numeric(effect.endTime);
    const clipDuration = numeric(duration, 0);
    const start = Number.isFinite(rawStart) ? rawStart : startTime;
    const end = Number.isFinite(rawEnd) ? rawEnd : startTime + (clipDuration || Infinity);
    return currentTime >= start && currentTime < end;
}

export default { isEffectActiveAt };
