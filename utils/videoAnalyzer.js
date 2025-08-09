// utils/videoAnalyzer.js
function analyzeVideo({ title, description, transcript }) {
  const text = transcript.toLowerCase();
  const wordCount = transcript.split(/\s+/).length;

  const firstWords = transcript.split(/\s+/).slice(0, 10).join(" ");
  const hasHook = /(imagine|saviez-vous|breaking|attention|incroyable|vous ne croirez pas|breaking news|alert)/i.test(firstWords);
  const hasCTA = /(abonnez|like|comment|follow|clique|share|retweet|regarde jusqu’à la fin)/i.test(text);

  const emotionalWords = ["incroyable", "puissant", "urgent", "secret", "nouveau", "choc", "révélé"];
  const emotionalCount = emotionalWords.filter(word => text.includes(word)).length;

  const businessKeywords = /(business|linkedin|management|b2b|entreprise|stratégie)/i.test(text);
  const trendingKeywords = /(tendance|viral|trend|nouveau challenge|challenge)/i.test(text);

  const platforms = {
    TikTok: { lengthRange: [30, 180], hookWeight: 0.3, ctaWeight: 0.3, emotionWeight: 0.3, keywordBoost: trendingKeywords ? 5 : 0 },
    InstagramReels: { lengthRange: [30, 180], hookWeight: 0.25, ctaWeight: 0.3, emotionWeight: 0.35, keywordBoost: trendingKeywords ? 5 : 0 },
    YouTubeShorts: { lengthRange: [30, 300], hookWeight: 0.3, ctaWeight: 0.2, emotionWeight: 0.2, keywordBoost: 0 },
    X: { lengthRange: [10, 100], hookWeight: 0.25, ctaWeight: 0.25, emotionWeight: 0.2, keywordBoost: trendingKeywords ? 10 : 0 },
    LinkedIn: { lengthRange: [30, 500], hookWeight: 0.1, ctaWeight: 0.2, emotionWeight: 0.1, keywordBoost: businessKeywords ? 15 : 0 }
  };

  const platformScores = {};
  for (const [platform, config] of Object.entries(platforms)) {
    let score = 10; // Base score so nothing is zero
    if (wordCount >= config.lengthRange[0] && wordCount <= config.lengthRange[1]) score += 20;
    if (hasHook) score += config.hookWeight * 30;
    if (hasCTA) score += config.ctaWeight * 30;
    score += Math.min(emotionalCount * 5, config.emotionWeight * 30);
    score += config.keywordBoost;
    platformScores[platform] = Math.min(Math.round(score), 100);
  }

  const bestPlatform = Object.entries(platformScores).sort((a, b) => b[1] - a[1])[0][0];
  const insights = [];
  if (!hasHook) insights.push("Ajoutez un 'hook' fort dans les premières secondes.");
  if (!hasCTA) insights.push("Ajoutez un appel à l'action.");
  if (emotionalCount === 0) insights.push("Utilisez plus de mots émotionnels.");
  if (wordCount < 50) insights.push("Contenu trop court — développez un peu.");
  if (wordCount > 300) insights.push("Contenu long — condensez pour plus d'impact.");

  return { bestPlatform, platformScores, insights };
}

module.exports = { analyzeVideo };
