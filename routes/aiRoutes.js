const express = require('express');
const router = express.Router();
const {
    chatAgentHandler,
    agentPlanHandler,
    parseIntentHandler,
    generatePlanHandler,
    analyzeContentHandler,
} = require('../controllers/aiAgentController');

router.post('/chat', chatAgentHandler);
router.post('/agent-plan', agentPlanHandler);

// New pipeline endpoints
router.post('/parse-intent', parseIntentHandler);
router.post('/generate-plan', generatePlanHandler);

// Long-Form Intelligence Engine endpoint
// Accepts: { transcript: { text, segments }, clips: [], duration: number, platform?: string }
// Returns: { contentType, segments[], structure, editMode, editPlan }
router.post('/analyze-content', analyzeContentHandler);


module.exports = router;

