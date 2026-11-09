import assert from 'node:assert/strict';
import { SceneImageTextureCache } from '../client/src/motion/SceneImageTextureCache.js';

const cache = new SceneImageTextureCache(16);
const still = (src, width = 2, height = 2) => ({ tagName: 'IMG', src, currentSrc: src, naturalWidth: width, naturalHeight: height });
const a = still('/a.png'), b = still('/b.webp'), c = still('/c.jpg');
const pixels = size => ({ data: new Uint8ClampedArray(size) });

assert.equal(cache.set(a, pixels(8)), true);
cache.set(b, pixels(8));
assert.equal(cache.get(a).data.byteLength, 8); // Refresh a; b is now least recently used.
assert.equal(cache.set(c, pixels(12)), true);
assert.equal(cache.get(b), null, 'least recently used texture is evicted at the byte limit');
assert.equal(cache.get(c).data.byteLength, 12);
assert.equal(cache.bytes, 12);

const changed = still('/changed.png');
cache.set(changed, pixels(8));
changed.currentSrc = '/new.png';
assert.equal(cache.get(changed), null, 'a source URL change invalidates stale pixels');

for (const source of [still('/motion.gif'), { tagName: 'CANVAS', width: 2, height: 2 }, { tagName: 'VIDEO', videoWidth: 2, videoHeight: 2 }]) {
    assert.equal(cache.set(source, pixels(4)), false, 'animated or mutable sources are never cached');
    assert.equal(cache.get(source), null);
}

cache.clear();
assert.equal(cache.entries.size, 0);
assert.equal(cache.bytes, 0);
console.log('Scene texture cache checks passed: bounded LRU, immutable stills only, and URL invalidation.');
