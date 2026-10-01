/**
 * uploadStatus.js — one reading of "where is this video in the upload
 * pipeline", for the mobile upload UI (MobileUploadStatus, timeline clips,
 * the Export button and the Roka bar).
 *
 * Pure and dependency-free apart from the main-track pick. It only READS the
 * fields IDELayout.handleFileImport already writes on a video asset:
 *   uploadPhase    'uploading' → 'processing' → 'ready'
 *   uploadProgress 0..100 (XHR upload progress)
 *   gcsPath        set the moment the raw file lands in storage
 *   isProxying     true until the proxy job resolves (or falls back to raw)
 *   uploadError    set only when the upload itself failed (no raw file stored)
 *   file           the in-memory File; absent after a page reload
 *
 * Why not just use uploadPhase: IDELayout flips it to 'processing' on a fixed
 * 5-second timer, even while a large file is still uploading over a phone
 * connection. Here "uploaded" means the bytes really arrived (gcsPath, or
 * 100% progress), so the UI never says "preparing" at 12% uploaded.
 */

import { getMainVideoTrackId } from '../timeline/rippleDelete.js';

export const UPLOAD_PHASES = Object.freeze({
    UPLOADING: 'uploading',
    PREPARING: 'preparing',
    READY: 'ready',
    FAILED: 'failed',          // the upload itself failed; the File is still in memory
    INTERRUPTED: 'interrupted', // saved mid-upload, page reloaded: nothing is running any more
});

const clampPct = (n) => Math.max(0, Math.min(100, Math.round(n)));

/** @returns {{ phase: string, progress: number|null }} */
export function getAssetUploadStatus(asset) {
    if (!asset || asset.type !== 'video') return { phase: UPLOAD_PHASES.READY, progress: null };
    if (asset.uploadError) {
        return { phase: asset.file ? UPLOAD_PHASES.FAILED : UPLOAD_PHASES.INTERRUPTED, progress: null };
    }
    const busy = asset.isProxying === true || (typeof asset.uploadPhase === 'string' && asset.uploadPhase !== 'ready');
    if (!busy) return { phase: UPLOAD_PHASES.READY, progress: null };
    if (!asset.file) return { phase: UPLOAD_PHASES.INTERRUPTED, progress: null };

    const pct = Number(asset.uploadProgress);
    const uploaded = !!asset.gcsPath || (Number.isFinite(pct) && pct >= 100);
    if (!uploaded) {
        return { phase: UPLOAD_PHASES.UPLOADING, progress: Number.isFinite(pct) ? clampPct(pct) : 0 };
    }
    return { phase: UPLOAD_PHASES.PREPARING, progress: null };
}

export const isPendingPhase = (phase) => phase === UPLOAD_PHASES.UPLOADING || phase === UPLOAD_PHASES.PREPARING;
export const isProblemPhase = (phase) => phase === UPLOAD_PHASES.FAILED || phase === UPLOAD_PHASES.INTERRUPTED;

/**
 * Everything the mobile UI needs, from the store's assets + tracks.
 * @returns {{
 *   items: Array<{ id, name, size, phase, progress, onMainTrack: boolean, onTimeline: boolean }>,
 *   primary: object|null,     // the item the full-screen preview card is about
 *   blocking: boolean,        // nothing on the main track can play yet → full card on the preview
 *   exportBlocked: boolean,   // a clip on the timeline uses a video that isn't playable yet
 *   headline: 'failed'|'waiting'|null,
 * }}
 */
export function summarizeUploads(assets, tracks) {
    const assetList = Array.isArray(assets) ? assets : [];
    const trackList = Array.isArray(tracks) ? tracks : [];
    const byId = new Map(assetList.filter(Boolean).map(a => [a.id, a]));

    const mainId = getMainVideoTrackId(trackList);
    const mainClips = (trackList.find(t => t?.id === mainId)?.clips || []).filter(c => Number(c?.duration) > 0);
    const mainAssetIds = new Set(mainClips.map(c => c.assetId).filter(Boolean));
    const timelineAssetIds = new Set();
    for (const t of trackList) {
        if (t?.type !== 'video' && t?.type !== 'image') continue;
        for (const c of t.clips || []) if (c?.assetId) timelineAssetIds.add(c.assetId);
    }

    const items = [];
    for (const a of assetList) {
        if (!a || a.type !== 'video') continue;
        const s = getAssetUploadStatus(a);
        if (s.phase === UPLOAD_PHASES.READY) continue;
        items.push({
            id: a.id,
            name: a.name || 'Video',
            size: Number(a.fileSize) > 0 ? Number(a.fileSize) : null,
            phase: s.phase,
            progress: s.progress,
            onMainTrack: mainAssetIds.has(a.id),
            onTimeline: timelineAssetIds.has(a.id),
        });
    }

    const statusOfClip = (c) => getAssetUploadStatus(byId.get(c.assetId)).phase;
    const mainHasPlayable = mainClips.some(c => statusOfClip(c) === UPLOAD_PHASES.READY);
    const blocking = items.length > 0 && !mainHasPlayable
        && (mainClips.length === 0 || mainClips.some(c => items.some(i => i.id === c.assetId)));

    const rank = (i) => (i.onMainTrack ? 0 : 2) + (isProblemPhase(i.phase) ? 0 : 1);
    const primary = items.length > 0 ? items.slice().sort((x, y) => rank(x) - rank(y))[0] : null;

    return {
        items,
        primary,
        blocking,
        exportBlocked: items.some(i => i.onTimeline),
        headline: items.some(i => isProblemPhase(i.phase)) ? 'failed' : (items.length > 0 ? 'waiting' : null),
    };
}

/**
 * Why Roka requests must wait right now (mobile request queue):
 * 'uploading' | 'failed' | null. Waits when the preview can't play yet, or a
 * video used on the timeline isn't ready; a video sitting only in the media
 * bin never holds Roka back.
 */
export function aiWaitReason(assets, tracks) {
    const s = summarizeUploads(assets, tracks);
    if (!(s.blocking || s.exportBlocked)) return null;
    const relevant = s.items.filter(i => i.onTimeline || s.blocking);
    return relevant.some(i => isProblemPhase(i.phase)) ? 'failed' : 'uploading';
}

/** "182 MB of 430 MB" helper input: bytes → whole MB. */
export function toMB(bytes) {
    return Number(bytes) > 0 ? Math.max(1, Math.round(Number(bytes) / (1024 * 1024))) : null;
}
