// scripts/test_round_b.mjs
//
// R92 round B: platforms, repurposing into several shorts, brain style focus and edit recap.
//   1. Platform profiles (TikTok, Reels, Shorts) and request parsing
//   2. Several non-overlapping shorts, one per platform
//   3. A short's own timeline (sliced, 9:16 speaker crop, safe-zone captions); main edit untouched
//   4. The repurpose command end to end, the planner, saved with the project
//   5. Edit recap: what / why / impact, saved ledger, recap phrasings
//   6. Brain: style focus with the project's numbers, ledger in the prompt
import { register, createRequire } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' });
const log = console.log; console.log = () => {}; console.warn = () => {}; console.info = () => {}; console.error = () => {};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const require = createRequire(import.meta.url);
let failures = 0;
async function check(name, fn) {
    try { await fn(); log(`✓ ${name}`); }
    catch (err) { failures += 1; log(`✗ ${name}\n    ${err.message}`); }
}

const P = await import('../client/src/agent/PlatformProfiles.js');
const SP = await import('../client/src/agent/shortPicker.js');
const STL = await import('../client/src/agent/shortTimeline.js');
const RC = await import('../client/src/agent/EditRecap.js');
const { default: S } = await import('../client/src/store/useTimelineStore.js');
const { IntentParser } = await import('../client/src/agent/IntentParser.js');
const { EditPlanner } = await import('../client/src/agent/EditPlanner.js');
const { MediaExecutionEngine } = await import('../client/src/agent/MediaExecutionEngine.js');

// ── 1. Platforms ─────────────────────────────────────────────────────────────
log('\n1 · Platform profiles');
await check('three platforms, each with its own length, hook, safe zone, captions and export preset', () => {
    assert.deepEqual(P.PLATFORM_IDS, ['tiktok', 'reels', 'shorts']);
    const ids = new Set();
    for (const id of P.PLATFORM_IDS) {
        const p = P.PLATFORM_PROFILES[id];
        assert.equal(p.aspectRatio, '9:16');
        assert.ok(p.length.min < p.length.ideal[0] && p.length.ideal[1] <= p.length.max, id);
        assert.ok(p.length.max <= p.uploadLimitSeconds, id);
        assert.ok(p.safeZone.bottom >= 0.25 && p.safeZone.top >= 0.1, id);
        assert.ok(p.captionY < (1 - p.safeZone.bottom) * 100 && p.captionY > p.safeZone.top * 100, `${id} caption in the safe zone`);
        ids.add(JSON.stringify([p.length.ideal, p.hookSeconds, p.captionPack]));
    }
    assert.equal(ids.size, 3, 'the three are actually different');
    assert.equal(P.PLATFORM_PROFILES.reels.length.max, 90, 'Reels kept under 90 s (boostable)');
});
await check('loose names and requests are understood', () => {
    assert.equal(P.getPlatformProfile('Instagram Reels').id, 'reels');
    assert.equal(P.getPlatformProfile('TikTok').id, 'tiktok');
    assert.equal(P.getPlatformProfile('yt shorts').id, 'shorts');
    assert.equal(P.getPlatformProfile('vimeo'), null);
    assert.deepEqual(P.platformsFromText('make shorts for tiktok, reels and youtube shorts'), ['tiktok', 'reels', 'shorts']);
    assert.deepEqual(P.platformsFromText('turn it into shorts'), [], '"shorts" alone is not YouTube');
    assert.equal(P.shortCountFromText('make two reels'), 2);
    assert.equal(P.shortCountFromText('make 9 clips'), 5, 'capped at 5');
    assert.equal(P.shortCountFromText('repurpose it'), 3);
    assert.deepEqual(P.assignPlatforms(3), ['tiktok', 'reels', 'shorts']);
    assert.deepEqual(P.assignPlatforms(2, ['reels']), ['reels', 'reels']);
});
await check('notes say whether a short fits its platform', () => {
    const tt = P.PLATFORM_PROFILES.tiktok;
    assert.equal(P.profileNotes({ start: 0, end: 28 }, tt)[0].level, 'ok');
    assert.equal(P.profileNotes({ start: 0, end: 80 }, tt)[0].code, 'too_long');
    assert.ok(P.profileNotes({ start: 0, end: 28 }, tt, { hasCaptions: false }).some(n => n.code === 'captions'));
});

