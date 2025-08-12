require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const StorageService = require('./services/StorageService');

const app = express();

// Middlewares
app.use(cors({
  origin: process.env.FRONTEND_URL,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/analyze', require('./routes/analyze'));
app.use('/subscription', require('./routes/subscription'));
app.use('/webhooks', require('./routes/webhooks'));

// Route de santé
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'Viral Pilot API',
    timestamp: new Date().toISOString(),
    version: '2.0.0'
  });
});

// Nettoyage automatique des vidéos expirées (tous les jours à 2h)
cron.schedule('0 2 * * *', async () => {
  try {
    const cleanedCount = await StorageService.cleanupExpiredVideos();
    console.log(`Daily cleanup: ${cleanedCount} videos removed`);
  } catch (error) {
    console.error('Daily cleanup failed:', error);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Viral Pilot API running on port ${PORT}`);
  console.log(`🗄️ Database: Supabase`);
  console.log(`☁️ Storage: Google Cloud Storage`);
  console.log(`💳 Payments: Paddle`);
});

module.exports = app;