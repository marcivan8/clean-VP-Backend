/**
 * client/src/agent/composeMotionTargets.js
 *
 * R92: which layers "animate the title so it slams in" applies to, and how
 * they are sent to the motion route. Pure (no store, no network) so the
 * regression can test it on plain track data.
 *
 * Rules:
 *   - the request names a target ("title", "captions", "sticker", "logo",
 *     "everything") → those layers;
 *   - otherwise the selected text/overlay clips;
 *   - otherwise every non-caption text clip plus templates and stickers
 *     (titles and graphics), and captions only when nothing else exists.
 * Captions go to the LLM as ONE grouped layer (there can be hundreds), and
 * that one script is then composed per caption at its own duration.
 */

const CAPTION_GROUP = '__captions__';
export { CAPTION_GROUP };

const isCaption = c => (Array.isArray(c?.words) && c.words.length > 0) || c?.style === 'subtitle' || String(c?.id || '').startsWith('caption-');

function kindOf(clip, track) {
    if (track?.type === 'text') return isCaption(clip) ? 'caption' : 'text';
    if (clip?.type === 'template' || clip?.type === 'sticker') return 'sticker';
    if (clip?.type === 'image') return 'image';
    if (clip?.type === 'video') return 'video';
    if (clip?.type === 'shape') return 'shape';
    return 'image';
}

/**
 * @param {Array} tracks  state.tracks
 * @param {string} prompt the request
 * @param {string[]} selectedIds state.selectedClipIds
 * @returns {{ layers: Array<{trackId, clip, kind}>, label: string }}
 */
export function pickMotionTargets(tracks, prompt, selectedIds = []) {
    const s = String(prompt || '').toLowerCase();
    const all = [];
    for (const t of tracks || []) {
        if (t?.type !== 'text' && t?.type !== 'overlay') continue;
        for (const c of t.clips || []) all.push({ trackId: t.id, clip: c, kind: kindOf(c, t) });
    }
    const wantsCaptions = /\bcaptions?\b|\bsubtitles?\b|sous-titres?/.test(s);
    const wantsTitles = /\btitles?\b|\bheadlines?\b|\btexts?\b|\btitres?\b|\btexte\b/.test(s);
    const wantsGraphics = /\bstickers?\b|\blogos?\b|\bgraphics?\b|\btemplates?\b|\bcounters?\b|\bimages?\b/.test(s);
    const wantsAll = /\beverything\b|\ball (?:the )?(?:layers|elements|text)\b|\btout\b/.test(s);

    let picked;
    let label;
    if (wantsAll) {
        picked = all; label = 'every text and graphic layer';
    } else if (wantsCaptions || wantsTitles || wantsGraphics) {
        picked = all.filter(l => (wantsCaptions && l.kind === 'caption')
            || (wantsTitles && l.kind === 'text')
            || (wantsGraphics && (l.kind === 'sticker' || l.kind === 'image' || l.kind === 'shape')));
        label = [wantsTitles && 'titles', wantsCaptions && 'captions', wantsGraphics && 'graphics'].filter(Boolean).join(' and ');
    } else {
        const sel = new Set(selectedIds || []);
        picked = all.filter(l => sel.has(l.clip.id));
        label = 'the selected layer(s)';
        if (picked.length === 0) {
            picked = all.filter(l => l.kind !== 'caption');
            label = 'titles and graphics';
        }
        if (picked.length === 0) {
            picked = all.filter(l => l.kind === 'caption');
            label = 'captions';
        }
    }
    return { layers: picked, label };
}

/**
 * Collapse the picked layers into at most `max` LLM layers: every non-caption
 * layer individually, all captions as one group.
 */
export function layersForPrompt(layers, max = 12) {
    const out = [];
    const captions = layers.filter(l => l.kind === 'caption');
    for (const l of layers) {
        if (l.kind === 'caption') continue;
        if (out.length >= max - (captions.length ? 1 : 0)) break;
        out.push({
            id: l.clip.id,
            kind: l.kind,
            content: String(l.clip.content || l.clip.template?.params?.text || l.clip.template?.kind || l.clip.name || '').slice(0, 120),
            duration: Math.max(0.2, Number(l.clip.duration) || 3),
        });
    }
    if (captions.length) {
        const durs = captions.map(l => Number(l.clip.duration) || 1).sort((a, b) => a - b);
        out.push({
            id: CAPTION_GROUP,
            kind: 'caption',
            content: `${captions.length} caption lines, e.g. "${String(captions[0].clip.content || '').slice(0, 60)}"`,
            duration: durs[Math.floor(durs.length / 2)],
        });
    }
    return out;
}

/** The script to use for one picked layer, from the route's answer. */
export function scriptFor(layer, scripts) {
    if (!scripts) return null;
    if (layer.kind === 'caption') return scripts[CAPTION_GROUP] || scripts[layer.clip.id] || null;
    return scripts[layer.clip.id] || null;
}

export default { pickMotionTargets, layersForPrompt, scriptFor, CAPTION_GROUP };
