/**
 * ErrorRecoveryAgent - Failure Handler for Viral Pilot
 * 
 * Listens for job failures and suggests remediation actions.
 * 
 * Responsibilities:
 * - Analyze error patterns
 * - Suggest alternative approaches
 * - Provide user-friendly error messages
 * - Queue recovery actions for approval
 * 
 * This agent NEVER executes recovery. It only suggests.
 */

import { EventBus, EVENT_TYPES, PRIORITY } from './EventBus.js';

// Known error patterns and suggested recoveries
const ERROR_PATTERNS = [
    {
        pattern: /file not found/i,
        category: 'file_missing',
        suggestion: 'The file could not be located. Please re-import the file or check if it was moved.',
        actions: [
            { type: 'request_file_reupload', label: 'Re-upload File' }
        ]
    },
    {
        pattern: /codec.*not supported|unsupported.*codec/i,
        category: 'codec_error',
        suggestion: 'The video codec is not supported. Try transcoding to a standard format (H.264/MP4).',
        actions: [
            { type: 'transcode_source', label: 'Transcode to MP4', params: { codec: 'libx264' } }
        ]
    },
    {
        pattern: /timeout|timed out/i,
        category: 'timeout',
        suggestion: 'The operation took too long. Try with a shorter clip or reduce complexity.',
        actions: [
            { type: 'retry_with_smaller_chunk', label: 'Retry with Smaller Segment' },
            { type: 'retry', label: 'Retry Operation' }
        ]
    },
    {
        pattern: /out of memory|memory.*exceeded/i,
        category: 'memory',
        suggestion: 'Not enough memory to complete the operation. Try closing other apps or using smaller files.',
        actions: [
            { type: 'use_proxy', label: 'Use Lower Quality Proxy' }
        ]
    },
    {
        pattern: /permission denied|access denied/i,
        category: 'permission',
        suggestion: 'Permission was denied to access the file. Check file permissions or try re-importing.',
        actions: [
            { type: 'request_file_reupload', label: 'Re-upload File' }
        ]
    },
    {
        pattern: /network|connection|fetch|api.*error/i,
        category: 'network',
        suggestion: 'A network error occurred. Check your connection and try again.',
        actions: [
            { type: 'retry', label: 'Retry' },
            { type: 'use_offline_mode', label: 'Use Offline Mode' }
        ]
    },
    {
        pattern: /ffmpeg|command failed/i,
        category: 'ffmpeg',
        suggestion: 'The media processing command failed. This may be a compatibility issue.',
        actions: [
            { type: 'retry', label: 'Retry Operation' },
            { type: 'transcode_source', label: 'Transcode Source First' }
        ]
    },
    {
        pattern: /silence.*detection|audio.*analysis/i,
        category: 'audio_analysis',
        suggestion: 'Audio analysis failed. Ensure the file has an audio track.',
        actions: [
            { type: 'check_audio_track', label: 'Verify Audio Track' },
            { type: 'retry', label: 'Retry' }
        ]
    }
];

// Default recovery for unknown errors
const DEFAULT_RECOVERY = {
    category: 'unknown',
    suggestion: 'An unexpected error occurred. Please try again or report this issue.',
    actions: [
        { type: 'retry', label: 'Retry' },
        { type: 'report_issue', label: 'Report Issue' }
    ]
};

class ErrorRecoveryAgentClass {
    constructor() {
        this.isActive = false;
        this.recoveryHistory = [];
        this.maxHistory = 50;
    }

