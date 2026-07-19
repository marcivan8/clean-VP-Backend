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

const assetAnalysisWorker = new Worker('asset-analysis', async (job) => {
    if (!_MediaIntelligencePipeline) {
        throw new Error('MediaIntelligencePipeline not loaded — redeploy with server/brain/ committed');
    }
    const { assetId, filePath, projectId, userId } = job.data;
    const pipeline = new _MediaIntelligencePipeline();
    await pipeline.analyzeAsset(assetId, filePath, projectId, userId);
}, { connection, concurrency: 2 });

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
