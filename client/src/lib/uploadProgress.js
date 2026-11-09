/**
 * How far along is the import? (R156)
 *
 * The upload card used to read the FIRST unfinished asset and show its name
 * and its percentage. With one file that is the whole truth; with seven it
 * says nothing about the other six, and the number walks backwards every time
 * one finishes and a fresher one takes its place. "Nothing is telling me how
 * far the upload is so that I know when to take the next action" is the exact
 * complaint, and a per-file number is the reason.
 *
 * So the batch is treated as a batch. Phases are 'uploading' → 'processing' →
 * 'ready' (IDELayout); anything that is not 'ready' is still in flight.
 *
 * The batch is derived from the assets alone rather than remembered between
 * renders: every file of one import gets its uploadStartTime inside the same
 * loop, so the assets fall into runs separated by long gaps, and the run that
 * still has work in it is the one to report on. A finished file stays in its
 * run, which is what keeps the denominator from shrinking under the user and
 * the percentage from falling.
 */

const FINISHED = new Set(['ready', 'complete']);

/** Files started more than this far apart belong to different imports. */
const RUN_GAP_MS = 90_000;

/** An asset that still has work left on it. */
export function isUploading(asset) {
    return !!(asset && typeof asset.uploadPhase === 'string' && !FINISHED.has(asset.uploadPhase));
}

const pct = (value) => Math.max(0, Math.min(100, Number(value) || 0));
const startedAt = (asset) => Number(asset?.uploadStartTime);

/** The assets of one import, newest run first to have unfinished work. */
export function uploadRunMembers(assets) {
    const all = (Array.isArray(assets) ? assets : []).filter(Boolean);
    const list = all.filter(a => Number.isFinite(startedAt(a)));
    if (!list.some(isUploading)) {
        // Every asset the importer builds carries uploadStartTime. If one turns
        // up without it, reporting on the files in flight still beats reporting
        // nothing — just without the finished ones in the denominator.
        return all.some(isUploading) && !list.some(isUploading) ? all.filter(isUploading) : [];
    }

    const sorted = [...list].sort((a, b) => startedAt(a) - startedAt(b));
    const runs = [];
    sorted.forEach((asset) => {
        const run = runs[runs.length - 1];
        if (run && startedAt(asset) - startedAt(run[run.length - 1]) <= RUN_GAP_MS) run.push(asset);
        else runs.push([asset]);
    });
    return runs.find(run => run.some(isUploading)) || [];
}

/**
 * What to put on the card: how many files, how many are through, and one
 * percentage for the import. A finished file counts as 100 whatever its last
 * reported progress was, so the bar reaches the end when the work does.
 *
 * @returns {{total:number, done:number, percent:number, activeName:(string|null)}|null}
 *          null when nothing is being imported.
 */
export function summarizeUploads(assets) {
    const members = uploadRunMembers(assets);
    if (!members.length) return null;

    const done = members.filter(a => !isUploading(a)).length;
    const sum = members.reduce((acc, a) => acc + (isUploading(a) ? pct(a.uploadProgress) : 100), 0);
    const active = members.find(isUploading) || null;

    return {
        total: members.length,
        done,
        percent: Math.round(sum / members.length),
        activeName: active?.name || null,
    };
}

export default { isUploading, uploadRunMembers, summarizeUploads };
