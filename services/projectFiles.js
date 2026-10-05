/**
 * services/projectFiles.js — which stored files belong to a project, and
 * deleting them. Used by DELETE /api/projects/:id, account deletion and the
 * retention job (services/retentionJob.js).
 *
 * A project's media is referenced from its timeline_state: each asset's
 * gcsPath / sourceUrl (raw upload), proxyUrl (playback proxy folder), its
 * waveform, plus the project thumbnail and its exports
 * (exports/<userId>/<projectId>/). Deleting the database row alone (what the
 * dashboard used to do) left every video file in storage.
 *
 * A file is only deleted when no OTHER project of the same user still uses
 * it (a duplicated project shares its uploads).
 */
'use strict';

const GCS_HOST = 'https://storage.googleapis.com/';
const MEDIA_ROUTE = '/api/proxy/gcs-media/';

/** Object path for any way the app stores a reference, or null. */
function objectPathFromRef(ref) {
    if (typeof ref !== 'string' || !ref) return null;
    let p = ref.trim();
    const q = p.search(/[?#]/);
    if (q >= 0) p = p.slice(0, q);
    if (p.startsWith(GCS_HOST)) p = p.slice(GCS_HOST.length).split('/').slice(1).join('/');
    else if (p.includes(MEDIA_ROUTE)) p = p.slice(p.indexOf(MEDIA_ROUTE) + MEDIA_ROUTE.length);
    else if (p.startsWith('/uploads/')) p = p.slice('/uploads/'.length);
    try { p = decodeURIComponent(p); } catch { /* keep as is */ }
    p = p.replace(/^\/+/, '');
    if (!p || p.includes('..') || p.startsWith('blob:') || /^https?:/.test(p)) return null;
    return p;
}

/**
 * Paths (exact objects) and prefixes (folders) of one project, restricted to
 * the owner's own folders.
 * @returns {{ exact: Set<string>, prefixes: Set<string> }}
 */
function filesForProject(project, userId) {
    const exact = new Set();
    const prefixes = new Set();
    const uid = String(userId || project?.user_id || '');
    if (!uid) return { exact, prefixes };
    const mine = (p) => p && p.split('/')[1] === uid;

    const state = project?.timeline_state || {};
    const assets = Array.isArray(state.assets) ? state.assets : [];
    for (const a of assets) {
        for (const ref of [a?.gcsPath, a?.sourceUrl, a?.path]) {
            const p = objectPathFromRef(ref);
            if (mine(p)) exact.add(p);
        }
        const proxy = objectPathFromRef(a?.proxyUrl);
        if (mine(proxy)) {
            // proxies/<uid>/<name>/proxy.mp4 → the whole proxies/<uid>/<name>/ folder
            if (proxy.startsWith(`proxies/${uid}/`) && proxy.split('/').length >= 4) {
                prefixes.add(proxy.split('/').slice(0, 3).join('/') + '/');
            } else {
                exact.add(proxy);
            }
        }
        if (a?.id) exact.add(`waveforms/${uid}/${a.id}.json`);
    }
    // Clips can carry their own source URL (older projects).
    for (const t of Array.isArray(state.tracks) ? state.tracks : []) {
        for (const c of Array.isArray(t?.clips) ? t.clips : []) {
            const p = objectPathFromRef(c?.sourceUrl);
            if (mine(p) && p.startsWith(`raw/${uid}/`)) exact.add(p);
        }
    }
    if (project?.id) {
        exact.add(`thumbnails/${uid}/${project.id}.jpg`);
        prefixes.add(`exports/${uid}/${project.id}/`);
    }
    const thumb = objectPathFromRef(project?.thumbnail_url);
    if (mine(thumb)) exact.add(thumb);
    return { exact, prefixes };
}

/** Everything the given projects reference (to protect shared files). */
function referencedBy(projects, userId) {
    const exact = new Set();
    const prefixes = new Set();
    for (const p of projects || []) {
        const f = filesForProject(p, userId);
        f.exact.forEach(x => exact.add(x));
        f.prefixes.forEach(x => prefixes.add(x));
    }
    return { exact, prefixes };
}

/**
 * Delete a project's files from the bucket. Never throws; returns a report.
 * @param bucket    GCS bucket (storageConfig.bucket) or null (local storage)
 * @param project   the project row ({ id, user_id, timeline_state, thumbnail_url })
 * @param others    the user's OTHER projects (same shape) — their files are kept
 */
async function deleteProjectFiles(bucket, project, others = [], { userId = null, dryRun = false } = {}) {
    const uid = userId || project?.user_id;
    const { exact, prefixes } = filesForProject(project, uid);
    const keep = referencedBy(others, uid);
    const report = { deleted: [], kept: [], failed: [] };
    if (!bucket) return report;

    for (const p of exact) {
        if (keep.exact.has(p) || [...keep.prefixes].some(k => p.startsWith(k))) { report.kept.push(p); continue; }
        try {
            if (!dryRun) await bucket.file(p).delete({ ignoreNotFound: true });
            report.deleted.push(p);
        } catch (err) {
            report.failed.push({ path: p, error: err.message });
        }
    }
    for (const prefix of prefixes) {
        if (keep.prefixes.has(prefix)) { report.kept.push(prefix); continue; }
        try {
            const [files] = await bucket.getFiles({ prefix });
            for (const f of files) {
                if (keep.exact.has(f.name)) { report.kept.push(f.name); continue; }
                if (!dryRun) await f.delete({ ignoreNotFound: true });
                report.deleted.push(f.name);
            }
        } catch (err) {
            report.failed.push({ path: prefix, error: err.message });
        }
    }
    return report;
}

module.exports = { objectPathFromRef, filesForProject, referencedBy, deleteProjectFiles };
