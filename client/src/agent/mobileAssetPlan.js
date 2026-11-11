/** Pick source footage for the guided mobile edit without flattening a whole bin
 * onto the main track. Supporting footage stays in the bin for contextual
 * b-roll; sequence requests deliberately use every eligible visual asset.
 */
export function planMobileVisualAssets(assets = [], prompt = '', outcomeId = 'reel', profiles = []) {
    const candidates = (Array.isArray(assets) ? assets : []).filter(asset =>
        asset && asset.assistantReference !== true && asset.isReference !== true && asset.role !== 'reference'
        && ['video', 'image'].includes(String(asset.type || '').toLowerCase())
        && (asset.url || asset.proxyUrl || asset.sourceUrl || asset.gcsPath || asset.storagePath));
    if (!candidates.length) return { mode: 'empty', primary: null, sequence: [] };

    const text = String(prompt || '').toLowerCase();
    const sequenceRequest = outcomeId === 'photo_collage'
        || /\b(collage|montage|compilation|highlights?|photo dump|slideshow|all (?:the )?(?:clips|footage|videos|photos))\b/i.test(text)
        || (outcomeId === 'vlog' && !/\b(main|talking head|face ?cam|narrat(?:e|ion)|voice ?over)\b/i.test(text));
    if (sequenceRequest) return { mode: 'sequence', primary: candidates[0], sequence: candidates };

    const videoCandidates = candidates.filter(asset => String(asset.type).toLowerCase() === 'video');
    const pool = videoCandidates.length ? videoCandidates : candidates;
    const byId = new Map((Array.isArray(profiles) ? profiles : []).map(profile => [String(profile.assetId || profile.id || ''), profile]));
    const named = candidates.find(asset => asset.name && text.includes(String(asset.name).toLowerCase()));
    if (named) return { mode: 'primary', primary: named, sequence: [named] };

    const score = asset => {
        const profile = byId.get(String(asset.id)) || {};
        const analysis = asset.visualAnalysis || asset.analysis || {};
        let value = 0;
        if (profile.hasMainSpeaker === true || analysis.hasMainSpeaker === true || analysis.has_main_speaker === true || asset.hasMainSpeaker === true) value += 100;
        if (profile.isBroll === true || analysis.isBroll === true || analysis.is_broll === true || asset.isBroll === true) value -= 80;
        const description = [profile.sceneType, profile.contentDescription, profile.suggestedLabel,
            analysis.sceneType, analysis.contentDescription, asset.contentDescription, asset.name].join(' ').toLowerCase();
        if (/talking.?head|face.?cam|interview|presenter|speaking|speaker|narrat/.test(description)) value += 35;
        if (/b.?roll|event|crowd|landscape|food|venue|street|product close/.test(description)) value -= 25;
        // Stable upload order is the fallback when analysis is missing or tied.
        return value;
    };
    const ranked = pool.map((asset, index) => ({ asset, index, score: score(asset) }))
        .sort((a, b) => b.score - a.score || a.index - b.index);
    if (ranked.length > 1 && ranked[0].score <= 0) {
        return { mode: 'ambiguous', primary: null, sequence: [], candidates: ranked.map(item => item.asset) };
    }
    const primary = ranked[0].asset;
    return { mode: 'primary', primary, sequence: [primary], supporting: candidates.filter(asset => asset.id !== primary.id) };
}
