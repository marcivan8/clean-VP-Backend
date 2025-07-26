function analyzeVideo({ title, description, transcript }) {
  const insights = [];
  const wordCount = transcript.split(' ').length;
  const lowerTranscript = transcript.toLowerCase();
  const lowerTitle = title.toLowerCase();
  const lowerDescription = description.toLowerCase();

  // 1. Analyse de la longueur
  if (wordCount < 100) {
    insights.push("Essayez d’ajouter plus de contenu pour améliorer l'engagement.");
  } else if (wordCount > 300) {
    insights.push("La vidéo semble longue — pensez à maintenir l’attention de l’audience.");
  } else {
    insights.push("Bonne longueur pour capter l’attention.");
  }

  // 2. Vérification d’un appel à l’action (CTA)
  const hasCTA = /(abonnez|like|comment|follow|clique|partage|share|regarde jusqu’à la fin|découvre|swipe)/i.test(lowerTranscript);
  if (!hasCTA) {
    insights.push("Ajoutez un appel à l'action pour encourager l'engagement.");
  } else {
    insights.push("Présence d’un appel à l’action détectée ✅");
  }

  // 3. Thématique/plateforme
  let platform = "TikTok";
  if (wordCount > 200) platform = "YouTube Shorts";

  if (lowerTitle.includes("business") || lowerDescription.includes("linkedin") || lowerTranscript.includes("réseau")) {
    platform = "LinkedIn";
  } else if (lowerTitle.includes("startup") || lowerDescription.includes("founder") || lowerTranscript.includes("entrepreneur")) {
    platform = "X (Twitter)";
  } else if (lowerTranscript.includes("musique") || lowerTranscript.includes("mode")) {
    platform = "Instagram Reels";
  }

  // 4. Score de viralité
  let score = 40;

  if (hasCTA) score += 20;
  if (wordCount >= 100 && wordCount <= 300) score += 30;
  if (platform === "TikTok") score += 5;
  if (platform === "Instagram Reels") score += 5;

  if (score > 100) score = 100;

  return {
    viralityScore: score,
    platformSuggestion: platform,
    insights,
    wordCount,
  };
}

module.exports = { analyzeVideo };
