/**
 * FallbackParser — Enhanced
 *
 * Covers a much wider vocabulary of natural user speech,
 * including casual, abbreviated, and domain-specific phrasings.
 */

import { EventBus, EVENT_TYPES } from './EventBus.js';

const PATTERNS = [
    // ── SPLIT ──────────────────────────────────────────────────────────────
    {
        regex: /^(?:split|cut in half|divide|chop|bisect|cut into (?:2|two))\s*(?:the\s+)?(?:clip|video)?$/i,
        intent: () => ({ type: 'edit', action: 'split_clip', constraints: { mode: 'midpoint' }, confidence: 'high' })
    },

    {
        regex: /^(?:split|cut)\s+(?:at\s+)?(\d+(?:\.\d+)?)\s*(?:s(?:ec(?:ond)?s?)?)?$/i,
        intent: (m) => ({ type: 'edit', action: 'split_clip', constraints: { mode: 'timestamp', timestamp: parseFloat(m[1]) }, confidence: 'high' })
    },

    {
        regex: /^(?:split|cut)\s+(?:at\s+)?(\d{1,2}):(\d{2})$/i,
        intent: (m) => ({ type: 'edit', action: 'split_clip', constraints: { mode: 'timestamp', timestamp: parseInt(m[1]) * 60 + parseInt(m[2]) }, confidence: 'high' })
    },

    {
        regex: /^(?:split|cut|divide)\s+(?:in(?:to)?\s+)?(?:thirds?|3|three)/i,
        intent: () => ({ type: 'edit', action: 'split_clip', constraints: { mode: 'thirds' }, confidence: 'high' })
    },

    {
        regex: /^(?:split|cut|divide)\s+(?:in(?:to)?\s+)?(?:quarters?|4|four)/i,
        intent: () => ({ type: 'edit', action: 'split_clip', constraints: { mode: 'quarters' }, confidence: 'high' })
    },

    // ── TRIM ───────────────────────────────────────────────────────────────
    {
        regex: /^(?:trim|cut|shorten)\s+(?:to\s+)?(\d+(?:\.\d+)?)\s*(?:s(?:ec(?:ond)?s?)?)/i,
        intent: (m) => ({ type: 'edit', action: 'trim_clip', constraints: { targetDuration: parseFloat(m[1]), from: 'end' }, confidence: 'high' })
    },

    {
        regex: /^(?:trim|cut|remove|chop|shorten)\s+(?:the\s+)?(?:first|start|beginning)\s+(\d+(?:\.\d+)?)\s*(?:s(?:ec)?s?)?/i,
        intent: (m) => ({ type: 'edit', action: 'trim_clip', constraints: { duration: parseFloat(m[1]), from: 'start' }, confidence: 'high' })
    },

    {
        regex: /^(?:trim|cut|remove|chop)\s+(?:the\s+)?(?:last|end|ending)\s+(\d+(?:\.\d+)?)\s*(?:s(?:ec)?s?)?/i,
        intent: (m) => ({ type: 'edit', action: 'trim_clip', constraints: { duration: parseFloat(m[1]), from: 'end' }, confidence: 'high' })
    },

    {
        regex: /^(?:trim|shorten|make\s+(?:it\s+)?shorter)(?:\s+(?:by\s+)?(\d+(?:\.\d+)?)\s*s(?:ec)?s?)?$/i,
        intent: (m) => ({ type: 'edit', action: 'trim_clip', constraints: { duration: m[1] ? parseFloat(m[1]) : null, from: 'end' }, confidence: m[1] ? 'high' : 'medium' })
    },

    {
        regex: /^(?:trim|cut|remove)\s+(?:from\s+)?(\d{1,2}:\d{2})\s+(?:to|-)\s+(\d{1,2}:\d{2})/i,
        intent: (m) => {
            const parseTC = (tc) => { const [a, b] = tc.split(':').map(Number); return a * 60 + b; };
            return { type: 'cut', action: 'cut_segment', constraints: { start: parseTC(m[1]), end: parseTC(m[2]) }, confidence: 'high' };
        }
    },

    // ── SILENCE REMOVAL ────────────────────────────────────────────────────
    {
        regex: /^(?:remove|delete|cut|eliminate|clean)\s+(?:the\s+)?(?:silence|silences|dead\s+air|pauses?|gaps?|quiet\s+parts?)(?:\s+.*)?$/i,
        intent: () => ({ type: 'edit', action: 'silence_removal', constraints: { threshold: '-30dB' }, confidence: 'high' })
    },

    {
        regex: /^(?:auto[\s-]?trim|tighten\s+(?:the\s+)?(?:audio|video|clip)|clean\s+up\s+(?:the\s+)?audio)$/i,
        intent: () => ({ type: 'edit', action: 'silence_removal', constraints: { threshold: '-30dB' }, confidence: 'high' })
    },

    // ── SILENCE REMOVAL — French ───────────────────────────────────────────
    // "retire les parties où le son est trop bas", "supprimer les silences", etc.
    {
        regex: /(?:retir|supprim|enlev|couper?)(?:\w+\s+)*(?:silence|silences|pauses?|parties?\s+silencieuses?)/i,
        intent: () => ({ type: 'edit', action: 'silence_removal', constraints: { threshold: '-30dB' }, confidence: 'high' })
    },
    {
        regex: /(?:son|audio|volume)\s+trop\s+bas|parties?\s+(?:où\s+le\s+son|silencieuses?)/i,
        intent: () => ({ type: 'edit', action: 'silence_removal', constraints: { threshold: '-20dB' }, confidence: 'high' })
    },

    {
        regex: /^(?:remove|cut|strip)\s+(?:filler|um+s?|uh+s?|erm+s?|like+s?)\s*(?:words?)?$/i,
        intent: () => ({ type: 'edit', action: 'remove_filler_words', confidence: 'high' })
    },

    // ── SPEED ──────────────────────────────────────────────────────────────
    {
        regex: /^(?:speed\s+up|make\s+(?:it\s+)?faster?)\s*(?:(?:by\s+)?(\d+(?:\.\d+)?)x?)?$/i,
        intent: (m) => ({ type: 'edit', action: 'set_clip_speed', constraints: { speed: m[1] ? parseFloat(m[1]) : 2.0 }, confidence: 'high' })
    },

    {
        regex: /^(?:slow\s+(?:it\s+)?down|make\s+(?:it\s+)?slower)\s*(?:(?:by\s+)?(\d+(?:\.\d+)?)x?)?$/i,
        intent: (m) => ({ type: 'edit', action: 'set_clip_speed', constraints: { speed: m[1] ? 1 / parseFloat(m[1]) : 0.5 }, confidence: 'high' })
    },

    {
        regex: /^(?:set\s+)?(?:speed\s+(?:to\s+)?|play(?:back)?\s+(?:at\s+)?)(\d+(?:\.\d+)?)x?$/i,
        intent: (m) => ({ type: 'edit', action: 'set_clip_speed', constraints: { speed: parseFloat(m[1]) }, confidence: 'high' })
    },

    {
        regex: /^(?:slow[\s-]?motion|slo[\s-]?mo)$/i,
        intent: () => ({ type: 'edit', action: 'set_clip_speed', constraints: { speed: 0.5 }, confidence: 'high' })
    },

    {
        regex: /^(?:timelapse|time[\s-]?lapse)$/i,
        intent: () => ({ type: 'edit', action: 'set_clip_speed', constraints: { speed: 4.0 }, confidence: 'high' })
    },

    // ── ASPECT RATIO ───────────────────────────────────────────────────────
    {
        regex: /^(?:change|set|convert|make|switch)\s+(?:to\s+)?(?:vertical|portrait|9:16|tiktok|reels?|shorts?)(?:\s+(?:format|mode|view))?$/i,
        intent: () => ({ type: 'edit', action: 'set_aspect_ratio', constraints: { ratio: '9:16' }, confidence: 'high' })
    },

    {
        regex: /^(?:change|set|convert|make|switch)\s+(?:to\s+)?(?:horizontal|landscape|16:9|youtube|widescreen)(?:\s+(?:format|mode|view))?$/i,
        intent: () => ({ type: 'edit', action: 'set_aspect_ratio', constraints: { ratio: '16:9' }, confidence: 'high' })
    },

    {
        regex: /^(?:change|set|convert|make|switch)\s+(?:to\s+)?(?:square|1:1|instagram)(?:\s+(?:format|mode|view))?$/i,
        intent: () => ({ type: 'edit', action: 'set_aspect_ratio', constraints: { ratio: '1:1' }, confidence: 'high' })
    },

    {
        regex: /^(?:change|set)\s+(?:aspect\s+)?ratio\s+(?:to\s+)?(\d+:\d+)/i,
        intent: (m) => ({ type: 'edit', action: 'set_aspect_ratio', constraints: { ratio: m[1] }, confidence: 'high' })
    },

    // ── REMOVE / DELETE ────────────────────────────────────────────────────
    {
        regex: /^(?:delete|remove|erase|trash|ditch|get\s+rid\s+of)\s+(?:the\s+)?(?:current\s+)?(?:clip|selection|this)$/i,
        intent: () => ({ type: 'edit', action: 'remove_clip', target: 'selected', confidence: 'high' })
    },

    // ── DUPLICATE ──────────────────────────────────────────────────────────
    {
        regex: /^(?:duplicate|copy|clone|repeat)\s+(?:the\s+)?(?:current\s+)?(?:clip|selection|this)$/i,
        intent: () => ({ type: 'edit', action: 'duplicate_clip', target: 'selected', confidence: 'high' })
    },

    // ── TRANSITIONS ────────────────────────────────────────────────────────
    {
        regex: /^add\s+(?:a\s+)?(?:(\w+)\s+)?transition(?:\s+of\s+(\d+(?:\.\d+)?)\s*s)?$/i,
        intent: (m) => ({ type: 'effect', action: 'add_transition', constraints: { type: m[1] || 'fade', duration: m[2] ? parseFloat(m[2]) : 0.5 }, confidence: 'high' })
    },

    {
        regex: /^(?:add\s+(?:a\s+)?)?(?:fade|dissolve|crossfade|cross\s*fade)(?:\s+(?:in|out|between))?$/i,
        intent: () => ({ type: 'effect', action: 'add_transition', constraints: { type: 'fade', duration: 0.5 }, confidence: 'high' })
    },

    // ── TEXT ───────────────────────────────────────────────────────────────
    {
        regex: /^add\s+(?:a\s+)?(?:text|title|caption|subtitle)[:\-\s]+["']?(.+?)["']?$/i,
        intent: (m) => ({ type: 'effect', action: 'add_text_overlay', constraints: { text: m[1].trim() }, confidence: 'high' })
    },

    // ── VOLUME ─────────────────────────────────────────────────────────────
    {
        regex: /^(?:mute|silence\s+the\s+audio|turn\s+(?:off|down)\s+(?:the\s+)?audio)$/i,
        intent: () => ({ type: 'effect', action: 'adjust_volume', constraints: { volume: 0 }, confidence: 'high' })
    },

    {
        regex: /^(?:set\s+)?volume\s+(?:to\s+)?(\d+)\s*%$/i,
        intent: (m) => ({ type: 'effect', action: 'adjust_volume', constraints: { volume: parseInt(m[1]) / 100 }, confidence: 'high' })
    },

    {
        regex: /^(?:make\s+(?:it\s+)?)?(?:louder|turn\s+up|boost\s+(?:the\s+)?audio|increase\s+volume)(?:\s+(\d+)%)?$/i,
        intent: (m) => ({ type: 'effect', action: 'adjust_volume', constraints: { volume: m[1] ? parseInt(m[1]) / 100 : 1.5 }, confidence: 'high' })
    },

    {
        regex: /^(?:make\s+(?:it\s+)?)?(?:quieter|turn\s+down|lower\s+(?:the\s+)?(?:audio|volume)|decrease\s+volume)(?:\s+(\d+)%)?$/i,
        intent: (m) => ({ type: 'effect', action: 'adjust_volume', constraints: { volume: m[1] ? parseInt(m[1]) / 100 : 0.5 }, confidence: 'high' })
    },

    // ── FILTER / COLOR ─────────────────────────────────────────────────────
    {
        regex: /^(?:make\s+(?:it\s+)?|convert\s+(?:to\s+)?)(?:black\s+and\s+white|b\s*&\s*w|grayscale|desaturate)$/i,
        intent: () => ({ type: 'effect', action: 'add_filter', constraints: { filterType: 'grayscale', intensity: 1 }, confidence: 'high' })
    },

    {
        regex: /^(?:add\s+)?(?:a\s+)?(?:blur|gaussian\s+blur)(?:\s+effect)?$/i,
        intent: () => ({ type: 'effect', action: 'add_filter', constraints: { filterType: 'blur', intensity: 0.5 }, confidence: 'high' })
    },

    {
        regex: /^(?:add\s+)?(?:a\s+)?(?:sepia|vintage)(?:\s+(?:filter|effect|look|tone))?$/i,
        intent: () => ({ type: 'effect', action: 'add_filter', constraints: { filterType: 'sepia', intensity: 0.8 }, confidence: 'high' })
    },

    // ── EXPORT ─────────────────────────────────────────────────────────────
    {
        regex: /^(?:export|render|save|finish|download|output)(?:\s+(?:as|to)\s+(\w+))?(?:\s+(?:in\s+)?(\d+p|4k))?$/i,
        intent: (m) => ({
            type: 'export', action: 'export_video',
            constraints: { format: m[1] || 'mp4', quality: m[2] || '1080p' },
            confidence: 'high'
        })
    },

    // ── NLE EXPORT ─────────────────────────────────────────────────────────
    {
        regex: /^export\s+(?:for|to)\s+premiere(?:\s+pro)?$/i,
        intent: () => ({ type: 'export', action: 'nle_export', constraints: { nleTarget: 'premiere' }, confidence: 'high' })
    },

    {
        regex: /^export\s+(?:for|to)\s+(?:final\s+cut(?:\s+pro)?|fcpx)$/i,
        intent: () => ({ type: 'export', action: 'nle_export', constraints: { nleTarget: 'finalcut' }, confidence: 'high' })
    },

    {
        regex: /^export\s+(?:for|to)\s+(?:davinci(?:\s+resolve)?|resolve)$/i,
        intent: () => ({ type: 'export', action: 'nle_export', constraints: { nleTarget: 'davinci' }, confidence: 'high' })
    },

    {
        regex: /^export\s+(?:for|to)\s+capcut$/i,
        intent: () => ({ type: 'export', action: 'nle_export', constraints: { nleTarget: 'capcut' }, confidence: 'high' })
    },

    // ── UNDO / REDO ────────────────────────────────────────────────────────
    {
        regex: /^(?:undo|go\s+back|revert|undo\s+(?:that|last|action)|take\s+that\s+back)$/i,
        intent: () => ({ type: 'undo', action: 'undo_action', confidence: 'high' })
    },

    {
        regex: /^(?:redo|redo\s+(?:that|last|action))$/i,
        intent: () => ({ type: 'redo', action: 'redo_action', confidence: 'high' })
    },

    // ── DENOISE / NORMALIZE ────────────────────────────────────────────────
    {
        regex: /^(?:remove|reduce|clean|eliminate|fix)\s+(?:the\s+)?(?:background\s+)?(?:noise|hiss|hum|buzz)$/i,
        intent: () => ({ type: 'audio', action: 'denoise_audio', confidence: 'medium' })
    },

    {
        regex: /^normalize\s+(?:the\s+)?audio$/i,
        intent: () => ({ type: 'audio', action: 'normalize_audio', confidence: 'high' })
    },

    // ── APPLY PRESET ───────────────────────────────────────────────────────
    {
        regex: /^(?:apply|use)\s+(?:the\s+)?["']?(.+?)["']?\s+(?:preset|filter|look|style)$/i,
        intent: (m) => ({ type: 'effect', action: 'apply_preset', constraints: { presetName: m[1].trim().toLowerCase() }, confidence: 'medium' })
    },
];

class FallbackParserClass {
    constructor() {
        this.patterns = [...PATTERNS];
        this.parseHistory = [];
        this.maxHistory = 50;
    }

    parse(prompt) {
        const trimmed = prompt.trim();

        for (const pattern of this.patterns) {
            const match = trimmed.match(pattern.regex);
            if (match) {
                const intent = pattern.intent(match);
                const result = {
                    ...intent,
                    originalPrompt: trimmed,
                    parsedBy: 'fallback',
                    timestamp: Date.now()
                };

                this.recordParse(result);
                EventBus.emit(EVENT_TYPES.FALLBACK_USED, { prompt: trimmed, intent: result });
                console.log(`[FallbackParser] Matched: "${trimmed}" → ${intent.action}`);
                return result;
            }
        }

        console.log(`[FallbackParser] No match for: "${trimmed}"`);
        this.recordParse({ originalPrompt: trimmed, parsedBy: 'fallback', matched: false, timestamp: Date.now() });
        return null;
    }

    canParse(prompt) {
        return this.patterns.some(p => p.regex.test(prompt.trim()));
    }

    recordParse(result) {
        this.parseHistory.push(result);
        if (this.parseHistory.length > this.maxHistory) this.parseHistory.shift();
    }

    addPattern(regex, intentFn) {
        this.patterns.unshift({ regex, intent: intentFn });
        console.log(`[FallbackParser] Added pattern: ${regex}`);
    }

    getSupportedCommands() {
        return [
            'split in half',
            'split at 30s',
            'cut to 60 seconds',
            'trim the first 5 seconds',
            'trim the last 10 seconds',
            'remove silence',
            'remove filler words',
            'speed up 2x',
            'slow down',
            'slow motion',
            'make it vertical',
            'make it horizontal',
            '9:16',
            'change ratio to 16:9',
            'delete clip',
            'duplicate clip',
            'add text: Hello World',
            'make it louder',
            'mute audio',
            'volume 50%',
            'add a fade',
            'black and white',
            'blur',
            'export',
            'export for Premiere',
            'export for Final Cut',
            'export for DaVinci',
            'export for CapCut',
            'undo',
            'redo',
            'normalize audio',
            'remove noise',
            'timelapse',
        ];
    }

    getHistory() { return [...this.parseHistory]; }
    getPatternCount() { return this.patterns.length; }
}

export const FallbackParser = new FallbackParserClass();
export default FallbackParser;