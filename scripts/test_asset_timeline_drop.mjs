import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addAssetAtTimelinePosition, getAssetDropTime } from '../client/src/timeline/assetDropPosition.js';

assert.equal(getAssetDropTime({ clientX: 300, laneLeft: 100, zoomLevel: 20 }), 10, 'pixel offset converts to timeline seconds');
assert.equal(getAssetDropTime({ clientX: 30, laneLeft: 100, zoomLevel: 20 }), 0, 'drop time is clamped to timeline start');
assert.equal(getAssetDropTime({ clientX: null, laneLeft: null, zoomLevel: 0, currentTime: 12 }), 12, 'invalid geometry falls back to playhead');

const insertedClips = [];
const createdTracks = [];
const emptyTimeline = {
    tracks: [],
    addTrack(type) {
        const id = `track-${createdTracks.length + 1}`;
        createdTracks.push({ id, type, clips: [] });
        this.tracks = [...this.tracks, createdTracks.at(-1)];
        return id;
    },
    addClip(trackId, clip) { insertedClips.push({ trackId, clip }); },
};
const placement = addAssetAtTimelinePosition(emptyTimeline, {
    id: 'asset-multi-upload', type: 'video', name: 'rush.mp4', url: 'blob:test', duration: 8,
}, null, 4.5);
assert.equal(createdTracks[0]?.type, 'video', 'dropping onto an empty timeline creates a video track');
assert.equal(insertedClips[0]?.trackId, placement.trackId, 'the clip is added to the newly created track');
assert.equal(insertedClips[0]?.clip.start, 4.5, 'the clip uses the pointer drop time');

const [layout, timeline, track, assetCard] = await Promise.all([
    readFile(new URL('../client/src/layouts/IDELayout.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../client/src/components/Timeline/Timeline.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../client/src/components/Timeline/Track.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../client/src/components/DraggableAsset.jsx', import.meta.url), 'utf8'),
]);
assert.match(layout, /useSensor\(MouseSensor,\s*\{ activationConstraint: \{ distance: 5 \} \}\)/, 'mouse drag does not depend on viewport width or long-press delay');
assert.match(layout, /useSensor\(TouchSensor,\s*\{ activationConstraint: \{ delay: 300, tolerance: 8 \} \}\)/, 'touch drag retains a scroll-friendly hold');
assert.match(track, /data-timeline-track=\{track\.id\}/, 'timeline lanes expose their track for targeted drops');
assert.match(assetCard, /draggable=\{true\}/, 'media cards remain draggable on desktop and hybrid devices');
assert.match(assetCard, /application\/x-vibed-asset-id/, 'asset drag carries an explicit asset identifier');
assert.match(timeline, /onDragOver=\{handleAssetDragOver\}[\s\S]*onDrop=\{handleAssetDrop\}/, 'the timeline accepts native asset drops, including when no tracks exist');
assert.match(timeline, /addAssetAtTimelinePosition\(state, asset, targetTrackId, position\.time\)/, 'drop handling creates a track when required and inserts the asset');
assert.match(timeline, /data-testid="asset-drop-indicator"/, 'drop position is visibly marked on the timeline');
assert.match(timeline, /Drop media here to create a timeline track/, 'empty timelines explain where to drop media');

console.log('✅ Asset-to-timeline drag behavior tests passed');
