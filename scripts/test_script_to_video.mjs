// R132 — "can vibed create an animation video from a script?" → scoped in
// claude/script-to-video-scoping-R132.md, then the user confirmed ("let's
// go for it") with a specific first slice: no TTS yet, visuals + captions
// only, built from Vecteezy's vector/illustration catalog first (falling
// back to video, then photo, per shot) for a cartoonish look.
//
// Pins:
//   - ScriptSegmenter.segmentScript: breaks a script into shots with a
//     spoken-pace duration estimate and a deterministic stock-search query;
//     short sentences group together, a long sentence stands alone even
//     past the nominal max duration.
//   - "create a video from this script" / similar phrasings resolve, via
//     CommandRegistry, to create_video_from_script — and don't get hijacked
//     by storyboard_video/sync_cutaways' overlapping vocabulary.
//   - VideoEditorTools.createVideoFromScript() end to end: vector hit →
//     counted as vector; vector miss + video hit → counted as video,
//     falling back correctly; total miss on all three → shot is captioned
//     but has no visual, counted as unmatched, and does NOT crash or stall
//     the shots after it.
//   - Every shot gets a caption clip with its own script text, regardless
//     of whether a visual was found.
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;

const realLog = console.log;
console.log = () => {}; console.warn = () => {}; console.info = () => {};

const { segmentScript, extractStockQuery, MAX_SHOT_DURATION_S, MIN_SHOT_DURATION_S } = await import('../client/src/agent/ScriptSegmenter.js');
const { default: useTimelineStore } = await import('../client/src/store/useTimelineStore.js');
const { VideoEditorTools } = await import('../client/src/agent/VideoEditorTools.js');
const { IntentParser } = await import('../client/src/agent/IntentParser.js');

console.log = realLog;
const ok = (name) => realLog(`✓ ${name}`);

// ── ScriptSegmenter: pure logic ─────────────────────────────────────────────
{
    const empty = segmentScript('');
    assert.equal(empty.length, 0);
    ok('an empty script segments to zero shots');
}

{
    const script = 'A dog runs. A cat sleeps. Nothing much happens here at all.';
    const shots = segmentScript(script);
    assert.ok(shots.length >= 1);
    shots.forEach(s => assert.ok(s.estimatedDuration >= MIN_SHOT_DURATION_S, `shot duration ${s.estimatedDuration} below minimum`));
    ok('every shot meets the minimum duration floor, even for very short sentences');
}

{
    const longSentence = 'This single sentence is deliberately constructed to be extremely long and descriptive, listing many words one after another so that its own estimated spoken duration alone comfortably exceeds the nominal maximum shot duration threshold on its own.';
    const shots = segmentScript(longSentence);
    assert.equal(shots.length, 1);
    assert.ok(shots[0].estimatedDuration > MAX_SHOT_DURATION_S, 'a single long sentence should stand alone past the nominal max rather than being cut mid-thought');
    ok('a sentence longer than the max duration stands alone rather than being truncated');
}

{
    const q = extractStockQuery('The quick brown fox jumps over the lazy dog near the riverbank.');
    assert.ok(q.length > 0);
    assert.ok(!/\bthe\b/.test(q), `stopword "the" leaked into query: "${q}"`);
    ok('extractStockQuery strips stopwords and returns a non-empty keyword phrase');
}

{
    const q = extractStockQuery('   ');
    assert.ok(q.length > 0, 'a blank/whitespace-only sentence must still return something usable, never an empty string');
    ok('extractStockQuery never returns an empty query, even for degenerate input');
}

// ── Routing: CommandRegistry / IntentParser ─────────────────────────────────
{
    const phrasings = [
        'create a video from this script',
        'make a video from my script',
        'turn this script into a video',
        'generate a video from this script',
    ];
    for (const text of phrasings) {
        const intent = await IntentParser.parse(text);
        assert.equal(intent.operation, 'create_video_from_script', `"${text}" resolved to "${intent.operation}", expected create_video_from_script`);
    }
    ok('all registered "create a video from script" phrasings resolve to create_video_from_script');
}

{
    for (const text of [
        'make a montage from my media',
        'create a silent video from my media',
        'create a video from the attached images and video clips',
        'créer une vidéo à partir des images et des vidéos jointes',
        'turn these event photos into a video',
        'assemble my event footage',
    ]) {
        const intent = await IntentParser.parse(text);
        assert.equal(intent.operation, 'create_video_from_assets', `"${text}" resolved to "${intent.operation}"`);
    }
    ok('silent visual briefs and event footage route to the uploaded-media montage operation');
}

