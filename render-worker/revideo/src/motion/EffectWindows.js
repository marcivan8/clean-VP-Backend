/** Resolve effect activity against source timeline bounds or compositor output windows. */
export function isEffectActiveAt(effect, clipStart, duration, time) {
    if (!effect || effect.enabled === false) return false;
    if (Array.isArray(effect.outputWindows)) {
        const localTime = Number(time) - (Number(clipStart) || 0);
        return effect.outputWindows.some(window => Number.isFinite(Number(window?.start))
            && Number.isFinite(Number(window?.end))
            && Number(window.start) <= localTime && localTime < Number(window.end));
    }
    const start = effect.startTime == null || effect.startTime === '' ? Number(clipStart) || 0 : Number(effect.startTime);
    const end = effect.endTime == null || effect.endTime === ''
        ? (Number(clipStart) || 0) + (Number(duration) || Infinity)
        : Number(effect.endTime);
    return (!Number.isFinite(start) || Number(time) >= start) && (!Number.isFinite(end) || Number(time) < end);
}

export default { isEffectActiveAt };
