function analyzeVideo({ title, description, transcript }) {
  const insights = [];
  const text = transcript.toLowerCase();
  const wordCount = transcript.trim().split(/\s+/).length;

  // Check for hook in first 10 words
  const firstWords = transcript.split(/\s+/).slice(0, 10).join(" ");
  const hasHook = /(imagine|saviez-vous|breaking|attention|incroyable|vous ne croirez pas|breaking news|alert)/i.test(firstWords);

  // Emotional words count
  const emotionalWords = ["incroyable", "puissant", "urgent", "secret", "nouveau", "choc", "révélé"];
  const emotionalCount = emotionalWords.filter(word => text.includes(word)).length;

  // Call to action check
  const hasCTA = /(abonnez|like|comment|follow|clique|share|retweet|regarde jusqu’à la fin)/i.test(text);

  // Keywords to help platform choice
  const businessKeywords = /(business|linkedin|management|b2b|entreprise|stratégie)/i.test(text);
  const trendingKeywords = /(tendance|viral|trend|challenge)/i.test(text);

  // Platform length preference (in word count)
  const platformLengthRanges = {
    TikTok: [60, 120],
    InstagramReels: [80, 150],
    YouTubeShorts: [150, 250],
    X: [50, 100],
    LinkedIn: [150, 300],
  };

  const platformScores = {};

  for (const platform in platformLengthRanges) {
    const [minLen, maxLen] = platformLengthRanges[platform];
    let score = 0;

    // Score length match (max 40 pts)
    if (wordCount >= minLen && wordCount <= maxLen) score += 40;

    // Add points for hook, CTA, emotional words (max 60 pts total)
    if (hasHook) score += 15;
    if (hasCTA) score += 20;
    score += Math.min(emotionalCount * 5, 25);

    // Boost score based on keywords
    if (platform === "LinkedIn" && businessKeywords) score += 10;
    if ((platform === "TikTok" || platform === "InstagramReels" || platform === "X") && trendingKeywords) score += 10;

    // Cap score at 100
    platformScores[platform] = Math.min(score, 100);
  }

  const bestPlatform = Object.keys(platformScores).reduce((a, b) => platformScores[a] > platformScores[b] ? a : b);

  return { bestPlatform, platformScores, insights };
}

module.exports = { analyzeVideo };