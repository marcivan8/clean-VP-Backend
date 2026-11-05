
// R45/R84: services/AIProvider.js is the ONLY place an OpenAI-compatible
// client is constructed. This file used to build its own `new OpenAI()`
// straight off the raw env var (and requested a stale literal model name,
// 'gpt-4-1106-preview', that no other provider serves) — same bug class as
// analysis/audioAnalyzer.js and utils/transcribe.js, found in the same sweep.
const { getAIClient, resolveModel } = require('../services/AIProvider');

const openai = getAIClient({ capability: 'chat' });

/**
 * Generates actionable suggestions based on analysis data.
 * @param {Object} analysisData - Full analysis data.
 * @param {string} language - Output language.
 * @returns {Promise<Object>} - Suggestions for improvements.
 */
async function generateActions(analysisData, language = 'en') {
    const { transcript, platformFit, scores, hook } = analysisData;

    const systemPrompt = `You are an expert video editor and viral content strategist. 
  Analyze the provided video data and generate specific, actionable improvements.
  Output JSON format:
{
    "hookRewrite": "Better hook text...",
        "ctaRewrite": "Better CTA text...",
            "titleSuggestions": ["Title 1", "Title 2", "Title 3"],
                "editingTips": ["Tip 1", "Tip 2"],
                    "description": "Optimized description..."
}
Language: ${language} `;

    const userPrompt = `
Transcript: ${transcript.slice(0, 500)}...
  Current Hook Score: ${scores.hook}
  Best Platform: ${Object.keys(platformFit).reduce((a, b) => platformFit[a] > platformFit[b] ? a : b)}
  Hook Analysis: ${JSON.stringify(hook)}
`;

    try {
        if (!openai) {
            console.warn('⚠️ No OpenAI API Key found. Using mock actions.');
            return {
                hookRewrite: "Mock Hook: Stop scrolling and watch this!",
                ctaRewrite: "Mock CTA: Click the link below.",
                titleSuggestions: ["Mock Title 1", "Mock Title 2"],
                editingTips: ["Mock Tip: Cut the silence"],
                description: "Mock description"
            };
        }

        const completion = await openai.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            model: resolveModel('gpt-4o', 'chat'),
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(completion.choices[0].message.content);
        return result;
    } catch (error) {
        console.error("❌ Error generating actions:", error);
        return {
            hookRewrite: "Could not generate.",
            ctaRewrite: "Could not generate.",
            titleSuggestions: [],
            editingTips: ["Focus on better lighting", "Cut silence"],
            description: ""
        };
    }
}

module.exports = { generateActions };
