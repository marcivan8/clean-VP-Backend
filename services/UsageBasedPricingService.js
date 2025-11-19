const { supabaseAdmin } = require('../config/database');

/**
 * services/UsageBasedPricingService.js
 * Smart usage-based system without payment processing
 */
class UsageBasedPricingService {
  constructor() {
    // Pricing tiers based on user research
    this.tiers = {
      explorer: {
        id: 'explorer',
        name: 'Explorer',
        price: 0, // Free
        period: 'weekly',
        limits: {
          videoAnalyses: 3, // 3 per week
          maxVideoDuration: 60, // seconds
          maxVideoSize: 50, // MB
          deepAnalysis: true,
          emotionDetection: true,
          basicInsights: true,
          exportReports: false,
          contentGeneration: false,
          teamCollaboration: false,
          apiAccess: false,
          customBranding: false,
          priorityProcessing: false,
          compareVideos: false,
          batchProcessing: false
        },
        features: [
          'Basic video analysis',
          'Platform recommendations',
          'Virality score',
          'Basic insights',
          'Up to 60-second videos'
        ],
        targetUsers: 'Hobbyists, students, occasional creators',
        resetPeriod: 7 * 24 * 60 * 60 * 1000 // 7 days in ms
      },

      creator: {
        id: 'creator',
        name: 'Creator',
        price: 0, // Free with limits
        period: 'monthly',
        limits: {
          videoAnalyses: 20, // 20 per month (~5 per week)
          maxVideoDuration: 300, // 5 minutes
          maxVideoSize: 200, // MB
          deepAnalysis: true,
          emotionDetection: true,
          basicInsights: true,
          exportReports: true, // PDF only
          contentGeneration: 5, // 5 AI generations per month
          teamCollaboration: false,
          apiAccess: false,
          customBranding: false,
          priorityProcessing: false,
          compareVideos: true, // Up to 3
          batchProcessing: false
        },
        features: [
          '20 analyses per month',
          'Deep emotional analysis',
          'Export PDF reports',
          '5 AI content generations',
          'Video comparison (up to 3)',
          'Up to 5-minute videos',
          'Priority email support'
        ],
        targetUsers: 'Regular content creators, small YouTubers',
        resetPeriod: 30 * 24 * 60 * 60 * 1000 // 30 days
      },

      professional: {
        id: 'professional',
        name: 'Professional',
        price: 0, // Could be paid tier later
        period: 'monthly',
        limits: {
          videoAnalyses: 100, // 100 per month (~25 per week)
          maxVideoDuration: 1200, // 20 minutes
          maxVideoSize: 1024, // 1GB
          deepAnalysis: true,
          emotionDetection: true,
          basicInsights: true,
          advancedInsights: true,
          exportReports: true, // All formats
          contentGeneration: 50, // 50 AI generations
          teamCollaboration: true, // Up to 3 members
          apiAccess: true, // 1000 calls/month
          customBranding: true,
          priorityProcessing: true,
          compareVideos: true, // Unlimited
          batchProcessing: true, // Up to 10 videos
          historicalData: true,
          trendAnalysis: true
        },
        features: [
          '100 analyses per month',
          'Advanced AI insights',
          'Unlimited video comparisons',
          'Batch processing (10 videos)',
          '50 AI content generations',
          'Team collaboration (3 seats)',
          'API access (1000 calls)',
          'Custom branding',
          'Priority processing',
          'Trend analysis',
          'Historical data access',
          'Priority support'
        ],
        targetUsers: 'Professional creators, agencies, video editors',
        resetPeriod: 30 * 24 * 60 * 60 * 1000
      },

      studio: {
        id: 'studio',
        name: 'Studio',
        price: 0, // Enterprise/custom pricing
        period: 'monthly',
        limits: {
          videoAnalyses: 500, // 500 per month
          maxVideoDuration: -1, // Unlimited
          maxVideoSize: 5120, // 5GB
          deepAnalysis: true,
          emotionDetection: true,
          basicInsights: true,
          advancedInsights: true,
          exportReports: true,
          contentGeneration: -1, // Unlimited
          teamCollaboration: true, // Unlimited members
          apiAccess: true, // Unlimited
          customBranding: true,
          priorityProcessing: true,
          compareVideos: true,
          batchProcessing: true, // Up to 50 videos
          historicalData: true,
          trendAnalysis: true,
          whiteLabel: true,
          customIntegrations: true,
          dedicatedSupport: true
        },
        features: [
          '500 analyses per month',
          'Unlimited video duration',
          'Unlimited AI generations',
          'Unlimited team members',
          'Unlimited API access',
          'Batch processing (50 videos)',
          'White-label options',
          'Custom integrations',
          'Dedicated account manager',
          'Custom AI training',
          'SLA guarantee',
          '24/7 phone support'
        ],
        targetUsers: 'Production studios, agencies, enterprises',
        resetPeriod: 30 * 24 * 60 * 60 * 1000
      }
    };

    // Usage tracking
    this.usageCache = new Map();
  }

