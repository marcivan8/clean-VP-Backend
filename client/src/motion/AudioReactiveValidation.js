/** Find configured audio-reactive assets whose analyzed peak data is absent. */
export function findMissingAudioReactiveWaveforms(value, waveformsByAsset = {}) {
    const ids = new Set();
    const seen = new WeakSet();
    const visit = (node, depth = 0) => {
        if (!node || typeof node !== 'object' || depth > 32 || seen.has(node)) return;
        seen.add(node);
        if (Array.isArray(node)) {
            for (const child of node) visit(child, depth + 1);
            return;
        }
        const assetId = node.audioReactive?.assetId;
        if (assetId) {
            const waveform = waveformsByAsset?.[assetId];
            const peaks = Array.isArray(waveform) ? waveform : waveform?.peaks;
            if (!Array.isArray(peaks) || peaks.length === 0) ids.add(String(assetId));
        }
        for (const child of Object.values(node)) visit(child, depth + 1);
    };
    visit(value);
    return [...ids];
}
