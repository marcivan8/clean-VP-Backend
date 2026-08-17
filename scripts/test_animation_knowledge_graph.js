#!/usr/bin/env node
/**
 * Regression: AI Animation Intelligence (CLAUDE.md R68) —
 * AnimationKnowledgeGraph.js, the 4 semantic-event heuristic emitters added
 * to TimelineEventDetector.js, the POST /api/audio/animate-automatically
 * route, and the `animate_automatically` AI-tool-switch wiring.
 *
 * Run: node scripts/test_animation_knowledge_graph.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const check = (n, c, d) => {
    if (c) { passed++; console.log(`  ✓ ${n}`); }
    else { failed++; console.log(`  ✗ ${n}`); if (d) console.log(`      ${d}`); }
};
const section = (t) => console.log(`\n${t}`);

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => {
    try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
    catch (err) { console.log(`  ✗ could not read ${rel} — ${err.code || err.message}`); failed++; return ''; }
};
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

const { TimelineEventType, EditingIntent } = require(path.join(ROOT, 'server/audio-engine/types.js'));
const { timelineEventDetector } = require(path.join(ROOT, 'server/audio-engine/timeline/TimelineEventDetector.js'));
const {
    ANIMATION_KNOWLEDGE_GRAPH,
    SEMANTIC_EVENT_TYPES,
    graphForEventType,
    animationsForEventType,
    sfxIntentsForEventType,
} = require(path.join(ROOT, 'server/audio-engine/timeline/AnimationKnowledgeGraph.js'));

section('1 · AnimationKnowledgeGraph — shape matches the feature request');
{
    check('has reveal/punchline/emphasis/emotional_beat entries',
        ['reveal', 'punchline', 'emphasis', 'emotional_beat'].every(k => ANIMATION_KNOWLEDGE_GRAPH[k]));

    const reveal = ANIMATION_KNOWLEDGE_GRAPH.reveal;
    check('reveal.animations.text uses REAL preset ids (scale-reveal, blur-reveal)',
        reveal.animations.text.includes('scale-reveal') && reveal.animations.text.includes('blur-reveal'));
    check('reveal.animations.video includes camera-push', reveal.animations.video.includes('camera-push'));
    check('reveal.sfxTerms mirrors the request example (riser, impact)',
        reveal.sfxTerms.includes('riser') && reveal.sfxTerms.includes('impact'));

    const punchline = ANIMATION_KNOWLEDGE_GRAPH.punchline;
    check('punchline.animations.text is "pop" (captionPop)', punchline.animations.text.includes('pop'));
    check('punchline.animations.video includes camera-shake', punchline.animations.video.includes('camera-shake'));

    check('every entry.eventType is a real TimelineEventType value',
        Object.values(ANIMATION_KNOWLEDGE_GRAPH).every(e => Object.values(TimelineEventType).includes(e.eventType)));
    check('every sfxIntents value is a real EditingIntent value',
        Object.values(ANIMATION_KNOWLEDGE_GRAPH).every(e => e.sfxIntents.every(i => Object.values(EditingIntent).includes(i))));

    check('SEMANTIC_EVENT_TYPES has exactly the 4 target events',
        SEMANTIC_EVENT_TYPES.length === 4 &&
        [TimelineEventType.REVEAL, TimelineEventType.PUNCHLINE_DETECTED, TimelineEventType.EMPHASIS_MOMENT, TimelineEventType.EMOTIONAL_BEAT]
            .every(t => SEMANTIC_EVENT_TYPES.includes(t)));

    check('graphForEventType resolves REVEAL', graphForEventType(TimelineEventType.REVEAL)?.event === 'reveal');
    check('graphForEventType returns null for an unknown type', graphForEventType('NOT_A_REAL_EVENT') === null);
    check('animationsForEventType filters by layer kind',
        animationsForEventType(TimelineEventType.REVEAL, 'text').includes('scale-reveal') &&
        !animationsForEventType(TimelineEventType.REVEAL, 'text').includes('camera-push'));
    check('sfxIntentsForEventType(PUNCHLINE_DETECTED) includes PUNCHLINE', sfxIntentsForEventType(TimelineEventType.PUNCHLINE_DETECTED).includes(EditingIntent.PUNCHLINE));
}

section('2 · TimelineEventDetector — PUNCHLINE_DETECTED / EMPHASIS_MOMENT from audio peaks');
{
    const tracks = [
        {
            id: 'a1', type: 'audio',
            clips: [
                { id: 'c1', start: 0, duration: 5, peaks: [{ offset: 4.5, db: -3 }] },     // silence then a loud peak → punchline
                { id: 'c2', start: 10, duration: 2, peaks: [{ offset: 0.2, db: -2 }] },    // standalone loud peak, no preceding silence → emphasis
            ],
        },
        { id: 'v1', type: 'video', clips: [{ id: 'vc1', start: 0, duration: 20 }] }, // gives the audio track a silence gap to compare against (no video silence needed; audio-track events only compare against SILENCE_END events, which only video track emits — see below)
    ];
    // SILENCE_START/END are only emitted from the video-track gap logic, so
    // build a synthetic case where the video track itself has the gap that
    // precedes the punchline peak at t=4.5 on the audio track.
    const gapTracks = [
        { id: 'v1', type: 'video', clips: [
            { id: 'vc1', start: 0, duration: 3 },
            { id: 'vc2', start: 4.2, duration: 5 }, // 1.2s silence gap: SILENCE_END fires at t=4.2
        ]},
        { id: 'a1', type: 'audio', clips: [
            { id: 'c1', start: 0, duration: 10, peaks: [{ offset: 4.6, db: -3 }] }, // peak at t=4.6, 0.4s after SILENCE_END(4.2)
        ]},
    ];
    const events = timelineEventDetector.detect({ tracks: gapTracks });
    const punchlines = events.filter(e => e.eventType === TimelineEventType.PUNCHLINE_DETECTED);
    check('a peak shortly after a silence gap fires PUNCHLINE_DETECTED', punchlines.length === 1, JSON.stringify(events.map(e => e.eventType)));

    const standaloneTracks = [
        { id: 'a1', type: 'audio', clips: [
            { id: 'c1', start: 0, duration: 10, peaks: [{ offset: 5, db: -2 }] }, // loud, no nearby silence at all
        ]},
    ];
    const events2 = timelineEventDetector.detect({ tracks: standaloneTracks });
    check('a standalone loud peak (no preceding silence) fires EMPHASIS_MOMENT instead',
        events2.some(e => e.eventType === TimelineEventType.EMPHASIS_MOMENT) &&
        !events2.some(e => e.eventType === TimelineEventType.PUNCHLINE_DETECTED));

    const quietTracks = [
        { id: 'a1', type: 'audio', clips: [{ id: 'c1', start: 0, duration: 10, peaks: [{ offset: 5, db: -20 }] }] },
    ];
    const events3 = timelineEventDetector.detect({ tracks: quietTracks });
    check('a quiet peak triggers neither PUNCHLINE_DETECTED nor EMPHASIS_MOMENT',
        !events3.some(e => e.eventType === TimelineEventType.PUNCHLINE_DETECTED || e.eventType === TimelineEventType.EMPHASIS_MOMENT));
}

section('3 · TimelineEventDetector — REVEAL from wording and from a big push-in');
{
    const wordingTracks = [
        { id: 't1', type: 'text', clips: [{ id: 'tc1', start: 2, duration: 1, text: "Here's what nobody tells you" }] },
    ];
    const events = timelineEventDetector.detect({ tracks: wordingTracks });
    check('reveal-coded caption wording fires REVEAL', events.some(e => e.eventType === TimelineEventType.REVEAL && e.metadata.via === 'keyword'));

    const plainTracks = [
        { id: 't1', type: 'text', clips: [{ id: 'tc1', start: 2, duration: 1, text: 'just a normal sentence' }] },
    ];
    const events2 = timelineEventDetector.detect({ tracks: plainTracks });
    check('plain caption wording does not fire REVEAL', !events2.some(e => e.eventType === TimelineEventType.REVEAL));

    const zoomTracks = [
        { id: 'v1', type: 'video', clips: [{ id: 'vc1', start: 0, duration: 3, zoom: 1.4 }] },
    ];
    const events3 = timelineEventDetector.detect({ tracks: zoomTracks });
    check('a big push-in (zoom ≥ 1.3) fires REVEAL via push-in', events3.some(e => e.eventType === TimelineEventType.REVEAL && e.metadata.via === 'push-in'));
    check('a big push-in still also fires the existing structural ZOOM_IN (additive, not a replacement)', events3.some(e => e.eventType === TimelineEventType.ZOOM_IN));

    const smallZoomTracks = [
        { id: 'v1', type: 'video', clips: [{ id: 'vc1', start: 0, duration: 3, zoom: 1.1 }] },
    ];
    const events4 = timelineEventDetector.detect({ tracks: smallZoomTracks });
    check('a modest zoom (below 1.3) fires ZOOM_IN but not REVEAL', events4.some(e => e.eventType === TimelineEventType.ZOOM_IN) && !events4.some(e => e.eventType === TimelineEventType.REVEAL));
}

section('4 · TimelineEventDetector — EMOTIONAL_BEAT from a real pause + emotional wording');
{
    const tracks = [
        { id: 'v1', type: 'video', clips: [
            { id: 'vc1', start: 0, duration: 3 },
            { id: 'vc2', start: 4.5, duration: 5 }, // 1.5s gap ≥ EMOTIONAL_SILENCE_S
        ]},
        { id: 't1', type: 'text', clips: [
            { id: 'tc1', start: 3.2, duration: 1, text: 'I miss you every day' },
        ]},
    ];
    const events = timelineEventDetector.detect({ tracks });
    check('a real pause covered by emotional wording fires EMOTIONAL_BEAT', events.some(e => e.eventType === TimelineEventType.EMOTIONAL_BEAT));

    const noWordingTracks = [
        { id: 'v1', type: 'video', clips: [
            { id: 'vc1', start: 0, duration: 3 },
            { id: 'vc2', start: 4.5, duration: 5 },
        ]},
    ];
    const events2 = timelineEventDetector.detect({ tracks: noWordingTracks });
    check('a pause with no nearby wording does not fire EMOTIONAL_BEAT', !events2.some(e => e.eventType === TimelineEventType.EMOTIONAL_BEAT));

    const shortPauseTracks = [
        { id: 'v1', type: 'video', clips: [
            { id: 'vc1', start: 0, duration: 3 },
            { id: 'vc2', start: 3.4, duration: 5 }, // 0.4s gap — below EMOTIONAL_SILENCE_S
        ]},
        { id: 't1', type: 'text', clips: [{ id: 'tc1', start: 3.1, duration: 1, text: 'I miss you every day' }] },
    ];
    const events3 = timelineEventDetector.detect({ tracks: shortPauseTracks });
    check('a too-short pause does not fire EMOTIONAL_BEAT even with matching wording', !events3.some(e => e.eventType === TimelineEventType.EMOTIONAL_BEAT));
}

section('5 · backend route wiring (server/routes/audioEngineRoutes.js)');
{
    const routes = read('server/routes/audioEngineRoutes.js');
    check("POST /animate-automatically route exists", /router\.post\('\/animate-automatically'/.test(routes));
    check('route is authenticated (personalised, matches /recommend precedent)', /router\.post\('\/animate-automatically',\s*authenticateUser/.test(routes));
    check('route requires projectState.tracks', /projectState\.tracks/.test(routes));
    check('route imports timelineEventDetector', /timelineEventDetector/.test(routes));
    check('route imports AnimationKnowledgeGraph helpers', /animationsForEventType/.test(routes) && /sfxIntentsForEventType/.test(routes));
    check('route calls taxonomyService.getSFXByIntents', /taxonomyService\.getSFXByIntents/.test(routes));
    check('route filters to SEMANTIC_EVENT_TYPES only', /SEMANTIC_EVENT_TYPES\.includes/.test(routes));

    const indexJs = read('index.js');
    check('index.js mounts audioEngineRoutes on /api/audio (pre-existing — confirms this route is reachable)',
        /app\.use\('\/api\/audio',\s*require\('\.\/server\/routes\/audioEngineRoutes'\)\)/.test(indexJs));
}

section('6 · AI-tool switch wiring (client/src/agent/MediaExecutionEngine.js)');
{
    const mee = read('client/src/agent/MediaExecutionEngine.js');
    check("case 'animate_automatically' exists", /case 'animate_automatically':/.test(mee));
    check('imports applyPresetToClip from ClipAdapter', /import \{ applyPresetToClip \} from '\.\.\/motion\/ClipAdapter\.js'/.test(mee));
    check('posts to /api/audio/animate-automatically', /\/api\/audio\/animate-automatically/.test(mee));
    check('saves history ONCE before applying the plan (one undoable action)', /aaStore\._saveHistory\?\.\(\)/.test(mee));
    check('applies clip updates with skipHistory (fans out under the one saved snapshot)', /aaStore\.updateClip\(trackId, clipId, updates, \{ skipHistory: true \}\)/.test(mee));
    check('inserts SFX clips with skipHistory too', /aaStore\.addClip\(sfxTrackId,[\s\S]{0,800}skipHistory: true/.test(mee));
    check('reuses an existing "SFX" track instead of creating one per event', /t\.type === 'audio' && t\.name === 'SFX'/.test(mee));
}

section('7 · pure-module sanity — MotionPresets ids referenced by the graph actually exist');
{
    // Cross-check against the real preset registry so the graph can never
    // silently reference a preset id that MotionPresets.js doesn't have.
    let src = read('client/src/motion/MotionPresets.js');
    src = src
        .replace(/^\s*import\s+[^;]+;\s*$/gm, '// stub\nconst createAnimation = () => ({}); const createKeyframe = (t, p) => ({ t, ...p }); const ANIMATION_TYPES = new Proxy({}, { get: () => "x" }); const LAYER_KINDS = new Proxy({}, { get: () => "x" });')
        .replace(/^\s*export\s+default\s+\{[\s\S]*?\};\s*$/gm, '')
        .replace(/\bexport\s+(const|function)\b/g, '$1');
    src += '\nreturn { MOTION_PRESETS };';
    // eslint-disable-next-line no-new-func
    const { MOTION_PRESETS } = new Function(src)();

    const allGraphPresetIds = Object.values(ANIMATION_KNOWLEDGE_GRAPH)
        .flatMap(e => [...e.animations.text, ...e.animations.video]);
    check('every preset id in the knowledge graph exists in MOTION_PRESETS',
        allGraphPresetIds.every(id => Object.prototype.hasOwnProperty.call(MOTION_PRESETS, id)),
        `missing: ${allGraphPresetIds.filter(id => !Object.prototype.hasOwnProperty.call(MOTION_PRESETS, id)).join(', ')}`);
}

console.log(`\n${'─'.repeat(60)}\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
