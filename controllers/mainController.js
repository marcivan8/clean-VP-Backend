const path = require('path');
const fs = require('fs');
const { OpenAI } = require('openai');
const { analyzeVideo } = require('../utils/videoAnalyzer');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.analyzeVideo = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OpenAI API key is missing in environment variables.' });
  }

  const filePath = path.join(__dirname, '../uploads', req.file.filename);
  const mimeType = req.file.mimetype;

  // Only allow audio or video files
  if (!mimeType.startsWith('video/') && !mimeType.startsWith('audio/')) {
    // Clean uploaded file if invalid type
    fs.unlink(filePath, (err) => {
      if (err) console.warn(`Failed to delete uploaded file: ${filePath}`);
    });
    return res.status(400).json({ error: 'Only audio or video files are allowed.' });
  }

  try {
    console.log(`Analyzing file: ${req.file.originalname} (${mimeType})`);

    // Transcribe audio/video using OpenAI Whisper API
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: 'whisper-1',
    });

    const transcriptText = transcription.text;
    console.log('Transcription complete.');

    // Analyze transcription using your video analyzer
    const analysis = analyzeVideo({
      transcript: transcriptText,
      title: req.body.title || '',
      description: req.body.description || '',
    });

    // Delete uploaded file after processing
    fs.unlink(filePath, (err) => {
      if (err) console.warn(`Failed to delete uploaded file: ${filePath}`);
    });

    // Return analysis + transcription
    res.status(200).json({
      success: true,
      transcript: transcriptText,
      analysis,
    });

  } catch (error) {
    console.error('Error analyzing video:', error);

    // Attempt to clean uploaded file on error
    fs.unlink(filePath, (err) => {
      if (err) console.warn(`Failed to delete uploaded file: ${filePath}`);
    });

    res.status(500).json({ error: 'Failed to analyze video' });
  }
};
