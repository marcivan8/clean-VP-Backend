const { paddleInstance, PRICING_PLANS } = require('../config/paddle');
const User = require('../models/User');

class PaymentService {
  static async createCheckoutUrl(userId, planKey) {
    const plan = PRICING_PLANS[planKey];
    if (!plan) throw new Error('Plan not found');
    
    const user = await User.findById(userId);
    
    const checkoutData = {
      product_id: plan.id,
      customer_email: user.email,
      passthrough: JSON.stringify({ userId, planKey }),
      return_url: `${process.env.FRONTEND_URL}/subscription/success`,
      webhook_url: `${process.env.BACKEND_URL}/webhooks/paddle`
    };
    
    const response = await paddleInstance.generatePayLink(checkoutData);
    return response.url;
  }
  
  static async handleWebhook(eventType, eventData) {
    const { supabaseAdmin } = require('../config/database');
    
    // Enregistrer l'événement
    await supabaseAdmin.from('payment_events').insert([{
      paddle_event_type: eventType,
      paddle_subscription_id: eventData.subscription_id,
      event_data: eventData
    }]);
    
    const passthrough = JSON.parse(eventData.passthrough || '{}');
    const userId = passthrough.userId;
    
    if (!userId) return;
    
    switch (eventType) {
      case 'subscription_created':
        await User.updateSubscription(userId, {
          tier: passthrough.planKey,
          status: 'active',
          paddle_subscription_id: eventData.subscription_id
        });
        break;
        
      case 'subscription_updated':
        // Gérer les changements de plan
        break;
        
      case 'subscription_cancelled':
        await User.updateSubscription(userId, {
          status: 'cancelled'
        });
        break;
        
      case 'subscription_payment_failed':
        await User.updateSubscription(userId, {
          status: 'past_due'
        });
        break;
    }
  }
}

module.exports = PaymentService;