/**
 * pendingJobs.js
 *
 * Persists in-flight BullMQ job IDs to localStorage so they can be recovered
 * if the user navigates away or reloads while a job is running.
 *
 * BullMQ jobs survive in Redis across page reloads — the server keeps running
 * them. Without this utility, the client permanently loses the jobId when the
 * component unmounts, and the user has to re-run the operation manually.
 *
 * Schema stored at localStorage key `vp_pending_jobs`:
 *   {
 *     [jobId]: {
 *       jobId:      string,
 *       action:     string,   // e.g. 'silenceDetect', 'fillerDetect'
 *       endpoint:   string,   // e.g. '/api/audio/silence/detect'
 *       label:      string,   // human-readable, shown in recovery toast
 *       startedAt:  number,   // Date.now()
 *     }
 *   }
 *
 * Jobs older than MAX_AGE_MS are pruned automatically to avoid stale entries
 * accumulating from old sessions where the server lost the job.
 */

const STORAGE_KEY = 'vp_pending_jobs';
const MAX_AGE_MS  = 60 * 60 * 1000; // 1 hour — BullMQ keeps completed jobs this long by default

// Human-readable labels for each action type
const ACTION_LABELS = {
    silenceDetect:       'Silence removal',
    fillerDetect:        'Filler word removal',
    autoCaptions:        'Caption generation',
    transcribe:          'Transcription',
    audioDenoise:        'Audio denoising',
    audioNormalize:      'Audio normalization',
    detectRepeatedTakes: 'Repeated takes detection',
};

function read() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch (_) {
        return {};
    }
}

function write(data) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (_) { /* quota — skip silently */ }
}

/**
 * Save a job when polling starts.
 * @param {string} jobId       BullMQ job ID returned by the server
 * @param {string} action      command.action from MediaExecutionEngine
 * @param {string} endpoint    API endpoint that started the job
 */
export function saveJob(jobId, action, endpoint) {
    if (!jobId) return;
    const jobs = read();
    jobs[jobId] = {
        jobId,
        action,
        endpoint,
        label: ACTION_LABELS[action] || action,
        startedAt: Date.now(),
    };
    write(jobs);
}

/**
 * Remove a job when it completes or fails (no recovery needed).
 * @param {string} jobId
 */
export function clearJob(jobId) {
    if (!jobId) return;
    const jobs = read();
    delete jobs[jobId];
    write(jobs);
}

/**
 * Return all pending jobs, pruning entries older than MAX_AGE_MS.
 * @returns {{ jobId, action, endpoint, label, startedAt }[]}
 */
export function getPendingJobs() {
    const jobs  = read();
    const now   = Date.now();
    const valid = [];
    let pruned  = false;

    for (const [id, job] of Object.entries(jobs)) {
        if (now - (job.startedAt || 0) > MAX_AGE_MS) {
            delete jobs[id];
            pruned = true;
        } else {
            valid.push(job);
        }
    }

    if (pruned) write(jobs);
    return valid;
}

/**
 * Clear all pending jobs (e.g. on sign-out or new project load).
 */
export function clearAllJobs() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
}
