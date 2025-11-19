const UsageBasedPricingService = require('../services/UsageBasedPricingService');

const checkUsageLimits = async (req, res, next) => {
  try {
    // Ensure user is properly authenticated
    if (!req.user || !req.user.id) {
      console.error('No user found in request');
      return res.status(401).json({ 
        error: 'User not authenticated',
        code: 'AUTH_REQUIRED' 
      });
    }

    const userId = req.user.id;
    console.log(`🔍 Checking usage limits for user: ${userId}`);

    // Check usage via smart pricing service
    const usageCheck = await UsageBasedPricingService.checkUsageLimit(userId, 'videoAnalysis');

    if (!usageCheck.allowed) {
      console.log(`❌ Usage limit reached for user ${userId}:`, usageCheck);
      return res.status(403).json({
        error: 'Usage limit reached',
        message:
          usageCheck.reason === 'not_available_in_plan'
            ? 'This feature is not available on your current plan.'
            : 'You have reached your current plan limit.',
        details: usageCheck,
        code: usageCheck.reason === 'not_available_in_plan' ? 'FEATURE_NOT_AVAILABLE' : 'USAGE_LIMIT_REACHED'
      });
    }

    console.log(`✅ Usage check passed for user ${userId}`);
    req.usageCheck = usageCheck;
    next();
  } catch (error) {
    console.error('Usage limits middleware error:', error);
    res.status(500).json({ 
      error: 'Failed to check usage limits',
      code: 'MIDDLEWARE_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = { checkUsageLimits };