// services/social/scheduleMedia.js
// Pure helpers shared by scheduling and rescheduling a social post (R172).
//
// A scheduled post stores a SIGNED read URL for its export, valid until 12 h
// after the scheduled time (Instagram's media processor fetches it with no
// cookie). Moving the post means moving that expiry too, and the original
// `/api/proxy/gcs-media/exports/<user>/...` path is not stored, so the object
// path is recovered from the signed URL itself and checked again against the
// user's own exports prefix before it is re-signed. A URL that does not point
// into that prefix is refused rather than re-signed: re-signing is the one
// thing that could turn a bad row into a working link.

'use strict';

const MIN_LEAD_MS = 60_000;
// Signed URLs live at most 7 days (GCS v4); the post needs 12 h of fetch window
// after its time, so the latest schedulable time is 6.5 days out.
const MAX_LEAD_MS = 6 * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000;

function scheduleOutOfRange(scheduledMs, now = Date.now()) {
    return !Number.isFinite(scheduledMs) || scheduledMs < now + MIN_LEAD_MS || scheduledMs > now + MAX_LEAD_MS;
}

function safeObjectPath(objectPath, userId) {
    if (typeof objectPath !== 'string' || !userId) return null;
    if (objectPath.includes('..') || objectPath.includes('\\')) return null;
    return objectPath.startsWith(`exports/${userId}/`) ? objectPath : null;
}

/**
 * The storage object a stored media URL points at, or null.
 * Accepts the editor path (/api/proxy/gcs-media/<object>) and both GCS signed
 * URL styles (path-style storage.googleapis.com/<bucket>/<object> and
 * virtual-hosted <bucket>.storage.googleapis.com/<object>).
 */
function objectPathFromMediaUrl(value, { userId, bucketName } = {}) {
    if (typeof value !== 'string' || !value) return null;
    let url;
    try { url = new URL(value, 'https://vibed.invalid'); } catch { return null; }
    let path = null;
    try {
        if (url.pathname.startsWith('/api/proxy/gcs-media/')) {
            path = decodeURIComponent(url.pathname.slice('/api/proxy/gcs-media/'.length));
        } else if (bucketName && url.hostname === 'storage.googleapis.com' && url.pathname.startsWith(`/${bucketName}/`)) {
            path = decodeURIComponent(url.pathname.slice(bucketName.length + 2));
        } else if (bucketName && url.hostname === `${bucketName}.storage.googleapis.com`) {
            path = decodeURIComponent(url.pathname.slice(1));
        }
    } catch { return null; }
    return safeObjectPath(path, userId);
}

module.exports = { MIN_LEAD_MS, MAX_LEAD_MS, scheduleOutOfRange, objectPathFromMediaUrl, safeObjectPath };
