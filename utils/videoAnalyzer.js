// utils/videoAnalyzer.js
function analyzeVideo({ title, description, transcript }) {
  // Combine all text for easier scoring
  const fullText = `${title} ${description} ${transcript}`.toLowerCase();

  // Define platform characteristics
  const platforms = {
    TikTok: { keywords: ["trend", "viral", "challenge", "short", "funny", "meme"], weight: 1.2 },
    Instagram: { keywords: ["aesthetic", "lifestyle", "fashion", "beautiful", "photo", "reel"], weight: 1.0 },
    YouTubeShorts: { keywords: ["tutorial", "how to", "guide", "explainer", "review"], weight: 1.1 },
    X: { keywords: ["opinion", "news", "update", "thread", "commentary"], weight: 0.9 },
    LinkedIn: { keywords: ["career", "business", "leadership", "professional", "networking"], weight: 0.8 },
  };

  // Score calculation
  let platformScores = {};
  Object.keys(platforms).forEach(platform => {
    const { keywords, weight } = platforms[platform];
    let score = 0;
    keywords.forEach(kw => {
      const occurrences = (fullText.match(new RegExp(`\\b${kw}\\b`, "g")) || []).length;
      score += occurrences * 10; // 10 points per keyword match
    });
    platformScores[platform] = Math.min(100, Math.round(score * weight));
  });

  // Pick best platform
  let bestPlatform = Object.keys(platformScores).reduce((a, b) =>
    platformScores[a] > platformScores[b] ? a : b
  );

  // Generate insights
  let insights = [];
  if (platformScores[bestPlatform] < 50) {
    insights.push(
      `Your content for ${bestPlatform} could be stronger — try adding more platform-specific elements.`
    );
  } else {
    insights.push(`Strong potential for ${bestPlatform}!`);
  }
  insights.push("Make the opening 3 seconds very engaging.");
  insights.push("Use captions to retain viewers.");
  insights.push("Add a strong call-to-action at the end.");

  // Return consistent object
  return {
    bestPlatform,
    viralityScore: platformScores[bestPlatform],
    platformScores,
    insights,
  };
}

module.exports = { analyzeVideo };
