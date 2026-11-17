// scripts/test_ruler_seek_after_edit.mjs
//
// A ruler click after an AI edit must move the playhead and keep it there.
//
// Revideo draws the seeked frame and emits `timeupdate` BEFORE it updates its
// frame counter, so the first report after a seek carries the OLD time. While
// the store said "playing" but the player had paused itself (a preview reload
// after the edit), onTimeUpdate wrote that old time back over every seek, and
// a paused player sends no later frame to correct it. The ruler looked dead.
import { register } from 'module';
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
let failures = 0;
function check(name, fn) {
    try { fn(); log(`✓ ${name}`); } catch (err) { failures += 1; log(`✗ ${name}\n    ${err.message}`); }
}

const { default: S } = await import('../client/src/store/useTimelineStore.js');

let now = 1_000_000;
const realNow = Date.now;
Date.now = () => now;

const calls = [];
const player = {
    playback: { fps: 30 },
    playerState: { current: { paused: true } },
    requestSeek: (f) => calls.push(['seek', f]),
    togglePlayback: (v) => calls.push(['toggle', v]),
};
S.setState({ duration: 60, currentTime: 12, isPlaying: true, playerRef: player });

check('the stale report right after a seek does not move the playhead back', () => {
    S.getState().seek(40);
    now += 16;
    S.getState().setPlaybackTime(12); // the frame drawn before the seek landed
    assert.equal(S.getState().currentTime, 40);
});

check('playback that continues from the seek target is accepted', () => {
    now += 100;
    S.getState().setPlaybackTime(40.1);
    assert.equal(S.getState().currentTime, 40.1);
    now += 100;
    S.getState().setPlaybackTime(12); // no seek pending now: a real jump (loop) is kept
    assert.equal(S.getState().currentTime, 12);
});

check('a report far from the target is accepted once the guard window ends', () => {
    S.getState().seek(30);
    now += 800;
    S.getState().setPlaybackTime(5);
    assert.equal(S.getState().currentTime, 5);
});

check('syncPlayingFromPlayer updates the store without commanding the player', () => {
    calls.length = 0;
    S.getState().syncPlayingFromPlayer(false);
    assert.equal(S.getState().isPlaying, false);
    assert.deepEqual(calls, []);
});

Date.now = realNow;

const IDE = read('client/src/layouts/IDELayout.jsx');
const onTimeUpdate = IDE.slice(IDE.indexOf('onTimeUpdate={(time) =>'), IDE.indexOf('project={project}'));

check('onTimeUpdate ignores reports while the Revideo player is paused', () => {
    assert.match(onTimeUpdate, /playerState\?\.current\?\.paused/);
    assert.match(onTimeUpdate, /corePaused !== true/);
});

check('the store resyncs isPlaying when the player stays paused', () => {
    assert.match(IDE, /onStateChanged\.subscribe/);
    assert.match(IDE, /syncPlayingFromPlayer\(false\)/);
});

check('the recovery seeks read the store inside the timeout, so a user seek wins', () => {
    const recalc = IDE.slice(IDE.indexOf('onRecalculated.subscribe'), IDE.indexOf('onStateChanged.subscribe'));
    const inTimeout = recalc.slice(recalc.indexOf('setTimeout('));
    assert.match(inTimeout, /const \{ currentTime \} = useTimelineStore\.getState\(\)/);
    assert.doesNotMatch(recalc.slice(0, recalc.indexOf('setTimeout(')), /currentTime/);
});

log(failures ? `\n${failures} failure(s)` : '\nAll ruler-seek checks passed');
process.exit(failures ? 1 : 0);
