const { Queue } = require('bullmq');
const { connection } = require('./connection');

// Create the different queues
const videoQueue    = new Queue('video-processing',  { connection });
const audioQueue    = new Queue('audio-processing',  { connection });
const analysisQueue = new Queue('analysis-processing', { connection });

// Dedicated single-concurrency queue for speaker diarization.
// WhisperX loads models into memory and can only safely handle one request
// at a time on the CPU-only Railway container. Running two simultaneously
// causes OOM crashes → 502. This queue serialises all diarize jobs.
const diarizeQueue  = new Queue('diarize-processing', { connection });

module.exports = {
    videoQueue,
    audioQueue,
    analysisQueue,
    diarizeQueue,
};
