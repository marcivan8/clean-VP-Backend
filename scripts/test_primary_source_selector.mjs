import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { selectPrimaryNarrationAsset } from '../client/src/agent/PrimarySourceSelector.js';

const assets = [
    { id: 'event', type: 'video', name: 'event.mov', userUploaded: true, url: '/event' },
    { id: 'talk', type: 'video', name: 'talk.mov', userUploaded: true, url: '/talk' },
    { id: 'ref', type: 'video', name: 'reference.mov', userUploaded: true, url: '/ref', is_reference: true },
];

assert.equal(selectPrimaryNarrationAsset(assets, [{ assetId: 'talk', hasMainSpeaker: true }]).asset.id, 'talk',
    'main speaker analysis chooses the narration source even when it was not uploaded first');
assert.equal(selectPrimaryNarrationAsset(assets, [{ assetId: 'talk', hasSpokenWord: true }]).asset.id, 'talk',
    'speech detection can distinguish the narration source when speaker detection is unavailable');
assert.equal(selectPrimaryNarrationAsset(assets, []).asset.id, 'event',
    'pending analysis falls back deterministically to first uploaded video');
assert.equal(selectPrimaryNarrationAsset(assets, []).candidateCount, 2,
    'references are excluded from source selection');
assert.equal(selectPrimaryNarrationAsset([{ id: 'image', type: 'image', url: '/image' }]).asset, null,
    'image-only projects remain eligible for the collage path');

const autopilot = await readFile(new URL('../client/src/agent/StyleAutopilot.js', import.meta.url), 'utf8');
const outcomes = await readFile(new URL('../client/src/agent/mobileOutcomes.js', import.meta.url), 'utf8');
assert.match(autopilot, /opts\.sourceSelection === 'narration'/);
assert.match(autopilot, /addAssetToTimeline\(primarySource\.asset\)/);
assert.match(autopilot, /supporting footage stays available for contextual cutaways/);
assert.match(outcomes, /sourceSelection: outcomeId === 'photo_collage' \? 'visual' : 'narration'/);
console.log('✓ primary source selector and mobile Auto wiring passed');
