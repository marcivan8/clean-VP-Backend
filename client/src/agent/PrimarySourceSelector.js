import { isReferenceAsset } from '../utils/assetRoles.js';

/**
 * Pick the source that should carry the edit's narration. Prefer explicit
 * analysis evidence that a clip contains the main speaker. If analysis has
 * not finished, preserve upload order and choose the first playable video;
 * callers can report that this was a conservative choice.
 */
export function selectPrimaryNarrationAsset(assets = [], profiles = []) {
    const playable = (Array.isArray(assets) ? assets : []).filter(asset =>
        asset && String(asset.type || '').toLowerCase().startsWith('video')
        && !isReferenceAsset(asset)
        && !asset.provider
        && (asset.url || asset.sourceUrl || asset.proxyUrl || asset.gcsPath)
    );
    if (!playable.length) return { asset: null, confidence: 'none', reason: 'no_playable_video' };

    const profileById = new Map((Array.isArray(profiles) ? profiles : [])
        .filter(profile => profile?.assetId)
        .map(profile => [String(profile.assetId), profile]));
    const score = asset => {
        const profile = profileById.get(String(asset.id)) || {};
        const visual = asset.visualAnalysis || asset.analysis || {};
        const speaker = profile.hasMainSpeaker === true || profile.has_main_speaker === true
            || visual.hasMainSpeaker === true || visual.has_main_speaker === true;
        const speech = profile.hasSpokenWord === true || profile.has_spoken_word === true
            || visual.hasSpokenWord === true || visual.has_spoken_word === true
            || /speech|dialogue|interview|podcast|voice/i.test(String(profile.audioType || profile.audio_type || visual.audioType || ''));
        return { value: (speaker ? 4 : 0) + (speech ? 2 : 0), speaker, speech };
    };

    const ranked = playable.map((asset, index) => ({ asset, index, ...score(asset) }))
        .sort((a, b) => b.value - a.value || a.index - b.index);
    const best = ranked[0];
    const next = ranked[1];
    const evidence = best.speaker || best.speech;
    // A profile with a main speaker is a strong signal. Speech-only evidence
    // is accepted only when it clearly distinguishes this source from others.
    const uniqueSignal = best.speaker || (best.speech && (!next || best.value > next.value));
    return {
        asset: uniqueSignal ? best.asset : playable[0],
        confidence: uniqueSignal ? 'analysis' : 'upload_order_fallback',
        reason: uniqueSignal ? (best.speaker ? 'main_speaker_detected' : 'speech_detected') : (evidence ? 'ambiguous_speech' : 'analysis_pending'),
        candidateCount: playable.length,
    };
}

export default { selectPrimaryNarrationAsset };
