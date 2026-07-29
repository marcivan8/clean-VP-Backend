/**
 * client/src/agent/CommandRegistry.js
 *
 * SINGLE SOURCE OF TRUTH for what the assistant can do.
 *
 * WHY THIS EXISTS
 * ---------------
 * Adding a command used to mean editing five files (EXT1 in CLAUDE.md):
 * IntentParser, FallbackParser, EditPlanner, CommandCompiler, VideoEditorTools.
 * Vocabulary lived in several hand-maintained keyword lists with no way to see
 * overlaps between them — which is how `'crop'` ended up registered as a synonym
 * for trim/shorten. Typing "crop the speaker to 200%" matched that list and ran
 * SILENCE REMOVAL: not a model hallucination, a vocabulary collision plus a
 * missing command (no spatial crop existed at all).
 *
 * Every command is declared ONCE here. Parsers score against `phrases`,
 * `negative` blocks a match outright, and `findCollisions()` makes overlapping
 * vocabulary a detectable error instead of a silent mis-route.
 *
 * ATOMIC BY DEFAULT
 * -----------------
 * Commands do ONE thing so they can be chained and re-run individually.
 * Multi-stage flows are declared as `macro: [ ...ids ]` — a macro is only ever
 * sugar for running atomic steps in order, never a hidden fourth behaviour.
 *
 * ADDING A COMMAND
 *   1. Add an entry here (id, phrases, params, category)
 *   2. Implement the case in MediaExecutionEngine (or point `store` at an
 *      existing store action)
 *   3. Run `node scripts/test_command_registry.js` — it fails on collisions
 *      and on entries with no executor.
 */

/** @typedef {'edit'|'analysis'|'transform'|'audio'|'text'|'asset'|'timeline'|'export'|'macro'} CommandCategory */

/**
 * Param types the parser knows how to extract from free text.
 *  percent  — "200%", "to 150 percent"        → number (1.0 = 100%)
 *  seconds  — "3s", "2.5 seconds"             → number
 *  speaker  — "speaker 00", "the woman"       → string
 *  target   — "this clip", "all clips"        → 'clip'|'all'|'selection'
 *  text     — free text remainder
 *  enum     — one of `values`
 */

