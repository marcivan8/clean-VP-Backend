const express = require('express');
const PaymentService = require('../services/PaymentService');
const crypto = require('crypto');
const router = express.Router();

// Middleware de vérification signature Paddle
const verifyPaddleSignature = (req, res, next) => {
  const signature = req.headers['paddle-signature'];
  const rawBody = JSON.stringify(req.body);
  
  // Vérification signature (optionnel pour MVP)
  // const expectedSignature = crypto.createHmac('sha256', process.env.PADDLE_WEBHOOK_SECRET)
  //   .update(rawBody).digest('hex');
  
  // if (signature !== expectedSignature) {
  //   return res.status(401).json({ error: 'Invalid signature' });
  // }
  
  next();
};

router.post('/paddle', verifyPaddleSignature, async (req, res) => {
  try {
    const { alert_name: eventType, ...eventData } = req.body;
    
    await PaymentService.handleWebhook(eventType, eventData);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Paddle webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;