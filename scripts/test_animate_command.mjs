// "animate" command end to end on a REAL-shaped project: the server detector
// (same calls as POST /api/audio/animate-automatically), the client apply
// step, preview resolution and the export derivations.
// node scripts/test_animate_command.mjs
import { register, createRequire } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';
const require = createRequire(import.meta.url);

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 400;
const log = console.log; console.log = () => {}; console.warn = () => {}; console.info = () => {};

// ── Server: the route's own pipeline (TaxonomyService stubbed: one SFX row) ──
const { timelineEventDetector } = require('../server/audio-engine/timeline/TimelineEventDetector.js');
const KG = require('../server/audio-engine/timeline/AnimationKnowledgeGraph.js');
const { computeIntensity, pickPresetForIntensity } = require('../server/audio-engine/timeline/AnimationIntensity.js');
const { computeStyleSeed, pickSecondaryPreset } = require('../server/audio-engine/timeline/AnimationCombiner.js');
const SFX_ROW = { id: 'sfx1', display_name: 'Whoosh', preview_url: 'https://cdn.example.com/whoosh.mp3', gcs_path: 'sfx/whoosh.mp3', duration: 0.8, recommended_volume: 0.6 };
function serverPlan(projectState) {
    const events = timelineEventDetector.detect(projectState).filter(e => KG.SEMANTIC_EVENT_TYPES.includes(e.eventType));
    const info = {};
    for (const t of projectState.tracks) for (const c of t.clips || []) info[c.id] = KG.layerKindForClip(c, t.type);
    const plan = events.map(ev => {
        const intensity = computeIntensity(ev.eventType, ev.metadata);
        const presetId = pickPresetForIntensity(KG.animationsForEventType(ev.eventType, info[ev.clipId] || 'video'), intensity);
        return { eventType: ev.eventType, timelineTime: ev.timelineTime, clipId: ev.clipId, trackId: ev.trackId, presetId,
            secondaryPresetId: pickSecondaryPreset(presetId, computeStyleSeed(ev, null)), intensity,
            sfx: KG.sfxIntentsForEventType(ev.eventType).length ? [SFX_ROW] : [] };
    });
    plan.push(...KG.resolveOverlayAnimations(events, projectState.tracks, null));
    return { events, plan };
}
let sent = null, server = null;
globalThis.fetch = async (url, opts = {}) => {
    if (String(url).includes('animate-automatically')) {
        sent = JSON.parse(opts.body).projectState; server = serverPlan(sent);
        return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => server };
    }
    return { ok: false, status: 503, headers: { get: () => 'application/json' }, json: async () => ({}), text: async () => '' };
};

// ── 1. Detector reads what the app really stores ─────────────────────────
const det = (ps) => timelineEventDetector.detect(ps).filter(e => KG.SEMANTIC_EVENT_TYPES.includes(e.eventType)).map(e => `${e.eventType}@${e.timelineTime}`);
assert.deepEqual(det({ tracks: [{ id: 't', type: 'text', clips: [{ id: 'c', start: 1, duration: 2, content: "Here’s the secret" }] }] }), ['REVEAL@1'], 'caption words are in `content` (it read `text`)');
assert.deepEqual(det({ tracks: [{ id: 't', type: 'text', clips: [{ id: 'c', start: 1, duration: 2, content: 'Voici ce que personne ne dit' }] }] }), ['REVEAL@1'], 'French reveal words');
assert.deepEqual(det({ tracks: [{ id: 'v', type: 'video', clips: [{ id: 'v1', start: 4, duration: 6, peaks: [{ offset: 2, db: -1 }] }] }] }), ['EMPHASIS_MOMENT@6'], 'loud peaks on the VIDEO clip (only audio tracks were read)');
assert.deepEqual(det({ words: [{ start: 0, end: 1 }, { start: 1.6, end: 2 }], tracks: [{ id: 'v', type: 'video', clips: [{ id: 'v1', start: 0, duration: 6, peaks: [{ offset: 2.2, db: -1 }] }] }] }), ['PUNCHLINE_DETECTED@2.2'], 'a pause in the SPEECH before a loud word = punchline (no clip gap needed)');
assert.deepEqual(det({ words: [{ start: 0, end: 1 }, { start: 2.3, end: 3 }], tracks: [{ id: 't', type: 'text', clips: [{ id: 'c', start: 0.5, duration: 2, content: 'Tu me manques' }] }] }), ['EMOTIONAL_BEAT@1'], 'French emotional words + a 1.3 s pause = emotional beat');
log('✓ detector: caption text, French words, video peaks, speech pauses');

// ── Client ─────────────────────────────────────────────────────────────────
const { default: S } = await import('../client/src/store/useTimelineStore.js');
const { IntentParser } = await import('../client/src/agent/IntentParser.js');
const { EditPlanner } = await import('../client/src/agent/EditPlanner.js');
const { CommandCompiler } = await import('../client/src/agent/CommandCompiler.js');
const { mediaExecutionEngine } = await import('../client/src/agent/MediaExecutionEngine.js');
const { clipToMotionLayer, applyPresetToClip } = await import('../client/src/motion/ClipAdapter.js');
const { resolveMotionAt } = await import('../client/src/motion/MotionResolver.js');
const { applyCameraMotionToBaseTrack, deriveCameraKeyframes } = await import('../client/src/motion/CameraMotionCompiler.js');
const { buildCaptionProgram } = await import('../client/src/motion/CaptionCompiler.js');
const { selectAnimateMoments, countMoments } = await import('../client/src/agent/animateMoments.js');
const tm = window.timelineManager;

