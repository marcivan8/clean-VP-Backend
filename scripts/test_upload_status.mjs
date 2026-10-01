// Mobile upload status (client/src/utils/uploadStatus.js), pure.
// node scripts/test_upload_status.mjs
import assert from 'assert/strict';
import { getAssetUploadStatus, summarizeUploads, toMB } from '../client/src/utils/uploadStatus.js';

const FILE = { name: 'x.mov' };
const v = (o) => ({ id: 'a', type: 'video', name: 'IMG_5781.MOV', fileSize: 430 * 1024 * 1024, file: FILE, ...o });
const S = (a) => getAssetUploadStatus(a);

// phases
assert.deepEqual(S(v({ uploadPhase: 'uploading', isProxying: true, uploadProgress: 42 })), { phase: 'uploading', progress: 42 });
// IDELayout's 5-second timer flips uploadPhase to 'processing' mid-upload: still "uploading" until the bytes land
assert.equal(S(v({ uploadPhase: 'processing', isProxying: true, uploadProgress: 12 })).phase, 'uploading');
assert.equal(S(v({ uploadPhase: 'processing', isProxying: true, uploadProgress: 100 })).phase, 'preparing');
assert.equal(S(v({ uploadPhase: 'processing', isProxying: true, uploadProgress: 60, gcsPath: 'raw/u/x.mov' })).phase, 'preparing');
assert.equal(S(v({ uploadPhase: 'ready', isProxying: false })).phase, 'ready');
assert.equal(S(v({})).phase, 'ready', 'older assets without upload fields are ready');
assert.equal(S(v({ uploadPhase: 'ready', isProxying: false, uploadError: 'boom' })).phase, 'failed');
assert.equal(S(v({ uploadPhase: 'ready', isProxying: false, uploadError: 'boom', file: undefined })).phase, 'interrupted');
assert.equal(S(v({ uploadPhase: 'uploading', isProxying: true, file: undefined })).phase, 'interrupted', 'reloaded mid-upload');
assert.equal(S({ id: 'i', type: 'image', uploadPhase: 'uploading' }).phase, 'ready', 'images never block');
assert.equal(S(undefined).phase, 'ready');
assert.equal(S(v({ uploadPhase: 'uploading', isProxying: true, uploadProgress: 140 })).phase, 'preparing');
console.log('✓ asset phases (incl. the 5 s processing timer and reloads)');

const T = (main, extra = []) => [{ id: 'track-default-video', type: 'video', clips: main }, ...extra];
const clip = (id, assetId, start = 0) => ({ id, assetId, start, duration: 5 });

// first upload: single clip on the main track still uploading → full card, export blocked
let s = summarizeUploads([v({ uploadPhase: 'uploading', isProxying: true, uploadProgress: 10 })], T([clip('c1', 'a')]));
assert.equal(s.blocking, true); assert.equal(s.exportBlocked, true); assert.equal(s.primary.id, 'a');
assert.equal(s.headline, 'waiting');
console.log('✓ first upload: card on the preview, Export disabled');

// second video while the first is ready → pill only (preview keeps playing), export blocked if it's on the timeline
const ready = { id: 'r', type: 'video', name: 'A.MOV', uploadPhase: 'ready', isProxying: false };
s = summarizeUploads([ready, v({ uploadPhase: 'uploading', isProxying: true, uploadProgress: 50 })], T([clip('c1', 'r'), clip('c2', 'a', 5)]));
assert.equal(s.blocking, false); assert.equal(s.items.length, 1); assert.equal(s.exportBlocked, true);
// pending video only in the media bin (multi-file upload not placed) → not blocking export
s = summarizeUploads([ready, v({ uploadPhase: 'uploading', isProxying: true, uploadProgress: 50 })], T([clip('c1', 'r')]));
assert.equal(s.blocking, false); assert.equal(s.exportBlocked, false);
console.log('✓ later uploads: pill, preview stays usable; bin-only uploads do not block Export');

// failure wins the card; headline 'failed'
s = summarizeUploads([v({ uploadPhase: 'ready', isProxying: false, uploadError: 'x' })], T([clip('c1', 'a')]));
assert.equal(s.blocking, true); assert.equal(s.primary.phase, 'failed'); assert.equal(s.headline, 'failed');
// everything ready → nothing
s = summarizeUploads([ready], T([clip('c1', 'r')]));
assert.deepEqual([s.items.length, s.blocking, s.exportBlocked, s.headline, s.primary], [0, false, false, null, null]);
// clips with no asset (text, legacy) never block
s = summarizeUploads([], T([clip('c1', undefined)]));
assert.equal(s.blocking, false);
// empty main track + pending upload → card (nothing to play anyway)
s = summarizeUploads([v({ uploadPhase: 'uploading', isProxying: true })], T([]));
assert.equal(s.blocking, true);
assert.equal(toMB(430 * 1024 * 1024), 430); assert.equal(toMB(0), null);
console.log('✓ failure, all-ready, legacy clips, empty timeline');
console.log('\nALL UPLOAD-STATUS CHECKS PASSED');
