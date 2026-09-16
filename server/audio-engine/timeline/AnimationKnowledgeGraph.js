'use strict';

/**
 * server/audio-engine/timeline/AnimationKnowledgeGraph.js
 *
 * "Brain chooses animations. Users don't."
 *
 * Maps a detected semantic timeline event (reveal / punchline / emphasis /
 * emotional beat / chapter transition) to the REAL motion preset ids the client's motion engine
 * understands (client/src/motion/MotionPresets.js) and the REAL SFX taxonomy
 * (EditingIntent values, server/audio-engine/types.js) that event should pull
 * sound effects from.
 *
 * This is the missing link ADR-001 flagged: the SFX taxonomy, the four
 * TimelineEventType constants, and `applyPresetToClip` already existed in
 * this codebase — nothing tied a "reveal" event to `scale-reveal` + a riser.
 * This file is that tie, and it's the only place that tie is defined.
 *
 * Preset ids here are REAL client/src/motion/MotionPresets.js ids (kebab-
 * case), not the illustrative camelCase from the original feature request:
 *   scaleReveal → scale-reveal   cameraPush  → camera-push
 *   blurReveal  → blur-reveal    captionPop  → pop (on a text/caption layer)
 *   cameraShake → camera-shake
 *
 * `animations` is split by target layer kind because a "reveal" on a caption
 * clip and a "reveal" on the base video clip are different preset FAMILIES
 * (text vs camera) even though they're the same semantic event — see
 * MotionPresets.js's PRESET_GROUPS, which never share ids between families.
 * Arrays are priority-ordered; callers that want one pick take index 0.
 */

const { TimelineEventType, EditingIntent } = require('../types.js');
const { computeIntensity, pickPresetForIntensity } = require('./AnimationIntensity.js'); // R81 — zero-cost bespoke-animation synthesizer
const { computeStyleSeed, pickSecondaryPreset } = require('./AnimationCombiner.js'); // R82 — zero-cost animation combinations

/**
 * @typedef {Object} KnowledgeGraphEntry
 * @property {string}   event        — lowercase event key (matches the user-facing name)
 * @property {string}   eventType    — the TimelineEventType this entry answers for
 * @property {{text: string[], video: string[], image: string[], sticker: string[]}} animations
 *                                     — MotionPresets ids by layer kind, priority-ordered.
 *                                     `image`/`sticker` added alongside the original `text`/`video`
 *                                     so an overlay (a manually-placed photo/graphic, or a secondary
 *                                     picture-in-picture video track) present at a detected moment
 *                                     gets its OWN kind-appropriate animation instead of being
 *                                     invisible to this graph — see `layerKindForClip` below, which
 *                                     is what resolves a real clip down to one of these four keys.
 * @property {string[]} sfxIntents   — EditingIntent values, for TaxonomyService.getSFXByIntents
 * @property {string[]} sfxTerms     — free-text taxonomy terms (documentation / NL-search parity;
 *                                     matches server/audio-engine/library/taxonomyMaps.js keys —
 *                                     this is where "riser"/"impact"/"punchline" in the original
 *                                     feature request example map to in the real taxonomy)
 */

