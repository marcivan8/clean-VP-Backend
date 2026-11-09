import assert from 'node:assert/strict';
import { VideoTextureCache, resolveSceneAudioReactiveAssetIds, resolveSceneImageTextures, resolveSceneVideoTextures } from '../client/src/motion/VideoTextureCache.js';

assert.deepEqual(resolveSceneAudioReactiveAssetIds({
  objects: [{ audioReactive: { assetId: 'voice' } }, { audioReactive: { assetId: 'music' } }, {}],
  particles: { audioReactive: { assetId: 'music' } },
}), ['voice', 'music'], 'preview requests unique waveform assets for object and particle audio reactivity');

class FakeVideo {
    constructor() { this.readyState = 0; this.events = new Map(); this.paused = false; this.removed = false; this.loads = 0; }
    addEventListener(name, callback) { this.events.set(name, callback); }
    removeEventListener(name) { this.events.delete(name); }
    emit(name) { this.events.get(name)?.(); }
    load() { this.loads++; }
    pause() { this.paused = true; }
    removeAttribute(name) { if (name === 'src') this.removed = true; }
}

const created = [];
const cache = new VideoTextureCache(() => { const video = new FakeVideo(); created.push(video); return video; }, 2);

assert.deepEqual(resolveSceneVideoTextures([
  { id: 'scene-video', type: 'video', videoAssetId: 'asset-video', videoTextureKey: 'texture-a' },
  { id: 'direct-video', type: 'video', videoUrl: 'https://media.example/video.mp4' },
  { id: 'missing-video', type: 'video', videoAssetId: 'missing' },
], [{ id: 'asset-video', sourceUrl: 'https://storage.example/original.mp4', proxyUrl: '/api/proxy/video.mp4', url: 'https://storage.example/video.mp4' }]), [
  { object: { id: 'scene-video', type: 'video', videoAssetId: 'asset-video', videoTextureKey: 'texture-a' }, url: 'https://storage.example/original.mp4', textureKey: 'texture-a' },
  { object: { id: 'direct-video', type: 'video', videoUrl: 'https://media.example/video.mp4' }, url: 'https://media.example/video.mp4', textureKey: 'direct-video' },
], '3D preview resolves manifest-backed video textures and stable keys, matching export source lookup');
assert.equal(resolveSceneVideoTextures([{ type: 'video', videoAssetId: 'asset' }], [
  { id: 'asset', proxyUrl: '/proxy.mp4', url: '/asset.mp4' },
])[0].url, '/proxy.mp4', 'preview falls back to the proxy when the original source is unavailable');
assert.equal(resolveSceneVideoTextures([{ type: 'video', videoAssetId: 'asset' }], [
  { id: 'asset', url: '/asset.mp4' },
])[0].url, '/asset.mp4', 'preview falls back to the asset URL when neither source nor proxy exists');
assert.deepEqual(resolveSceneImageTextures([
  { id: 'image-plane', type: 'image', imageAssetId: 'still' },
  { id: 'textured-mesh', type: 'mesh', imageAssetId: 'mesh-texture' },
  { id: 'direct-image', type: 'image', imageUrl: '/direct.png' },
], [
  { id: 'still', sourceUrl: '/original.png', proxyUrl: '/proxy.png' },
  { id: 'mesh-texture', proxyUrl: '/mesh.png' },
]), [
  { object: { id: 'image-plane', type: 'image', imageAssetId: 'still' }, url: '/original.png' },
  { object: { id: 'textured-mesh', type: 'mesh', imageAssetId: 'mesh-texture' }, url: '/mesh.png' },
  { object: { id: 'direct-image', type: 'image', imageUrl: '/direct.png' }, url: '/direct.png' },
], '3D preview resolves image-plane and mesh textures from asset IDs, matching export fallbacks');
let firstFrames = 0, secondFrames = 0;
const releaseFirst = cache.subscribe('/a.mp4', () => firstFrames++);
const releaseSecond = cache.subscribe('/a.mp4', () => secondFrames++);
assert.equal(created.length, 1, 'the same source is decoded once for multiple scene users');
assert.equal(created[0].muted, true);
assert.equal(created[0].crossOrigin, 'anonymous');
created[0].readyState = 2;
created[0].emit('loadeddata');
assert.equal(firstFrames, 1);
assert.equal(secondFrames, 1);
assert.equal(cache.get('/a.mp4'), created[0]);
releaseFirst();
created[0].emit('seeked');
assert.equal(firstFrames, 1, 'released components receive no more frame notifications');
assert.equal(secondFrames, 2);

const releaseB = cache.subscribe('/b.mp4', () => {});
releaseB();
cache.get('/a.mp4'); // make a the most recently used entry
const releaseC = cache.subscribe('/c.mp4', () => {});
assert.equal(created[1].removed, true, 'least-recently-used inactive source releases its decoder');
assert.equal(cache.get('/a.mp4'), created[0]);
assert.equal(cache.get('/b.mp4'), null);
releaseC();
releaseSecond();

// Active entries are retained even above the soft limit. Once a user releases
// one, trimming immediately returns the cache to the configured bound.
const releaseD = cache.subscribe('/d.mp4', () => {});
const releaseE = cache.subscribe('/e.mp4', () => {});
const releaseF = cache.subscribe('/f.mp4', () => {});
assert.equal(cache.entries.size, 3);
releaseD();
assert.equal(cache.entries.size, 2);
releaseE(); releaseF();
cache.clear();
assert.equal(cache.entries.size, 0);
console.log('Video texture cache checks passed: shared subscriptions, listener release, LRU disposal, active-source retention, and clear.');
