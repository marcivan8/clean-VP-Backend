// scripts/test_pro_finish_chain.mjs
//
// R103 — the Pro Finish chain, end to end, in one test.
//
// The unit suites each prove one link: test_motion_knowledge_base.mjs proves
// retrieval and the beat contract, test_scene_editor.mjs proves the director
// and the validator. Neither proves the thing that actually matters to a user,
// which is that a transcript goes in one end and ANIMATED CLIPS come out the
// other — through the local scene planner, polishShort, composeSceneFromBrief,
// composeComponentScene and flattenScene, in that
// order, with the technique's verbs still present when the clips land.
//
// That full path had no test at all, and it is exactly where an integration
// mistake hides: every link can be individually correct while the chain is
// broken (a plan shape nobody consumes, a motion object dropped between two
// validators, a CTA placed outside the short's duration).
//
// The assertion that carries the most weight is the verb one. composeMotion
// stamps each animation with `presetId: "composed:<verb>"`, so if a technique
// says slam-in and the clip on the timeline says `composed:slam-in`, the
// knowledge base provably reached the pixels.
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' });
const log = console.log; console.log = () => {}; console.warn = () => {}; console.info = () => {}; console.error = () => {};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
async function check(name, fn) {
    try { await fn(); log(`  ✓ ${name}`); }
    catch (err) { failures += 1; log(`  ✗ ${name}\n      ${err.message}`); }
}

const { createRequire } = await import('module');
const nodeRequire = createRequire(path.join(ROOT, 'package.json'));

const { finishShort, clearPlanCache } = await import('../client/src/agent/shortFinisher.js');
const { polishShort, fallbackShortScenePlan } = await import('../client/src/agent/shortPolish.js');
const { PLATFORM_PROFILES } = await import('../client/src/agent/PlatformProfiles.js');
const SV = await import('../client/src/motion/SceneValidator.js');
const SC = await import('../client/src/motion/SceneComposer.js');
const SD = await import('../client/src/motion/SceneDirector.js');
const SS = await import('../client/src/motion/SceneSchema.js');
const SFX = await import('../client/src/agent/sfxCues.js');
const IDX = nodeRequire(path.join(ROOT, 'server/audio-engine/library/MotionTechniqueIndex.js'));

// ── A short that looks like something a user actually repurposed ────────────
// 24 seconds of talking head, a spoken figure in the middle (the case the
// knowledge base's digit folding exists for), and semantic events where the
// detector would have put them.
const SPEECH = ('so i started this channel with nothing at all and in six weeks it went from zero to '
    + '40000 euros a month which still sounds insane to me but here is exactly how it happened '
    + 'step by step and what i would do differently if i had to start again today right now').split(' ');

const WORDS = SPEECH.map((word, i) => ({ word, start: 0.3 + i * 0.42, end: 0.3 + i * 0.42 + 0.38 }));
const TOTAL = 24;

const state = () => ({
    tracks: [
        {
            id: 'track-video',
            type: 'video',
            name: 'Video',
            clips: [
                { id: 'v1', type: 'video', assetId: 'asset-1', start: 0, duration: 11, offset: 0, sourceUrl: 'https://example.test/a.mp4' },
                { id: 'v2', type: 'video', assetId: 'asset-1', start: 11, duration: 13, offset: 11, sourceUrl: 'https://example.test/a.mp4' },
            ],
        },
    ],
    assets: [{ id: 'asset-1', type: 'video', name: 'a.mp4', width: 1920, height: 1080, proxyUrl: '/api/proxy/gcs-media/proxies/a.mp4' }],
    captions: WORDS,
});

const short = {
    platform: 'tiktok',
    start: 0,
    end: TOTAL,
    events: [
        { eventType: 'REVEAL', timelineTime: 9.2 },
        { eventType: 'EMPHASIS_MOMENT', timelineTime: 15.4 },
    ],
};

// A plan shaped exactly like what cleanScenePlan hands back when the model has
// picked techniques off the knowledge-base shortlist.
const planWithTechniques = (M) => M.cleanScenePlan({
    tone: 'viral',
    title: 'Zero To Forty Thousand',
    points: ['Six weeks start to finish'],
    cta: 'Follow for part two',
    beats: [
        { kind: 'intro', text: 'Zero To Forty Thousand', technique: 'hook-slam-headline' },
        { kind: 'point', text: 'Six weeks start to finish', kicker: '01' },
        { kind: 'cta', text: 'Follow for part two', technique: 'cta-punch-close' },
    ],
});

