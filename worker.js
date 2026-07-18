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
const { MediaIntelligencePipeline } = require('./server/brain/media/MediaIntelligencePipeline');

const assetAnalysisWorker = new Worker('asset-analysis', async (job) => {
    const { assetId, filePath, projectId, userId } = job.data;
    const pipeline = new MediaIntelligencePipeline();
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
const { createEmbeddingWorker } = require('./server/audio-engine/embeddings/EmbeddingWorker.js');
const embeddingWorker = createEmbeddingWorker();

embeddingWorker.on('completed', job => {
    console.log(`✅ [EmbeddingQueue] Job ${job.id} completed (${job.data?.assetId || job.data?.batchAssetIds?.length + ' batch' || 'seed-all'})`);
});
embeddingWorker.on('failed', (job, err) => {
    console.error(`❌ [EmbeddingQueue] Job ${job.id} failed:`, err.message);
});

console.log('👷 Worker service is running and listening to queues.');
