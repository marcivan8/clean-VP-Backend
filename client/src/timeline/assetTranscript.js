/** Resolve source words for one asset and source-time range without cross-file bleed. */
export function transcriptForAssetRange({
    assetId,
    offset = 0,
    duration = 0,
    diarizationByAsset = {},
    captions = [],
    allowUnscopedCaptions = false,
} = {}) {
    const id = assetId == null ? null : String(assetId);
    const diarized = id ? diarizationByAsset?.[id]?.words : null;
    const hasAssetScopedWords = Array.isArray(diarized) && diarized.length > 0;
    const taggedCaptions = (Array.isArray(captions) ? captions : []).filter(word => {
        const wordAssetId = word?.assetId ?? word?.asset_id;
        return wordAssetId != null && String(wordAssetId) === id;
    });
    const words = hasAssetScopedWords
        ? diarized
        : taggedCaptions.length > 0
            ? taggedCaptions
            : allowUnscopedCaptions ? captions : [];
    const start = Math.max(0, Number(offset) || 0);
    const end = start + Math.max(0, Number(duration) || 0);
    return (Array.isArray(words) ? words : [])
        .filter(word => Number(word?.start) >= start - 0.1 && Number(word?.end) <= end + 0.1)
        .map(word => word?.word || word?.text || '')
        .join(' ')
        .trim()
        .slice(0, 300);
}
