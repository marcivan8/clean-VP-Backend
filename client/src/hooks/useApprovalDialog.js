/**
 * useApprovalDialog - React Hook for Approval Workflow
 * 
 * Provides event-driven approval dialog state and actions.
 * UI NEVER POLLS - approval dialogs appear reactively from events.
 * 
 * Usage:
 * const { isOpen, approval, approve, deny, dismiss } = useApprovalDialog();
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { EventBus, EVENT_TYPES } from '../agent/EventBus.js';

/**
 * Hook to manage approval dialogs triggered by agent events
 */
export function useApprovalDialog() {
    // Current approval request (only one at a time shown)
    const [currentApproval, setCurrentApproval] = useState(null);

    // Queue of pending approvals
    const [approvalQueue, setApprovalQueue] = useState([]);

    // Processing state
    const [isProcessing, setIsProcessing] = useState(false);

    const unsubscribersRef = useRef([]);

    useEffect(() => {
        // Subscribe to approval required event
        unsubscribersRef.current = [
            EventBus.on(EVENT_TYPES.APPROVAL_REQUIRED, (payload) => {
                if (currentApproval) {
                    // Queue if already showing one
                    setApprovalQueue(prev => [...prev, payload]);
                } else {
                    // Show immediately
                    setCurrentApproval(payload);
                }
            }),

            // Listen for job cancellation to auto-dismiss
            EventBus.on(EVENT_TYPES.JOB_CANCELLED, (payload) => {
                if (currentApproval?.jobId === payload.jobId) {
                    setCurrentApproval(null);
                    showNextApproval();
                }
                setApprovalQueue(prev =>
                    prev.filter(a => a.jobId !== payload.jobId)
                );
            })
        ];

        return () => {
            unsubscribersRef.current.forEach(unsub => unsub());
        };
    }, [currentApproval]);

    // Show next approval in queue
    const showNextApproval = useCallback(() => {
        if (approvalQueue.length > 0) {
            const [next, ...rest] = approvalQueue;
            setCurrentApproval(next);
            setApprovalQueue(rest);
        }
    }, [approvalQueue]);

    // Approve the current request
    const approve = useCallback(() => {
        if (!currentApproval) return;

        setIsProcessing(true);

        EventBus.emit(EVENT_TYPES.APPROVAL_GRANTED, {
            jobId: currentApproval.jobId,
            approvedAt: Date.now()
        });

        setCurrentApproval(null);
        setIsProcessing(false);
        showNextApproval();
    }, [currentApproval, showNextApproval]);

    // Deny the current request
    const deny = useCallback((reason = 'User denied') => {
        if (!currentApproval) return;

        setIsProcessing(true);

        EventBus.emit(EVENT_TYPES.APPROVAL_DENIED, {
            jobId: currentApproval.jobId,
            reason,
            deniedAt: Date.now()
        });

        setCurrentApproval(null);
        setIsProcessing(false);
        showNextApproval();
    }, [currentApproval, showNextApproval]);

    // Dismiss without decision (postpone)
    const dismiss = useCallback(() => {
        if (!currentApproval) return;

        // Move to back of queue
        setApprovalQueue(prev => [...prev, currentApproval]);
        setCurrentApproval(null);
        showNextApproval();
    }, [currentApproval, showNextApproval]);

    return {
        // Dialog state
        isOpen: currentApproval !== null,
        approval: currentApproval,
        isProcessing,

        // Queue info
        queueLength: approvalQueue.length,
        hasMore: approvalQueue.length > 0,

        // Actions
        approve,
        deny,
        dismiss,

        // Details from approval
        title: currentApproval?.title || 'Approval Required',
        description: currentApproval?.description || '',
        actions: currentApproval?.actions || '',
        reasons: currentApproval?.reasons || [],
        jobId: currentApproval?.jobId
    };
}

export default useApprovalDialog;
