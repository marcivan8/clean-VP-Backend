const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { authenticateUser } = require('../middleware/auth');
const UsageBasedPricingService = require('../services/UsageBasedPricingService');
const storageConfig = require('../config/storage');
const router = express.Router();

// Create user profile after signup
// Requires a valid JWT so we can trust the userId — never take it from the body.
router.post('/profile', authenticateUser, async (req, res) => {
  try {
    // Always use the verified user ID from the token, NOT from req.body
    const userId = req.user.id;
    const { email, fullName } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Missing required field: email' });
    }

    // Check if profile already exists
    const { data: existingProfile, error: checkError } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .single();

    if (checkError && checkError.code !== 'PGRST116') { // PGRST116 = no rows found
      console.error('Error checking existing profile:', checkError);
      throw checkError;
    }

    if (existingProfile) {
      // Profile already exists, return it
      const { data: profile, error: fetchError } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
        
      if (fetchError) throw fetchError;
      
      return res.json({ 
        success: true, 
        profile,
        message: 'Profile already exists' 
      });
    }

    const explorerTier = UsageBasedPricingService.tiers.explorer;
    const defaultResetDate = new Date(Date.now() + explorerTier.resetPeriod).toISOString();

    // Sanitize inputs before writing to the database
    const profileData = {
      id:                userId,
      email:             email.trim().toLowerCase().slice(0, 254),
      full_name:         fullName ? fullName.trim().slice(0, 100) : null,
      monthly_usage:     { analyses: 0 },
      subscription_tier: 'explorer',
      tier_expires_at:   defaultResetDate,
      usage_data:        {},
      usage_reset_at:    new Date().toISOString(),
      created_at:        new Date().toISOString(),
      updated_at:        new Date().toISOString()
    };

    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .insert([profileData])
      .select()
      .single();
    
    if (error) {
      console.error('Profile creation error details:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
        profileData
      });
      
      // Handle specific PostgreSQL errors
      if (error.code === '23505') { // Unique violation
        return res.status(409).json({ 
          error: 'Profile already exists for this user',
          code: 'PROFILE_EXISTS'
        });
      }
      
      if (error.code === '23502') { // Not null violation  
        return res.status(400).json({ 
          error: 'Missing required profile data',
          code: 'MISSING_DATA',
          details: error.message
        });
      }
      
      if (error.code === '23514') { // Check constraint violation
        return res.status(400).json({ 
          error: 'Invalid profile data format',
          code: 'INVALID_DATA',
          details: error.message
        });
      }
      
      throw error;
    }
    
    console.log(`✅ Profile created successfully for user: ${userId}`);
    res.json({ 
      success: true, 
      profile,
      message: 'Profile created successfully'
    });
    
  } catch (error) {
    console.error('Profile creation error:', error);
    
    // Return appropriate error response
    if (error.message.includes('duplicate key')) {
      return res.status(409).json({ 
        error: 'Profile already exists for this user',
        code: 'PROFILE_EXISTS'
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to create profile',
      code: 'INTERNAL_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get current usage
router.get('/usage', authenticateUser, async (req, res) => {
  try {
    const stats = await UsageBasedPricingService.getUsageStatistics(req.user.id);
    res.json(stats);
  } catch (error) {
    console.error('Usage fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch usage' });
  }
});

// Get analysis history  
router.get('/history', authenticateUser, async (req, res) => {
  try {
    // Cap limit to prevent database abuse
    const limit  = Math.min(Math.max(parseInt(req.query.limit)  || 20, 1), 100);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    
    const { data, error } = await supabaseAdmin
      .from('video_analyses')
      .select(`
        id,
        title,
        description,
        virality_score,
        best_platform,
        platform_scores,
        created_at,
        processing_status,
        language
      `)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);
    
    if (error) throw error;
    
    res.json({
      analyses: data || [],
      total: data ? data.length : 0,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('History fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// Get user profile (optional endpoint for debugging)
router.get('/profile', authenticateUser, async (req, res) => {
  try {
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', req.user.id)
      .single();
      
    if (error) throw error;
    
    res.json({ profile });
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Update user profile
router.patch('/profile', authenticateUser, async (req, res) => {
  try {
    const { full_name } = req.body;
    const userId = req.user.id;
    
    const updateData = {
      updated_at: new Date().toISOString()
    };
    
    if (full_name !== undefined) {
      updateData.full_name = full_name ? full_name.trim() : null;
    }
    
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .update(updateData)
      .eq('id', userId)
      .select()
      .single();
      
    if (error) throw error;
    
    res.json({ 
      success: true, 
      profile,
      message: 'Profile updated successfully' 
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Delete account — permanent, GDPR right to erasure
// Order: GCS files → DB rows → Supabase Auth user (token invalidated last)
router.delete('/account', authenticateUser, async (req, res) => {
  const userId = req.user.id;
  console.log(`[auth] DELETE account requested for user: ${userId}`);

  try {
    // 1. Delete GCS files (raw + proxy)
    const bucket = storageConfig.bucket;
    if (bucket) {
      for (const prefix of [`raw/${userId}/`, `proxies/${userId}/`]) {
        try {
          const [files] = await bucket.getFiles({ prefix });
          await Promise.all(files.map(f => f.delete().catch(() => {})));
          console.log(`[auth] Deleted ${files.length} GCS files under ${prefix}`);
        } catch (gcsErr) {
          // Non-fatal — proceed with DB + auth deletion even if GCS fails
          console.warn(`[auth] GCS deletion failed for ${prefix}: ${gcsErr.message}`);
        }
      }
    }

    // 2. Delete DB rows (non-fatal individually)
    await supabaseAdmin.from('video_analyses').delete().eq('user_id', userId);
    await supabaseAdmin.from('profiles').delete().eq('id', userId);

    // 3. Delete from Supabase Auth last (invalidates the token used for this request)
    const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (authErr) throw authErr;

    console.log(`[auth] Account fully deleted for user: ${userId}`);
    res.json({ success: true });

  } catch (err) {
    console.error('[auth] Account deletion error:', err);
    res.status(500).json({ error: 'Account deletion failed. Please contact support.' });
  }
});

module.exports = router;