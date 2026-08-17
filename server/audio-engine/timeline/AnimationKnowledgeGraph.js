'use strict';

/**
 * server/audio-engine/timeline/AnimationKnowledgeGraph.js
 *
 * "Brain chooses animations. Users don't."
 *
 * Maps a detected semantic timeline event (reveal / punchline / emphasis /
 * emotional beat) to the REAL motion preset ids the client's motion engine
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

/**
 * @typedef {Object} KnowledgeGraphEntry
 * @property {string}   event        — lowercase event key (matches the user-facing name)
 * @property {string}   eventType    — the TimelineEventType this entry answers for
 * @property {{text: string[], video: string[]}} animations — MotionPresets ids by layer kind, priority-ordered
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
            text:  ['scale-reveal', 'blur-reveal'],
            video: ['camera-push'],
        },
        sfxIntents: [EditingIntent.REVEAL, EditingIntent.INTRO],
        sfxTerms: ['riser', 'impact', 'reveal'],
    },
    punchline: {
        event: 'punchline',
        eventType: TimelineEventType.PUNCHLINE_DETECTED,
        animations: {
            text:  ['pop'],
            video: ['camera-shake'],
        },
        sfxIntents: [EditingIntent.PUNCHLINE, EditingIntent.COMEDY],
        sfxTerms: ['punchline', 'vine boom', 'boing'],
    },
    emphasis: {
        event: 'emphasis',
        eventType: TimelineEventType.EMPHASIS_MOMENT,
        animations: {
            text:  ['glow-reveal'],
            video: ['camera-zoom'],
        },
        sfxIntents: [EditingIntent.IMPACT, EditingIntent.ZOOM_PUNCH],
        sfxTerms: ['impact', 'punch', 'boom'],
    },
    emotional_beat: {
        event: 'emotional_beat',
        eventType: TimelineEventType.EMOTIONAL_BEAT,
        animations: {
            text:  ['fade'],
            video: [],
        },
        sfxIntents: [EditingIntent.EMOTIONAL_BEAT, EditingIntent.STORYTELLING],
        sfxTerms: ['emotional beat', 'emotional', 'guitar'],
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
 * Animation preset ids for an event, filtered to a layer kind.
 * @param {string} eventType — TimelineEventType value
 * @param {'text'|'video'} layerKind
 * @returns {string[]} priority-ordered preset ids (possibly empty)
 */
function animationsForEventType(eventType, layerKind) {
    const entry = graphForEventType(eventType);
    if (!entry) return [];
    return entry.animations[layerKind] || [];
}

/** EditingIntent values for SFX resolution for an event. */
function sfxIntentsForEventType(eventType) {
    const entry = graphForEventType(eventType);
    return entry ? entry.sfxIntents : [];
}

module.exports = {
    ANIMATION_KNOWLEDGE_GRAPH,
    SEMANTIC_EVENT_TYPES,
    graphForEventType,
    animationsForEventType,
    sfxIntentsForEventType,
};
