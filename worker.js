require('dotenv').config();
const { Worker } = require('bullmq');
const { connection } = require('./queue/connection');

// Import job handlers
const processVideoJob    = require('./jobs/videoProcessor');
const processAudioJob    = require('./jobs/audioProcessor');
const processAnalysisJob = require('./jobs/analysisProcessor');
const processExportJob   = require('./jobs/exportProcessor');

console.log('👷 Worker service starting...');

// 1. Video Processing Worker (HLS proxy, waveform)
// concurrency: 1 (was 2) — libx264 proxy encoding of raw 4K/1080p phone
// footage is the single heaviest job this process runs, and this worker
// shares a process/memory ceiling with the Express server (see index.js's
// inline `require('./worker')` boot) and with asset-analysis below, which
// now fires in PARALLEL with proxy encoding (not after it — see R21/R24).
// A multi-file upload used to be able to run 2 encodes + 2 vision/audio
// analyses at once; that combination reliably OOMs a small Railway
// instance and takes the whole process down mid-request, which is what
// produced a 502 on an unrelated clip's proxy.mp4 while a batch of 5
// uploads was in flight. See R24.
const videoWorker = new Worker('video-processing', processVideoJob, {
    connection,
    concurrency: 1,
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
    // Keep at 1: each filler-detect job downloads a raw MP4 from GCS, runs
    // FFmpeg audio extraction, then calls OpenAI Whisper. Two concurrent jobs
    // on a Railway 512 MB instance reliably causes OOM → 502 on all in-flight
    // HTTP requests. Running serially keeps memory predictable.
    concurrency: 1,
    // 5-minute lock so BullMQ doesn't consider a still-running Whisper call
    // stalled and retry it (which would double memory usage and cause a crash).
    lockDuration: 5 * 60 * 1000,
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

// 4. Export Processing Worker (timeline render)
const exportWorker = new Worker('export-processing', processExportJob, {
    connection,
    concurrency: 1, // exports are very CPU/disk intensive — one at a time
});

exportWorker.on('completed', job => {
    console.log(`✅ [ExportQueue] Job ${job.id} completed`);
});
exportWorker.on('failed', (job, err) => {
    console.error(`❌ [ExportQueue] Job ${job.id} failed:`, err.message);
});

// 5. Asset Analysis Worker (Editorial Brain — vision + audio classification)
// concurrency: 2 — vision calls are I/O bound (OpenAI API), not CPU bound
//
// DEPLOYMENT NOTE: requires server/brain/media/MediaIntelligencePipeline.js
// and its transitive deps (AudioClassifier, VisualAnalyzer, ContentClassifier,
// server/brain/UserProfileEngine, server/brain/PatternLearner, etc.).
// All of these live in server/brain/ — ensure that directory is committed and
// included in the Docker build context before deploying worker.js changes.
//
// Loaded lazily so a missing module degrades gracefully instead of crashing
// the entire worker process (which would also kill video exports).
let _MediaIntelligencePipeline = null;
try {
    _MediaIntelligencePipeline = require('./server/brain/media/MediaIntelligencePipeline').MediaIntelligencePipeline;
    console.log('✅ [AssetAnalysisQueue] MediaIntelligencePipeline loaded');
} catch (err) {
    console.error('⚠️  [AssetAnalysisQueue] MediaIntelligencePipeline not available — asset analysis jobs will fail gracefully:', err.message);
}

// concurrency: 1 (was 2) — these jobs now fire the instant a raw upload
// lands on GCS, running CONCURRENTLY with video-processing's proxy encode
// for the same asset (and with every other asset in a multi-file upload).
// Each job downloads the raw file and runs local ffmpeg frame/audio
// extraction before the (I/O-bound) Vision/classification calls, so it
// competes directly with videoWorker for the same memory pool during an
// upload burst. See R24 — this and the videoWorker concurrency drop above
// are the fix for the OOM-driven 502 that surfaced under 5 simultaneous
// uploads.
const assetAnalysisWorker = new Worker('asset-analysis', async (job) => {
    if (!_MediaIntelligencePipeline) {
        throw new Error('MediaIntelligencePipeline not loaded — redeploy with server/brain/ committed');
    }
    const { assetId, filePath, projectId, userId, name } = job.data;
    const pipeline = new _MediaIntelligencePipeline();
    await pipeline.analyzeAsset(assetId, filePath, projectId, userId, name || null);
}, { connection, concurrency: 1 });

assetAnalysisWorker.on('completed', job => {
    console.log(`✅ [AssetAnalysisQueue] Job ${job.id} completed`);
});
assetAnalysisWorker.on('failed', (job, err) => {
    console.error(`❌ [AssetAnalysisQueue] Job ${job.id} failed:`, err.message);
});

// 6. Asset Embedding Worker (Creative Asset Intelligence — vector embeddings)
// concurrency: 3 — embedding calls are I/O bound (OpenAI text-embedding-3-small)
//
// DEPLOYMENT NOTE: requires server/audio-engine/embeddings/EmbeddingWorker.js
// and its transitive deps. Same server/ directory constraint as worker 5 above.
let embeddingWorker = null;
try {
    const { createEmbeddingWorker } = require('./server/audio-engine/embeddings/EmbeddingWorker.js');
    embeddingWorker = createEmbeddingWorker();
    console.log('✅ [EmbeddingQueue] EmbeddingWorker loaded');

    embeddingWorker.on('completed', job => {
        console.log(`✅ [EmbeddingQueue] Job ${job.id} completed (${job.data?.assetId || (job.data?.batchAssetIds?.length ?? 0) + ' batch' || 'seed-all'})`);
    });
    embeddingWorker.on('failed', (job, err) => {
        console.error(`❌ [EmbeddingQueue] Job ${job.id} failed:`, err.message);
    });
} catch (err) {
    console.error('⚠️  [EmbeddingQueue] EmbeddingWorker not available — embedding jobs will be skipped:', err.message);
}

console.log('👷 Worker service is running and listening to queues.');
