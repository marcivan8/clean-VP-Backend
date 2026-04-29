const express = require('express');
const router = express.Router();
const {
    chatAgentHandler,
    agentPlanHandler,
    parseIntentHandler,
    generatePlanHandler,
    analyzeContentHandler,
} = require('../controllers/aiAgentController');
const SpacyService = require('../services/SpacyService');

router.post('/chat', chatAgentHandler);
router.post('/agent-plan', agentPlanHandler);

// New pipeline endpoints
router.post('/parse-intent', parseIntentHandler);
router.post('/generate-plan', generatePlanHandler);

// Long-Form Intelligence Engine endpoint
// Accepts: { transcript: { text, segments }, clips: [], duration: number, platform?: string }
// Returns: { contentType, segments[], structure, editMode, editPlan }
router.post('/analyze-content', analyzeContentHandler);

// spaCy NLP direct endpoints (for debugging/testing)
router.post('/analyze-prompt', async (req, res) => {
    try {
        const { prompt, video_duration_seconds } = req.body;
        const result = await SpacyService.analyzePrompt(prompt, video_duration_seconds);
        if (!result) {
            return res.status(503).json({ error: 'spaCy service unavailable' });
        }
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/analyze-transcript', async (req, res) => {
    try {
        const { transcript, video_duration_seconds } = req.body;
        const result = await SpacyService.analyzeTranscript(transcript, video_duration_seconds);
        if (!result) {
            return res.status(503).json({ error: 'spaCy service unavailable' });
        }
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

