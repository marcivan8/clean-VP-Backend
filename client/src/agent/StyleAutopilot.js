/**
 * StyleAutopilot.js (R91): Auto mode. Runs the picked editing style's
 * playbook (agent/EditingStyles.js) from start to finish, each step through
 * the normal pipeline (EditJobManager.processEditRequest), without the plan
 * approval dialog, all of it ONE undo step.
 *
 * A step that fails or needs a question answered is skipped and reported;
 * the rest still runs. Stop (cancelCurrentJob) aborts the step in progress
 * and the remaining ones. New prompts wait until the run ends
 * (WorkflowController), so they never fold into its undo step.
 */
import useTimelineStore from '../store/useTimelineStore.js';
import useAIStore from '../store/useAIStore.js';
import { editJobManager } from './EditJobManager.js';
import { buildAutopilotSteps, getEditingStyle } from './EditingStyles.js';
import { beginAutoRun, endAutoRun } from './autoRunContext.js';

const STEP_LABEL = {
    captions: 'captions', transcript: 'transcript', short: 'best moment kept', vertical: 'vertical 9:16', request: 'your request', montage: 'visual montage',
    silences: 'silences removed', fillers: 'filler words removed', audio: 'audio levelled', recipe: 'style recipe',
    broll: 'b-roll placed',
};
const STYLE_NAME = { vlog: 'Vlog', talking_head: 'Talking head', interview: 'Interview', podcast: 'Podcast', reel: 'Reel' };