    /**
     * Activate the error recovery agent
     */
    activate() {
        if (this.isActive) return;

        console.log('[ErrorRecoveryAgent] Activating...');

        this.unsubscribers = [
            EventBus.on(EVENT_TYPES.JOB_FAILED, this.onJobFailed.bind(this), { priority: PRIORITY.NORMAL }),
            EventBus.on(EVENT_TYPES.JOB_HUNG, this.onJobHung.bind(this), { priority: PRIORITY.NORMAL }),
            EventBus.on(EVENT_TYPES.EXECUTION_FAILED, this.onExecutionFailed.bind(this), { priority: PRIORITY.NORMAL }),
            EventBus.on(EVENT_TYPES.VALIDATION_FAILED, this.onValidationFailed.bind(this), { priority: PRIORITY.NORMAL })
        ];

        this.isActive = true;
        console.log('[ErrorRecoveryAgent] Active');
    }

    /**
     * Deactivate the error recovery agent
     */
    deactivate() {
        if (!this.isActive) return;

        this.unsubscribers?.forEach(unsub => unsub());
        this.unsubscribers = [];
        this.isActive = false;

        console.log('[ErrorRecoveryAgent] Deactivated');
    }

    /**
     * Handle job failed event
     */
    onJobFailed(payload) {
        const { jobId, error, phase } = payload;
        this.analyzeAndSuggest(jobId, error, 'job_failed', { phase });
    }

    /**
     * Handle job hung event
     */
    onJobHung(payload) {
        const { jobId, message, reason, phase } = payload;
        this.analyzeAndSuggest(jobId, message || reason, 'job_hung', { phase, reason });
    }

    /**
     * Handle execution failed event
     */
    onExecutionFailed(payload) {
        const { jobId, error, command } = payload;
        this.analyzeAndSuggest(jobId, error, 'execution_failed', { command });
    }

    /**
     * Handle validation failed event
     */
    onValidationFailed(payload) {
        const { jobId, error, issues } = payload;
        this.analyzeAndSuggest(jobId, error || issues?.join(', '), 'validation_failed', { issues });
    }

    /**
     * Analyze error and emit recovery suggestion
     */
    analyzeAndSuggest(jobId, errorMessage, source, context = {}) {
        const errorStr = String(errorMessage || 'Unknown error');

        // Find matching error pattern
        let recovery = DEFAULT_RECOVERY;
        for (const pattern of ERROR_PATTERNS) {
            if (pattern.pattern.test(errorStr)) {
                recovery = pattern;
                break;
            }
        }

        const suggestion = {
            jobId,
            source,
            errorMessage: errorStr,
            category: recovery.category,
            userMessage: recovery.suggestion,
            actions: recovery.actions.map(action => ({
                ...action,
                jobId,
                context
            })),
            timestamp: Date.now(),
            context
        };

        // Record in history
        this.recordSuggestion(suggestion);

        console.log(`[ErrorRecoveryAgent] Suggesting recovery for ${jobId}:`, recovery.category);

        // Emit recovery suggestion
        EventBus.emit(EVENT_TYPES.RECOVERY_SUGGESTED, suggestion);

        return suggestion;
    }

    /**
     * Record suggestion in history
     */
    recordSuggestion(suggestion) {
        this.recoveryHistory.push(suggestion);
        if (this.recoveryHistory.length > this.maxHistory) {
            this.recoveryHistory.shift();
        }
    }

    /**
     * Get recovery history
     */
    getHistory(jobId = null) {
        if (jobId) {
            return this.recoveryHistory.filter(s => s.jobId === jobId);
        }
        return [...this.recoveryHistory];
    }

    /**
     * Add custom error pattern
     */
    addPattern(pattern, category, suggestion, actions) {
        ERROR_PATTERNS.unshift({
            pattern: pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i'),
            category,
            suggestion,
            actions
        });
        console.log(`[ErrorRecoveryAgent] Added pattern: ${category}`);
    }

    /**
     * Get status
     */
    getStatus() {
        return {
            isActive: this.isActive,
            patternsCount: ERROR_PATTERNS.length,
            historyCount: this.recoveryHistory.length
        };
    }
}

// Singleton instance
export const ErrorRecoveryAgent = new ErrorRecoveryAgentClass();

export default ErrorRecoveryAgent;
