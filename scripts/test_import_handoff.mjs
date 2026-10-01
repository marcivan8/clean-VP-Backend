// Mobile import: probe can't hang on a missing 'seeked' event (iOS), and the
// Home "New video" handoff doesn't wait for an anonymous session id that
// signed-in users never get.
// node scripts/test_import_handoff.mjs
import assert from 'assert/strict';
import { readFileSync } from 'fs';

// ── Fake DOM: a <video> that loads metadata but never fires 'seeked' ──────
let behaviour = 'no-seeked';
globalThis.URL.createObjectURL = () => 'blob:fake';
globalThis.URL.revokeObjectURL = () => {};
globalThis.document = {
    createElement(tag) {
        if (tag === 'canvas') return { getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/jpeg;base64,x' };
        const v = { videoWidth: 1080, videoHeight: 1920, duration: 31 };
        v.load = () => setTimeout(() => {
            if (behaviour === 'error') return v.onerror?.();
            v.onloadedmetadata?.();
        }, 5);
        Object.defineProperty(v, 'currentTime', {
            set() { if (behaviour === 'seeked') setTimeout(() => v.onseeked?.(), 5); },
            get() { return 0; },
        });
        return v;
    },
};
const { probeMedia } = await import('../client/src/utils/mediaProbe.js');
const file = { type: 'video/quicktime', name: 'IMG_5802.MOV' };

let t0 = Date.now();
let meta = await probeMedia(file);
assert.equal(meta.width, 1080);
assert.equal(meta.height, 1920);
assert.equal(meta.duration, 31);
assert.equal(meta.thumbnail, null);
assert.ok(Date.now() - t0 < 5000, 'resolves after the 3 s thumbnail timeout, not never');
console.log('✓ no seeked event (iOS): probe resolves without a thumbnail');

behaviour = 'seeked';
meta = await probeMedia(file);
assert.equal(meta.thumbnail, 'data:image/jpeg;base64,x');
console.log('✓ seeked fires: thumbnail kept');

behaviour = 'error';
await assert.rejects(() => probeMedia(file), /Failed to load video metadata/);
console.log('✓ unreadable video still rejects (handleFileImport falls back to defaults)');

// ── Handoff gate ───────────────────────────────────────────────────────────
const ide = readFileSync(new URL('../client/src/layouts/IDELayout.jsx', import.meta.url), 'utf8');
const effect = ide.slice(ide.indexOf('takePendingNewVideo(projectId)') - 400, ide.indexOf('takePendingNewVideo(projectId)'));
assert.match(effect, /if \(!projectId \|\| !sessionChecked\) return;/, 'waits for the session check, not sessionId');
assert.doesNotMatch(effect, /!sessionId\)/, 'signed-in users have no sessionId: must not gate on it');
const session = readFileSync(new URL('../client/src/store/useSessionStore.js', import.meta.url), 'utf8');
assert.match(session, /if \(localStorage\.getItem\(LS_MIGRATED\)\) return null;/, 'premise: signed-in users get no session id');
console.log('✓ New video handoff waits for the session check (signed-in users have no session id)');

console.log('\nALL IMPORT-HANDOFF CHECKS PASSED');
