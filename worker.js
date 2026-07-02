require('dotenv').config();
const { Worker } = require('bullmq');
const { makeRedisConnection } = require('./queue/connection');

// Import job handlers
const processVideoJob    = require('./jobs/videoProcessor');
const processAudioJob    = require('./jobs/audioProcessor');
const processAnalysisJob = require('./jobs/analysisProcessor');

console.log('👷 Worker service starting...');

// Each Worker gets its own Redis connection — sharing one socket across all
// workers causes ECONNRESET cascades when the single idle connection is
// dropped by Railway's network between job bursts.

// 1. Video Processing Worker (HLS proxy, waveform)
const videoWorker = new Worker('video-processing', processVideoJob, {
    connection: makeRedisConnection(),
    concurrency: 2, // limit concurrency for heavy FFmpeg tasks
    limiter: { max: 10, duration: 60000 }
});

videoWorker.on('completed', job => {
    console.log(`✅ [VideoQueue] Job ${job.id} completed: ${job.name}`);
});
videoWorker.on('failed', (job, err) => {
    console.error(`❌ [VideoQueue] Job ${job.id} failed:`, err.message);
});

// 2. Audio Processing Worker (transcribe, denoise, normalize, beat-detect, silence-detect)
const audioWorker = new Worker('audio-processing', processAudioJob, {
    connection: makeRedisConnection(),
    concurrency: 2,
});

audioWorker.on('completed', job => {
    console.log(`✅ [AudioQueue] Job ${job.id} completed: ${job.name}`);
});
audioWorker.on('failed', (job, err) => {
    console.error(`❌ [AudioQueue] Job ${job.id} failed:`, err.message);
});

// 3. Analysis Processing Worker (Virality)
const analysisWorker = new Worker('analysis-processing', processAnalysisJob, {
    connection: makeRedisConnection(),
    concurrency: 2,
});

analysisWorker.on('completed', job => {
    console.log(`✅ [AnalysisQueue] Job ${job.id} completed: ${job.name}`);
});
analysisWorker.on('failed', (job, err) => {
    console.error(`❌ [AnalysisQueue] Job ${job.id} failed:`, err.message);
});

// 4. Diarize Worker — concurrency 1 intentionally.
// WhisperX + pyannote can only run one inference at a time on CPU without
// OOM-crashing the container. Serialising here prevents concurrent HTTP
// requests to the Python service and the resulting 502s.
const diarizeWorker = new Worker('diarize-processing', processAudioJob, {
    connection: makeRedisConnection(),
    concurrency: 1,
});

diarizeWorker.on('completed', job => {
    console.log(`✅ [DiarizeQueue] Job ${job.id} completed`);
});
diarizeWorker.on('failed', (job, err) => {
    console.error(`❌ [DiarizeQueue] Job ${job.id} failed:`, err.message);
});

console.log('👷 Worker service is running and listening to queues.');
