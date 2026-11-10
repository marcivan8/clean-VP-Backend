/** Deterministic audio-envelope sampling shared by 2D and 3D motion. */
export function sampleAudioEnvelope(waveform, time = 0, duration = 0) {
    const peaks = Array.isArray(waveform) ? waveform : waveform?.peaks;
    if (!Array.isArray(peaks) || peaks.length === 0) return 0;
    const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    const span = Math.max(0, finite(waveform?.duration, duration));
    const at = span > 0 ? Math.max(0, Math.min(1, finite(time) / span)) * (peaks.length - 1) : 0;
    const lo = Math.floor(at);
    const hi = Math.min(peaks.length - 1, lo + 1);
    const a = Math.max(0, Math.min(1, finite(peaks[lo])));
    const b = Math.max(0, Math.min(1, finite(peaks[hi])));
    return a + (b - a) * (at - lo);
}

/** Apply one normalized audio envelope to a resolved 2D motion state. */
export function applyAudioReactiveMotion(motion, config, time, duration, waveforms = {}) {
    if (!config || typeof config !== 'object' || !config.assetId) return motion;
    const authoredTarget = String(config.target || 'scale');
    const target = ({ positionX: 'x', positionY: 'y', rotationZ: 'rotation' })[authoredTarget] || authoredTarget;
    if (!['x', 'y', 'scale', 'rotation', 'opacity', 'blur', 'glow'].includes(target)) return motion;
    const rawAmount = Number(config.amount);
    const amount = Number.isFinite(rawAmount) ? Math.max(-10, Math.min(10, rawAmount)) : 0;
    const waveform = waveforms?.[config.assetId];
    const envelope = sampleAudioEnvelope(waveform, time, duration);
    if (!envelope || !amount) return motion;
    const delta = amount * envelope;
    if (target === 'scale') {
        const sign = Math.sign(motion.scale) || 1;
        return { ...motion, scale: sign * Math.max(0.01, Math.abs(motion.scale) * Math.max(0.01, 1 + delta)) };
    }
    if (target === 'opacity') return { ...motion, opacity: Math.max(0, Math.min(1, motion.opacity + delta)) };
    if (target === 'blur' || target === 'glow') return { ...motion, [target]: Math.max(0, Math.min(100, motion[target] + delta)) };
    return { ...motion, [target]: motion[target] + delta };
}
