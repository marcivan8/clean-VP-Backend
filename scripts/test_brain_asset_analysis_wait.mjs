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

now = 0;
let rateLimitedPolls = 0;
const retries429 = await waitForAssetAnalysisStatus(
    ['video-1'], async () => {
        rateLimitedPolls++;
        const error = new Error('rate limited');
        error.retryAfterMs = 8;
        throw error;
    },
    { timeoutMs: 20, intervalMs: 2, retryOnError: true, now: () => now, sleep: async ms => { now += ms; } },
);
assert.equal(rateLimitedPolls, 4, '429 responses honor retry-after instead of tight-loop polling');
assert.equal(retries429.checkFailed, false, 'transient 429s stay retryable until the bounded timeout');
assert.equal(retries429.pendingAssetIds[0], 'video-1');

const route = fs.readFileSync(path.join(root, 'server/routes/brainRoutes.js'), 'utf8');
const hook = fs.readFileSync(path.join(root, 'client/src/hooks/useBrain.js'), 'utf8');
const editorialBrain = fs.readFileSync(path.join(root, 'server/brain/EditorialBrain.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
assert.match(route, /analysis_status:\s*ASSET_ANALYSIS_PENDING/);
assert.match(route, /router\.get\('\/analysis-status', authenticateUser/);
assert.match(route, /\.eq\('project_id', projectId\)[\s\S]*\.eq\('user_id', req\.user\.id\)/);
assert.match(hook, /trigger === 'project_opened' \|\| trigger === 'asset_added'/);
assert.match(hook, /INITIAL_ASSET_ANALYSIS_WAIT_MS/);
assert.match(hook, /new AbortController\(\)/, 'the readiness request itself has a timeout');
assert.match(hook, /retryOnError:\s*true/,
    'temporary status errors and 429s are retried with backoff during the bounded wait');
assert.match(hook, /timedOutAssetIds\s*=\s*waitResult\.pendingAssetIds/,
    'assets still pending after the bounded wait get exactly one late readiness refresh');
assert.match(server, /const brainRoutes = require\('\.\/server\/routes\/brainRoutes'\)[\s\S]*req\.method === 'GET'[\s\S]*brainAiLimiter/,
    'read-only Brain routes do not consume the expensive AI request budget');
assert.match(server, /routePath === '\/techniques'[\s\S]*motionLookupLimiter[\s\S]*motionAiLimiter/,
    'local technique ranking cannot starve model-backed motion planning');
assert.match(hook, /Keep the editor and prompt usable while we.re only waiting/);
assert.match(hook, /analyzeProjectRef\.current\?\.\('asset_analysis_ready'\)/);
assert.match(editorialBrain, /input\?\.trigger === 'asset_analysis_ready'/,
    'late refresh is classified as advisory rather than an edit command');

console.log('Brain asset-analysis readiness checks passed');
