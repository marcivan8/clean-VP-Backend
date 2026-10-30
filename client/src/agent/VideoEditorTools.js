import useTimelineStore from '../store/useTimelineStore.js';
import { performSilenceRemoval, performFillerRemoval, performAudioDenoise, performAudioNormalization, performAutoCaptions } from '../services/autoEditService.js';
import { ContentAnalyzer } from './ContentAnalyzer.js';
import { LongFormEditPlanner } from './LongFormEditPlanner.js';
import { authFetch } from '../utils/authFetch.js';
import { autoEmphasizeCaptions, clearAllEmphasis } from '../utils/captionEmphasis.js';
import { evaluateMotionCompatibility } from './AnimationCompatibilityEvaluator.js';
import { saveResumableJob, clearResumableJob, getResumableJob, remainingCommandsFrom } from './longFormJobMemory.js';
import { segmentScript } from './ScriptSegmenter.js';
import { clampToTimelineRange, wordsInTimelineRange } from '../timeline/targetRangeResolver.js';
import { mapFindingsToTimeline } from '../timeline/targetRangeResolver.js';
import { pollJobResult } from '../utils/jobPoller.js';
import { TEMPLATE_KINDS } from '../motion/TemplateGraphics.js';
import { iconFromText } from '../motion/IconLibrary.js';
import { applyPresetToClip } from '../motion/ClipAdapter.js';

/**
 * VideoEditorTools
 * Defines the available tools for the Autonomous Agent.
 * Follows the Command Pattern for Reversibility (Undo).
 *
 * FIX: longFormEdit() was generating a LongFormEditPlanner sub-plan and
 *      returning it with requiresApproval: true, but nothing in the pipeline
 *      picked up that inner plan and executed its steps. The video was left
 *      unchanged while the job reported success. Now the sub-plan is compiled
 *      and executed directly inside longFormEdit().
 */

export const TOOL_DEFINITIONS = [
    {
        name: 'locate_visual_targets',
        description: 'Search video assets in the media bin and on the timeline for a visible object, person, action, or event. Returns timestamped candidate ranges, highlights matches already on the timeline, and identifies unplaced rushes by asset name. This tool never edits the video.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'A concrete visible subject or event to find, such as a red car, a person waving, or a product being shown.' },
                assetId: { type: 'string', description: 'Optional asset ID to search instead of every video asset on the timeline.' },
            },
            required: ['query'],
        },
    },
    {
        name: 'apply_target_ranges',
        description: 'Apply an edit to reviewed visual target candidate ranges. Only call after the user explicitly confirms. Supports cutting selected matches or adding contextual B-roll inside them.',
        parameters: {
            type: 'object',
            properties: {
                targetIds: { type: 'array', items: { type: 'string' }, description: 'Candidate IDs from the visual target search. Omit to use all currently reviewed candidates.' },
                operation: { type: 'string', enum: ['cut', 'broll'], description: 'Cut the matched timeline ranges, or add contextual B-roll inside each one.' },
                confirmed: { type: 'boolean', description: 'True only when the user has explicitly confirmed applying the reviewed candidate ranges.' },
            },
            required: ['operation', 'confirmed'],
        },
    },
    // --- Editing Tools ---
    {
        name: "cut_clip",
        description: "Splits a clip into two parts at a specific time.",
        parameters: {
            type: "object",
            properties: {
                clipId: { type: "string", description: "ID of the clip to split" },
                time: { type: "number", description: "Timestamp to split at (in seconds)" },
                trackId: { type: "string", description: "ID of the track containing the clip" }
            },
            required: ["clipId", "time", "trackId"]
        }
    },
    {
        name: "remove_clip",
        description: "Removes a clip from the timeline.",
        parameters: {
            type: "object",
            properties: {
                clipId: { type: "string", description: "ID of the clip to remove" },
                trackId: { type: "string", description: "ID of the track containing the clip" }
            },
            required: ["clipId", "trackId"]
        }
    },
    {
        name: "move_clip",
        description: "Moves a clip to a new start time.",
        parameters: {
            type: "object",
            properties: {
                clipId: { type: "string", description: "ID of the clip to move" },
                trackId: { type: "string", description: "ID of the track containing the clip" },
                newStart: { type: "number", description: "New start time (in seconds)" }
            },
            required: ["clipId", "trackId", "newStart"]
        }
    },
    {
        name: "set_clip_speed",
        description: "Changes the playback speed of a clip.",
        parameters: {
            type: "object",
            properties: {
                clipId: { type: "string", description: "ID of the clip" },
                trackId: { type: "string", description: "ID of the track" },
                speed: { type: "number", description: "Playback speed (e.g., 0.5, 1.0, 2.0)" }
            },
            required: ["clipId", "trackId", "speed"]
        }
    },

    // --- AI & Audio Tools ---
    {
        name: "silence_removal",
        description: "Automatically detects and removes silent parts from the video.",
        parameters: {
            type: "object",
            properties: {
                threshold: { type: "string", description: "Silence threshold (default: -30dB)" }
            }
        }
    },
    {
        name: "remove_filler_words",
        description: "Automatically detects and removes filler words (ums, uhs) from the video.",
        parameters: { type: "object", properties: {} }
    },
    {
        name: "denoise_audio",
        description: "Removes background noise from the audio.",
        parameters: { type: "object", properties: {} }
    },
    {
        name: "normalize_audio",
        description: "Normalizes audio levels to standard loudness.",
        parameters: { type: "object", properties: {} }
    },
    {
        name: "sync_clips_to_beat",
        description: "Automatically cuts video clips at detected beat markers.",
        parameters: { type: "object", properties: {} }
    },
    {
        name: "auto_captions",
        description: "Transcribes the video to generate word-level captions and energy markers. Use this first if a transcript is required for other tools.",
        parameters: { type: "object", properties: {} }
    },

    // --- Visual & Project Tools ---
    {
        name: "set_aspect_ratio",
        description: "Changes the project aspect ratio (e.g., '16:9', '9:16', '1:1').",
        parameters: {
            type: "object",
            properties: {
                ratio: { type: "string", enum: ["16:9", "9:16", "1:1"], description: "Target aspect ratio" }
            },
            required: ["ratio"]
        }
    },
    {
        name: "color_grade_clip",
        description: "Applies a color preset or filter to a clip.",
        parameters: {
            type: "object",
            properties: {
                clipId: { type: "string", description: "ID of the clip" },
                trackId: { type: "string", description: "ID of the track" },
                preset: { type: "string", enum: ["cinematic", "vibrant", "bw", "warm", "cool"], description: "Color preset name" }
            },
            required: ["clipId", "trackId", "preset"]
        }
    },
    {
        name: "add_text_overlay",
        description: "Adds a text overlay to the timeline.",
        parameters: {
            type: "object",
            properties: {
                text: { type: "string", description: "Content of the text" },
                start: { type: "number", description: "Start time (seconds)" },
                duration: { type: "number", description: "Duration (seconds)" }
            },
            required: ["text", "start", "duration"]
        }
    },

    // --- Track Control Tools ---
    {
        name: "set_track_volume",
        description: "Sets the volume for a specific track.",
        parameters: {
            type: "object",
            properties: {
                trackId: { type: "string", description: "ID of the track" },
                volume: { type: "number", description: "Volume level (0.0 to 1.0)" }
            },
            required: ["trackId", "volume"]
        }
    },
    {
        name: "mute_track",
        description: "Mutes or unmutes a specific track.",
        parameters: {
            type: "object",
            properties: {
                trackId: { type: "string", description: "ID of the track" },
                muted: { type: "boolean", description: "True to mute, False to unmute" }
            },
            required: ["trackId", "muted"]
        }
    },

    // --- Playback Controls ---
    {
        name: "seek_to",
        description: "Moves the playhead to a specific time.",
        parameters: {
            type: "object",
            properties: {
                time: { type: "number", description: "Time in seconds" }
            },
            required: ["time"]
        }
    },
    {
        name: "undo_action",
        description: "Undoes the last action.",
        parameters: { type: "object", properties: {} }
    },

    // --- Long-Form Intelligence Engine Tools ---
    {
        name: "analyze_structure",
        description: "Analyzes video content semantically — detects content type, segments the video by topic, finds the best hook, and identifies key narrative sections (Intro, Body, Outro). Does NOT execute any edits. Returns a full content analysis for user approval.",
        parameters: {
            type: "object",
            properties: {
                platform: { type: "string", enum: ["youtube", "podcast", "tiktok", "instagram", null], description: "Target platform (affects edit mode selection)" },
                targetDuration: { type: "number", description: "Desired output duration in seconds (optional)" }
            }
        }
    },
    {
        name: "long_form_edit",
        description: "Generates and executes a complete edit plan for the current video, regardless of its duration. Uses content analysis to apply requested structure, captions, graphics, and animation. Executes all steps immediately.",
        parameters: {
            type: "object",
            properties: {
                editMode: { type: "string", enum: ["FULL_BUILD", "CLEAN_EDIT", "YOUTUBE_OPTIMIZED"], description: "Edit mode to apply" },
                platform: { type: "string", description: "Target platform" },
                targetDuration: { type: "number", description: "Desired output duration in seconds" }
            }
        }
    },
    {
        name: "reorder_segment",
        description: "Moves a clip or segment to a new position in the timeline for structural rebuilding (e.g., moving the hook to position 0).",
        parameters: {
            type: "object",
            properties: {
                clipId: { type: "string", description: "ID of the clip/placement to move" },
                trackId: { type: "string", description: "ID of the track containing the clip" },
                targetPosition: { type: "number", description: "Target start time in seconds (0 = beginning of timeline)" }
            },
            required: ["clipId", "trackId", "targetPosition"]
        }
    },

    // ── Asset Engine tools (Creative Asset Intelligence System) ────────────────
    {
        name: "search_assets",
        description: "Search the asset library (SFX, LUTs, presets) using a natural language query.",
        parameters: {
            type: "object",
            properties: {
                query:      { type: "string",  description: "Natural language search query" },
                assetTypes: { type: "array",   items: { type: "string" }, description: "Filter by asset types: SOUND_EFFECT, LUT, TEMPLATE" },
                limit:      { type: "number",  description: "Max results (default 10)" }
            },
            required: ["query"]
        }
    },
    {
        name: "search_sfx",
        description: "Search for sound effects (whoosh, impact, comedy, notification, etc.) by natural language.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "Describe the sound you need" },
                limit: { type: "number", description: "Max results (default 10)" }
            },
            required: ["query"]
        }
    },
    {
        name: "search_luts",
        description: "Search for color grade LUTs by style (cinematic, warm, cold, vintage, etc.).",
        parameters: {
            type: "object",
            properties: {
                query:         { type: "string",  description: "Style description" },
                cinematicOnly: { type: "boolean", description: "Only cinematic LUTs" },
                limit:         { type: "number",  description: "Max results (default 10)" }
            },
            required: ["query"]
        }
    },
    {
        name: "search_presets",
        description: "List or filter presets by type (COLOR_GRADE, CAPTION_STYLE, SOUND_SETTINGS, EXPORT_SETTINGS, FULL_EDIT).",
        parameters: {
            type: "object",
            properties: {
                presetType: { type: "string", description: "Preset type filter" },
                limit:      { type: "number", description: "Max results (default 10)" }
            }
        }
    },
    {
        name: "apply_lut",
        description: "Apply a color grade LUT to the project. Shows a CSS filter preview instantly; LUT is baked into export via FFmpeg.",
        parameters: {
            type: "object",
            properties: {
                lutId: { type: "string", description: "UUID of the LUT to apply" }
            },
            required: ["lutId"]
        }
    },
    {
        name: "add_template",
        description: "Add an animated graphic, vector icon/illustration, data visualization, social card, or title template at the playhead. Choose a kind from the full template catalogue. For kind 'icon', params.icon names a vector illustration and params.treatment can be solo, badge, frame, or burst.",
        parameters: { type: "object", properties: {
            kind: { type: "string", enum: TEMPLATE_KINDS },
            params: { type: "object", description: "Template-specific fields. For icon use icon (such as rocket, bulb, camera, growth, or heart), treatment (solo, badge, frame, burst), and accent. Examples: counter: label/value/total; price-pop: text/sub; quote-card: quote/attribution; icon-label: icon/text." }
        }, required: ["kind"] }
    },
    {
        name: "emphasize_keywords",
        description: "Highlight the key word of each caption (numbers, outcomes, emphatic words) in the caption style's emphasis look.",
        parameters: { type: "object", properties: { overwrite: { type: "boolean", description: "Also replace key words the user picked by hand" } } }
    },
    {
        name: "clear_keywords",
        description: "Remove key word emphasis from every caption.",
        parameters: { type: "object", properties: {} }
    },
    {
        name: "clear_lut",
        description: "Remove the current color grade LUT from the project.",
        parameters: { type: "object", properties: {} }
    },
    {
        name: "add_sfx",
        description: "Add a sound effect to the audio track at a specific timeline position.",
        parameters: {
            type: "object",
            properties: {
                sfxId:    { type: "string", description: "UUID of the SFX asset" },
                assetUrl: { type: "string", description: "Direct URL to the audio file (alternative to sfxId)" },
                atTime:   { type: "number", description: "Timeline position in seconds" },
                volume:   { type: "number", description: "Volume 0-1 (default 0.8)" },
                fadeIn:   { type: "number", description: "Fade-in duration in seconds" },
                fadeOut:  { type: "number", description: "Fade-out duration in seconds" },
                label:    { type: "string", description: "Display label" }
            }
        }
    },
    {
        name: "apply_preset",
        description: "Apply a named preset to the project. FULL_EDIT presets require approved=true (user must confirm).",
        parameters: {
            type: "object",
            properties: {
                presetId:  { type: "string",  description: "UUID of the preset" },
                projectId: { type: "string",  description: "Project ID (defaults to current project)" },
                approved:  { type: "boolean", description: "User has approved (required for FULL_EDIT presets)" }
            },
            required: ["presetId"]
        }
    },
    {
        name: "export_audio",
        description: "Export the project audio track as a standalone audio file (mp3, wav, aac, m4a). Triggers a browser download.",
        parameters: {
            type: "object",
            properties: {
                format:    { type: "string",  enum: ["mp3", "wav", "aac", "m4a"], description: "Output format" },
                bitrate:   { type: "string",  description: "Bitrate e.g. '192k' (ignored for wav)" },
                normalize: { type: "boolean", description: "Apply EBU R128 loudness normalisation" },
                trimStart: { type: "number",  description: "Start time in seconds" },
                trimEnd:   { type: "number",  description: "End time in seconds" }
            }
        }
    },
    {
        name: "recommend_sfx",
        description: "Fetch AI-recommended sound effects for the current project. Results appear in the Asset Panel.",
        parameters: {
            type: "object",
            properties: {
                limit: { type: "number", description: "Max recommendations (default 5)" }
            }
        }
    },
    {
        name: "recommend_luts",
        description: "Fetch AI-recommended LUT color grades for the current project.",
        parameters: {
            type: "object",
            properties: {
                limit: { type: "number", description: "Max recommendations (default 3)" }
            }
        }
    },
    {
        name: "recommend_presets",
        description: "Fetch AI-recommended editing presets for the current project and content type.",
        parameters: {
            type: "object",
            properties: {
                presetType: { type: "string", description: "Filter by preset type" },
                limit:      { type: "number", description: "Max recommendations (default 5)" }
            }
        }
    }
];

// ── Shared segment→clip helpers (identifyQuotableMoments, findHook, analyzeStructure) ──
//
// "find the best part"/"find the hook" used to only move the playhead and
// report a timestamp in chat, while "best moments"/"highlight reel"
// (identifyQuotableMoments) created a real clip on a new Highlights track —
// same underlying request, two different outcomes depending on phrasing.
// Both paths now go through the same two pure helpers below so they produce
// the identical real timeline edit. A third helper does the equivalent for
// analyzeStructure's chapter markers. Kept pure (no store access) so they're
// unit-testable without a live Zustand store.

/**
 * Finds the clip that covers `srcTime` in SOURCE time (clip.offset/clip.start
 * plus clip.duration), not timeline position — the same convention
 * ZoomAnalyzer and identifyQuotableMoments already rely on for
 * post-silence-removal timelines, where timeline position has drifted from
 * source position after edits.
 * @param {Array<Object>} allClips
 * @param {number} srcTime
 * @returns {Object|undefined} the covering clip, or undefined if none covers it
 */
export function findCoveringClipBySourceTime(allClips, srcTime) {
    return allClips.find(c => {
        const srcStart = c.offset ?? c.start ?? 0;
        const srcEnd = srcStart + (c.duration || 0);
        return srcTime >= srcStart && srcTime <= srcEnd;
    });
}

/**
 * Builds the clip payload for extracting a segment [segStart, segEnd) of
 * `baseClip`'s source onto a new standalone clip — a copy of baseClip's
 * media fields, retimed to start at 0 on its own track and offset into the
 * source at segStart. Caller is responsible for state.addTrack/state.addClip;
 * kept pure so it's unit-testable without a live store.
 * @param {Object} baseClip
 * @param {number} segStart
 * @param {number} segEnd
 * @param {string} name
 * @returns {Object} a clip payload ready for state.addClip(trackId, payload)
 */
