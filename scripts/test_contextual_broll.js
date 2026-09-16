#!/usr/bin/env node
/**
 * Regression: content-aware b-roll placement (place_contextual_broll).
 *
 * Follow-up to "can the brain organize the timeline knowing some clips
 * should go as overlay while the main video is talking, to illustrate or
 * transition to a different topic/chapter?" (the user's own vlog example —
 * interview + walking/equipment/project b-roll shots).
 *
 * Three things this closes:
 *   1. VisualAnalyzer's per-clip content profiles (content_description,
 *      scene_type, etc.) were computed and stored but nothing ever matched
 *      them against WHEN something is being said in the dialogue — that
 *      intelligence only ever reached the user as generic chat advice.
 *      New pure helpers (tokenizeForBrollMatch, buildBrollCandidates,
 *      matchTranscriptToBroll) + a new GET /api/brain/broll-profiles read
 *      path + placeContextualBroll() close that gap: matched b-roll is
 *      placed as a full-frame overlay cutaway at the exact dialogue moment.
 *   2. That matcher had no notion of the chapter markers R77 already builds
 *      — a placement landing right at a topic change was scored identically
 *      to one landing mid-sentence. extractChapterBoundaries() + the
 *      BROLL_CHAPTER_* scoring bonus in matchTranscriptToBroll() make a
 *      transition-adjacent match win ties and get a longer cutaway — never
 *      by lowering the keyword bar, only by breaking ties among matches that
 *      already clear it.
 *   3. VisualAnalyzer only ever ran on VIDEO — IDELayout.jsx's whole upload
 *      pipeline (proxy, transcription, analyze-asset) lived inside
 *      `if (isVideo)`, and images were never even uploaded anywhere the
 *      server could see them. A still image (the equipment photo, the project
 *      shot) could never be matched or placed no matter how well-described.
 *      New: VisualAnalyzer.analyzeImageBase64() (reuses analyzeWithVision,
 *      one frame instead of three, zero new prompt logic), Media
 *      IntelligencePipeline.analyzeImageAsset() (writes the identical visual
 *      columns analyzeAsset() does, skips audio/transcript), a new image
 *      branch in IDELayout.jsx's upload flow (base64 POST, no GCS needed),
 *      worker.js branching on job.data.imageBase64, and analyze-asset
 *      accepting imageBase64 as an alternative to gcsPath. Once analyzed, an
 *      image flows through buildBrollCandidates/matchTranscriptToBroll with
 *      ZERO changes there — it only ever filtered by clip.assetId presence
 *      on a track, never by media type.
 *
 * FOLLOW-UP (same file, added after shipping the above): two limits flagged
 * to the user were fixed rather than left standing. (a) buildBrollCandidates
 * used to require a candidate's asset to already have a clip somewhere on
 * the timeline — but IDELayout.jsx's addAssets() puts every uploaded file
 * into state.assets regardless of placement, and only auto-places a clip for
 * a single-file upload. A multi-file upload (the user's own vlog: interview
 * + walking/equipment/project shots dropped in together) left every asset
 * but the first unmatchable. Now checked against the media BIN instead.
 * (b) Chapter markers (R77) are purely structural and render nothing on
 * screen, so a real chapter transition had no visual text signal at all —
 * the "transition to a different topic/chapter" half of the user's own
 * framing. New extractChapterMarkers()/buildChapterTitleCardPayload() place
 * a short title card (reusing the chapter's own label — no new generation)
 * at each boundary, idempotently so re-running the command doesn't stack
 * duplicates.
 *
 * The six pure functions under test are evaluated directly from the real
 * client source via the CJS-strip-eval harness this codebase already uses
 * (test_overlay_animation_intelligence.js §3, test_hook_and_chapter_markers.js
 * §1-3) — so this is the real code, not a reimplementation that could drift
 * from it. Server-side additions (VisualAnalyzer, MediaIntelligencePipeline,
 * worker.js, brainRoutes.js) are checked via static assertions against the
 * real source, the same choice test_hook_and_chapter_markers.js made for
 * TimelineEventDetector.js — those files construct live DB/AI clients at
 * module load, so `require()`-ing them here would need real credentials.
 *
 * Run: node scripts/test_contextual_broll.js
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

// ── Extract the pure helpers from the real client source ───────────────────
const vetSrcRaw = read('client/src/agent/VideoEditorTools.js');

let helpers = null;
{
    let src = vetSrcRaw
        .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
        .replace(/\bexport\s+(const|function|class)\b/g, '$1');

    const classStart = src.indexOf('class VideoEditorTools {');
    if (classStart !== -1) src = src.slice(0, classStart);

    src += '\nreturn { tokenizeForBrollMatch, buildBrollCandidates, extractChapterBoundaries, matchTranscriptToBroll, extractChapterMarkers, buildChapterTitleCardPayload };';

    try {
        // eslint-disable-next-line no-new-func
        helpers = new Function(src)();
    } catch (err) {
        failed++; console.log(`  ✗ could not evaluate VideoEditorTools.js helpers — ${err.message}`);
    }
}

const tokenizeForBrollMatch    = helpers?.tokenizeForBrollMatch;
const buildBrollCandidates     = helpers?.buildBrollCandidates;
const extractChapterBoundaries = helpers?.extractChapterBoundaries;
const matchTranscriptToBroll   = helpers?.matchTranscriptToBroll;
const extractChapterMarkers        = helpers?.extractChapterMarkers;
const buildChapterTitleCardPayload = helpers?.buildChapterTitleCardPayload;

section('1 · tokenizeForBrollMatch — stopwords, length threshold, lowercasing');
{
    check('is a function', typeof tokenizeForBrollMatch === 'function');
    const kws = tokenizeForBrollMatch('He is Showing his Equipment and the Workspace, which is Amazing');
    check('lowercases everything', [...kws].every(w => w === w.toLowerCase()));
    check('keeps distinctive long words', kws.has('showing') && kws.has('equipment') && kws.has('workspace') && kws.has('amazing'));
    check('drops words of length <= 4', !kws.has('is') && !kws.has('and') && !kws.has('the'));
    check('drops stopwords even if long enough', !tokenizeForBrollMatch('really actually basically').size);
    check('empty/undefined input returns an empty set', tokenizeForBrollMatch('').size === 0 && tokenizeForBrollMatch(undefined).size === 0);
}

section('2 · buildBrollCandidates — R78 follow-up: media-BIN presence (not timeline placement) + hasMainSpeaker exclusion');
{
    check('is a function', typeof buildBrollCandidates === 'function');

    // state.assets — the full media bin. IDELayout.jsx's addAssets() puts every
    // uploaded file here regardless of whether it was auto-placed on a track
    // (auto-place only happens for a single-file upload) — that's exactly the
    // user's own multi-file vlog upload (interview + walking/equipment/project
    // shots dropped in together).
    const assets = [
        { id: 'a-interview' },
        { id: 'a-equipment' },
        { id: 'a-photo' },
        { id: 'a-unplaced-broll' }, // in the bin, never dragged onto any track
    ];
    const profiles = [
        { assetId: 'a-interview', contentDescription: 'Man talking to camera', hasMainSpeaker: true },
        { assetId: 'a-equipment', contentDescription: 'Close up of camera equipment on a desk', hasMainSpeaker: false },
        { assetId: 'a-photo', contentDescription: 'Photo of the finished project on a workbench', hasMainSpeaker: false, suggestedLabel: 'Project photo' },
        { assetId: 'a-unplaced-broll', contentDescription: 'Walking outside near the workspace entrance', hasMainSpeaker: false },
        { assetId: 'a-never-uploaded', contentDescription: 'Not in the bin at all', hasMainSpeaker: false },
        { assetId: 'a-no-keywords', contentDescription: '', hasMainSpeaker: false },
    ];

    const candidates = buildBrollCandidates(profiles, assets);
    const ids = candidates.map(c => c.assetId);

    check('excludes the main-speaker interview clip', !ids.includes('a-interview'));
    check('excludes a profile whose asset is not in the bin at all', !ids.includes('a-never-uploaded'));
    check('excludes a profile with no usable keywords', !ids.includes('a-no-keywords'));
    check('includes a b-roll asset in the bin', ids.includes('a-equipment'));
    check('includes a still IMAGE in the bin', ids.includes('a-photo'));
    check('R78 fix: includes an analyzed asset that was NEVER placed on any track — only in the bin', ids.includes('a-unplaced-broll'));
    check('non-array profiles/assets returns []', buildBrollCandidates(null, assets).length === 0 && buildBrollCandidates(profiles, null).length === 0);
}

section('3 · extractChapterBoundaries — reads the exact shape buildChapterMarkerPayloads (R77) writes');
{
    check('is a function', typeof extractChapterBoundaries === 'function');

    const tracks = [
        { type: 'video', clips: [{ id: 'c1', start: 10, duration: 5 }] }, // ordinary clip, not a marker
        {
            type: 'video', name: 'Chapters', clips: [
                { id: 'm1', type: 'marker', isChapter: true, start: 45 },
                { id: 'm2', type: 'marker', isChapter: true, start: 120 },
                { id: 'm3', type: 'marker', isChapter: true, start: 45 }, // duplicate boundary
            ],
        },
    ];
    const boundaries = extractChapterBoundaries(tracks);

    check('finds both real chapter boundaries', boundaries.includes(45) && boundaries.includes(120));
    check('ignores a non-marker clip on the same track', boundaries.length === 2);
    check('de-duplicates identical boundary times', boundaries.filter(b => b === 45).length === 1);
    check('returns them sorted ascending', boundaries[0] === 45 && boundaries[1] === 120);
    check('empty/non-array tracks returns []', extractChapterBoundaries([]).length === 0 && extractChapterBoundaries(null).length === 0);
}

section('3b · extractChapterMarkers + buildChapterTitleCardPayload — R78: text overlay for chapter transitions');
{
    check('extractChapterMarkers is a function', typeof extractChapterMarkers === 'function');
    check('buildChapterTitleCardPayload is a function', typeof buildChapterTitleCardPayload === 'function');

    const tracks = [
        { type: 'video', clips: [{ id: 'c1', start: 10, duration: 5 }] },
        {
            type: 'video', name: 'Chapters', clips: [
                { id: 'm1', type: 'marker', isChapter: true, start: 0, label: 'Introduction' },
                { id: 'm2', type: 'marker', isChapter: true, start: 45, label: 'His Story' },
                { id: 'm3', type: 'marker', isChapter: true, start: 45 }, // duplicate start, no label — first (labeled) one wins
                { id: 'm4', type: 'marker', isChapter: true, start: 120 }, // no label at all — falls back
            ],
        },
    ];
    const markers = extractChapterMarkers(tracks);

    check('finds one entry per distinct boundary', markers.length === 3);
    check('keeps each marker\'s own label', markers.some(m => m.start === 45 && m.label === 'His Story'));
    check('first entry at a duplicated start wins (does not get overwritten by the label-less duplicate)', markers.find(m => m.start === 45).label === 'His Story');
    check('falls back to a generic label when neither label nor name is present', markers.find(m => m.start === 120).label === 'Chapter');
    check('sorted ascending by start', markers[0].start === 0 && markers[1].start === 45 && markers[2].start === 120);
    check('empty/non-array tracks returns []', extractChapterMarkers([]).length === 0 && extractChapterMarkers(null).length === 0);

    const payload = buildChapterTitleCardPayload({ start: 45, label: 'His Story' });
    check('payload is a real text clip: type "text"', payload.type === 'text');
    check('content is the chapter label verbatim', payload.content === 'His Story');
    check('start matches the chapter boundary exactly', payload.start === 45);
    check('has a positive, sensible on-screen duration', payload.duration > 0 && payload.duration < 10);
    check('centered by default', payload.position === 'center');
    check('gets its own unique id', typeof payload.id === 'string' && payload.id.length > 0);

    const payload2 = buildChapterTitleCardPayload({ start: 45, label: 'His Story' });
    check('two payloads for the same marker still get distinct ids (no accidental id collision)', payload.id !== payload2.id);
}

section('4 · matchTranscriptToBroll — baseline keyword matching (no chapter boundaries)');
{
    check('is a function', typeof matchTranscriptToBroll === 'function');

    const words = [
        { start: 0, word: 'so' }, { start: 0.3, word: 'today' }, { start: 0.6, word: 'I' },
        { start: 0.9, word: 'want' }, { start: 1.2, word: 'to' }, { start: 1.5, word: 'show' },
        { start: 1.8, word: 'you' }, { start: 2.1, word: 'my' }, { start: 2.4, word: 'equipment' },
        { start: 2.7, word: 'setup' },
    ];
    const candidates = [
        { assetId: 'a-equipment', name: 'Equipment shot', keywords: new Set(['equipment', 'setup', 'camera']) },
        { assetId: 'a-unrelated', name: 'Unrelated', keywords: new Set(['ocean', 'beach']) },
    ];

    const matches = matchTranscriptToBroll(words, candidates);
    check('finds the keyword-matching candidate', matches.length === 1 && matches[0].assetId === 'a-equipment');
    check('placement duration defaults (not near a chapter boundary)', matches[0].duration === 2.5);
    check('isChapterTransition is false with no boundaries supplied', matches[0].isChapterTransition === false);
    check('chapterBoundaries defaults to [] when omitted (3-arg back-compat)', matchTranscriptToBroll(words, candidates).length === matches.length);
    check('no words / no candidates returns []', matchTranscriptToBroll([], candidates).length === 0 && matchTranscriptToBroll(words, []).length === 0);
}

section('5 · matchTranscriptToBroll — R78 chapter-boundary transition awareness');
{
    // Two candidates each share exactly ONE keyword with the dialogue window —
    // a tie on raw overlap. Only "b-transition" is near a chapter boundary.
    const words = [
        { start: 40, word: 'anyway' }, { start: 40.4, word: 'moving' }, { start: 40.8, word: 'onward' },
        { start: 41.2, word: 'workspace' },
    ];
    const candidates = [
        { assetId: 'a-tiebreak-1', name: 'Tie candidate 1', keywords: new Set(['workspace']) },
        { assetId: 'a-tiebreak-2', name: 'Tie candidate 2 (should win near boundary)', keywords: new Set(['workspace']) },
    ];

    // windowStart will be 40 (first word's start) — 5s from the chapter boundary at 45 is right at the proximity edge.
    const boundaries = [45];
    const matches = matchTranscriptToBroll(words, candidates, boundaries);

    check('places exactly one match at the tied window', matches.length === 1);
    check('flags it as a chapter transition (within BROLL_CHAPTER_PROXIMITY_S of the boundary)', matches[0].isChapterTransition === true);
    check('transition cutaway is LONGER than the default (3.5s vs 2.5s)', matches[0].duration === 3.5);

    // Same scenario, but the boundary is far away — should behave exactly like section 4.
    const farMatches = matchTranscriptToBroll(words, candidates, [1000]);
    check('far-away boundary: not flagged as a transition', farMatches[0].isChapterTransition === false);
    check('far-away boundary: default (non-transition) duration', farMatches[0].duration === 2.5);

    // The boundary bonus must NEVER be enough on its own — a window with zero
    // real keyword overlap must place nothing, even sitting exactly on a boundary.
    const noOverlapWords = [{ start: 45, word: 'unrelated' }, { start: 45.3, word: 'chatter' }];
    const noOverlapCandidates = [{ assetId: 'a-x', name: 'X', keywords: new Set(['equipment']) }];
    const noOverlapMatches = matchTranscriptToBroll(noOverlapWords, noOverlapCandidates, [45]);
    check('zero keyword overlap at a boundary still places nothing (R77 false-confidence reasoning applied here too)', noOverlapMatches.length === 0);
}

section('6 · Static wiring — placeContextualBroll uses the boundary-aware call shape');
{
    check('placeContextualBroll computes chapterBoundaries via extractChapterBoundaries(state.tracks)',
        /const chapterBoundaries = extractChapterBoundaries\(state\.tracks\)/.test(vetSrcRaw));
    check('placeContextualBroll passes chapterBoundaries into matchTranscriptToBroll',
        /matchTranscriptToBroll\(words,\s*candidates,\s*chapterBoundaries\)/.test(vetSrcRaw));
    check('placeContextualBroll picks overlay kind from the asset\'s own type (video vs image)',
        /kind:\s*asset\.type === 'image' \? 'image' : 'video'/.test(vetSrcRaw));
    check('the execute() switch still routes place_contextual_broll to placeContextualBroll',
        /case 'place_contextual_broll': return await this\.placeContextualBroll\(action\.args, action\.signal\);/.test(vetSrcRaw));

    // R78 follow-up: fix the two limits flagged after shipping the feature —
    // (1) candidates were restricted to clips already on the timeline, missing
    // any multi-file upload's un-placed footage; (2) chapter transitions had
    // no visual text signal at all, since chapter markers render nothing.
    check('placeContextualBroll matches against the media BIN (state.assets), not just placed clips',
        /buildBrollCandidates\(profiles,\s*state\.assets\)/.test(vetSrcRaw));
    check('placeContextualBroll computes chapterMarkers via extractChapterMarkers(state.tracks) for title cards',
        /const chapterMarkers = extractChapterMarkers\(state\.tracks\)/.test(vetSrcRaw));
    check('title-card placement is idempotent — checks existing text clips before adding',
        /newMarkers = chapterMarkers\.filter\(m => !existingTextClips\.some\(/.test(vetSrcRaw));
    check('reuses an existing "Chapter Titles" track on re-run instead of creating a duplicate one',
        /find\(t => t\.type === 'text' && t\.name === 'Chapter Titles'\)/.test(vetSrcRaw));
    check('creates the title track via the same addTrack + renameTrack pattern R77 used for the Chapters track',
        /titleTrackId = state\.addTrack\('text'\)[\s\S]{0,120}renameTrack\(titleTrackId,\s*'Chapter Titles'\)/.test(vetSrcRaw));
    check('each new marker is placed via buildChapterTitleCardPayload', /state\.addClip\(titleTrackId, buildChapterTitleCardPayload\(marker\)\)/.test(vetSrcRaw));
    check('result reports titleCardsCreated', /titleCardsCreated,/.test(vetSrcRaw));
}

section('7 · Static wiring — command chain (IntentParser → EditPlanner → CommandCompiler → MediaExecutionEngine)');
{
    const ipSrc = read('client/src/agent/IntentParser.js');
    check('IntentParser has a contextualBroll trigger-phrase category', /contextualBroll:\s*\[/.test(ipSrc));
    check('IntentParser routes matches to the place_contextual_broll intent', /matches\('contextualBroll'\)/.test(ipSrc));

    const ccSrc = read('client/src/agent/CommandConstants.js');
    check('CommandConstants defines PLACE_CONTEXTUAL_BROLL', /PLACE_CONTEXTUAL_BROLL:\s*'place_contextual_broll'/.test(ccSrc));

    const epSrc = read('client/src/agent/EditPlanner.js');
    check('EditPlanner dispatches place_contextual_broll to planPlaceContextualBroll', /case 'place_contextual_broll':\s*return this\.planPlaceContextualBroll\(planId\)/.test(epSrc));
    check('planPlaceContextualBroll sets requiresApproval:true (inherits EditJobManager\'s existing approval gate — same reasoning as R77)',
        /planPlaceContextualBroll\(planId\)\s*\{[\s\S]{0,200}requiresApproval:\s*true/.test(epSrc));

    const compSrc = read('client/src/agent/CommandCompiler.js');
    check('CommandCompiler defines compilePlaceContextualBroll', /function compilePlaceContextualBroll/.test(compSrc));
    check('CommandCompiler registers it in the compiler map', /\['place_contextual_broll',\s*\{\s*compiler:\s*compilePlaceContextualBroll\s*\}\]/.test(compSrc));

    const meeSrc = read('client/src/agent/MediaExecutionEngine.js');
    check('MediaExecutionEngine delegates place_contextual_broll through the shared long-form switch', /case 'place_contextual_broll':/.test(meeSrc));
}

section('8 · Static wiring — GET /api/brain/broll-profiles');
{
    const brSrc = read('server/routes/brainRoutes.js');
    check('route is registered', /router\.get\('\/broll-profiles',\s*authenticateUser/.test(brSrc));
    check('queries media_assets filtered to done analysis for the given project', /\.eq\('project_id',\s*projectId\)[\s\S]{0,80}\.eq\('analysis_status',\s*ASSET_ANALYSIS_DONE\)/.test(brSrc));
    check('returns the raw content_description/scene_type fields the matcher needs (not the reduced getSummary() shape)',
        /content_description,\s*suggested_label,\s*scene_type/.test(brSrc));
}

section('9 · R78 — still-image content analysis (VisualAnalyzer + MediaIntelligencePipeline)');
{
    const vaSrc = read('server/brain/media/VisualAnalyzer.js');
    check('VisualAnalyzer defines analyzeImageBase64()', /async analyzeImageBase64\(base64\)/.test(vaSrc));
    check('analyzeImageBase64 reuses analyzeWithVision with a single frame and mediaKind "image" (no new LLM prompt)',
        /analyzeWithVision\(\[\{\s*timestamp:\s*0,\s*base64\s*\}\],\s*'image'\)/.test(vaSrc));
    check('analyzeWithVision accepts a mediaKind param and adapts its prompt wording', /analyzeWithVision\(frames,\s*mediaKind = 'video'\)/.test(vaSrc));
    check('analyzeImageBase64 still respects the "no OpenAI key configured" guard analyze() uses', /analyzeImageBase64[\s\S]{0,400}if \(!this\.openai\)/.test(vaSrc));

    const mipSrc = read('server/brain/media/MediaIntelligencePipeline.js');
    check('MediaIntelligencePipeline defines analyzeImageAsset()', /async analyzeImageAsset\(assetId, imageBase64, projectId, userId, name = null\)/.test(mipSrc));
    check('analyzeImageAsset writes the same visual columns analyzeAsset() does', /analyzeImageAsset[\s\S]{0,2200}content_description:\s*visualAnalysis\.contentDescription/.test(mipSrc));
    check('analyzeImageAsset explicitly marks has_audio/has_spoken_word false rather than leaving them unset', /has_audio:\s*false,\s*\n\s*has_spoken_word:\s*false/.test(mipSrc));
    check('analyzeImageAsset never leaves status stuck at processing on failure', /analyzeImageAsset[\s\S]{0,3000}catch \(err\)[\s\S]{0,200}ASSET_ANALYSIS_FAILED/.test(mipSrc));

    const workerSrc = read('worker.js');
    check('worker.js branches the asset-analysis job on job.data.imageBase64', /const \{ assetId, filePath, projectId, userId, name, imageBase64 \} = job\.data;/.test(workerSrc));
    check('worker.js calls analyzeImageAsset for the image branch, analyzeAsset otherwise', /if \(imageBase64\)[\s\S]{0,150}analyzeImageAsset\(assetId, imageBase64/.test(workerSrc) && /\} else \{[\s\S]{0,150}analyzeAsset\(assetId, filePath/.test(workerSrc));

    const brSrc2 = read('server/routes/brainRoutes.js');
    check('POST /analyze-asset accepts imageBase64 as an alternative to gcsPath', /const \{ assetId, gcsPath, projectId, name, imageBase64 \} = req\.body/.test(brSrc2));
    check('POST /analyze-asset requires at least one of gcsPath / imageBase64', /gcsPath or imageBase64 is required/.test(brSrc2));
    check('POST /analyze-asset caps imageBase64 payload size', /imageBase64 too large/.test(brSrc2));
}

section('10 · R78 — client upload flow queues image analysis (IDELayout.jsx)');
{
    const ideSrc = read('client/src/layouts/IDELayout.jsx');
    check('an image branch exists alongside the video (isVideo) branch', /\} else if \(file\.type\.startsWith\('image'\)\) \{/.test(ideSrc));
    check('the image branch reads the file as base64 via FileReader', /reader\.readAsDataURL\(file\)/.test(ideSrc));
    check('the image branch POSTs to the SAME /api/brain/analyze-asset endpoint the video branch uses, with imageBase64 instead of gcsPath',
        /analyze-asset'[\s\S]{0,400}imageBase64,/.test(ideSrc));
    check('oversized images are skipped with a warning rather than sent (named byte cap, not silently truncated)',
        /MAX_IMAGE_ANALYSIS_BYTES/.test(ideSrc) && /too large for automatic content analysis/.test(ideSrc));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