export const COMMANDS = [
    // ── Cleanup / cutting ────────────────────────────────────────────────────
    {
        id: 'silence_removal',
        category: 'edit',
        label: 'Remove silences',
        summary: 'Cuts dead air between words, keeping intentional pauses.',
        // NOTE: 'crop' deliberately NOT here — it means a spatial crop (see crop_clip).
        phrases: ['remove silence', 'remove silences', 'cut silence', 'cut the silence',
                  'remove dead air', 'trim silence', 'tighten the pauses', 'clean up the pauses',
                  'remove pauses', 'cut dead air', 'tighten up'],
        negative: ['crop', 'zoom', 'angle', 'filler'],
        destructive: true,
        requires: ['transcript'],
    },
    {
        id: 'remove_filler_words',
        category: 'edit',
        label: 'Remove filler words',
        summary: 'Cuts ums, uhs and hesitations.',
        phrases: ['remove filler', 'remove fillers', 'remove filler words', 'cut the ums',
                  'remove ums', 'remove uhs', 'cut filler', 'clean up my delivery'],
        negative: ['silence', 'crop', 'zoom'],
        destructive: true,
        requires: ['transcript'],
    },
    {
        id: 'remove_repetition',
        category: 'edit',
        label: 'Remove repetition',
        summary: 'Cuts repeated takes and restated points.',
        phrases: ['remove repetition', 'remove repeated', 'cut repeated takes',
                  'remove duplicate takes', 'cut the repeats', 'remove redundant'],
        destructive: true,
        requires: ['transcript'],
    },

    // ── Spatial transform (the family that was missing entirely) ─────────────
    {
        id: 'crop_clip',
        executes: 'crop_clip',
        category: 'transform',
        label: 'Crop / punch in',
        summary: 'Crops the frame in (spatially) on a clip, speaker or the whole timeline.',
        // The literal request that used to mis-route into silence removal.
        phrases: ['crop', 'crop to', 'punch in', 'punch in on', 'zoom in on', 'crop in on',
                  'crop the frame', 'reframe', 'blow up the shot', 'tighten the framing'],
        negative: ['silence', 'dead air', 'filler'],
        params: [
            { name: 'amount',  type: 'percent', default: 1.5, description: 'Crop strength — 200% = 2× punch in' },
            { name: 'speaker', type: 'speaker', optional: true, description: 'Only clips where this speaker talks' },
            { name: 'target',  type: 'target',  default: 'all', description: 'clip | all | selection' },
        ],
        destructive: false,
    },
    {
        id: 'reset_crop',
        executes: 'reset_crop',
        category: 'transform',
        label: 'Reset framing',
        summary: 'Clears any crop/zoom back to the full frame.',
        phrases: ['reset crop', 'remove crop', 'clear the crop', 'back to full frame',
                  'reset framing', 'undo the zoom', 'remove the zoom'],
        destructive: false,
    },

    // ── Multicam, decomposed into atomic stages ─────────────────────────────
    {
        id: 'detect_speakers',
        executes: 'detect_speakers',
        category: 'analysis',
        label: 'Detect speakers',
        summary: 'Runs diarization and stores who speaks when. Changes nothing on the timeline.',
        phrases: ['detect speakers', 'who is speaking', 'identify speakers', 'run diarization',
                  'find the speakers', 'analyze speakers'],
        destructive: false,
    },
    {
        id: 'detect_scene',
        executes: 'detect_scene',
        category: 'analysis',
        label: 'Analyse framing',
        summary: 'Vision pass: where faces are, how many people are on camera. Changes nothing.',
        phrases: ['analyze the shot', 'analyse the shot', 'detect faces', 'check the framing',
                  'analyze the framing', 'what is in the shot'],
        destructive: false,
    },
    {
        id: 'split_by_speaker',
        executes: 'split_speakers',
        category: 'edit',
        label: 'Split at speaker turns',
        summary: 'Cuts clips at speaker changes. No angles applied.',
        phrases: ['split by speaker', 'split at speaker changes', 'cut at speaker turns',
                  'split speakers', 'separate the speakers'],
        destructive: true,
        requires: ['diarization'],
    },
    {
        id: 'apply_angle',
        executes: 'apply_angle',
        category: 'transform',
        label: 'Apply camera angles',
        summary: 'Assigns wide/mid/close (or per-speaker) framing to existing clips.',
        phrases: ['apply angles', 'apply camera angles', 'add camera angles', 'assign angles',
                  'set the angles', 'interview angles'],
        params: [
            { name: 'mode', type: 'enum', values: ['auto', 'solo', 'duo'], default: 'auto' },
        ],
        destructive: false,
        requires: ['diarization'],
    },

    // ── Motion ───────────────────────────────────────────────────────────────
    {
        id: 'rhythm_zoom',
        category: 'transform',
        label: 'Add zoom rhythm',
        summary: 'Push-ins and punch-ins timed to emphasised words.',
        phrases: ['make it more dynamic', 'add dynamic zoom', 'zoom rhythm', 'add movement',
                  'make it punchy', 'add energy', 'dynamic zooms'],
        destructive: false,
        requires: ['transcript', 'multiple_clips'],
    },

    // ── Text / captions ──────────────────────────────────────────────────────
    {
        id: 'auto_captions',
        category: 'text',
        label: 'Add captions',
        summary: 'Transcribes and adds word-timed captions.',
        phrases: ['add captions', 'add subtitles', 'caption this', 'generate captions',
                  'burn in captions', 'transcribe'],
        destructive: false,
    },
    {
        id: 'add_text_overlay',
        category: 'text',
        label: 'Add text',
        summary: 'Places a text overlay on the timeline.',
        phrases: ['add text', 'add a title', 'put text on', 'add a caption that says',
                  'overlay text', 'add a headline'],
        params: [
            { name: 'content', type: 'text', description: 'The words to display' },
            { name: 'at',      type: 'seconds', optional: true },
        ],
        destructive: false,
    },

    // ── Audio ────────────────────────────────────────────────────────────────
    {
        id: 'normalize_audio',
        category: 'audio',
        label: 'Normalise audio',
        summary: 'Evens out loudness across clips.',
        phrases: ['normalize audio', 'normalise audio', 'fix the levels', 'even out the audio',
                  'balance the volume', 'make the audio consistent'],
        destructive: false,
    },
    {
        id: 'denoise_audio',
        category: 'audio',
        label: 'Reduce noise',
        summary: 'Removes background hiss and hum.',
        phrases: ['remove background noise', 'denoise', 'clean up the audio', 'reduce noise',
                  'remove the hiss', 'remove hum'],
        destructive: false,
    },
    {
        id: 'add_sfx',
        category: 'asset',
        label: 'Add a sound effect',
        summary: 'Places a sound effect from the library.',
        phrases: ['add a sound effect', 'add sfx', 'add a whoosh', 'add a riser',
                  'put a sound on', 'add an impact sound'],
        params: [{ name: 'query', type: 'text', optional: true }],
        destructive: false,
    },
    {
        id: 'adjust_volume',
        category: 'audio',
        label: 'Change volume',
        summary: 'Sets clip or track volume.',
        phrases: ['turn the volume', 'make it louder', 'make it quieter', 'lower the volume',
                  'raise the volume', 'set the volume'],
        params: [{ name: 'amount', type: 'percent', default: 1.0 }],
        destructive: false,
    },

    // ── Look ─────────────────────────────────────────────────────────────────
    {
        id: 'color_grade',
        category: 'transform',
        label: 'Colour grade',
        summary: 'Applies a colour look across clips.',
        phrases: ['color grade', 'colour grade', 'apply a look', 'make it cinematic',
                  'warm it up', 'cool it down', 'apply a lut'],
        params: [{ name: 'style', type: 'text', optional: true }],
        destructive: false,
    },

    // ── Timeline primitives (editor functions, typed) ────────────────────────
    {
        id: 'split_clip',
        category: 'timeline',
        label: 'Split at playhead',
        summary: 'Cuts the clip under the playhead in two.',
        phrases: ['split', 'split here', 'cut here', 'split at the playhead', 'razor here'],
        negative: ['speaker', 'silence'],
        destructive: true,
    },
    {
        id: 'remove_clip',
        category: 'timeline',
        label: 'Delete clip',
        summary: 'Removes the selected clip.',
        phrases: ['delete this clip', 'remove this clip', 'delete the selected clip'],
        destructive: true,
    },
    {
        id: 'set_clip_speed',
        category: 'timeline',
        label: 'Change speed',
        summary: 'Speeds up or slows down a clip.',
        phrases: ['speed up', 'slow down', 'change the speed', 'make it faster', 'make it slower',
                  'half speed', 'double speed'],
        params: [{ name: 'amount', type: 'percent', default: 1.0 }],
        destructive: false,
    },
    {
        id: 'add_transition',
        category: 'timeline',
        label: 'Add transition',
        summary: 'Adds a fade or crossfade between clips.',
        phrases: ['add a transition', 'add a fade', 'crossfade', 'fade between', 'fade out'],
        params: [
            { name: 'type',     type: 'enum', values: ['fade', 'crossfade', 'slide', 'zoom'], default: 'fade' },
            { name: 'duration', type: 'seconds', default: 1.0 },
        ],
        destructive: false,
    },
    {
        id: 'set_aspect_ratio',
        category: 'timeline',
        label: 'Change aspect ratio',
        summary: 'Reframes the project for a platform.',
        phrases: ['make it vertical', 'make it 9:16', 'make it square', 'change the aspect ratio',
                  'format for tiktok', 'format for reels', 'make it widescreen'],
        params: [{ name: 'ratio', type: 'enum', values: ['16:9', '9:16', '1:1', '4:5'], default: '9:16' }],
        destructive: false,
    },
    {
        id: 'organize_clips',
        category: 'timeline',
        label: 'Organise clips',
        summary: 'Places and orders bin clips on the timeline.',
        phrases: ['organize', 'organise', 'organize my clips', 'arrange the clips',
                  'put them in order', 'sort my clips'],
        destructive: true,
    },
    {
        id: 'undo_action',
        category: 'timeline',
        label: 'Undo',
        summary: 'Reverts the last change.',
        phrases: ['undo', 'undo that', 'revert that', 'go back'],
        destructive: false,
    },

    // ── Export ───────────────────────────────────────────────────────────────
    {
        id: 'queue_export',
        category: 'export',
        label: 'Export',
        summary: 'Renders the final video.',
        phrases: ['export', 'render', 'export for youtube', 'export for tiktok',
                  'download the video', 'render it out'],
        params: [{ name: 'platform', type: 'text', optional: true }],
        destructive: false,
    },

    // ── Macros — sugar only, expand to atomic steps ──────────────────────────
    {
        id: 'macro_multicam',
        executes: 'virtual_multicam',   // single-shot path; macro[] is the atomic expansion
        category: 'macro',
        label: 'Full multicam pass',
        summary: 'Detect speakers → analyse framing → split at turns → apply angles.',
        phrases: ['virtual multicam', 'multicam', 'multi camera', 'make it multicam',
                  'make it feel multi camera'],
        macro: ['detect_speakers', 'detect_scene', 'split_by_speaker', 'apply_angle'],
        destructive: true,
    },
    {
        id: 'macro_clean_and_polish',
        executes: 'compound_clean_dynamic',
        category: 'macro',
        label: 'Clean up and polish',
        summary: 'Remove silences → remove fillers → add zoom rhythm.',
        phrases: ['clean it up and make it dynamic', 'clean and polish', 'full cleanup'],
        macro: ['silence_removal', 'remove_filler_words', 'rhythm_zoom'],
        destructive: true,
    },
];

