/** Linear interpolation resampler for decoded mono PCM chunks. */
export function resampleMonoPcm(input, sourceRate, targetRate) {
    if (!(input instanceof Float32Array)) return new Float32Array();
    const from = Number(sourceRate), to = Number(targetRate);
    if (!input.length || !Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to <= 0) return input.slice();
    if (Math.abs(from - to) < 1) return input.slice();

    const outputLength = Math.max(1, Math.round(input.length * to / from));
    const output = new Float32Array(outputLength);
    const ratio = from / to;
    for (let i = 0; i < outputLength; i++) {
        const position = Math.min(input.length - 1, i * ratio);
        const index = Math.floor(position);
        const next = Math.min(input.length - 1, index + 1);
        const fraction = position - index;
        output[i] = input[index] * (1 - fraction) + input[next] * fraction;
    }
    return output;
}
