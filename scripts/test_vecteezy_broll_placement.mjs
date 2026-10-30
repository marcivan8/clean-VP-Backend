// Stock b-roll wiring regression: placement must work without a saved project
// (and therefore without a local-profile request) and be idempotent.
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.innerWidth = 1200;

const { default: useTimelineStore } = await import('../client/src/store/useTimelineStore.js');
const { VideoEditorTools } = await import('../client/src/agent/VideoEditorTools.js');

const timelineManager = window.timelineManager;
timelineManager.fromLegacyTracks([{ id: 'base', type: 'video', name: 'Camera', clips: [
    { id: 'camera', type: 'video', assetId: 'camera-asset', start: 0, duration: 30, offset: 0, speed: 1 },
] }]);
useTimelineStore.setState({
    tracks: timelineManager.toLegacyTracks(), projectId: null, duration: 30, currentTime: 0,
    assets: [], captions: [{ word: 'travel', start: 1, end: 1.5 }], past: [], future: [],
});

const stockAsset = {
    id: 'vecteezy-video-cutaway', type: 'video', name: 'City walk', provider: 'vecteezy',
    url: 'https://cdn.vecteezy.example/cutaway.mp4', thumbnail: 'https://cdn.vecteezy.example/cutaway.jpg', duration: 12,
};
let stockCalls = 0;
globalThis.fetch = async (url) => {
    assert.equal(url, '/api/stock/suggest-broll');
    stockCalls++;
    return {
        ok: true, status: 200,
        json: async () => ({ provider: 'vecteezy', suggestions: [
            { timelineTime: 5, duration: 3.5, asset: stockAsset },
        ] }),
    };
};

const tools = new VideoEditorTools();
const first = await tools.placeContextualBroll();
assert.equal(first.success, true);
assert.equal(first.fromStock, 1);
assert.equal(first.provider, 'vecteezy');
let overlayClips = useTimelineStore.getState().tracks.filter(t => t.type === 'overlay').flatMap(t => t.clips || []);
assert.equal(overlayClips.length, 1, 'Vecteezy footage must be inserted on an overlay track');
assert.equal(overlayClips[0].assetId, stockAsset.id);
assert.equal(overlayClips[0].start, 5);

const second = await tools.placeContextualBroll();
assert.equal(second.fromStock || 0, 0);
overlayClips = useTimelineStore.getState().tracks.filter(t => t.type === 'overlay').flatMap(t => t.clips || []);
assert.equal(overlayClips.length, 1, 'a rerun must not duplicate the same stock cutaway');
assert.equal(stockCalls, 2, 'the stock path should be reachable without a saved project id');

// A local match used to suppress the stock path entirely. Verify a local
// cutaway and a non-overlapping stock suggestion both make it onto the edit.
timelineManager.fromLegacyTracks([{ id: 'base2', type: 'video', name: 'Camera', clips: [
    { id: 'camera2', type: 'video', assetId: 'camera-asset-2', start: 0, duration: 30, offset: 0, speed: 1 },
] }]);
const localAsset = { id: 'local-cutaway', type: 'video', name: 'Travel city', url: 'https://media.example/local.mp4', duration: 10 };
useTimelineStore.setState({
    tracks: timelineManager.toLegacyTracks(), projectId: 'saved-project', duration: 30, currentTime: 0,
    assets: [localAsset], captions: [
        { word: 'travel', start: 1, end: 1.4 }, { word: 'city', start: 1.5, end: 2 },
        { word: 'science', start: 15, end: 15.5 }, { word: 'research', start: 15.6, end: 16 },
    ], past: [], future: [],
});
globalThis.fetch = async (url) => {
    if (url.startsWith('/api/brain/broll-profiles?')) {
        return { ok: true, status: 200, json: async () => ({ profiles: [
            { assetId: localAsset.id, name: localAsset.name, contentDescription: 'travel city walking', hasMainSpeaker: false },
        ] }) };
    }
    assert.equal(url, '/api/stock/suggest-broll');
    stockCalls++;
    return {
        ok: true, status: 200,
        json: async () => ({ provider: 'vecteezy', suggestions: [
            { timelineTime: 15, duration: 3.5, asset: stockAsset },
        ] }),
    };
};
const mixed = await tools.placeContextualBroll();
assert.equal(mixed.success, true);
assert.equal(mixed.fromStock, 1, 'stock must fill dialogue not covered by a local match');
assert.equal(mixed.placements.length, 2, 'both local and Vecteezy cutaways should be reported');
assert.ok(mixed.placements.some(p => p.assetId === localAsset.id));
assert.ok(mixed.placements.some(p => p.assetId === stockAsset.id));
overlayClips = useTimelineStore.getState().tracks.filter(t => t.type === 'overlay').flatMap(t => t.clips || []);
assert.equal(overlayClips.length, 2, 'both cutaways must be present on the timeline');

// A selected semantic/timeline range constrains both the search words and
// proposed stock placement; a result crossing the boundary is trimmed.
timelineManager.fromLegacyTracks([{ id: 'base3', type: 'video', name: 'Camera', clips: [
    { id: 'camera3', type: 'video', assetId: 'camera-asset-3', start: 0, duration: 30, offset: 0, speed: 1 },
] }]);
useTimelineStore.setState({
    tracks: timelineManager.toLegacyTracks(), projectId: null, duration: 30, currentTime: 0,
    assets: [], captions: [{ word: 'launch', start: 11, end: 11.5 }],
    selectedTimelineRange: { start: 10, end: 14 }, past: [], future: [],
});
globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/stock/suggest-broll');
    const request = JSON.parse(options.body);
    assert.deepEqual(request.words.map(w => w.word), ['launch'], 'stock search receives only selected-range transcript words');
    return {
        ok: true, status: 200,
        json: async () => ({ provider: 'vecteezy', suggestions: [
            { timelineTime: 9, duration: 5, asset: stockAsset },
        ] }),
    };
};
const targeted = await tools.placeContextualBroll();
assert.equal(targeted.fromStock, 1);
overlayClips = useTimelineStore.getState().tracks.filter(t => t.type === 'overlay').flatMap(t => t.clips || []);
assert.equal(overlayClips.length, 1);
assert.equal(overlayClips[0].start, 10, 'cutaway starts no earlier than the selected target');
assert.equal(overlayClips[0].duration, 4, 'cutaway is clipped to the selected target bounds');

useTimelineStore.setState({ selectedTimelineRange: { start: 12, end: 15 }, tracks: timelineManager.toLegacyTracks() });
globalThis.fetch = async (url) => {
    assert.match(url, /^\/api\/stock\/search\?query=red\+car/);
    return { ok: true, status: 200, json: async () => ({ provider: 'vecteezy', results: [{
        id: 'specific-car-broll', type: 'video', name: 'Red car', provider: 'vecteezy', duration: 8,
        url: 'https://cdn.vecteezy.example/car.mp4', thumbnail: 'https://cdn.vecteezy.example/car.jpg',
    }] }) };
};
const specific = await tools.fetchStockBroll({ query: 'red car' });
assert.equal(specific.success, true);
assert.deepEqual(specific.details.timelineRange, [12, 15], 'specific B-roll search places at selected interval and respects its length');
overlayClips = useTimelineStore.getState().tracks.filter(t => t.type === 'overlay').flatMap(t => t.clips || []);
assert.equal(overlayClips.at(-1).start, 12);
assert.equal(overlayClips.at(-1).duration, 3);

console.log('PASS: Vecteezy b-roll is inserted without a project id, fills uncovered moments, and reruns are idempotent');
