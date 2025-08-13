const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { authenticateUser } = require('../middleware/auth'); // ✅ Correct import
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
        subscription_tier: 'free'
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

// Authenticated route to get analysis history
router.get('/analyze/history', authenticateUser, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('analysis_history')
      .select('*')
      .eq('user_id', req.user.id);
    
    if (error) throw error;
    
    res.json(data);
  } catch (error) {
    console.error('History fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

module.exports = router;
