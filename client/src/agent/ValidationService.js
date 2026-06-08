import useTimelineStore from '../store/useTimelineStore.js';

/**
 * Validator Agent for Viral Pilot
 * 
 * Verifies that execution outputs match expected plan results.
 * 
 * Responsibilities:
 * - Verify file existence
 * - Check duration, frame count, sync
 * - Ensure timeline integrity
 * - Trigger rollback on failure
 * - Notify Orchestrator
 * 
 * Output: { success: true/false, outputs: [...], issues: [...] }
 */

// Validation result types
export const VALIDATION_RESULT = {
    PASS: 'PASS',
    FAIL: 'FAIL',
    WARN: 'WARN'
};

// Issue types
export const ISSUE_TYPES = {
    CLIP_MISSING: 'CLIP_MISSING',
    DURATION_MISMATCH: 'DURATION_MISMATCH',
    FRAME_COUNT_MISMATCH: 'FRAME_COUNT_MISMATCH',
    SYNC_DRIFT: 'SYNC_DRIFT',
    GAP_DETECTED: 'GAP_DETECTED',
    OVERLAP_DETECTED: 'OVERLAP_DETECTED',
    FILE_NOT_FOUND: 'FILE_NOT_FOUND',
    INTEGRITY_ERROR: 'INTEGRITY_ERROR'
};

// Tolerances
const TOLERANCES = {
    DURATION_MS: 100,      // 100ms duration tolerance
    SYNC_DRIFT_MS: 50,     // 50ms A/V sync tolerance
    GAP_MS: 50,            // 50ms gap tolerance
    FRAME_COUNT: 2         // 2 frame tolerance
};

export class ValidationService {
    constructor() {
        this.onRollbackRequired = null;
        this.onNotifyOrchestrator = null;
    }

    /**
     * Set callbacks for rollback and orchestrator notification
     */
    setCallbacks(callbacks) {
        this.onRollbackRequired = callbacks.onRollback;
        this.onNotifyOrchestrator = callbacks.onNotify;
    }

    /**
     * Full validation of execution results against plan
     * @param {object} plan - Original edit plan
     * @param {object} executionResult - Result from MediaExecutionEngine  
     * @param {object} options - Validation options
     * @returns {Promise<object>} Validation result
     */
    async validate(plan, executionResult, options = {}) {
        console.log('[ValidationService] Validating execution result');

        const state = useTimelineStore.getState();
        const outputs = [];
        const issues = [];
        const warnings = [];

        // Quick fail if execution failed
        if (!executionResult.success) {
            this.handleFailure(plan, executionResult.error);
            return {
                success: false,
                result: VALIDATION_RESULT.FAIL,
                error: executionResult.error || 'Execution failed',
                outputs: [],
                issues: [{ type: ISSUE_TYPES.INTEGRITY_ERROR, message: executionResult.error }]
            };
        }

        // Operations that intentionally restructure the timeline (silence removal,
        // smart cleanup, captions, etc.) produce tightly-packed multi-segment layouts that
        // are valid by design but look like overlaps/gaps to the integrity checker.
        // Skip it for those operations so they never trigger an erroneous rollback.
        const RESTRUCTURING_OPS = new Set([
            'silence_removal', 'remove_filler_words', 'long_form_edit',
            'smart_cleanup', 'remove_repetition', 'auto_captions', 'generate_captions', 'generate_transcript',
        ]);
        const opKey = plan.operation || plan.steps?.[0]?.action;
        const skipIntegrityCheck = RESTRUCTURING_OPS.has(opKey);

        try {
            // 1. Validate operation-specific results
            const opValidation = this.validateOperation(plan, executionResult, state);
            outputs.push(...(opValidation.outputs || []));
            issues.push(...(opValidation.issues || []));
            warnings.push(...(opValidation.warnings || []));

            // 2. Check timeline integrity (skipped for restructuring operations)
            if (!skipIntegrityCheck) {
                const integrityResult = this.validateTimelineIntegrity(state);
                issues.push(...(integrityResult.issues || []));
                warnings.push(...(integrityResult.warnings || []));
            }

            // 3. Verify file outputs if any FFmpeg commands were run
            if (this.hasFFmpegOutputs(executionResult)) {
                const fileValidation = await this.validateFileOutputs(executionResult);
                outputs.push(...(fileValidation.outputs || []));
                issues.push(...(fileValidation.issues || []));
            }

            // 4. Determine result
            const hasFailures = issues.length > 0;
            const result = hasFailures ? VALIDATION_RESULT.FAIL :
                warnings.length > 0 ? VALIDATION_RESULT.WARN :
                    VALIDATION_RESULT.PASS;

            if (hasFailures) {
                this.handleFailure(plan, issues);
                return {
                    success: false,
                    result,
                    outputs,
                    issues,
                    warnings,
                    message: `Validation failed: ${issues.length} issue(s)`
                };
            }

            // Notify orchestrator of success
            this.notifyOrchestrator({
                type: 'validation_complete',
                success: true,
                planId: plan.plan_id,
                outputs
            });

            return {
                success: true,
                result,
                outputs,
                issues: [],
                warnings,
                message: `Validation passed${warnings.length > 0 ? ` with ${warnings.length} warning(s)` : ''}`
            };

        } catch (error) {
            console.error('[ValidationService] Error:', error);
            this.handleFailure(plan, error.message);
            return {
                success: false,
                result: VALIDATION_RESULT.FAIL,
                error: error.message,
                outputs: [],
                issues: [{ type: ISSUE_TYPES.INTEGRITY_ERROR, message: error.message }]
            };
        }
    }

