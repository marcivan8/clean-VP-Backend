const User = require('../models/User');

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
    
    // Check if user needs monthly reset with error handling
    try {
      await User.checkAndResetIfNeeded(userId);
    } catch (resetError) {
      console.error('Reset check failed:', resetError);
      // Continue anyway - don't block the request for reset failures
    }
    
    // Check current usage with detailed error handling
    let usageCheck;
    try {
      usageCheck = await User.checkUsageLimits(userId);
    } catch (usageError) {
      console.error('Usage check failed:', usageError);
      
      // If user doesn't exist, try to handle gracefully
      if (usageError.message === 'User not found') {
        return res.status(404).json({
          error: 'User profile not found. Please sign in again.',
          code: 'USER_NOT_FOUND'
        });
      }
      
      // For other errors, return server error
      return res.status(500).json({
        error: 'Failed to check usage limits',
        code: 'USAGE_CHECK_FAILED',
        details: process.env.NODE_ENV === 'development' ? usageError.message : undefined
      });
    }
    
    if (!usageCheck.canAnalyze) {
      console.log(`❌ User ${userId} has reached monthly limit: ${usageCheck.usage}/${usageCheck.limit}`);
      return res.status(403).json({
        error: 'Monthly limit reached',
        message: 'You have reached your monthly limit of 20 video analyses. Your limit will reset in 30 days from your last reset.',
        usage: usageCheck.usage,
        limit: usageCheck.limit,
        remaining: 0,
        code: 'MONTHLY_LIMIT_REACHED'
      });
    }
    
    console.log(`✅ Usage check passed for user ${userId}: ${usageCheck.usage}/${usageCheck.limit}`);
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