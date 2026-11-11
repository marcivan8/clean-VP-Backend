import assert from 'node:assert/strict';
import { transcriptForAssetRange } from '../client/src/timeline/assetTranscript.js';

const sharedCaptions = [
  { start: 0, end: 0.4, word: 'main', assetId: 'talking-head' },
  { start: 0.5, end: 0.9, word: 'rush', assetId: 'event-rush' },
  { start: 1, end: 1.4, word: 'legacy-unscoped' },
];

assert.equal(transcriptForAssetRange({
  assetId: 'event-rush', duration: 2, captions: sharedCaptions, allowUnscopedCaptions: false,
}), 'rush', 'asset-tagged words are matched to their source and timeline time range');
assert.equal(transcriptForAssetRange({
  assetId: 'event-rush', duration: 2, captions: [{ start: 0, end: 0.5, word: 'wrong source' }], allowUnscopedCaptions: false,
}), '', 'multi-asset edits never reuse another asset’s unscoped transcript');
assert.equal(transcriptForAssetRange({
  assetId: 'talking-head', duration: 2, diarizationByAsset: { 'talking-head': { words: [{ start: 0, end: 0.5, word: 'per asset' }] } },
  captions: sharedCaptions, allowUnscopedCaptions: false,
}), 'per asset', 'per-asset diarization takes precedence over global captions');
assert.equal(transcriptForAssetRange({
  assetId: 'single', duration: 2, captions: [{ start: 0, end: 0.5, text: 'single source fallback' }], allowUnscopedCaptions: true,
}), 'single source fallback', 'legacy unscoped captions remain available for a single-source edit');
console.log('Asset transcript routing passed: multi-rush transcripts stay source-scoped.');