/** @type {Record<string, KnowledgeGraphEntry>} */
const ANIMATION_KNOWLEDGE_GRAPH = {
    reveal: {
        event: 'reveal',
        eventType: TimelineEventType.REVEAL,
        animations: {
            text:    ['scale-reveal', 'blur-reveal'],
            video:   ['camera-push'],
            // 'reveal' is a real IMAGE_PRESETS id (client/src/motion/MotionPresets.js) —
            // an overlay photo appearing/revealing is the closest visual analogue to a
            // REVEAL moment; ken-burns as the fallback if 'reveal' is ever unavailable.
            image:   ['reveal', 'ken-burns'],
            // A sticker popping into frame reads as the same "here it is" beat.
            sticker: ['sticker-pop', 'bounce'],
        },
        sfxIntents: [EditingIntent.REVEAL, EditingIntent.INTRO],
        sfxTerms: ['riser', 'impact', 'reveal'],
    },
    punchline: {
        event: 'punchline',
        eventType: TimelineEventType.PUNCHLINE_DETECTED,
        animations: {
            text:    ['pop'],
            video:   ['camera-shake'],
            // A sharp punch-in on the overlay photo lands with the joke's beat.
            image:   ['zoom'],
            // Bounce/shake are the comedic-timing presets in STICKER_PRESETS.
            sticker: ['bounce', 'shake'],
        },
        sfxIntents: [EditingIntent.PUNCHLINE, EditingIntent.COMEDY],
        sfxTerms: ['punchline', 'vine boom', 'boing'],
    },
    emphasis: {
        event: 'emphasis',
        eventType: TimelineEventType.EMPHASIS_MOMENT,
        animations: {
            text:    ['glow-reveal'],
            video:   ['camera-zoom'],
            // Deliberately different from punchline's 'zoom' — a standalone emphasis
            // moment (no preceding pause) reads better as a depth shift than a hit.
            image:   ['parallax', 'pan'],
            sticker: ['pulse', 'shake'],
        },
        sfxIntents: [EditingIntent.IMPACT, EditingIntent.ZOOM_PUNCH],
        sfxTerms: ['impact', 'punch', 'boom'],
    },
    emotional_beat: {
        event: 'emotional_beat',
        eventType: TimelineEventType.EMOTIONAL_BEAT,
        animations: {
            text:    ['fade'],
            // Deliberately empty — an emotional beat ("miss you", "thank you", a real
            // pause) should never get camera-shake/punch-style motion. Same restraint
            // now applies to sticker below: a playful graphic doesn't belong on a beat
            // like this. A meaningful overlay PHOTO is the one exception — it gets the
            // gentlest preset in the whole graph, a slow float, nothing sharper.
            video:   [],
            image:   ['float'],
            sticker: [],
        },
        sfxIntents: [EditingIntent.EMOTIONAL_BEAT, EditingIntent.STORYTELLING],
        sfxTerms: ['emotional beat', 'emotional', 'guitar'],
    },
    // R79 — the brain auto-applies a real animated motion preset at a real
    // chapter/topic transition, not just to reveal/punchline/emphasis/beat
    // moments. eventType is CHAPTER_START, the same event R77's chapter
    // markers already produce (server/audio-engine/timeline/
    // TimelineEventDetector.js). That event's clipId is retargeted, in the
    // detector itself, from the invisible structural marker clip (renders
    // nothing — see the detector's own CHAPTER_START doc comment) onto the
    // real visible title-card TEXT clip R78-followup places on the
    // "Chapter Titles" track at the same boundary, when one exists — so the
    // `text` family below is what actually plays for the primary event.
    chapter_transition: {
        event: 'chapter_transition',
        eventType: TimelineEventType.CHAPTER_START,
        animations: {
            // mask-reveal reads as "revealing the next chapter" — a wipe,
            // not a bounce — deliberately distinct from punchline's 'pop'
            // and reveal's 'scale-reveal'/'blur-reveal'.
            text:    ['mask-reveal', 'slide-up'],
            // Rarely the PRIMARY target once a title card exists (see the
            // retargeting above), but kept for parity with the other three
            // entries, as the fallback before any title card has been
            // placed, and for a base/PIP video clip resolveOverlayAnimations
            // finds on screen at the same boundary. A slow pull-out reads as
            // "opening up" into a new topic — distinct from reveal's push-in
            // and punchline/emphasis's shake/zoom.
            video:   ['camera-pull'],
            // A b-roll cutaway R78 places right at this boundary (the
            // chapter-proximity scoring bonus) gets a slow, premium push
            // rather than punchline's sharp zoom or emphasis's parallax/pan.
            image:   ['ken-burns'],
            // Deliberately empty — same restraint as emotional_beat: a
            // chapter change is not the moment for a playful sticker pop.
            sticker: [],
        },
        sfxIntents: [EditingIntent.TRANSITION],
        sfxTerms: ['transition', 'whoosh', 'chapter'],
    },
};