export function buildHighlightClipPayload(baseClip, segStart, segEnd, name) {
    const duration = Math.max(0.1, (segEnd ?? 0) - (segStart ?? 0));
    return {
        ...baseClip,
        id: `clip_quote_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        start: 0,
        duration,
        offset: segStart ?? 0,
        name,
    };
}

/**
 * Builds real chapter-marker clip payloads from the content-analysis
 * `structure.sections` array (`server/controllers/aiAgentController.js`
 * merges GPT's semantic sections with `viralEngine/structure.js`'s heuristic
 * `detectedSections` under this one key — both share the same
 * {start,end,topic,type} shape). Marker clips carry `type:'marker'` +
 * `isChapter:true` and no media fields —
 * `server/audio-engine/timeline/TimelineEventDetector.js` already reads
 * exactly this shape (`clip.isChapter || clip.type === 'marker'`) to emit
 * CHAPTER_START events for the R68 animation/SFX intelligence layer; nothing
 * anywhere ever wrote that shape before this, so that branch was permanently
 * dead. Caller is responsible for state.addTrack/state.addClip.
 * @param {Array<{start:number,end:number,topic?:string,type?:string}>} sections
 * @returns {Array<Object>} one clip payload per section
 */
export function buildChapterMarkerPayloads(sections) {
    if (!Array.isArray(sections)) return [];
    return sections.map((section, i) => {
        const start = section?.start ?? 0;
        const end = section?.end ?? start;
        const duration = Math.max(0.1, end - start);
        const label = section?.topic || section?.type || `Chapter ${i + 1}`;
        return {
            id: `clip_chapter_${Date.now()}_${i}`,
            type: 'marker',
            isChapter: true,
            start,
            duration,
            offset: 0,
            label,
            name: `Chapter ${i + 1} — ${label}`,
        };
    });
}

// ── place_contextual_broll — matching helpers ───────────────────────────────
//
// Matches b-roll clips already on the timeline to moments in the spoken
// dialogue, using each clip's ALREADY-COMPUTED visual content profile
// (VisualAnalyzer, fetched via GET /api/brain/broll-profiles) against
// word-level transcript timestamps (state.captions). Deliberately no new
// LLM call — same "heuristic on existing signals" scope R68 established for
// AnimationKnowledgeGraph's semantic event detection, applied here to
// transcript-to-footage matching instead of transcript-to-animation timing.
// Kept as pure, unit-testable functions; only placeContextualBroll() itself
// touches the store/network.

const BROLL_STOPWORDS = new Set([
    'that', 'this', 'with', 'from', 'have', 'were', 'they', 'been', 'their',
    'what', 'when', 'where', 'which', 'about', 'would', 'could', 'should',
    'there', 'here', 'just', 'like', 'really', 'going', 'gonna', 'know',
    'thing', 'things', 'kind', 'sort', 'actually', 'basically', 'literally',
]);

const BROLL_MIN_SHARED_KEYWORDS   = 1;
const BROLL_WINDOW_SECONDS        = 6;    // sliding window of dialogue words to match against
const BROLL_DEFAULT_CUTAWAY_S     = 2.5;  // how long a cutaway stays on screen
const BROLL_MIN_SPACING_S         = 4;    // don't place two cutaways closer than this
const BROLL_COOLDOWN_S            = 12;   // don't reuse the SAME b-roll clip within this window
const BROLL_MAX_PLACEMENTS        = 8;

// A window within this many seconds of a real chapter-marker boundary
// (buildChapterMarkerPayloads' output, read back off the timeline — see
// extractChapterBoundaries below) is treated as a TOPIC TRANSITION, not just
// mid-sentence illustration. Transition matches get a scoring bonus (so a
// weaker keyword match at a real topic change can still beat a stronger one
// that isn't near one) and a longer cutaway, since a beat bridging one topic
// to the next reads better held a little longer than a quick illustrative cut.
// This never LOWERS the keyword bar below BROLL_MIN_SHARED_KEYWORDS — the
// same "don't act with false confidence" reasoning analyzeStructure's
// degraded-path already applies (R77) means proximity to a chapter boundary
// alone is never enough to justify a placement with zero real content match.
const BROLL_CHAPTER_PROXIMITY_S   = 5;
const BROLL_CHAPTER_SCORE_BONUS   = 2;
const BROLL_TRANSITION_CUTAWAY_S  = 3.5;

/**
 * Lowercases and splits free text into a keyword set — words longer than 4
 * chars, stopwords dropped. Same convention `viralEngine/structure.js`'s
 * `_inferTopic` already uses for topic inference, reused here for the
 * transcript-window <-> b-roll-profile overlap comparison.
 * @param {string} text
 * @returns {Set<string>}
 */
export function tokenizeForBrollMatch(text) {
    // R89: accents folded first, so French words ("journée", "été") are no
    // longer cut in two by the a-z split. Applied to both sides of the match.
    const folded = (text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const words = folded.split(/[^a-z0-9']+/).filter(w => w.length > 4 && !BROLL_STOPWORDS.has(w));
    return new Set(words);
}

// ─── R90 (to-do A6): beat-synced cutaways ───────────────────────────────────
// A cutaway used to start at the first word of its 6-second window, often a
// few seconds before the word it illustrates. With `wordSync`, it starts on
// the spoken word itself (a hair before, so the picture is there when the word
// lands). With `events` (reveal / punchline / emphasis moments from
// TimelineEventDetector, via the animate route), a match whose word sits on
// such a moment wins ties — never below the keyword bar, like the chapter bonus.
const BROLL_WORD_LEAD_S        = 0.08;
const BROLL_EVENT_SCORE_BONUS  = 1.5;
const BROLL_EVENT_BEFORE_S     = 0.4;   // event may land a little before the word
const BROLL_EVENT_AFTER_S      = 1.5;   // ...or shortly after it (peak after onset)

/** Events of interest for cutaways and pops. */
export const SYNC_EVENT_TYPES = ['REVEAL', 'PUNCHLINE_DETECTED', 'EMPHASIS_MOMENT'];

function eventNear(events, t) {
    if (!Array.isArray(events)) return null;
    for (const e of events) {
        const et = Number(e?.timelineTime);
        if (!Number.isFinite(et) || !SYNC_EVENT_TYPES.includes(e.eventType)) continue;
        if (et >= t - BROLL_EVENT_BEFORE_S && et <= t + BROLL_EVENT_AFTER_S) return e;
    }
    return null;
}

/**
 * Spoken numbers worth popping on screen: prices, percentages, counts with a
 * unit, and any number said on an emphasis/punchline/reveal moment.
 * Joins "15 to 20 euros" / "15 à 20 €" into one "15-20€".
 *
 * @param {Array<{word?:string,text?:string,start:number,end:number}>} words timeline time
 * @param {{events?:Array, minSpacing?:number, max?:number}} opts
 * @returns {Array<{start:number,end:number,text:string,event:string|null}>}
 */
export function findSpokenNumbers(words, opts = {}) {
    const ws = (Array.isArray(words) ? words : [])
        .map(w => ({ t: String(w?.word ?? w?.text ?? '').trim(), start: Number(w?.start), end: Number(w?.end) }))
        .filter(w => w.t && Number.isFinite(w.start));
    const CUR = { '€': '€', 'euro': '€', 'euros': '€', '$': '$', 'dollar': '$', 'dollars': '$', '£': '£', 'pound': '£', 'pounds': '£', '%': '%', 'percent': '%', 'pourcent': '%', 'pour-cent': '%' };
    const MAG = { 'k': 'K', 'mille': 'K', 'thousand': 'K', 'million': 'M', 'millions': 'M', 'm': 'M', 'billion': 'B', 'milliards': 'B', 'milliard': 'B' };
    const RANGE = new Set(['to', 'a', 'à', '-', 'et', 'and', 'or', 'ou']);
    const clean = (t) => t.toLowerCase().replace(/[.,!?;:"«»()]+$/g, '').replace(/^[("«]+/, '');
    const numOf = (t) => {
        const m = clean(t).match(/^([$€£]?)(\d[\d\s.,]*)(k|m|%|€|\$|£)?$/i);
        return m ? { pre: m[1] || '', n: m[2].replace(/[.,]$/, ''), post: (m[3] || '').toLowerCase() } : null;
    };
    const out = [];
    for (let i = 0; i < ws.length; i++) {
        const a = numOf(ws[i].t);
        if (!a) continue;
        let text = `${a.pre}${a.n}`;
        let unit = a.post === 'k' ? 'K' : a.post === 'm' ? 'M' : (a.post || a.pre || '');
        let end = ws[i].end;
        let j = i + 1;
        // Range: "15 to 20", "15-20"
        if (j + 1 < ws.length && RANGE.has(clean(ws[j].t)) && numOf(ws[j + 1].t) && ws[j + 1].start - ws[i].end < 1) {
            const b = numOf(ws[j + 1].t);
            text = `${text}-${b.n}`;
            unit = unit || (b.post === 'k' ? 'K' : b.post === 'm' ? 'M' : (b.post || b.pre || ''));
            end = ws[j + 1].end;
            j += 2;
        }
        // Following unit words: "euros", "percent", "thousand"
        for (let k = 0; k < 2 && j < ws.length && ws[j].start - end < 0.8; k++) {
            const w = clean(ws[j].t);
            if (MAG[w] && !/[KMB]$/.test(text)) { text += MAG[w]; end = ws[j].end; j++; continue; }
            if (CUR[w]) { unit = CUR[w]; end = ws[j].end; j++; continue; }
            break;
        }
        if (unit && !text.startsWith(unit) && !text.endsWith(unit)) text = ['$', '£'].includes(unit) ? `${unit}${text}` : `${text}${unit}`;
        const value = Number(String(a.n).replace(/[\s,]/g, ''));
        const ev = eventNear(opts.events, ws[i].start);
        const meaningful = !!unit || /[KMB]$/.test(text) || text.includes('-') || (Number.isFinite(value) && value >= 10 && !!ev);
        if (meaningful) out.push({ start: ws[i].start, end, text: text.replace(/\s+/g, ''), event: ev?.eventType || null });
        i = j - 1;
    }
    // Spacing: keep the strongest of any cluster (event first, then order).
    const minSpacing = Number(opts.minSpacing) > 0 ? Number(opts.minSpacing) : 4;
    const max = Number(opts.max) > 0 ? Number(opts.max) : 6;
    const picked = [];
    for (const n of [...out].sort((x, y) => (y.event ? 1 : 0) - (x.event ? 1 : 0) || x.start - y.start)) {
        if (picked.every(p => Math.abs(p.start - n.start) >= minSpacing)) picked.push(n);
        if (picked.length >= max) break;
    }
    return picked.sort((x, y) => x.start - y.start);
}

/**
 * Builds the keyword-tagged candidate list: b-roll profiles (from
 * GET /api/brain/broll-profiles) cross-referenced against assets ACTUALLY
 * present in the media bin (`state.assets`) — nothing can be cut to if it
 * was never imported at all. Deliberately checks the BIN, not the timeline:
 * `IDELayout.jsx`'s upload flow calls `addAssets(processedAssets)`
 * unconditionally for every uploaded file, but only auto-places a clip on
 * the timeline when exactly one file was uploaded — a multi-file upload (the
 * user's own vlog example: interview + walking/equipment/project shots
 * dropped in together) leaves every asset but the first sitting in the bin,
 * analysed and ready, with no clip anywhere yet. Checking `state.tracks`
 * here (as this used to) silently excluded all of them. `addOverlayClip`
 * itself never required a pre-existing clip — it builds the overlay clip
 * straight from the asset's own url/thumbnail/duration — so this was an
 * artificial restriction, not a real one. Profiles flagged `hasMainSpeaker`
 * are excluded outright (never cut TO the interview subject as a "cutaway"
 * from himself); everything else is treated as a broll candidate rather
 * than requiring `isBroll === true` specifically, since that field isn't
 * guaranteed populated on every asset.
 * @param {Array<Object>} profiles — from GET /api/brain/broll-profiles
 * @param {Array<Object>} assets — state.assets (the full media bin, placed or not)
 * @returns {Array<{assetId:string,name:string|null,keywords:Set<string>}>}
 */
export function buildBrollCandidates(profiles, assets) {
    if (!Array.isArray(profiles) || profiles.length === 0) return [];
    if (!Array.isArray(assets) || assets.length === 0) return [];

    const binAssetIds = new Set();
    for (const asset of assets) {
        if (asset?.id) binAssetIds.add(asset.id);
    }

    return profiles
        .filter(p => p && p.assetId && binAssetIds.has(p.assetId))
        .filter(p => p.hasMainSpeaker !== true)
        .map(p => ({
            assetId: p.assetId,
            name: p.name || null,
            keywords: tokenizeForBrollMatch(
                [p.contentDescription, p.suggestedLabel, p.sceneType, p.locationType].filter(Boolean).join(' ')
            ),
        }))
        .filter(c => c.keywords.size > 0);
}

/**
 * Reads chapter-boundary timestamps off the timeline — clips with
 * `isChapter === true || type === 'marker'`, the exact shape
 * buildChapterMarkerPayloads() writes (R77) and TimelineEventDetector.js
 * already reads for its own CHAPTER_START event. Scans every track (chapter
 * markers live on a dedicated "Chapters" video track, but nothing here
 * assumes that name or position) so this keeps working even if that track
 * gets renamed or reordered.
 * @param {Array<Object>} tracks — state.tracks
 * @returns {number[]} sorted, de-duplicated boundary times in seconds
 */
export function extractChapterBoundaries(tracks) {
    if (!Array.isArray(tracks) || tracks.length === 0) return [];

    const boundaries = new Set();
    for (const track of tracks) {
        if (!track) continue;
        for (const clip of (track.clips || [])) {
            if (clip && (clip.isChapter === true || clip.type === 'marker') && typeof clip.start === 'number') {
                boundaries.add(clip.start);
            }
        }
    }
    return [...boundaries].sort((a, b) => a - b);
}

const CHAPTER_TITLE_CARD_DURATION_S = 2.5;
const CHAPTER_TITLE_MATCH_EPSILON_S = 0.5; // for the idempotency check below

/**
 * Like extractChapterBoundaries, but keeps each marker's own label too —
 * the "text overlay to transition to a different topic/chapter" the user
 * asked for reads that label as a title card, so it needs more than just
 * the timestamp. Reads the exact same clip shape (isChapter/type:'marker')
 * buildChapterMarkerPayloads (R77) writes.
 * @param {Array<Object>} tracks — state.tracks
 * @returns {Array<{start:number,label:string}>} sorted, de-duplicated by start (first wins)
 */
export function extractChapterMarkers(tracks) {
    if (!Array.isArray(tracks) || tracks.length === 0) return [];

    const byStart = new Map();
    for (const track of tracks) {
        if (!track) continue;
        for (const clip of (track.clips || [])) {
            if (clip && (clip.isChapter === true || clip.type === 'marker') && typeof clip.start === 'number') {
                if (!byStart.has(clip.start)) {
                    byStart.set(clip.start, { start: clip.start, label: clip.label || clip.name || 'Chapter' });
                }
            }
        }
    }
    return [...byStart.values()].sort((a, b) => a.start - b.start);
}

/**
 * Builds a text-clip payload for one chapter-boundary title card — the
 * visual counterpart to a chapter marker, since markers themselves are
 * purely structural (R77: "not a chapters UI panel") and render nothing on
 * screen. Shares the same clip fields `useTimelineStore.addTextOverlay`
 * writes (id/start/duration/name/content/position/style/type) so it renders
 * through the exact same text-clip path captions and manual text overlays
 * already use — no new rendering logic.
 * @param {{start:number,label:string}} marker — one entry from extractChapterMarkers
 * @returns {Object} clip payload ready for state.addClip(textTrackId, payload)
 */
export function buildChapterTitleCardPayload(marker) {
    return {
        id: `clip_chaptertitle_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'text',
        start: marker.start,
        duration: CHAPTER_TITLE_CARD_DURATION_S,
        name: `Chapter Title — ${marker.label}`,
        content: marker.label,
        position: 'center',
    };
}


/**
 * Slides a BROLL_WINDOW_SECONDS window over the word-level transcript,
 * tokenizes each window's text, and scores it against every candidate's
 * keyword set by shared-keyword count — the same "how many distinctive
 * words overlap" idea `viralEngine/structure.js` already uses for
 * topic-shift detection, applied here to transcript<->b-roll matching
 * instead of transcript<->transcript. Enforces a minimum spacing between
 * ANY two placements and a longer cooldown before the SAME clip can be
 * reused, so one strongly-matching b-roll clip doesn't get cut in
 * repeatedly. Windows never overlap — each is consumed once, left to right.
 *
 * `chapterBoundaries` (extractChapterBoundaries' output) makes this
 * TRANSITION-aware: a window within BROLL_CHAPTER_PROXIMITY_S of a real
 * chapter boundary gets a scoring bonus (so it can win a tie against a
 * window with a marginally stronger keyword match elsewhere) and a longer
 * cutaway — a b-roll shot bridging into the next topic reads better held a
 * beat longer than a quick mid-sentence illustration. The bonus only breaks
 * ties between otherwise-valid candidates; it never substitutes for one —
 * BROLL_MIN_SHARED_KEYWORDS is still checked against the RAW (unboosted)
 * overlap, so a chapter boundary with no matching footage nearby still gets
 * nothing placed, same as R77's "don't act with false confidence" reasoning
 * for analyzeStructure's own degraded path.
 * @param {Array<{start:number,end?:number,word?:string,text?:string}>} words — state.captions
 * @param {Array<{assetId:string,name:string|null,keywords:Set<string>}>} candidates
 * @param {number[]} [chapterBoundaries] — extractChapterBoundaries(state.tracks)
 * @returns {Array<{timelineTime:number,duration:number,assetId:string,name:string|null,matchedKeywords:string[],isChapterTransition:boolean}>}
 */