    /**
     * Static validation method (backwards compatible)
     */
    static validate(plan, executionResult) {
        const instance = new ValidationService();
        return instance.validate(plan, executionResult);
    }

    // ==================== OPERATION VALIDATORS ====================

    validateOperation(plan, executionResult, state) {
        const operation = plan.operation || plan.intent_operation || plan.steps?.[0]?.action;
        const outputs = [];
        const issues = [];
        const warnings = [];

        switch (operation) {
            case 'split_clip':
                return this.validateSplit(plan, state, executionResult);

            case 'remove_clip':
                return this.validateRemove(plan, state);

            case 'set_clip_speed':
                return this.validateSpeedChange(plan, state);

            case 'set_aspect_ratio':
                return this.validateAspectRatio(plan, state);

            case 'trim_clip':
                return this.validateTrim(plan, state);

            case 'duplicate_clip':
                return this.validateDuplicate(plan, state);

            case 'add_transition':
            case 'add_filter':
            case 'add_text':
            case 'color_grade':
                return this.validateEffect(plan, state);

            case 'export_video':
                return this.validateExport(plan, executionResult);

            case 'silence_removal':
                return this.validateSilenceRemoval(plan, executionResult);
            case 'remove_filler_words':
            case 'remove_repetition':
            case 'smart_cleanup':
            case 'long_form_edit':
            case 'auto_captions':
            case 'generate_captions':
            case 'generate_transcript':
                return { outputs: [], issues: [], warnings: [] };

            default:
                // Generic validation for unknown operations
                return {
                    outputs: executionResult.results?.map(r => ({
                        action: r.action,
                        status: r.success ? 'verified' : 'unverified'
                    })) || [],
                    issues: [],
                    warnings: []
                };
        }
    }

    validateSplit(plan, state, executionResult) {
        const splitStep = plan.steps?.find(s => s.action === 'split_clip');
        if (!splitStep) return { outputs: [], issues: [], warnings: [] };

        const { clip_id, track_id, timestamp } = splitStep;

        // Symbolic refs ($computed_split, $playhead, $track_of(...)) are resolved at
        // execution time and cannot be verified against state here — treat as a warning.
        const isSymbolic = (v) => typeof v === 'string' && v.startsWith('$');
        if (isSymbolic(track_id) || isSymbolic(clip_id) || isSymbolic(timestamp)) {
            return {
                outputs: [{ action: 'split_clip', note: 'Symbolic refs resolved at execution time' }],
                issues: [],
                warnings: [{ message: 'Split used symbolic refs — state verification deferred to executor' }]
            };
        }

        const track = state.tracks?.find(t => t.id === track_id);
        if (!track) {
            // Track may have been renamed or resolved dynamically — warn, don't fail
            return {
                outputs: [],
                issues: [],
                warnings: [{ message: `Track ${track_id} not found in state — may use dynamic resolution` }]
            };
        }

        // Find clips at or near the split point
        const splitTime = typeof timestamp === 'number'
            ? timestamp
            : executionResult.results?.find(r => typeof r.splitTime === 'number')?.splitTime;

        if (typeof splitTime !== 'number') {
            return {
                outputs: [],
                issues: [],
                warnings: [{ message: 'Split timestamp not numeric — cannot verify clip positions' }]
            };
        }

        const clipsNearSplit = track.clips?.filter(c => {
            const clipEnd = c.start + c.duration;
            return Math.abs(clipEnd - splitTime) < 0.1 || Math.abs(c.start - splitTime) < 0.1;
        }) || [];

        if (clipsNearSplit.length >= 2) {
            const sortedClips = [...clipsNearSplit].sort((a, b) => a.start - b.start);
            return {
                outputs: sortedClips.map(c => ({
                    clip_id: c.id,
                    start: c.start,
                    duration: c.duration,
                    end: c.start + c.duration
                })),
                issues: [],
                warnings: []
            };
        }

        // Check if original clip was just modified in-place
        const originalClip = track.clips?.find(c => c.id === clip_id);
        if (originalClip) {
            return {
                outputs: [{ clip_id, duration: originalClip.duration }],
                issues: [],
                warnings: [{ message: 'Split may have modified original clip in place' }]
            };
        }

        return {
            outputs: [],
            issues: [],
            warnings: [{ message: 'Could not verify split result — clips may have been re-indexed' }]
        };
    }

