const fs = require('fs');
const { OpenAI } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function transcribeAudio(audioPath) {
  const audioStream = fs.createReadStream(audioPath);
  const transcription = await openai.audio.transcriptions.create({
    model: "whisper-1",
    file: audioStream
  });

  return transcription.text;
}

module.exports = transcribeAudio;