export function matchTranscriptToBroll(words, candidates, chapterBoundaries = [], opts = {}) {
    const wordSync = !!opts.wordSync;
    const events = Array.isArray(opts.events) ? opts.events : null;
    if (!Array.isArray(words) || words.length === 0) return [];
    if (!Array.isArray(candidates) || candidates.length === 0) return [];

    const boundaries = Array.isArray(chapterBoundaries) ? chapterBoundaries : [];
    const isNearChapterBoundary = (t) => boundaries.some(b => Math.abs(t - b) <= BROLL_CHAPTER_PROXIMITY_S);

    const placements = [];
    const lastPlacedAt = new Map(); // assetId -> last timelineTime it was placed at
    let lastPlacementEnd = -Infinity;

    let i = 0;
    while (i < words.length) {
        const windowStart = words[i]?.start ?? 0;
        let j = i;
        const windowWords = [];
        const windowEntries = [];
        while (j < words.length && (words[j]?.start ?? 0) < windowStart + BROLL_WINDOW_SECONDS) {
            windowWords.push(words[j]?.word || words[j]?.text || '');
            windowEntries.push(words[j]);
            j++;
        }
        if (windowWords.length === 0) { i = j + 1; continue; }

        if (windowStart >= lastPlacementEnd + BROLL_MIN_SPACING_S) {
            const windowKeywords = tokenizeForBrollMatch(windowWords.join(' '));

            if (windowKeywords.size > 0) {
                const nearBoundary = isNearChapterBoundary(windowStart);
                let best = null;
                let bestOverlap = [];
                let bestScore = -1;
                let bestAnchor = windowStart;
                let bestEvent = null;
                for (const candidate of candidates) {
                    const lastUse = lastPlacedAt.get(candidate.assetId);
                    if (lastUse !== undefined && windowStart - lastUse < BROLL_COOLDOWN_S) continue; // still cooling down

                    const shared = [...windowKeywords].filter(w => candidate.keywords.has(w));
                    if (shared.length < BROLL_MIN_SHARED_KEYWORDS) continue; // never placed on the boundary bonus alone

                    // R90: the spoken word that carries the match, and
                    // whether it sits on a reveal/punchline/emphasis moment.
                    let anchor = null;
                    if (wordSync || events) {
                        const sharedSet = new Set(shared);
                        anchor = windowEntries.find(w => [...tokenizeForBrollMatch(w?.word || w?.text || '')].some(k => sharedSet.has(k))) || null;
                    }
                    const anchorTime = Number.isFinite(Number(anchor?.start)) ? Number(anchor.start) : windowStart;
                    const ev = events ? eventNear(events, anchorTime) : null;

                    const score = shared.length + (nearBoundary ? BROLL_CHAPTER_SCORE_BONUS : 0) + (ev ? BROLL_EVENT_SCORE_BONUS : 0);
                    if (score > bestScore) {
                        best = candidate;
                        bestOverlap = shared;
                        bestScore = score;
                        bestAnchor = anchorTime;
                        bestEvent = ev;
                    }
                }

                if (best) {
                    const duration = nearBoundary ? BROLL_TRANSITION_CUTAWAY_S : BROLL_DEFAULT_CUTAWAY_S;
                    const at = wordSync ? Math.max(windowStart, bestAnchor - BROLL_WORD_LEAD_S) : windowStart;
                    placements.push({
                        timelineTime: at,
                        duration,
                        assetId: best.assetId,
                        name: best.name,
                        matchedKeywords: bestOverlap,
                        isChapterTransition: nearBoundary,
                        ...(wordSync ? { wordTime: bestAnchor } : {}),
                        ...(bestEvent ? { event: bestEvent.eventType } : {}),
                    });
                    lastPlacedAt.set(best.assetId, at);
                    lastPlacementEnd = at + duration;
                    if (placements.length >= BROLL_MAX_PLACEMENTS) break;
                }
            }
        }

        i = j; // advance past this window — windows never overlap
    }

    return placements;
}

/**
 * R126 - pick a layout preset (R88 LAYOUT_PRESETS) for an automatically
 * placed b-roll cutaway, based on signals already available at placement
 * time (the clip's duration, whether the speaker footage it covers has
 * face-tracking data). Pure function, independently testable without
 * standing up the store.
 *
 * Returns null (no layout - the existing implicit default: the overlay
 * covers the whole frame as a plain cutaway) for anything short enough
 * that briefly hiding the speaker reads fine. Only a cutaway long enough
 * to leave the host "gone" for a while gets a layout that keeps them
 * visible - that's the actual problem the brief's "visual storytelling"
 * ask is pointing at, not a 1-2s cutaway.
 *
 * 'split' is only chosen when the covering base clip actually has
 * face-tracking data (`layerMask.bboxTrack`). applyLayout's own fallback
 * for 'split' without that data is centre-framed and not face-aware - fine
 * for a user who clicked a button and can see/undo the result, too big a
 * visual gamble to apply silently inside an automatic plan. Without face
 * data, 'pip' is the safer automatic choice: it keeps the speaker visible
 * without depending on any face detection at all.
 *
 * @param {number} duration - the overlay clip's placed duration, seconds
 * @param {boolean} hasFaceTracking - true when the covering base clip has layerMask.bboxTrack data
 * @returns {string|null} one of LAYOUT_PRESETS ('split'|'pip'), or null for "no layout"
 */
export const AUTO_LAYOUT_MIN_DURATION_S = 3.5;

export function decideAutoLayout(duration, hasFaceTracking) {
    const d = Number(duration) || 0;
    if (d < AUTO_LAYOUT_MIN_DURATION_S) return null;
    return hasFaceTracking ? 'split' : 'pip';
}

export class VideoEditorTools {
    // Always read fresh state — never cache a snapshot
    get store() {
        return useTimelineStore.getState();
    }

    // Helper: Robustly find track and clip
    resolveTrackAndClip(trackId, clipId) {
        console.log(`🔍 Resolving Track/Clip: trackId=${trackId}, clipId=${clipId}`);
        let track = this.store.tracks.find(t => t.id === trackId);
        if (!track) {
            console.log(`   Track ${trackId} not found directly. Searching by clipId...`);
            track = this.store.tracks.find(t => t.clips.some(c => c.id === clipId));
        }
        if (!track) {
            console.log(`   Track still not found. Defaulting to first video track.`);
            track = this.store.tracks.find(t => t.type === 'video');
        }

        if (!track) {
            console.error(`❌ Track Resolution Failed: Could not find track ${trackId} or any default.`);
            throw new Error(`Track ${trackId} not found.`);
        }
        console.log(`   Found Track: ${track.id} (${track.type})`);

        let clip = track.clips.find(c => c.id === clipId);

        if (!clip && track.clips.length > 0) {
            if (track.clips.length === 1) {
                console.log(`   Clip ${clipId} not found. Using the only available clip: ${track.clips[0].id}`);
                clip = track.clips[0];
            }
        }

        if (!clip) {
            console.error(`❌ Clip Resolution Failed: Could not find clip ${clipId} in track ${track.id}. Available clips:`, track.clips.map(c => c.id));
            throw new Error(`Clip ${clipId} not found.`);
        }
        console.log(`   Found Clip: ${clip.id}`);

        return { track, clip };
    }

    async execute(action) {
        console.log(`\n🔧 [VideoEditorTools] Executing Tool: ${action.name}`, JSON.stringify(action.args));

        // Helper to get main filename
        const getFilename = () => {
            const state = useTimelineStore.getState();
            if (state.uploadedFile && state.uploadedFile.name) return state.uploadedFile.name;
            const videoTrack = state.tracks.find(t => t.type === 'video');
            if (videoTrack && videoTrack.clips.length > 0) return videoTrack.clips[0].name;
            throw new Error("No file found to process.");
        };

        switch (action.name) {
            case 'locate_visual_targets': return await this.locateVisualTargets(action.args, action.signal || null);
            case 'apply_target_ranges': return await this.applyTargetRanges(action.args);
            // Editing
            case 'cut_clip': return this.cutClip(action.args);
            case 'remove_clip': return this.removeClip(action.args);
            case 'move_clip': return this.moveClip(action.args);
            case 'set_clip_speed': return this.setClipSpeed(action.args);

            // AI / Audio
            case 'silence_removal': return await performSilenceRemoval(getFilename(), action.args?.threshold);
            case 'remove_filler_words': return await performFillerRemoval(getFilename());
            case 'denoise_audio': return await performAudioDenoise(getFilename());
            case 'normalize_audio': return await performAudioNormalization(getFilename());
            case 'sync_clips_to_beat': return this.syncClipsToBeats();
            case 'auto_captions': return await performAutoCaptions(getFilename());
            case 'apply_zoom':        // alias — server fallback generates this for "zoom in/out"
            case 'apply_smart_zoom': return await this.applySmartZoom(action.args);

            // Visual / Project
            case 'set_aspect_ratio': return this.setAspectRatio(action.args);
            case 'color_grade_clip': return this.colorGradeClip(action.args);
            case 'add_text_overlay': return this.addTextOverlay(action.args);

            // Tracks
            case 'set_track_volume': return this.setTrackVolume(action.args);
            case 'mute_track': return this.muteTrack(action.args);

            // Playback
            case 'seek_to': return this.seekTo(action.args);
            case 'undo_action': return this.undo();

            // Long-Form Intelligence Engine
            case 'analyze_structure': return await this.analyzeStructure(action.args, action.signal);
            case 'long_form_edit': return await this.longFormEdit(action.args, action.signal);
            case 'resume_failed_job': return await this.resumeFailedJob();
            case 'smart_cleanup': return await this.smartCleanup(action.args, action.signal);
            case 'find_hook': return await this.findHook();
            case 'place_contextual_broll': return await this.placeContextualBroll(action.args, action.signal);
            case 'fetch_stock_broll': return await this.fetchStockBroll(action.args, action.signal);
            case 'remove_repetition': return await this.removeRepetition(action.args);
            case 'reorder_clips': return await this.reorderClips(action.args, action.signal);
            case 'reorder_segment': return this.reorderSegment(action.args);
            case 'cut_segment': return this.cutSegment(action.args);
            case 'identify_quotable_moments': return await this.identifyQuotableMoments(action.args);
            case 'add_transitions_to_sections': return await this.addTransitionsToSections(action.args);
            case 'create_video_from_script': return await this.createVideoFromScript(action.args, action.signal);

            // Asset Engine — Creative Asset Intelligence System
            case 'search_assets':     return await this.searchAssets(action.args);
            case 'search_sfx':        return await this.searchSFX(action.args);
            case 'search_luts':       return await this.searchLUTs(action.args);
            case 'search_presets':    return await this.searchPresets(action.args);
            case 'apply_lut':         return await this.applyLUT(action.args);
            case 'clear_lut':         return this.clearLUT(action.args);
            case 'emphasize_keywords': return await this.emphasizeKeywords(action.args);
            case 'add_template':              return this.addTemplate(action.args);
            case 'layout_split_screen':       return this.applyLayoutPreset('split', action.args);
            case 'layout_picture_in_picture': return this.applyLayoutPreset('pip', action.args);
            case 'layout_fullscreen':         return this.applyLayoutPreset('fullscreen', action.args);
            case 'clear_keywords':     return this.clearKeywords(action.args);
            case 'add_sfx':           return this.addSFX(action.args);
            case 'apply_preset':      return await this.applyPreset(action.args);
            case 'export_audio':      return await this.exportAudio(action.args);
            case 'recommend_sfx':     return await this.recommendSFX(action.args);
            case 'recommend_luts':    return await this.recommendLUTs(action.args);
            case 'recommend_presets': return await this.recommendPresets(action.args);

            default:
                throw new Error(`Unknown tool: ${action.name}`);
        }
    }

    // --- Tool Implementations ---

    cutClip({ clipId, time, trackId }) {
        let track = this.store.tracks.find(t => t.id === trackId);

        if (!track) {
            track = this.store.tracks.find(t => t.clips.some(c => c.id === clipId));
        }

        if (!track) {
            track = this.store.tracks.find(t => t.type === 'video');
            if (track) console.warn(`Tool: Track ${trackId} not found, defaulting to ${track.id}`);
        }

        if (!track) throw new Error(`Track ${trackId} not found and no default available.`);

        let clip = track.clips.find(c => c.id === clipId);

        if (!clip) {
            console.warn(`Tool: Clip ${clipId} not found. Searching for clip at time ${time}s...`);
            clip = track.clips.find(c => time >= c.start && time < c.start + c.duration);
        }

        if (!clip) throw new Error(`Clip ${clipId} not found and no clip exists at time ${time}s.`);

        const validTime = Math.max(clip.start + 0.01, Math.min(clip.start + clip.duration - 0.01, time));
        if (time !== validTime) time = validTime;

        this.store.splitClip(track.id, clip.id, time);
        return { success: true, message: `Split clip ${clip.id} at ${time}s` };
    }

    removeClip({ clipId, trackId }) {
        try {
            const { track, clip } = this.resolveTrackAndClip(trackId, clipId);
            this.store.removeClip(track.id, clip.id);
            return { success: true, message: `Removed clip ${clip.id}` };
        } catch (e) {
            throw e;
        }
    }

    moveClip({ clipId, trackId, newStart }) {
        const { track, clip } = this.resolveTrackAndClip(trackId, clipId);
        this.store.updateClip(track.id, clip.id, { start: newStart });
        return { success: true, message: `Moved clip ${clipId} to ${newStart}s` };
    }

    setClipSpeed({ clipId, trackId, speed }) {
        const { track, clip } = this.resolveTrackAndClip(trackId, clipId);
        this.store.setClipSpeed(track.id, clip.id, speed);
        return { success: true, message: `Set clip speed to ${speed}x` };
    }

    syncClipsToBeats() {
        this.store.syncClipsToBeats();
        return { success: true, message: "Synced clips to extracted beat markers." };
    }

    setAspectRatio({ ratio }) {
        this.store.setAspectRatio(ratio);
        return { success: true, message: `Set aspect ratio to ${ratio}` };
    }

    colorGradeClip({ clipId, trackId, preset }) {
        const { track, clip } = this.resolveTrackAndClip(trackId, clipId);

        const presetMap = {
            'cinematic': { filter: 'contrast(1.2) saturate(1.1) brightness(0.9)' },
            'vibrant': { filter: 'saturate(1.5) contrast(1.1)' },
            'bw': { filter: 'grayscale(1)' },
            'warm': { filter: 'sepia(0.3)' },
            'cool': { filter: 'hue-rotate(180deg) opacity(0.9)' }
        };
        const updates = { filter: presetMap[preset]?.filter || '' };

        this.store.updateClip(track.id, clip.id, updates);
        return { success: true, message: `Applied '${preset}' look to clip.` };
    }

    addTextOverlay({ text, start, duration }) {
        this.store.addTextOverlay(text, 'center', duration || 5);
        return { success: true, message: `Added text "${text}" at ${start}s` };
    }

    setTrackVolume({ trackId, volume }) {
        let track = this.store.tracks.find(t => t.id === trackId);
        if (!track) track = this.store.tracks.find(t => t.type === 'audio');
        if (!track) track = this.store.tracks[0];

        if (track) {
            this.store.updateTrackVolume(track.id, volume);
            return { success: true, message: `Set track ${track.id} volume to ${volume}` };
        }
        throw new Error("Track not found");
    }

    muteTrack({ trackId, muted }) {
        const track = this.store.tracks.find(t => t.id === trackId);
        if (track && track.muted !== muted) {
            this.store.toggleTrackMute(trackId);
            return { success: true, message: `Set track ${trackId} mute to ${muted}` };
        }
        return { success: true, message: `Track mute unchanged.` };
    }

    seekTo({ time }) {
        this.store.seek(time);
        return { success: true, message: `Seeked to ${time}s` };
    }

    undo() {
        this.store.undo();
        return { success: true, message: "Undid last action." };
    }

    // ─── SMART ZOOM (Ken Burns / Punch-in) ───────────────────────────────────

    async applySmartZoom(args = {}) {
        try {
            console.log('[VideoEditorTools] Executing apply_smart_zoom');
            const state = useTimelineStore.getState();
            
            // Gather all video clips
            const videoTracks = state.tracks.filter(t => t.type === 'video');
            const allClips = [];
            videoTracks.forEach(t => allClips.push(...t.clips));
            
            if (allClips.length === 0) {
                return { success: false, message: 'No video clips found to apply zoom to.' };
            }
            
            // Generate zoom events using ZoomAnalyzer
            const { ZoomAnalyzer } = await import('./ZoomAnalyzer.js');
            const events = await ZoomAnalyzer.generateZoomEvents(allClips);
            
            if (!events || events.length === 0) {
                 // Was `success: true` — a command that changed nothing reporting
                 // completion. The user asked for zooms and got none; that is a
                 // failure to communicate, not a success.
                 return {
                     success: false,
                     message: 'Smart zoom analysed the timeline but found no moments worth zooming on — nothing was changed.',
                 };
            }

            // Apply keyframes via the store. Count the clips that actually
            // received one: the old message reported `allClips.length` (every
            // clip on the timeline) regardless of how many the analyzer
            // targeted, so applying 2 keyframes on a 10-clip timeline claimed
            // "Applied smart zoom effects to 10 clips".
            const touchedClipIds = new Set();
            events.forEach(ev => {
                // ev: { clipId, time, scale, easing }
                state.addTransformKeyframe(ev.clipId, 'scale', ev.time, ev.scale, ev.easing);
                if (ev.clipId) touchedClipIds.add(ev.clipId);
            });

            return {
                success: true,
                message: `Applied ${events.length} zoom keyframe(s) across ${touchedClipIds.size} of ${allClips.length} clip(s).`
            };
            
        } catch (error) {
            console.error('[VideoEditorTools] applySmartZoom error:', error);
            return { success: false, message: `Failed to apply smart zoom: ${error.message}` };
        }
    }

