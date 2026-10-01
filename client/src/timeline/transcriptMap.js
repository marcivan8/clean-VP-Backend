/**
 * transcriptMap.js — place source-file transcript words on the edited timeline.
 *
 * Whisper transcripts are stored per SOURCE FILE in source time
 * (store.transcripts[basename] = [{ word, start, end, ... }]). After cuts,
 * reorders and silence removal, the main video track is a list of clips, each
 * showing a window of one source file:
 *     clip.assetId → which file,  clip.offset → where in that file it starts,
 *     clip.start   → where on the timeline,  clip.duration × clip.speed → how
 *     much source it covers.
 * This maps every word through the clip that actually plays it, so captions and
 * the transcript panel follow the edit: reordered clips carry their own words,
 * cut words disappear, and each clip only ever gets words from ITS OWN file.
 *
 * Pure and dependency-free. Only the MAIN video track is read (the track the
 * spoken audio comes from — same pick as the exporter's base track), so b-roll
 * on other video tracks never duplicates words.
 */

import { getMainVideoTrackId } from './rippleDelete.js';

const EPS = 0.01;
const basename = (p) => (typeof p === 'string' ? p.split(/[\\/]/).pop() : '') || '';

/**
 * The server-side path (raw/… or temp/…) of a clip's source file, the same
 * resolution MediaExecutionEngine uses for $uploaded_file: the asset's gcsPath
 * first, then a raw/ path recovered from its URLs. null when unknown.
 */
export function resolveClipSourcePath(clip, assets) {
    const asset = (Array.isArray(assets) ? assets : []).find(a => a && a.id === clip?.assetId) || null;
    const toServerPath = (url) => {
        if (typeof url !== 'string' || !url) return null;
        if (url.startsWith('raw/') || url.startsWith('temp/')) return url;
        const m = url.match(/\/(raw\/[^?#]+)/);
        if (m) return m[1];
        const p = url.match(/\/api\/proxy\/gcs-media\/proxies\/([^/?#]+)\/([^/?#]+)/);
        if (p) return `raw/${p[1]}/${p[2]}`;
        return null;
    };
    return (asset?.gcsPath && toServerPath(asset.gcsPath))
        || toServerPath(asset?.serverPath)
        || toServerPath(asset?.sourceUrl)
        || toServerPath(clip?.sourceUrl)
        || toServerPath(asset?.proxyUrl)
        || null;
}

/**
 * Distinct source files heard on the MAIN track, in timeline order:
 * [{ key, path, name }] where key is the transcripts-map key (basename of path)
 * and name is the asset's display name.
 * Image clips and clips whose file can't be resolved are skipped.
 */
export function listMainTrackSources(tracks, assets) {
    const list = Array.isArray(tracks) ? tracks : [];
    const mainId = getMainVideoTrackId(list);
    const main = list.find(t => t?.id === mainId);
    if (!main?.clips?.length) return [];
    const assetList = Array.isArray(assets) ? assets : [];
    const seen = new Set();
    const out = [];
    const clips = main.clips.slice().sort((a, b) => (Number(a.start) || 0) - (Number(b.start) || 0));
    for (const clip of clips) {
        if (!(Number(clip.duration) > 0)) continue;
        const asset = assetList.find(a => a && a.id === clip.assetId);
        if (clip.type === 'image' || asset?.type === 'image') continue;
        const path = resolveClipSourcePath(clip, assetList);
        const key = basename(path);
        if (!path || !key || seen.has(key)) continue;
        seen.add(key);
        out.push({ key, path, name: asset?.name || key });
    }
    return out;
}

/** Candidate transcript keys for a clip's source file, most specific first. */
function sourceKeysForClip(clip, assets) {
    const asset = (Array.isArray(assets) ? assets : []).find(a => a && a.id === clip.assetId) || null;
    const keys = [
        basename(asset?.gcsPath),
        basename(resolveClipSourcePath(clip, assets)),
        basename(asset?.serverPath),
        basename(asset?.filePath),
        basename(asset?.filename),
        basename(clip.sourceUrl),
        basename(asset?.name),
    ].filter(Boolean);
    return [...new Set(keys)];
}

/**
 * @param {object} p
 * @param {Array}  p.tracks        legacy tracks
 * @param {Array}  p.assets        store.assets
 * @param {object} p.transcripts   { [basename]: words[] } in SOURCE time
 * @param {Array} [p.fallbackWords] source-time words to use when a clip's file
 *        has no transcript entry — only honoured for single-source timelines,
 *        so words from one file can never land on clips of another.
 * @returns {Array} words in TIMELINE time, sorted, each also carrying
 *          srcStart/srcEnd (source time) and sourceKey.
 */
export function mapTranscriptToTimeline({ tracks, assets, transcripts, fallbackWords = null }) {
    const list = Array.isArray(tracks) ? tracks : [];
    const mainId = getMainVideoTrackId(list);
    const main = list.find(t => t?.id === mainId);
    if (!main?.clips?.length) return [];

    const map = transcripts && typeof transcripts === 'object' ? transcripts : {};
    const clips = main.clips
        .filter(c => Number(c.duration) > 0)
        .slice()
        .sort((a, b) => (Number(a.start) || 0) - (Number(b.start) || 0));
    const assetIds = new Set(clips.map(c => c.assetId || null));
    const singleSource = assetIds.size <= 1;

    const out = [];
    for (const clip of clips) {
        let words = null;
        let sourceKey = null;
        for (const k of sourceKeysForClip(clip, assets)) {
            if (Array.isArray(map[k]) && map[k].length > 0) { words = map[k]; sourceKey = k; break; }
        }
        if (!words && singleSource && Array.isArray(fallbackWords) && fallbackWords.length > 0) {
            words = fallbackWords; sourceKey = null;
        }
        if (!words) continue;

        const speed = Number(clip.speed) > 0 ? Number(clip.speed) : 1;
        const tlStart = Number(clip.start) || 0;
        const tlEnd = tlStart + (Number(clip.duration) || 0);
        const srcStart = Number(clip.offset) || 0;
        const srcEnd = srcStart + (Number(clip.duration) || 0) * speed;

        for (const w of words) {
            const ws = Number(w?.start);
            const we = Number.isFinite(Number(w?.end)) ? Number(w.end) : ws;
            if (!Number.isFinite(ws)) continue;
            // A word belongs to the clip that plays most of it (its midpoint),
            // so a word split by a cut shows once, where it is mostly heard.
            const mid = (ws + we) / 2;
            if (mid < srcStart - EPS || mid >= srcEnd - EPS) continue;
            const start = Math.max(tlStart, tlStart + (ws - srcStart) / speed);
            const end = Math.min(tlEnd, tlStart + (we - srcStart) / speed);
            out.push({
                ...w,
                word: w.word ?? w.text ?? w.content ?? '',
                start,
                end: Math.max(start, end),
                srcStart: ws,
                srcEnd: we,
                sourceKey,
            });
        }
    }
    out.sort((a, b) => a.start - b.start);
    return out;
}
