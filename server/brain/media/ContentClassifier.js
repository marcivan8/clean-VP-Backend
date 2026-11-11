/**
 * server/brain/media/ContentClassifier.js
 *
 * Classifies an entire media bin using bounded, recoverable GPT-4o batches.
 *
 * ⚠️  WARNING: classifyBin() must ONLY be called at upload time or when the
 * user explicitly requests bin analysis. NEVER call it during command
 * execution — it makes an OpenAI API call and can take several seconds.
 */

'use strict';

const { getAIClient, resolveModel } = require('../../../services/AIProvider');
const CLASSIFICATION_BATCH_SIZE = 40;
const SUMMARY_BATCH_SIZE = 20;
const CLASSIFICATION_CONCURRENCY = 3;
const PROJECT_TYPES = new Set(['talking_head', 'interview', 'vlog', 'podcast', 'tutorial', 'product_demo', 'event', 'documentary', 'unknown']);
const CONTENT_CLASSES = new Set(['main_camera', 'broll', 'interview_b_cam', 'music', 'sfx', 'screen_recording', 'unknown']);
const SUGGESTED_TRACKS = new Set(['video_1', 'video_2', 'video_3', 'audio_music', 'audio_sfx']);

function chunks(items, size) {
    const result = [];
    for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
    return result;
}

async function mapWithConcurrency(items, concurrency, mapper) {
    const results = new Array(items.length);
    let nextIndex = 0;
    const workerCount = Math.min(items.length, Math.max(1, Math.floor(concurrency) || 1));
    await Promise.all(Array.from({ length: workerCount }, async () => {
        while (true) {
            const index = nextIndex++;
            if (index >= items.length) return;
            results[index] = await mapper(items[index], index);
        }
    }));
    return results;
}

class ContentClassifier {

    constructor() {
        // capability: 'chat' — this reads text asset summaries only, no images.
        this.openai = getAIClient({ capability: 'chat' });
    }

