// iOS preview unlock (client/src/utils/iosMediaUnlock.js) with fake media
// elements that behave like iOS Safari: play() is refused unless muted or
// inside a user gesture.
// node scripts/test_ios_media_unlock.mjs
import assert from 'assert/strict';
import { isIOSDevice, prepareInline, primeMedia, unlockPools, installIosMediaUnlock } from '../client/src/utils/iosMediaUnlock.js';

let inGesture = false;
function fakeMedia() {
    const el = {
        paused: true, muted: false, playsInline: false, attrs: {}, plays: 0, pauses: 0,
        setAttribute(k, v) { this.attrs[k] = v; },
        play() {
            if (!this.muted && !inGesture) return Promise.reject(new Error('NotAllowedError'));
            this.paused = false; this.plays++; return Promise.resolve();
        },
        pause() { this.paused = true; this.pauses++; },
    };
    return el;
}
const tick = () => new Promise(r => setTimeout(r, 0));

assert.equal(isIOSDevice({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)', platform: 'iPhone' }), true);
assert.equal(isIOSDevice({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 }), true, 'iPadOS');
assert.equal(isIOSDevice({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 0 }), false, 'Mac desktop');
assert.equal(isIOSDevice({ userAgent: 'Mozilla/5.0 (Linux; Android 14)', platform: 'Linux armv8l', maxTouchPoints: 5 }), false, 'Android');
console.log('✓ iOS detection (iPhone, iPadOS yes; Mac, Android no)');

const v = fakeMedia();
prepareInline(v);
assert.equal(v.playsInline, true);
assert.equal(v.attrs.playsinline, '');
assert.equal(v.attrs['webkit-playsinline'], '');
assert.equal(await primeMedia(v), true, 'muted play allowed without a gesture');
assert.equal(v.paused, true, 'paused again when the editor is not playing');
assert.equal(v.muted, false, 'mute restored');
const playingNow = fakeMedia();
await primeMedia(playingNow, () => true);
assert.equal(playingNow.paused, false, 'never pauses a video the editor started meanwhile');
console.log('✓ playsinline + muted prime, no pause while playing');

// Gesture unlock over Revideo-like pools + suspended audio context
const pool = { a: fakeMedia(), b: fakeMedia() };
const ctx = { state: 'suspended', resumed: 0, resume() { this.resumed++; this.state = 'running'; return Promise.resolve(); } };
inGesture = true;
await unlockPools([pool, null], { k: { audioContext: ctx } });
inGesture = false;
assert.ok(pool.a.__vibedUnlocked && pool.b.__vibedUnlocked);
assert.equal(ctx.resumed, 1);
const before = pool.a.plays;
await unlockPools([pool], {});
assert.equal(pool.a.plays, before, 'unlocked elements are left alone');
console.log('✓ tap unlocks every media element once and resumes audio');

// install(): patches Video.prototype.video, listens in capture phase, uninstalls
class Video { video() { this.el = this.el || fakeMedia(); return this.el; } }
Video.pool = {};
const listeners = {};
const target = {
    addEventListener(type, fn, opts) { listeners[type] = { fn, opts }; },
    removeEventListener(type) { delete listeners[type]; },
};
assert.equal(typeof installIosMediaUnlock({ Video, target }), 'function');
assert.equal(Video.prototype.__vibedIosPatched, undefined, 'not iOS (node): nothing installed');
const uninstall = installIosMediaUnlock({ Video, Audio: { pool: {} }, Media: { amplificationPool: {} }, target, force: true });
const node = new Video();
const el = node.video();
assert.equal(el.playsInline, true, 'new Revideo videos get playsinline');
Video.pool.x = el;
assert.equal(listeners.touchend.opts.capture, true);
assert.ok(listeners.click);
inGesture = true; listeners.touchend.fn(); inGesture = false;
await tick(); await tick();
assert.equal(el.__vibedUnlocked, true);
uninstall();
assert.equal(Video.prototype.__vibedIosPatched, undefined);
assert.equal(listeners.touchend, undefined);
console.log('✓ install patches new videos, unlocks on tap, uninstalls cleanly');

console.log('\nALL IOS-MEDIA-UNLOCK CHECKS PASSED');