  /**
   * Get user's current tier based on their profile
   */
  async getUserTier(userId) {
    try {
      const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select('subscription_tier, tier_expires_at, usage_data')
        .eq('id', userId)
        .single();

      if (error) throw error;

      // Default to explorer if no tier set
      const tierName = profile?.subscription_tier || 'explorer';
      const tier = this.tiers[tierName];

      // Check if tier needs reset
      if (profile?.tier_expires_at) {
        const expiresAt = new Date(profile.tier_expires_at);
        if (expiresAt <= new Date()) {
          await this.resetUserUsage(userId, tierName);
        }
      }

      return {
        tier: tier,
        expiresAt: profile?.tier_expires_at,
        usage: profile?.usage_data || {}
      };
    } catch (error) {
      console.error('Error getting user tier:', error);
      return {
        tier: this.tiers.explorer,
        expiresAt: null,
        usage: {}
      };
    }
  }

  /**
   * Check if user can perform action
   */
  async checkUsageLimit(userId, action = 'videoAnalysis') {
    try {
      const { tier, usage } = await this.getUserTier(userId);
      const currentUsage = await this.getCurrentUsage(userId);

      // Map actions to limit keys
      const limitMap = {
        videoAnalysis: 'videoAnalyses',
        contentGeneration: 'contentGeneration',
        export: 'exportReports',
        comparison: 'compareVideos',
        batch: 'batchProcessing',
        api: 'apiAccess'
      };

      const limitKey = limitMap[action] || 'videoAnalyses';
      const limit = tier.limits[limitKey];

      // Check boolean permissions
      if (typeof limit === 'boolean') {
        return {
          allowed: limit,
          reason: limit ? 'allowed' : 'not_available_in_plan',
          tier: tier.name,
          upgrade: this.getSuggestedUpgrade(tier.id, limitKey)
        };
      }

      // Check numeric limits (-1 means unlimited)
      if (limit === -1) {
        return {
          allowed: true,
          reason: 'unlimited',
          tier: tier.name
        };
      }

      const used = currentUsage[limitKey] || 0;
      const remaining = limit - used;

      return {
        allowed: remaining > 0,
        used: used,
        limit: limit,
        remaining: Math.max(0, remaining),
        reason: remaining > 0 ? 'within_limit' : 'limit_reached',
        tier: tier.name,
        resetDate: this.getResetDate(userId, tier),
        upgrade: remaining <= 0 ? this.getSuggestedUpgrade(tier.id, limitKey) : null
      };
    } catch (error) {
      console.error('Error checking usage limit:', error);
      return {
        allowed: false,
        reason: 'error',
        error: error.message
      };
    }
  }

  /**
   * Track usage for an action
   */
  async trackUsage(userId, action = 'videoAnalysis', metadata = {}) {
    try {
      const { tier } = await this.getUserTier(userId);
      const limitKey = this.getLimitKey(action);

      // Get current usage
      const { data: profile, error: fetchError } = await supabaseAdmin
        .from('profiles')
        .select('usage_data')
        .eq('id', userId)
        .single();

      if (fetchError) throw fetchError;

      const currentUsage = profile?.usage_data || {};
      const periodKey = this.getPeriodKey(tier);

      if (!currentUsage[periodKey]) {
        currentUsage[periodKey] = {};
      }

      // Increment usage
      currentUsage[periodKey][limitKey] = (currentUsage[periodKey][limitKey] || 0) + 1;
      currentUsage.lastAction = {
        type: action,
        timestamp: new Date().toISOString(),
        metadata: metadata
      };

      // Update database
      const { error: updateError } = await supabaseAdmin
        .from('profiles')
        .update({
          usage_data: currentUsage,
          last_usage_at: new Date().toISOString()
        })
        .eq('id', userId);

      if (updateError) throw updateError;

      // Log usage for analytics
      await this.logUsageAnalytics(userId, action, metadata, tier);

      // Clear cache
      this.usageCache.delete(userId);

      return {
        success: true,
        newUsage: currentUsage[periodKey][limitKey]
      };
    } catch (error) {
      console.error('Error tracking usage:', error);
      throw error;
    }
  }

