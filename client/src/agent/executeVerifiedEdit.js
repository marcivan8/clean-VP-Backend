import { mediaExecutionEngine } from './MediaExecutionEngine.js';
import { ValidationService } from './ValidationService.js';

/** Shared post-compile path for every edit surface. */
export async function executeVerifiedEdit(commands, plan, { signal = null, onProgress = null } = {}) {
    if (!Array.isArray(commands) || commands.length === 0) {
        return { success: false, error: 'The edit plan produced no executable operations.', results: [] };
    }
    const execution = await mediaExecutionEngine.execute(commands, onProgress, signal);
    if (!execution?.success) {
        return { success: false, error: execution?.error || 'Edit execution failed.', execution, results: execution?.results || [] };
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
