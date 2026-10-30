import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getAssetDropTime, getDropClientX } from '../client/src/timeline/assetDropPosition.js';

assert.equal(getDropClientX({ clientX: 120 }, 35), 155, 'mouse drop uses the pointer release position');
assert.equal(getDropClientX({ changedTouches: [{ clientX: 80 }] }, 20), 100, 'touch drop uses its release position');
assert.equal(getDropClientX({}, 20), null, 'missing pointer coordinates are handled');
assert.equal(getAssetDropTime({ clientX: 300, laneLeft: 100, zoomLevel: 20 }), 10, 'pixel offset converts to timeline seconds');
assert.equal(getAssetDropTime({ clientX: 30, laneLeft: 100, zoomLevel: 20 }), 0, 'drop time is clamped to timeline start');
assert.equal(getAssetDropTime({ clientX: null, laneLeft: null, zoomLevel: 0, currentTime: 12 }), 12, 'invalid geometry falls back to playhead');

const [layout, track] = await Promise.all([
    readFile(new URL('../client/src/layouts/IDELayout.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../client/src/components/Timeline/Track.jsx', import.meta.url), 'utf8'),
]);
assert.match(layout, /useSensor\(MouseSensor,\s*\{ activationConstraint: \{ distance: 5 \} \}\)/, 'mouse drag does not depend on viewport width or long-press delay');
assert.match(layout, /useSensor\(TouchSensor,\s*\{ activationConstraint: \{ delay: 300, tolerance: 8 \} \}\)/, 'touch drag retains a scroll-friendly hold');
assert.match(layout, /getAssetDropTime\(/, 'asset drops use calculated pointer time');
assert.match(track, /data-timeline-track=\{track\.id\}/, 'timeline lanes expose their geometry for drop placement');

console.log('✅ Asset-to-timeline drag behavior tests passed');
