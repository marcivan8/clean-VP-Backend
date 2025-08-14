const { Paddle, Environment } = require('@paddle/paddle-node-sdk');

const paddleInstance = new Paddle(process.env.PADDLE_API_KEY, {
  environment: process.env.PADDLE_ENVIRONMENT === 'sandbox' ? Environment.sandbox : Environment.production,
});

const PRICING_PLANS = {
  pro: {
    id: process.env.PADDLE_PRO_PLAN_ID,
    price: 29,
    name: 'Pro Creator',
    limits: {
      monthly_analyses: 30,
      long_form: 1,
      platforms: 'all'
    }
  },
  premium: {
    id: process.env.PADDLE_PREMIUM_PLAN_ID, 
    price: 79,
    name: 'Premium Studio',
    limits: {
      monthly_analyses: 'unlimited',
      long_form: 5,
      platforms: 'all'
    }
  }
};

module.exports = { paddleInstance, PRICING_PLANS };