    // ─── QUOTABLE MOMENTS (repurposing) ───────────────────────────────────────

    /**
     * Surfaces the best standalone segments for repurposing AND actually cuts
     * them out as separate clips, instead of only recording thresholds.
     *
     * FIX: LongFormEditPlanner's identify_quotable_moments step promised "the
     *      best standalone clips for repurposing" in its own approval message,
     *      but CommandCompiler compiled it as analysis-only — it wrote a
     *      `quotable_moments_config` computed value that nothing downstream
     *      ever read (confirmed: no other reference to that key anywhere in
     *      the codebase). The moments were identified and then discarded.
     *      This method is the actual consumer: it re-derives the same
     *      candidate list from ContentAnalyzer's cached segments and lands
     *      each one as a real, independently movable/exportable clip on a
     *      dedicated "Highlights" track, leaving the main edited timeline
     *      untouched.
     */
    async identifyQuotableMoments(args = {}) {
        try {
            console.log('[VideoEditorTools] Executing identify_quotable_moments');

            const {
                min_duration: minDuration = 15,
                max_duration: maxDuration = 90,
                min_importance: minImportance = 0.6,
                max_results: maxResults = 5,
            } = args;

            let analysis = ContentAnalyzer.getCachedAnalysis();
            if (!analysis?.success || !analysis.segments?.length) {
                console.log('[VideoEditorTools] No cached analysis. Running ContentAnalyzer first...');
                analysis = await ContentAnalyzer.analyze();
            }

            if (!analysis?.success || !analysis.segments?.length) {
                return {
                    success: false,
                    message: `Could not identify quotable moments: ${analysis?.error || 'no content analysis available'}`,
                    moments: [],
                };
            }

            const state = this.store;
            const videoTracks = state.tracks.filter(t => t.type === 'video');
            const allClips = [];
            videoTracks.forEach(t => allClips.push(...t.clips));

            if (allClips.length === 0) {
                return { success: false, message: 'No video clips found to extract moments from.', moments: [] };
            }

            // Candidate segments: long enough, important enough, within bounds.
            const candidates = analysis.segments
                .filter(seg => {
                    const dur = (seg.end ?? 0) - (seg.start ?? 0);
                    return dur >= minDuration && dur <= maxDuration
                        && (seg.importance_score ?? 0) >= minImportance;
                })
                .sort((a, b) => (b.importance_score ?? 0) - (a.importance_score ?? 0))
                .slice(0, maxResults);

            if (candidates.length === 0) {
                return {
                    success: true,
                    message: `Analysed the timeline but found no segment above the importance threshold (${minImportance}) in the ${minDuration}s–${maxDuration}s range — nothing extracted.`,
                    moments: [],
                };
            }

            // Each segment's start/end are source-file timestamps. Find which
            // base clip covers each one via source-time (offset), matching the
            // convention ZoomAnalyzer already relies on for post-silence-removal
            // timelines — clip.start (timeline position) is not reliable here.
            // Shared with findHook via findCoveringClipBySourceTime/
            // buildHighlightClipPayload (module-level, above this class) so
            // both "best moments" and "find the best part" phrasing produce
            // the identical real timeline edit.
            let highlightsTrackId = null;
            const moments = [];

            for (let i = 0; i < candidates.length; i++) {
                const seg = candidates[i];
                const baseClip = findCoveringClipBySourceTime(allClips, seg.start) || allClips[0];
                if (!baseClip) continue;

                if (!highlightsTrackId) {
                    highlightsTrackId = state.addTrack('video');
                }

                const label = `${Math.floor(seg.start / 60)}m${String(Math.floor(seg.start % 60)).padStart(2, '0')}s`;

                state.addClip(highlightsTrackId, buildHighlightClipPayload(
                    baseClip, seg.start, seg.end,
                    `Highlight ${i + 1} (${label}) — ${seg.topic || seg.type || 'moment'}`
                ));

                moments.push({
                    start: seg.start,
                    end: seg.end,
                    duration: seg.end - seg.start,
                    importance: seg.importance_score ?? null,
                    topic: seg.topic || null,
                    reason: seg.is_cta ? 'cta' : seg.is_question ? 'question' : (seg.type || 'value'),
                });
            }

            if (moments.length === 0) {
                return {
                    success: false,
                    message: 'Found quotable segments but none overlapped a clip on the timeline — nothing extracted.',
                    moments: [],
                };
            }

            return {
                success: true,
                message: `✓ Extracted ${moments.length} quotable moment(s) onto a new Highlights track — ready to trim, export, or repurpose individually.`,
                moments,
            };
        } catch (error) {
            console.error('[VideoEditorTools] identifyQuotableMoments error:', error);
            return { success: false, message: `Failed to identify quotable moments: ${error.message}`, moments: [] };
        }
    }

    // ── Long-Form Tool Implementations ───────────────────────────────────────

    /**
     * Run ContentAnalyzer and place real chapter markers on the timeline from
     * its detected sections, in addition to returning the analysis for chat.
     *
     * FIX: previously analysis-only — computed a segmented structure and
     * discarded it, the same "built but never wired" shape as R74's Gap 2
     * (identify_quotable_moments) before it was fixed. See the
     * buildChapterMarkerPayloads doc comment (module-level, above this
     * class) for why these markers are picked up automatically by the
     * existing R68 animation/SFX intelligence layer with no changes needed
     * there — it already reads exactly this clip shape.
     */
    async analyzeStructure({ platform = null, targetDuration = null } = {}, signal = null) {
        console.log('[VideoEditorTools] Running ContentAnalyzer...');
        const result = await ContentAnalyzer.analyze({ platform, targetDuration, signal });

        // ContentAnalyzer silently degrades to _localAnalysis() whenever the
        // backend call fails (401, timeout, no transcript). That fallback does
        // NOT analyse anything — it emits one placeholder segment per clip with
        // a hardcoded importance_score of 0.5, and its structure.sections is
        // never populated by a real analysis pass. Reporting "analysis
        // complete: 3 segments detected" over that is how every downstream
        // consumer (find_hook, remove_repetition, long_form_edit) inherited
        // false confidence in data that was never computed. Name it, and
        // don't place chapter markers from it either — same reasoning.
        if (result.success && result.localFallback) {
            return {
                success: true,
                degraded: true,
                message:
                    `Content analysis ran in offline fallback mode — the AI service was unreachable, ` +
                    `so segments are a rough per-clip split, not a semantic analysis. ` +
                    `Generate captions first, then re-run for a real breakdown.`,
                analysisResult: result,
                requiresApproval: true,
                chaptersCreated: 0,
            };
        }

        if (!result.success) {
            return {
                success: false,
                message: `Analysis failed: ${result.error}`,
                analysisResult: result,
                requiresApproval: true,
                chaptersCreated: 0,
            };
        }

        // `structure.sections` is what controllers/aiAgentController.js's
        // analyzeContentHandler actually merges GPT's semantic sections and
        // viralEngine/structure.js's heuristic detectedSections into (both
        // share the {start,end,topic,type} shape) — see
        // buildChapterMarkerPayloads' doc comment for the full trace.
        const sections = result.structure?.sections || [];
        let chaptersCreated = 0;

        if (sections.length > 0) {
            const state = this.store;
            const chaptersTrackId = state.addTrack('video');
            state.renameTrack(chaptersTrackId, 'Chapters');

            for (const payload of buildChapterMarkerPayloads(sections)) {
                state.addClip(chaptersTrackId, payload);
                chaptersCreated++;
            }
        }

        const segmentCount = result.segments?.length || 0;
        const message = chaptersCreated > 0
            ? `Content analysis complete: ${segmentCount} segment(s) detected, ${chaptersCreated} chapter marker(s) placed on a new Chapters track.`
            : `Content analysis complete: ${segmentCount} segment(s) detected. No distinct chapter sections found — nothing placed on the timeline.`;

        return {
            success: true,
            message,
            analysisResult: result,
            requiresApproval: false,
            chaptersCreated,
        };
    }

    /**
     * Generate a LongFormEditPlanner plan from cached ContentAnalyzer result
     * and execute all steps immediately.
     *
     * FIX: Previously returned requiresApproval: true and the inner plan, but
     *      nothing in EditJobManager or WorkflowController consumed that flag —
     *      so the video was always left unchanged. Now the sub-plan is compiled
     *      and executed directly here.
     */
    async longFormEdit({ editMode, platform, targetDuration, captionBrief = null, visualBrief = null } = {}, signal = null) {
        console.log('[VideoEditorTools] Building LongFormEditPlanner plan...');

        // Get or run content analysis — pass signal so the backend fetch is
        // cancelled if the outer 120 s tool timeout fires.
        let analysis = ContentAnalyzer.getCachedAnalysis();
        if (!analysis?.success) {
            console.log('[VideoEditorTools] No cached analysis. Running ContentAnalyzer first...');
            analysis = await ContentAnalyzer.analyze({ platform, targetDuration, signal });
        }

        // Bail out immediately if the caller timed out while we were analysing.
        if (signal?.aborted) {
            return { success: false, message: 'Cancelled (timed out during content analysis).' };
        }

        if (!analysis?.success) {
            return {
                success: false,
                message: `Content analysis failed: ${analysis?.error || 'unknown error'}`,
            };
        }

        // Override editMode if specified
        if (editMode) {
            analysis = { ...analysis, editMode };
        }

        // Generate the atomic step plan
        // R124: captionBrief threaded from IntentParser's validateAndNormalize
        // (via CaptionBriefParser) through EditPlanner → CommandCompiler → here.
        const plan = LongFormEditPlanner.generatePlan(analysis, { platform, targetDuration, captionBrief, visualBrief });

        if (!plan || plan.error) {
            return {
                success: false,
                message: plan?.error || 'Complete edit plan generation failed.',
                editPlan: plan,
            };
        }

        if (!plan.steps || plan.steps.length === 0) {
            return {
                success: true,
                message: '✓ No steps to execute for this edit mode.',
                editPlan: plan,
            };
        }

        console.log(`[VideoEditorTools] Executing complete edit plan: ${plan.step_count} steps`);

        // Dynamically import to avoid circular dependency issues at module load time
        const { CommandCompiler } = await import('./CommandCompiler.js');
        const { mediaExecutionEngine } = await import('./MediaExecutionEngine.js');

        const compileResult = CommandCompiler.compile(plan, useTimelineStore.getState());

        if (!compileResult.success && compileResult.commands.length === 0) {
            return {
                success: false,
                message: compileResult.error || 'Could not compile complete edit commands.',
                editPlan: plan,
            };
        }

        // Guard again — compilation can be slow on large plans.
        if (signal?.aborted) {
            return { success: false, message: 'Cancelled (timed out during plan compilation).' };
        }

        console.log(`[VideoEditorTools] Compiled ${compileResult.commands.length} commands — executing...`);

        // Pass signal into the inner execution so its poller is cancelled when
        // the outer 120 s timeout fires — prevents ghost _applySegmentsToTimeline
        // calls on an already-abandoned job.
        const executionResult = await mediaExecutionEngine.execute(compileResult.commands, null, signal);

        // R131 — "the brain loses the flow after each task done": a failed
        // long-form edit used to vanish completely — nothing recorded which
        // steps never applied, so "continue" had nothing to continue. On
        // success, clear any earlier failure for this project (a user who
        // redid the whole edit manually shouldn't have a stale "continue"
        // offer sitting around); on failure, save exactly the commands that
        // never successfully ran so resumeFailedJob() can hand them straight
        // back to the execution engine without re-planning from scratch.
        const state = this.store;
        if (executionResult.success) {
            clearResumableJob(state.projectId);
        } else {
            const remaining = remainingCommandsFrom(compileResult.commands, executionResult.results);
            saveResumableJob({
                projectId: state.projectId,
                planId: plan.plan_id,
                remainingCommands: remaining,
                failedMessage: executionResult.error,
                totalSteps: plan.step_count,
            });
        }

        return {
            success: executionResult.success,
            message: executionResult.success
                ? `✓ Complete edit applied — ${plan.step_count} steps completed.`
                : `Complete edit failed: ${executionResult.error} — say "continue" to pick up where it stopped.`,
            editPlan: plan,
            results: executionResult.results,
        };
    }

    /**
     * R131 — "continue" / "try again" / "resume the edit". Hands the exact
     * remaining compiled commands from the last failed/incomplete job
     * straight back to MediaExecutionEngine — no re-analysis, no
     * re-planning, no re-running of whatever already succeeded. If this
     * attempt still doesn't fully clear, the newly-remaining subset is
     * saved again so the user can say "continue" a second time.
     *
     * Known limitation (first slice, documented rather than engineered
     * around): the saved commands reference clip/track ids from the
     * timeline state at the time of the original failure. If the user
     * undid or otherwise changed the timeline before asking to continue,
     * some commands may now target something that moved or no longer
     * exists — the same risk as manually re-running any edit after
     * changing your mind about part of it in between.
     */
    async resumeFailedJob() {
        try {
            const state = this.store;
            const record = getResumableJob(state.projectId);
            if (!record) {
                return {
                    success: false,
                    message: 'There is nothing to continue — the last complete edit either finished successfully or nothing was recorded.',
                };
            }

            const { mediaExecutionEngine } = await import('./MediaExecutionEngine.js');
            const executionResult = await mediaExecutionEngine.execute(record.remainingCommands, null, null);

            if (executionResult.success) {
                clearResumableJob(state.projectId);
                return {
                    success: true,
                    message: `✓ Continued and finished the edit — ${record.remainingCommands.length} remaining step(s) applied.`,
                };
            }

            const stillRemaining = remainingCommandsFrom(record.remainingCommands, executionResult.results);
            if (stillRemaining.length === 0) {
                // Everything reported ran, but verifyExecution still failed the
                // job for some other reason — nothing concrete left to retry.
                clearResumableJob(state.projectId);
                return { success: false, message: `Still couldn't finish: ${executionResult.error}` };
            }
            saveResumableJob({
                projectId: state.projectId,
                planId: record.planId,
                remainingCommands: stillRemaining,
                failedMessage: executionResult.error,
                totalSteps: record.totalSteps,
            });
            return {
                success: false,
                message: `Still couldn't finish: ${executionResult.error} — ${stillRemaining.length} step(s) remain. Say "continue" again once that's fixed.`,
            };
        } catch (error) {
            console.error('[VideoEditorTools] resumeFailedJob error:', error);
            return { success: false, message: `Could not continue the edit: ${error.message}` };
        }
    }

    /**
     * Find the best hook from the cached content analysis.
     */
    async findHook() {
        let analysis = ContentAnalyzer.getCachedAnalysis();
        if (!analysis?.structure) {
            console.log('[VideoEditorTools] No cached analysis. Running ContentAnalyzer first...');
            analysis = await ContentAnalyzer.analyze();
        }

        const hook = analysis?.structure?.hookCandidate || analysis?.structure?.hook || null;

        // On the offline fallback path, `hookCandidate` is not a hook the model
        // picked — _localAnalysis() hardcodes it to the first 25 s of clip 0.
        // Announcing "Hook found at 0s–25s" for that is a confident-sounding
        // statement about an analysis that never ran.
        if (hook && analysis?.localFallback) {
            this.store.seek(hook.start);
            return {
                success: false,
                message:
                    `Couldn't analyse the content for a hook — the AI service was unreachable. ` +
                    `Playhead moved to the start of the first clip. ` +
                    `Generate captions first, then try again.`,
                hookCandidate: null,
            };
        }

        if (hook) {
            this.store.seek(hook.start);

            // Extract the hook segment onto a new Highlights track too — see
            // the module-level comment above findCoveringClipBySourceTime for
            // why. Reuses the exact same helpers identifyQuotableMoments uses
            // so both phrasings produce the identical real timeline edit.
            const state = this.store;
            const videoTracks = state.tracks.filter(t => t.type === 'video');
            const allClips = [];
            videoTracks.forEach(t => allClips.push(...t.clips));

            const baseClip = findCoveringClipBySourceTime(allClips, hook.start) || allClips[0] || null;
            let highlightClipId = null;

            if (baseClip) {
                const highlightsTrackId = state.addTrack('video');
                const label = `${Math.floor(hook.start / 60)}m${String(Math.floor(hook.start % 60)).padStart(2, '0')}s`;
                const payload = buildHighlightClipPayload(baseClip, hook.start, hook.end, `Hook (${label})`);
                highlightClipId = payload.id;
                state.addClip(highlightsTrackId, payload);
            }

            return {
                success: true,
                message: highlightClipId
                    ? `Hook found at ${hook.start.toFixed(0)}s–${hook.end.toFixed(0)}s — extracted onto a new Highlights track.`
                    : `Hook found at ${hook.start.toFixed(0)}s–${hook.end.toFixed(0)}s`,
                hookCandidate: hook,
                clipId: highlightClipId,
            };
        }

        return {
            success: false,
            message: 'No hook candidate found even after analysis.',
            hookCandidate: null,
        };
    }

