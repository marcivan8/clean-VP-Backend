import { mediaExecutionEngine } from './MediaExecutionEngine.js';
import { ValidationService } from './ValidationService.js';
import useTimelineStore from '../store/useTimelineStore.js';
import { isSilentNoop } from './editChangeCheck.js';

/** Shared post-compile path for every edit surface. */
export async function executeVerifiedEdit(commands, plan, { signal = null, onProgress = null } = {}) {
    if (!Array.isArray(commands) || commands.length === 0) {
        return { success: false, error: 'The edit plan produced no executable operations.', results: [] };
    }
    const before = useTimelineStore.getState();
    const execution = await mediaExecutionEngine.execute(commands, onProgress, signal);
    if (!execution?.success) {
        return { success: false, error: execution?.error || 'Edit execution failed.', execution, results: execution?.results || [] };
    }
    // R105: "done" over an unchanged project is the worst outcome a command can
    // have (R30). Every command reported success while nothing moved is now
    // said plainly instead of announced as done.
    if (isSilentNoop(commands, before, useTimelineStore.getState())) {
        console.warn('[executeVerifiedEdit] commands succeeded but the project did not change:', commands.map(c => c?.action || c?.operation));
        return {
            success: false,
            // A command that already explained itself ("no silences found",
            // "captions already there") keeps its own words.
            error: [execution?.message, ...(execution?.results || []).map(r => r?.message || r?.result?.message)]
                .find(m => typeof m === 'string' && /\b(no|nothing|none|already|aucun|aucune|rien|déjà)\b/i.test(m))
                || "I understood the request, but nothing in the project changed, so it was not applied. Try saying which clip or which moment, or select the clip first.",
            noChange: true,
            execution,
            results: execution.results || [],
        };
    }
    const validation = await ValidationService.validate(plan, execution);
    if (!validation?.success) {
        return {
            success: false,
            error: validation?.message || validation?.error || 'The edit ran but did not pass verification.',
            execution,
            validation,
            results: execution.results || [],
            partialResult: true,
        };
    }
    return { success: true, execution, validation, results: execution.results || [] };
}