{
    // Regression guard: must not hijack storyboard_video's own vocabulary.
    const intent = await IntentParser.parse('storyboard this video');
    assert.notEqual(intent.operation, 'create_video_from_script');
    ok('"storyboard this video" is unaffected — still resolves to its own command, not the new one');
}

// ── VideoEditorTools.createVideoFromScript end-to-end ───────────────────────
function freshAsset(id, type, provider) {
    return { id, type, provider, url: `https://example.test/${id}.mp4`, name: id, duration: 5 };
}

function mockFetchFor({ vectorHits = true, videoHits = true, photoHits = true } = {}) {
    return async (url) => {
        const u = new URL(url, 'http://test.local');
        const type = u.searchParams.get('type');
        const query = u.searchParams.get('query') || 'q';
        const makeOk = (results) => ({ ok: true, status: 200, json: async () => ({ results, provider: 'vecteezy' }) });
        if (type === 'vector') {
            return vectorHits ? makeOk([freshAsset(`vec-${query}`, 'image', 'vecteezy')]) : makeOk([]);
        }
        if (type === 'video') {
            return videoHits ? makeOk([freshAsset(`vid-${query}`, 'video', 'vecteezy')]) : makeOk([]);
        }
        if (type === 'photo') {
            return photoHits ? makeOk([freshAsset(`pho-${query}`, 'image', 'pexels')]) : makeOk([]);
        }
        return makeOk([]);
    };
}

{
    useTimelineStore.setState({ tracks: [], assets: [
        { id: 'still-1', type: 'image', userUploaded: true, name: 'arrival.jpg', url: '/media/arrival.jpg' },
        { id: 'event-1', type: 'video', userUploaded: true, name: 'ceremony.mp4', url: '/media/ceremony.mp4', duration: 8 },
    ], past: [], future: [] });
    const tools = new VideoEditorTools();
    const r = await tools.execute({ name: 'create_video_from_assets', args: { includeImages: true } });
    assert.equal(r.success, true, r.message);


    const clips = useTimelineStore.getState().tracks.find(track => track.type === 'video')?.clips || [];
    assert.deepEqual(clips.map(clip => clip.assetId), ['still-1', 'event-1']);
    assert.equal(clips[0].duration, 4);
    assert.equal(clips[0].volume, 0);
    assert.equal(clips[1].volume, 1);
    assert.equal(r.details.animatedStills, 1);
    assert.equal(r.details.transitions, 1);
    ok('uploaded stills and silent event footage become a timed montage with gentle motion and a transition');
}

{
    useTimelineStore.setState({ tracks: [], assets: [
        { id: 'reference-video', type: 'video', userUploaded: true, assistantReference: true, name: 'reference.mp4', url: '/media/reference.mp4', duration: 7 },
        { id: 'source-video', type: 'video', userUploaded: true, name: 'event.mp4', url: '/media/event.mp4', duration: 9 },
    ], past: [], future: [] });
    const tools = new VideoEditorTools();
    const r = await tools.execute({ name: 'create_video_from_assets', args: { includeImages: true } });
    assert.equal(r.success, true, r.message);
    const clips = useTimelineStore.getState().tracks.find(track => track.type === 'video')?.clips || [];
    assert.deepEqual(clips.map(clip => clip.assetId), ['source-video']);
    ok('chat-attached reference video guides the edit without being inserted into the source footage sequence');
}

{
    globalThis.fetch = mockFetchFor({ vectorHits: true });
    useTimelineStore.setState({ tracks: [], assets: [], past: [], future: [] });
    const tools = new VideoEditorTools();
    const r = await tools.execute({ name: 'create_video_from_script', args: { script: 'A hero stands on a mountain. The sun rises behind them, full of promise.' } });
    assert.equal(r.success, true, r.message);
    assert.ok(r.vectorCount >= 1, 'at least one shot should have matched Vecteezy vector');
    assert.equal(r.unmatchedQueries.length, 0);

    const state = useTimelineStore.getState();
    const videoTrack = state.tracks.find(t => t.type === 'video');
    const textTrack = state.tracks.find(t => t.type === 'text');
    assert.ok(videoTrack && videoTrack.clips.length === r.shotCount, 'one visual clip per shot when every shot matches');
    assert.ok(textTrack && textTrack.clips.length === r.shotCount, 'one caption clip per shot regardless of visual match');
    ok('a fully-matching script places one visual + one caption per shot, all counted as vector');
}

