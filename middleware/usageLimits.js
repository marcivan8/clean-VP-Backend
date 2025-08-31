const User = require('../models/User');

const checkUsageLimits = async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    // Check if user needs monthly reset
    await User.checkAndResetIfNeeded(userId);
    
    // Check current usage
    const usageCheck = await User.checkUsageLimits(userId);
    
    if (!usageCheck.canAnalyze) {
      return res.status(403).json({
        error: 'Monthly limit reached',
        message: 'You have reached your monthly limit of 20 video analyses. Your limit will reset in 30 days from your last reset.',
        usage: usageCheck.usage,
        limit: usageCheck.limit,
        remaining: 0
      });
    }
    
    req.usageCheck = usageCheck;
    next();
  } catch (error) {
    console.error('Usage check error:', error);
    res.status(500).json({ error: 'Failed to check usage limits' });
  }
};

module.exports = { checkUsageLimits };