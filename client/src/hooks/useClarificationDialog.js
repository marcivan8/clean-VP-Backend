import { useState, useEffect, useCallback } from 'react';
import { EventBus, EVENT_TYPES } from '../agent/EventBus';
import { workflowController } from '../agent/WorkflowController';

/**
 * Hook to manage clarification dialogs triggered by agent events
 */
export function useClarificationDialog() {
    const [request, setRequest] = useState(null);
    const [isProcessing, setIsProcessing] = useState(false);

    useEffect(() => {
        const unsubscribe = EventBus.on(EVENT_TYPES.CLARIFICATION_NEEDED, (payload) => {
            console.log('[useClarificationDialog] Received request', payload);
            setRequest(payload);
        });
        return unsubscribe;
    }, []);

    const submit = useCallback((answers) => {
        if (!request) return;
        setIsProcessing(true);

        console.log('[useClarificationDialog] Submitting answers:', answers);

        // Submit to workflow controller
        workflowController.submitClarification(answers);

        // Close dialog
        setRequest(null);
        setIsProcessing(false);
    }, [request]);

    const cancel = useCallback(() => {
        if (!request) return;
        console.log('[useClarificationDialog] Cancelling job');
        workflowController.cancelCurrentJob();
        setRequest(null);
    }, [request]);

    return {
        isOpen: !!request,
        request,
        submit,
        cancel,
        isProcessing
    };
}

export default useClarificationDialog;
