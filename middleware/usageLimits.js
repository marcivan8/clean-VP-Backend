const User = require('../models/User');

const checkUsageLimits = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const usageCheck = await User.checkUsageLimits(userId);
    
    if (!usageCheck.canAnalyze) {
      return res.status(403).json({
        error: 'Monthly analysis limit reached',
        usage: usageCheck.usage,
        limits: usageCheck.limits,
        upgrade_url: `${process.env.FRONTEND_URL}/pricing`
      });
    }
    
    req.usageCheck = usageCheck;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Usage check failed' });
  }
};

module.exports = { checkUsageLimits };