/**
 * AgentSystem - Initialization & Bootstrap for Viral Pilot Agents
 * 
 * This module initializes all agent components and wires them together.
 * Import this once at application startup.
 * 
 * Components initialized:
 * - EventBus (global pub/sub)
 * - ExecutionSupervisor (watchdog)
 * - ErrorRecoveryAgent (failure handler)
 * - UserApprovalAgent (gatekeeper)
 */

import { EventBus, EVENT_TYPES } from './EventBus.js';
import { ExecutionSupervisor } from './ExecutionSupervisor.js';
import { ErrorRecoveryAgent } from './ErrorRecoveryAgent.js';
import { UserApprovalAgent } from './UserApprovalAgent.js';
import { FallbackParser } from './FallbackParser.js';
import { PresetSystem } from '../presets/PresetSystem.js';

// Debug mode flag
let debugMode = false;

/**
 * Initialize the agent system
 * @param {object} options - Initialization options
 */
export function initializeAgentSystem(options = {}) {
    const {
        enableDebug = false,
        enableSupervisor = true,
        enableRecovery = true,
        enableApproval = true
    } = options;

    debugMode = enableDebug;

    console.log('[AgentSystem] Initializing...');

    // Enable debug logging if requested
    if (enableDebug) {
        EventBus.setDebugMode(true);
    }

    // Start the Execution Supervisor (watchdog)
    if (enableSupervisor) {
        ExecutionSupervisor.start();
    }

    // Activate Error Recovery Agent
    if (enableRecovery) {
        ErrorRecoveryAgent.activate();
    }

    // Activate User Approval Agent
    if (enableApproval) {
        UserApprovalAgent.activate();
    }

    // Log system status
    console.log('[AgentSystem] Initialization complete:', {
        eventBus: 'active',
        supervisor: enableSupervisor ? 'active' : 'disabled',
        recovery: enableRecovery ? 'active' : 'disabled',
        approval: enableApproval ? 'active' : 'disabled',
        fallbackPatterns: FallbackParser.getPatternCount(),
        presets: PresetSystem.getAll().length
    });

    return {
        EventBus,
        ExecutionSupervisor,
        ErrorRecoveryAgent,
        UserApprovalAgent,
        FallbackParser,
        PresetSystem
    };
}

/**
 * Shutdown the agent system
 */
export function shutdownAgentSystem() {
    console.log('[AgentSystem] Shutting down...');

    ExecutionSupervisor.stop();
    ErrorRecoveryAgent.deactivate();
    UserApprovalAgent.deactivate();
    EventBus.clear();

    console.log('[AgentSystem] Shutdown complete');
}

/**
 * Get system health status
 */
export function getAgentSystemHealth() {
    return {
        eventBus: {
            historySize: EventBus.getHistory().length,
            debugMode: debugMode
        },
        supervisor: ExecutionSupervisor.getStatus(),
        recovery: ErrorRecoveryAgent.getStatus(),
        approval: UserApprovalAgent.getStatus(),
        presets: {
            total: PresetSystem.getAll().length,
            categories: PresetSystem.getCategories()
        }
    };
}

// Re-export for convenience
export {
    EventBus,
    EVENT_TYPES,
    ExecutionSupervisor,
    ErrorRecoveryAgent,
    UserApprovalAgent,
    FallbackParser,
    PresetSystem
};

export default {
    initialize: initializeAgentSystem,
    shutdown: shutdownAgentSystem,
    getHealth: getAgentSystemHealth,
    EventBus,
    ExecutionSupervisor,
    ErrorRecoveryAgent,
    UserApprovalAgent,
    FallbackParser,
    PresetSystem
};