const withRouteStubs = (fn) => {
    const Module = nodeRequire('module');
    const orig = Module.prototype.require;
    Module.prototype.require = function patched(id) {
        if (id.includes('middleware/auth')) return { authenticateUser: (q, s, n) => n(), optionalAuth: (q, s, n) => n() };
        if (id.includes('AIProvider')) return { getAIClient: () => { throw new Error('none'); }, isAIConfigured: () => false, resolveModel: m => m, resolveProvider: () => 'mock' };
        return orig.apply(this, arguments);
    };
    try { return fn(nodeRequire(path.join(ROOT, 'server/routes/motionRoutes.js'))); }
    finally { Module.prototype.require = orig; }
};

const allClips = (tracks) => (tracks || []).flatMap(t => (t.clips || []).map(c => ({ ...c, trackId: t.id, trackType: t.type })));
const presetIdsOf = (clips) => clips.flatMap(c => (c.animations || []).map(a => a.presetId)).filter(Boolean);
const idsStarting = (tracks, prefix) => allClips(tracks).filter(c => String(c.id || '').startsWith(prefix)).map(c => c.id);

log('\n── 1. finishShort: the real Shorts-tab entry point ──');

let finished = null;
let finishedNoAi = null;

await check('it runs end to end with the AI plans injected', async () => {
    const M = withRouteStubs(m => m);
    finished = await finishShort(state(), short, {
        plan: { headline: 'ZERO TO FORTY THOUSAND', keywords: ['forty', 'thousand'] },
        scenePlan: planWithTechniques(M),
        sfx: false,
        popOut: false,
    });
    assert.ok(finished, 'nothing came back');
    assert.ok(finished.tracks.length > 0, 'no tracks');
    assert.ok(finished.duration > 0, 'no duration');
    assert.equal(finished.aspectRatio, '9:16', 'a TikTok short should be vertical');
});

await check('the hook is an AI-directed sequence, not the single static title', () => {
    assert.ok(
        finished.applied.some(a => /AI-directed/.test(a)),
        `applied should record the directed hook: ${JSON.stringify(finished.applied)}`,
    );
    assert.ok(idsStarting(finished.tracks, 'short-hook-').length > 0, 'no hook clips were produced');
});

await check('the CTA outro exists and sits at the end of the short, inside its duration', () => {
    const cta = allClips(finished.tracks).filter(c => String(c.id || '').startsWith('short-cta-'));
    assert.ok(cta.length > 0, 'no CTA clips');
    for (const c of cta) {
        const start = Number(c.start) || 0;
        const end = start + (Number(c.duration) || 0);
        assert.ok(start > finished.duration * 0.6, `a CTA at ${start}s is not a close on a ${finished.duration}s short`);
        assert.ok(end <= finished.duration + 0.01, `the CTA runs past the end of the short (${end} > ${finished.duration})`);
    }
});

await check('THE CHAIN: the technique verbs reach the clips on the timeline', () => {
    // hook-slam-headline is slam-in / punch / whip-out.
    // cta-punch-close is pop-in / punch / shrink-out.
    const hookPresets = presetIdsOf(allClips(finished.tracks).filter(c => String(c.id).startsWith('short-hook-')));
    const ctaPresets = presetIdsOf(allClips(finished.tracks).filter(c => String(c.id).startsWith('short-cta-')));
    assert.ok(hookPresets.includes('composed:slam-in'), `the hook technique never reached the clips: ${JSON.stringify([...new Set(hookPresets)])}`);
    assert.ok(ctaPresets.includes('composed:pop-in'), `the CTA technique never reached the clips: ${JSON.stringify([...new Set(ctaPresets)])}`);
});

await check('captions were generated from the transcript and styled', () => {
    assert.ok(idsStarting(finished.tracks, 'short-caption-').length > 0, 'a transcribed short should get captions');
    assert.ok(finished.applied.some(a => /captions/.test(a)), JSON.stringify(finished.applied));
});

await check('the spoken figure got a moment graphic', () => {
    // 40000 is in the speech; spokenNumbers should have found it.
    assert.ok(idsStarting(finished.tracks, 'short-moment-').length > 0, 'no moment graphics for a short containing a figure');
    assert.ok(finished.applied.some(a => /moment graphics/.test(a)), JSON.stringify(finished.applied));
});

await check('every finish layer is short- prefixed, so a re-run replaces instead of stacking', () => {
    // MediaExecutionEngine's isFinishLayer is exactly this test. A clip the
    // finish added that does not match would survive the next Pro Finish and
    // the short would accumulate a second hook on top of the first.
    const added = allClips(finished.tracks).filter(c => (c.animations || []).some(a => a.source === 'composed') || String(c.id).startsWith('short-'));
    for (const c of added) {
        if (c.id === 'v1' || c.id === 'v2') continue; // the base footage, legitimately not a finish layer
        assert.ok(String(c.id).startsWith('short-'), `clip "${c.id}" was added by the finish but will not be found on a re-run`);
    }
});

log('\n── 2. No AI configured: transcript fallback still builds a directed sequence ──');

