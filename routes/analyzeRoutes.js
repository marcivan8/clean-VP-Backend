// routes/analyzeRoutes.js
const express = require('express');
const router = express.Router();

router.get('/health/check', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

router.post('/vision', (req, res) => {
  res.status(200).json({ message: 'vision ok' });
});

router.post('/', (req, res) => {
  res.status(200).json({ message: 'analyze ok' });
});

module.exports = router;
