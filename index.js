// ===== index.js (or server.js) - SIMPLIFIED VERSION =====
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Simple CORS Configuration - Allow everything for now
app.use(cors({
  origin: true, // Allow all origins
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

// Request logging middleware
app.use((req, res, next) => {
  console.log(`📨 ${new Date().toISOString()} - ${req.method} ${req.path}`);
  if (req.headers.authorization) {
    console.log('   Auth: Present');
  }
  next();
});

// Static files for uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Import routes - ONLY auth and analyze (no payment routes)
let authRoutes, analyzeRoutes;

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

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    port: port,
    version: '2.0.0' // Updated version
  });
});

// Test endpoint for analyze
app.get('/api/analyze/test', (req, res) => {
  res.json({ 
    message: 'Analyze endpoint is reachable',
    timestamp: new Date().toISOString()
  });
});

// Mount API routes (NO subscription or webhook routes)
app.use('/api/auth', authRoutes);
app.use('/api/analyze', analyzeRoutes);

// API documentation endpoint
app.get('/api', (req, res) => {
  res.json({
    message: 'Viral Pilot API v2',
    version: '2.0.0',
    status: 'running',
    endpoints: {
      health: 'GET /health',
      test: 'GET /api/analyze/test',
      analyze: 'POST /api/analyze',
      auth: 'POST /api/auth/profile',
      usage: 'GET /api/auth/usage'
    }
  });
});

// 404 handler
app.use((req, res) => {
  console.log(`❌ 404 - Route not found: ${req.method} ${req.path}`);
  res.status(404).json({ 
    error: 'Route not found',
    path: req.path,
    method: req.method
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('💥 Error:', err.message);
  res.status(err.status || 500).json({ 
    error: err.message || 'Internal server error'
  });
});

// Start server
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════════╗
║                                               ║
║      🚀 Viral Pilot Backend Server v2.0      ║
║           (Simplified - No Payments)          ║
║                                               ║
╠═══════════════════════════════════════════════╣
║  Status:     Running                          ║
║  Port:       ${port}                            ║
║  Mode:       ${process.env.NODE_ENV || 'development'}                   ║
║  API URL:    http://localhost:${port}/api        ║
║  Health:     http://localhost:${port}/health     ║
╚═══════════════════════════════════════════════╝
  `);
});

module.exports = app;