for (const p of ['animate', 'animate it', 'animate my video', 'add animations', 'anime ma vidéo', "ajoute de l'animation", 'animate this automatically']) {
    assert.equal((await IntentParser.parse(p)).operation, 'animate_automatically', p);
}
log('✓ "animate", "animate it", "add animations", "anime ma vidéo"… run the command');

const st = () => S.getState();
const clipOf = (id) => st().tracks.flatMap(t => t.clips).find(c => c.id === id);
const trackOf = (id) => st().tracks.find(t => t.clips.some(c => c.id === id));
const scaleAt = (id, t) => resolveMotionAt(clipToMotionLayer(clipOf(id), trackOf(id)), t).scale;
async function animate() {
    const intent = await IntentParser.parse('animate this automatically');
    const plan = await EditPlanner.generatePlan(intent);
    const comp = CommandCompiler.compile({ ...plan.plan, intent: { ...intent, confidence: 'HIGH' } }, st());
    return mediaExecutionEngine.execute(comp.commands, () => {}, null);
}
function project({ longClip = false } = {}) {
    tm.fromLegacyTracks([
        { id: 'track-default-video', type: 'video', name: 'V', clips: longClip
            ? [{ id: 'v1', clipId: 'ev1', assetId: 'a', type: 'video', name: 'IMG.MOV', start: 0, duration: 60, offset: 0, speed: 1 }]
            : [{ id: 'v1', clipId: 'ev1', assetId: 'a', type: 'video', name: 'IMG.MOV', start: 0, duration: 6, offset: 0, speed: 1 },
               { id: 'v2', clipId: 'ev2', assetId: 'a', type: 'video', name: 'IMG.MOV', start: 6, duration: 6, offset: 7, speed: 1, keyframes: { scale: [] } }] },
        { id: 'track-ov', type: 'overlay', name: 'Overlay', clips: [{ id: 'img1', clipId: 'eimg', type: 'image', name: 'logo.png', url: '/x.png', start: 2, duration: 4 }] },
    ]);
    const peaks = new Array(61 * 50).fill(0.05);
    for (const s of longClip ? [10, 25, 40, 52] : [2, 9]) peaks[s * 50] = 0.95; // loud words (source seconds)
    S.setState({ tracks: tm.toLegacyTracks(), duration: longClip ? 60 : 12, past: [], future: [], assets: [{ id: 'a', type: 'video', name: 'IMG.MOV', duration: 61 }], waveformsByAsset: { a: { peaks } }, captions: [] });
    st().addCaptionClips([
        { text: "Here’s the secret nobody tells you", start: 1.5, end: 3 },
        { text: 'just talking here', start: 4, end: 5.5 },
    ]);
    S.setState({ past: [], future: [] });
}

// ── 2. Animates at the moment, on a cut video ─────────────────────────────
project();
let r = await animate();
assert.equal(r.success, true);
assert.match(r.results[0].message, /^Animated 2 moments/, r.results[0].message);
assert.ok(sent.words !== undefined && sent.tracks.find(t => t.type === 'video').clips[0].peaks.length === 1, 'sends words and ONE prominent peak per loud word');
assert.equal(scaleAt('v1', 1.0), 1, 'nothing before the moment (it used to zoom at the clip start)');
assert.ok(scaleAt('v1', 2.3) > 1.1, `punch-in at the loud word (t=2): ${scaleAt('v1', 2.3).toFixed(3)}`);
assert.ok(Math.abs(scaleAt('v1', 5) - 1) < 1e-3, 'released after the hold');
assert.ok(scaleAt('v2', 9.3) > 1.1, 'second clip punched at ITS loud word (t=9 = source 10)');
const cap = st().tracks.find(t => t.type === 'text').clips[0];
assert.ok(cap.animations?.some(a => a.source === 'auto-animate'), 'the reveal caption is animated with the punch (same moment)');
const sfx = st().tracks.find(t => t.name === 'SFX').clips;
assert.equal(sfx.length, 2, 'one sound effect per moment');
assert.equal(sfx[0].url, SFX_ROW.preview_url, 'playable URL (not the storage path)');
assert.equal(sfx[0].volume, 0.6, "the sound's recommended volume");
log('✓ cut video: punch-ins land ON the loud words, release, caption + overlay react, 1 SFX per moment');