let stopRequested = false;
let running = false;
export function stopAutopilot() { stopRequested = true; }
/** True while an Auto run (and its undo group) is open. */
export function isAutopilotRunning() { return running; }

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
    // store.captions holds the transcript words (filled by the background
    // transcription on upload), not caption clips: it is what Reel needs to
    // pick its moment. Caption clips are always (re)placed after the cuts.
    const hasTranscript = Array.isArray(store.captions) && store.captions.length > 0;
    const visualClips = (store.tracks || []).filter(track => track.type === 'video').flatMap(track => track.clips || [])
        .filter(clip => ['video', 'image'].includes(clip.type));
    const visualAssets = (store.assets || []).filter(asset => ['video', 'image'].includes(asset.type) && !asset.provider && !asset.assistantReference);
    const hasStyleReference = (store.assets || []).some(asset =>
        asset.assistantReference && ['video', 'image'].includes(asset.type))
        || /Reference media supplied by the user for guidance only/i.test(request);
    const explicitSilent = /\b(silent|without (?:speech|dialogue|voice)|no (?:speech|dialogue|voice)|without narration|sans (?:parole|voix|dialogue))\b/i.test(request);
    const imageOnlyProject = [...visualClips.map(clip => clip.type), ...visualAssets.map(asset => asset.type)].length > 0
        && [...visualClips.map(clip => clip.type), ...visualAssets.map(asset => asset.type)].every(type => type === 'image');
    const visualOnly = !hasTranscript && (explicitSilent || imageOnlyProject);
    const hasVideoSource = visualClips.some(clip => clip.type === 'video') || visualAssets.some(asset => asset.type === 'video');
    const hasBrandReference = /\b(brand|logo|reference|mood ?board|inspiration|style guide)\b/i.test(request)
        || visualAssets.some(asset => asset.type === 'image' && /\b(brand|logo|kit|reference|mood.?board|inspiration|style.?guide)\b/i.test(asset.name || ''));
    const videoOnly = /\b(video(?:s| clips?)? only|use only the video)\b/i.test(request)
        || (hasBrandReference && hasVideoSource);
    let steps = buildAutopilotSteps(styleId, request, {
        hasTranscript,
        visualOnly,
        videoOnly,
        hasStyleReference,
        // Set by the mobile flow from the outcome the user picked; desktop
        // Auto leaves it undefined and keeps its existing playbooks.
        shortTargetSeconds: opts.shortTargetSeconds,
    });
    if (!visualClips.length && visualAssets.length && steps.length && steps[0].key !== 'montage') {
        steps = [{
            key: 'montage',
            prompt: videoOnly ? 'Create a video from the uploaded video clips only' : 'Create a video from the uploaded images and event footage',
        }, ...steps];
    }
    const intro = getEditingStyle(chosen) ? '' : 'No style picked, so Talking head was used. ';

    stopRequested = false;
    running = true;
    // Tags every gated request this run makes with one id, so the server bills
    // the run as a single AI operation instead of once per step. R148.
    beginAutoRun();
    const done = [];
    const skipped = [];
    const stepReports = [];
    let lastJobId = null;
    store.beginHistoryGroup();
    try {
        for (let i = 0; i < steps.length; i++) {
            if (stopRequested) {
                const remaining = steps.slice(i);
                skipped.push(...remaining.map(s => `${STEP_LABEL[s.key] || s.key} (stopped)`));
                stepReports.push(...remaining.map(s => ({ key: s.key, label: STEP_LABEL[s.key] || s.key, status: 'stopped' })));
                break;
            }
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
                const label = STEP_LABEL[step.key] || step.key;
                skipped.push(`${label} (needed a clarification)`);
                stepReports.push({ key: step.key, label, status: 'skipped', message: 'Needed a clarification.' });
                continue;
            }
            const label = STEP_LABEL[step.key] || step.key;
            if (res?.success) done.push(label);
            else skipped.push(`${label}${res?.message ? ` (${String(res.message).slice(0, 90)})` : ''}`);
            const details = step.key === 'finish' && res?.details && typeof res.details === 'object'
                ? {
                    ...(Array.isArray(res.details.applied) ? { applied: res.details.applied.slice(0, 12) } : {}),
                    ...(res.details.platform ? { platform: String(res.details.platform).slice(0, 24) } : {}),
                    ...(Number.isFinite(Number(res.details.duration)) ? { duration: Number(res.details.duration) } : {}),
                    ...(res.details.sceneSource ? { sceneSource: String(res.details.sceneSource).slice(0, 40) } : {}),
                    ...(Array.isArray(res.details.techniques) ? { techniques: res.details.techniques.slice(0, 8).map(x => String(x).slice(0, 60)) } : {}),
                    ...(res.details.quality?.checked ? { quality: {
                        checked: true,
                        repairs: (res.details.quality.repairs || []).slice(0, 20).map(item => ({ clipId: String(item.clipId || '').slice(0, 100), fromFontSize: item.fromFontSize, toFontSize: item.toFontSize, fromY: item.fromY, toY: item.toY, lines: item.lines })),
                        issues: (res.details.quality.issues || []).slice(0, 20).map(item => ({ clipId: String(item.clipId || '').slice(0, 100), code: String(item.code || '').slice(0, 40) })),
                        ...(res.details.quality.captions ? { captions: {
                            checked: !!res.details.quality.captions.checked,
                            transcriptWords: Number(res.details.quality.captions.transcriptWords) || 0,
                            captionWords: Number(res.details.quality.captions.captionWords) || 0,
                            coverage: Number(res.details.quality.captions.coverage) || 0,
                            issues: (res.details.quality.captions.issues || []).slice(0, 20).map(item => ({ clipId: String(item.clipId || '').slice(0, 100), code: String(item.code || '').slice(0, 40) })),
                        } } : {}),
                    } } : {}),
                    ...(res.details.capabilities ? { capabilities: res.details.capabilities } : {}),
                    ...(res.details.style ? { style: res.details.style } : {}),
                }
                : null;
            stepReports.push({
                key: step.key,
                label,
                status: res?.success ? 'complete' : 'skipped',
                ...(res?.message ? { message: String(res.message).slice(0, 240) } : {}),
                ...(details ? { details } : {}),
            });
        }
    } finally {
        useTimelineStore.getState().endHistoryGroup();
        running = false;
        endAutoRun();
    }

    const name = STYLE_NAME[styleId];
    const report = {
        id: `auto-${Date.now()}`,
        createdAt: new Date().toISOString(),
        styleId,
        request: String(request || '').slice(0, 240),
        status: done.length > 0 ? (skipped.length ? 'partial' : 'complete') : 'failed',
        steps: stepReports,
    };
    try {
        const current = useTimelineStore.getState();
        current.setAutoEditReports?.([...(current.autoEditReports || []), report]);
    } catch (err) {
        console.warn('[StyleAutopilot] Could not save the Auto edit report:', err.message);
    }
    if (done.length === 0) {
        return { success: false, operation: 'auto_edit', jobId: lastJobId, message: `${intro}Auto edit (${name}) could not apply anything. Skipped: ${skipped.join('; ')}.` };
    }
    const skippedText = skipped.length ? ` Skipped: ${skipped.join('; ')}.` : '';
    return {
        success: true,
        operation: 'auto_edit',
        jobId: lastJobId,
        message: `${intro}Auto edit (${name}) done: ${done.join(', ')}. One undo reverts it.${skippedText}`,
        details: { styleId, done, skipped, report },
    };
}

export default { runAutopilot, stopAutopilot, isAutopilotRunning };
