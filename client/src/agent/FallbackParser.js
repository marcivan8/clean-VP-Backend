/**
 * FallbackParser - Regex-based Intent Parser for Offline Mode
 * 
 * When the AI/LLM is unavailable, this parser uses pattern matching
 * to handle common editing commands.
 * 
 * Features:
 * - Regex patterns for common commands
 * - Low-confidence intents (flagged for review)
 * - Graceful degradation
 * - Extensible pattern library
 */

import { EventBus, EVENT_TYPES } from './EventBus.js';

// Pattern definitions: regex -> intent generator
const PATTERNS = [
    // Time-based cuts
    {
        regex: /^(?:cut|split)\s+(?:at\s+)?(\d+(?:\.\d+)?)\s*(?:s(?:ec(?:ond)?s?)?)?$/i,
        intent: (match) => ({
            type: 'split',
            action: 'split_clip',
            time: parseFloat(match[1]),
            confidence: 'high'
        })
    },

    // Trim operations
    {
        regex: /^trim\s+(?:from\s+)?(\d+(?:\.\d+)?)\s*(?:s(?:ec)?s?)?\s+(?:to\s+)?(\d+(?:\.\d+)?)\s*(?:s(?:ec)?s?)?$/i,
        intent: (match) => ({
            type: 'trim',
            action: 'trim_clip',
            startTime: parseFloat(match[1]),
            endTime: parseFloat(match[2]),
            confidence: 'high'
        })
    },

    // Silence removal
    {
        regex: /^(?:remove|delete|cut)\s+(?:the\s+)?silence(?:\s+from\s+.*)?$/i,
        intent: () => ({
            type: 'silence_removal',
            action: 'silence_removal',
            threshold: '-30dB',
            confidence: 'medium'
        })
    },

    // Speed changes
    {
        regex: /^(?:speed\s+up|faster)\s*(?:by\s+)?(\d+(?:\.\d+)?)?x?$/i,
        intent: (match) => ({
            type: 'speed_change',
            action: 'change_speed',
            speed: match[1] ? parseFloat(match[1]) : 2.0,
            confidence: 'high'
        })
    },
    {
        regex: /^(?:slow\s+down|slower)\s*(?:by\s+)?(\d+(?:\.\d+)?)?x?$/i,
        intent: (match) => ({
            type: 'speed_change',
            action: 'change_speed',
            speed: match[1] ? 1 / parseFloat(match[1]) : 0.5,
            confidence: 'high'
        })
    },
    {
        regex: /^(?:set\s+)?speed\s+(?:to\s+)?(\d+(?:\.\d+)?)x?$/i,
        intent: (match) => ({
            type: 'speed_change',
            action: 'change_speed',
            speed: parseFloat(match[1]),
            confidence: 'high'
        })
    },

    // Aspect ratio
    {
        regex: /^(?:change|set)\s+(?:aspect\s+)?ratio\s+(?:to\s+)?(\d+:\d+|vertical|horizontal|square|portrait|landscape)$/i,
        intent: (match) => {
            const ratioMap = {
                'vertical': '9:16',
                'portrait': '9:16',
                'horizontal': '16:9',
                'landscape': '16:9',
                'square': '1:1'
            };
            const ratio = ratioMap[match[1].toLowerCase()] || match[1];
            return {
                type: 'aspect_ratio',
                action: 'set_aspect_ratio',
                ratio,
                confidence: 'high'
            };
        }
    },

    // Delete/Remove clip
    {
        regex: /^(?:delete|remove)\s+(?:the\s+)?(?:current\s+)?(?:clip|selection)$/i,
        intent: () => ({
            type: 'delete',
            action: 'delete_clip',
            target: 'selected',
            confidence: 'high'
        })
    },

    // Duplicate clip
    {
        regex: /^(?:duplicate|copy)\s+(?:the\s+)?(?:current\s+)?(?:clip|selection)$/i,
        intent: () => ({
            type: 'duplicate',
            action: 'duplicate_clip',
            target: 'selected',
            confidence: 'high'
        })
    },

    // Add text/captions
    {
        regex: /^add\s+(?:text|caption|subtitle)\s*[:\-]?\s*["']?(.+?)["']?$/i,
        intent: (match) => ({
            type: 'add_text',
            action: 'add_text_overlay',
            text: match[1].trim(),
            confidence: 'medium'
        })
    },

    // Export
    {
        regex: /^export(?:\s+(?:as|to)\s+(\w+))?$/i,
        intent: (match) => ({
            type: 'export',
            action: 'export',
            format: match[1] || 'mp4',
            confidence: 'high'
        })
    },

    // Undo/Redo
    {
        regex: /^undo$/i,
        intent: () => ({
            type: 'undo',
            action: 'undo',
            confidence: 'high'
        })
    },
    {
        regex: /^redo$/i,
        intent: () => ({
            type: 'redo',
            action: 'redo',
            confidence: 'high'
        })
    },

    // Apply preset/filter
    {
        regex: /^(?:apply|use)\s+(?:the\s+)?["']?(.+?)["']?\s+(?:preset|filter|look)$/i,
        intent: (match) => ({
            type: 'apply_preset',
            action: 'apply_preset',
            presetName: match[1].trim().toLowerCase(),
            confidence: 'medium'
        })
    },

    // Denoise audio
    {
        regex: /^(?:remove|reduce|clean)\s+(?:the\s+)?(?:background\s+)?noise$/i,
        intent: () => ({
            type: 'audio_denoise',
            action: 'audio_denoise',
            confidence: 'medium'
        })
    },

    // Normalize audio
    {
        regex: /^normalize\s+(?:the\s+)?audio$/i,
        intent: () => ({
            type: 'audio_normalize',
            action: 'audio_normalize',
            confidence: 'high'
        })
    }
];

class FallbackParserClass {
    constructor() {
        this.patterns = [...PATTERNS];
        this.parseHistory = [];
        this.maxHistory = 50;
    }

    /**
     * Parse a user prompt using regex patterns
     * @param {string} prompt - User input
     * @returns {object|null} Parsed intent or null
     */
    parse(prompt) {
        const trimmedPrompt = prompt.trim();

        for (const pattern of this.patterns) {
            const match = trimmedPrompt.match(pattern.regex);
            if (match) {
                const intent = pattern.intent(match);

                const result = {
                    ...intent,
                    originalPrompt: trimmedPrompt,
                    parsedBy: 'fallback',
                    timestamp: Date.now()
                };

                this.recordParse(result);

                // Emit event that fallback was used
                EventBus.emit(EVENT_TYPES.FALLBACK_USED, {
                    prompt: trimmedPrompt,
                    intent: result
                });

                console.log(`[FallbackParser] Matched: "${trimmedPrompt}" -> ${intent.action}`);
                return result;
            }
        }

        // No match found
        console.log(`[FallbackParser] No match for: "${trimmedPrompt}"`);
        this.recordParse({
            originalPrompt: trimmedPrompt,
            parsedBy: 'fallback',
            matched: false,
            timestamp: Date.now()
        });

        return null;
    }

    /**
     * Check if a prompt can be parsed by fallback
     * @param {string} prompt
     * @returns {boolean}
     */
    canParse(prompt) {
        const trimmedPrompt = prompt.trim();
        return this.patterns.some(p => p.regex.test(trimmedPrompt));
    }

    /**
     * Record parse attempt in history
     */
    recordParse(result) {
        this.parseHistory.push(result);
        if (this.parseHistory.length > this.maxHistory) {
            this.parseHistory.shift();
        }
    }

    /**
     * Add a custom pattern
     * @param {RegExp} regex - Pattern to match
     * @param {function} intentFn - (match) => intent object
     */
    addPattern(regex, intentFn) {
        this.patterns.unshift({ regex, intent: intentFn });
        console.log(`[FallbackParser] Added pattern: ${regex}`);
    }

    /**
     * Get all supported commands (for help/autocomplete)
     * @returns {Array} List of example commands
     */
    getSupportedCommands() {
        return [
            'cut at 5s',
            'split at 10.5 seconds',
            'trim from 0 to 30s',
            'remove silence',
            'speed up 2x',
            'slow down 0.5x',
            'set speed to 1.5x',
            'change ratio to 9:16',
            'set aspect ratio to vertical',
            'delete clip',
            'duplicate clip',
            'add text: Hello World',
            'export',
            'export as mp4',
            'undo',
            'redo',
            'apply cinematic preset',
            'remove noise',
            'normalize audio'
        ];
    }

    /**
     * Get parse history
     */
    getHistory() {
        return [...this.parseHistory];
    }

    /**
     * Get supported patterns count
     */
    getPatternCount() {
        return this.patterns.length;
    }
}

// Singleton instance
export const FallbackParser = new FallbackParserClass();

export default FallbackParser;