    /**
     * Matches b-roll from the media BIN — video clips AND still images
     * alike, whether or not already dragged onto a track — to moments in the
     * spoken dialogue, using each one's stored visual content profile
     * (VisualAnalyzer) against word-level transcript timestamps, and is aware
     * of real chapter-marker boundaries (R77) so a match landing right at a
     * topic change gets treated as a TRANSITION cut rather than just
     * mid-sentence illustration. Places each match as a full-frame overlay
     * clip (the 'overlay' track already composites above the base track in
     * both preview and export, per R59/R60) at that exact moment — audio
     * keeps rolling from the base clip underneath while the b-roll visually
     * takes over, the standard documentary "cutaway" shape. Also places a
     * short text title card at each real chapter boundary, reusing the
     * chapter's own label — chapter markers themselves render nothing on
     * screen (R77: purely structural), so this is what actually shows a
     * transition to the next topic, the text half of "illustrate or
     * transition to a different topic/chapter".
     *
     * Deliberately does NOT call a new LLM — the matching is pure keyword
     * overlap between the transcript and data already computed by the
     * upload-time VisualAnalyzer pass (video AND, as of this feature, still
     * images — see MediaIntelligencePipeline.analyzeImageAsset()), fetched
     * fresh here since nothing client-side stores it (GET /api/brain/
     * broll-profiles is the missing read path this needed). The title cards
     * reuse the chapter labels the same GPT-4o/heuristic structure pass
     * already produced — no new generation of any kind.
     */
    async placeContextualBroll(args = {}, signal = null) {
        try {
            const state = this.store;
            const selectedRange = args.targetRange || state.selectedTimelineRange;
            const targetStart = Number(selectedRange?.start);
            const targetEnd = Number(selectedRange?.end);
            const hasTargetRange = Number.isFinite(targetStart) && Number.isFinite(targetEnd) && targetEnd > targetStart;
            const allWords = state.captions;
            const words = wordsInTimelineRange(allWords, hasTargetRange ? { start: targetStart, end: targetEnd } : null);

            if (!Array.isArray(words) || words.length === 0) {
                return {
                    success: false,
                    message: hasTargetRange
                        ? 'No transcript words fall inside the selected range, so I could not match b-roll to that part.'
                        : 'No transcript found — generate captions first, then try matching b-roll again.',
                    placements: [],
                };
            }

            const projectId = state.projectId || null;
            let profiles = [];
            // Local asset matching is optional. Unsaved projects have no
            // profile endpoint to query, and a temporary profile-service
            // failure must not block independent stock footage placement.
            if (projectId) {
                try {
                    const response = await authFetch(`/api/brain/broll-profiles?projectId=${encodeURIComponent(projectId)}`, { signal });
                    if (response.ok) profiles = (await response.json())?.profiles || [];
                    else console.warn(`[VideoEditorTools] b-roll profiles unavailable (${response.status}); trying stock footage`);
                } catch (profileError) {
                    if (signal?.aborted) throw profileError;
                    console.warn('[VideoEditorTools] b-roll profile lookup failed; trying stock footage:', profileError.message);
                }
            }

            // Checked against the media BIN, not the timeline — see
            // buildBrollCandidates' doc comment. A match can now be an asset
            // the user imported but never dragged onto a track yet.
            let candidates = buildBrollCandidates(profiles, state.assets);
            const preferredAssetIds = new Set((Array.isArray(args.preferredAssetIds) ? args.preferredAssetIds : []).filter(Boolean));
            if (preferredAssetIds.size > 0) {
                const preferred = candidates.filter(candidate => preferredAssetIds.has(candidate.assetId));
                // A visual-profile suggestion is a ranking hint, not a hard
                // dependency: if an asset was removed after analysis, keep the
                // normal transcript matcher available for the remaining bin.
                if (preferred.length > 0) candidates = preferred;
            }
            const chapterBoundaries = extractChapterBoundaries(state.tracks).filter(t =>
                !hasTargetRange || (t >= targetStart && t <= targetEnd)
            );

            if (candidates.length === 0) {
                // ADR-001 follow-up: nothing local to match against. Rather
                // than stopping here, fall back to the configured stock
                // provider — the same
                // suggest-broll pass the Asset Panel's "Suggest b-roll"
                // button runs, but auto-inserted instead of waiting for
                // manual approval (this tool only runs when the user or an
                // Auto-mode playbook explicitly asked for b-roll placement).
                const stock = await this._fetchStockBrollFallback(words, chapterBoundaries, signal, [], hasTargetRange ? { start: targetStart, end: targetEnd } : null, args.maxPlacements);
                if (stock.inserted > 0) {
                    return {
                        success: true,
                        message: `No analyzed local b-roll to match, so ${stock.inserted} cutaway(s) were pulled from ${stock.provider || 'stock footage'}${hasTargetRange ? ` for ${targetStart.toFixed(1)}–${targetEnd.toFixed(1)}s` : ''} instead.`,
                        placements: stock.placements,
                        titleCardsCreated: 0,
                        fromStock: stock.inserted,
                        provider: stock.provider,
                    };
                }
                return {
                    success: true,
                    message: `No analyzed b-roll found in the media bin to match against, and ${stock.reason || 'no stock footage could be fetched either'} — nothing placed.`,
                    placements: [],
                    titleCardsCreated: 0,
                };
            }

            // Which of those candidates are already sitting on a track, BEFORE
            // any placement below — used only to report how many were newly
            // pulled in from the bin, not to gate anything.
            const alreadyOnTimeline = new Set();
            (state.tracks || []).forEach(t => (t.clips || []).forEach(c => { if (c?.assetId) alreadyOnTimeline.add(c.assetId); }));
            // R90 (A6): `wordSync` starts each cutaway on the word it
            // illustrates; `events` favours reveal/punchline/emphasis moments;
            // `layout` ('fullscreen' | 'split' | 'pip') frames it (R88 presets).
            // R126: `autoLayout` instead decides a layout PER MATCH via
            // decideAutoLayout() (duration + face-tracking availability) —
            // used instead of `layout` when the caller wants automatic
            // variety rather than one fixed preset applied to every cutaway.
            // `layout` wins if both are set, so existing callers are unaffected.
            const baseTrackForLayout = args.autoLayout
                ? (state.tracks || []).find(t => t.type === 'video' && (t.clips || []).length > 0)
                : null;
            const hasFaceTrackingAt = (t) => {
                if (!baseTrackForLayout) return false;
                const covering = (baseTrackForLayout.clips || []).find(c => {
                    const s = Number(c.start) || 0;
                    const e = s + (Number(c.duration) || 0);
                    return t >= s && t < e;
                });
                return !!(covering?.layerMask?.bboxTrack?.length);
            };
            const matches = matchTranscriptToBroll(words, candidates, chapterBoundaries, {
                wordSync: !!args.wordSync,
                events: Array.isArray(args.events) ? args.events : null,
            });

            // A selected interval is an explicit content target. Keep generated
            // cutaways inside it even when a matcher proposes a longer hold.
            let scopedMatches = hasTargetRange ? matches.flatMap(match => {
                const interval = clampToTimelineRange(match.timelineTime, match.duration, { start: targetStart, end: targetEnd }, 0.5);
                return interval ? [{ ...match, timelineTime: interval.start, duration: interval.duration }] : [];
            }) : matches;
            const maxPlacements = Number.isFinite(Number(args.maxPlacements)) && Number(args.maxPlacements) > 0
                ? Math.min(6, Math.floor(Number(args.maxPlacements))) : Infinity;
            scopedMatches = scopedMatches.slice(0, maxPlacements);

            for (const match of scopedMatches) {
                const asset = (state.assets || []).find(a => a.id === match.assetId);
                if (!asset) continue;
                const live = useTimelineStore.getState();
                // Re-running must not stack a second copy of the same cutaway.
                const dup = (live.tracks || []).some(t => t.type === 'overlay' && (t.clips || []).some(c =>
                    c.assetId === asset.id && Math.abs((Number(c.start) || 0) - match.timelineTime) < 0.5));
                if (dup) continue;
                const duration = Math.min(match.duration, asset.duration || match.duration);
                const trackId = live.addOverlayClip(asset, {
                    start: match.timelineTime,
                    duration,
                    kind: asset.type === 'image' ? 'image' : 'video',
                    x: 50,
                    y: 50,
                    scale: 4,
                });
                const layoutToApply = args.layout
                    || (args.autoLayout ? decideAutoLayout(duration, hasFaceTrackingAt(match.timelineTime)) : null);
                if (layoutToApply && trackId) {
                    const placed = (useTimelineStore.getState().tracks.find(t => t.id === trackId)?.clips || [])
                        .find(c => c.assetId === asset.id && Math.abs((Number(c.start) || 0) - match.timelineTime) < 0.01);
                    if (placed) useTimelineStore.getState().applyLayout(trackId, placed.id, layoutToApply);
                }
            }

            // ── Chapter-transition title cards ──────────────────────────────
            // Text overlay half of "illustrate or transition to a different
            // topic/chapter" — chapter markers (R77) are purely structural and
            // render nothing on screen, so a real chapter transition currently
            // has no on-screen text at all. Idempotent: re-running this command
            // (e.g. after importing more footage) must not stack a second title
            // card on top of one already placed for the same chapter.
            let titleCardsCreated = 0;
            const chapterMarkers = extractChapterMarkers(state.tracks);
            if (chapterMarkers.length > 0) {
                const existingTextClips = [];
                (state.tracks || []).forEach(t => { if (t.type === 'text') existingTextClips.push(...(t.clips || [])); });

                const newMarkers = chapterMarkers.filter(m => !existingTextClips.some(c =>
                    typeof c.start === 'number' &&
                    Math.abs(c.start - m.start) < CHAPTER_TITLE_MATCH_EPSILON_S &&
                    c.content === m.label
                ));

                if (newMarkers.length > 0) {
                    let titleTrackId = (state.tracks || []).find(t => t.type === 'text' && t.name === 'Chapter Titles')?.id || null;
                    if (!titleTrackId) {
                        titleTrackId = state.addTrack('text');
                        state.renameTrack(titleTrackId, 'Chapter Titles');
                    }
                    for (const marker of newMarkers) {
                        state.addClip(titleTrackId, buildChapterTitleCardPayload(marker));
                        titleCardsCreated++;
                    }
                }
            }

            // Fill dialogue moments that local footage did not cover. Before
            // this pass ran only when ZERO local matches existed, so one
            // local cutaway suppressed every Vecteezy result for the rest of
            // the edit.
            const stock = await this._fetchStockBrollFallback(words, chapterBoundaries, signal, scopedMatches, hasTargetRange ? { start: targetStart, end: targetEnd } : null, Number.isFinite(maxPlacements) ? Math.max(0, maxPlacements - scopedMatches.length) : undefined);
            if (stock.inserted > 0) {
                return {
                    success: true,
                    message: `Placed ${scopedMatches.length} local b-roll cutaway(s) and ${stock.inserted} stock cutaway(s)${hasTargetRange ? ` inside ${targetStart.toFixed(1)}–${targetEnd.toFixed(1)}s` : ''}${stock.provider ? ` from ${stock.provider}` : ''}.`,
                    placements: [...scopedMatches, ...stock.placements],
                    titleCardsCreated,
                    fromStock: stock.inserted,
                    provider: stock.provider,
                };
            }

            if (scopedMatches.length === 0 && titleCardsCreated === 0) {
                return {
                    success: true,
                    message: hasTargetRange
                        ? `No b-roll matched the selected ${targetStart.toFixed(1)}–${targetEnd.toFixed(1)}s segment closely enough, and ${stock.reason || 'no stock footage could be fetched either'} — nothing placed.`
                        : `Found analyzed b-roll but none matched a moment in the dialogue closely enough, and ${stock.reason || 'no stock footage could be fetched either'} — nothing placed.`,
                    placements: [],
                    titleCardsCreated: 0,
                };
            }

            const transitionCount = scopedMatches.filter(m => m.isChapterTransition).length;
            const newlyImportedCount = scopedMatches.filter(m => !alreadyOnTimeline.has(m.assetId)).length;

            const notes = [];
            if (transitionCount > 0) notes.push(`${transitionCount} placed as chapter-transition bridges`);
            if (newlyImportedCount > 0) notes.push(`${newlyImportedCount} pulled in from the media bin`);
            if (titleCardsCreated > 0) notes.push(`${titleCardsCreated} chapter title card(s) added`);
            const notesText = notes.length > 0 ? ` (${notes.join('; ')})` : '';

            return {
                success: true,
                message: `✓ Placed ${scopedMatches.length} b-roll cutaway(s) matched to the dialogue${hasTargetRange ? ` inside ${targetStart.toFixed(1)}–${targetEnd.toFixed(1)}s` : ''}${notesText}.`,
                placements: scopedMatches,
                titleCardsCreated,
            };
        } catch (error) {
            console.error('[VideoEditorTools] placeContextualBroll error:', error);
            return { success: false, message: `Failed to place contextual b-roll: ${error.message}`, placements: [], titleCardsCreated: 0 };
        }
    }

