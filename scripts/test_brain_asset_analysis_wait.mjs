#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    visualAnalysisAssetIds,
    waitForAssetAnalysisStatus,
} from '../client/src/agent/assetAnalysisWait.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

assert.deepEqual(visualAnalysisAssetIds([
    { id: 'video-1', type: 'video' },
    { id: 'image-1', type: 'image/png' },
    { id: 'audio-1', type: 'audio' },
    { id: 'large-image', type: 'image', visualAnalysisRequested: false },
    { id: 'video-1', type: 'video/mp4' },
]), ['video-1', 'image-1']);

let now = 0;
let polls = 0;
const finished = await waitForAssetAnalysisStatus(
    ['video-1'],
    async () => (++polls === 1 ? { 'video-1': 'processing' } : { 'video-1': 'done' }),
    { timeoutMs: 100, intervalMs: 10, now: () => now, sleep: async ms => { now += ms; } },
);
assert.deepEqual(finished, { settled: true, pendingAssetIds: [], checkFailed: false });
assert.equal(polls, 2, 'polls again while analysis is processing');

const failedIsTerminal = await waitForAssetAnalysisStatus(
    ['image-1'], async () => ({ 'image-1': 'failed' }), { timeoutMs: 0 },
);
assert.equal(failedIsTerminal.settled, true, 'failed jobs do not hold up Brain advice');

now = 0;
const timedOut = await waitForAssetAnalysisStatus(
    ['video-1'], async () => ({ 'video-1': 'pending' }),
    { timeoutMs: 20, intervalMs: 10, now: () => now, sleep: async ms => { now += ms; } },
);
assert.equal(timedOut.settled, false);
assert.deepEqual(timedOut.pendingAssetIds, ['video-1']);

const failOpen = await waitForAssetAnalysisStatus(['video-1'], async () => { throw new Error('offline'); });
assert.equal(failOpen.checkFailed, true, 'status errors fail open instead of blocking analysis');

const route = fs.readFileSync(path.join(root, 'server/routes/brainRoutes.js'), 'utf8');
const hook = fs.readFileSync(path.join(root, 'client/src/hooks/useBrain.js'), 'utf8');
const editorialBrain = fs.readFileSync(path.join(root, 'server/brain/EditorialBrain.js'), 'utf8');
assert.match(route, /analysis_status:\s*ASSET_ANALYSIS_PENDING/);
assert.match(route, /router\.get\('\/analysis-status', authenticateUser/);
assert.match(route, /\.eq\('project_id', projectId\)[\s\S]*\.eq\('user_id', req\.user\.id\)/);
assert.match(hook, /trigger === 'project_opened' \|\| trigger === 'asset_added'/);
assert.match(hook, /INITIAL_ASSET_ANALYSIS_WAIT_MS/);
assert.match(hook, /new AbortController\(\)/, 'the readiness request itself has a timeout');
assert.match(hook, /if \(!waitResult\.checkFailed\) timedOutAssetIds/,
    'an unavailable status API does not launch a pointless two-minute background poll');
assert.match(hook, /Keep the editor and prompt usable while we.re only waiting/);
assert.match(hook, /analyzeProjectRef\.current\?\.\('asset_analysis_ready'\)/);
assert.match(editorialBrain, /input\?\.trigger === 'asset_analysis_ready'/,
    'late refresh is classified as advisory rather than an edit command');

console.log('Brain asset-analysis readiness checks passed');
