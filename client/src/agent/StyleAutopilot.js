/**
 * StyleAutopilot.js (R91): Auto mode. Runs the picked editing style's
 * playbook (agent/EditingStyles.js) from start to finish, each step through
 * the normal pipeline (EditJobManager.processEditRequest), without the plan
 * approval dialog, all of it ONE undo step.
 *
 * A step that fails or needs a question answered is skipped and reported;
 * the rest still runs. Stop (cancelCurrentJob) aborts the step in progress
 * and the remaining ones.
 */
import useTimelineStore from '../store/useTimelineStore.js';
import useAIStore from '../store/useAIStore.js';
import { editJobManager } from './EditJobManager.js';
import { buildAutopilotSteps, getEditingStyle } from './EditingStyles.js';

const STEP_LABEL = {
    captions: 'captions', short: 'best moment kept', vertical: 'vertical 9:16', request: 'your request',
    silences: 'silences removed', fillers: 'filler words removed', audio: 'audio levelled', recipe: 'style recipe',
};
const STYLE_NAME = { vlog: 'Vlog', talking_head: 'Talking head', interview: 'Interview', podcast: 'Podcast', reel: 'Reel' };

let stopRequested = false;
export function stopAutopilot() { stopRequested = true; }

function progress(message) {
    try {
        useAIStore.getState().addLog({ id: 'auto-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), type: 'info', message, timestamp: new Date().toLocaleTimeString() });
    } catch (err) {
        console.error('[StyleAutopilot] log failed:', err);
    }
}

/**
 * @param {string} request what the user typed
 * @param {{styleId?: string, run?: Function}} [opts] run is injectable for tests
 * @returns {Promise<{success:boolean, operation:string, message:string, jobId:string|null, details?:object}>}
 */
export async function runAutopilot(request, opts = {}) {
    const store = useTimelineStore.getState();
    const chosen = opts.styleId || store.editingStyle;
    const styleId = getEditingStyle(chosen) ? chosen : 'talking_head';
    const run = opts.run || ((p) => editJobManager.processEditRequest(p, { autoApprove: true }));
    const hasCaptions = Array.isArray(store.captions) && store.captions.length > 0;
    const steps = buildAutopilotSteps(styleId, request, { hasCaptions });
    const intro = getEditingStyle(chosen) ? '' : 'No style picked, so Talking head was used. ';

    stopRequested = false;
    const done = [];
    const skipped = [];
    let lastJobId = null;
    store.beginHistoryGroup();
    try {
        for (let i = 0; i < steps.length; i++) {
            if (stopRequested) { skipped.push(...steps.slice(i).map(s => `${STEP_LABEL[s.key] || s.key} (stopped)`)); break; }
            const step = steps[i];
            progress(`Auto ${i + 1}/${steps.length}: ${step.prompt}`);
            let res = null;
            try {
                res = await run(step.prompt);
            } catch (err) {
                console.error('[StyleAutopilot] step failed:', step.key, err);
                res = { success: false, message: err.message };
            }
            if (res?.jobId) {
                lastJobId = res.jobId;
                editJobManager.autoApproveJobs?.delete(res.jobId);
            }
            if (res?.requiresClarification) {
                // Full auto: nobody answers questions mid-run. Drop that step.
                try { if (res.jobId) editJobManager.cancelJob(res.jobId); } catch (err) { console.error('[StyleAutopilot] cancel failed:', err); }
                skipped.push(`${STEP_LABEL[step.key] || step.key} (needed a clarification)`);
                continue;
            }
            if (res?.success) done.push(STEP_LABEL[step.key] || step.key);
            else skipped.push(`${STEP_LABEL[step.key] || step.key}${res?.message ? ` (${String(res.message).slice(0, 90)})` : ''}`);
        }
    } finally {
        useTimelineStore.getState().endHistoryGroup();
    }

    const name = STYLE_NAME[styleId];
    if (done.length === 0) {
        return { success: false, operation: 'auto_edit', jobId: lastJobId, message: `${intro}Auto edit (${name}) could not apply anything. Skipped: ${skipped.join('; ')}.` };
    }
    const skippedText = skipped.length ? ` Skipped: ${skipped.join('; ')}.` : '';
    return {
        success: true,
        operation: 'auto_edit',
        jobId: lastJobId,
        message: `${intro}Auto edit (${name}) done: ${done.join(', ')}. One undo reverts it.${skippedText}`,
        details: { styleId, done, skipped },
    };
}

export default { runAutopilot, stopAutopilot };