{
    globalThis.fetch = mockFetchFor({ vectorHits: false, videoHits: true });
    useTimelineStore.setState({ tracks: [], assets: [], past: [], future: [] });
    const tools = new VideoEditorTools();
    const r = await tools.execute({ name: 'create_video_from_script', args: { script: 'A single plain sentence about a vehicle on a highway.' } });
    assert.equal(r.success, true, r.message);
    assert.equal(r.vectorCount, 0);
    assert.ok(r.videoCount >= 1, 'a vector miss must fall back to video');
    ok('a vector miss falls back to video search and is counted correctly');
}

{
    globalThis.fetch = mockFetchFor({ vectorHits: false, videoHits: false, photoHits: true });
    useTimelineStore.setState({ tracks: [], assets: [], past: [], future: [] });
    const tools = new VideoEditorTools();
    const r = await tools.execute({ name: 'create_video_from_script', args: { script: 'A single plain sentence about a building downtown.' } });
    assert.equal(r.success, true, r.message);
    assert.equal(r.vectorCount, 0);
    assert.equal(r.videoCount, 0);
    assert.ok(r.photoCount >= 1, 'a vector AND video miss must fall back to photo');
    ok('a vector+video miss falls back to photo search and is counted correctly');
}

{
    globalThis.fetch = mockFetchFor({ vectorHits: false, videoHits: false, photoHits: false });
    useTimelineStore.setState({ tracks: [], assets: [], past: [], future: [] });
    const tools = new VideoEditorTools();
    const r = await tools.execute({ name: 'create_video_from_script', args: { script: 'This one sentence will match nothing anywhere at all.' } });
    assert.equal(r.success, false, 'a script where every shot is unmatched should not report success');
    assert.equal(r.matchedCount, 0);

    const state = useTimelineStore.getState();
    const textTrack = state.tracks.find(t => t.type === 'text');
    assert.ok(textTrack && textTrack.clips.length === r.shotCount, 'captions must still be placed even when every visual search fails');
    ok('a script where nothing matches any asset type still captions every shot and reports failure honestly, not a silent no-op');
}

{
    globalThis.fetch = mockFetchFor({ vectorHits: true });
    useTimelineStore.setState({ tracks: [], assets: [], past: [], future: [] });
    const tools = new VideoEditorTools();
    const r = await tools.execute({ name: 'create_video_from_script', args: { script: '' } });
    assert.equal(r.success, false);
    assert.ok(/no script/i.test(r.message));
    ok('an empty script is rejected with a clear message rather than crashing or producing an empty timeline');
}

{
    // Mixed: one shot matches vector, the next matches nothing at all — the
    // loop must not stop or skip the caption for the unmatched shot, and
    // later shots must not overlap the skipped one's time slot.
    let call = 0;
    globalThis.fetch = async (url) => {
        const u = new URL(url, 'http://test.local');
        const type = u.searchParams.get('type');
        call++;
        // First shot's vector search hits; everything else (including that
        // same shot's own fallback paths, never reached) and the second
        // shot's every search type misses.
        if (type === 'vector' && call === 1) {
            return { ok: true, status: 200, json: async () => ({ results: [freshAsset('vec-1', 'image', 'vecteezy')], provider: 'vecteezy' }) };
        }
        return { ok: true, status: 200, json: async () => ({ results: [], provider: 'vecteezy' }) };
    };
    useTimelineStore.setState({ tracks: [], assets: [], past: [], future: [] });
    const tools = new VideoEditorTools();
    const r = await tools.execute({ name: 'create_video_from_script', args: { script: 'A short matching line that is just long enough on its own to roughly fill an entire shot without needing anything else attached to it at all. A second line that matches absolutely nothing anywhere at all.' } });
    assert.equal(r.shotCount, 2);
    assert.equal(r.matchedCount, 1);
    assert.equal(r.unmatchedQueries.length, 1);

    const state = useTimelineStore.getState();
    const textTrack = state.tracks.find(t => t.type === 'text');
    const videoTrack = state.tracks.find(t => t.type === 'video');
    assert.equal(textTrack.clips.length, 2, 'both shots must be captioned even though only one matched a visual');
    assert.equal(videoTrack.clips.length, 1, 'only the matching shot gets a visual clip');
    const [c0, c1] = [...textTrack.clips].sort((a, b) => a.start - b.start);
    assert.ok(c1.start >= c0.start + c0.duration - 0.001, 'the second shot must not overlap the first, even when the first had no visual');
    ok('a shot with no match anywhere is still captioned, counted as unmatched, and does not corrupt the timing of shots after it');
}

realLog('\nALL SCRIPT-TO-VIDEO TESTS PASSED');