await check('with no scene plan the transcript creates an animated multi-beat hook and no invented CTA', async () => {
    finishedNoAi = await finishShort(state(), short, {
        plan: null,
        scenePlan: null,
        sfx: false,
    });
    assert.ok(finishedNoAi.applied.some(a => /hook sequence/.test(a)), `expected a transcript fallback sequence: ${JSON.stringify(finishedNoAi.applied)}`);
    assert.ok(!finishedNoAi.applied.some(a => /AI-directed/.test(a)), 'a local fallback must not be reported as AI-directed');
    assert.equal(idsStarting(finishedNoAi.tracks, 'short-cta-').length, 0, 'no CTA text means no CTA layer');
    assert.ok(idsStarting(finishedNoAi.tracks, 'short-hook-text-').length >= 2, 'the transcript fallback should use more than one beat when the short has room');
});

await check('the fallback still animates, captions and finds the figure', () => {
    const hook = allClips(finishedNoAi.tracks).filter(c => String(c.id).startsWith('short-hook-'));
    assert.ok(presetIdsOf(hook).some(p => /^composed:/.test(p)), 'the plain hook should still carry composed motion');
    assert.ok(idsStarting(finishedNoAi.tracks, 'short-caption-').length > 0);
    assert.ok(idsStarting(finishedNoAi.tracks, 'short-moment-').length > 0);
});

await check('speaker pop-out works independently when the general polish toggle is off', async () => {
    const input = state();
    input.tracks[0].clips[0].layerMask = {
        maskAssetPath: 'masks/speaker.mp4', sourceStart: 0, sourceDuration: 11, fps: 12,
        bboxTrack: [{ t: 0, cx: 0.5, cy: 0.45, w: 0.3, h: 0.6 }],
        settings: { mode: 'blur' },
    };
    const result = await finishShort(input, short, {
        polish: false, popOut: true, sfx: false,
        plan: null, motionTechniques: [], visualContext: [],
    });
    const video = result.tracks.find(track => track.type === 'video')?.clips || [];
    assert.equal(video[0]?.layerTarget, 'background', 'the masked clip did not get the foreground cutout treatment');
    assert.equal(video[0]?.layerMask?.settings?.mode, 'dim', 'the speaker should remain bright against the dimmed background');
    assert.ok(result.applied.includes('speaker pop-out'), 'the UI result should report the pop-out layer');
    assert.equal(allClips(result.tracks).filter(c => String(c.id).startsWith('short-hook-')).length, 0, 'the general polish layers should stay off');
});

await check('speaker pop-out skips clips where the matte found no person', async () => {
    const input = state();
    input.tracks[0].clips[0].layerMask = {
        maskAssetPath: 'masks/empty.mp4', sourceStart: 0, sourceDuration: 11, fps: 12,
        bboxTrack: [], settings: { mode: 'blur' },
    };
    const result = await finishShort(input, short, {
        popOut: true, sfx: false, plan: null, motionTechniques: [], visualContext: [],
    });
    const video = result.tracks.find(track => track.type === 'video')?.clips || [];
    assert.equal(video[0]?.layerTarget, undefined, 'empty foreground data should not dim or replace the full frame');
    assert.ok(!result.applied.includes('speaker pop-out'), 'the planner claimed a pop-out without a detected subject');
});

await check('the local planner adapts its direction and schedules spoken insights as timed scenes', () => {
    const transcript = ('how to build a better workflow first remove the steps that waste your time '
        + 'but the surprising lesson is that the small change made everything easier '
        + 'i realized consistency matters more than speed so follow for more practical ideas').split(' ');
    const words = transcript.map((word, i) => ({ word, start: i * 0.55, end: i * 0.55 + 0.45 }));
    const local = fallbackShortScenePlan(words, { duration: 30 });
    assert.equal(local.tone, 'editorial', 'instructional wording should select an editorial direction');
    assert.ok(local.beats.some(b => b.kind === 'intro'), 'the plan needs an opening beat');
    assert.ok(local.beats.some(b => b.kind === 'cta'), 'a spoken CTA should become a closing beat');
    assert.ok(local.timedMoments.length > 0, 'transcript reveals should become timed supporting scenes');
    assert.ok(local.timedMoments.every(m => m.start > 2 && m.start < 30), 'supporting scenes must preserve transcript timing');
    assert.ok(local.sfxCues.length > 0, 'the deterministic scene plan should direct sound effects');
    assert.ok(local.brollMoments.length > 0, 'the deterministic scene plan should identify contextual b-roll opportunities');
    assert.ok(local.timedMoments.some(m => m.technique || m.motion), 'timed text beats should carry motion direction');
});

