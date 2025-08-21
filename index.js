// server.js - Enhanced debugging version
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;

// Enhanced CORS Configuration - Allow everything for debugging
app.use(cors({
  origin: true, // Allow all origins for debugging
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['Content-Length', 'Content-Type'],
  maxAge: 86400
}));

// Handle preflight requests
app.options('*', cors());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware - DETAILED
app.use((req, res, next) => {
  console.log(`\n📨 ${new Date().toISOString()}`);
  console.log(`   Method: ${req.method}`);
  console.log(`   Path: ${req.path}`);
  console.log(`   Origin: ${req.headers.origin || 'No origin'}`);
  console.log(`   Auth: ${req.headers.authorization ? 'Present' : 'Missing'}`);
  
  if (req.method === 'POST' && req.path.includes('/analyze')) {
    console.log(`   Content-Type: ${req.headers['content-type']}`);
    console.log(`   Body Keys: ${Object.keys(req.body).join(', ') || 'No body'}`);
    if (req.file) {
      console.log(`   File: ${req.file.originalname} (${req.file.size} bytes)`);
    }
  }
  
  // Log response
  const originalSend = res.send;
  res.send = function(data) {
    console.log(`   Response Status: ${res.statusCode}`);
    originalSend.call(this, data);
  };
  
  next();
});

// Static files for uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Import routes
let authRoutes, analyzeRoutes, subscriptionRoutes, webhookRoutes;

try {
  authRoutes = require('./routes/auth');
  console.log('✅ Auth routes loaded');
} catch (e) {
  console.error('❌ Failed to load auth routes:', e.message);
  authRoutes = express.Router();
}

try {
  analyzeRoutes = require('./routes/analyzeRoutes');
  console.log('✅ Analyze routes loaded');
} catch (e) {
  console.error('❌ Failed to load analyze routes:', e.message);
  analyzeRoutes = express.Router();
}

try {
  subscriptionRoutes = require('./routes/subscription');
  console.log('✅ Subscription routes loaded');
} catch (e) {
  console.error('❌ Failed to load subscription routes:', e.message);
  subscriptionRoutes = express.Router();
}

try {
  webhookRoutes = require('./routes/webhooks');
  console.log('✅ Webhook routes loaded');
} catch (e) {
  console.error('❌ Failed to load webhook routes:', e.message);
  webhookRoutes = express.Router();
}

// Health check endpoint
app.get('/health', (req, res) => {
  console.log('✅ Health check requested');
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    port: port,
    version: '1.0.0'
  });
});

// Test endpoint for analyze
app.get('/api/analyze/test', (req, res) => {
  console.log('✅ Analyze test endpoint hit');
  res.json({ 
    message: 'Analyze endpoint is reachable',
    timestamp: new Date().toISOString()
  });
});

// Mount API routes
app.use('/api/auth', authRoutes);
app.use('/api/analyze', analyzeRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/webhooks', webhookRoutes);

// API documentation endpoint
app.get('/api', (req, res) => {
  res.json({
    message: 'Viral Pilot API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: 'GET /health',
      test: 'GET /api/analyze/test',
      analyze: 'POST /api/analyze',
      auth: 'POST /api/auth/profile'
    }
  });
});

// 404 handler
app.use((req, res) => {
  console.log(`❌ 404 - Route not found: ${req.method} ${req.path}`);
  res.status(404).json({ 
    error: 'Route not found',
    path: req.path,
    method: req.method,
    available_endpoints: [
      'GET /health',
      'GET /api',
      'GET /api/analyze/test',
      'POST /api/analyze',
      'POST /api/auth/profile'
    ]
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('💥 Global error:', err);
  res.status(err.status || 500).json({ 
    error: err.message || 'Internal server error',
    type: err.name,
    ...(process.env.NODE_ENV === 'development' && { 
      stack: err.stack
    })
  });
});

// Start server
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════════╗
║                                               ║
║         🚀 Viral Pilot Backend Server         ║
║                                               ║
╠═══════════════════════════════════════════════╣
║  Status:     Running                          ║
║  Port:       ${port}                            ║
║  Mode:       ${process.env.NODE_ENV || 'development'}                   ║
║  Base URL:   http://localhost:${port}           ║
║  API URL:    http://localhost:${port}/api        ║
║  Health:     http://localhost:${port}/health     ║
╚═══════════════════════════════════════════════╝

Test the connection:
  curl http://localhost:${port}/health
  curl http://localhost:${port}/api/analyze/test
  `);
});

module.exports = app;