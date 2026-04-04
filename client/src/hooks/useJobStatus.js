/**
 * useJobStatus - React Hook for Real-Time Job Status
 * 
 * Provides event-driven job status tracking for a specific job.
 * UI NEVER POLLS - status updates come from events only.
 * 
 * Usage:
 * const { status, progress, phase, error, isActive } = useJobStatus(jobId);
 */

import { useState, useEffect, useRef } from 'react';
import { EventBus, EVENT_TYPES } from '../agent/EventBus.js';

/**
 * Hook to track a specific job's status via events
 */
export function useJobStatus(jobId) {
    const [status, setStatus] = useState('idle'); // idle, planning, executing, validating, completed, failed, timeout, hung
    const [progress, setProgress] = useState(0);
    const [phase, setPhase] = useState(null);
    const [error, setError] = useState(null);
    const [warning, setWarning] = useState(null);
    const [result, setResult] = useState(null);
    const [startedAt, setStartedAt] = useState(null);
    const [completedAt, setCompletedAt] = useState(null);

    const unsubscribersRef = useRef([]);

    useEffect(() => {
        if (!jobId) return;

        const isThisJob = (payload) => payload.jobId === jobId;

        unsubscribersRef.current = [
            // Job started
            EventBus.on(EVENT_TYPES.JOB_STARTED, (payload) => {
                if (isThisJob(payload)) {
                    setStatus('planning');
                    setPhase('planning');
                    setStartedAt(Date.now());
                    setError(null);
                    setResult(null);
                }
            }),

            // Phase changes
            EventBus.on(EVENT_TYPES.PHASE_PLANNING, (payload) => {
                if (isThisJob(payload)) {
                    setStatus('planning');
                    setPhase('planning');
                    setProgress(10);
                }
            }),
            EventBus.on(EVENT_TYPES.PHASE_EXECUTING, (payload) => {
                if (isThisJob(payload)) {
                    setStatus('executing');
                    setPhase('executing');
                    setProgress(40);
                }
            }),
            EventBus.on(EVENT_TYPES.PHASE_VALIDATING, (payload) => {
                if (isThisJob(payload)) {
                    setStatus('validating');
                    setPhase('validating');
                    setProgress(85);
                }
            }),

            // Progress updates
            EventBus.on(EVENT_TYPES.EXECUTION_PROGRESS, (payload) => {
                if (isThisJob(payload)) {
                    if (payload.progress !== undefined) {
                        setProgress(payload.progress);
                    }
                    if (payload.warning) {
                        setWarning(payload.warning);
                    }
                }
            }),

            // Job completed
            EventBus.on(EVENT_TYPES.JOB_COMPLETED, (payload) => {
                if (isThisJob(payload)) {
                    setStatus('completed');
                    setProgress(100);
                    setResult(payload.result);
                    setCompletedAt(Date.now());
                }
            }),

            // Job failed
            EventBus.on(EVENT_TYPES.JOB_FAILED, (payload) => {
                if (isThisJob(payload)) {
                    setStatus('failed');
                    setError(payload.error || payload.message);
                    setCompletedAt(Date.now());
                }
            }),

            // Job hung
            EventBus.on(EVENT_TYPES.JOB_HUNG, (payload) => {
                if (isThisJob(payload)) {
                    setStatus('hung');
                    setError(payload.message);
                    setCompletedAt(Date.now());
                }
            }),

            // Job timeout
            EventBus.on(EVENT_TYPES.JOB_TIMEOUT, (payload) => {
                if (isThisJob(payload)) {
                    setStatus('timeout');
                    setError(payload.message);
                    setCompletedAt(Date.now());
                }
            }),

            // Job cancelled
            EventBus.on(EVENT_TYPES.JOB_CANCELLED, (payload) => {
                if (isThisJob(payload)) {
                    setStatus('cancelled');
                    setCompletedAt(Date.now());
                }
            })
        ];

        return () => {
            unsubscribersRef.current.forEach(unsub => unsub());
        };
    }, [jobId]);

    // Reset when jobId changes
    useEffect(() => {
        if (!jobId) {
            setStatus('idle');
            setProgress(0);
            setPhase(null);
            setError(null);
            setWarning(null);
            setResult(null);
            setStartedAt(null);
            setCompletedAt(null);
        }
    }, [jobId]);

    // Computed states
    const isActive = ['planning', 'executing', 'validating'].includes(status);
    const isComplete = status === 'completed';
    const isFailed = ['failed', 'hung', 'timeout', 'cancelled'].includes(status);
    const duration = startedAt ? ((completedAt || Date.now()) - startedAt) : 0;

    return {
        // Core state
        status,
        progress,
        phase,
        error,
        warning,
        result,

        // Timing
        startedAt,
        completedAt,
        duration,

        // Computed
        isActive,
        isComplete,
        isFailed,
        isIdle: status === 'idle',

        // Status checks
        isPlanning: status === 'planning',
        isExecuting: status === 'executing',
        isValidating: status === 'validating'
    };
}

export default useJobStatus;
