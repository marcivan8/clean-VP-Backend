const { Queue } = require('bullmq');
const { connection } = require('./connection');

// Create the different queues
const videoQueue    = new Queue('video-processing',    { connection });
const audioQueue    = new Queue('audio-processing',    { connection });
const analysisQueue = new Queue('analysis-processing', { connection });
const exportQueue   = new Queue('export-processing',   { connection });
// R67 — Object Intelligence (SAM2 speaker/background separation). Separate
// queue rather than piggybacking analysisQueue: this job calls an external
// paid API (Replicate) with multi-minute latency, and should be independently
// throttleable/observable from the existing analysis jobs (see worker.js's
// concurrency comments — this queue is I/O-bound like analysisQueue, not
// CPU-bound like videoQueue/exportQueue).
const visionQueue   = new Queue('object-segmentation', { connection });

module.exports = {
    videoQueue,
    audioQueue,
    analysisQueue,
    exportQueue,
    visionQueue,
};
