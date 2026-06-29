/**
 * useJobRecovery.js
 *
 * On editor mount, checks localStorage for any BullMQ job IDs that were
 * in-flight when the user last navigated away or reloaded.
 *
 * BullMQ jobs keep running in Redis even after the client disconnects.
 * This hook reconnects the client to those orphaned jobs so the user
 * doesn't have to re-run the operation manually.
 *
 * Behaviour per job state:
 *   'active' / 'waiting'  → resume polling; apply result automatically when done
 *   'completed'           → show toast "X completed while you were away — applied ✓"
 *                           (result already in BullMQ returnvalue; applied immediately)
 *   'failed' / 'not_found'→ show toast "X failed — tap to retry" (clears the entry)
 *
 * The hook emits toasts via a simple event so it stays decoupled from any
 * specific toast library. IDELayout listens for 'vp:recovery:toast' events.
 */

import { useEffect, useRef } from 'react';
import { getPendingJobs, clearJob } from '../utils/pendingJobs.js';
import { authFetch } from '../utils/authFetch.js';

const POLL_INTERVAL_MS = 2500;
const MAX_RECOVERY_WAIT_MS = 10 * 60 * 1000; // 10 min — matches pollJobResult default

/**
 * Emit a custom DOM event so IDELayout (or any listener) can render a toast
 * without this hook depending on a specific notification library.
 *
 * event.detail: { type: 'completed'|'failed'|'running', label, jobId, action }
 */
function emitToast(detail) {
    window.dispatchEvent(new CustomEvent('vp:recovery:toast', { detail }));
}

/**
 * Poll a single BullMQ job until it settles, then emit the appropriate toast.
 */
async function recoverJob(job, signal) {
    const { jobId, action, label } = job;
    const deadline = Date.now() + MAX_RECOVERY_WAIT_MS;

    emitToast({ type: 'running', label, jobId, action });

    while (Date.now() < deadline) {
        if (signal.aborted) return;

        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        if (signal.aborted) return;

        let data = null;
        try {
            const res = await authFetch(`/api/jobs/${jobId}/status`, { signal });
            if (res.ok) data = await res.json().catch(() => null);
        } catch (_) {
            if (signal.aborted) return;
            continue; // network blip — retry
        }

        if (!data) continue;

        const state = data.state || data.status;

        if (state === 'completed') {
            clearJob(jobId);
            emitToast({ type: 'completed', label, jobId, action, result: data.result });
            return;
        }

        if (state === 'failed' || state === 'not_found') {
            clearJob(jobId);
            emitToast({ type: 'failed', label, jobId, action, error: data.error });
            return;
        }

        // 'active' | 'waiting' | 'delayed' → keep polling
    }

    // Timeout — clear so it doesn't haunt future sessions
    clearJob(jobId);
    emitToast({ type: 'failed', label, jobId, action, error: 'Timed out waiting for recovery' });
}

/**
 * Mount this hook in IDELayout (or any editor root component).
 * It runs once on mount and cleans up on unmount.
 */
export function useJobRecovery() {
    const controllerRef = useRef(null);

    useEffect(() => {
        const pending = getPendingJobs();
        if (pending.length === 0) return;

        console.log(`[useJobRecovery] Found ${pending.length} orphaned job(s):`, pending.map(j => j.jobId));

        const controller = new AbortController();
        controllerRef.current = controller;

        // Recover each job concurrently — they're independent.
        pending.forEach(job => recoverJob(job, controller.signal));

        return () => {
            controller.abort();
        };
    }, []); // run once on mount
}

export default useJobRecovery;