/** id → command */
export const COMMAND_BY_ID = Object.fromEntries(COMMANDS.map(c => [c.id, c]));

/**
 * Detect vocabulary that would make two commands ambiguous.
 * Run in tests — a collision here is exactly the `crop` bug waiting to happen.
 * @returns {Array<{phrase:string, commands:string[]}>}
 */
export function findCollisions() {
    const byPhrase = {};
    for (const c of COMMANDS) {
        for (const p of c.phrases || []) {
            const k = p.toLowerCase().trim();
            (byPhrase[k] ||= []).push(c.id);
        }
    }
    return Object.entries(byPhrase)
        .filter(([, ids]) => ids.length > 1)
        .map(([phrase, commands]) => ({ phrase, commands }));
}

/**
 * Score how well raw user text matches a command.
 * Longer phrase matches win (so "remove filler words" beats "remove"), and any
 * `negative` term vetoes the command outright — that veto is what stops "crop
 * the speaker" from ever reaching silence removal again.
 *
 * @returns {number} 0 = no match
 */
export function scoreCommand(cmd, text) {
    const raw = String(text || '').toLowerCase().trim();
    if (!raw) return 0;

    const tokens = raw.split(/[^a-z0-9%:]+/).filter(Boolean);
    // Filler words people naturally insert ("remove THE silences") — ignored when
    // matching so phrases don't have to enumerate every phrasing variant.
    const SKIP = new Set(['the', 'a', 'an', 'my', 'all', 'of', 'please', 'this', 'that', 'some', 'any']);

    for (const n of cmd.negative || []) {
        if (tokens.includes(n.toLowerCase())) return 0;
    }

    let best = 0;
    for (const p of cmd.phrases || []) {
        const pTokens = p.toLowerCase().split(/\s+/).filter(Boolean);
        // Ordered subsequence match: every phrase token appears in order,
        // with filler words allowed in between.
        let ti = 0, matched = 0;
        for (const pt of pTokens) {
            while (ti < tokens.length && tokens[ti] !== pt) {
                if (!SKIP.has(tokens[ti]) && matched > 0) { /* real word gap — still allowed */ }
                ti++;
            }
            if (ti >= tokens.length) { matched = 0; break; }
            matched++; ti++;
        }
        if (matched === pTokens.length) {
            // Longer phrases are more specific → higher score
            best = Math.max(best, p.length);
        }
    }
    return best;
}

