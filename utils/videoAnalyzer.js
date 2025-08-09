function analyzeVideo({ title, description, transcript }) {
  const insights = [];
  const text = transcript.toLowerCase();
  const wordCount = transcript.trim().split(/\s+/).length;

  // Hook detection (first 10 words)
  const firstWords = transcript.split(/\s+/).slice(0, 10).join(" ");
  const hasHook = /(imagine|saviez-vous|breaking|attention|incroyable|vous ne croirez pas|breaking news|alert)/i.test(firstWords);

  // Emotional words detection
  const emotionalWords = ["incroyable", "puissant", "urgent", "secret", "nouveau", "choc", "révélé"];
  const emotionalCount = emotionalWords.filter(word => text.includes(word)).length;

  // Call to action detection
  const hasCTA = /(abonnez|like|comment|follow|clique|share|retweet|regarde jusqu’à la fin)/i.test(text);

  // Keyword analysis for tone
  const businessKeywords = /(business|linkedin|management|b2b|entreprise|stratégie)/i.test(text);
  const trendingKeywords = /(tendance|viral|trend|nouveau challenge|challenge)/i.test(text);

  // Platform profiles with simple scoring weights
  const platforms = {
    TikTok: {
      lengthRange: [60, 120],
      hookWeight: 0.3,
      ctaWeight: 0.3,
      emotionWeight: 0.3,
      keywordBoost: trendingKeywords ? 5 : 0,
    },
    InstagramReels: {
      lengthRange: [80, 150],
      hookWeight: 0.25,
      ctaWeight: 0.3,
      emotionWeight: 0.35,
      keywordBoost: trendingKeywords ? 5 : 0,
    },
    YouTubeShorts: {
      lengthRange: [150, 250],
      hookWeight: 0.3,
      ctaWeight: 0.2,
      emotionWeight: 0.2,
      keywordBoost: 0,
    },
    X: {
      lengthRange: [50, 100],
      hookWeight: 0.25,
      ctaWeight: 0.25,
      emotionWeight: 0.2,
      keywordBoost: trendingKeywords ? 10 : 0,
    },
    LinkedIn: {
      lengthRange: [150, 300],
      hookWeight: 0.1,
      ctaWeight: 0.2,
      emotionWeight: 0.1,
      keywordBoost: businessKeywords ? 15 : 0,
    },
  };

  const platformScores = {};
  for (const [platform, config] of Object.entries(platforms)) {
    let score = 0;

    // Length score
    if (wordCount >= config.lengthRange[0] && wordCount <= config.lengthRange[1]) {
      score += 30;
    }

    // Hook score
    if (hasHook) score += config.hookWeight * 30;

    // CTA score
    if (hasCTA) score += config.ctaWeight * 30;

    // Emotion score
    score += Math.min(emotionalCount * 5, config.emotionWeight * 30);

    // Keyword boost
    score += config.keywordBoost;

    platformScores[platform] = Math.min(Math.round(score), 100);
  }

  // Best platform suggestion (highest score)
  const bestPlatformEntry = Object.entries(platformScores).sort((a, b) => b[1] - a[1])[0] || ["Unknown", 0];
  const bestPlatform = bestPlatformEntry[0];

  // Insights (improvement suggestions)
  if (!hasHook) insights.push("Ajoutez un 'hook' fort dans les premières secondes.");
  if (!hasCTA) insights.push("Ajoutez un appel à l'action.");
  if (emotionalCount === 0) insights.push("Utilisez plus de mots émotionnels.");
  if (wordCount < 50) insights.push("Contenu trop court — développez un peu.");
  if (wordCount > 300) insights.push("Contenu long — condensez pour plus d'impact.");

  return {
    bestPlatform,
    platformScores,
    insights,
  };
}

module.exports = { analyzeVideo };
