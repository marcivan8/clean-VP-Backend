/**
 * server/brain/media/ContentClassifier.js
 *
 * Classifies an entire media bin using a single GPT-4o call.
 *
 * ⚠️  WARNING: classifyBin() must ONLY be called at upload time or when the
 * user explicitly requests bin analysis. NEVER call it during command
 * execution — it makes an OpenAI API call and can take several seconds.
 */

'use strict';

const OpenAI = require('openai');

class ContentClassifier {

    constructor() {
        this.openai = process.env.OPENAI_API_KEY
            ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
            : null;
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
            return { projectType: 'unknown', assets: assets.map(a => ({ id: a.id, content_class: 'unknown' })) };
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

            const response = await this.openai.chat.completions.create({
                model: 'gpt-4o',
                max_tokens: 1000,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user',   content: `Media bin assets:\n${JSON.stringify(assetSummaries, null, 2)}` },
                ],
            });

            const raw = response.choices[0]?.message?.content;
            if (!raw) return { projectType: 'unknown', assets: [] };

            return JSON.parse(raw);

        } catch (err) {
            console.error('[ContentClassifier] classifyBin error:', err.message);
            return { projectType: 'unknown', assets: [], warnings: [err.message] };
        }
    }
}

module.exports = { ContentClassifier };
