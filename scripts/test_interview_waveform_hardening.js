/**
 * test_interview_waveform_hardening.js
 *
 * Verifies the error-hardening contracts for:
 *   1. POST /api/interview/classify-pauses (falls back to editorial heuristics instead of 500)
 *   2. POST /api/interview/refine-cut-frames (uses FFMPEG_BIN, fails open with 200/fallback instead of 500)
 *   3. POST /api/waveform/extract (returns 404 on missing media, falls back to rawGcsPath on missing proxy)
 *
 * Run: node scripts/test_interview_waveform_hardening.js
 */

'use strict';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'mock-anon-key';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.NODE_ENV = 'test';

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

// Mock queues to prevent Redis ECONNREFUSED in standalone node scripts
require.cache[require.resolve('../queue/queues')] = {
    exports: {
        audioQueue: { add: async () => ({ id: 'mock-job-1' }) },
        videoQueue: { add: async () => ({ id: 'mock-job-2' }) },
        exportQueue: { add: async () => ({ id: 'mock-job-3' }) },
        silenceQueue: { add: async () => ({ id: 'mock-job-4' }) },
    }
};

let passed = 0;
let failed = 0;

function ok(label, got, expected) {
    if (got === expected) {
        console.log(`  ✅ ${label}`);
        passed++;
    } else {
        console.error(`  ❌ ${label}`);
        console.error(`     expected: ${JSON.stringify(expected)}`);
        console.error(`     got:      ${JSON.stringify(got)}`);
        failed++;
    }
}

async function run() {
    console.log('\n=== 1. Static Analysis: FFMPEG_BIN & Route Guards ===');
    {
        const interviewSrc = fs.readFileSync(path.resolve(__dirname, '../routes/interviewRoutes.js'), 'utf8');
        const waveformSrc  = fs.readFileSync(path.resolve(__dirname, '../routes/waveformRoutes.js'), 'utf8');

        ok('interviewRoutes resolves ffmpeg-static via FFMPEG_BIN',
            /FFMPEG_BIN\s*=\s*ffmpegPath\s*\|\|\s*'ffmpeg'/.test(interviewSrc), true);

        ok('interviewRoutes spawn uses FFMPEG_BIN in refine-cut-frames',
            /spawn\(FFMPEG_BIN,\s*args/.test(interviewSrc), true);

        ok('interviewRoutes extractVideoFrame uses FFMPEG_BIN',
            /\$\{FFMPEG_BIN\}/.test(interviewSrc), true);

        ok('classify-pauses has editorial heuristics fallback',
            /function classifyPausesHeuristically/.test(interviewSrc), true);

        const classifyBlock = interviewSrc.slice(
            interviewSrc.indexOf("router.post('/classify-pauses'"),
            interviewSrc.indexOf("router.post('/refine-cut-frames'")
        );
        ok('classify-pauses does not throw 500 on AI failure',
            !/catch\s*\(err\)[\s\S]{0,120}status\(500\)/.test(classifyBlock), true);

        const refineBlock = interviewSrc.slice(
            interviewSrc.indexOf("router.post('/refine-cut-frames'"),
            interviewSrc.indexOf("router.post('/identify-speakers'")
        );
        ok('refine-cut-frames returns status 200 and fallback on missing file',
            /could not locate source video[\s\S]{0,200}fallback:\s*true/.test(refineBlock), true);

        ok('waveformRoutes falls back to rawGcsPath when proxy is missing',
            /rawCandidate\.startsWith\(uploadsDir\)\s*&&\s*fs\.existsSync\(rawCandidate\)/.test(waveformSrc), true);
    }

    console.log('\n=== 2. Functional: POST /api/interview/classify-pauses ===');
    {
        const interviewRoutes = require('../routes/interviewRoutes');
        const app = express();
        app.use(express.json());
        app.use('/api/interview', interviewRoutes);

        // Missing pauses array -> 400
        const badRes = await request(app)
            .post('/api/interview/classify-pauses')
            .send({});
        ok('rejects empty pauses with 400', badRes.status, 400);

        // Valid pauses -> returns 200 and classifications without throwing 500 (even when OpenAI is unconfigured)
        const pauses = [
            { i: 0, dur: 3.2, before: 'Why did you start this project?', after: 'Well, it started back in 2024' },
            { i: 1, dur: 0.8, before: 'And we realized that', after: 'we needed a much better tool' },
            { i: 2, dur: 4.5, before: 'That was the whole story.', after: 'Moving on to the next chapter.' },
        ];
        const res = await request(app)
            .post('/api/interview/classify-pauses')
            .send({ pauses });

        ok('responds with status 200', res.status, 200);
        ok('returns array of decisions matching pauses count', Array.isArray(res.body.decisions) && res.body.decisions.length, 3);
        ok('shortens thinking pause mid-sentence (<1.5s)', res.body.decisions[1].action, 'shorten');
        ok('cuts long pauses (>2.5s)', res.body.decisions[0].action, 'cut');
        ok('includes fallback flag if heuristics were used', typeof res.body.fallback === 'boolean', true);
    }

    console.log('\n=== 3. Functional: POST /api/interview/refine-cut-frames ===');
    {
        const interviewRoutes = require('../routes/interviewRoutes');
        const app = express();
        app.use(express.json());
        app.use('/api/interview', interviewRoutes);

        // Missing filename -> 400
        const badRes = await request(app)
            .post('/api/interview/refine-cut-frames')
            .send({ points: [{ id: 'tail_0', t: 1.5 }] });
        ok('rejects missing filename with 400', badRes.status, 400);

        // Missing file on disk -> gracefully returns 200 with fallback: true (offsetSec: 0) instead of crashing with 500
        const res = await request(app)
            .post('/api/interview/refine-cut-frames')
            .send({
                filename: 'proxies/dev-user/nonexistent_clip.mp4',
                points: [{ id: 'tail_0', t: 1.5 }, { id: 'head_0', t: 2.5 }],
            });

        ok('gracefully answers 200 on missing media file', res.status, 200);
        ok('returns fallback: true', res.body.fallback, true);
        ok('preserves cut points with offsetSec: 0', res.body.picks?.[0]?.offsetSec, 0);
    }

    console.log('\n=== 4. Functional: POST /api/waveform/extract ===');
    {
        const waveformRoutes = require('../routes/waveformRoutes');
        const app = express();
        app.use(express.json());
        app.use('/api/waveform', waveformRoutes);

        // Missing media file -> returns 404, NOT 500
        const res = await request(app)
            .post('/api/waveform/extract')
            .send({
                assetId: 'asset-test-nonexistent',
                gcsPath: 'raw/dev-user/does_not_exist_12345.mp4',
            });

        ok('answers 404 (not 500) on missing media file', res.status, 404);
    }

    console.log(`\n${passed} passed, ${failed} failed\n`);
    if (failed > 0) process.exit(1);
}

run().catch(err => {
    console.error('Test runner failed:', err);
    process.exit(1);
});