await check('the deterministic planner handles French transcripts and returns sparse, deduplicated SFX cues', () => {
    const transcript = ('je me suis rendu compte que cette méthode change tout mais la vérité est simple '
        + 'la première étape fait gagner 20 euros chaque jour alors suivez pour plus').split(' ');
    const words = transcript.map((word, i) => ({ word, start: i * 0.55, end: i * 0.55 + 0.45 }));
    const local = fallbackShortScenePlan(words, { duration: 18 });
    assert.ok(local.beats.some(b => b.kind === 'intro'), 'French words should still produce a grounded intro title');
    assert.ok(local.timedMoments.length > 0, 'French insight language should become timed text');
    assert.ok(local.sfxCues.every(cue => ['whoosh', 'pop', 'impact'].includes(cue.kind)), 'only supported SFX cue kinds should be emitted');
    assert.deepEqual(SFX.mergeSfxCues([{ t: 1, kind: 'pop' }, { t: 1.1, kind: 'whoosh' }]).map(c => c.kind), ['pop'], 'nearby planner cues should be deduplicated');
});

await check('the fallback ranks executable KB techniques by their library metadata and visual profiles', () => {
    const transcript = ('here is the key to a better coffee workflow first grind the beans fresh '
        + 'because the espresso flavor changes when the water runs through the coffee grounds').split(' ');
    const words = transcript.map((word, i) => ({ word, start: i * 0.55, end: i * 0.55 + 0.45 }));
    const techniques = [
        { name: 'point-workflow-reveal', beatKinds: ['point'], searchKeywords: ['workflow', 'coffee'], bestUseCases: ['reveal a process'], tones: ['editorial'], motion: { enter: 'rise-in', emphasis: 'pulse', exit: 'fade-out', energy: 0.64 } },
        { name: 'intro-title-slam', beatKinds: ['intro'], searchKeywords: ['hook', 'headline'], tones: ['viral'], motion: { enter: 'slam-in', emphasis: 'punch', exit: 'whip-out', energy: 0.9 } },
    ];
    const visualContext = [{ assetId: 'broll-coffee', isBroll: true, hasMainSpeaker: false, sceneType: 'coffee preparation', contentDescription: 'close-up coffee grinder and espresso machine' }];
    const local = fallbackShortScenePlan(words, { duration: 20, techniques, visualContext });
    assert.equal(local.beats.find(b => b.kind === 'intro')?.technique, 'intro-title-slam', 'the fallback should execute the matching intro technique');
    assert.ok(local.timedMoments.some(b => b.technique === 'point-workflow-reveal'), 'the fallback should rank a point technique from its search keywords');
    assert.ok(local.brollMoments.some(m => m.assetIds?.includes('broll-coffee')), 'upload-time visual analysis should link the spoken coffee beat to the matching bin asset');
    assert.ok(local.visualSummary?.includes('coffee preparation'), 'visual profile context should be retained in scene direction');
});

await check('local planning follows visual events and keeps interview motion restrained', () => {
    const transcript = ('i remember the first day we started the project and worked through every hard part '
        + 'then the whole team finally saw the result and celebrated together because the new idea changed everything').split(' ');
    const words = transcript.map((word, i) => ({ word, start: i * 0.6, end: i * 0.6 + 0.5 }));
    const eventTime = 16.2;
    const local = fallbackShortScenePlan(words, {
        duration: 20,
        editingStyle: 'interview',
        platform: 'reels',
        events: [{ eventType: 'REVEAL', timelineTime: eventTime, confidence: 0.98 }],
        techniques: [{
            name: 'high-energy-reveal', beatKinds: ['intro', 'point', 'quote'], tones: ['viral'],
            motion: { enter: 'slam-in', emphasis: 'punch', exit: 'whip-out', energy: 1 },
        }],
    });
    const reveal = local.timedMoments.find(moment => moment.sourceEvent === 'REVEAL');
    assert.ok(reveal, 'a visual reveal event should become a timed scene');
    assert.equal(reveal.start, eventTime, 'the semantic event time should be preserved');
    assert.equal(local.tone, 'warm', 'interview style should guide the visual tone');
    assert.deepEqual(local.sfxCues, [], 'interview scenes should not add distracting sound effects');
    assert.ok([...local.beats, ...local.timedMoments].every(beat => beat.motion.energy <= 0.38), 'interview style should clamp even high-energy KB recipes');
});

