import assert from 'node:assert/strict';
import LazyHls from '../client/src/revideo/LazyHls.js';

const calls = [];
class MockHls {
  constructor(config) { calls.push(['construct', config]); }
  loadSource(source) { calls.push(['source', source]); }
  attachMedia(media) { calls.push(['media', media]); }
  destroy() { calls.push(['destroy']); }
}

let loads = 0;
const loader = async () => { loads += 1; return { default: MockHls }; };
const hls = new LazyHls({ lowLatencyMode: true }, loader);
assert.equal(loads, 0, 'constructing the editor video path does not load HLS');
hls.loadSource('/video/master.m3u8');
assert.equal(loads, 0, 'a playlist URL alone does not load before its media element exists');
hls.attachMedia({ tag: 'video' });
await hls.loading;
assert.equal(loads, 1);
assert.deepEqual(calls, [
  ['construct', { lowLatencyMode: true }],
  ['source', '/video/master.m3u8'],
  ['media', { tag: 'video' }],
]);
hls.destroy();
assert.deepEqual(calls.at(-1), ['destroy']);

const destroyedBeforeLoad = new LazyHls({}, async () => {
  await Promise.resolve();
  return { default: MockHls };
});
destroyedBeforeLoad.loadSource('/video/late.m3u8');
destroyedBeforeLoad.attachMedia({ tag: 'late-video' });
destroyedBeforeLoad.destroy();
await destroyedBeforeLoad.loading;
assert.equal(calls.filter(([call]) => call === 'construct').length, 1,
  'destroying before module resolution does not create a late HLS instance');

console.log('Lazy HLS checks passed: deferred load, source/media attachment order, and teardown races.');
