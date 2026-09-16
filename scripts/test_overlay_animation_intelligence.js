#!/usr/bin/env node
/**
 * Regression: Overlay/PiP Animation Intelligence — the extension to R68 (AI
 * Animation Intelligence) that teaches the brain to animate content that
 * isn't the base video/caption: images/stickers/shapes manually placed on
 * the 'overlay' track, and secondary/picture-in-picture video tracks.
 *
 * Three things are new, each tested here:
 *   1. `layerKindForClip` — a server-side port of `ClipAdapter.inferKind()`,
 *      checked for TRUE PARITY against the real client function (drift
 *      detection, same technique R69's byte-match check uses).
 *   2. `animationKindKey` — narrows the 6 raw kinds down to the graph's 4
 *      real preset families (caption→text, shape→sticker).
 *   3. `resolveOverlayAnimations` — pure function that finds whatever
 *      overlay/PiP clip is on screen at each detected moment and resolves
 *      its own plan item, without duplicating the primary target or firing
 *      SFX twice for one moment.
 *
 * Run: node scripts/test_overlay_animation_intelligence.js
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

const { TimelineEventType } = require(path.join(ROOT, 'server/audio-engine/types.js'));
const {
    ANIMATION_KNOWLEDGE_GRAPH,
    animationsForEventType,
    layerKindForClip,
    resolveOverlayAnimations,
} = require(path.join(ROOT, 'server/audio-engine/timeline/AnimationKnowledgeGraph.js'));

section('1 · AnimationKnowledgeGraph — image/sticker families exist on all 4 events');
{
    check('reveal.animations.image includes the real "reveal" preset',
        ANIMATION_KNOWLEDGE_GRAPH.reveal.animations.image.includes('reveal'));
    check('reveal.animations.sticker includes sticker-pop',
        ANIMATION_KNOWLEDGE_GRAPH.reveal.animations.sticker.includes('sticker-pop'));
    check('punchline.animations.image is a real preset (zoom)',
        ANIMATION_KNOWLEDGE_GRAPH.punchline.animations.image.includes('zoom'));
    check('emphasis.animations.image differs from punchline.animations.image (distinct feel per event)',
        JSON.stringify(ANIMATION_KNOWLEDGE_GRAPH.emphasis.animations.image) !==
        JSON.stringify(ANIMATION_KNOWLEDGE_GRAPH.punchline.animations.image));
    check('emotional_beat.animations.video is STILL deliberately empty (restraint unchanged)',
        Array.isArray(ANIMATION_KNOWLEDGE_GRAPH.emotional_beat.animations.video) &&
        ANIMATION_KNOWLEDGE_GRAPH.emotional_beat.animations.video.length === 0);
    check('emotional_beat.animations.sticker is ALSO deliberately empty (same restraint extended to stickers)',
        Array.isArray(ANIMATION_KNOWLEDGE_GRAPH.emotional_beat.animations.sticker) &&
        ANIMATION_KNOWLEDGE_GRAPH.emotional_beat.animations.sticker.length === 0);
    check('emotional_beat.animations.image is non-empty — the one deliberate exception (a gentle float)',
        ANIMATION_KNOWLEDGE_GRAPH.emotional_beat.animations.image.includes('float'));
}

section('2 · animationsForEventType — resolves image/sticker kinds, and narrows caption/shape');
{
    check('reveal + "image" kind returns the image family',
        animationsForEventType(TimelineEventType.REVEAL, 'image').includes('reveal'));
    check('reveal + "caption" kind narrows to the TEXT family (same as plain text)',
        JSON.stringify(animationsForEventType(TimelineEventType.REVEAL, 'caption')) ===
        JSON.stringify(animationsForEventType(TimelineEventType.REVEAL, 'text')));
    check('punchline + "shape" kind narrows to the STICKER family',
        JSON.stringify(animationsForEventType(TimelineEventType.PUNCHLINE_DETECTED, 'shape')) ===
        JSON.stringify(animationsForEventType(TimelineEventType.PUNCHLINE_DETECTED, 'sticker')));
    check('emotional_beat + "sticker" kind resolves to an empty list, not an error',
        Array.isArray(animationsForEventType(TimelineEventType.EMOTIONAL_BEAT, 'sticker')) &&
        animationsForEventType(TimelineEventType.EMOTIONAL_BEAT, 'sticker').length === 0);
}

section('3 · layerKindForClip — every branch, and TRUE PARITY with the real client ClipAdapter.inferKind()');
{
    check('plain text clip (no words) → text', layerKindForClip({ type: 'text' }, 'text') === 'text');
    check('text clip with word timings → caption', layerKindForClip({ type: 'text', words: [{ w: 'hi' }] }, 'text') === 'caption');
    check('text clip with style "subtitle" → caption', layerKindForClip({ type: 'text', style: 'subtitle' }, 'text') === 'caption');
    check('image clip → image', layerKindForClip({ type: 'image' }, 'overlay') === 'image');
    check('video clip → video', layerKindForClip({ type: 'video' }, 'video') === 'video');
    check('sticker clip → sticker', layerKindForClip({ type: 'sticker' }, 'overlay') === 'sticker');
    check('shape clip → shape (raw, NOT pre-collapsed)', layerKindForClip({ type: 'shape' }, 'overlay') === 'shape');
    check('overlay-track clip with no clip.type → defaults to image', layerKindForClip({}, 'overlay') === 'image');
    check('unknown/undefined type → defaults to text', layerKindForClip({}, 'mystery-type') === 'text');

    // Cross-check against the REAL client function via the same CJS-strip-eval
    // harness technique test_animation_knowledge_graph.js §7 already uses.
    let src = read('client/src/motion/ClipAdapter.js');
    src = src
        .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
        .replace(/^\s*export\s+default\s+\{[\s\S]*?\};\s*$/gm, '')
        .replace(/\bexport\s+(const|function)\b/g, '$1');
    src = 'const LAYER_KINDS = { CAPTION: "caption", TEXT: "text", IMAGE: "image", VIDEO: "video", STICKER: "sticker", SHAPE: "shape" };\n'
        + 'const createMotionLayer = () => ({});\nconst buildPreset = () => [];\nconst LEGACY_ANIMATION_MAP = {};\n'
        + src
        + '\nreturn { inferKind };';
    let realInferKind = null;
    try {
        // eslint-disable-next-line no-new-func
        realInferKind = new Function(src)().inferKind;
    } catch (err) {
        failed++; console.log(`  ✗ could not evaluate ClipAdapter.js for parity check — ${err.message}`);
    }

    if (typeof realInferKind === 'function') {
        const matrix = [
            [{ type: 'text' }, 'text'],
            [{ type: 'text', words: [{ w: 'hi' }] }, 'text'],
            [{ type: 'text', style: 'subtitle' }, 'text'],
            [{ type: 'image' }, 'overlay'],
            [{ type: 'video' }, 'video'],
            [{ type: 'sticker' }, 'overlay'],
            [{ type: 'shape' }, 'overlay'],
            [{}, 'overlay'],
            [{}, 'video'],
            [{ type: 'weird' }, 'weird'],
        ];
        const mismatches = matrix
            .map(([clip, trackType]) => ({
                clip, trackType,
                real: realInferKind(clip, trackType),
                server: layerKindForClip(clip, trackType),
            }))
            .filter(r => r.real !== r.server);
        check('layerKindForClip agrees with the REAL ClipAdapter.inferKind() across every case in the matrix',
            mismatches.length === 0,
            mismatches.map(m => `clip=${JSON.stringify(m.clip)} track=${m.trackType}: real="${m.real}" server="${m.server}"`).join('; '));
    }
}

section('4 · resolveOverlayAnimations — the core new behaviour, fully executed against synthetic tracks');
{
    const punchlineEvent = { eventType: TimelineEventType.PUNCHLINE_DETECTED, timelineTime: 5.0, clipId: 'base-vc1', trackId: 'v1' };

    // ── 4a. An image overlay ON SCREEN at the event's moment gets its own plan item ──
    {
        const tracks = [
            { id: 'v1', type: 'video', clips: [{ id: 'base-vc1', start: 0, duration: 20 }] },
            { id: 'ov1', type: 'overlay', clips: [{ id: 'img1', type: 'image', start: 3, duration: 4 }] }, // on screen 3-7s, covers t=5
        ];
        const extra = resolveOverlayAnimations([punchlineEvent], tracks);
        check('overlay image active at the moment gets exactly one plan item',
            extra.length === 1, `got ${extra.length}`);
        check('plan item targets the overlay clip, not the primary clip',
            extra[0]?.clipId === 'img1');
        check('plan item uses the IMAGE preset family for punchline (zoom)',
            extra[0]?.presetId === ANIMATION_KNOWLEDGE_GRAPH.punchline.animations.image[0]);
        check('overlay-derived plan items never carry SFX (only the primary item does)',
            Array.isArray(extra[0]?.sfx) && extra[0].sfx.length === 0);
    }

    // ── 4b. An overlay clip OUTSIDE the event's time window gets nothing ──
    {
        const tracks = [
            { id: 'v1', type: 'video', clips: [{ id: 'base-vc1', start: 0, duration: 20 }] },
            { id: 'ov1', type: 'overlay', clips: [{ id: 'img1', type: 'image', start: 10, duration: 4 }] }, // 10-14s, does NOT cover t=5
        ];
        const extra = resolveOverlayAnimations([punchlineEvent], tracks);
        check('overlay image outside the event window produces no plan item', extra.length === 0);
    }

    // ── 4c. Half-open interval — the boundary itself does not count as "on screen" ──
    {
        const boundaryEvent = { ...punchlineEvent, timelineTime: 7.0 };
        const tracks = [
            { id: 'v1', type: 'video', clips: [{ id: 'base-vc1', start: 0, duration: 20 }] },
            { id: 'ov1', type: 'overlay', clips: [{ id: 'img1', type: 'image', start: 3, duration: 4 }] }, // ends exactly at 7
        ];
        const extra = resolveOverlayAnimations([boundaryEvent], tracks);
        check('an overlay clip that ends exactly AT the event time is excluded (half-open [start, end))', extra.length === 0);
    }

    // ── 4d. The event's own primary clip is never double-applied even if it matches an "overlay" scan ──
    {
        const tracks = [
            { id: 'v1', type: 'video', isSecondary: true, clips: [{ id: 'base-vc1', start: 0, duration: 20 }] },
        ];
        // punchlineEvent.clipId === 'base-vc1', and this track IS a PiP-qualifying
        // track (isSecondary) — without the self-exclusion this would double-apply.
        const extra = resolveOverlayAnimations([punchlineEvent], tracks);
        check('the event\'s own primary clip is excluded from the overlay scan even on a PiP-flagged track', extra.length === 0);
    }

    // ── 4e. Picture-in-picture video (isSecondary) gets VIDEO-family presets, not image/sticker ──
    {
        const tracks = [
            { id: 'v1', type: 'video', clips: [{ id: 'base-vc1', start: 0, duration: 20 }] },
            { id: 'v2', type: 'video', isSecondary: true, clips: [{ id: 'pip1', start: 3, duration: 4 }] },
        ];
        const extra = resolveOverlayAnimations([punchlineEvent], tracks);
        check('PiP video clip (isSecondary) active at the moment gets exactly one plan item', extra.length === 1);
        check('PiP video plan item uses the VIDEO/camera preset family, not image/sticker',
            extra[0]?.presetId === ANIMATION_KNOWLEDGE_GRAPH.punchline.animations.video[0]);
    }

    // ── 4f. role: 'b-roll' is the OTHER recognised PiP signal (OR condition) ──
    {
        const tracks = [
            { id: 'v1', type: 'video', clips: [{ id: 'base-vc1', start: 0, duration: 20 }] },
            { id: 'v2', type: 'video', role: 'b-roll', clips: [{ id: 'broll1', start: 3, duration: 4 }] },
        ];
        const extra = resolveOverlayAnimations([punchlineEvent], tracks);
        check('a role:"b-roll" secondary video track is also recognised as PiP', extra.length === 1 && extra[0]?.clipId === 'broll1');
    }

    // ── 4g. A regular (non-secondary, non-b-roll) second video track is NOT scanned ──
    {
        const tracks = [
            { id: 'v1', type: 'video', clips: [{ id: 'base-vc1', start: 0, duration: 20 }] },
            { id: 'v2', type: 'video', clips: [{ id: 'other1', start: 3, duration: 4 }] }, // ordinary track, no isSecondary/b-roll flag
        ];
        const extra = resolveOverlayAnimations([punchlineEvent], tracks);
        check('an ordinary (non-PiP) second video track produces no extra plan items', extra.length === 0);
    }

    // ── 4h. An event/kind combo with no preset (emotional_beat + sticker) is silently skipped ──
    {
        const beatEvent = { eventType: TimelineEventType.EMOTIONAL_BEAT, timelineTime: 5.0, clipId: 'cap1', trackId: 't1' };
        const tracks = [
            { id: 't1', type: 'text', clips: [{ id: 'cap1', start: 4, duration: 3 }] },
            { id: 'ov1', type: 'overlay', clips: [{ id: 'stk1', type: 'sticker', start: 3, duration: 4 }] },
        ];
        const extra = resolveOverlayAnimations([beatEvent], tracks);
        check('emotional_beat + sticker overlay resolves to no plan item (empty preset list), not a crash', extra.length === 0);
    }

    // ── 4i. Multiple overlays present at the same moment each get their own item ──
    {
        const tracks = [
            { id: 'v1', type: 'video', clips: [{ id: 'base-vc1', start: 0, duration: 20 }] },
            { id: 'ov1', type: 'overlay', clips: [
                { id: 'img1', type: 'image', start: 3, duration: 4 },
                { id: 'stk1', type: 'sticker', start: 4, duration: 2 },
            ] },
        ];
        const extra = resolveOverlayAnimations([punchlineEvent], tracks);
        check('two overlay clips simultaneously on screen both get their own plan item', extra.length === 2);
        const clipIds = extra.map(e => e.clipId).sort();
        check('both distinct overlay clips are represented', JSON.stringify(clipIds) === JSON.stringify(['img1', 'stk1']));
    }

    // ── 4j. Edge cases — empty inputs never throw, always return [] ──
    {
        check('empty events array → []', resolveOverlayAnimations([], [{ id: 't1', type: 'overlay', clips: [] }]).length === 0);
        check('empty tracks array → []', resolveOverlayAnimations([punchlineEvent], []).length === 0);
        check('undefined events/tracks never throw',
            (() => { try { resolveOverlayAnimations(undefined, undefined); return true; } catch { return false; } })());
    }
}

section('5 · route wiring (server/routes/audioEngineRoutes.js)');
{
    const src = read('server/routes/audioEngineRoutes.js');
    check('route imports layerKindForClip', /layerKindForClip/.test(src));
    check('route imports resolveOverlayAnimations', /resolveOverlayAnimations/.test(src));
    check('route calls resolveOverlayAnimations and appends to plan', /plan\.push\(\.\.\.resolveOverlayAnimations\(/.test(src));
    check('route no longer uses the old crude text-vs-video ternary for clip kind',
        !/t === 'text' \|\| t === 'caption' \|\| clip\.isCaption\) \? 'text' : 'video'/.test(src));
}

console.log(`\n${'─'.repeat(60)}\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
