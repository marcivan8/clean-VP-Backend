const path = require('path');
const fs = require('fs');
const { OpenAI } = require('openai');
const videoAnalyzer = require('../utils/videoAnalyzer');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.analyzeVideo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OpenAI API key is missing in the environment variables.' });
    }

    const filePath = path.join(__dirname, '../uploads', req.file.filename);
    const mimeType = req.file.mimetype;

    // Only allow audio or video files
    if (!mimeType.startsWith('video/') && !mimeType.startsWith('audio/')) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: 'Only audio or video files are allowed.' });
    }

    console.log(`Analyzing file: ${req.file.originalname} (${mimeType})`);

    // Transcribe audio using OpenAI Whisper API
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: 'whisper-1'
    });

    const transcriptText = transcription.text;
    console.log('Transcription complete.');

    // Analyze using custom analyzer
    const analysis = videoAnalyzer.analyze({
      transcript: transcriptText,
      filename: req.file.originalname,
      duration: null // You can integrate ffmpeg here later to calculate real duration
    });

    // Optionally clean up uploaded file
    fs.unlink(filePath, (err) => {
      if (err) console.warn(`Failed to delete uploaded file: ${filePath}`);
    });

    // Send back full results
    res.status(200).json({
      success: true,
      transcript: transcriptText,
      analysis
    });

  } catch (error) {
    console.error('Error analyzing video:', error);
    res.status(500).json({ error: 'Failed to analyze video' });
  }
};