await check('the no-AI finish renders transcript-led graphics at their spoken timestamps', async () => {
    const transcript = ('how to build a better workflow first remove the steps that waste your time '
        + 'but the surprising lesson is that the small change made everything easier '
        + 'i realized consistency matters more than speed so follow for more practical ideas').split(' ');
    const words = transcript.map((word, i) => ({ word, start: i * 0.55, end: i * 0.55 + 0.45 }));
    const timed = await finishShort({ ...state(), captions: words }, { ...short, end: 30 }, { plan: null, scenePlan: null, sfx: false });
    const clips = allClips(timed.tracks).filter(c => String(c.id).startsWith('short-storyboard-'));
    assert.ok(clips.length > 0, 'no transcript-led storyboard template clips were rendered');
    assert.ok(clips.some(c => Number(c.start) > 3), 'supporting graphics should be placed in the body, not all at time zero');
    assert.ok(clips.every(c => c.type === 'template' && c.template?.kind), 'storyboard beats should resolve to real renderer-backed graphics');
    assert.ok(clips.some(c => Array.isArray(c.animations) && c.animations.length > 0), 'storyboard graphics should carry motion');
    assert.ok(timed.applied.some(a => /storyboard scenes/.test(a)), 'the applied summary should report the storyboard scenes');
});

await check('short finish wires contextual vector illustrations as animated template clips', () => {
    const scenePlan = {
        tone: 'editorial', beats: [],
        timedMoments: [{ kind: 'point', text: 'rocket launch', start: 8, end: 10 }],
        brollMoments: [], sfxCues: [], source: 'local-fallback',
    };
    const result = polishShort({ tracks: state().tracks, duration: TOTAL, aspectRatio: '9:16' }, PLATFORM_PROFILES.tiktok,
        { words: WORDS, events: [], scenePlan });
    const illustrations = allClips(result.tracks).filter(c => String(c.id).startsWith('short-illustration-'));
    assert.equal(illustrations.length, 1, 'a recognized vector subject should create one illustration clip');
    assert.equal(illustrations[0].template?.kind, 'icon');
    assert.equal(illustrations[0].template?.params?.icon, 'rocket');
    assert.ok(illustrations[0].animations?.length, 'the vector illustration should be animated');
    assert.ok(result.applied.some(item => /contextual vector illustrations/.test(item)));
});

await check('Shorts panel finish places matched bin b-roll into the generated timeline', async () => {
    const withBroll = state();
    withBroll.assets.push({ id: 'broll-launch', type: 'video', name: 'Rocket launch', url: '/media/rocket.mp4', duration: 6 });
    const result = await finishShort(withBroll, { ...short, end: 24 }, {
        plan: null, motionTechniques: [], visualContext: [], sfx: false,
        scenePlan: { tone: 'editorial', beats: [], timedMoments: [], sfxCues: [],
            brollMoments: [{ start: 8, end: 10, query: 'rocket launch', assetIds: ['broll-launch'] }], source: 'local-fallback' },
    });
    const clip = allClips(result.tracks).find(c => c.id === 'short-broll-0');
    assert.ok(clip, 'matched b-roll should appear in the generated Shorts timeline');
    assert.equal(clip.assetId, 'broll-launch');
    assert.equal(clip.x, 78, 'b-roll should use the speaker-safe picture-in-picture placement');
    assert.ok(result.applied.some(item => /contextual b-roll/.test(item)));
});

await check('the no-AI finish resolves planner sound cues to real SFX clips', async () => {
    const result = await finishShort(state(), short, {
        plan: null,
        scenePlan: null,
        fetchAsset: async query => ({ name: query, url: '/api/test-sfx.mp3', duration: 0.8, recommended_volume: 0.6 }),
    });
    const sfx = allClips(result.tracks).filter(c => c.isSFX);
    assert.ok(sfx.length > 0, 'planner cues were not turned into sound-effect clips');
    assert.ok(sfx.every(c => ['whoosh', 'pop', 'impact'].includes(c.sfxCue)), 'fallback used an unsupported SFX category');
});

await check('Pro Finish uses fallback B-roll moments and caps automatic cutaways', () => {
    const engine = nodeRequire('fs').readFileSync(path.join(ROOT, 'client/src/agent/MediaExecutionEngine.js'), 'utf8');
    const finisher = nodeRequire('fs').readFileSync(path.join(ROOT, 'client/src/agent/shortFinisher.js'), 'utf8');
    const tools = nodeRequire('fs').readFileSync(path.join(ROOT, 'client/src/agent/VideoEditorTools.js'), 'utf8');
    assert.match(engine, /scenePlan\?\.source === 'local-fallback'[\s\S]{0,900}placeContextualBroll/,
        'Pro Finish never sends fallback scenes through contextual B-roll matching');
    assert.match(engine, /maxPlacements: Math\.min\(2, scenePlan\.brollMoments\.length\)/,
        'fallback b-roll has no conservative placement cap');
    assert.match(finisher, /\/api\/brain\/broll-profiles\?projectId=/,
        'the fallback never reads upload-time visual analysis');
    assert.match(finisher, /VISUAL_CONTEXT_TIMEOUT_MS = 3000/,
        'a slow visual-profile lookup could stall the local planner');
    assert.match(engine, /visualContext,[\s\S]{0,120}events,/,
        'upload-time visual analysis and semantic events are not passed into the local planner');
    assert.match(engine, /preferredAssetIds/,
        'asset matches from visual analysis are not used to rank fallback cutaways');
    assert.match(tools, /scopedMatches = scopedMatches\.slice\(0, maxPlacements\)/,
        'contextual B-roll ignores the caller placement cap');
    assert.match(engine, /automatic moment animations/,
        'style recipes do not invoke the automatic moment animator');
    assert.match(finisher, /short-broll-/,
        'the Shorts panel finish does not copy matched b-roll into the generated timeline');
});