/**
 * Rank commands for a piece of text.
 * @returns {Array<{ id:string, score:number, command:object }>} best first
 */
export function matchCommands(text, { limit = 3 } = {}) {
    return COMMANDS
        .map(c => ({ id: c.id, score: scoreCommand(c, text), command: c }))
        .filter(r => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}

/**
 * Resolve text to a single command, flagging when it's too close to call.
 * `ambiguous` is what the caller should turn into a question rather than
 * silently executing — the failure mode that ran silence removal on a crop
 * request and then reported success.
 *
 * @returns {{ match:object|null, ambiguous:boolean, alternatives:Array, confidence:'high'|'low'|'none' }}
 */
export function resolveCommand(text) {
    const ranked = matchCommands(text, { limit: 3 });
    if (ranked.length === 0) {
        return { match: null, ambiguous: false, alternatives: [], confidence: 'none' };
    }
    const [top, second] = ranked;
    // Two commands matched on phrases of near-identical length → genuinely unclear
    const tooClose = !!second && (top.score - second.score) <= 2;
    const destructive = !!top.command.destructive;
    return {
        match: top.command,
        ambiguous: tooClose && destructive,
        alternatives: ranked.slice(1).map(r => r.command),
        confidence: tooClose ? 'low' : 'high',
    };
}

/**
 * Extract structured params from free text for a command.
 *
 * Deliberately conservative: anything not confidently parsed falls back to the
 * declared default instead of guessing, so a half-understood sentence can never
 * produce a confidently wrong edit. Lives here (not in the parser) so it's
 * unit-testable without booting the store.
 *
 * @returns {Record<string, any>}
 */
export function extractParams(cmd, prompt) {
    const text = String(prompt || '').toLowerCase();
    const out = {};

    for (const p of cmd.params || []) {
        let value;

        if (p.type === 'percent') {
            const pct  = text.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)/);
            const mult = text.match(/(\d+(?:\.\d+)?)\s*x\b/);
            if (pct)       value = parseFloat(pct[1]) / 100;
            else if (mult) value = parseFloat(mult[1]);
            else if (/\bdouble\b/.test(text)) value = 2;
            else if (/\bhalf\b/.test(text))   value = 0.5;
        } else if (p.type === 'seconds') {
            const s = text.match(/(\d+(?:\.\d+)?)\s*(?:s\b|sec\b|seconds?)/);
            if (s) value = parseFloat(s[1]);
        } else if (p.type === 'speaker') {
            const m = text.match(/speaker[\s_]*(\d+)/);
            if (m) value = `SPEAKER_${m[1].padStart(2, '0')}`;
        } else if (p.type === 'target') {
            if (/\ball\b|\bevery\b|\bwhole\b/.test(text)) value = 'all';
            else if (/\bthis\b|\bselected\b|\bhere\b/.test(text)) value = 'clip';
        } else if (p.type === 'enum') {
            value = (p.values || []).find(v => text.includes(String(v).toLowerCase()));
        } else if (p.type === 'text') {
            const q = String(prompt || '').match(/["“]([^"”]+)["”]/);
            if (q) value = q[1];
        }

        if (value === undefined && p.default !== undefined) value = p.default;
        if (value !== undefined) out[p.name] = value;
    }
    return out;
}

/** Expand a macro id into its atomic step ids (non-macros return themselves). */
export function expandMacro(id) {
    const c = COMMAND_BY_ID[id];
    if (!c) return [id];
    return c.macro ? [...c.macro] : [id];
}

/** Commands grouped for UI listing ("what can I type?"). */
export function commandsByCategory() {
    return COMMANDS.reduce((acc, c) => {
        (acc[c.category] ||= []).push({ id: c.id, label: c.label, summary: c.summary });
        return acc;
    }, {});
}

export default { COMMANDS, COMMAND_BY_ID, matchCommands, resolveCommand, findCollisions, expandMacro, commandsByCategory, extractParams };