const BY_EVENT_TYPE = Object.values(ANIMATION_KNOWLEDGE_GRAPH)
    .reduce((map, entry) => { map[entry.eventType] = entry; return map; }, {});

/** All TimelineEventType values this graph has an opinion about. */
const SEMANTIC_EVENT_TYPES = Object.values(ANIMATION_KNOWLEDGE_GRAPH).map(e => e.eventType);

/** Look up the graph entry for a raw TimelineEventType value. Null if unknown. */
function graphForEventType(eventType) {
    return BY_EVENT_TYPE[eventType] || null;
}

/**
 * PORTED from `client/src/motion/ClipAdapter.js`'s `inferKind()` — TRUE
 * parity with that function's raw output (text/caption/image/video/sticker/
 * shape), kept as a separate server-side copy because this route (CommonJS)
 * can't `import` a client ESM module. If `inferKind()` ever changes there,
 * mirror the change here — this codebase has already been burned by two
 * implementations of one rule silently drifting apart (CLAUDE.md R14/R16/
 * R53), which is exactly why the CLIENT-side motion resolution
 * (`MotionResolver.js`) stays a single shared file rather than being
 * duplicated like this. This one small classifier is duplicated instead of
 * shared because the two sides don't share a module system — same tradeoff
 * R69's `RevideoLayerAdapter.js` documents for its own ported copy of this
 * exact function. `scripts/test_overlay_animation_intelligence.js` asserts
 * the two agree across a matrix of clip/track combinations (drift
 * detection), the same technique R69's byte-match check uses for its own
 * ported files.
 *
 * Deliberately returns the RAW 6-kind classification (matching `inferKind`
 * exactly) rather than pre-collapsing caption→text or shape→sticker itself —
 * that narrowing is `animationKindKey`'s job alone, kept as one single place
 * so this function stays a faithful, directly-comparable port.
 *
 * @param {object} clip
 * @param {string} [trackType]
 * @returns {'text'|'caption'|'image'|'video'|'sticker'|'shape'} a raw layer kind
 */
function layerKindForClip(clip, trackType) {
    const t = clip?.type || trackType;
    if (t === 'text') {
        return (Array.isArray(clip?.words) && clip.words.length > 0) || clip?.style === 'subtitle'
            ? 'caption'
            : 'text';
    }
    if (t === 'image')   return 'image';
    if (t === 'video')   return 'video';
    if (t === 'sticker') return 'sticker';
    if (t === 'shape')   return 'shape';
    // An 'overlay' TRACK holds clips typed 'sticker'/'image'/'shape' individually
    // (handled above); only reached when a clip on that track has no clip.type
    // of its own. Default to image, matching the client adapter's own default.
    if (t === 'overlay') return 'image';
    return 'text';
}

/**
 * `animations` is keyed by `text`/`video`/`image`/`sticker` (see the graph's
 * typedef above) — exactly `MotionPresets.js`'s 4 `PRESET_GROUPS` families —
 * but `layerKindForClip`/`inferKind` can return 6 raw kinds. This is the ONE
 * place that narrows them down: `caption` animates through the same `text`
 * family as plain text (it just carries word timings for the highlight
 * renderer), and `shape` through the same `sticker` family `PRESET_GROUPS`
 * already groups it into. Both real clip kinds, both share a preset family
 * with something else — narrowed here, once, rather than inside
 * `layerKindForClip` itself, so that function stays a faithful 1:1 port.
 *
 * @param {'text'|'caption'|'image'|'video'|'sticker'|'shape'} layerKind
 * @returns {'text'|'video'|'image'|'sticker'}
 */
function animationKindKey(layerKind) {
    if (layerKind === 'caption') return 'text';
    if (layerKind === 'shape')   return 'sticker';
    return layerKind;
}

/**
 * Animation preset ids for an event, filtered to a layer kind.
 * @param {string} eventType — TimelineEventType value
 * @param {'text'|'video'} layerKind
 * @returns {string[]} priority-ordered preset ids (possibly empty)
 */