await check('the local scene planner retrieves and executes KB motions with no scene-model request', async () => {
    const savedFetch = globalThis.fetch;
    clearPlanCache();
    const requests = [];
    globalThis.fetch = async (url, options = {}) => {
        requests.push(String(url));
        if (String(url).includes('/api/motion/techniques')) {
            return { ok: true, status: 200, json: async () => ({ techniques: [
                { name: 'hook-slam-headline', beatKinds: ['intro'], searchKeywords: ['hook', 'headline'], tones: ['viral'], motion: { enter: 'slam-in', emphasis: 'punch', exit: 'whip-out', energy: 0.9 } },
                { name: 'point-pop-count', beatKinds: ['point'], searchKeywords: ['point', 'lesson', 'result'], tones: ['viral'], motion: { enter: 'pop-in', emphasis: 'punch', exit: 'shrink-out', energy: 0.7 } },
            ] }) };
        }
        return { ok: false, status: 503, json: async () => ({}) };
    };
    try {
        const result = await finishShort(state(), short, { sfx: false });
        const hook = allClips(result.tracks).filter(c => String(c.id).startsWith('short-hook-'));
        assert.ok(hook.length > 0, 'the local planner produced no hook clips');
        assert.ok(presetIdsOf(hook).includes('composed:slam-in'), `intro KB motion was lost: ${JSON.stringify(presetIdsOf(hook))}`);
        assert.ok(presetIdsOf(hook).includes('composed:pop-in'), `point KB motion was lost: ${JSON.stringify(presetIdsOf(hook))}`);
        assert.ok(result.applied.some(a => /local scene planner/.test(a)), 'scene direction source was not identified');
        assert.ok(requests.some(url => url.includes('/api/motion/techniques')), 'the local KB was not queried');
        assert.ok(!requests.some(url => url.includes('/api/motion/scene-plan')), 'the generative scene planner was called');
    } finally {
        globalThis.fetch = savedFetch;
        clearPlanCache();
    }
});

await check('finishShort uses injected headline and Motion KB lookups, then plans scenes locally', async () => {
    let askedForTechniques = 0;
    let askedForHeadline = 0;
    const out = await finishShort(state(), short, {
        sfx: false,
        fetchPlan: async () => { askedForHeadline += 1; return { headline: 'A REAL HEADLINE' }; },
        fetchMotionTechniques: async () => {
            askedForTechniques += 1;
            return [{ name: 'hook-slam-headline', beatKinds: ['intro'], motion: { enter: 'slam-in', emphasis: 'punch', exit: 'whip-out', energy: 0.9 } }];
        },
        visualContext: [],
    });
    assert.equal(askedForHeadline, 1, 'the optional headline plan was not fetched');
    assert.equal(askedForTechniques, 1, 'the non-generative technique lookup was not fetched');
    assert.ok(out.applied.some(a => /local scene planner/.test(a)), 'local planning was not used');
    assert.ok(out.applied.some(a => /AI headline/.test(a)), 'the independent headline option stopped working');
});

log('\n── 3. The directed hook is placed legally in a vertical frame ──');

await check('the composed hook scene validates clean at 9:16, with nothing to repair', () => {
    // The hook and CTA are composed with a SYNTHETIC subject box (shortPolish
    // is pure and cannot read a frame), which decides placement. If that guess
    // puts a title outside the safe area, every short ships with a breach.
    const profile = PLATFORM_PROFILES.tiktok;
    const designed = SD.composeSceneFromBrief('A punchy short-form hook: open strong and surface the single most important point.', {
        plan: { beats: [{ kind: 'intro', text: 'Zero To Forty Thousand' }, { kind: 'point', text: 'Six weeks start to finish', kicker: '01' }] },
        tone: 'viral',
        duration: 3.4,
        aspectRatio: '9:16',
        safeZone: profile.safeZone,
        subject: { cx: 0.5, cy: 0.62, w: 0.5, h: 0.6 },
    });
    assert.ok(designed?.scene, 'the director produced no scene');
    const report = SV.validateScene(designed.scene, { safeZone: SV.safeZoneForAspect('9:16') });
    assert.equal(report.counts.error, 0, report.issues.filter(i => i.severity === 'error').map(i => i.message).join(' | '));
    const fixed = SV.autoFixScene(designed.scene, { safeZone: SV.safeZoneForAspect('9:16') });
    assert.deepEqual(fixed.fixes, [], `the hook needed repairs: ${fixed.fixes.map(f => f.message).join(' | ')}`);
});

