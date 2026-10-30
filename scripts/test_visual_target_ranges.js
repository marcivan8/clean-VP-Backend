const assert = require('node:assert/strict');
const { rangesFromFrameMatches } = require('../server/brain/media/visualTargetRanges');

const ranges = rangesFromFrameMatches([
    { timestamp: 3, confidence: 0.91, evidence: 'red car in foreground' },
    { timestamp: 1, confidence: 0.87, evidence: 'red car entering frame' },
    { timestamp: 5, confidence: 0.3, evidence: 'uncertain color' },
    { timestamp: 8, confidence: 0.82, evidence: 'red car parked' },
], 2, 9);

assert.equal(ranges.length, 2, 'nearby positive frames merge and low-confidence frames are ignored');
assert.deepEqual([ranges[0].start, ranges[0].end], [0, 4]);
assert.equal(ranges[0].confidence, 0.87, 'merged candidate uses the least confident positive frame');
assert.match(ranges[0].evidence, /entering frame.*foreground/);
assert.deepEqual([ranges[1].start, ranges[1].end], [7, 9], 'ranges stay within the source duration');
const bounded = rangesFromFrameMatches([{ timestamp: 10, confidence: 0.9, evidence: 'person waving' }], 2, 12, 9.5);
assert.deepEqual([bounded[0].start, bounded[0].end], [9.5, 11], 'ranges stay inside a non-zero source scan window');

console.log('ALL VISUAL TARGET RANGE CHECKS PASSED');
