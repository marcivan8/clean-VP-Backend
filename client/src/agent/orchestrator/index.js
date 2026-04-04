/**
 * Orchestrator Module
 * Event-driven controller for edit request lifecycle management.
 * 
 * Usage:
 * ```js
 * import { orchestratorController, EVENT_TYPES } from './orchestrator';
 * 
 * // Subscribe to events
 * orchestratorController.on(EVENT_TYPES.STATE_CHANGE, (event) => {
 *     console.log('State:', event.toState, 'Progress:', event.progress);
 * });
 * 
 * // Process a request
 * const result = await orchestratorController.processRequest("split the clip in half");
 * 
 * // Cancel if needed
 * orchestratorController.cancel(result.jobId);
 * ```
 */

// Core components
export { OrchestratorFSM } from './OrchestratorFSM.js';
export { OrchestratorController, orchestratorController } from './OrchestratorController.js';
export { OrchestratorEventEmitter, orchestratorEvents, EVENT_TYPES } from './OrchestratorEvents.js';

// Configuration
export {
    STATES,
    EVENTS,
    TERMINAL_STATES,
    PROGRESS_WEIGHTS,
    PLANNING_TIMEOUT_MS,
    EXECUTING_TIMEOUT_MS,
    VALIDATING_TIMEOUT_MS,
    GLOBAL_TIMEOUT_MS,
    MAX_RETRIES,
    MAX_ITERATIONS
} from './OrchestratorConfig.js';

// Default export is the singleton controller
export default orchestratorController;
