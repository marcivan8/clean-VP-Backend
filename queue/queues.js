const { Queue } = require('bullmq');
const { makeRedisConnection } = require('./connection');

// Each Queue gets its own Redis connection so that one idle/dropped socket
// doesn't take down all queues simultaneously (ECONNRESET cascade).
const videoQueue    = new Queue('video-processing',    { connection: makeRedisConnection() });
const audioQueue    = new Queue('audio-processing',    { connection: makeRedisConnection() });
const analysisQueue = new Queue('analysis-processing', { connection: makeRedisConnection() });

// Dedicated single-concurrency queue for speaker diarization.
// WhisperX loads models into memory and can only safely handle one request
// at a time on the CPU-only Railway container. Running two simultaneously
// causes OOM crashes → 502. This queue serialises all diarize jobs.
const diarizeQueue  = new Queue('diarize-processing',  { connection: makeRedisConnection() });

module.exports = {
    videoQueue,
    audioQueue,
    analysisQueue,
    diarizeQueue,
};
