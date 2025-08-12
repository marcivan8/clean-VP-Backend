const express = require('express');
const { authenticateUser } = require('../middleware/auth');
const PaymentService = require('../services/PaymentService');
const User = require('../models/User');
const router = express.Router();

// Créer checkout URL pour Paddle
router.post('/checkout', authenticateUser, async (req, res) => {
  try {
    const { plan } = req.body; // 'pro' ou 'premium'
    const checkoutUrl = await PaymentService.createCheckoutUrl(req.user.id, plan);
    
    res.json({ checkout_url: checkoutUrl });
  } catch (error) {
    console.error('Checkout error:', error);
    res.status(500).json({ error: 'Failed to create checkout' });
  }
});

// Statut de l'abonnement
router.get('/status', authenticateUser, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const usageCheck = await User.checkUsageLimits(req.user.id);
    
    res.json({
      subscription: {
        tier: user.subscription_tier,
        status: user.subscription_status,
        paddle_subscription_id: user.paddle_subscription_id
      },
      usage: usageCheck
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get subscription status' });
  }
});

module.exports = router;