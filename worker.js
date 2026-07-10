require('dotenv').config();
const { Worker } = require('bullmq');
const { connection } = require('./queue/connection');

// Import job handlers
const processVideoJob = require('./jobs/videoProcessor');
const processAudioJob = require('./jobs/audioProcessor');
const processAnalysisJob = require('./jobs/analysisProcessor');

console.log('👷 Worker service starting...');

// 1. Video Processing Worker (HLS proxy, waveform)
const videoWorker = new Worker('video-processing', processVideoJob, {
    connection,
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
    connection,
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
    connection,
    concurrency: 2,
});

analysisWorker.on('completed', job => {
    console.log(`✅ [AnalysisQueue] Job ${job.id} completed: ${job.name}`);
});
analysisWorker.on('failed', (job, err) => {
    console.error(`❌ [AnalysisQueue] Job ${job.id} failed:`, err.message);
});

console.log('👷 Worker service is running and listening to queues.');
