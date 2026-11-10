import assert from 'node:assert/strict';
import { findMissingAudioReactiveWaveforms } from '../client/src/motion/AudioReactiveValidation.js';

const configured = {
  tracks: [
    { clips: [{ audioReactive: { assetId: 'music-a' } }, { audioReactive: { assetId: 'music-b' } }] },
    { template: { params: { scene: { objects: [{ audioReactive: { assetId: 'music-a' } }] } } } },
  ],
};
assert.deepEqual(findMissingAudioReactiveWaveforms(configured, {
  'music-a': { peaks: [0, 0.6], duration: 2 },
}), ['music-b'], 'finds unique missing refs across nested compositions');
assert.deepEqual(findMissingAudioReactiveWaveforms(configured, {
  'music-a': [0, 0.6], 'music-b': { peaks: [0, 0, 0], duration: 3 },
}), [], 'accepts object and raw-array waveform formats, including analyzed silence');
const cyclic = { audioReactive: { assetId: 'missing' } };
cyclic.self = cyclic;
assert.deepEqual(findMissingAudioReactiveWaveforms(cyclic), ['missing'], 'handles cyclic object graphs');
console.log('Audio reactive export validation checks passed.');