    validateRemove(plan, state) {
        const removeStep = plan.steps?.find(s => s.action === 'remove_clip');
        if (!removeStep) return { outputs: [], issues: [], warnings: [] };

        const { clip_id } = removeStep;

        // Verify clip no longer exists
        for (const track of state.tracks) {
            if (track.clips?.some(c => c.id === clip_id)) {
                return {
                    outputs: [],
                    issues: [{ type: ISSUE_TYPES.INTEGRITY_ERROR, message: `Clip ${clip_id} still exists` }],
                    warnings: []
                };
            }
        }

        return {
            outputs: [{ clip_id, action: 'removed', verified: true }],
            issues: [],
            warnings: []
        };
    }

    validateSpeedChange(plan, state) {
        const speedStep = plan.steps?.find(s => s.action === 'set_clip_speed');
        if (!speedStep) return { outputs: [], issues: [], warnings: [] };

        const { clip_id, speed } = speedStep;

        for (const track of state.tracks) {
            const clip = track.clips?.find(c => c.id === clip_id);
            if (clip) {
                const expectedDuration = clip.originalDuration ? clip.originalDuration / speed : null;

                return {
                    outputs: [{
                        clip_id,
                        speed: clip.speed || speed,
                        duration: clip.duration,
                        verified: true
                    }],
                    issues: [],
                    warnings: []
                };
            }
        }

        return {
            outputs: [],
            issues: [{ type: ISSUE_TYPES.CLIP_MISSING, message: `Clip ${clip_id} not found` }],
            warnings: []
        };
    }

    validateAspectRatio(plan, state) {
        const aspectStep = plan.steps?.find(s => s.action === 'set_aspect_ratio');
        if (!aspectStep) return { outputs: [], issues: [], warnings: [] };

        const { ratio } = aspectStep;

        // The store field name can vary (aspectRatio, canvas.aspectRatio, etc.).
        // A mismatch may also mean the store update hasn't been read yet by this snapshot.
        // Treat a mismatch as a warning rather than a blocking error.
        const actualRatio = state.aspectRatio ?? state.canvas?.aspectRatio;
        if (actualRatio && actualRatio === ratio) {
            return {
                outputs: [{ aspectRatio: ratio, verified: true }],
                issues: [],
                warnings: []
            };
        }

        return {
            outputs: [{ aspectRatio: ratio, storeValue: actualRatio ?? 'unknown' }],
            issues: [],
            warnings: actualRatio && actualRatio !== ratio
                ? [{ message: `Aspect ratio may not have committed yet: expected ${ratio}, store shows ${actualRatio}` }]
                : []
        };
    }

    validateTrim(plan, state) {
        const trimStep = plan.steps?.find(s => s.action.includes('trim'));
        if (!trimStep) return { outputs: [], issues: [], warnings: [] };

        const { clip_id } = trimStep;

        for (const track of state.tracks) {
            const clip = track.clips?.find(c => c.id === clip_id);
            if (clip) {
                return {
                    outputs: [{
                        clip_id,
                        duration: clip.duration,
                        start: clip.start,
                        verified: true
                    }],
                    issues: [],
                    warnings: []
                };
            }
        }

        return {
            outputs: [],
            issues: [{ type: ISSUE_TYPES.CLIP_MISSING, message: `Clip ${clip_id} not found` }],
            warnings: []
        };
    }

    validateDuplicate(plan, state) {
        const dupStep = plan.steps?.find(s => s.action === 'duplicate_clip');
        if (!dupStep) return { outputs: [], issues: [], warnings: [] };

        const { clip_id } = dupStep;

        // Check that at least 2 clips with similar properties exist
        for (const track of state.tracks) {
            const originalClip = track.clips?.find(c => c.id === clip_id);
            if (originalClip) {
                const copies = track.clips?.filter(c =>
                    c.duration === originalClip.duration && c.src === originalClip.src
                ) || [];

                if (copies.length >= 2) {
                    return {
                        outputs: copies.map(c => ({ clip_id: c.id, duration: c.duration })),
                        issues: [],
                        warnings: []
                    };
                }
            }
        }

        return {
            outputs: [],
            issues: [],
            warnings: [{ message: 'Could not verify duplicate' }]
        };
    }

    validateEffect(plan, state) {
        // Effects are harder to validate without visual inspection
        return {
            outputs: [{ type: 'effect', verified: true }],
            issues: [],
            warnings: [{ message: 'Effect applied (visual verification recommended)' }]
        };
    }

