/**
 * IntentValidator
 * Defines required parameters for each operation and validates intent completeness.
 * Used to calculate intent confidence.
 */

import { OPERATIONS } from './CommandConstants.js';

// Required parameters for each operation
const REQUIRED_PARAMS = {
    [OPERATIONS.ADD_CLIP]: ['src'], // Needs a media source URL
    [OPERATIONS.SPLIT_CLIP]: ['timestamp'], // or 'condition' (e.g. silent)
    [OPERATIONS.REMOVE_CLIP]: ['clipId'], // or 'selection'
    [OPERATIONS.TRIM_CLIP]: ['clipId', 'trimType', 'amount'], // trimType: start/end
    [OPERATIONS.SET_CLIP_SPEED]: ['speed'],
    [OPERATIONS.SET_ASPECT_RATIO]: ['ratio'],
    [OPERATIONS.EXPORT_VIDEO]: ['format', 'quality'],
    [OPERATIONS.ADD_TEXT_OVERLAY]: ['text'],
    [OPERATIONS.ADD_CAPTION]: ['text'],
    [OPERATIONS.ADD_TRANSITION]: ['type', 'duration'],
    [OPERATIONS.ADD_FILTER]: ['filterType'],
    [OPERATIONS.ADJUST_VOLUME]: ['volume'],
    [OPERATIONS.SILENCE_REMOVAL]: [], // No strict requirements, has defaults
    [OPERATIONS.COLOR_GRADE]: [], // Can be auto

    // CRL: Creative / Optimization operations
    [OPERATIONS.CREATIVE_ENHANCE]: ['platform', 'style'],
    [OPERATIONS.PLATFORM_OPTIMIZE]: ['platform', 'targetDuration'],
};

export class IntentValidator {
    /**
     * Validate an intent and calculate confidence
     * @param {object} intent - The intent object
     * @returns {object} { confidence: 'HIGH'|'MEDIUM'|'LOW', missingParameters: string[] }
     */
    static validate(intent) {
        if (!intent || !intent.operation) {
            return { confidence: 'LOW', missingParameters: [] };
        }

        const required = REQUIRED_PARAMS[intent.operation] || [];
        const missing = [];

        for (const param of required) {
            // Check if parameter exists in parameters or args
            const val = intent.parameters?.[param] ?? intent.args?.[param];

            // Special handling for split timestamp/condition
            if (intent.operation === OPERATIONS.SPLIT_CLIP) {
                if (param === 'timestamp' && !val && !intent.parameters?.condition && !intent.args?.condition) {
                    missing.push('timestamp_or_condition');
                }
                continue;
            }

            if (val === undefined || val === null) {
                missing.push(param);
            }
        }

        let confidence = 'HIGH';
        if (missing.length > 0) {
            // CRL clarity scoring: multiple critical params → LOW, minor → MEDIUM
            confidence = missing.length >= 2 ? 'LOW' : 'MEDIUM';
        } else if (this.isAmbiguous(intent)) {
            confidence = 'MEDIUM';
        }

        return { confidence, missingParameters: missing };
    }

    /**
     * Check for ambiguity even if required params are present
     */
    static isAmbiguous(intent) {
        // Generic "Edit" without specific operation
        if (intent.operation === 'EDIT_VIDEO' && !intent.parameters.action) {
            return true;
        }

        // CRL: Creative/optimize operations are inherently ambiguous
        // unless all context is explicitly provided
        if (intent.operation === OPERATIONS.CREATIVE_ENHANCE || 
            intent.operation === OPERATIONS.PLATFORM_OPTIMIZE) {
            const params = intent.parameters || {};
            if (!params.platform || !params.style) {
                return true;
            }
        }

        return false;
    }
}