function animationsForEventType(eventType, layerKind) {
    const entry = graphForEventType(eventType);
    if (!entry) return [];
    return entry.animations[animationKindKey(layerKind)] || [];
}

/** EditingIntent values for SFX resolution for an event. */
function sfxIntentsForEventType(eventType) {
    const entry = graphForEventType(eventType);
    return entry ? entry.sfxIntents : [];
}

/**
 * Given the already-detected semantic events and the full track list, find
 * every OVERLAY clip — a manually-placed image/sticker/shape (`track.type
 * === 'overlay'`), or a secondary/picture-in-picture video track
 * (`track.isSecondary || track.role === 'b-roll'`) — that is ON SCREEN at
 * each event's exact `timelineTime`, and resolve a plan item for it.
 *
 * Pure and synchronous: no Supabase, no SFX lookup (a moment should only
 * ever trigger ONE sound effect — the primary plan item already carries it;
 * this only ever returns visual plan items, always with `sfx: []`), so it is
 * directly unit-testable without a live server.
 *
 * @param {Array<{eventType:string, timelineTime:number, clipId:?string, trackId:?string}>} events
 * @param {Array<object>} tracks — projectState.tracks
 * @param {?string} [tone] — R82's cached project tone (or null), passed
 *   through from the route's ONE read-only ProjectIntelligence.getMap() call
 *   per request — this function never fetches it itself.
 * @returns {Array<{eventType:string, timelineTime:number, clipId:string, trackId:?string, presetId:string, secondaryPresetId:?string, intensity:number, sfx:[]}>}
 */
function resolveOverlayAnimations(events, tracks, tone = null) {
    if (!Array.isArray(events) || events.length === 0) return [];
    if (!Array.isArray(tracks) || tracks.length === 0) return [];

    const overlayAndPipClips = [];
    for (const track of tracks) {
        if (!track) continue;
        const isOverlayTrack  = track.type === 'overlay';
        const isPipVideoTrack = track.type === 'video' && (track.isSecondary || track.role === 'b-roll');
        if (!isOverlayTrack && !isPipVideoTrack) continue;
        for (const clip of (track.clips || [])) {
            if (!clip?.id) continue;
            const start = clip.startTime ?? clip.start ?? 0;
            const end   = clip.endTime ?? clip.end ?? (start + (clip.duration ?? 0));
            overlayAndPipClips.push({ clip, trackId: track.id || null, trackType: track.type, start, end });
        }
    }
    if (overlayAndPipClips.length === 0) return [];

    const extra = [];
    for (const event of events) {
        for (const overlay of overlayAndPipClips) {
            if (overlay.clip.id === event.clipId) continue; // already the primary target, don't double-apply
            if (event.timelineTime < overlay.start || event.timelineTime >= overlay.end) continue;

            const overlayKind = layerKindForClip(overlay.clip, overlay.trackType);
            const candidates = animationsForEventType(event.eventType, overlayKind);
            if (candidates.length === 0) continue; // e.g. emotional_beat has no sticker preset — deliberately silent, not an error
            // R81 — same intensity this event's PRIMARY plan item resolves
            // (see audioEngineRoutes.js), so an overlay reacting to the same
            // moment gets a proportionally-matched punch, not a mismatched one.
            const intensity = computeIntensity(event.eventType, event.metadata);
            const presetId  = pickPresetForIntensity(candidates, intensity);
            if (!presetId) continue;
            const secondaryPresetId = pickSecondaryPreset(presetId, computeStyleSeed(event, tone));

            extra.push({
                eventType:    event.eventType,
                timelineTime: event.timelineTime,
                clipId:       overlay.clip.id,
                trackId:      overlay.trackId,
                presetId,
                secondaryPresetId,
                intensity,
                sfx:          [],
            });
        }
    }
    return extra;
}

module.exports = {
    ANIMATION_KNOWLEDGE_GRAPH,
    SEMANTIC_EVENT_TYPES,
    graphForEventType,
    animationsForEventType,
    sfxIntentsForEventType,
    layerKindForClip,
    resolveOverlayAnimations,
};
