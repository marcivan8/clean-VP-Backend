/**
 * useAgentEvents - React Hook for Event-Driven Agent Updates
 * 
 * Subscribes to EventBus events and provides reactive state updates.
 * UI NEVER POLLS - it reacts to events only.
 * 
 * Usage:
 * const { jobs, errors, approvals, aiStatus } = useAgentEvents();
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { EventBus, EVENT_TYPES } from '../agent/EventBus.js';

/**
 * Hook to subscribe to all agent events and provide reactive UI state
 */
export function useAgentEvents() {
    // Job tracking state
    const [activeJobs, setActiveJobs] = useState(new Map());
    const [completedJobs, setCompletedJobs] = useState([]);
    const [failedJobs, setFailedJobs] = useState([]);

    // Error state
    const [errors, setErrors] = useState([]);
    const [recoveries, setRecoveries] = useState([]);

    // Approval state
    const [pendingApprovals, setPendingApprovals] = useState([]);

    // AI status
    const [aiStatus, setAiStatus] = useState('available');

    // Ref to track subscription cleanup
    const unsubscribersRef = useRef([]);

    useEffect(() => {
        // Subscribe to job lifecycle events
        unsubscribersRef.current = [
            // Job started
            EventBus.on(EVENT_TYPES.JOB_STARTED, (payload) => {
                setActiveJobs(prev => {
                    const next = new Map(prev);
                    next.set(payload.jobId, {
                        ...payload,
                        status: 'started',
                        progress: 0,
                        phase: 'planning',
                        startedAt: Date.now()
                    });
                    return next;
                });
            }),

            // Phase changes
            EventBus.on(EVENT_TYPES.PHASE_PLANNING, (payload) => {
                updateJobPhase(payload.jobId, 'planning');
            }),
            EventBus.on(EVENT_TYPES.PHASE_EXECUTING, (payload) => {
                updateJobPhase(payload.jobId, 'executing');
            }),
            EventBus.on(EVENT_TYPES.PHASE_VALIDATING, (payload) => {
                updateJobPhase(payload.jobId, 'validating');
            }),

            // Progress updates
            EventBus.on(EVENT_TYPES.EXECUTION_PROGRESS, (payload) => {
                setActiveJobs(prev => {
                    const next = new Map(prev);
                    const job = next.get(payload.jobId);
                    if (job) {
                        next.set(payload.jobId, {
                            ...job,
                            progress: payload.progress || job.progress,
                            warning: payload.warning || null
                        });
                    }
                    return next;
                });
            }),

            // Job completed
            EventBus.on(EVENT_TYPES.JOB_COMPLETED, (payload) => {
                setActiveJobs(prev => {
                    const next = new Map(prev);
                    next.delete(payload.jobId);
                    return next;
                });
                setCompletedJobs(prev => [...prev.slice(-19), {
                    ...payload,
                    completedAt: Date.now()
                }]);
            }),

            // Job failed
            EventBus.on(EVENT_TYPES.JOB_FAILED, (payload) => {
                setActiveJobs(prev => {
                    const next = new Map(prev);
                    next.delete(payload.jobId);
                    return next;
                });
                setFailedJobs(prev => [...prev.slice(-19), {
                    ...payload,
                    failedAt: Date.now()
                }]);
                setErrors(prev => [...prev.slice(-9), {
                    type: 'job_failed',
                    ...payload,
                    timestamp: Date.now()
                }]);
            }),

            // Job hung
            EventBus.on(EVENT_TYPES.JOB_HUNG, (payload) => {
                setActiveJobs(prev => {
                    const next = new Map(prev);
                    next.delete(payload.jobId);
                    return next;
                });
                setErrors(prev => [...prev.slice(-9), {
                    type: 'job_hung',
                    ...payload,
                    timestamp: Date.now()
                }]);
            }),

            // Job timeout
            EventBus.on(EVENT_TYPES.JOB_TIMEOUT, (payload) => {
                setActiveJobs(prev => {
                    const next = new Map(prev);
                    next.delete(payload.jobId);
                    return next;
                });
                setErrors(prev => [...prev.slice(-9), {
                    type: 'job_timeout',
                    ...payload,
                    timestamp: Date.now()
                }]);
            }),

            // Recovery suggested
            EventBus.on(EVENT_TYPES.RECOVERY_SUGGESTED, (payload) => {
                setRecoveries(prev => [...prev.slice(-9), payload]);
            }),

            // Approval required
            EventBus.on(EVENT_TYPES.APPROVAL_REQUIRED, (payload) => {
                setPendingApprovals(prev => [...prev, payload]);
            }),

            // Approval granted
            EventBus.on(EVENT_TYPES.APPROVAL_GRANTED, (payload) => {
                setPendingApprovals(prev =>
                    prev.filter(a => a.jobId !== payload.jobId)
                );
            }),

            // Approval denied
            EventBus.on(EVENT_TYPES.APPROVAL_DENIED, (payload) => {
                setPendingApprovals(prev =>
                    prev.filter(a => a.jobId !== payload.jobId)
                );
            }),

            // AI availability
            EventBus.on(EVENT_TYPES.AI_UNAVAILABLE, () => {
                setAiStatus('unavailable');
            }),

            // System error
            EventBus.on(EVENT_TYPES.SYSTEM_ERROR, (payload) => {
                setErrors(prev => [...prev.slice(-9), {
                    type: 'system_error',
                    ...payload,
                    timestamp: Date.now()
                }]);
            })
        ];

        return () => {
            unsubscribersRef.current.forEach(unsub => unsub());
        };
    }, []);

    // Helper to update job phase
    const updateJobPhase = useCallback((jobId, phase) => {
        setActiveJobs(prev => {
            const next = new Map(prev);
            const job = next.get(jobId);
            if (job) {
                next.set(jobId, { ...job, phase });
            }
            return next;
        });
    }, []);

    // Clear errors
    const clearErrors = useCallback(() => {
        setErrors([]);
    }, []);

    // Clear specific error
    const dismissError = useCallback((index) => {
        setErrors(prev => prev.filter((_, i) => i !== index));
    }, []);

    // Dismiss recovery
    const dismissRecovery = useCallback((jobId) => {
        setRecoveries(prev => prev.filter(r => r.jobId !== jobId));
    }, []);

    return {
        // Job state
        activeJobs: Array.from(activeJobs.values()),
        activeJobsCount: activeJobs.size,
        completedJobs,
        failedJobs,

        // Errors
        errors,
        clearErrors,
        dismissError,

        // Recoveries
        recoveries,
        dismissRecovery,

        // Approvals
        pendingApprovals,
        hasPendingApprovals: pendingApprovals.length > 0,

        // AI status
        aiStatus,
        isAiAvailable: aiStatus === 'available'
    };
}

export default useAgentEvents;