await check('the synthetic subject puts the hook above the speaker, not over them', () => {
    const designed = SD.composeSceneFromBrief('A punchy short-form hook', {
        plan: { beats: [{ kind: 'intro', text: 'Zero To Forty Thousand' }] },
        tone: 'viral',
        duration: 3,
        aspectRatio: '9:16',
        safeZone: PLATFORM_PROFILES.tiktok.safeZone,
        subject: { cx: 0.5, cy: 0.62, w: 0.5, h: 0.6 },
    });
    assert.equal(designed.placement.anchor, 'top', `placement came out "${designed.placement.anchor}" — a centred hook lands on the speaker's face`);
});

log('\n── 4. The two-beat hook, and what it must not run over ──');

const twoBeatPlan = (M) => M.cleanScenePlan({
    tone: 'viral',
    beats: [
        { kind: 'intro', text: 'Zero To Forty Thousand', technique: 'hook-slam-headline' },
        { kind: 'point', text: 'Six weeks start to finish', kicker: '01', technique: 'point-pop-count' },
    ],
});

const polishWith = (scenePlan, events = []) => polishShort(
    { tracks: state().tracks, duration: TOTAL, aspectRatio: '9:16' },
    PLATFORM_PROFILES.tiktok,
    { words: WORDS, events, scenePlan },
);

await check('two offered beats produce a two-beat hook ON TIKTOK', () => {
    // The gate used to be `hookDur > 3.2`, and hookDur tops out at 2.9 on
    // TikTok and 2.4 on Shorts — so this path existed and could never run on
    // either. The test names the platform deliberately.
    withRouteStubs((M) => {
        const polished = polishWith(twoBeatPlan(M));
        const hookText = allClips(polished.tracks).filter(c => String(c.id).startsWith('short-hook-text-'));
        assert.ok(hookText.length >= 2, `expected two beats' worth of text clips, got ${hookText.length}`);
        const words = hookText.map(c => String(c.content || c.name || '')).join(' ');
        assert.match(words, /Zero To Forty Thousand/);
        assert.match(words, /Six weeks/);
    });
});

await check('both beats keep their own technique verbs', () => {
    withRouteStubs((M) => {
        const polished = polishWith(twoBeatPlan(M));
        const presets = new Set(presetIdsOf(allClips(polished.tracks).filter(c => String(c.id).startsWith('short-hook-'))));
        assert.ok(presets.has('composed:slam-in'), `intro technique missing: ${JSON.stringify([...presets])}`);
        assert.ok(presets.has('composed:pop-in'), `point technique missing: ${JSON.stringify([...presets])}`);
    });
});

await check('a short too brief for two beats stays on one', () => {
    withRouteStubs((M) => {
        const polished = polishShort(
            { tracks: [{ id: 'track-video', type: 'video', name: 'V', clips: [{ id: 'v1', type: 'video', start: 0, duration: 6 }] }], duration: 6, aspectRatio: '9:16' },
            PLATFORM_PROFILES.tiktok,
            { words: WORDS.slice(0, 12), events: [], scenePlan: twoBeatPlan(M) },
        );
        const hookText = allClips(polished.tracks).filter(c => String(c.id).startsWith('short-hook-text-'));
        assert.equal(hookText.length, 1, 'a 6s short cannot afford two readable beats');
    });
});

await check('a stretched hook pushes the moment graphics clear of it', () => {
    // The real coupling bug this guards: hookEnd used to be recomputed from
    // the single-title formula, so with a stretched two-beat hook a moment
    // graphic could be placed on top of it. 4.0s is inside the stretched
    // hook (~5.2s) and outside the one-title budget (2.9s), so it separates
    // the two behaviours exactly.
    withRouteStubs((M) => {
        const events = [{ eventType: 'EMPHASIS_MOMENT', timelineTime: 4.0 }];
        const two = polishWith(twoBeatPlan(M), events);
        const twoMoments = allClips(two.tracks).filter(c => String(c.id).startsWith('short-moment-') && Math.abs((Number(c.start) || 0) - 4.0) < 1.2);
        assert.equal(twoMoments.length, 0, 'a moment graphic landed inside the stretched hook');

        const onePlan = M.cleanScenePlan({ tone: 'viral', beats: [{ kind: 'intro', text: 'Zero To Forty Thousand', technique: 'hook-slam-headline' }] });
        const one = polishWith(onePlan, events);
        const oneMoments = allClips(one.tracks).filter(c => String(c.id).startsWith('short-moment-') && Math.abs((Number(c.start) || 0) - 4.0) < 1.2);
        assert.ok(oneMoments.length > 0, 'with a short hook that same moment should still get its graphic');
    });
});

