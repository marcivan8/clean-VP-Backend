const { supabaseAdmin } = require('../config/database');

class User {
  static async findById(userId) {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
      
    if (error) throw error;
    return data;
  }
  
  static async create(userData) {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .insert([userData])
      .select()
      .single();
      
    if (error) throw error;
    return data;
  }
  
  static async updateSubscription(userId, subscriptionData) {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update({
        subscription_tier: subscriptionData.tier,
        subscription_status: subscriptionData.status,
        paddle_subscription_id: subscriptionData.paddle_subscription_id,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select()
      .single();
      
    if (error) throw error;
    return data;
  }
  
  static async updateUsage(userId, usageUpdate) {
    const user = await this.findById(userId);
    const currentUsage = user.monthly_usage || { analyses: 0, long_form: 0 };
    
    const newUsage = {
      analyses: currentUsage.analyses + (usageUpdate.analyses || 0),
      long_form: currentUsage.long_form + (usageUpdate.long_form || 0)
    };
    
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update({ monthly_usage: newUsage })
      .eq('id', userId)
      .select()
      .single();
      
    if (error) throw error;
    return data;
  }
  
  static async checkUsageLimits(userId) {
    const user = await this.findById(userId);
    const usage = user.monthly_usage || { analyses: 0, long_form: 0 };
    
    const limits = {
      free: { monthly_analyses: 3, long_form: 0 },
      pro: { monthly_analyses: 30, long_form: 1 },
      premium: { monthly_analyses: 999999, long_form: 5 } // "unlimited"
    };
    
    const userLimits = limits[user.subscription_tier] || limits.free;
    
    return {
      canAnalyze: usage.analyses < userLimits.monthly_analyses,
      canLongForm: usage.long_form < userLimits.long_form,
      usage,
      limits: userLimits
    };
  }
}

module.exports = User;
