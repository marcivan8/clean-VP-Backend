#!/usr/bin/env node
/**
 * Regression: real-timeline "best part" extraction + chapter markers.
 *
 * Two gaps this closes:
 *   1. "find the best part"/"find the hook" (VideoEditorTools.findHook) used
 *      to only move the playhead and report a timestamp in chat, while "best
 *      moments"/"highlight reel" (identifyQuotableMoments) created a real
 *      clip on a new Highlights track — same request, two outcomes depending
 *      on phrasing. Both now go through the same two pure helpers
 *      (findCoveringClipBySourceTime, buildHighlightClipPayload) so they
 *      produce the identical real timeline edit.
 *   2. "segment the video"/"generate chapters" (VideoEditorTools.
 *      analyzeStructure) used to be chat-only — IntentParser.js said so
 *      outright ("analyze_structure only summarises — it never changes the
 *      timeline"). It now places real chapter-marker clips
 *      (type:'marker', isChapter:true) on a new "Chapters" video track via
 *      buildChapterMarkerPayloads, from the same structure.sections data
 *      that was previously computed and discarded. TimelineEventDetector.js
 *      already read `clip.isChapter || clip.type === 'marker'` for its
 *      CHAPTER_START event (R68 animation/SFX intelligence) — that branch
 *      was permanently dead before this fix, since nothing ever wrote that
 *      shape; it needed zero changes to start working.
 *
 * All three functions under test are pure (no store access), evaluated
 * directly from the real client source via the CJS-strip-eval harness this
 * codebase already uses (test_overlay_animation_intelligence.js §3,
 * test_animation_knowledge_graph.js §7) — so this is the real code, not a
 * reimplementation that could drift from it.
 *
 * Run: node scripts/test_hook_and_chapter_markers.js
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

// ── Extract the three pure helpers from the real client source ─────────────
const vetSrcRaw = read('client/src/agent/VideoEditorTools.js');

let helpers = null;
{
    let src = vetSrcRaw
        // Strip every top-level import line — none of these three pure
        // helpers reference them, so nothing needs stubbing.
        .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
        .replace(/\bexport\s+(const|function|class)\b/g, '$1');

    // Stop before the class body — VideoEditorTools' methods reference
    // useTimelineStore/ContentAnalyzer/LongFormEditPlanner, which we stripped
    // the imports for. We never call any class method here, so merely
    // *defining* the class (not invoking it) is safe even with those names
    // unresolved inside method bodies — but slice it off anyway to keep the
    // evaluated surface minimal and intent-revealing.
    const classStart = src.indexOf('class VideoEditorTools {');
    if (classStart !== -1) src = src.slice(0, classStart);

    src += '\nreturn { findCoveringClipBySourceTime, buildHighlightClipPayload, buildChapterMarkerPayloads };';

    try {
        // eslint-disable-next-line no-new-func
        helpers = new Function(src)();
    } catch (err) {
        failed++; console.log(`  ✗ could not evaluate VideoEditorTools.js helpers — ${err.message}`);
    }
}

const findCoveringClipBySourceTime = helpers?.findCoveringClipBySourceTime;
const buildHighlightClipPayload   = helpers?.buildHighlightClipPayload;
const buildChapterMarkerPayloads  = helpers?.buildChapterMarkerPayloads;

section('1 · findCoveringClipBySourceTime — source-time (not timeline-time) clip lookup');
{
    const clips = [
        { id: 'a', offset: 0,  duration: 10 },   // source 0–10
        { id: 'b', offset: 10, duration: 20 },   // source 10–30
        { id: 'c', start: 30,  duration: 15 },   // no .offset — falls back to .start (source 30–45)
    ];

    check('is a function (real export survived the strip)', typeof findCoveringClipBySourceTime === 'function');
    check('mid-range match picks the right clip', findCoveringClipBySourceTime(clips, 15)?.id === 'b');
    check('a shared boundary (clip a ends at 10, clip b starts at 10) — both are inclusive, first-listed wins',
        findCoveringClipBySourceTime(clips, 10)?.id === 'a',
        'clip a satisfies srcTime <= srcEnd (10<=10) and clip b satisfies srcTime >= srcStart (10>=10) — Array.find returns the first match, clip a');
    check('upper boundary is inclusive (srcTime === srcEnd, no clip after it)', findCoveringClipBySourceTime(clips, 30)?.id === 'b',
        'clip b ends at 30 and no other clip starts there in this fixture, so srcTime<=srcEnd alone resolves it');
    check('falls back to clip.start when clip.offset is absent', findCoveringClipBySourceTime(clips, 40)?.id === 'c');
    check('srcTime outside every clip returns undefined', findCoveringClipBySourceTime(clips, 1000) === undefined);
    check('empty clip list returns undefined', findCoveringClipBySourceTime([], 5) === undefined);
}

section('2 · buildHighlightClipPayload — shared by identifyQuotableMoments AND findHook');
{
    const baseClip = { id: 'orig-clip-1', assetId: 'asset-9', url: 'blob:xyz', type: 'video', offset: 100, duration: 500 };
    const payload = buildHighlightClipPayload(baseClip, 120, 150, 'Hook (2m00s)');

    check('is a function', typeof buildHighlightClipPayload === 'function');
    check('duration is segEnd - segStart', payload.duration === 30);
    check('starts at 0 on its own new track (not the source timeline position)', payload.start === 0);
    check('offset is segStart (source-time entry point into the base clip)', payload.offset === 120);
    check('name is passed through unmodified', payload.name === 'Hook (2m00s)');
    check('media fields are copied from baseClip', payload.assetId === 'asset-9' && payload.url === 'blob:xyz' && payload.type === 'video');
    check('gets its OWN new id — never reuses baseClip.id', payload.id !== baseClip.id && /^clip_quote_/.test(payload.id));

    const degenerate = buildHighlightClipPayload({ id: 'z' }, 5, 5, 'Zero-length');
    check('degenerate zero-length segment is floored to 0.1s, not 0', degenerate.duration === 0.1);

    const noSegStart = buildHighlightClipPayload({ id: 'z' }, undefined, 10, 'No start');
    check('missing segStart falls back to offset 0', noSegStart.offset === 0);
}

section('3 · buildChapterMarkerPayloads — the previously-dead CHAPTER_START producer');
{
    check('is a function', typeof buildChapterMarkerPayloads === 'function');
    check('non-array input returns []', Array.isArray(buildChapterMarkerPayloads(null)) && buildChapterMarkerPayloads(null).length === 0);
    check('empty array returns []', buildChapterMarkerPayloads([]).length === 0);

    const sections = [
        { start: 0,  end: 45,  topic: 'Introduction', type: 'intro' },
        { start: 45, end: 120, type: 'main' },                          // no topic — falls back to type
        { start: 120, end: 120 },                                       // no topic, no type, zero-length
    ];
    const payloads = buildChapterMarkerPayloads(sections);

    check('one payload per section', payloads.length === 3);
    check('every payload is a real marker clip: type "marker" + isChapter true', payloads.every(p => p.type === 'marker' && p.isChapter === true),
        'this is exactly the shape TimelineEventDetector.js checks: clip.isChapter || clip.type === "marker"');
    check('label prefers topic over type', payloads[0].label === 'Introduction');
    check('label falls back to type when topic is absent', payloads[1].label === 'main');
    check('label falls back to "Chapter N" when neither topic nor type is present', payloads[2].label === 'Chapter 3');
    check('offset is always 0 — a marker has no source media to offset into', payloads.every(p => p.offset === 0));
    check('zero-length section duration is floored to 0.1s', payloads[2].duration === 0.1);
    check('ids are unique across the batch', new Set(payloads.map(p => p.id)).size === 3);
    check('name embeds a 1-indexed chapter number and the label', payloads[0].name === 'Chapter 1 — Introduction');
}

section('4 · Static wiring — findHook, identifyQuotableMoments, analyzeStructure actually call the helpers');
{
    check('identifyQuotableMoments calls findCoveringClipBySourceTime(allClips, seg.start)',
        /findCoveringClipBySourceTime\(allClips,\s*seg\.start\)/.test(vetSrcRaw));
    check('identifyQuotableMoments calls buildHighlightClipPayload(...) to build the clip it adds',
        /state\.addClip\(highlightsTrackId,\s*buildHighlightClipPayload\(/.test(vetSrcRaw));

    check('findHook now scans video tracks for a base clip (real edit, not just a seek)',
        /async findHook\(\)[\s\S]{0,2000}videoTracks = state\.tracks\.filter\(t => t\.type === 'video'\)/.test(vetSrcRaw));
    check('findHook calls findCoveringClipBySourceTime(allClips, hook.start)',
        /findCoveringClipBySourceTime\(allClips,\s*hook\.start\)/.test(vetSrcRaw));
    check('findHook calls buildHighlightClipPayload(baseClip, hook.start, hook.end, ...)',
        /buildHighlightClipPayload\(baseClip,\s*hook\.start,\s*hook\.end,/.test(vetSrcRaw));
    check('findHook returns clipId in its result (so callers/tests can see the real edit happened)',
        /clipId:\s*highlightClipId/.test(vetSrcRaw));

    check('analyzeStructure reads result.structure?.sections (the field the server route actually merges into)',
        /const sections = result\.structure\?\.sections/.test(vetSrcRaw));
    check('analyzeStructure creates a dedicated video track and renames it "Chapters"',
        /chaptersTrackId = state\.addTrack\('video'\)[\s\S]{0,120}renameTrack\(chaptersTrackId,\s*'Chapters'\)/.test(vetSrcRaw));
    check('analyzeStructure calls buildChapterMarkerPayloads(sections) and adds each as a real clip',
        /for \(const payload of buildChapterMarkerPayloads\(sections\)\) \{\s*state\.addClip\(chaptersTrackId, payload\)/.test(vetSrcRaw));
    check('analyzeStructure returns chaptersCreated in its result',
        /chaptersCreated,\s*\n\s*\};\s*\n\s*\}/.test(vetSrcRaw) || /chaptersCreated,/.test(vetSrcRaw));
    check('degraded (offline-fallback) analysis path still skips marker creation — same false-confidence reasoning as before',
        /result\.success && result\.localFallback\)[\s\S]{0,600}chaptersCreated: 0/.test(vetSrcRaw));
}

section('5 · TimelineEventDetector.js — the consumer side is untouched and still correct');
{
    const detSrc = read('server/audio-engine/timeline/TimelineEventDetector.js');
    check('CHAPTER_START still fires on clip.isChapter || clip.type === "marker"',
        /if \(clip\.isChapter \|\| clip\.type === 'marker'\)/.test(detSrc));
    check('doc header now names VideoEditorTools.analyzeStructure as the producer (no longer a dangling reference)',
        /VideoEditorTools\.analyzeStructure/.test(detSrc));
    check('detection still only runs over video-type tracks (markers must live on a video track)',
        /type === 'video'\) \{\s*\n\s*this\._detectVideoEvents/.test(read('server/audio-engine/timeline/TimelineEventDetector.js').replace(/\r/g, '')) ||
        /_detectVideoEvents\(clips, track, events\)/.test(detSrc));
}

section('6 · IntentParser.js — stale "never changes the timeline" claim removed');
{
    const ipSrc = read('client/src/agent/IntentParser.js');
    check('the old blanket claim is gone', !ipSrc.includes('analyze_structure only summarises — it never changes the timeline.'));
    check('"find the best part" is still routed to the hook intent (unchanged trigger phrase)',
        /hook:\s*\[[\s\S]{0,300}'find the best part'/.test(ipSrc));
    check('"segment" is still routed to the analyze intent (unchanged trigger phrase)',
        /analyze:\s*\[[\s\S]{0,300}'segment'/.test(ipSrc));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