    /**
     * Classify a collection of media assets to determine project type
     * and suggest a sensible timeline structure.
     *
     * ⚠️  ONLY call at upload time or on explicit user request.
     *
     * @param {Object[]} assets  - Array of asset objects from the media bin
     * @returns {Promise<Object>} Classification result
     */
    async classifyBin(assets) {
        // Guard: empty bin → skip OpenAI entirely
        if (!assets || assets.length === 0) {
            return { projectType: 'unknown', projectDescription: '', assets: [], suggestedStructure: null, warnings: [] };
        }

        if (!this.openai) {
            console.warn('[ContentClassifier] No OpenAI key — skipping bin classification');
            return {
                projectType: 'unknown',
                projectDescription: '',
                suggestedStructure: null,
                assets: assets.map(a => ({ id: a.id, content_class: 'unknown', suggested_track: null, related_to: null, confidence: 0 })),
                warnings: ['AI classification is unavailable; assets remain in the bin without inferred roles.'],
            };
        }

        try {
            // Build a concise summary for each asset
            const assetSummaries = assets.map(a => ({
                id:          a.id,
                name:        a.name || a.filename || a.id,
                duration:    a.duration ? `${Math.round(a.duration)}s` : 'unknown',
                audioType:   a.audioType || a.audio_type || 'unknown',
                isBroll:     a.isBroll ?? a.is_broll ?? null,
                hasMainSpeaker: a.hasMainSpeaker ?? a.has_main_speaker ?? null,
                transcript:  (a.transcript || a.transcriptText || '').slice(0, 150) || null,
            }));

            const systemPrompt = `You are a video editor's assistant that analyses a project's media bin.
Given a list of video/audio assets with their properties, determine:
1. The overall project type
2. How each asset should be classified and placed in the timeline
3. A recommended editing structure

Return ONLY valid JSON matching this exact schema:
{
  "projectType": "talking_head|interview|vlog|podcast|tutorial|product_demo|event|documentary|unknown",
  "projectDescription": "one sentence describing the project",
  "assets": [
    {
      "id": "<asset id>",
      "content_class": "main_camera|broll|interview_b_cam|music|sfx|screen_recording|unknown",
      "suggested_track": "video_1|video_2|video_3|audio_music|audio_sfx",
      "related_to": "<id of primary asset this relates to, or null>",
      "confidence": 0.0
    }
  ],
  "suggestedStructure": "brief description of recommended timeline structure",
  "warnings": ["any issues noticed, e.g. no main camera found"]
}`;

            const classifiedAssets = [];
            const projectSummaries = [];
            const warnings = [];
            const validIds = new Set(assetSummaries.map(asset => String(asset.id)));

            // Keep requests and expected JSON output bounded. A small worker
            // pool avoids serial latency on large bins without flooding the
            // provider. Each batch recovers independently and results are
            // collected in original batch order.
            const batches = chunks(assetSummaries, CLASSIFICATION_BATCH_SIZE);
            const batchResults = await mapWithConcurrency(batches, CLASSIFICATION_CONCURRENCY, async (batch, batchIndex) => {
                try {
                    const response = await this.openai.chat.completions.create({
                        model: resolveModel('gpt-4o', 'chat'),
                        max_tokens: Math.min(6000, 500 + batch.length * 120),
                        response_format: { type: 'json_object' },
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: `Classify every asset in this batch. Return one result for every supplied id.\nMedia bin assets:\n${JSON.stringify(batch)}` },
                        ],
                    });
                    const raw = response.choices[0]?.message?.content;
                    if (!raw) throw new Error('Model returned an empty classification');
                    const parsed = JSON.parse(raw);
                    const batchIds = new Set(batch.map(asset => String(asset.id)));
                    const seen = new Set();
                    const batchAssets = [];
                    for (const item of Array.isArray(parsed.assets) ? parsed.assets : []) {
                        const id = String(item?.id || '');
                        if (!batchIds.has(id) || seen.has(id)) continue;
                        seen.add(id);
                        batchAssets.push({
                            id,
                            content_class: CONTENT_CLASSES.has(item.content_class) ? item.content_class : 'unknown',
                            suggested_track: SUGGESTED_TRACKS.has(item.suggested_track) ? item.suggested_track : null,
                            related_to: item.related_to && validIds.has(String(item.related_to)) ? String(item.related_to) : null,
                            confidence: Number.isFinite(Number(item.confidence)) ? Math.max(0, Math.min(1, Number(item.confidence))) : 0,
                        });
                    }
                    for (const asset of batch) {
                        if (!seen.has(String(asset.id))) batchAssets.push({ id: String(asset.id), content_class: 'unknown', suggested_track: null, related_to: null, confidence: 0 });
                    }
                    return {
                        assets: batchAssets,
                        summary: {
                        assetCount: batch.length,
                        projectType: PROJECT_TYPES.has(parsed.projectType) ? parsed.projectType : 'unknown',
                        projectDescription: String(parsed.projectDescription || '').slice(0, 300),
                        suggestedStructure: String(parsed.suggestedStructure || '').slice(0, 300),
                        warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String).slice(0, 5) : [],
                        },
                    };
                } catch (error) {
                    return {
                        assets: batch.map(asset => ({ id: String(asset.id), content_class: 'unknown', suggested_track: null, related_to: null, confidence: 0 })),
                        summary: { assetCount: batch.length, projectType: 'unknown', projectDescription: '', suggestedStructure: '', warnings: [] },
                        error: `Classification batch ${batchIndex + 1} failed: ${error.message}`,
                    };
                }
            });
            for (const result of batchResults) {
                classifiedAssets.push(...result.assets);
                projectSummaries.push(result.summary);
                if (result.error) warnings.push(result.error);
                warnings.push(...(result.summary.warnings || []));
            }

            let summaries = projectSummaries;
            while (summaries.length > SUMMARY_BATCH_SIZE) {
                const reduced = [];
                const summaryBatches = chunks(summaries, SUMMARY_BATCH_SIZE);
                const reducedBatches = await mapWithConcurrency(summaryBatches, CLASSIFICATION_CONCURRENCY, async summaryBatch => {
                    return this._synthesizeProjectSummary(summaryBatch).catch(error => {
                        warnings.push(`Project summary reduction failed: ${error.message}`);
                        return this._fallbackSummary(summaryBatch);
                    });
                });
                reduced.push(...reducedBatches);
                summaries = reduced;
            }
            let project = summaries.length === 1
                ? summaries[0]
                : summaries.length
                    ? await this._synthesizeProjectSummary(summaries).catch(error => {
                    warnings.push(`Project summary failed: ${error.message}`);
                    return this._fallbackSummary(summaries);
                })
                    : this._fallbackSummary([]);

            // Enforce complete, unique coverage and reject hallucinated IDs.
            const byId = new Map();
            for (const item of classifiedAssets) if (validIds.has(String(item.id)) && !byId.has(String(item.id))) byId.set(String(item.id), item);
            for (const asset of assetSummaries) {
                if (!byId.has(String(asset.id))) byId.set(String(asset.id), { id: String(asset.id), content_class: 'unknown', suggested_track: null, related_to: null, confidence: 0 });
            }
            project = project || this._fallbackSummary(summaries);
            const modelWarnings = summaries.flatMap(summary => summary.warnings || []);
            return {
                ...project,
                assets: assetSummaries.map(asset => byId.get(String(asset.id))),
                warnings: [...new Set([
                    ...warnings,
                    ...modelWarnings,
                    ...(Array.isArray(project.warnings) ? project.warnings : []),
                ])].slice(0, 50),
            };

        } catch (err) {
            console.error('[ContentClassifier] classifyBin error:', err.message);
            // Preserve one result per source asset even if setup, synthesis,
            // or an unexpected provider response fails outside an individual
            // batch. Callers can then distinguish unknown from missing.
            return {
                projectType: 'unknown',
                projectDescription: '',
                suggestedStructure: null,
                assets: assets.map(asset => ({
                    id: String(asset?.id || ''), content_class: 'unknown',
                    suggested_track: null, related_to: null, confidence: 0,
                })).filter(asset => asset.id),
                warnings: [`Media-bin classification could not be completed: ${err.message}`],
            };
        }
    }

    async _synthesizeProjectSummary(summaries) {
        const response = await this.openai.chat.completions.create({
            model: resolveModel('gpt-4o', 'chat'),
            max_tokens: 1200,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: 'Synthesize project type and editing structure from all supplied media-bin batch summaries. Do not assign or omit individual assets. Return JSON with projectType, projectDescription, suggestedStructure, and warnings.' },
                { role: 'user', content: JSON.stringify(summaries) },
            ],
        });
        const raw = response.choices[0]?.message?.content;
        if (!raw) throw new Error('Model returned an empty project summary');
        const parsed = JSON.parse(raw);
        return {
            assetCount: summaries.reduce((count, item) => count + (Number(item.assetCount) || 0), 0),
            projectType: PROJECT_TYPES.has(parsed.projectType) ? parsed.projectType : 'unknown',
            projectDescription: String(parsed.projectDescription || '').slice(0, 500),
            suggestedStructure: String(parsed.suggestedStructure || '').slice(0, 500),
            warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String).slice(0, 10) : [],
        };
    }

    _fallbackSummary(summaries) {
        const counts = new Map();
        for (const summary of summaries || []) {
            if (PROJECT_TYPES.has(summary.projectType) && summary.projectType !== 'unknown') {
                counts.set(summary.projectType, (counts.get(summary.projectType) || 0) + (Number(summary.assetCount) || 1));
            }
        }
        const projectType = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';
        return {
            projectType,
            projectDescription: summaries?.map(item => item.projectDescription).filter(Boolean).slice(0, 3).join(' '),
            suggestedStructure: summaries?.map(item => item.suggestedStructure).filter(Boolean).slice(0, 3).join(' '),
            warnings: [...new Set((summaries || []).flatMap(item => item.warnings || []))].slice(0, 10),
        };
    }
}

module.exports = { ContentClassifier, CLASSIFICATION_BATCH_SIZE, CLASSIFICATION_CONCURRENCY };
