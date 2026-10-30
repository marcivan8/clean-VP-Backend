import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getAssetDropTime } from '../client/src/timeline/assetDropPosition.js';

assert.equal(getAssetDropTime({ clientX: 300, laneLeft: 100, zoomLevel: 20 }), 10, 'pixel offset converts to timeline seconds');
assert.equal(getAssetDropTime({ clientX: 30, laneLeft: 100, zoomLevel: 20 }), 0, 'drop time is clamped to timeline start');
assert.equal(getAssetDropTime({ clientX: null, laneLeft: null, zoomLevel: 0, currentTime: 12 }), 12, 'invalid geometry falls back to playhead');

const [layout, track, assetCard] = await Promise.all([
    readFile(new URL('../client/src/layouts/IDELayout.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../client/src/components/Timeline/Track.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../client/src/components/DraggableAsset.jsx', import.meta.url), 'utf8'),
]);
assert.match(layout, /useSensor\(MouseSensor,\s*\{ activationConstraint: \{ distance: 5 \} \}\)/, 'mouse drag does not depend on viewport width or long-press delay');
assert.match(layout, /useSensor\(TouchSensor,\s*\{ activationConstraint: \{ delay: 300, tolerance: 8 \} \}\)/, 'touch drag retains a scroll-friendly hold');
assert.match(track, /data-timeline-track=\{track\.id\}/, 'timeline lanes expose their geometry for drop placement');
assert.match(assetCard, /draggable=\{true\}/, 'media cards remain draggable on desktop and hybrid devices');
assert.match(assetCard, /application\/x-vibed-asset-id/, 'asset drag carries an explicit asset identifier');
assert.match(track, /onDragOver=\{onLaneDragOver\}[\s\S]*onDrop=\{onLaneDrop\}/, 'timeline lanes accept native asset drops');
assert.match(track, /data-testid="asset-drop-indicator"/, 'drop position is visibly marked on the timeline');

console.log('✅ Asset-to-timeline drag behavior tests passed');
