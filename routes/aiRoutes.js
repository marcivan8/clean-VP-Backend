const express = require('express');
const router = express.Router();
const {
    chatAgentHandler,
    agentPlanHandler,
    parseIntentHandler,
    generatePlanHandler,
    analyzeContentHandler,
    smartCleanupHandler,
    reorderClipsHandler,
} = require('../controllers/aiAgentController');

router.post('/chat', chatAgentHandler);
router.post('/agent-plan', agentPlanHandler);

// New pipeline endpoints
router.post('/parse-intent', parseIntentHandler);
router.post('/generate-plan', generatePlanHandler);

// Long-Form Intelligence Engine endpoint
router.post('/analyze-content', analyzeContentHandler);

// Semantic cleanup: receives clips with transcript text, returns clip IDs to remove
router.post('/smart-cleanup', smartCleanupHandler);

// Semantic reorder: receives clips with transcript text + user prompt, returns new clip order
router.post('/reorder-clips', reorderClipsHandler);

module.exports = router;

