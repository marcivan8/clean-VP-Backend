/**
 * retakeSource.js — what the retake detector reads, and how its findings are
 * shown before cutting. Pure (no store import) so it can be tested in node.
 *
 * The detector must read the video's transcript in SOURCE time, the same
 * time base _applySegmentsToTimeline() intersects clips with. It used to read
 * `store.captions` (TIMELINE time): inside "clean up", silences were cut
 * first, so the retake cuts landed in the wrong places. It also flattened
 * every video's transcript into one list for multi-video projects.
 */

const basename = (p) => String(p || '').split(/[\\/]/).pop();
const stripStamp = (name) => name.replace(/^\d+-/, '');

function mainVideoTrack(tracks) {
    return (tracks || []).find(t => t.type === 'video') || null;
}

/** The asset the retake pass should work on. */
export function pickRetakeAsset(store, { assetId = null, filePath = null } = {}) {
    const assets = store.assets || [];
    if (assetId) return assets.find(a => a.id === assetId) || null;
    const base = basename(filePath);
    if (base) {
        const hit = assets.find(a => {
            const names = [basename(a.gcsPath), basename(a.name), basename(a.path)].filter(Boolean);
            return names.some(n => n === base || stripStamp(n) === stripStamp(base));
        });
        if (hit) return hit;
    }
    // Most-used asset on the main track (the primary recording).
    const counts = {};
    for (const c of mainVideoTrack(store.tracks)?.clips || []) if (c.assetId) counts[c.assetId] = (counts[c.assetId] || 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
    return assets.find(a => a.id === top) || null;
}

/**
 * @returns {{ assetId, words: [{word,start,end}] } | { error }}
 */
export function resolveRetakeSource(store, opts = {}) {
    const asset = pickRetakeAsset(store, opts);
    const transcripts = store.transcripts || {};
    const keys = [basename(opts.filePath), basename(asset?.gcsPath), basename(asset?.name), basename(store.uploadedFilePath)]
        .filter(Boolean);
    let words = null;
    for (const k of keys) {
        const hit = transcripts[k] || Object.entries(transcripts).find(([name]) => stripStamp(name) === stripStamp(k))?.[1];
        if (Array.isArray(hit) && hit.length) { words = hit; break; }
    }
    if (!words) {
        // Captions are TIMELINE time; they equal source time only while the
        // video is one untouched clip starting at 0.
        const clips = mainVideoTrack(store.tracks)?.clips || [];
        const untouched = clips.length === 1
            && Math.abs(Number(clips[0].start) || 0) < 0.01
            && Math.abs(Number(clips[0].offset) || 0) < 0.01
            && (Number(clips[0].speed) || 1) === 1;
        if (untouched && Array.isArray(store.captions) && store.captions.length) words = store.captions;
    }
    if (!words || !words.length) return { error: 'no_transcript', assetId: asset?.id || null };
    return {
        assetId: asset?.id || null,
        words: words.map(w => ({ word: w.word || w.content || w.text || '', start: w.start, end: w.end }))
            .filter(w => w.word && Number.isFinite(w.start) && Number.isFinite(w.end)),
    };
}

const clip = (s, n = 70) => {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/**
 * Lines for the review card: one per group.
 * @param {Array} groups detector groups ({ takes, keptTake, kept:{text}, removed:[{start,end}] })
 * @param {(key, opts) => string} t translator (editor namespace)
 */
export function retakeReviewLines(groups, t) {
    return (groups || []).map(g => {
        const secs = (g.removed || []).reduce((s, r) => s + (r.end - r.start), 0);
        return t('retakes.groupLine', {
            defaultValue: '{{takes}} takes of “{{text}}”: keeping take {{kept}}, removing {{secs}} s',
            takes: g.takes, kept: g.keptTake, text: clip(g.kept?.text), secs: secs.toFixed(1),
        });
    });
}

/**
 * Translator for the retake strings: i18next when it is initialised (the
 * app), else the English default with {{vars}} filled in (tests, early boot).
 */
export function makeRetakeT(i18n) {
    return (key, opts = {}) => {
        let v;
        try { v = i18n?.isInitialized ? i18n.t(`editor:${key}`, opts) : undefined; } catch { v = undefined; }
        if (typeof v === 'string' && v && v !== key && v !== `editor:${key}`) return v;
        return String(opts.defaultValue || key).replace(/{{(\w+)}}/g, (_, x) => (opts[x] ?? ''));
    };
}