  /**
   * Get current usage for user
   */
  async getCurrentUsage(userId) {
    try {
      // Check cache first
      if (this.usageCache.has(userId)) {
        const cached = this.usageCache.get(userId);
        if (cached.expires > Date.now()) {
          return cached.data;
        }
      }

      const { tier } = await this.getUserTier(userId);
      const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select('usage_data')
        .eq('id', userId)
        .single();

      if (error) throw error;

      const periodKey = this.getPeriodKey(tier);
      const usage = profile?.usage_data?.[periodKey] || {};

      // Cache for 5 minutes
      this.usageCache.set(userId, {
        data: usage,
        expires: Date.now() + 5 * 60 * 1000
      });

      return usage;
    } catch (error) {
      console.error('Error getting current usage:', error);
      return {};
    }
  }

  /**
   * Reset user usage (called periodically)
   */
  async resetUserUsage(userId, tierName) {
    try {
      const tier = this.tiers[tierName];
      const nextReset = new Date(Date.now() + tier.resetPeriod);
      const periodKey = this.getPeriodKey(tier);

      const { data: profile, error: fetchError } = await supabaseAdmin
        .from('profiles')
        .select('usage_data')
        .eq('id', userId)
        .single();

      if (fetchError) throw fetchError;

      const usageData = profile?.usage_data || {};

      // Archive old usage data
      if (usageData[periodKey]) {
        usageData[`archived_${periodKey}_${Date.now()}`] = usageData[periodKey];
      }

      // Reset current period
      usageData[periodKey] = {};

      const { error: updateError } = await supabaseAdmin
        .from('profiles')
        .update({
          usage_data: usageData,
          tier_expires_at: nextReset.toISOString(),
          usage_reset_at: new Date().toISOString()
        })
        .eq('id', userId);

      if (updateError) throw updateError;

      // Clear cache
      this.usageCache.delete(userId);

      // Send notification
      await this.sendUsageResetNotification(userId, tier);

      return {
        success: true,
        nextReset: nextReset
      };
    } catch (error) {
      console.error('Error resetting usage:', error);
      throw error;
    }
  }

  /**
   * Upgrade user tier (manual upgrade)
   */
  async upgradeTier(userId, newTierName) {
    try {
      const newTier = this.tiers[newTierName];
      if (!newTier) {
        throw new Error('Invalid tier');
      }

      const nextReset = new Date(Date.now() + newTier.resetPeriod);

      const { error } = await supabaseAdmin
        .from('profiles')
        .update({
          subscription_tier: newTierName,
          tier_expires_at: nextReset.toISOString(),
          tier_upgraded_at: new Date().toISOString(),
          usage_data: {} // Reset usage on upgrade
        })
        .eq('id', userId);

      if (error) throw error;

      // Clear cache
      this.usageCache.delete(userId);

      // Log upgrade
      await this.logTierUpgrade(userId, newTierName);

      return {
        success: true,
        newTier: newTier,
        nextReset: nextReset
      };
    } catch (error) {
      console.error('Error upgrading tier:', error);
      throw error;
    }
  }

  /**
   * Get usage statistics for dashboard
   */
  async getUsageStatistics(userId) {
    try {
      const { tier } = await this.getUserTier(userId);
      const currentUsage = await this.getCurrentUsage(userId);

      const stats = {
        tier: {
          name: tier.name,
          id: tier.id,
          period: tier.period
        },
        usage: {},
        recommendations: []
      };

      // Calculate usage percentages
      for (const [key, limit] of Object.entries(tier.limits)) {
        if (typeof limit === 'number' && limit > 0) {
          const used = currentUsage[key] || 0;
          stats.usage[key] = {
            used: used,
            limit: limit,
            remaining: Math.max(0, limit - used),
            percentage: (used / limit) * 100,
            willResetAt: this.getResetDate(userId, tier)
          };

          // Add recommendations
          if (stats.usage[key].percentage > 80) {
            stats.recommendations.push({
              type: 'high_usage',
              feature: key,
              message: `You've used ${stats.usage[key].percentage.toFixed(0)}% of your ${key}. Consider upgrading for more.`,
              suggestedTier: this.getSuggestedUpgrade(tier.id, key)
            });
          }
        }
      }

      // Get historical usage
      stats.history = await this.getUsageHistory(userId);

      // Get projected needs
      stats.projections = this.projectFutureNeeds(stats.history);

      return stats;
    } catch (error) {
      console.error('Error getting usage statistics:', error);
      throw error;
    }
  }

  /**
   * Helper: Get period key for storage
   */
  getPeriodKey(tier) {
    const now = new Date();
    if (tier.period === 'weekly') {
      // Get week number
      const weekNumber = Math.floor((now - new Date(now.getFullYear(), 0, 1)) / (7 * 24 * 60 * 60 * 1000));
      return `week_${now.getFullYear()}_${weekNumber}`;
    }
    // Monthly
    return `month_${now.getFullYear()}_${now.getMonth() + 1}`;
  }

