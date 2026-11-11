import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ContentClassifier, CLASSIFICATION_BATCH_SIZE, CLASSIFICATION_CONCURRENCY } = require('../server/brain/media/ContentClassifier.js');
const classifier = new ContentClassifier();
let classificationCalls = 0;
let summaryCalls = 0;
let activeClassificationCalls = 0;
let peakClassificationCalls = 0;
classifier.openai = {
    chat: { completions: { create: async ({ messages, max_tokens }) => {
        const system = messages[0].content;
        if (system.includes('Synthesize project type')) {
            summaryCalls++;
            assert.equal(max_tokens, 1200, 'project synthesis has a bounded response budget');
            const batches = JSON.parse(messages[1].content);
            return { choices: [{ message: { content: JSON.stringify({
                projectType: 'event', projectDescription: `Synthesis of ${batches.length} batches`,
                suggestedStructure: 'Choose a main camera, then intercut supporting footage.', warnings: [],
            }) } }] };
        }
        const callNumber = ++classificationCalls;
        activeClassificationCalls++;
        peakClassificationCalls = Math.max(peakClassificationCalls, activeClassificationCalls);
        assert.ok(max_tokens >= 500, 'classification response budget scales with batch size');
        try {
            await new Promise(resolve => setTimeout(resolve, 10));
            if (callNumber === 2) throw new Error('simulated provider failure');
            const payload = messages[1].content.split('Media bin assets:\n')[1];
            const batch = JSON.parse(payload);
            assert.ok(batch.length <= CLASSIFICATION_BATCH_SIZE, 'no model call receives an unbounded asset list');
            const results = batch.map(asset => ({ id: asset.id, content_class: 'broll', suggested_track: 'video_2', related_to: null, confidence: 0.8 }));
            if (batch[0]?.id === 'asset-0') results[0].related_to = `asset-${CLASSIFICATION_BATCH_SIZE}`;
            if (batch[0]?.id === 'asset-0') results.push({ id: 'hallucinated-id', content_class: 'main_camera', suggested_track: 'video_1', confidence: 1 });
            return { choices: [{ message: { content: JSON.stringify({ projectType: 'event', projectDescription: 'Event footage', suggestedStructure: 'Use a speaker-led structure.', assets: results, warnings: [] }) } }] };
        } finally {
            activeClassificationCalls--;
        }
    } } },
};

const assets = Array.from({ length: CLASSIFICATION_BATCH_SIZE * 2 + 3 }, (_, index) => ({
    id: `asset-${index}`, name: `clip-${index}.mp4`, duration: 20,
}));
const result = await classifier.classifyBin(assets);
assert.equal(classificationCalls, 3, 'the complete bin is processed in bounded requests');
assert.equal(peakClassificationCalls, CLASSIFICATION_CONCURRENCY, 'large bins use the configured bounded parallelism');
assert.equal(result.assets.length, assets.length, 'every input asset receives a classification result');
assert.equal(new Set(result.assets.map(asset => asset.id)).size, assets.length, 'results are unique by asset ID');
assert.ok(result.assets.every(asset => assets.some(input => input.id === asset.id)), 'hallucinated asset IDs are rejected');
assert.equal(result.projectType, 'event');
assert.equal(result.assets[0].related_to, `asset-${CLASSIFICATION_BATCH_SIZE}`, 'valid cross-batch relationships are retained');
assert.deepEqual(result.assets.map(asset => asset.id), assets.map(asset => asset.id), 'parallel batches preserve stable source order');
assert.equal(result.assets[CLASSIFICATION_BATCH_SIZE].content_class, 'unknown', 'a failed batch is retained as unknown instead of disappearing');
assert.ok(result.warnings.some(warning => warning.includes('simulated provider failure')));
assert.equal(summaryCalls, 1, 'batch summaries are reconciled into a project-level result');
console.log(`Content classifier batch test passed: ${assets.length} assets, 3 classification batches, complete ID coverage and partial-failure recovery.`);
