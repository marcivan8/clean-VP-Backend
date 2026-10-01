/**
 * rokaPromptQueue.js — mobile only: Roka requests sent while the video is
 * still uploading or being prepared wait instead of running.
 *
 * Running them early is what produced "There appears to be a duration
 * mismatch between the source media and the timeline. I need clarification
 * before proceeding." on phones (the AI saw a clip with no playable media
 * yet). Now Roka answers "I'll start as soon as your video is ready" and the
 * request runs by itself once utils/uploadStatus.js says the timeline video
 * can play. Requests run one at a time, in order.
 */
import useAIStore from '../store/useAIStore.js';
import useTimelineStore from '../store/useTimelineStore.js';
import { aiWaitReason } from '../utils/uploadStatus.js';
import { workflowController } from './WorkflowController.js';

export { aiWaitReason };

/**
 * Queue `text` if the video isn't ready. Adds Roka's short reply to the log.
 * @returns {boolean} true when queued (caller must not run it now)
 */
export function enqueueIfVideoNotReady(text, t) {
    const { assets, tracks } = useTimelineStore.getState();
    if (!aiWaitReason(assets, tracks)) return false;
    const ai = useAIStore.getState();
    ai.enqueuePrompt(text);
    ai.addLog({
        id: 'queued-' + Date.now(),
        type: 'assistant',
        message: t('mobileRoka.queuedReply'),
        timestamp: new Date().toLocaleTimeString(),
    });
    return true;
}

/** Start one prompt through the normal pipeline (same steps as MobileAIBar). */
export function runPromptNow(text) {
    const ai = useAIStore.getState();
    ai.setIsAnalyzing(true);
    try {
        workflowController.processUserPrompt(text);
    } catch (err) {
        ai.setIsAnalyzing(false);
        ai.addLog({
            id: 'agent-crash-' + Date.now(),
            type: 'warning',
            message: `ROKA error: ${err.message}`,
            timestamp: new Date().toLocaleTimeString(),
        });
    }
}

/**
 * Run the next queued prompt when the video is ready and Roka is free.
 * Call on every store change; cheap when the queue is empty.
 * @returns {boolean} true when a prompt was started
 */
let draining = false; // re-entrancy guard: drain is called from store subscriptions

export function drainPromptQueue(t) {
    if (draining) return false;
    draining = true;
    try {
        return drainOnce(t);
    } finally {
        draining = false;
    }
}

function drainOnce(t) {
    const ai = useAIStore.getState();
    if (ai.queuedPrompts.length === 0 || ai.isAnalyzing) return false;
    const state = workflowController.getState();
    if (state === 'processing' || state === 'resuming' || state === 'clarifying') return false;
    const { assets, tracks } = useTimelineStore.getState();
    if (aiWaitReason(assets, tracks)) return false;
    const next = ai.shiftQueuedPrompt();
    if (!next) return false;
    ai.addLog({
        id: 'queue-start-' + Date.now(),
        type: 'assistant',
        message: t('mobileRoka.queueStarting'),
        timestamp: new Date().toLocaleTimeString(),
    });
    runPromptNow(next.text);
    return true;
}

/**
 * Send a prompt to Roka from a mobile button (e.g. "Add captions" in the
 * caption style sheet): logs it like a typed message, answers a pending
 * clarification, queues it while the video uploads, else runs it.
 */
export function submitRokaPrompt(text, t) {
    const ai = useAIStore.getState();
    ai.addLog({ id: 'user-' + Date.now(), type: 'info', message: `You: ${text}`, timestamp: new Date().toLocaleTimeString() });
    if (workflowController.getState() === 'clarifying') {
        workflowController.submitClarification({ answer: text });
        return;
    }
    if (enqueueIfVideoNotReady(text, t)) return;
    runPromptNow(text);
}
