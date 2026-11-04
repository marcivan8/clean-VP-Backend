import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const { SFX_LIBRARY } = require('../server/audio-engine/library/starterLibrary.js');
const { QueryParser } = require('../server/audio-engine/search/QueryParser.js');
const { AssetType, EditingIntent } = require('../server/audio-engine/types.js');
const cues = await import(pathToFileURL(path.join(root, 'client/src/agent/sfxCues.js')));
const names = new Set(SFX_LIBRARY.map(asset => asset.name));
const parser = new QueryParser();

for (const file of [
    'risers-cinematic-riser-1.mp3', 'ambient-tension-low.mp3',
    'whooshs-special-effect-flash-fast-swoosh-16.mp3',
    'camera-sounds-camera-35mm-slr-shutter.mp3',
    'electronic-static-analog-glitch.mp3', 'reveal-power-up.mp3',
    'comedy-slide-whistle.mp3', 'comedy-pop-01.mp3',
]) {
    assert.ok(fs.existsSync(path.join(root, 'client/public/sfx-library', file)), `missing bundled file: ${file}`);
    const asset = SFX_LIBRARY.find(row => row.name === file.replace(/\.mp3$/, ''));
    assert.ok(asset, `not included in searchable catalog: ${file}`);
    assert.ok(asset.previewUrl?.startsWith('/sfx-library/'), `not playable from app: ${file}`);
}

for (const [query, intent] of [
    ['digital riser sound', EditingIntent.TECHNOLOGY],
    ['camera shutter', EditingIntent.FOLEY],
    ['suspense riser', EditingIntent.SUSPENSE],
    ['comic sound effect', EditingIntent.COMEDY],
    ['digital reveal', EditingIntent.REVEAL],
    ['flash transition', EditingIntent.TRANSITION],
]) {
    const parsed = parser.parse(query);
    assert.ok(parsed.assetTypes.includes(AssetType.SOUND_EFFECT), `${query} did not route to SFX`);
    assert.ok(parsed._allIntents.includes(intent), `${query} did not map to ${intent}`);
}

for (const [prompt, expected] of [
    ['add a suspense riser', 'suspense riser'], ['use a camera shutter', 'camera shutter'],
    ['add a comic sound', 'comic sound'], ['digital reveal sound', 'digital reveal'],
    ['digital riser', 'digital riser'], ['add a flash', 'flash'],
]) assert.equal(cues.sfxQueryFromText(prompt), expected);

assert.deepEqual(cues.mergeSfxCues([{ t: 1, kind: 'digital_reveal' }, { t: 2, kind: 'riser' }]).map(c => c.kind), ['digital_reveal', 'riser']);
const auto = cues.collectSfxCues([{ type: 'video', clips: [
    { id: 'f', start: 0, duration: 3, transition: { type: 'flash' } },
    { id: 'g', start: 4, duration: 3, transition: { type: 'glitch' } },
] }]);
assert.deepEqual(auto.map(c => c.kind), ['flash', 'digital']);
console.log('ALL SFX BREADTH CHECKS PASSED');