  /**
   * Helper: Get limit key from action
   */
  getLimitKey(action) {
    const map = {
      videoAnalysis: 'videoAnalyses',
      contentGeneration: 'contentGeneration',
      export: 'exportReports',
      comparison: 'compareVideos',
      batch: 'batchProcessing',
      api: 'apiAccess'
    };
    return map[action] || 'videoAnalyses';
  }

  /**
   * Helper: Get reset date
   */
  getResetDate(userId, tier) {
    const now = new Date();
    if (tier.period === 'weekly') {
      const nextMonday = new Date(now);
      nextMonday.setDate(now.getDate() + ((1 + 7 - now.getDay()) % 7));
      nextMonday.setHours(0, 0, 0, 0);
      return nextMonday;
    }
    // Monthly - first day of next month
    return new Date(now.getFullYear(), now.getMonth() + 1, 1);
  }

  /**
   * Helper: Suggest upgrade tier
   */
  getSuggestedUpgrade(currentTierId, feature) {
    const tierOrder = ['explorer', 'creator', 'professional', 'studio'];
    const currentIndex = tierOrder.indexOf(currentTierId);

    // Find next tier with better limits for this feature
    for (let i = currentIndex + 1; i < tierOrder.length; i++) {
      const tier = this.tiers[tierOrder[i]];
      const limit = tier.limits[feature];

      if (
        limit === -1 ||
        limit === true ||
        (typeof limit === 'number' && limit > (this.tiers[currentTierId].limits[feature] || 0))
      ) {
        return {
          tier: tier.name,
          benefit: this.getUpgradeBenefit(feature, this.tiers[currentTierId], tier)
        };
      }
    }

    return null;
  }

  /**
   * Helper: Get upgrade benefit message
   */
  getUpgradeBenefit(feature, currentTier, newTier) {
    const current = currentTier.limits[feature];
    const next = newTier.limits[feature];

    if (next === -1) return 'Unlimited access';
    if (typeof next === 'boolean' && next) return 'Feature unlocked';
    if (typeof next === 'number') {
      const increase = next - (current || 0);
      return `+${increase} more per ${newTier.period}`;
    }
    return 'Enhanced access';
  }

  /**
   * Get usage history for analytics
   */
  async getUsageHistory(userId) {
    try {
      const { data, error } = await supabaseAdmin
        .from('usage_logs')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error getting usage history:', error);
      return [];
    }
  }

  /**
   * Project future needs based on usage patterns
   */
  projectFutureNeeds(history) {
    if (!history || history.length < 7) {
      return { recommendation: 'Need more usage data for projections' };
    }

    // Calculate average daily usage
    const dailyUsage = {};
    history.forEach(log => {
      const date = new Date(log.created_at).toDateString();
      if (!dailyUsage[date]) dailyUsage[date] = 0;
      dailyUsage[date]++;
    });

    const avgDaily = Object.values(dailyUsage).reduce((a, b) => a + b, 0) / Object.keys(dailyUsage).length;
    const projectedMonthly = avgDaily * 30;

    // Recommend tier based on projection
    let recommendedTier = 'explorer';
    if (projectedMonthly > 80) recommendedTier = 'studio';
    else if (projectedMonthly > 50) recommendedTier = 'professional';
    else if (projectedMonthly > 15) recommendedTier = 'creator';

    return {
      averageDailyUsage: avgDaily.toFixed(1),
      projectedMonthlyUsage: Math.round(projectedMonthly),
      recommendedTier: recommendedTier,
      confidence: history.length >= 30 ? 'high' : 'medium'
    };
  }

  /**
   * Log usage for analytics
   */
  async logUsageAnalytics(userId, action, metadata, tier) {
    try {
      await supabaseAdmin.from('usage_logs').insert([
        {
          user_id: userId,
          action: action,
          tier: tier.id,
          metadata: metadata,
          created_at: new Date().toISOString()
        }
      ]);
    } catch (error) {
      console.error('Error logging usage:', error);
    }
  }

  /**
   * Log tier upgrade
   */
  async logTierUpgrade(userId, newTier) {
    try {
      await supabaseAdmin.from('tier_changes').insert([
        {
          user_id: userId,
          new_tier: newTier,
          changed_at: new Date().toISOString()
        }
      ]);
    } catch (error) {
      console.error('Error logging tier upgrade:', error);
    }
  }

  /**
   * Send notifications
   */
  async sendUsageResetNotification(userId, tier) {
    // Implement email/notification logic
    console.log(`Usage reset for user ${userId} on ${tier.name} tier`);
  }
}

module.exports = new UsageBasedPricingService();

