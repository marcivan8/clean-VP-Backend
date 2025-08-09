// utils/videoAnalyzer.js
// Simple but real scoring using title/description/transcript
function analyzeVideo({ title = "", description = "", transcript = "" }) {
  const insights = [];
  const text = `${title} ${description} ${transcript}`.toLowerCase();
  const words = (transcript || "").trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  // CTA detection
  const hasCTA = /(abonnez|like|comment|follow|clique|share|retweet|regarde|subscribe)/i.test(text);

  // Emotional words (small list, extendable)
  const emotionalWords = ["incroyable", "urgent", "secret", "nouveau", "choc", "révélé", "émotion"];
  const emotionalCount = emotionalWords.reduce((acc, w) => acc + (text.includes(w) ? 1 : 0), 0);

  // Keywords for platforms
  const isBusiness = /(business|linkedin|management|b2b|entreprise|stratégie)/i.test(text);
  const isTrending = /(tendance|viral|trend|challenge|meme|funny|dance)/i.test(text);
  const isNews = /(news|breaking|actualité|breaking news|update)/i.test(text);

  // platform profiles (very simple weights)
  const platforms = {
    TikTok: { min: 20, max: 250, base: 40, trendBoost: isTrending ? 20 : 0 },
    InstagramReels: { min: 30, max: 250, base: 35, trendBoost: isTrending ? 15 : 0 },
    YouTubeShorts: { min: 60, max: 600, base: 30, trendBoost: 0 },
    X: { min: 5, max: 120, base: 25, trendBoost: isTrending ? 10 : 0, newsBoost: isNews ? 15 : 0 },
    LinkedIn: { min: 80, max: 1000, base: 10, businessBoost: isBusiness ? 30 : 0 },
  };

  const platformScores = {};
  Object.entries(platforms).forEach(([name, cfg]) => {
    let score = cfg.base;

    // length contribution (transcript-based)
    if (wordCount >= cfg.min && wordCount <= cfg.max) {
      score += 30;
    } else if (wordCount > 0) {
      // partial points if not ideal but not empty
      score += Math.max(0, 10 - Math.abs(wordCount - ((cfg.min + cfg.max) / 2)) / 50);
    }

    // CTA adds points
    if (hasCTA) score += 20;

    // Emotional words add up to 10 pts
    score += Math.min(emotionalCount * 5, 10);

    // platform-specific boosts
    if (cfg.trendBoost) score += cfg.trendBoost;
    if (cfg.newsBoost) score += cfg.newsBoost;
    if (cfg.businessBoost) score += cfg.businessBoost || 0;

    platformScores[name] = Math.min(100, Math.round(score));
  });

  // choose best platform
  const sorted = Object.entries(platformScores).sort((a, b) => b[1] - a[1]);
  const bestPlatform = sorted[0] ? sorted[0][0] : "Unknown";
  const viralityScore = sorted[0] ? sorted[0][1] : 0;

  // improvement suggestions
  if (!hasCTA) insights.push("Ajoutez un appel à l'action (ex: 'like', 'abonnez-vous') pour augmenter l'engagement.");
  if (wordCount < 30 && !transcript) insights.push("La transcription est vide — l'audio n'a pas pu être extrait ou transcrit.");
  if (wordCount < 50) insights.push("Le contenu est court — développez un peu pour donner plus de valeur.");
  if (emotionalCount === 0) insights.push("Essayez d'utiliser un ou deux mots émotionnels pour créer de l'impact.");
  if (isBusiness) insights.push("Ciblez LinkedIn en ajoutant des éléments professionnels (chiffres, conseils).");

  return {
    bestPlatform,
    viralityScore,
    platformScores,
    insights,
  };
}

module.exports = { analyzeVideo };
