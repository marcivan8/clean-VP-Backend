function analyzeVideo({ title, description, transcript }) {
  const insights = [];
  const text = transcript.toLowerCase();
  const wordCount = transcript.split(/\s+/).length;

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

  // Platform scoring profiles
  const platforms = {
    TikTok: { lengthRange: [60, 120], hookWeight: 0.3, ctaWeight: 0.3, emotionWeight: 0.3, keywordBoost: trendingKeywords ? 5 : 0 },
    InstagramReels: { lengthRange: [80, 150], hookWeight: 0.25, ctaWeight: 0.3, emotionWeight: 0.35, keywordBoost: trendingKeywords ? 5 : 0 },
    YouTubeShorts: { lengthRange: [150, 250], hookWeight: 0.3, ctaWeight: 0.2, emotionWeight: 0.2, keywordBoost: 0 },
    X: { lengthRange: [50, 100], hookWeight: 0.25, ctaWeight: 0.25, emotionWeight: 0.2, keywordBoost: trendingKeywords ? 10 : 0 },
    LinkedIn: { lengthRange: [150, 300], hookWeight: 0.1, ctaWeight: 0.2, emotionWeight: 0.1, keywordBoost: businessKeywords ? 15 : 0 }
  };

  // Calculate scores per platform
  const platformScores = {};
  for (const [platform, cfg] of Object.entries(platforms)) {
    let score = 0;

    // Length match
    if (wordCount >= cfg.lengthRange[0] && wordCount <= cfg.lengthRange[1]) score += 30;

    // Hook score
    if (hasHook) score += cfg.hookWeight * 30;

    // CTA score
    if (hasCTA) score += cfg.ctaWeight * 30;

    // Emotion score
    score += Math.min(emotionalCount * 5, cfg.emotionWeight * 30);

    // Keyword boost
    score += cfg.keywordBoost;

    platformScores[platform] = Math.min(Math.round(score), 100);
  }

  // Sort platforms by score
  const sortedPlatforms = Object.entries(platformScores)
    .sort((a, b) => b[1] - a[1])
    .map(([platform, score]) => ({ platform, score }));

  const bestPlatform = sortedPlatforms[0].platform;
  const topPlatforms = sortedPlatforms.slice(0, 3);

  // Insights
  if (!hasHook) insights.push("Ajoutez un 'hook' fort dans les premières secondes.");
  if (!hasCTA) insights.push("Ajoutez un appel à l'action.");
  if (emotionalCount === 0) insights.push("Utilisez plus de mots émotionnels.");
  if (wordCount < 50) insights.push("Contenu trop court — développez un peu.");
  if (wordCount > 300) insights.push("Contenu long — condensez pour plus d'impact.");

  return {
    bestPlatform,
    topPlatforms,
    platformScores,
    insights
  };
}

module.exports = { analyzeVideo };