await check('the CTA still cannot collide with a stretched hook', () => {
    withRouteStubs((M) => {
        const plan = M.cleanScenePlan({
            tone: 'viral',
            beats: [
                { kind: 'intro', text: 'Zero To Forty Thousand' },
                { kind: 'point', text: 'Six weeks start to finish', kicker: '01' },
                { kind: 'cta', text: 'Follow for part two', technique: 'cta-punch-close' },
            ],
        });
        const polished = polishWith(plan);
        const cta = allClips(polished.tracks).filter(c => String(c.id).startsWith('short-cta-'));
        assert.ok(cta.length > 0, 'the CTA vanished');
        // hookSpan on a 24s TikTok short with two beats is ~5.2s.
        for (const c of cta) assert.ok((Number(c.start) || 0) > 5.4, `a CTA at ${c.start}s overlaps the stretched hook`);
    });
});

log('\n── 5. Knowledge base to pixels, through the route contract ──');

await check('a model response naming a technique becomes animated clips', () => {
    withRouteStubs((M) => {
        // Exactly what the model is told to return, with an id off the shortlist.
        const shortlist = IDX.shortlistForPlan('open with a strong hook, 40000 euros in six weeks', { tone: 'viral', platform: 'tiktok', limit: 8 });
        const offered = shortlist.map(s => s.technique.name);
        assert.ok(offered.includes('hook-slam-headline') || offered.length > 0, 'the shortlist was empty');

        const raw = { tone: 'viral', beats: [{ kind: 'intro', text: 'Zero To Forty Thousand', technique: 'hook-slam-headline' }] };
        const plan = M.cleanScenePlan(raw);
        assert.equal(plan.beats[0].technique, 'hook-slam-headline');

        const polished = polishShort(
            { tracks: state().tracks, duration: TOTAL, aspectRatio: '9:16' },
            PLATFORM_PROFILES.tiktok,
            { words: WORDS, events: short.events, scenePlan: { title: plan.title || 'Zero To Forty Thousand', points: [], cta: '', beats: plan.beats } },
        );
        const presets = presetIdsOf(allClips(polished.tracks).filter(c => String(c.id).startsWith('short-hook-')));
        assert.ok(presets.includes('composed:slam-in'), `KB -> route -> polish -> clips broke: ${JSON.stringify([...new Set(presets)])}`);
    });
});

await check('an unknown technique from a model degrades to the look own motion, not a crash', () => {
    withRouteStubs((M) => {
        const plan = M.cleanScenePlan({ beats: [{ kind: 'intro', text: 'A Real Title Here', technique: 'invented-by-the-model' }] });
        const polished = polishShort(
            { tracks: state().tracks, duration: TOTAL, aspectRatio: '9:16' },
            PLATFORM_PROFILES.tiktok,
            { words: WORDS, events: [], scenePlan: { title: 'A Real Title Here', points: [], cta: '', beats: plan.beats } },
        );
        const hook = allClips(polished.tracks).filter(c => String(c.id).startsWith('short-hook-'));
        assert.ok(hook.length > 0, 'the hook disappeared when the technique was unknown');
        assert.ok(presetIdsOf(hook).some(p => /^composed:/.test(p)), 'the hook lost its motion entirely');
    });
});

await check('every technique in the library survives the whole chain to a clip', () => {
    // The broadest guarantee available without rendering: for each of the 34
    // rows, drive it through polishShort as the hook and assert its entrance
    // verb appears on a real clip.
    withRouteStubs((M) => {
        const failures = [];
        for (const technique of IDX.allTechniques()) {
            if (!technique.beatKinds.includes('intro')) continue;
            const plan = M.cleanScenePlan({ beats: [{ kind: 'intro', text: 'A Real Title Here', technique: technique.name }] });
            const polished = polishShort(
                { tracks: state().tracks, duration: TOTAL, aspectRatio: '9:16' },
                PLATFORM_PROFILES.tiktok,
                { words: WORDS, events: [], scenePlan: { title: 'A Real Title Here', points: [], cta: '', beats: plan.beats } },
            );
            const presets = presetIdsOf(allClips(polished.tracks).filter(c => String(c.id).startsWith('short-hook-')));
            if (!presets.includes(`composed:${technique.motion.enter}`)) failures.push(`${technique.name} (${technique.motion.enter})`);
        }
        assert.deepEqual(failures, [], `techniques that never reached a clip: ${failures.join(', ')}`);
    });
});

log('');
if (failures > 0) {
    log(`${failures} FAILED`);
    process.exit(1);
}
log('ALL PRO FINISH CHAIN TESTS PASSED');