// ── 2. Several shorts ────────────────────────────────────────────────────────
log('\n2 · Several shorts');
function talk(seconds = 300) {
    const out = [];
    let t = 0;
    let n = 0;
    while (t < seconds) {
        const opener = n % 7 === 0 ? 'here\'s' : (n % 3 === 0 ? 'and' : 'the');
        for (const w of [opener, 'point', 'number', String(n), 'is', 'really', 'important', 'today']) { out.push({ word: w, start: t, end: t + 0.3 }); t += 0.35; }
        out[out.length - 1].word += '.';
        t += 0.8;
        n += 1;
    }
    return out;
}
const WORDS = talk(300);
const EVENTS = [{ eventType: 'REVEAL', timelineTime: 40 }, { eventType: 'PUNCHLINE_DETECTED', timelineTime: 150 }, { eventType: 'EMPHASIS_MOMENT', timelineTime: 230 }];
await check('one short per platform, inside each platform\'s range, never overlapping', () => {
    const slots = P.PLATFORM_IDS.map(id => {
        const p = P.PLATFORM_PROFILES[id]; const [lo, hi] = p.length.ideal;
        return { platform: id, min: Math.max(p.length.min, lo * 0.75), max: Math.min(p.length.max, hi * 1.3), target: (lo + hi) / 2 };
    });
    const found = SP.findShortCandidates(WORDS, { events: EVENTS, slots });
    assert.equal(found.length, 3);
    assert.deepEqual(found.map(f => f.platform), ['tiktok', 'reels', 'shorts']);
    found.forEach((f, i) => {
        const len = f.end - f.start;
        assert.ok(len >= slots[i].min - 0.01 && len <= slots[i].max + 0.01, `${f.platform} ${len}`);
    });
    for (let i = 0; i < found.length; i++) for (let j = i + 1; j < found.length; j++) {
        assert.ok(found[i].end + 2 <= found[j].start || found[j].end + 2 <= found[i].start, 'overlap');
    }
    assert.ok(found.some(f => f.hookEvent), 'at least one opens on a detected moment');
});
await check('a slot that cannot fit is skipped, not forced', () => {
    const short = talk(40);
    const found = SP.findShortCandidates(short, { slots: [{ platform: 'tiktok', min: 20, max: 34, target: 28 }, { platform: 'reels', min: 20, max: 34, target: 28 }] });
    assert.equal(found.length, 1);
});

// ── 3. A short's own timeline ────────────────────────────────────────────────
log('\n3 · Short timeline');
const MAIN = [
    { id: 'v', type: 'video', name: 'V', clips: [
        { id: 'c1', type: 'video', assetId: 'a', start: 0, duration: 50, offset: 10, speed: 1 },
        { id: 'c2', type: 'video', assetId: 'a', start: 50, duration: 50, offset: 70, speed: 2, transition: { type: 'whip', duration: 0.3 } },
    ] },
    { id: 't', type: 'text', name: 'T', clips: [
        { id: 'caption-1', content: 'hello there', start: 44, duration: 2, y: 85, words: [{ word: 'hello', start: 44, end: 44.5 }, { word: 'there', start: 45, end: 45.6 }] },
        { id: 'caption-2', content: 'later', start: 120, duration: 2, words: [{ word: 'later', start: 120, end: 120.4 }] },
        { id: 'title', content: 'TITLE', start: 30, duration: 40, y: 20 },
    ] },
    { id: 'm', type: 'audio', name: 'M', clips: [{ id: 'music', start: 0, duration: 100, offset: 0 }] },
];
const ASSETS = [{ id: 'a', type: 'video', resolution: { w: 1920, h: 1080 } }];
await check('clips are trimmed and moved to 0, with offsets (and speed) advanced', () => {
    const { tracks, duration } = STL.sliceTimeline(MAIN, 40, 70);
    assert.equal(duration, 30);
    const v = tracks.find(t => t.id === 'v').clips;
    assert.deepEqual(v.map(c => [c.start, c.duration, c.offset]), [[0, 10, 50], [10, 20, 70]]);
    const music = tracks.find(t => t.id === 'm').clips[0];
    assert.deepEqual([music.start, music.duration, music.offset], [0, 30, 40]);
    const cap = tracks.find(t => t.id === 't').clips.find(c => c.id === 'caption-1');
    assert.deepEqual(cap.words.map(w => w.start), [4, 5], 'caption words move with the clip');
    assert.ok(!tracks.find(t => t.id === 't').clips.some(c => c.id === 'caption-2'), 'outside the window → gone');
});
await check('the short is 9:16, the speaker framed, captions in the safe zone, no trailing transition', () => {
    const before = JSON.stringify(MAIN);
    const built = STL.buildShortTimeline(MAIN, { start: 40, end: 70 }, { assets: ASSETS, profile: P.PLATFORM_PROFILES.tiktok });
    assert.equal(built.aspectRatio, '9:16');
    const v = built.tracks.find(t => t.id === 'v').clips;
    assert.ok(v.every(c => c.virtualCam && c.virtualCam.reframe === '9:16' && c.virtualCam.cropW < 0.4), JSON.stringify(v[0].virtualCam));
    assert.ok(!v[v.length - 1].transition, 'nothing comes after the last clip');
    const cap = built.tracks.find(t => t.id === 't').clips.find(c => c.id === 'caption-1');
    assert.equal(cap.y, P.PLATFORM_PROFILES.tiktok.captionY);
    const title = built.tracks.find(t => t.id === 't').clips.find(c => c.id === 'title');
    assert.equal(title.y, 20, 'a title placed by the user keeps its position');
    assert.equal(JSON.stringify(MAIN), before, 'the main edit is not changed');
});
await check('an unknown source shape is left uncropped rather than guessed', () => {
    const built = STL.buildShortTimeline(MAIN, { start: 40, end: 70 }, { assets: [], profile: P.PLATFORM_PROFILES.reels });
    assert.ok(built.tracks.find(t => t.id === 'v').clips.every(c => !c.virtualCam));
});

