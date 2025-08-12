const express = require('express');
const { supabaseAdmin } = require('../config/database');
const User = require('../models/User');
const router = express.Router();

// Créer le profil utilisateur après inscription
router.post('/profile', async (req, res) => {
  try {
    const { userId, email, fullName } = req.body;
    
    const profile = await User.create({
      id: userId,
      email: email,
      full_name: fullName || null,
      subscription_tier: 'free'
    });
    
    res.json({ success: true, profile });
  } catch (error) {
    console.error('Profile creation error:', error);
    res.status(500).json({ error: 'Failed to create profile' });
  }
});

module.exports = router;