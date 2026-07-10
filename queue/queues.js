const { Queue } = require('bullmq');
const { connection } = require('./connection');

// Create the different queues
const videoQueue = new Queue('video-processing', { connection });
const audioQueue = new Queue('audio-processing', { connection });
const analysisQueue = new Queue('analysis-processing', { connection });

module.exports = {
    videoQueue,
    audioQueue,
    analysisQueue
};
