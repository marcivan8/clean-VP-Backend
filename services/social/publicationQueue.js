'use strict';

const { Queue } = require('bullmq');
const { connection } = require('../../queue/connection');
const queue = new Queue('social-publishing', { connection });

async function enqueuePublication(publication, delay = 0) {
    return queue.add('publish', { publicationId: publication.id, userId: publication.user_id }, {
        jobId: `social-${publication.id}`,
        delay: Math.max(0, delay),
        attempts: 1,
        removeOnComplete: { age: 7 * 24 * 3600 },
        removeOnFail: { age: 30 * 24 * 3600 },
    });
}

async function removePublicationJob(publicationId) {
    try {
        const job = await queue.getJob(`social-${publicationId}`);
        if (!job) return true;
        const state = await job.getState();
        if (state === 'active') return false;
        await job.remove();
        return true;
    } catch (err) {
        if (/locked|active/i.test(err.message)) return false;
        throw err;
    }
}

module.exports = { queue, enqueuePublication, removePublicationJob };