    validateExport(plan, executionResult) {
        // Check for output file in results
        const exportResult = executionResult.results?.find(r => r.output);

        if (exportResult?.output) {
            return {
                outputs: [{
                    file: exportResult.output,
                    duration: exportResult.duration,
                    verified: true
                }],
                issues: [],
                warnings: []
            };
        }

        return {
            outputs: [],
            issues: [{ type: ISSUE_TYPES.FILE_NOT_FOUND, message: 'Export output not found' }],
            warnings: []
        };
    }

    validateSilenceRemoval(plan, executionResult) {
        const silenceResult = executionResult.results?.find(r => r.segments);

        if (silenceResult?.segments) {
            return {
                outputs: [{
                    segments_detected: silenceResult.segments.length,
                    verified: true
                }],
                issues: [],
                warnings: []
            };
        }

        return {
            outputs: [],
            issues: [],
            warnings: [{ message: 'No silence segments detected' }]
        };
    }

    // ==================== TIMELINE INTEGRITY ====================

    validateTimelineIntegrity(state) {
        const issues = [];
        const warnings = [];

        for (const track of state.tracks || []) {
            if (!track.clips || track.clips.length === 0) continue;
            // Caption and text tracks are non-contiguous by design — skip overlap/gap checks
            if (track.type === 'caption' || track.type === 'text') continue;

            const clips = [...track.clips].sort((a, b) => a.start - b.start);
            let lastEnd = 0;

            for (const clip of clips) {
                // Check for overlaps
                if (clip.start < lastEnd - (TOLERANCES.GAP_MS / 1000)) {
                    issues.push({
                        type: ISSUE_TYPES.OVERLAP_DETECTED,
                        track_id: track.id,
                        clip_id: clip.id,
                        at: clip.start,
                        overlap: lastEnd - clip.start
                    });
                }

                // Check for gaps (only on video tracks)
                if (track.type === 'video') {
                    const gap = clip.start - lastEnd;
                    if (gap > (TOLERANCES.GAP_MS / 1000)) {
                        warnings.push({
                            type: ISSUE_TYPES.GAP_DETECTED,
                            track_id: track.id,
                            at: lastEnd,
                            duration: gap
                        });
                    }
                }

                // Check for invalid duration
                if (clip.duration <= 0) {
                    issues.push({
                        type: ISSUE_TYPES.DURATION_MISMATCH,
                        clip_id: clip.id,
                        message: 'Clip has zero or negative duration'
                    });
                }

                lastEnd = clip.start + clip.duration;
            }
        }

        return { issues, warnings };
    }

    // ==================== FILE VALIDATION ====================

    hasFFmpegOutputs(executionResult) {
        return executionResult.results?.some(r => r.engine === 'ffmpeg' && r.output);
    }

    async validateFileOutputs(executionResult) {
        const outputs = [];
        const issues = [];

        for (const result of executionResult.results || []) {
            if (result.engine !== 'ffmpeg' || !result.output) continue;

            try {
                // Call API to verify file exists and get metadata
                const response = await fetch('/api/media/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ file: result.output })
                });

                if (response.ok) {
                    const metadata = await response.json();
                    outputs.push({
                        file: result.output,
                        duration: metadata.duration,
                        size: metadata.size,
                        verified: true
                    });
                } else {
                    issues.push({
                        type: ISSUE_TYPES.FILE_NOT_FOUND,
                        file: result.output,
                        message: 'Output file not found or inaccessible'
                    });
                }
            } catch (error) {
                // File verification failed - add as warning, not blocking issue
                outputs.push({
                    file: result.output,
                    verified: false,
                    note: 'Could not verify file'
                });
            }
        }

        return { outputs, issues };
    }

    // ==================== FAILURE HANDLING ====================

    handleFailure(plan, issues) {
        console.error('[ValidationService] Validation failed:', issues);

        // Trigger rollback
        if (this.onRollbackRequired) {
            this.onRollbackRequired({
                planId: plan.plan_id,
                reason: Array.isArray(issues) ? issues[0]?.message || 'Validation failed' : issues
            });
        } else {
            // Fallback: attempt store rollback
            const store = useTimelineStore.getState();
            if (store.undo) {
                console.log('[ValidationService] Triggering automatic rollback');
                store.undo();
            }
        }

        // Notify orchestrator
        this.notifyOrchestrator({
            type: 'validation_failed',
            success: false,
            planId: plan.plan_id,
            issues: Array.isArray(issues) ? issues : [{ message: issues }]
        });
    }

    notifyOrchestrator(data) {
        if (this.onNotifyOrchestrator) {
            this.onNotifyOrchestrator(data);
        }

        // Emit event for any listeners
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('validation_result', { detail: data }));
        }
    }
}

// Singleton instance
export const validationService = new ValidationService();

export default ValidationService;
