const path = require('path');
const fs = require('fs');
const { OpenAI } = require('openai');
const videoAnalyzer = require('../utils/videoAnalyzer');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.analyzeVideo = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const filePath = path.join(__dirname, '../uploads', req.file.filename);

    // Transcribe audio using OpenAI Whisper API
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: 'whisper-1'
    });

    // Analyze transcription + file metadata
    const analysis = videoAnalyzer.analyze({
      transcript: transcription.text,
      filename: req.file.originalname,
      duration: null // placeholder, can add with ffmpeg
    });

    res.json({ transcript: transcription.text, analysis });
  } catch (error) {
    console.error('Error analyzing video:', error);
    res.status(500).json({ error: 'Failed to analyze video' });
  }
};