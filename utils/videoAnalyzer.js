function analyzeVideo({ title, description, transcript }) {
  console.log("Analyzing video transcript...");
  const insights = [];
  const text = transcript.toLowerCase();
  const wordCount = transcript.split(/\s+/).filter(Boolean).length;

  console.log(`Word count: ${wordCount}`);

  const hasCTA = /(abonnez|like|comment|follow|clique|share|retweet|regarde jusqu’à la fin)/i.test(text);

  console.log(`Has CTA: ${hasCTA}`);

  const platforms = {
    TikTok: { minWords: 50, maxWords: 150, ctaBonus: 20 },
    InstagramReels: { minWords: 60, maxWords: 160, ctaBonus: 15 },
    YouTubeShorts: { minWords: 120, maxWords: 300, ctaBonus: 10 },
    X: { minWords: 40, maxWords: 120, ctaBonus: 10 },
    LinkedIn: { minWords: 150, maxWords: 350, ctaBonus: 25 },
  };

  console.log("Platforms:", platforms);

  const scores = {};

  for (const [platform, config] of Object.entries(platforms)) {
    let score = 0;
    if (wordCount >= config.minWords && wordCount <= config.maxWords) {
      score += 50;
    } else if (wordCount < config.minWords) {
      score += 20;
    }
    if (hasCTA) score += config.ctaBonus;
    scores[platform] = Math.min(score, 100);
  }

  console.log("Scores:", scores);

  const bestPlatform = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];

  console.log("Best platform:", bestPlatform);

  if (!hasCTA) insights.push("Ajoutez un appel à l'action pour encourager l'engagement.");
  if (wordCount < 50) insights.push("Contenu trop court — essayez d'ajouter plus d'informations.");
  if (wordCount > 300) insights.push("Contenu long — pensez à être plus concis.");

  console.log("Insights:", insights);

  return {
    bestPlatform,
    viralityScore: scores[bestPlatform],
    insights,
  };
}

module.exports = { analyzeVideo };