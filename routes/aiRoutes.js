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
    detectRepeatedTakesHandler,
} = require('../controllers/aiAgentController');
const { authenticateUser } = require('../middleware/auth');
const { aiGate } = require('../middleware/usageGate');

router.post('/chat',               authenticateUser, aiGate, chatAgentHandler);
router.post('/agent-plan',         authenticateUser, aiGate, agentPlanHandler);
router.post('/parse-intent',       authenticateUser, aiGate, parseIntentHandler);
router.post('/generate-plan',      authenticateUser, aiGate, generatePlanHandler);
router.post('/analyze-content',    authenticateUser, aiGate, analyzeContentHandler);
router.post('/smart-cleanup',      authenticateUser, aiGate, smartCleanupHandler);
router.post('/reorder-clips',      authenticateUser, aiGate, reorderClipsHandler);
router.post('/detect-repeated-takes', authenticateUser, aiGate, detectRepeatedTakesHandler);

module.exports = router;

