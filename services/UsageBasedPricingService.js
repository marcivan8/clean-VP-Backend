// services/UsageBasedPricingService.js
const User = require('../models/User');
const VideoAnalysis = require('../models/VideoAnalysis');
const { supabaseAdmin } = require('../config/database');
const PolarService = require('./PolarService');

class UsageBasedPricingService {
  constructor() {
    // Mirror PolarService's tier catalogue so callers that reference
    // UsageBasedPricingService.tiers still work without modification.
    this.tiers = PolarService.getTiers();
  }

  /**
   * Resolve the user's active tier via Polar.sh.
   * Falls back to explorer when Polar is unconfigured or the API fails.
   * Requires the user's email to look up their Polar customer record.
   */
  async getUserTier(userId, userEmail = null) {
    const { tier, source } = await PolarService.getUserTier(userEmail);
    console.log(`[UsageBasedPricingService] User ${userId} tier=${tier.name} (source=${source})`);
    return {
      tier: { ...tier, id: tier.id ?? tier.name.toLowerCase() },
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

  async getUsageStatistics(userId, userEmail = null) {
    try {
      const userUsage = await User.getUsage(userId);
      const { tier } = await PolarService.getUserTier(userEmail);

      const history = await VideoAnalysis.findByUser(userId, 5);

      const limit = userUsage.limit || tier.limits.videoAnalyses;
      const used  = userUsage.analyses;
      const percentage = isFinite(limit) && limit > 0
          ? Math.round((used / limit) * 100)
          : 0;

      return {
        tier: {
          name:   tier.name,
          id:     tier.id ?? tier.name.toLowerCase(),
          period: tier.period,
        },
        usage: {
          videoAnalyses: {
            used,
            limit:     isFinite(limit) ? limit : null,
            remaining: userUsage.remaining,
            percentage,
          },
        },
        recommendations: [],
        history: history.map(analysis => ({
          id:       analysis.id,
          date:     analysis.created_at,
          title:    analysis.title,
          score:    analysis.virality_score,
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

    try {
      const { error } = await supabaseAdmin
        .from('usage_logs')
        .insert({
          user_id:    userId,
          action:     action,
          metadata:   metadata,
          created_at: new Date().toISOString()
        });

      if (error) {
        console.error('Error logging usage:', error);
        return { success: false, error };
      }

      return { success: true };
    } catch (err) {
      console.error('Exception in trackUsage:', err);
      return { success: false, error: err };
    }
  }

  /**
   * Check whether a user is allowed to perform a billable action.
   * Pass userEmail so getUserTier can query Polar.
   */
  async checkUsageLimit(userId, feature, userEmail = null) {
    if (feature === 'videoAnalysis' || feature === 'videoAnalyses') {
      const check = await User.checkUsageLimits(userId);

      // If the user's DB limit already accounts for their tier, honour it.
      // Otherwise ask Polar for the real entitlement.
      const { tier } = await PolarService.getUserTier(userEmail);
      const tierLimit = isFinite(tier.limits.videoAnalyses)
          ? tier.limits.videoAnalyses
          : Infinity;

      const allowed = check.usage < tierLimit;
      return {
        allowed,
        limit:     isFinite(tierLimit) ? tierLimit : null,
        used:      check.usage,
        remaining: isFinite(tierLimit) ? Math.max(0, tierLimit - check.usage) : null,
        reason:    allowed ? null : 'limit_reached',
      };
    }

    return { allowed: true };
  }
}

module.exports = new UsageBasedPricingService();
