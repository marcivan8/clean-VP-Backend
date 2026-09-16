import useTimelineStore from '../store/useTimelineStore.js';
import { performSilenceRemoval, performFillerRemoval, performAudioDenoise, performAudioNormalization, performAutoCaptions } from '../services/autoEditService.js';
import { ContentAnalyzer } from './ContentAnalyzer.js';
import { LongFormEditPlanner } from './LongFormEditPlanner.js';
import { authFetch } from '../utils/authFetch.js';

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
        description: "Generates and executes a full long-form edit plan based on prior content analysis. Includes silence removal, hook placement, segment reordering, repetition removal, and transitions. Executes all steps immediately.",
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
    const words = (text || '').toLowerCase().split(/[^a-z0-9']+/).filter(w => w.length > 4 && !BROLL_STOPWORDS.has(w));
    return new Set(words);
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
export function matchTranscriptToBroll(words, candidates, chapterBoundaries = []) {
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
        while (j < words.length && (words[j]?.start ?? 0) < windowStart + BROLL_WINDOW_SECONDS) {
            windowWords.push(words[j]?.word || words[j]?.text || '');
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
                for (const candidate of candidates) {
                    const lastUse = lastPlacedAt.get(candidate.assetId);
                    if (lastUse !== undefined && windowStart - lastUse < BROLL_COOLDOWN_S) continue; // still cooling down

                    const shared = [...windowKeywords].filter(w => candidate.keywords.has(w));
                    if (shared.length < BROLL_MIN_SHARED_KEYWORDS) continue; // never placed on the boundary bonus alone

                    const score = shared.length + (nearBoundary ? BROLL_CHAPTER_SCORE_BONUS : 0);
                    if (score > bestScore) {
                        best = candidate;
                        bestOverlap = shared;
                        bestScore = score;
                    }
                }

                if (best) {
                    const duration = nearBoundary ? BROLL_TRANSITION_CUTAWAY_S : BROLL_DEFAULT_CUTAWAY_S;
                    placements.push({
                        timelineTime: windowStart,
                        duration,
                        assetId: best.assetId,
                        name: best.name,
                        matchedKeywords: bestOverlap,
                        isChapterTransition: nearBoundary,
                    });
                    lastPlacedAt.set(best.assetId, windowStart);
                    lastPlacementEnd = windowStart + duration;
                    if (placements.length >= BROLL_MAX_PLACEMENTS) break;
                }
            }
        }

        i = j; // advance past this window — windows never overlap
    }

    return placements;
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
            case 'smart_cleanup': return await this.smartCleanup(action.args, action.signal);
            case 'find_hook': return await this.findHook();
            case 'place_contextual_broll': return await this.placeContextualBroll(action.args, action.signal);
            case 'remove_repetition': return await this.removeRepetition(action.args);
            case 'reorder_clips': return await this.reorderClips(action.args, action.signal);
            case 'reorder_segment': return this.reorderSegment(action.args);
            case 'cut_segment': return this.cutSegment(action.args);
            case 'identify_quotable_moments': return await this.identifyQuotableMoments(action.args);

            // Asset Engine — Creative Asset Intelligence System
            case 'search_assets':     return await this.searchAssets(action.args);
            case 'search_sfx':        return await this.searchSFX(action.args);
            case 'search_luts':       return await this.searchLUTs(action.args);
            case 'search_presets':    return await this.searchPresets(action.args);
            case 'apply_lut':         return await this.applyLUT(action.args);
            case 'clear_lut':         return this.clearLUT(action.args);
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
    async longFormEdit({ editMode, platform, targetDuration } = {}, signal = null) {
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
        const plan = LongFormEditPlanner.generatePlan(analysis, { platform, targetDuration });

        if (!plan || plan.error) {
            return {
                success: false,
                message: plan?.error || 'Long-form plan generation failed.',
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

        console.log(`[VideoEditorTools] Executing long-form plan: ${plan.step_count} steps`);

        // Dynamically import to avoid circular dependency issues at module load time
        const { CommandCompiler } = await import('./CommandCompiler.js');
        const { mediaExecutionEngine } = await import('./MediaExecutionEngine.js');

        const compileResult = CommandCompiler.compile(plan, useTimelineStore.getState());

        if (!compileResult.success && compileResult.commands.length === 0) {
            return {
                success: false,
                message: compileResult.error || 'Could not compile long-form edit commands.',
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

        return {
            success: executionResult.success,
            message: executionResult.success
                ? `✓ Long-form edit complete — ${plan.step_count} steps applied.`
                : `Long-form edit failed: ${executionResult.error}`,
            editPlan: plan,
            results: executionResult.results,
        };
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
            const words = state.captions;

            if (!Array.isArray(words) || words.length === 0) {
                return {
                    success: false,
                    message: 'No transcript found — generate captions first, then try matching b-roll again.',
                    placements: [],
                };
            }

            const projectId = state.projectId || null;
            if (!projectId) {
                return { success: false, message: 'No project id available to fetch b-roll profiles.', placements: [] };
            }

            const response = await authFetch(`/api/brain/broll-profiles?projectId=${encodeURIComponent(projectId)}`, { signal });
            if (!response.ok) {
                const errText = await response.text().catch(() => '');
                return { success: false, message: `Could not load b-roll profiles: ${errText || response.status}`, placements: [] };
            }
            const { profiles = [] } = await response.json();

            // Checked against the media BIN, not the timeline — see
            // buildBrollCandidates' doc comment. A match can now be an asset
            // the user imported but never dragged onto a track yet.
            const candidates = buildBrollCandidates(profiles, state.assets);
            if (candidates.length === 0) {
                return {
                    success: true,
                    message: 'No analyzed b-roll found in the media bin to match against — nothing placed. (Clips or images need to finish their content analysis first.)',
                    placements: [],
                    titleCardsCreated: 0,
                };
            }

            // Which of those candidates are already sitting on a track, BEFORE
            // any placement below — used only to report how many were newly
            // pulled in from the bin, not to gate anything.
            const alreadyOnTimeline = new Set();
            (state.tracks || []).forEach(t => (t.clips || []).forEach(c => { if (c?.assetId) alreadyOnTimeline.add(c.assetId); }));

            const chapterBoundaries = extractChapterBoundaries(state.tracks);
            const matches = matchTranscriptToBroll(words, candidates, chapterBoundaries);

            for (const match of matches) {
                const asset = (state.assets || []).find(a => a.id === match.assetId);
                if (!asset) continue;
                const duration = Math.min(match.duration, asset.duration || match.duration);
                state.addOverlayClip(asset, {
                    start: match.timelineTime,
                    duration,
                    kind: asset.type === 'image' ? 'image' : 'video',
                    x: 50,
                    y: 50,
                    scale: 4,
                });
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

if (matches.length === 0 && titleCardsCreated === 0) {
                return {
                    success: true,
                    message: 'Found analyzed b-roll but none matched a moment in the dialogue closely enough, and no new chapter title cards were needed — nothing placed.',
                    placements: [],
                    titleCardsCreated: 0,
                };
            }

            const transitionCount = matches.filter(m => m.isChapterTransition).length;
            const newlyImportedCount = matches.filter(m => !alreadyOnTimeline.has(m.assetId)).length;

            const notes = [];
            if (transitionCount > 0) notes.push(`${transitionCount} placed as chapter-transition bridges`);
            if (newlyImportedCount > 0) notes.push(`${newlyImportedCount} pulled in from the media bin`);
            if (titleCardsCreated > 0) notes.push(`${titleCardsCreated} chapter title card(s) added`);
            const notesText = notes.length > 0 ? ` (${notes.join('; ')})` : '';

            return {
                success: true,
                message: `✓ Placed ${matches.length} b-roll cutaway(s) matched to the dialogue${notesText}.`,
                placements: matches,
                titleCardsCreated,
            };
        } catch (error) {
            console.error('[VideoEditorTools] placeContextualBroll error:', error);
            return { success: false, message: `Failed to place contextual b-roll: ${error.message}`, placements: [], titleCardsCreated: 0 };
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
                    (w.end   ?? 0) <= offset + clip.duration + 0.05
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
                words = origWords.filter(w => (w.start ?? 0) >= offset - 0.05 && (w.end ?? 0) <= offset + clip.duration + 0.05);
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