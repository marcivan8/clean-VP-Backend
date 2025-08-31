const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { authenticateUser } = require('../middleware/auth');
const User = require('../models/User');
const router = express.Router();

// Create user profile after signup
router.post('/profile', async (req, res) => {
  try {
    const { userId, email, fullName } = req.body;
    
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .insert({
        id: userId,
        email: email,
        full_name: fullName || null,
        monthly_usage: { analyses: 0 },
        usage_reset_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({ success: true, profile });
  } catch (error) {
    console.error('Profile creation error:', error);
    res.status(500).json({ error: 'Failed to create profile' });
  }
});

// Get current usage (NEW ENDPOINT)
router.get('/usage', authenticateUser, async (req, res) => {
  try {
    const usage = await User.getUsage(req.user.id);
    res.json(usage);
  } catch (error) {
    console.error('Usage fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch usage' });
  }
});

// Get analysis history
router.get('/history', authenticateUser, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('video_analyses')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(20);
    
    if (error) throw error;
    
    res.json(data);
  } catch (error) {
    console.error('History fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

module.exports = router;