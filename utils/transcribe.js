const fs = require('fs');
const { OpenAI } = require('openai');

const apiKey = process.env.OPENAI_API_KEY;

// Check if API key is loaded correctly
if (!apiKey || apiKey.startsWith('=')) {
  console.error('❌ Clé API invalide ou non définie. Vérifiez votre fichier .env');
  throw new Error('Invalid or missing OpenAI API key');
}

const openai = new OpenAI({
  apiKey: apiKey,
});

async function transcribeAudio(filePath) {
  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: 'whisper-1',
    });

    return transcription.text;
  } catch (error) {
    console.error('❌ Erreur transcription détaillée :', error?.response?.data || error.message);
    throw new Error('Transcription failed');
  }
}

module.exports = { transcribeAudio };
