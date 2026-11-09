/**
 * Legacy server-side command bridge.
 *
 * The server cannot mutate the browser's live timeline. The previous adapter
 * asked a second model to propose actions and then reported success without
 * dispatching them to MediaExecutionEngine. Keep the public function in place
 * for callers, but fail closed until a real shared executor is available.
 * User edits should go through the client workflow, which plans, compiles,
 * applies, and validates commands against the active editor state.
 */
'use strict';

/**
 * @param {string} commandString
 * @returns {Promise<import('./types').EngineResult>}
 */
async function executeAICommand(commandString) {
    const actionTaken = String(commandString || '').trim();
    const error = actionTaken
        ? 'The server command bridge cannot apply edits to the browser timeline. No changes were made.'
        : 'No command provided';

    console.warn('[PipelineAdapter] Refusing undispatched command:', actionTaken || '(empty)');
    return {
        success: false,
        error,
        timelineAfter: null,
        actionTaken,
        executed: false,
    };
}

module.exports = { executeAICommand };
