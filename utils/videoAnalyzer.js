// videoAnalyzer.js
const transcribeAudio = require('./transcribe');

async function analyzeVideo(filePath, { title, description }) {
  // 1. Transcription
  const transcript = await transcribeAudio(filePath);

  // 2. Analyse simple (tu pourras enrichir plus tard)
  const wordCount = transcript.split(' ').length;
  const hasCallToAction = /(subscribe|like|comment|follow|partage)/i.test(transcript);
  const hasQuestions = /(\?|how|why|what|comment|pourquoi|qui|où|quand)/i.test(transcript);

  // 3. Scoring basique
  let score = 50;
  if (hasCallToAction) score += 15;
  if (hasQuestions) score += 15;
  if (wordCount > 150) score += 10;

  return {
    title,
    description,
    transcript,
    wordCount,
    hasCallToAction,
    hasQuestions,
    score: Math.min(score, 100),
    platformInsights: {
      tiktok: {
        tips: hasCallToAction
          ? 'Parfait, tu encourages l’engagement.'
          : 'Ajoute un appel à l’action pour booster l’engagement.',
        optimalLength: '15–60 secondes',
      },
    },
  };
}

module.exports = analyzeVideo;