// ── 3. Preview = export ───────────────────────────────────────────────────
const base = st().tracks.find(t => t.type === 'video');
const cam = deriveCameraKeyframes(clipOf('v1'), base);
assert.ok(cam.panX && cam.panX.some(p => Math.abs(p.value) > 0.001), 'camera shake reaches the export as pan keyframes');
const kfAt = (kfs, t) => { const s = kfs.filter(k => k.time <= t).pop(); return s ? s.value : kfs[0].value; };
assert.ok(Math.abs(kfAt(cam.scale, 2.6) - scaleAt('v1', 2.6)) < 0.02, 'export zoom matches the preview');
const derivedTracks = applyCameraMotionToBaseTrack(st().tracks, base.id);
assert.ok(derivedTracks.find(t => t.id === base.id).clips.find(c => c.id === 'v2').keyframes.scale.length > 2, 'a clip with an EMPTY keyframes.scale (every clip after a clean-up) still exports its camera animation');
const withRhythm = { ...clipOf('v1'), keyframes: { scale: [{ time: 0, value: 1.1 }, { time: 6, value: 1.1 }] } };
const combo = deriveCameraKeyframes(withRhythm, base);
assert.ok(Math.abs(kfAt(combo.scale, 1.0) - 1.1) < 0.01 && kfAt(combo.scale, 2.6) > 1.25, 'zoom rhythm × animation, both kept (export used to keep only the rhythm)');
const prog = buildCaptionProgram(st().tracks, base.clips);
assert.ok(prog.entries.find(e => e.clipId === cap.id).geometry.length > 1, 'the animated caption is in the export caption program');
log('✓ export: shake as pan, zoom matches preview, rhythm × animation, cleaned-up clips, captions');

// ── 4. Re-run replaces its own result; user choices stay; one undo ────────
const userAnim = applyPresetToClip(clipOf('img1'), 'float').animations;
st().updateClip('track-ov', 'img1', { animations: [...userAnim, ...clipOf('img1').animations.filter(a => a.source === 'auto-animate')] }, { skipHistory: true });
const autoCount = st().tracks.flatMap(t => t.clips).reduce((n, c) => n + (c.animations || []).filter(a => a.source === 'auto-animate').length, 0);
S.setState({ past: [] });
r = await animate();
const autoCount2 = st().tracks.flatMap(t => t.clips).reduce((n, c) => n + (c.animations || []).filter(a => a.source === 'auto-animate').length, 0);
assert.equal(autoCount2, autoCount, 'second run REPLACES its animations (no stacking)');
assert.equal(st().tracks.find(t => t.name === 'SFX').clips.length, 2, 'and its sound effects (no duplicates)');
assert.ok(clipOf('img1').animations.some(a => a.presetId === 'float' && a.source !== 'auto-animate'), "the user's own animation stays");
assert.equal(st().past.length, 1, 'one undo step');
st().undo();
assert.equal(st().tracks.find(t => t.name === 'SFX').clips.length, 2, 'undo goes back to the first run');
log('✓ re-run replaces its own result, keeps the user\'s, one undo');

// ── 5. One long uncut clip: several punches, never stacking ───────────────
project({ longClip: true });
r = await animate();
const punches = [10, 25, 40, 52].map(t => scaleAt('v1', t + 0.3));
assert.ok(punches.every(s => s > 1.1 && s < 1.35), `each loud word punches in on its own: ${punches.map(s => s.toFixed(2))}`);
assert.ok([5, 20, 35, 48].every(t => Math.abs(scaleAt('v1', t) - 1) < 1e-3), 'and comes back between them (no ever-tighter zoom)');
log('✓ one 60 s clip: 4 separate punch-ins, released in between');

// ── 6. Captions keep their style pack; regeneration doesn't spread auto animations ──
const packClip = { id: 'p', start: 0, duration: 2, content: 'x', captionStyle: { animationPreset: 'pop' } };
const withAuto = { ...packClip, ...applyPresetToClip(packClip, 'glow-reveal', { source: 'auto-animate', at: 0 }) };
const layer = clipToMotionLayer(withAuto, { type: 'text' });
assert.ok(layer.animations.some(a => a.presetId === 'pop') && layer.animations.some(a => a.source === 'auto-animate'), 'pack animation + auto animation (pack used to be dropped)');
project();
await animate();
st().addCaptionClips([{ text: 'new one', start: 0, end: 1 }, { text: 'two', start: 1, end: 2 }]);
assert.equal(st().tracks.find(t => t.type === 'text').clips.length, 2, 'regenerating REPLACES the previous captions (they used to stack: the old batch was never matched)');
assert.ok(st().tracks.find(t => t.type === 'text').clips.every(c => !(c.animations || []).some(a => a.source === 'auto-animate')), 'regenerated captions do not inherit the per-moment animation');
log('✓ caption style pack kept; regenerated captions replace the old ones and stay clean');

// ── 7. Moment selection ───────────────────────────────────────────────────
const many = Array.from({ length: 40 }, (_, i) => ({ timelineTime: i * 0.5, intensity: (i % 7) / 7, clipId: 'v' }));
const sel = selectAnimateMoments(many, 20);
assert.ok(countMoments(sel) <= 4, `a flood of 40 events over 20 s → ${countMoments(sel)} moments kept`);
log('✓ a flood of detections is thinned to spaced, strongest moments');

log('\nALL ANIMATE-COMMAND CHECKS PASSED');
process.exit(0);
