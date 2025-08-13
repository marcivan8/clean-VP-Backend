const express = require('express');
const { supabaseAdmin } = require('../config/database');
const authenticateUser = require('../middleware/auth'); // Assuming authenticateUser is in a separate file
const router = express.Router();

// Créer le profil utilisateur après inscription
router.post('/profile', async (req, res) => {
  try {
    const { userId, email, fullName } = req.body;
    
    const { data: profile, error } = await supabaseAdmin
      .from('profiles') // Assuming table name is 'profiles'; adjust if different
      .insert({
        id: userId,
        email: email,
        full_name: fullName || null,
        subscription_tier: 'free'
      })
      .select()
      .single();
    
    if (error) {
      throw error;
    }
    
    res.json({ success: true, profile });
  } catch (error) {
    console.error('Profile creation error:', error);
    res.status(500).json({ error: 'Failed to create profile' });
  }
});

// Example route with authentication (stub; complete the handler as needed)
router.get('/analyze/history', authenticateUser, async (req, res) => {
  try {
    // Add your history logic here, e.g., fetch from Supabase
    const { data, error } = await supabaseAdmin
      .from('analysis_history') // Assuming table name; adjust accordingly
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