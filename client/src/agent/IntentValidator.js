/**
 * IntentValidator
 * Defines required parameters for each operation and validates intent completeness.
 * Uses context-aware confidence scoring — many operations have implicit defaults
 * that make explicit parameters unnecessary.
 *
 * FIX LOG:
 * - SPLIT_CLIP: `mode` (midpoint/thirds/quarters/playhead) now counts as HIGH confidence
 *   without requiring a timestamp. Previously every split got MEDIUM → clarification loop.
 * - TRIM_CLIP: `targetDuration` or `duration` alone is sufficient. trimType defaults to 'end'.
 * - REMOVE_CLIP: clipId via target selection is sufficient.
 * - SET_CLIP_SPEED: speed present → HIGH (no change, was already correct).
 * - Operations with defaults (SILENCE_REMOVAL, COLOR_GRADE, etc.) stay at HIGH.
 */

import { OPERATIONS } from './CommandConstants.js';

// ─────────────────────────────────────────────────────────────
// §1  REQUIRED PARAMETERS
//
// Only list params that are truly necessary AND have no reasonable
// default or contextual fallback. Anything a senior editor can
// infer from context should NOT be listed here.
// ─────────────────────────────────────────────────────────────
const REQUIRED_PARAMS = {
    [OPERATIONS.ADD_CLIP]:          ['src'],
    [OPERATIONS.SPLIT_CLIP]:        [], // mode OR timestamp — validated in custom logic below
    [OPERATIONS.REMOVE_CLIP]:       [], // auto-selects active clip if none specified
    [OPERATIONS.TRIM_CLIP]:         [], // duration/targetDuration checked in custom logic
    [OPERATIONS.SET_CLIP_SPEED]:    ['speed'],
    [OPERATIONS.SET_ASPECT_RATIO]:  ['ratio'],
    [OPERATIONS.EXPORT_VIDEO]:      ['format', 'quality'],
    [OPERATIONS.ADD_TEXT_OVERLAY]:  ['text'],
    [OPERATIONS.ADD_CAPTION]:       ['text'],
    [OPERATIONS.ADD_TRANSITION]:    ['type'],   // duration has a default (0.5s)
    [OPERATIONS.ADD_FILTER]:        ['filterType'],
    [OPERATIONS.ADJUST_VOLUME]:     ['volume'],
    [OPERATIONS.SILENCE_REMOVAL]:   [],  // threshold has default -30dB
    [OPERATIONS.COLOR_GRADE]:       [],  // can be auto/default
    [OPERATIONS.CREATIVE_ENHANCE]:  ['platform', 'style'],
    [OPERATIONS.PLATFORM_OPTIMIZE]: ['platform'],  // targetDuration optional
    [OPERATIONS.DUPLICATE_CLIP]:    [],  // auto-selects active clip
    [OPERATIONS.CUT_AT_PLAYHEAD]:   [],  // uses current playhead position
    [OPERATIONS.CUT_AT_TIMESTAMP]:  ['timestamp'],
    [OPERATIONS.CUT_SEGMENT]:       ['start', 'end'],
    // Long-form operations — all have enough context from analysis cache
    [OPERATIONS.ANALYZE_STRUCTURE]: [],
    [OPERATIONS.LONG_FORM_EDIT]:    [],
    [OPERATIONS.FIND_HOOK]:         [],
    [OPERATIONS.REMOVE_REPETITION]: [],
    [OPERATIONS.BUILD_FROM_RUSHES]: [],
    [OPERATIONS.REORDER_SEGMENT]:   ['clipId', 'targetPosition'],
};

