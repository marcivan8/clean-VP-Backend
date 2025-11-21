// services/UsageBasedPricingService.js

class UsageBasedPricingService {
  constructor() {
    this.tiers = {
      explorer: {
        id: 'explorer',
        name: 'Explorer',
        limits: {
          videoAnalyses: 5,
        },
      },
    };
  }

  async getUserTier(userId) {
    return {
      tier: this.tiers.explorer,
      expiresAt: null,
      usage: {},
    };
  }

  async getCurrentUsage(userId) {
    return {
      videoAnalyses: 1,
    };
  }

  async getUsageStatistics(userId) {
    return {
      tier: {
        name: 'Explorer',
        id: 'explorer',
        period: 'weekly',
      },
      usage: {
        videoAnalyses: {
          used: 1,
          limit: 5,
          remaining: 4,
          percentage: 20,
        },
      },
      recommendations: [],
      history: [],
      projections: {},
    };
  }

  async trackUsage(userId, action, metadata) {
    console.log('Tracking usage:', { userId, action, metadata });
    return { success: true };
  }

  async checkUsageLimit(userId, feature) {
    const tierData = await this.getUserTier(userId);
    const currentUsage = await this.getCurrentUsage(userId);

    // Map feature name to internal key if needed
    const featureMap = {
      'videoAnalysis': 'videoAnalyses'
    };
    const internalFeatureKey = featureMap[feature] || feature;

    const limit = tierData.tier.limits[internalFeatureKey];

    if (limit === undefined) {
      return {
        allowed: false,
        reason: 'not_available_in_plan'
      };
    }

    const used = currentUsage[internalFeatureKey] || 0;

    if (used >= limit) {
      return {
        allowed: false,
        reason: 'limit_reached',
        limit,
        used
      };
    }

    return {
      allowed: true,
      limit,
      used,
      remaining: limit - used
    };
  }
}

module.exports = new UsageBasedPricingService();