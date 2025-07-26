function analyzeVideo({ title, description, transcript }) {
  const insights = [];

  const wordCount = transcript.split(' ').length;

  // Analyse de la longueur
  if (wordCount < 100) {
    insights.push("Essayez d’ajouter plus de contenu pour améliorer l'engagement.");
  } else if (wordCount > 300) {
    insights.push("La vidéo semble longue — pensez à garder l’attention de l’audience.");
  }

  // Vérification d’un appel à l’action (CTA)
  const hasCTA = /(abonnez|like|comment|follow|clique|share|regarde jusqu’à la fin)/i.test(transcript);
  if (!hasCTA) {
    insights.push("Ajoutez un appel à l'action pour encourager l'engagement.");
  }

  // Déduction de la meilleure plateforme
  let platform = "TikTok";
  if (wordCount > 200) platform = "YouTube Shorts";
  if (
    title.toLowerCase().includes("business") ||
    description.toLowerCase().includes("linkedin")
  ) {
    platform = "LinkedIn";
  }

  // Calcul d’un score de viralité simple
  let score = 50;
  if (hasCTA) score += 20;
  if (wordCount >= 100 && wordCount <= 300) score += 30;

  return {
    platformSuggestion: platform,
    viralityScore: score,
    insights,
  };
}

module.exports = { analyzeVideo };