// ── 4. Repurpose command ─────────────────────────────────────────────────────
log('\n4 · Repurpose command');
const tm = globalThis.timelineManager;
function loadTracks(list, extra = {}) {
    tm.fromLegacyTracks(JSON.parse(JSON.stringify(list)));
    S.setState({ tracks: tm.toLegacyTracks(), past: [], future: [], selectedClipIds: [], editingStyle: null, currentTime: 0, shorts: [],
        uploadedFile: { name: 'IMG.MOV' }, assets: [{ id: 'a', type: 'video', name: 'IMG.MOV', duration: 300, resolution: { w: 1920, h: 1080 } }], captions: [], ...extra });
}
const LONG = [{ id: 'track-default-video', type: 'video', name: 'V', clips: [{ id: 'v1', assetId: 'a', type: 'video', name: 'IMG.MOV', start: 0, duration: 300, offset: 0, speed: 1 }] }];
const plan = async (text) => {
    const intent = await IntentParser.parse(text);
    const p = await EditPlanner.generatePlan(intent);
    return { op: intent.operation, steps: p.plan?.steps || [] };
};
for (const [t, count, platforms] of [
    ['repurpose this video', 3, []],
    ['make 3 shorts for tiktok', 3, ['tiktok']],
    ['make shorts for tiktok, reels and youtube shorts', 3, ['tiktok', 'reels', 'shorts']],
    ['turn this into shorts, one for each platform: tiktok and instagram', 2, ['tiktok', 'reels']],
]) {
    await check(`"${t}" → repurpose_shorts (${count}, ${platforms.join('/') || 'all'})`, async () => {
        loadTracks(LONG, { captions: WORDS });
        const r = await plan(t);
        assert.equal(r.op, 'repurpose_shorts');
        assert.equal(r.steps[0].args.count, count);
        assert.deepEqual(r.steps[0].args.platforms, platforms);
    });
}
await check('"make a short for tiktok" keeps one short sized for TikTok', async () => {
    loadTracks(LONG, { captions: WORDS });
    const r = await plan('make a short for tiktok');
    assert.equal(r.op, 'extract_short');
    assert.equal(r.steps[0].args.target, 28);
});
const engine = new MediaExecutionEngine();
await check('the command saves one short per platform and leaves the edit alone', async () => {
    loadTracks(LONG, { captions: WORDS });
    const tracksBefore = JSON.stringify(S.getState().tracks);
    const pastBefore = S.getState().past.length;
    const r = await engine.executeStoreAction({ action: 'repurpose_shorts', args: { count: 3, platforms: [] } }, null);
    assert.equal(r.success, true, r.message);
    const shorts = S.getState().shorts;
    assert.deepEqual(shorts.map(s => s.platform), ['tiktok', 'reels', 'shorts']);
    assert.ok(shorts.every(s => s.end > s.start && s.title && s.id));
    assert.equal(JSON.stringify(S.getState().tracks), tracksBefore, 'main edit unchanged');
    assert.equal(S.getState().past.length, pastBefore, 'no undo step needed: nothing on the timeline changed');
    assert.match(r.message, /Shorts tab/);
});
await check('no transcript → an honest message, nothing saved', async () => {
    loadTracks(LONG, { captions: [] });
    const r = await engine.executeStoreAction({ action: 'repurpose_shorts', args: { count: 3 } }, null);
    assert.equal(r.success, false);
    assert.match(r.message, /transcript/);
    assert.equal(S.getState().shorts.length, 0);
});
await check('shorts are saved with the project and come back on load', () => {
    loadTracks(LONG, { captions: WORDS });
    S.getState().setShorts([{ id: 's1', platform: 'reels', start: 10, end: 30, title: 'x' }]);
    const data = S.getState().saveProject();
    assert.deepEqual(data.shorts.map(s => s.id), ['s1']);
    S.setState({ shorts: [] });
    S.getState().loadProject?.(data);
    assert.deepEqual(S.getState().shorts.map(s => s.id), ['s1']);
    S.getState().updateShort('s1', { platform: 'tiktok' });
    assert.equal(S.getState().shorts[0].platform, 'tiktok');
    S.getState().removeShort('s1');
    assert.equal(S.getState().shorts.length, 0);
});
await check('Shorts tab: mounted, exports through the normal path with a per-short timeline', () => {
    const ide = read('client/src/layouts/IDELayout.jsx');
    assert.match(ide, /'motion', 'shorts', 'assets'/);
    assert.match(ide, /<ShortsPanel onExport=\{\(settings, override\) => handleFfmpegExport\(settings, override\)\} \/>/);
    assert.match(ide, /const handleFfmpegExport = async \(settings, override = null\)/);
    assert.match(ide, /if \(!override\) saveActiveExport/);
    const panel = read('client/src/components/ShortsPanel.jsx');
    // R92 round C: the panel goes through the finisher, which builds the short's own timeline.
    assert.match(panel, /finishShort\(useTimelineStore\.getState\(\), short, \{ polish, popOut, sfx \}\)/);
    assert.match(read('client/src/agent/shortFinisher.js'), /buildShortTimeline\(state\.tracks, short, \{ assets: state\.assets, profile, pad \}\)/);
    assert.match(panel, /platform: profile\.exportPreset/);
    assert.match(read('client/src/hooks/useSupabasePersistence.js'), /state\.tracks, state\.editingStyle, state\.shorts/);
});

