function analyzeVideo({ title, description, transcript, durationSeconds = 60 }) {
  const insights = [];
  const text = [title, description, transcript].join(" ").toLowerCase();

  // Video length categories
  const isVeryShort = durationSeconds < 30;
  const isShort = durationSeconds <= 60;
  const isMedium = durationSeconds <= 180;

  // Keywords for platforms
  const hasBusinessKeywords = /business|career|growth|linkedin/.test(text);
  const hasTrendKeywords = /dance|funny|viral|challenge/.test(text);
  const hasNewsKeywords = /news|breaking|update|trending/.test(text);

  // Platform suggestion default
  let platform = "TikTok";
  if (hasBusinessKeywords) platform = "LinkedIn";
  else if (hasNewsKeywords && isVeryShort) platform = "X (Twitter)";
  else if (hasTrendKeywords && (isShort || isVeryShort)) platform = "Instagram Reels";
  else if (isMedium) platform = "YouTube Shorts";

  // Simple scoring
  let score = 50;

  if (platform === "LinkedIn" && text.length > 200) score += 30;
  if ((platform === "TikTok" || platform === "Instagram Reels") && isShort) score += 30;
  if (platform === "X (Twitter)" && isVeryShort) score += 30;
  if (platform === "YouTube Shorts" && isMedium) score += 30;

  // Improvement suggestions
  if (score < 70) {
    insights.push("Essayez d'adapter la durée et le contenu pour mieux correspondre à la plateforme suggérée.");
  }
  if (!/(like|comment|share|follow|subscribe)/i.test(text)) {
    insights.push("Ajoutez un appel à l'action pour encourager l'engagement.");
  }

  return {
    platformSuggestion: platform,
    viralityScore: score,
    insights,
  };
}

module.exports = { analyzeVideo };

