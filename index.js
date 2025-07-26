const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const analyzeRoutes = require('./routes/analyzeRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Servir les fichiers uploadés (optionnel)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Route pour l’analyse vidéo
app.use('/api/analyze', analyzeRoutes);

// Route test de base
app.get('/', (req, res) => {
  res.send('✅ Backend is up and running.');
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
