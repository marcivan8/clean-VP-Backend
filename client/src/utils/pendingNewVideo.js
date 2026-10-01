/**
 * pendingNewVideo.js — hands the video picked on the mobile dashboard's
 * "New video" sheet to the editor, which starts the normal upload on mount.
 * In memory only: a File can't survive a reload, and the dashboard → editor
 * hop is an in-app navigation, so a module-level map is enough.
 */
const pending = new Map();

export function setPendingNewVideo(projectId, file) {
    if (!projectId || !file) return;
    pending.set(String(projectId), file);
}

/** Returns the file once (and forgets it), or null. */
export function takePendingNewVideo(projectId) {
    if (!projectId) return null;
    const key = String(projectId);
    const file = pending.get(key) || null;
    pending.delete(key);
    return file;
}
