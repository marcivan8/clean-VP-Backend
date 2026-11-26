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
    designCopilotHandler,
    designVariationsHandler,
} = require('../controllers/aiAgentController');
const { authenticateUser } = require('../middleware/auth');
const { aiGate, requirePlan } = require('../middleware/usageGate');

// Design Studio is a Pro feature (R104). Checked before aiGate so a refused
// request does not use up an AI operation.
const designStudioGate = requirePlan('pro', { code: 'DESIGN_STUDIO_PRO', feature: 'Design Studio' });

router.post('/chat',               authenticateUser, aiGate, chatAgentHandler);
router.post('/agent-plan',         authenticateUser, aiGate, agentPlanHandler);
router.post('/parse-intent',       authenticateUser, aiGate, parseIntentHandler);
router.post('/generate-plan',      authenticateUser, aiGate, generatePlanHandler);
router.post('/analyze-content',    authenticateUser, aiGate, analyzeContentHandler);
router.post('/smart-cleanup',      authenticateUser, aiGate, smartCleanupHandler);
router.post('/reorder-clips',      authenticateUser, aiGate, reorderClipsHandler);
router.post('/detect-repeated-takes', authenticateUser, aiGate, detectRepeatedTakesHandler);
router.post('/design-copilot',     authenticateUser, designStudioGate, aiGate, designCopilotHandler);
router.post('/design-variations',  authenticateUser, designStudioGate, aiGate, designVariationsHandler); // R170

module.exports = router;