// ─────────────────────────────────────────────────────────────
// §2  CUSTOM VALIDATORS
//
// For operations where simple param presence isn't enough —
// we run custom logic and return { confidence, missingParameters }.
// ─────────────────────────────────────────────────────────────
const CUSTOM_VALIDATORS = {
    /**
     * SPLIT_CLIP: HIGH if mode is given OR timestamp is given.
     * "split in half" → mode=midpoint → HIGH ✓
     * "split at 0:30"  → timestamp=30 → HIGH ✓
     * bare "split"     → MEDIUM (need to know where)
     */
    [OPERATIONS.SPLIT_CLIP]: (params) => {
        const hasTimestamp = params.timestamp != null || params.at_time != null;
        const hasMode = params.mode != null && params.mode !== '';
        const hasPlayhead = params.mode === 'playhead';
        const hasCondition = params.condition != null;

        if (hasTimestamp || hasMode || hasPlayhead || hasCondition) {
            return { confidence: 'HIGH', missingParameters: [] };
        }
        return {
            confidence: 'MEDIUM',
            missingParameters: ['timestamp_or_mode'],
        };
    },

    /**
     * TRIM_CLIP: HIGH if duration/targetDuration given.
     * trimType defaults to 'end', amount defaults to the given duration.
     * "trim to 30 seconds" → targetDuration=30 → HIGH ✓
     * "trim 5 seconds off" → duration=5 → HIGH ✓
     * bare "trim"          → MEDIUM
     */
    [OPERATIONS.TRIM_CLIP]: (params) => {
        const hasDuration = params.duration != null || params.targetDuration != null || params.amount != null;
        if (hasDuration) {
            return { confidence: 'HIGH', missingParameters: [] };
        }
        return {
            confidence: 'MEDIUM',
            missingParameters: ['duration'],
        };
    },

    /**
     * REMOVE_CLIP: HIGH even without explicit clipId —
     * agent auto-selects the active clip.
     */
    [OPERATIONS.REMOVE_CLIP]: (params) => {
        return { confidence: 'HIGH', missingParameters: [] };
    },

    /**
     * PLATFORM_OPTIMIZE: HIGH if platform given.
     * targetDuration is optional (agent picks a good default per platform).
     */
    [OPERATIONS.PLATFORM_OPTIMIZE]: (params) => {
        if (params.platform) {
            return { confidence: 'HIGH', missingParameters: [] };
        }
        return {
            confidence: 'LOW',
            missingParameters: ['platform'],
        };
    },
};

// ─────────────────────────────────────────────────────────────
// §3  AMBIGUITY DETECTOR
// ─────────────────────────────────────────────────────────────
function isAmbiguous(intent) {
    const op = intent.operation;
    const params = intent.parameters || intent.args || {};

    // Vague creative operation with no target platform
    if (op === OPERATIONS.CREATIVE_ENHANCE && !params.platform && !params.style) {
        return true;
    }

    return false;
}

// ─────────────────────────────────────────────────────────────
// §4  MAIN VALIDATOR
// ─────────────────────────────────────────────────────────────
export class IntentValidator {
    /**
     * Validate an intent and calculate confidence.
     *
     * @param {object} intent - { operation, parameters, args }
     * @returns {{ confidence: 'HIGH'|'MEDIUM'|'LOW', missingParameters: string[] }}
     */
    static validate(intent) {
        if (!intent || !intent.operation) {
            return { confidence: 'LOW', missingParameters: [] };
        }

        const params = { ...(intent.parameters || {}), ...(intent.args || {}) };
        const op = intent.operation;

        // 1. Run custom validator if one exists for this operation
        if (CUSTOM_VALIDATORS[op]) {
            const result = CUSTOM_VALIDATORS[op](params);
            // If custom says MEDIUM/LOW, still allow HIGH override when not ambiguous
            if (result.confidence === 'HIGH' && !isAmbiguous(intent)) {
                return result;
            }
            if (result.confidence !== 'HIGH') {
                return result;
            }
        }

        // 2. Standard required-params check
        const required = REQUIRED_PARAMS[op] || [];
        const missing = [];

        for (const param of required) {
            const val = params[param];
            if (val === undefined || val === null || val === '') {
                missing.push(param);
            }
        }

        // 3. Ambiguity check
        if (missing.length === 0 && isAmbiguous(intent)) {
            return { confidence: 'MEDIUM', missingParameters: [] };
        }

        // 4. Score
        let confidence = 'HIGH';
        if (missing.length >= 2) confidence = 'LOW';
        else if (missing.length === 1) confidence = 'MEDIUM';

        return { confidence, missingParameters: missing };
    }
}

export default IntentValidator;