// ── 5. Edit recap ────────────────────────────────────────────────────────────
log('\n5 · Edit recap');
await check('facts and impact are measured, and explained for the viewer', () => {
    const before = RC.timelineFacts({ tracks: [{ type: 'video', clips: [{ start: 0, duration: 120 }] }], aspectRatio: '16:9' });
    const after = RC.timelineFacts({ tracks: [
        { type: 'video', clips: [{ start: 0, duration: 50 }, { start: 50, duration: 50 }] },
        { type: 'text', clips: [{ id: 'caption-1', start: 0, duration: 2, words: [] }] },
    ], aspectRatio: '9:16' });
    const imp = RC.editImpact(before, after);
    assert.equal(imp.secondsRemoved, 20);
    assert.equal(imp.cutsAdded, 1);
    assert.equal(imp.captionsAdded, 1);
    assert.deepEqual(imp.aspectChanged, { from: '16:9', to: '9:16' });
    const txt = RC.impactText(imp);
    assert.match(txt, /20 s shorter \(2:00 to 1:40, -17%\)/);
    assert.match(txt, /sound off/);
    assert.match(txt, /phone screen/);
    assert.equal(RC.impactText(RC.editImpact(before, before)), null);
});
await check('the store ledger records what, why, impact and style', () => {
    loadTracks(LONG, { editingStyle: 'talking_head' });
    S.setState({ editHistory: [] });
    const before = RC.timelineFacts(S.getState());
    S.getState().cutTimelineRanges([[280, 300]]);
    S.getState().recordEdit('silence_removal', { summary: 'Removed 3 pauses', reasons: ['Remove dead air and long pauses'], before, after: RC.timelineFacts(S.getState()), params: { big: 'x'.repeat(5000) } });
    const e = S.getState().editHistory.at(-1);
    assert.equal(e.op, 'silence_removal');
    assert.equal(e.why, 'Remove dead air and long pauses');
    assert.equal(e.impact.secondsRemoved, 20);
    assert.equal(e.style, 'talking_head');
    assert.equal(e.params, null, 'large params are not saved with the project');
});
await check('the recap lists every edit with why and impact, and the overall change', () => {
    const recap = RC.buildRecap(S.getState().editHistory, { style: 'talking_head', facts: RC.timelineFacts(S.getState()) });
    assert.match(recap, /editing as a Talking head/);
    assert.match(recap, /1\. Removed silences\. Why: Remove dead air and long pauses\. Impact: 20 s shorter/);
    assert.match(recap, /Overall: 5:00 to 4:40 \(-7%\)/);
    assert.doesNotMatch(recap, /—/);
    assert.match(RC.buildRecap([]), /Nothing has been edited/);
});
for (const t of ['what did you do?', 'recap', 'why did you cut that part', 'explain the edits', 'what has been done', "qu'est-ce que tu as fait"]) {
    await check(`"${t}" → the recap`, async () => {
        const intent = await IntentParser.parse(t);
        assert.equal(intent.operation, 'query_session_summary');
    });
}
await check('the recap answer comes from the saved ledger', () => {
    const ejm = read('client/src/agent/EditJobManager.js');
    assert.match(ejm, /buildRecap\(ledger, \{ style: recapState\.editingStyle, facts: timelineFacts\(recapState\) \}\)/);
    assert.match(ejm, /reasons: \(planResult\.plan\?\.steps \|\| \[\]\)\.map\(st => st\?\.reason\)/);
    const wc = read('client/src/agent/WorkflowController.js');
    assert.match(wc, /context\.preJobFacts = timelineFacts\(useTimelineStore\.getState\(\)\)/);
    assert.match(wc, /before: context\.preJobFacts \|\| null,\s*after: timelineFacts\(useTimelineStore\.getState\(\)\)/);
});

