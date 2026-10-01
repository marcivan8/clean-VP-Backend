// Mobile Home + plan sheet helpers (client/src/lib/planLimits.js,
// client/src/utils/pendingNewVideo.js), pure.
// node scripts/test_mobile_home.mjs
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import {
    AI_OPS_LIMITS, getAiOpsLimit, nextPlan, startOfUsageMonth, nextUsageReset, aiOpsMeter,
    projectNameFromFile, atLimit, getProjectLimit,
} from '../client/src/lib/planLimits.js';
import { setPendingNewVideo, takePendingNewVideo } from '../client/src/utils/pendingNewVideo.js';

// limits mirror the server gate (middleware/usageGate.js)
const gate = readFileSync(new URL('../middleware/usageGate.js', import.meta.url), 'utf8');
for (const [plan, n] of Object.entries({ free: 10, creator: 100 })) {
    assert.match(gate, new RegExp(`${plan}:\\s*\\{\\s*ai_ops:\\s*${n}\\b`), `server ${plan} ai_ops is ${n}`);
    assert.equal(AI_OPS_LIMITS[plan], n);
}
assert.match(gate, /pro:\s*\{\s*ai_ops:\s*-1\b/);
assert.equal(getAiOpsLimit('pro'), Infinity);
assert.equal(getAiOpsLimit('weird'), 10, 'unknown plan falls back to free');
assert.equal(nextPlan('free'), 'creator');
assert.equal(nextPlan(undefined), 'creator');
assert.equal(nextPlan('creator'), 'pro');
assert.equal(nextPlan('pro'), null);
console.log('✓ limits match the server gate, next plan');

// usage month = UTC calendar month (same window as getMonthlyOpsCount)
const mid = new Date('2026-10-15T12:00:00Z');
assert.equal(startOfUsageMonth(mid).toISOString(), '2026-10-01T00:00:00.000Z');
assert.equal(nextUsageReset(mid).toISOString(), '2026-11-01T00:00:00.000Z');
assert.equal(nextUsageReset(new Date('2026-12-31T23:59:00Z')).toISOString(), '2027-01-01T00:00:00.000Z');
assert.equal(startOfUsageMonth(new Date('2026-11-01T00:30:00+02:00')).toISOString(), '2026-10-01T00:00:00.000Z', 'UTC, not local time');
console.log('✓ usage month and reset date (UTC, year rollover)');

assert.deepEqual(aiOpsMeter(7, 'free'), { used: 7, limit: 10, unlimited: false, ratio: 0.7, exhausted: false });
assert.equal(aiOpsMeter(10, 'free').exhausted, true);
assert.equal(aiOpsMeter(14, 'free').ratio, 1, 'bar never overflows');
assert.equal(aiOpsMeter(null, 'creator').used, 0);
assert.equal(aiOpsMeter(-3, 'creator').used, 0);
assert.equal(aiOpsMeter(500, 'pro').unlimited, true);
assert.equal(aiOpsMeter(500, 'pro').exhausted, false);
console.log('✓ meter');

assert.equal(projectNameFromFile('IMG_5802.MOV'), 'IMG_5802');
assert.equal(projectNameFromFile('my.trip.final.mp4'), 'my.trip.final');
assert.equal(projectNameFromFile('  Podcast ep 12.webm '), 'Podcast ep 12', 'spaces around the name');
assert.equal(projectNameFromFile('noext'), 'noext');
assert.equal(projectNameFromFile(''), '');
assert.equal(projectNameFromFile(undefined), '');
assert.equal(projectNameFromFile('x'.repeat(200) + '.mp4').length, 80);
assert.equal(atLimit('free', 2), true);
assert.equal(atLimit('creator', 500), false);
assert.equal(getProjectLimit('free'), 2);
console.log('✓ project name from file, project limit');

// pending new video: handed over once, per project
const file = { name: 'IMG_1.MOV' };
setPendingNewVideo('p1', file);
assert.equal(takePendingNewVideo('p2'), null);
assert.equal(takePendingNewVideo('p1'), file);
assert.equal(takePendingNewVideo('p1'), null, 'second take (StrictMode re-run) gets nothing');
setPendingNewVideo(null, file);
setPendingNewVideo('p3', null);
assert.equal(takePendingNewVideo('p3'), null);
assert.equal(takePendingNewVideo(undefined), null);
console.log('✓ pending new video handoff');

console.log('\nALL MOBILE-HOME CHECKS PASSED');
