const { supabaseAdmin } = require('../config/database');

class User {
  static async findById(userId) {
    if (!userId) {
      throw new Error('User ID is required');
    }
    
    try {
      const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
        
      if (error) {
        if (error.code === 'PGRST116') { // No rows found
          console.log(`User not found: ${userId}`);
          return null;
        }
        console.error('Database error in findById:', error);
        throw error;
      }
      
      return data;
    } catch (error) {
      console.error('Error in findById:', error);
      throw error;
    }
  }
  
  static async create(userData) {
    if (!userData || !userData.id || !userData.email) {
      throw new Error('Missing required user data: id and email are required');
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(userData.email)) {
      throw new Error('Invalid email format');
    }

    const profileData = {
      id: userData.id,
      email: userData.email.trim().toLowerCase(),
      full_name: userData.full_name ? userData.full_name.trim() : null,
      monthly_usage: { analyses: 0 },
      usage_reset_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    try {
      const { data, error } = await supabaseAdmin
        .from('profiles')
        .insert([profileData])
        .select()
        .single();
        
      if (error) {
        console.error('User creation error:', {
          code: error.code,
          message: error.message,
          details: error.details,
          userData: { ...userData, email: userData.email?.substring(0, 5) + '***' }
        });
        throw error;
      }
      
      return data;
    } catch (error) {
      console.error('Error in create:', error);
      throw error;
    }
  }

  static async findOrCreate(userData) {
    try {
      // Try to find existing user first
      const existingUser = await this.findById(userData.id);
      if (existingUser) {
        console.log(`User ${userData.id} already exists`);
        return existingUser;
      }
      
      // Create new user if not found
      console.log(`Creating new user: ${userData.id}`);
      return await this.create(userData);
    } catch (error) {
      console.error('Find or create user error:', error);
      throw error;
    }
  }
  
  static async updateUsage(userId) {
    if (!userId) {
      throw new Error('User ID is required');
    }

    try {
      const user = await this.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const currentUsage = user.monthly_usage || { analyses: 0 };
      
      const newUsage = {
        analyses: currentUsage.analyses + 1
      };
      
      const { data, error } = await supabaseAdmin
        .from('profiles')
        .update({ 
          monthly_usage: newUsage,
          last_analysis_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', userId)
        .select()
        .single();
        
      if (error) {
        console.error('Usage update error:', error);
        throw error;
      }
      
      return data;
    } catch (error) {
      console.error('Error in updateUsage:', error);
      throw error;
    }
  }
  
  static async checkUsageLimits(userId) {
    if (!userId) {
      throw new Error('User ID is required');
    }

    try {
      const user = await this.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const usage = user.monthly_usage || { analyses: 0 };
      
      // FIXED LIMIT: 20 analyses per month for ALL users
      const MONTHLY_LIMIT = 20;
      
      return {
        canAnalyze: usage.analyses < MONTHLY_LIMIT,
        usage: usage.analyses,
        limit: MONTHLY_LIMIT,
        remaining: Math.max(0, MONTHLY_LIMIT - usage.analyses)
      };
    } catch (error) {
      console.error('Error in checkUsageLimits:', error);
      throw error;
    }
  }
  
  static async getUsage(userId) {
    if (!userId) {
      throw new Error('User ID is required');
    }

    try {
      const user = await this.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const usage = user.monthly_usage || { analyses: 0 };
      
      return {
        analyses: usage.analyses,
        limit: 20,
        remaining: Math.max(0, 20 - usage.analyses),
        lastAnalysisAt: user.last_analysis_at,
        resetAt: user.usage_reset_at,
        createdAt: user.created_at
      };
    } catch (error) {
      console.error('Error in getUsage:', error);
      throw error;
    }
  }
  
  // Reset monthly usage for all users (run via cron job)
  static async resetAllMonthlyUsage() {
    try {
      const { error } = await supabaseAdmin
        .from('profiles')
        .update({ 
          monthly_usage: { analyses: 0 },
          usage_reset_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .not('id', 'is', null);
        
      if (error) {
        console.error('Reset all usage error:', error);
        throw error;
      }
      
      console.log('✅ Monthly usage reset for all users');
      return true;
    } catch (error) {
      console.error('Error in resetAllMonthlyUsage:', error);
      throw error;
    }
  }
  
  // Check if user needs reset (if it's been > 30 days)
  static async checkAndResetIfNeeded(userId) {
    if (!userId) {
      throw new Error('User ID is required');
    }

    try {
      const user = await this.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const resetDate = user.usage_reset_at ? new Date(user.usage_reset_at) : new Date(0);
      const now = new Date();
      const daysSinceReset = (now - resetDate) / (1000 * 60 * 60 * 24);
      
      if (daysSinceReset >= 30) {
        const { data, error } = await supabaseAdmin
          .from('profiles')
          .update({ 
            monthly_usage: { analyses: 0 },
            usage_reset_at: now.toISOString(),
            updated_at: now.toISOString()
          })
          .eq('id', userId)
          .select()
          .single();
          
        if (error) {
          console.error('Usage reset error:', error);
          throw error;
        }
        
        console.log(`✅ Usage reset for user ${userId}`);
        return data;
      }
      
      return user;
    } catch (error) {
      console.error('Error in checkAndResetIfNeeded:', error);
      throw error;
    }
  }
}

module.exports = User;