// ── 6. Brain ─────────────────────────────────────────────────────────────────
log('\n6 · Brain');
const ESrv = require(path.join(ROOT, 'server/brain/editingStyles.js'));
await check('every style has its own focus, with the project\'s numbers in it', () => {
    const ctx = { cutRate: 3.2, speakingPace: 168, duration: 95, aspectRatio: '16:9', hasCaptions: false, rhythmCoverage: 0.25, editsDone: ['silence_removal'], detectedSpeakers: 2, multicamCoverage: 0.5, clipCount: 12 };
    const seen = new Set();
    for (const id of ESrv.EDITING_STYLE_IDS) {
        const sec = ESrv.styleFocusSection(id, ctx);
        assert.match(sec, /STYLE FOCUS/);
        assert.match(sec, /Look at these first/);
        assert.match(sec, /Leave aside unless the user asks/);
        seen.add(sec.split('\n')[3]);
    }
    assert.equal(seen.size, 5, 'five different first priorities');
    assert.match(ESrv.styleFocusSection('talking_head', ctx), /cut rate 3\.2\/min .*zoom rhythm on 25%.*captions no/);
    assert.match(ESrv.styleFocusSection('reel', ctx), /95s long \(too long for a short.*aspect 16:9 \(should be 9:16\)/);
    assert.match(ESrv.styleFocusSection('podcast', ctx), /2 speaker\(s\)/);
    assert.equal(ESrv.styleFocusSection(null, ctx), '');
});
await check('the Brain prompt gets the style focus and the recent edits with why and impact', () => {
    const eb = read('server/brain/EditorialBrain.js');
    assert.match(eb, /\$\{styleFocusSection\(ctx\.editingStyle, ctx\)\}/);
    assert.match(eb, /\$\{ledgerSection\(ctx\.editLedger\)\}/);
    assert.match(read('server/brain/ContextEngine.js'), /editLedger:\s+Array\.isArray\(state\.editLedger\)/);
    assert.match(read('client/src/hooks/useBrain.js'), /const editLedger = ledgerForBrain\(state\.editHistory \|\| \[\]\)/);
    const sec = ESrv.ledgerSection([{ op: 'silence_removal', why: 'dead air', impact: '20 s shorter' }]);
    assert.match(sec, /silence_removal: dead air \[20 s shorter\]/);
    assert.equal(ESrv.ledgerSection([]), '');
});
await check('user-facing copy has no em dashes', () => {
    for (const lang of ['en', 'fr']) {
        const d = JSON.parse(read(`client/src/locales/${lang}/editor.json`));
        assert.doesNotMatch(JSON.stringify(d.shortsPanel), /—/, lang);
    }
});

log(failures ? `\n${failures} FAILURE(S)` : '\nALL ROUND B CHECKS PASSED');
process.exit(failures ? 1 : 0);