    /**
     * Stock-footage fill for placeContextualBroll: pull context-aware
     * suggestions from the configured provider (Vecteezy or Pexels) — the
     * exact pass services/BrollSuggesterService.js runs for the Asset
     * Panel's "Suggest b-roll" button (POST /api/stock/suggest-broll) — and
     * place them directly, the same way AssetPanel.handleApproveBrollSuggestion
     * does when a person clicks Approve on a suggestion card. It is called by
     * explicit b-roll actions, style recipes, and complete-build plans; those
     * edit flows already apply automatically, so these contextual suggestions
     * are inserted directly instead of waiting for a separate approval click.
     *
     * Never throws: a missing API key, a 503 from the backend, or zero
     * results all just mean "nothing to place from stock either" — the
     * caller still reports the real reason placement failed.
     *
     * @param {Array} words transcript words (state.captions)
     * @param {Array<number>} chapterBoundaries
     * @param {AbortSignal|null} signal
     * @param {Array<Object>} [existingPlacements] local cutaways to avoid overlapping
     * @param {{start:number,end:number}|null} [targetRange] clamp placements to this timeline segment
     * @returns {Promise<{inserted:number, placements:Array, provider?:string, reason?:string}>}
     */
    async _fetchStockBrollFallback(words, chapterBoundaries, signal = null, existingPlacements = [], targetRange = null, maxSuggestions = 6) {
        try {
            const response = await authFetch('/api/stock/suggest-broll', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ words, chapters: chapterBoundaries, maxSuggestions: Math.max(0, Math.min(6, Number(maxSuggestions) || 0)) }),
                signal,
            });
            if (!response.ok) {
                if (response.status === 402) return { inserted: 0, placements: [], reason: 'stock footage is available on Creator and Pro plans' };
                if (response.status === 503) return { inserted: 0, placements: [], reason: 'stock footage search is not configured' };
                const errText = await response.text().catch(() => '');
                return { inserted: 0, placements: [], reason: `stock footage search failed (${errText || response.status})` };
            }
            const { suggestions = [], provider: responseProvider = null } = await response.json();
            if (suggestions.length === 0) {
                return { inserted: 0, placements: [], reason: 'no matching stock footage was found' };
            }

            const placements = [];
            for (const suggestion of suggestions.slice(0, Math.max(0, Number(maxSuggestions) || 0))) {
                const asset = suggestion.asset;
                if (!asset) continue;
                const live = useTimelineStore.getState();
                const proposedStart = Math.max(0, Number(suggestion.timelineTime) || 0);
                const proposedDuration = Number(suggestion.duration) > 0 ? Number(suggestion.duration) : Number(asset.duration) || 3.5;
                const interval = clampToTimelineRange(proposedStart, proposedDuration, targetRange, 0.5);
                if (!interval) continue;
                const { start, duration } = interval;
                const end = start + duration;
                const overlaps = (otherStart, otherDuration) => {
                    const otherAt = Number(otherStart) || 0;
                    const otherEnd = otherAt + (Number(otherDuration) || 0);
                    return start < otherEnd && end > otherAt;
                };
                if ((existingPlacements || []).some(p => overlaps(p.timelineTime, p.duration))) continue;
                const alreadyPlaced = (live.tracks || []).some(t => t.type === 'overlay' && (t.clips || []).some(c =>
                    c.type === 'video' && overlaps(c.start, c.duration)));
                if (alreadyPlaced) continue;
                const exists = (live.assets || []).some(a => a.id === asset.id);
                if (!exists) live.addAssets?.([asset]);
                const trackId = live.addOverlayClip(asset, {
                    scale: 4, x: 50, y: 50,
                    start,
                    duration,
                    kind: 'video',
                    transitions: suggestion.transitions,
                    behindSubject: suggestion.speakerLayout === 'behind_speaker',
                });
                if (trackId) placements.push({
                    assetId: asset.id,
                    timelineTime: start,
                    duration,
                    source: asset.provider || responseProvider || 'stock',
                });
            }
            return {
                inserted: placements.length,
                placements,
                provider: placements[0]?.source || responseProvider || null,
                reason: placements.length ? undefined : 'stock suggestions overlapped with existing cutaways',
            };
        } catch (error) {
            console.error('[VideoEditorTools] stock b-roll fallback error:', error);
            return { inserted: 0, placements: [], reason: `stock footage search failed (${error.message})` };
        }
    }

    /** Locate visible targets in timestamped frame samples and mark their timeline ranges for review. */
    async locateVisualTargets({ query, assetId } = {}, signal = null) {
        const targetQuery = String(query || '').trim();
        if (!targetQuery) return { success: false, message: 'Describe the visible object, person, or event to find.' };
        const state = this.store;
        const binVideoAssets = (state.assets || []).filter(asset =>
            asset?.id && (!asset.type || asset.type === 'video') && !asset.isProxying && asset.uploadPhase !== 'uploading'
        );
        const timelineAssetIds = [...new Set((state.tracks || [])
            .filter(t => t.type === 'video' || t.type === 'overlay')
            .flatMap(t => (t.clips || []).map(c => c.assetId).filter(Boolean)))];
        const assetIds = assetId
            ? [assetId]
            : [...new Set([...binVideoAssets.map(asset => asset.id), ...timelineAssetIds])];
        if (assetIds.length === 0) return { success: false, message: 'Add a video to the media bin before searching its visual content.' };

        const selectedRange = state.selectedTimelineRange;
        const searchableAssetIds = assetIds.slice(0, 30);
        const jobs = await Promise.all(searchableAssetIds.map(async id => {
            const asset = (state.assets || []).find(a => a.id === id);
            if (asset?.type && asset.type !== 'video') return null;
            const response = await authFetch('/api/brain/locate-target', {
                method: 'POST',
                body: JSON.stringify({ assetId: id, query: targetQuery }),
                signal,
            });
            if (!response.ok) {
                const details = await response.json().catch(() => ({}));
                throw new Error(details.error || `Could not start visual search for ${asset?.name || id} (${response.status}).`);
            }
            const { jobId } = await response.json();
            return { asset, jobId };
        }));

        const results = await Promise.all(jobs.filter(Boolean).map(async ({ asset, jobId }) => {
            const result = await pollJobResult(jobId, signal, 600_000);
            return { assetId: asset?.id || null, assetName: asset?.name || null, ...(result || {}) };
        }));
        const sourceFindings = results.flatMap(result => (result.ranges || []).map(hit => ({
            ...hit,
            assetId: result.assetId,
            assetName: result.assetName,
            label: targetQuery,
        })));
        const timelineFindings = [];
        const assetFindings = [];
        sourceFindings.forEach((finding, index) => {
            const placements = mapFindingsToTimeline([finding], state.tracks);
            if (placements.length) {
                placements.forEach((hit, placementIndex) => timelineFindings.push({
                    ...hit,
                    id: `${hit.assetId}-${hit.clipId}-${index}-${placementIndex}`,
                    query: targetQuery,
                    reviewRequired: true,
                }));
            } else {
                assetFindings.push({
                    ...finding,
                    id: `asset-${finding.assetId}-${index}`,
                    query: targetQuery,
                    reviewRequired: true,
                });
            }
        });
        if (selectedRange?.end > selectedRange?.start) {
            const scopedTimelineFindings = timelineFindings.filter(hit =>
                hit.timelineStart < selectedRange.end && hit.timelineEnd > selectedRange.start
            );
            useTimelineStore.getState().setTargetFindings(scopedTimelineFindings);
        } else {
            useTimelineStore.getState().setTargetFindings(timelineFindings);
        }
        useTimelineStore.getState().setAssetTargetFindings(assetFindings);

        const allCandidates = [
            ...timelineFindings.map(hit => ({
                id: hit.id, assetId: hit.assetId, assetName: hit.assetName,
                start: hit.timelineStart, end: hit.timelineEnd, timebase: 'timeline',
                confidence: hit.confidence, evidence: hit.evidence,
            })),
            ...assetFindings.map(hit => ({
                id: hit.id, assetId: hit.assetId, assetName: hit.assetName,
                start: hit.sourceStart, end: hit.sourceEnd, timebase: 'source',
                confidence: hit.confidence, evidence: hit.evidence,
            })),
        ];
        const describeTime = seconds => {
            const value = Math.max(0, Number(seconds) || 0);
            const minutes = Math.floor(value / 60);
            return `${String(minutes).padStart(2, '0')}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
        };
        const summary = allCandidates.slice(0, 8).map(hit =>
            `${hit.assetName || hit.assetId} at ${describeTime(hit.start)}${hit.timebase === 'timeline' ? '' : ' (source)'}`
        );

        return {
            success: true,
            message: allCandidates.length
                ? `Found ${allCandidates.length} candidate moment(s) for “${targetQuery}”${summary.length ? `: ${summary.join('; ')}` : ''}.${assetFindings.length ? ' Unplaced matches are marked on their media-bin cards.' : ''}${timelineFindings.length ? ' Timeline matches are highlighted for review.' : ''}`
                : `No confident visual matches for “${targetQuery}” were found in the sampled frames.`,
            details: {
                query: targetQuery,
                scannedAssets: results.map(r => ({ id: r.assetId, name: r.assetName, sampleInterval: r.sampleInterval })),
                candidates: allCandidates,
                note: 'Frame-sampled matches are suggestions. Review the highlighted ranges before applying edits.',
                ...(assetIds.length > searchableAssetIds.length ? { warning: 'Search is limited to the first 30 video assets per request.' } : {}),
            },
        };
    }

    async applyTargetRanges({ targetIds = null, operation, confirmed = false } = {}) {
        if (confirmed !== true) return { success: false, message: 'Review the highlighted ranges and confirm before I apply this edit.' };
        const state = useTimelineStore.getState();
        const wanted = Array.isArray(targetIds) && targetIds.length ? new Set(targetIds) : null;
        const findings = (state.targetFindings || []).filter(hit => !wanted || wanted.has(hit.id));
        if (findings.length === 0) return { success: false, message: 'There are no reviewed visual target ranges to apply. Find targets first, then select the candidate ranges.' };

        if (operation === 'cut') {
            const cutCount = state.cutTimelineRanges(findings.map(hit => [hit.timelineStart, hit.timelineEnd]));
            if (!cutCount) return { success: false, message: 'The selected target ranges no longer overlap editable video clips.' };
            const removedIds = new Set(findings.map(hit => hit.id));
            useTimelineStore.getState().setTargetFindings((state.targetFindings || []).filter(hit => !removedIds.has(hit.id)));
            return { success: true, message: `Cut ${cutCount} reviewed target range(s) in one undoable edit.`, details: { cutCount } };
        }

        if (operation === 'broll') {
            const placements = [];
            for (const hit of findings) {
                const result = await this.placeContextualBroll({
                    targetRange: { start: hit.timelineStart, end: hit.timelineEnd },
                    wordSync: true,
                });
                if (result?.placements?.length) placements.push(...result.placements);
            }
            return {
                success: placements.length > 0,
                message: placements.length
                    ? `Added ${placements.length} contextual B-roll cutaway(s) inside the reviewed target ranges.`
                    : 'No contextual B-roll matched those reviewed ranges closely enough.',
                details: { placements },
            };
        }
        return { success: false, message: 'Choose a supported target operation: cut or broll.' };
    }

    /**
     * "find stock footage of X" — fetches directly from the configured stock
     * provider (Vecteezy when enabled, otherwise Pexels; not matched
     * against existing dialogue/moments; see placeContextualBroll for that)
     * and drops the top result on a B-Roll track at the playhead.
     * @param {{query?: string}} args
     * @param {AbortSignal|null} signal
     */
    async fetchStockBroll({ query } = {}, signal = null) {
        const q = String(query || '').trim();
        if (!q) return { success: false, message: 'No search query given for stock footage.' };

        const state = this.store;
        try {
            const params = new URLSearchParams({ query: q, type: 'video', page: '1', perPage: '5' });
            const response = await authFetch(`/api/stock/search?${params.toString()}`, { signal });
            if (!response.ok) {
                if (response.status === 402) {
                    const { EventBus, EVENT_TYPES } = await import('./EventBus.js');
                    EventBus.emit(EVENT_TYPES.QUOTA_EXCEEDED, {
                        reason: 'paid_feature',
                        message: 'Stock footage is available on Creator and Pro plans.',
                        upgradeRequired: 'creator',
                    });
                    return { success: false, message: 'Stock footage is available on Creator and Pro plans. Please upgrade to unlock.' };
                }
                if (response.status === 503) {
                    return { success: false, message: 'Stock footage search is not configured on the server.' };
                }
                const errText = await response.text().catch(() => '');
                return { success: false, message: `Stock footage search failed: ${errText || response.status}` };
            }
            const data = await response.json();
            const results = data?.results || [];
            if (results.length === 0) {
                return { success: false, message: `No stock footage found for "${q}". Try a broader or different search term.` };
            }

            const asset = results[0];
            const exists = (state.assets || []).some(a => a.id === asset.id);
            if (!exists) state.addAssets?.([asset]);

            const selectedRange = state.selectedTimelineRange;
            const hasTargetRange = Number.isFinite(Number(selectedRange?.start))
                && Number.isFinite(Number(selectedRange?.end))
                && Number(selectedRange.end) > Number(selectedRange.start);
            const interval = clampToTimelineRange(
                hasTargetRange ? Number(selectedRange.start) : (Number(state.currentTime) || 0),
                Number(asset.duration) || 4,
                hasTargetRange ? selectedRange : null,
                0.5,
            );
            if (!interval) {
                return { success: false, message: 'The selected range is too short for this stock clip.' };
            }

            const trackId = state.addOverlayClip(asset, {
                scale: 4, x: 50, y: 50,
                start: interval.start,
                duration: interval.duration,
                kind: 'video',
            });

            const providerLabel = (asset.provider === 'vecteezy' || data?.provider === 'vecteezy') ? 'Vecteezy' : 'Pexels';
            const creditLabel = asset.attribution?.photographer || asset.photographer || asset.user?.name || `${providerLabel} Contributor`;

            return {
                success: !!trackId,
                message: trackId
                    ? `✓ Added stock footage for "${q}" (${providerLabel}, credit: ${creditLabel})${hasTargetRange ? ` to ${interval.start.toFixed(1)}–${(interval.start + interval.duration).toFixed(1)}s` : ''}.`
                    : `Found stock footage for "${q}" but could not place it on a track.`,
                details: { query: q, assetId: asset.id, provider: asset.provider || data?.provider || 'vecteezy', ...(hasTargetRange ? { timelineRange: [interval.start, interval.start + interval.duration] } : {}) },
            };
        } catch (error) {
            console.error('[VideoEditorTools] fetchStockBroll error:', error);
            return { success: false, message: `Failed to fetch stock footage: ${error.message}` };
        }
    }

    /**
     * Remove repetitive / low-value segments from the timeline.
     */
    async removeRepetition({ importance_threshold = 0.3 } = {}) {
        let analysis = ContentAnalyzer.getCachedAnalysis();
        if (!analysis?.segments) {
            console.log('[VideoEditorTools] No cached analysis. Running ContentAnalyzer first...');
            analysis = await ContentAnalyzer.analyze();
        }

        if (!analysis?.segments) {
            return { success: false, message: 'Content analysis failed. Cannot remove repetition.' };
        }

        // LEGACY PATH. EditPlanner.planRemoveRepetition now routes "remove
        // repetition" to `remove_repeated_takes` (embedding similarity +
        // GPT-4o arbitration via /api/ai/detect-repeated-takes), which operates
        // on transcript spans and can re-segment a single clip. This function
        // remains only for older plans and direct tool calls.
        //
        // It cannot work on _localAnalysis() output: that fallback hardcodes
        // EVERY segment to `importance_score: 0.5, type: VALUE`, so the filter
        // below matches nothing, 100% of the time. It used to return
        // `success: true` with "Removed 0 low-value segment(s)" — a command
        // reporting completion over a completely untouched timeline, which is
        // exactly how a user concludes the product doesn't work.
        if (analysis.localFallback) {
            return {
                success: false,
                message:
                    'Repetition removal needs a real content analysis, but the AI service was unreachable ' +
                    '(the offline fallback has no importance scores to work from). ' +
                    'Generate captions first, then try again.',
                removedCount: 0,
            };
        }

        const lowValueSegs = analysis.segments.filter(
            s => s.importance_score < importance_threshold || s.type === 'filler'
        );

        if (lowValueSegs.length === 0) {
            return {
                success: false,
                message: `Nothing scored below the ${importance_threshold} importance threshold — no segments were removed.`,
                removedCount: 0,
            };
        }

        let removedCount = 0;
        for (const seg of lowValueSegs) {
            try {
                this.cutSegment({ start: seg.start, end: seg.end });
                removedCount++;
            } catch (e) {
                console.warn(`[VideoEditorTools] Could not cut segment ${seg.start}–${seg.end}:`, e.message);
            }
        }

        // Every cut threw. The timeline is unchanged — say so.
        if (removedCount === 0) {
            return {
                success: false,
                message: `Found ${lowValueSegs.length} low-value segment(s) but none could be cut — the timeline is unchanged.`,
                removedCount: 0,
            };
        }

        return {
            success: true,
            message: `Removed ${removedCount} low-value segment(s).`,
            removedCount,
        };
    }

    /**
     * Move a clip to a new timeline position (for narrative reordering).
     */
    reorderSegment({ clipId, trackId, targetPosition }) {
        const store = this.store;
        useTimelineStore.getState()._saveHistory?.();

        const { track, clip } = this.resolveTrackAndClip(trackId, clipId);

        const shiftAmount = clip.duration;
        const clipsToShift = track.clips
            .filter(c => c.id !== clip.id && c.start >= targetPosition)
            .sort((a, b) => a.start - b.start);

        store.updateClip(track.id, clip.id, { start: targetPosition }, { skipHistory: true });

        clipsToShift.forEach(c => {
            store.updateClip(track.id, c.id, { start: c.start + shiftAmount }, { skipHistory: true });
        });

        return {
            success: true,
            message: `Moved clip "${clip.name}" to position ${targetPosition.toFixed(1)}s`,
        };
    }

    /**
     * Semantic cleanup: maps each timeline clip to its transcript text, asks GPT to
     * identify false starts, word-level repetitions, and non-speech content, then
     * removes those clips and re-packs the timeline with no gaps.
     */
    async smartCleanup(args = {}, signal = null) {
        console.log('[VideoEditorTools] Running smart cleanup...');
        const store = useTimelineStore.getState();

        const videoTrack = store.tracks?.find(t => t.type === 'video');
        if (!videoTrack || videoTrack.clips.length === 0) {
            return { success: false, message: 'No video clips on the timeline to analyze.' };
        }

        const clips = [...videoTrack.clips].sort((a, b) => a.start - b.start);
        const basename = (p) => (p || '').split(/[\\/]/).pop();

        // Map each clip to its transcript text using the per-file transcripts map.
        // Each clip has an assetId; the asset's name gives the file basename which
        // keys into store.transcripts. Words are filtered by the clip's source offset.
        const clipsWithText = clips.map((clip, index) => {
            const asset     = store.assets?.find(a => a.id === clip.assetId);
            const assetBase = basename(asset?.name || clip.sourceUrl || '');

            // Prefer per-file original transcript (source timestamps) → filter by offset.
            // Fall back to store.captions (timeline-derived) → filter by timeline position.
            let words;
            const origWords = store.transcripts?.[assetBase];
            if (origWords?.length > 0) {
                const offset = clip.offset || 0;
                words = origWords.filter(w =>
                    (w.start ?? 0) >= offset - 0.05 &&
                    (w.end   ?? 0) <= offset + clip.duration * (clip.speed || 1) + 0.05
                );
            } else {
                words = (store.captions || []).filter(w =>
                    (w.start ?? 0) >= clip.start - 0.05 &&
                    (w.end   ?? 0) <= clip.start + clip.duration + 0.05
                );
            }

            return {
                index,
                id:       clip.id,
                duration: clip.duration,
                text:     words.map(w => w.word || w.content || w.text || '').filter(Boolean).join(' ').trim(),
            };
        });

        const hasText = clipsWithText.some(c => c.text.length > 2);
        if (!hasText) {
            return {
                success: false,
                message: 'No transcript available for semantic analysis. Run auto-captions first or wait for transcription to complete.',
            };
        }

        const { authFetch } = await import('../utils/authFetch.js');
        const response = await authFetch('/api/ai/smart-cleanup', {
            method: 'POST',
            body:   JSON.stringify({ clips: clipsWithText }),
            signal,
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(`Smart cleanup API error: ${err.error || response.statusText}`);
        }

        const result = await response.json();
        const removeIds = new Set(result.removeClipIds || []);

        if (removeIds.size === 0) {
            return {
                success: true,
                message: '✓ Semantic analysis complete — the timeline is already clean, nothing to remove.',
            };
        }

        // Safety guard: refuse to remove all clips or more than 50% of the timeline.
        // This prevents ambiguous commands like "clean up" from wiping the whole edit.
        if (removeIds.size >= clips.length) {
            return {
                success: false,
                message: `⚠️ Smart cleanup would remove all ${clips.length} clips — this is likely not what you intended. Please be more specific: for example, "remove the false starts" or "cut the repeated sections".`,
            };
        }

        if (removeIds.size > Math.floor(clips.length * 0.5)) {
            return {
                success: false,
                message: `⚠️ Smart cleanup wants to remove ${removeIds.size} of ${clips.length} clips (more than half). Please be more specific about what to clean up, for example: "remove the silences" or "cut the repeated sentences".`,
            };
        }

        // Remove identified clips
        const freshStore = useTimelineStore.getState();
        const freshTrack = freshStore.tracks?.find(t => t.id === videoTrack.id);
        if (freshTrack) {
            for (const clipId of removeIds) {
                try { freshStore.removeClip(freshTrack.id, clipId); }
                catch (e) { console.warn(`[VideoEditorTools] Could not remove clip ${clipId}:`, e.message); }
            }
        }

        // Re-pack: assign sequential start times so there are no gaps
        const packedStore = useTimelineStore.getState();
        const packedTrack = packedStore.tracks?.find(t => t.id === videoTrack.id);
        if (packedTrack) {
            const remaining = [...packedTrack.clips].sort((a, b) => a.start - b.start);
            let cursor = 0;
            for (const clip of remaining) {
                if (Math.abs(clip.start - cursor) > 0.01) {
                    packedStore.updateClip(packedTrack.id, clip.id, { start: cursor }, { skipHistory: true });
                }
                cursor += clip.duration;
            }
        }

        return {
            success: true,
            message: `✓ Removed ${removeIds.size} of ${clips.length} segments. ${result.reasoning || ''}`,
        };
    }

    /**
     * Reorder timeline clips semantically using the transcript and user prompt.
     * Sends per-clip text to /api/ai/reorder-clips, applies the returned ordering.
     */
    async reorderClips(args = {}, signal = null) {
        const { prompt: userPrompt } = args;
        if (!userPrompt) return { success: false, message: 'A prompt describing how to reorder is required.' };

        const store = useTimelineStore.getState();
        const videoTrack = store.tracks?.find(t => t.type === 'video');
        if (!videoTrack || videoTrack.clips.length < 2) {
            return { success: false, message: 'Need at least 2 clips on the timeline to reorder.' };
        }

        const clips = [...videoTrack.clips].sort((a, b) => a.start - b.start);
        const basename = (p) => (p || '').split(/[\\/]/).pop();

        const clipsWithText = clips.map((clip, index) => {
            const asset     = store.assets?.find(a => a.id === clip.assetId);
            const assetBase = basename(asset?.name || clip.sourceUrl || '');
            const origWords = store.transcripts?.[assetBase];
            let words;
            if (origWords?.length > 0) {
                const offset = clip.offset || 0;
                words = origWords.filter(w => (w.start ?? 0) >= offset - 0.05 && (w.end ?? 0) <= offset + clip.duration * (clip.speed || 1) + 0.05);
            } else {
                words = (store.captions || []).filter(w => (w.start ?? 0) >= clip.start - 0.05 && (w.end ?? 0) <= clip.start + clip.duration + 0.05);
            }
            return { index, id: clip.id, duration: clip.duration, text: words.map(w => w.word || w.content || '').filter(Boolean).join(' ').trim() };
        });

        const hasText = clipsWithText.some(c => c.text.length > 2);
        if (!hasText) {
            return { success: false, message: 'No transcript available for semantic reordering. Run auto-captions or remove silences first.' };
        }

        const { authFetch } = await import('../utils/authFetch.js');
        const response = await authFetch('/api/ai/reorder-clips', {
            method: 'POST',
            body: JSON.stringify({ clips: clipsWithText, prompt: userPrompt }),
            signal,
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(`Reorder API error: ${err.error || response.statusText}`);
        }

        const result = await response.json();
        const newOrder = result.newOrder || [];
        if (newOrder.length === 0) return { success: false, message: 'Could not determine a new order.' };

        // Apply new order: re-assign start times in sequence
        const freshStore = useTimelineStore.getState();
        const freshTrack = freshStore.tracks?.find(t => t.id === videoTrack.id);
        if (!freshTrack) return { success: false, message: 'Video track not found.' };

        const clipById = Object.fromEntries(freshTrack.clips.map(c => [c.id, c]));

        // The order the clips are ALREADY in. If the model returns this same
        // sequence (common when it decides the current cut is fine), applying it
        // is a no-op — and reporting "✓ Reordered N clips" over an unchanged
        // timeline is the failure mode that makes users conclude the AI is
        // broken. Compare before touching anything.
        const currentOrder = freshTrack.clips
            .slice()
            .sort((a, b) => a.start - b.start)
            .map(c => c.id);
        const resolvedOrder = newOrder.filter(id => clipById[id]);

        if (resolvedOrder.length === 0) {
            // Every id the model returned is unknown to this track — previously
            // the `if (!clip) continue` loop swallowed this entirely and still
            // claimed success.
            return {
                success: false,
                message: 'The reorder result did not match any clips on the timeline — nothing was changed.',
            };
        }

        const isUnchanged =
            resolvedOrder.length === currentOrder.length &&
            resolvedOrder.every((id, i) => id === currentOrder[i]);

        if (isUnchanged) {
            return {
                success: false,
                message: `The clips are already in that order — nothing was changed.${result.reasoning ? ` ${result.reasoning}` : ''}`,
            };
        }

        let moved = 0;
        let cursor = 0;
        for (const id of resolvedOrder) {
            const clip = clipById[id];
            const newStart = cursor;
            if (Math.abs((clip.start ?? 0) - newStart) > 0.001) moved++;
            freshStore.updateClip(freshTrack.id, id, { start: newStart }, { skipHistory: false });
            cursor += clip.duration;
        }

        const skipped = newOrder.length - resolvedOrder.length;
        return {
            success: true,
            message: `✓ Reordered ${resolvedOrder.length} clips (${moved} moved).` +
                     `${skipped > 0 ? ` ${skipped} unknown clip id(s) ignored.` : ''}` +
                     `${result.reasoning ? ` ${result.reasoning}` : ''}`,
        };
    }

    /**
     * Cut out a time range from the timeline.
     */
    cutSegment({ start, end }) {
        const store = this.store;
        const videoTrack = store.tracks.find(t => t.type === 'video');
        if (!videoTrack) return { success: false, message: 'No video track found' };

        const overlapping = videoTrack.clips.filter(c =>
            c.start < end && (c.start + c.duration) > start
        );

        overlapping.forEach(clip => {
            const clipEnd = clip.start + clip.duration;

            if (clip.start >= start && clipEnd <= end) {
                store.removeClip(videoTrack.id, clip.id);
            } else if (clip.start < start && clipEnd > end) {
                store.splitClip(videoTrack.id, clip.id, start);
                const newTracks = useTimelineStore.getState().tracks;
                const newTrack = newTracks.find(t => t.id === videoTrack.id);
                const middleClip = newTrack?.clips.find(c => c.start >= start && (c.start + c.duration) <= end + 0.5);
                if (middleClip) store.removeClip(videoTrack.id, middleClip.id);
            } else if (clip.start < start) {
                store.updateClip(videoTrack.id, clip.id, { duration: start - clip.start });
            } else {
                const newStart = end;
                store.updateClip(videoTrack.id, clip.id, { start: newStart, duration: clipEnd - newStart });
            }
        });

        return { success: true, message: `Cut segment ${start.toFixed(1)}s–${end.toFixed(1)}s` };
    }

    // ── Asset Engine Implementations ───────────────────────────────────────────
    // All use dynamic import for audioEngineAPI to keep the initial bundle lean.

    async searchAssets({ query = '', assetTypes = null, limit = 10 } = {}) {
        const { audioEngineAPI } = await import('../audio-engine/AudioEngineAPI.js');
        return audioEngineAPI.searchAssets(query, { assetTypes, limit });
    }

    async searchSFX({ query = '', limit = 10 } = {}) {
        const { audioEngineAPI } = await import('../audio-engine/AudioEngineAPI.js');
        return audioEngineAPI.searchAssets(query, { assetTypes: ['SOUND_EFFECT'], limit });
    }

    async searchLUTs({ query = '', cinematicOnly = false, limit = 10 } = {}) {
        const { audioEngineAPI } = await import('../audio-engine/AudioEngineAPI.js');
        return audioEngineAPI.searchLUTs(query, { cinematicOnly, limit });
    }

    async searchPresets({ presetType = null, limit = 10 } = {}) {
        const { audioEngineAPI } = await import('../audio-engine/AudioEngineAPI.js');
        return audioEngineAPI.listPresets(presetType, limit);
    }

    /**
     * Apply a LUT to the project.
     * Stores lutId in Zustand state (no store action needed — setState is always valid).
     * Fetches CSS preview filter for immediate visual feedback.
     */
    /**
     * FIX (R75): this used to only set `projectLUTId` + a CSS-filter preview
     * — the exact bug AssetPanel.jsx's own header comment already documented
     * as fixed for the MANUAL button ("applying a LUT only set projectLUTId +
     * a CSS filter. Nothing in the app has ever written clip.grading — yet
     * VideoPlayer reads it every frame"). The AI-executable version was never
     * updated to match, so an AI-triggered "make it warmer" produced a
     * visibly weaker/different look than clicking Apply, and export (which
     * reads per-clip `grading`, not the CSS preview) wouldn't reflect it at
     * all. Now computes the identical grade via the shared
     * client/src/utils/lutGrading.js formula and writes it per clip, exactly
     * like AssetPanel.jsx's handleLUTApply.
     *
     * @param {object}  args
     * @param {string}  [args.lutId] — resolved id, when already known
     * @param {string}  [args.query] — mood/style text ("warm cinematic") to
     *   resolve via search when lutId isn't given — this is how typed
     *   requests like "apply a warm lut" reach a real LUT: CommandCompiler
     *   can't resolve a query to an id itself (no I/O allowed there), so
     *   VideoEditorTools does the search-then-apply here at execution time.
     * @param {boolean} [args.applyToAll=false] — when true, overwrite even
     *   clips the user has manually graded (grading._manuallyAdjusted). By
     *   default those are left untouched, matching the manual UI's guard —
     *   only apply to all when the user explicitly asked for that.
     */
    async applyLUT({ lutId, query = '', applyToAll = false } = {}) {
        if (!lutId && !query) return { success: false, message: 'lutId or query is required' };
        try {
            const { audioEngineAPI } = await import('../audio-engine/AudioEngineAPI.js');
            const { lutToGrading }   = await import('../utils/lutGrading.js');

            let lut = null;
            if (lutId) {
                lut = await audioEngineAPI.getLUT(lutId);
                if (!lut) return { success: false, message: `LUT ${lutId} not found` };
            } else {
                const { luts = [] } = await audioEngineAPI.searchLUTs(query, { limit: 1 });
                if (!luts.length) {
                    return { success: false, message: `No LUT found matching "${query}" — try a different description.` };
                }
                lut = luts[0];
                lutId = lut.id;
            }

            const cssFilter = lut.cssFilterPreview || lut.css_filter_preview
                || await audioEngineAPI.getLUTPreview(lutId);
            const grading = lutToGrading(lut);

            const state = this.store;
            let touched = 0;
            let skipped = 0;
            for (const track of (state.tracks || [])) {
                if (track.type !== 'video') continue;
                for (const clip of (track.clips || [])) {
                    if (!applyToAll && clip.grading?._manuallyAdjusted) { skipped++; continue; }
                    state.updateClip?.(track.id, clip.id, { grading });
                    touched++;
                }
            }

            // Project-level id/CSS filter kept too: the id is what export
            // reads (R55/R55b), and the CSS filter still grades the canvas.
            useTimelineStore.setState({ projectLUTId: lutId, projectLUTFilter: cssFilter });

            const skippedNote = skipped > 0
                ? ` (left ${skipped} manually-graded clip(s) untouched — say "apply to all clips" to override)`
                : '';
            return {
                success: true,
                message: `✓ Applied "${lut.display_name || lut.name || lutId}" to ${touched} clip(s)${skippedNote}.`,
                lutId, cssFilter, touched, skipped,
            };
        } catch (error) {
            console.error('[VideoEditorTools] applyLUT error:', error);
            return { success: false, message: `Failed to apply LUT: ${error.message}` };
        }
    }

    /**
     * @param {object}  args
     * @param {boolean} [args.applyToAll=false] — same manually-adjusted guard as applyLUT().
     */
    /**
     * R88 — keyword emphasis on every caption (rules, then LLM for unsure ones).
     * R30: reports failure when nothing changed instead of claiming success.
     */
    async emphasizeKeywords({ overwrite = false } = {}) {
        try {
            const hasCaptions = (this.store.tracks || []).some(t => t.type === 'text' && (t.clips || []).length > 0);
            if (!hasCaptions) return { success: false, message: 'There are no captions to highlight yet. Add captions first.' };
            const r = await autoEmphasizeCaptions({ useLLM: true, overwrite: !!overwrite, source: 'assistant' });
            if (r.updated === 0) {
                const why = r.skippedUser > 0
                    ? `the captions already have key words you picked by hand (${r.skippedUser})`
                    : 'every caption already has its key words, or none had a clear one';
                return { success: false, message: `No caption changed: ${why}.` };
            }
            const llm = r.llmPicked > 0 ? ` (${r.llmPicked} decided by the assistant)` : '';
            return { success: true, message: `Key words highlighted on ${r.updated} caption(s)${llm}.`, updated: r.updated };
        } catch (error) {
            console.error('[VideoEditorTools] emphasizeKeywords error:', error);
            return { success: false, message: `Could not highlight key words: ${error.message}` };
        }
    }

    /**
     * R90 (A6) — a number/price pop on each spoken number worth showing
     * (findSpokenNumbers), starting on the word. Skips numbers that already
     * have a pop within a second, so re-running adds only what is new.
     */
    placeNumberPops({ events = null, max = 6 } = {}) {
        try {
            const state = useTimelineStore.getState();
            const numbers = findSpokenNumbers(state.captions, { events, max });
            if (numbers.length === 0) return { success: true, placed: 0, message: 'No prices, percentages or key numbers were spoken.' };
            let placed = 0;
            for (const n of numbers) {
                const live = useTimelineStore.getState();
                const dup = (live.tracks || []).some(t => t.type === 'overlay' && (t.clips || []).some(c =>
                    c.type === 'template' && c.template?.kind === 'price-pop' && Math.abs((Number(c.start) || 0) - n.start) < 1));
                if (dup) continue;
                const r = live.addTemplateClip('price-pop', { text: n.text }, { start: Math.max(0, n.start - 0.1), duration: 1.6, y: 30, select: false });
                if (r?.success) placed++;
            }
            return { success: true, placed, message: placed > 0 ? `${placed} number pop(s) placed on the spoken numbers.` : 'Every spoken number already has a pop.' };
        } catch (error) {
            console.error('[VideoEditorTools] placeNumberPops error:', error);
            return { success: false, placed: 0, message: `Could not place number pops: ${error.message}` };
        }
    }

    /** Add sparse, transcript-matched vector accents using the active style. */
    placeContextualIllustrations({ max = 3 } = {}) {
        try {
            const state = useTimelineStore.getState();
            const style = state.editingStyle || 'talking_head';
            const styles = {
                reel: { treatment: 'burst', accent: '#FFE500', motion: 'stkr-bounce-soft', x: 82, y: 24 },
                vlog: { treatment: 'badge', accent: '#FF3B5C', motion: 'stkr-float-up', x: 80, y: 22 },
                talking_head: { treatment: 'frame', accent: '#FFE500', motion: 'stkr-float-up', x: 82, y: 24 },
                interview: { treatment: 'solo', accent: '#E8C27A', motion: 'stkr-float-up', x: 80, y: 24 },
                podcast: { treatment: 'solo', accent: '#E8C27A', motion: 'stkr-float-up', x: 80, y: 24 },
            };
            const look = styles[style] || { treatment: 'frame', accent: '#00E5FF', motion: 'stkr-float-up', x: 82, y: 24 };
            const calm = style === 'podcast' || style === 'interview';
            const cap = Math.max(0, Math.min(calm ? 2 : 5, Math.floor(Number(max) || 0)));
            if (!cap) return { success: true, placed: 0, message: 'No illustration slots requested.' };
            const words = (state.captions || []).map(word => ({
                text: String(word?.word || word?.text || '').trim(),
                start: Number(word?.start),
                end: Number(word?.end),
            })).filter(word => word.text && Number.isFinite(word.start) && Number.isFinite(word.end));
            if (!words.length) return { success: true, placed: 0, message: 'No transcript is available for contextual illustrations.' };

            const existing = (state.tracks || []).flatMap(track => track.type === 'overlay' ? (track.clips || []) : [])
                .filter(clip => clip.type === 'template' && clip.template?.kind === 'icon');
            const selected = [];
            for (let i = 0; i < words.length && selected.length < cap; i += 2) {
                const sample = words.slice(i, i + 5);
                if (!sample.length) continue;
                const phrase = sample.map(word => word.text).join(' ');
                const icon = iconFromText(phrase);
                const start = sample[0].start;
                if (!icon || start < 0 || selected.some(item => item.icon === icon && Math.abs(item.start - start) < 8)) continue;
                if (existing.some(clip => clip.template.params?.icon === icon && Math.abs((Number(clip.start) || 0) - start) < 3)) continue;
                selected.push({ icon, start });
            }

            let placed = 0;
            for (const [index, item] of selected.entries()) {
                const live = useTimelineStore.getState();
                const duration = Math.min(calm ? 2.2 : 2.6, Math.max(0.6, (Number(live.duration) || item.start + 2.2) - item.start));
                const r = live.addTemplateClip('icon', {
                    icon: item.icon,
                    treatment: look.treatment,
                    accent: look.accent,
                }, {
                    start: item.start,
                    duration,
                    x: index % 2 ? 18 : look.x,
                    y: look.y,
                    select: false,
                    skipHistory: true,
                });
                if (!r?.success) continue;
                const current = useTimelineStore.getState();
                const clip = current.tracks.find(track => track.id === r.trackId)?.clips?.find(itemClip => itemClip.id === r.clipId);
                if (clip) {
                    const updates = applyPresetToClip(clip, look.motion, { intensity: calm ? 0.28 : 0.52 });
                    if (Object.keys(updates).length) current.updateClip(r.trackId, r.clipId, updates, { skipHistory: true });
                }
                placed++;
            }
            return { success: true, placed, message: placed ? `${placed} contextual vector illustration(s) added.` : 'No transcript phrases matched the illustration library.' };
        } catch (error) {
            console.error('[VideoEditorTools] placeContextualIllustrations error:', error);
            return { success: false, placed: 0, message: `Could not add contextual illustrations: ${error.message}` };
        }
    }

    /** R89 / Creative Suite — drop an animated template at the playhead with style compatibility check. */
    addTemplate({ kind, params = {} } = {}) {
        try {
            const state = useTimelineStore.getState();
            const currentStyle = state.editingStyle || 'talking_head';
            const evalResult = evaluateMotionCompatibility(currentStyle, 'template', kind, params);
            const finalParams = evalResult.adaptedParams || params;

            const r = state.addTemplateClip(kind, finalParams);
            if (!r?.success) return { success: false, message: r?.error || 'The template could not be added.' };
            const names = {
                'counter': 'Flip counter', 'price-pop': 'Number pop', 'logo-card': 'Logo card', 'code-window': 'Code window',
                'line-graph': 'Line graph', 'circular-meter': 'Circular meter', 'data-counter': 'Data counter',
                'film-grain': 'Film grain', 'vhs-glitch': 'VHS glitch', 'light-leak': 'Light leak',
                'lower-third-minimal': 'Lower third', 'location-badge': 'Location badge',
                'retention-progress-bar': 'Retention progress bar', 'quote-card': 'Quote card',
            };
            const label = names[kind] || 'Template';
            const styleNote = (!evalResult.compatible || evalResult.verdict === 'caution')
                ? ` [Style notice: ${evalResult.reason}]`
                : '';
            return {
                success: true,
                message: `${label} added at the playhead.${styleNote} Edit its text in the Motion panel.`,
                clipId: r.clipId,
                compatibility: evalResult,
            };
        } catch (error) {
            console.error('[VideoEditorTools] addTemplate error:', error);
            return { success: false, message: `Could not add the template: ${error.message}` };
        }
    }

    /**
     * R88 — apply a layout preset to an overlay video/image: the selected one
     * if it is on the overlay track, otherwise the one under the playhead.
     */
    applyLayoutPreset(preset) {
        try {
            const state = useTimelineStore.getState();
            const overlays = (state.tracks || []).filter(t => t.type === 'overlay')
                .flatMap(t => (t.clips || []).filter(c => c.type === 'video' || c.type === 'image').map(c => ({ track: t, clip: c })));
            if (overlays.length === 0) {
                return { success: false, message: 'There is no b-roll or image on the overlay track to lay out. Add one first.' };
            }
            const t = state.currentTime || 0;
            const target = overlays.find(o => o.clip.id === state.activeClipId)
                || overlays.find(o => t >= o.clip.start && t < o.clip.start + o.clip.duration)
                || null;
            if (!target) {
                return { success: false, message: 'Select the b-roll clip (or move the playhead over it) to choose which one to lay out.' };
            }
            const r = state.applyLayout(target.track.id, target.clip.id, preset);
            if (!r?.success) return { success: false, message: r?.error || 'Layout could not be applied.' };
            const names = { split: 'Split screen', pip: 'Picture in picture', fullscreen: 'Full-screen cutaway' };
            const face = preset === 'split'
                ? (r.faceAware ? ' The speaker is framed from the speaker detection.' : ' The speaker is framed from the centre; run "separate speaker" first for face-aware framing.')
                : '';
            return { success: true, message: `${names[preset]} applied to "${target.clip.name || 'the clip'}".${face}` };
        } catch (error) {
            console.error('[VideoEditorTools] applyLayoutPreset error:', error);
            return { success: false, message: `Could not apply the layout: ${error.message}` };
        }
    }

    /**
     * R130 — "add_transitions_to_sections" was compiled (CommandCompiler.js)
     * and dispatched (MediaExecutionEngine.js's shared VideoEditorTools
     * case) for both long-form edit modes since the action was first added,
     * but had no case in this class's execute() switch at all — every call
     * threw "Unknown tool: add_transitions_to_sections" and the whole
     * long-form edit failed on this one step (reported by the user with a
     * screenshot: a 2-step reel edit failed outright on exactly this error).
     * This is the implementation that was always meant to be here.
     *
     * `apply_at`:
     *   'section_boundaries' — only the cuts that land on an actual chapter
     *      marker (extractChapterBoundaries — the same R77 markers
     *      placeContextualBroll's title cards use), for YOUTUBE_OPTIMIZED's
     *      "smooth transitions between main content sections" ask. No
     *      chapter markers on the timeline is reported as a failure, not a
     *      silent no-op (see scripts/test_no_silent_noop.js's contract).
     *   'all_cuts' (default, and FULL_BUILD's own choice) — every cut on the
     *      base video track, for a jump-cut-heavy rebuild that needs
     *      something smoothing every one of them.
     */
    async addTransitionsToSections(args = {}) {
        try {
            const state = this.store;
            const type = args.type || 'fade';
            const duration = Number(args.duration) > 0 ? Number(args.duration) : 0.5;
            const applyAt = args.apply_at || 'all_cuts';

            const videoTrack = (state.tracks || []).find(t => t.type === 'video' && (t.clips || []).length > 0);
            if (!videoTrack) {
                return { success: false, message: 'There is no video track to add transitions to.' };
            }
            const clips = [...videoTrack.clips].sort((a, b) => (Number(a.start) || 0) - (Number(b.start) || 0));
            if (clips.length < 2) {
                return { success: false, message: 'Only one clip on the timeline — nothing to transition between.' };
            }

            let targets;
            if (applyAt === 'section_boundaries') {
                const boundaries = extractChapterBoundaries(state.tracks);
                if (boundaries.length === 0) {
                    return {
                        success: false,
                        message: 'No chapter/section boundaries found on the timeline — run content analysis first, or ask for transitions at every cut instead.',
                    };
                }
                const BOUNDARY_MATCH_EPSILON_S = 0.3;
                targets = clips.filter((c, i) => i > 0
                    && boundaries.some(b => Math.abs((Number(c.start) || 0) - b) <= BOUNDARY_MATCH_EPSILON_S));
                if (targets.length === 0) {
                    return { success: false, message: 'No cuts line up with a chapter boundary closely enough to attach a transition.' };
                }
            } else {
                targets = clips.slice(1);
            }

            // One undo step for the whole batch, not one per clip — addTransition
            // itself calls _saveHistory() per call, which without this would turn
            // "add transitions" into N separate undos.
            useTimelineStore.getState().beginHistoryGroup();
            try {
                targets.forEach((c) => { useTimelineStore.getState().addTransition(c.id, type, duration); });
            } finally {
                useTimelineStore.getState().endHistoryGroup();
            }

            return {
                success: true,
                message: `Added ${type} transition(s) (${duration}s) to ${targets.length} cut(s).`,
                count: targets.length,
                type,
                duration,
            };
        } catch (error) {
            console.error('[VideoEditorTools] addTransitionsToSections error:', error);
            return { success: false, message: `Could not add transitions: ${error.message}` };
        }
    }

    /**
     * R132, Slice 1 — "create a video from this script": turns a plain-text
     * narration script into a cartoonish-style video with NO user footage
     * involved at all, per claude/script-to-video-scoping-R132.md's plan.
     *
     * Per the user's explicit choice this round: visuals + captions only —
     * no TTS/voice generation yet (deferred to a later slice) — and
     * Vecteezy's vector/illustration catalog is tried first for every shot,
     * falling back to Vecteezy video, then photo, only when a shot's query
     * turns up no vector results, so the look stays consistently cartoonish
     * except where a shot genuinely has nothing vector-style to match.
     *
     * Builds on existing, unmodified primitives only: segmentScript (new,
     * R132) for the shot list, GET /api/stock/search (existing route, now
     * also serving type=vector per this round's route change) for each
     * shot's visual, and state.addTrack/addClip (existing store primitives)
     * to place them — the same primitives placeContextualBroll and
     * fetchStockBroll already use for their own stock lookups, just applied
     * sequentially as the BASE content instead of as overlay cutaways,
     * since there is no existing footage here to lay anything over.
     */
    async createVideoFromScript(args = {}, signal = null) {
        const script = String(args.script || '').trim();
        if (!script) {
            return { success: false, message: 'No script text was given to build a video from.' };
        }

        const shots = segmentScript(script);
        if (shots.length === 0) {
            return { success: false, message: 'Could not break that script into any shots — it may be empty or unreadable.' };
        }

        const searchShot = async (query, type) => {
            try {
                const params = new URLSearchParams({ query, type, page: '1', perPage: '5' });
                const response = await authFetch(`/api/stock/search?${params.toString()}`, { signal });
                if (!response.ok) return null;
                const data = await response.json();
                const results = data?.results || [];
                return results.length > 0 ? { asset: results[0], provider: data?.provider || results[0]?.provider } : null;
            } catch (err) {
                console.warn(`[VideoEditorTools] createVideoFromScript: ${type} search failed for "${query}":`, err.message);
                return null;
            }
        };

        let cursor = 0;
        let vectorCount = 0;
        let videoCount = 0;
        let photoCount = 0;
        const unmatched = [];
        const imageClipIds = [];

        useTimelineStore.getState().beginHistoryGroup();
        let visualTrackId;
        let textTrackId;
        try {
            visualTrackId = useTimelineStore.getState().addTrack('video', { skipHistory: true });
            textTrackId = useTimelineStore.getState().addTrack('text', { skipHistory: true });

            for (const shot of shots) {
                const start = cursor;
                const duration = shot.estimatedDuration;

                // Vecteezy vector-first, per the user's instruction — falls
                // back to video, then photo, only when a shot's query finds
                // nothing vector-style. Each fallback is a plain, separate
                // search, not a provider-level switch, so a shot that fails
                // all three simply has no visual rather than retrying forever.
                let found = await searchShot(shot.stockQuery, 'vector');
                let kind = 'vector';
                if (!found) { found = await searchShot(shot.stockQuery, 'video'); kind = 'video'; }
                if (!found) { found = await searchShot(shot.stockQuery, 'photo'); kind = 'photo'; }

                if (!found) {
                    unmatched.push(shot.stockQuery);
                    // Still advance the cursor and still caption the line —
                    // a missing visual shouldn't silently drop the narration
                    // text too, and shots after it must not overlap.
                    cursor += duration;
                } else {
                    const { asset } = found;
                    const exists = (useTimelineStore.getState().assets || []).some(a => a.id === asset.id);
                    if (!exists) useTimelineStore.getState().addAssets([asset]);

                    const clipId = `clip_scriptshot_${Date.now()}_${shot.index}_${Math.random().toString(36).slice(2, 7)}`;
                    useTimelineStore.getState().addClip(visualTrackId, {
                        id: clipId,
                        assetId: asset.id,
                        type: asset.type === 'image' ? 'image' : 'video',
                        url: asset.url || asset.sourceUrl,
                        name: asset.name,
                        start,
                        duration,
                    }, { skipHistory: true });

                    if (asset.type === 'image') imageClipIds.push({ clipId, duration });
                    if (kind === 'vector') vectorCount++;
                    else if (kind === 'video') videoCount++;
                    else photoCount++;

                    cursor += duration;
                }

                useTimelineStore.getState().addClip(textTrackId, {
                    id: `clip_scriptcaption_${Date.now()}_${shot.index}_${Math.random().toString(36).slice(2, 7)}`,
                    type: 'text',
                    start,
                    duration,
                    name: `Script line ${shot.index + 1}`,
                    content: shot.text,
                    position: 'bottom',
                }, { skipHistory: true });
            }

            // Still vector/photo images are static by default — a Ken Burns
            // style slow zoom keeps them from reading as a dead slideshow.
            // applySmartZoom's own ZoomAnalyzer only looks at type:'video'
            // clips (confirmed in R132's scoping), so a plain, deterministic
            // zoom is applied here directly via the same addTransformKeyframe
            // primitive, rather than waiting on that analyzer to be extended.
            imageClipIds.forEach(({ clipId, duration }) => {
                useTimelineStore.getState().addTransformKeyframe(clipId, 'scale', 0, 1.0, 'linear');
                useTimelineStore.getState().addTransformKeyframe(clipId, 'scale', duration, 1.12, 'linear');
            });
        } finally {
            useTimelineStore.getState().endHistoryGroup();
        }

        const matchedCount = shots.length - unmatched.length;
        if (matchedCount === 0) {
            return {
                success: false,
                message: `Segmented the script into ${shots.length} shot(s), but no visual (vector, video, or photo) could be found for any of them. Captions were still placed. Try a less abstract script, or check that stock search is configured.`,
                shotCount: shots.length,
                matchedCount: 0,
            };
        }

        const parts = [];
        if (vectorCount > 0) parts.push(`${vectorCount} vector`);
        if (videoCount > 0) parts.push(`${videoCount} video`);
        if (photoCount > 0) parts.push(`${photoCount} photo`);
        const breakdown = parts.length > 0 ? ` (${parts.join(', ')})` : '';
        const unmatchedNote = unmatched.length > 0
            ? ` ${unmatched.length} shot(s) had no match for any asset type and were left as captions only.`
            : '';

        return {
            success: true,
            message: `✓ Built a ${cursor.toFixed(1)}s video from the script: ${shots.length} shot(s), ${matchedCount} with a visual${breakdown}.${unmatchedNote}`,
            shotCount: shots.length,
            matchedCount,
            vectorCount,
            videoCount,
            photoCount,
            unmatchedQueries: unmatched,
            totalDuration: cursor,
        };
    }

    clearKeywords() {
        try {
            const n = clearAllEmphasis();
            if (n === 0) return { success: false, message: 'No caption has highlighted key words.' };
            return { success: true, message: `Key word highlights removed from ${n} caption(s).`, cleared: n };
        } catch (error) {
            console.error('[VideoEditorTools] clearKeywords error:', error);
            return { success: false, message: `Could not remove key word highlights: ${error.message}` };
        }
    }

    clearLUT({ applyToAll = false } = {}) {
        try {
            const state = this.store;
            let touched = 0;
            let skipped = 0;
            for (const track of (state.tracks || [])) {
                if (track.type !== 'video') continue;
                for (const clip of (track.clips || [])) {
                    if (!clip.grading) continue; // nothing to clear on this clip
                    if (!applyToAll && clip.grading?._manuallyAdjusted) { skipped++; continue; }
                    state.updateClip?.(track.id, clip.id, { grading: null });
                    touched++;
                }
            }
            useTimelineStore.setState({ projectLUTId: null, projectLUTFilter: 'none' });
            const skippedNote = skipped > 0 ? ` (left ${skipped} manually-graded clip(s) untouched)` : '';
            return { success: true, message: `LUT cleared from ${touched} clip(s)${skippedNote}.`, touched, skipped };
        } catch (error) {
            console.error('[VideoEditorTools] clearLUT error:', error);
            return { success: false, message: `Failed to clear LUT: ${error.message}` };
        }
    }

    /**
     * Add a sound effect clip to the first audio track at atTime.
     * Duration defaults to 2s; PlaybackEngine updates it once the asset loads.
     */
    addSFX({ sfxId = null, assetUrl = null, atTime = 0, trackId = null, volume = 0.8, fadeIn = 0, fadeOut = 0, label = 'SFX' } = {}) {
        if (!sfxId && !assetUrl) return { success: false, message: 'sfxId or assetUrl required' };
        const store = this.store;
        const target = trackId
            ? store.tracks.find(t => t.id === trackId)
            : store.tracks.find(t => t.type === 'audio');
        if (!target) return { success: false, message: 'No audio track found' };

        store.addClip(target.id, {
            id:       `sfx_${Date.now()}`,
            type:     'audio',
            src:      assetUrl || sfxId,
            assetId:  sfxId,
            start:    atTime,
            duration: 2,
            volume,
            fadeIn,
            fadeOut,
            name:     label,
            isSFX:    true,
        });
        return { success: true, message: `SFX "${label}" added at ${atTime}s` };
    }

    async applyPreset({ presetId, projectId, approved = false } = {}) {
        if (!presetId) return { success: false, message: 'presetId is required' };
        const { audioEngineAPI } = await import('../audio-engine/AudioEngineAPI.js');
        const pid = projectId || this.store.projectId || null;
        return audioEngineAPI.applyPreset(presetId, pid, approved);
    }

    async exportAudio({ format = 'mp3', bitrate = '192k', normalize = false, trimStart, trimEnd } = {}) {
        const { audioEngineAPI } = await import('../audio-engine/AudioEngineAPI.js');
        const projectId = this.store.projectId || null;
        return audioEngineAPI.requestAudioExport({ projectId, format, bitrate, normalize, trimStart, trimEnd });
    }

    async recommendSFX({ limit = 5 } = {}) {
        const { audioEngineAPI } = await import('../audio-engine/AudioEngineAPI.js');
        const { tracks, aspectRatio } = this.store;
        return audioEngineAPI.recommendSFX({ tracks, aspectRatio }, { limit });
    }

    async recommendLUTs({ limit = 3 } = {}) {
        const { audioEngineAPI } = await import('../audio-engine/AudioEngineAPI.js');
        const { tracks, aspectRatio } = this.store;
        return audioEngineAPI.recommendLUTs({ tracks, aspectRatio }, { limit });
    }

    async recommendPresets({ presetType = null, limit = 5 } = {}) {
        const { audioEngineAPI } = await import('../audio-engine/AudioEngineAPI.js');
        const { tracks, aspectRatio } = this.store;
        return audioEngineAPI.recommendPresets({ tracks, aspectRatio }, { presetType, limit });
    }
}
