const express = require('express');
const router = express.Router();
const { videoQueue, audioQueue, analysisQueue } = require('../queue/queues');

// Helper to find a job across all queues
async function findJob(jobId) {
    let job = await videoQueue.getJob(jobId);
    if (job) return job;
    
    job = await audioQueue.getJob(jobId);
    if (job) return job;
    
    job = await analysisQueue.getJob(jobId);
    return job;
}

/**
 * GET /api/jobs/:jobId/progress
 * Server-Sent Events endpoint to monitor job status.
 */
router.get('/:jobId/progress', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Send an initial connected message so client knows stream is open
    res.write(': connected\n\n');

    const job = await findJob(req.params.jobId);
    
    if (!job) {
        res.write(`data: ${JSON.stringify({ error: 'Job not found' })}\n\n`);
        return res.end();
    }

    let interval;

    const sendState = async () => {
        try {
            const state = await job.getState();
            const progress = job.progress;

            let data = { state, progress };

            if (state === 'completed') {
                data.result = job.returnvalue;
            } else if (state === 'failed') {
                data.error = job.failedReason;
            }

            res.write(`data: ${JSON.stringify(data)}\n\n`);

            if (state === 'completed' || state === 'failed') {
                clearInterval(interval);
                res.end();
            }
        } catch (err) {
            console.error('Error fetching job state:', err);
            clearInterval(interval);
            res.end();
        }
    };

    // Send initial state immediately
    await sendState();

    // Poll every 1 second and stream to client
    interval = setInterval(sendState, 1000);

    req.on('close', () => {
        clearInterval(interval);
    });
});

module.exports = router;
