// services/UsageBasedPricingService.js
const User = require('../models/User');
const VideoAnalysis = require('../models/VideoAnalysis');

class UsageBasedPricingService {
  constructor() {
    this.tiers = {
      explorer: {
        id: 'explorer',
        name: 'Explorer',
        limits: {
          videoAnalyses: 20, // Match the limit in User.js
        },
        period: 'monthly'
      },
    };
  }

  async getUserTier(userId) {
    // For now, everyone is on the Explorer tier
    // In the future, we can fetch this from the User profile
    return {
      tier: this.tiers.explorer,
      expiresAt: null,
      usage: {},
    };
  }

  async getCurrentUsage(userId) {
    const userUsage = await User.getUsage(userId);
    return {
      videoAnalyses: userUsage.analyses,
    };
  }

  async getUsageStatistics(userId) {
    try {
      // 1. Get User Usage & Limits
      const userUsage = await User.getUsage(userId);
      const tier = this.tiers.explorer;

      // 2. Get Recent History
      const history = await VideoAnalysis.findByUser(userId, 5); // Get last 5 analyses

      // 3. Calculate percentages
      const limit = userUsage.limit || tier.limits.videoAnalyses;
      const used = userUsage.analyses;
      const percentage = limit > 0 ? Math.round((used / limit) * 100) : 0;

      return {
        tier: {
          name: tier.name,
          id: tier.id,
          period: tier.period,
        },
        usage: {
          videoAnalyses: {
            used: used,
            limit: limit,
            remaining: userUsage.remaining,
            percentage: percentage,
          },
        },
        recommendations: [], // Can be added later
        history: history.map(analysis => ({
          id: analysis.id,
          date: analysis.created_at,
          title: analysis.title,
          score: analysis.virality_score,
          platform: analysis.best_platform
        })),
        projections: {},
      };
    } catch (error) {
      console.error('Error in getUsageStatistics:', error);
      throw error;
    }
  }

  async trackUsage(userId, action, metadata) {
    console.log('Tracking usage:', { userId, action, metadata });
    // Usage is currently tracked in the controller via User.updateUsage
    return { success: true };
  }

  async checkUsageLimit(userId, feature) {
    // Delegate to User model which has the logic
    if (feature === 'videoAnalysis' || feature === 'videoAnalyses') {
      const check = await User.checkUsageLimits(userId);
      return {
        allowed: check.canAnalyze,
        limit: check.limit,
        used: check.usage,
        remaining: check.remaining,
        reason: check.canAnalyze ? null : 'limit_reached'
      };
    }

    return { allowed: true };
  }
}

module.exports = new UsageBasedPricingService();