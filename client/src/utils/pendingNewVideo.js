/**
 * pendingNewVideo.js — hands the media picked on the mobile dashboard's
 * "New video" sheet to the editor, which starts the normal upload on mount.
 * In memory only: a File can't survive a reload, and the dashboard → editor
 * hop is an in-app navigation, so a module-level map is enough.
 *
 * R145: a short is often several clips and a couple of stills, so this carries
 * a LIST. One file still works — it becomes a list of one.
 */
const pending = new Map();

/**
 * @param {string} projectId
 * @param {File|File[]|FileList} files  one file or several
 */
export function setPendingNewVideo(projectId, files) {
    if (!projectId || !files) return;
    const list = (Array.isArray(files) ? files : Array.from(files.length != null ? files : [files]))
        .filter(Boolean);
    if (!list.length) return;
    pending.set(String(projectId), list);
}

/** Returns the files once (and forgets them). Always an array, possibly empty. */
export function takePendingNewVideoFiles(projectId) {
    if (!projectId) return [];
    const key = String(projectId);
    const files = pending.get(key) || [];
    pending.delete(key);
    return files;
}

/** The first file only, for callers that still want one. */
export function takePendingNewVideo(projectId) {
    return takePendingNewVideoFiles(projectId)[0] || null;
}
