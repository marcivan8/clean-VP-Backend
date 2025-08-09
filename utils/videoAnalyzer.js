// utils/videoAnalyzer.js - VERSION AVANCÉE
// Analyseur basé sur les vrais critères des plateformes

const PLATFORM_CRITERIA = {
  TikTok: {
    optimal: {
      duration: { min: 15, max: 60, ideal: 30 }, // secondes
      hooks: ["première seconde cruciale", "hook immédiat"],
      trends: ["challenge", "trending audio", "viral dance"],
      format: "vertical 9:16",
      engagement: ["duet potential", "comment bait"],
    },
    keywords: {
      positive: ["trending", "viral", "challenge", "fyp", "danse", "trend", "tiktoker", "pour toi", "foryou"],
      negative: ["long", "tutoriel complet", "cours", "formation", "conférence"],
      emotional: ["choc", "incroyable", "fou", "omg", "wait", "plot twist", "attention", "regarde", "tu savais"]
    },
    scoring: {
      duration_weight: 0.25,
      hook_weight: 0.30,
      trending_weight: 0.25,
      engagement_weight: 0.20
    }
  },

  Instagram: {
    optimal: {
      duration: { min: 30, max: 90, ideal: 60 },
      aesthetic: ["high quality", "visually appealing"],
      hashtags: { min: 5, max: 15, trending_boost: true },
      format: "vertical ou carré 1:1"
    },
    keywords: {
      positive: ["aesthetic", "lifestyle", "inspiration", "photo", "story", "reel", "inspo"],
      negative: ["technique", "boring", "ennuyeux"],
      lifestyle: ["outfit", "food", "travel", "fitness", "beauty", "mode", "style", "voyage"]
    },
    scoring: {
      visual_weight: 0.35,
      hashtag_weight: 0.25,
      aesthetic_weight: 0.25,
      timing_weight: 0.15
    }
  },

  YouTubeShorts: {
    optimal: {
      duration: { min: 30, max: 60, ideal: 45 },
      retention: ["hook early", "fast pace"],
      vertical: true
    },
    keywords: {
      positive: ["shorts", "quick", "rapide", "astuce", "tips", "hack"],
      negative: ["long", "detailed", "complet"],
      engaging: ["secret", "révélé", "truc", "méthode"]
    },
    scoring: {
      duration_weight: 0.30,
      engagement_weight: 0.35,
      retention_weight: 0.35
    }
  },

  YouTube: {
    optimal: {
      duration: { min: 480, max: 1200, ideal: 600 }, // 8-20 min idéal 10min
      structure: ["intro", "contenu", "conclusion", "CTA"],
      seo: ["titre optimisé", "description complète"],
      retention: ["hooks multiples", "teasing"]
    },
    keywords: {
      positive: ["tutoriel", "comment", "guide", "explication", "review", "test", "comparaison"],
      educational: ["apprendre", "formation", "cours", "tips", "astuce", "méthode"],
      entertainment: ["reaction", "vlog", "gaming", "unboxing"]
    },
    scoring: {
      duration_weight: 0.20,
      content_quality_weight: 0.30,
      seo_weight: 0.25,
      retention_weight: 0.25
    }
  },

  LinkedIn: {
    optimal: {
      duration: { min: 30, max: 180, ideal: 90 },
      professional: true,
      value: ["insights", "expertise", "business"],
      format: "landscape ou carré"
    },
    keywords: {
      positive: ["business", "leadership", "strategy", "tips", "insights", "professional", "entreprise", "équipe"],
      negative: ["personnel", "dance", "meme", "viral", "fun"],
      business: ["ROI", "growth", "team", "success", "innovation", "management", "carrière", "résultats"]
    },
    scoring: {
      professionalism_weight: 0.40,
      value_weight: 0.30,
      networking_weight: 0.20,
      format_weight: 0.10
    }
  },

  X: {
    optimal: {
      duration: { min: 10, max: 60, ideal: 30 },
      realtime: true,
      trending: ["breaking news", "hot takes"],
      format: "carré ou landscape"
    },
    keywords: {
      positive: ["breaking", "news", "update", "trending", "thread", "actualité", "info"],
      negative: ["long form", "educational", "tutoriel"],
      viral: ["controversy", "opinion", "debate", "polémique", "avis"]
    },
    scoring: {
      timeliness_weight: 0.35,
      engagement_weight: 0.30,
      brevity_weight: 0.20,
      trending_weight: 0.15
    }
  }
};

function analyzeVideo({ title = "", description = "", transcript = "", metadata = {} }) {
  const text = `${title} ${description} ${transcript}`.toLowerCase();
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  
  // Estimation durée (approximative: 150 mots/minute pour parole normale)
  const estimatedDuration = Math.max(30, Math.round(wordCount / 2.5)); // secondes

  console.log(`📊 Analyse avancée - Mots: ${wordCount}, Durée estimée: ${estimatedDuration}s`);

  const platformScores = {};
  const detailedAnalysis = {};

  Object.entries(PLATFORM_CRITERIA).forEach(([platform, criteria]) => {
    const analysis = analyzeForPlatform(platform, criteria, {
      text,
      wordCount,
      estimatedDuration,
      title,
      description,
      transcript
    });
    
    platformScores[platform] = analysis.score;
    detailedAnalysis[platform] = analysis.details;
  });

  // Meilleure plateforme
  const sortedPlatforms = Object.entries(platformScores)
    .sort(([,a], [,b]) => b - a);
  
  const bestPlatform = sortedPlatforms[0]?.[0] || "Unknown";
  const viralityScore = sortedPlatforms[0]?.[1] || 0;

  // Suggestions personnalisées et intelligentes
  const insights = generateAdvancedInsights(
    bestPlatform, 
    detailedAnalysis[bestPlatform], 
    { text, wordCount, estimatedDuration, title, description, platformScores }
  );

  return {
    bestPlatform,
    viralityScore,
    platformScores,
    insights,
    detailedAnalysis, // Pour debug avancé
    metadata: {
      wordCount,
      estimatedDuration,
      analysisTimestamp: new Date().toISOString()
    }
  };
}

function analyzeForPlatform(platform, criteria, data) {
  const { text, wordCount, estimatedDuration, title, description, transcript } = data;
  let score = 20; // Score de base
  const details = { breakdown: {} };

  // 1. Analyse de durée (critique)
  const durationScore = calculateDurationScore(estimatedDuration, criteria.optimal.duration);
  const durationPoints = durationScore * 30; // Max 30 points
  score += durationPoints;
  details.breakdown.duration = { score: durationScore, points: durationPoints, estimated: estimatedDuration };

  // 2. Analyse de mots-clés (importante)
  const keywordScore = calculateKeywordScore(text, criteria.keywords);
  const keywordPoints = keywordScore * 25; // Max 25 points
  score += keywordPoints;
  details.breakdown.keywords = { score: keywordScore, points: keywordPoints };

  // 3. Détection CTA (engagement)
  const hasCTA = /(abonnez|like|comment|follow|clique|share|retweet|regarde|subscribe|bell)/i.test(text);
  const ctaPoints = hasCTA ? 15 : 0;
  score += ctaPoints;
  details.breakdown.cta = { hasIt: hasCTA, points: ctaPoints };

  // 4. Analyse spécifique à la plateforme
  const platformSpecific = analyzePlatformSpecifics(platform, data);
  score += platformSpecific.points;
  details.breakdown.platformSpecific = platformSpecific;

  // 5. Qualité du contenu (titre + description)
  const contentQuality = analyzeContentQuality(title, description);
  score += contentQuality.points;
  details.breakdown.contentQuality = contentQuality;

  return {
    score: Math.min(100, Math.max(0, Math.round(score))),
    details
  };
}

function calculateDurationScore(duration, optimal) {
  if (duration >= optimal.min && duration <= optimal.max) {
    // Dans la plage optimale
    const ideal = optimal.ideal || (optimal.min + optimal.max) / 2;
    const distanceFromIdeal = Math.abs(duration - ideal);
    const tolerance = (optimal.max - optimal.min) / 4;
    return Math.max(0.8, 1 - (distanceFromIdeal / tolerance) * 0.2);
  }
  
  // Hors plage - pénalité progressive
  const center = (optimal.min + optimal.max) / 2;
  const distance = Math.abs(duration - center);
  const range = optimal.max - optimal.min;
  
  return Math.max(0, 1 - (distance / range));
}

function calculateKeywordScore(text, keywords) {
  if (!keywords) return 0.5;

  let score = 0.4; // Score de base
  
  // Mots-clés positifs (boost)
  if (keywords.positive) {
    const matches = keywords.positive.filter(kw => text.includes(kw)).length;
    score += Math.min(0.4, matches * 0.08); // Max +0.4
  }
  
  // Mots-clés négatifs (malus)
  if (keywords.negative) {
    const matches = keywords.negative.filter(kw => text.includes(kw)).length;
    score -= Math.min(0.3, matches * 0.1); // Max -0.3
  }
  
  // Mots émotionnels (boost fort)
  if (keywords.emotional) {
    const matches = keywords.emotional.filter(kw => text.includes(kw)).length;
    score += Math.min(0.3, matches * 0.15); // Max +0.3
  }

  // Mots lifestyle/business selon plateforme
  if (keywords.lifestyle) {
    const matches = keywords.lifestyle.filter(kw => text.includes(kw)).length;
    score += Math.min(0.2, matches * 0.1);
  }

  if (keywords.business) {
    const matches = keywords.business.filter(kw => text.includes(kw)).length;
    score += Math.min(0.2, matches * 0.1);
  }

  return Math.max(0, Math.min(1, score));
}

function analyzePlatformSpecifics(platform, data) {
  const { text, title, transcript } = data;
  let points = 0;
  const details = {};

  switch (platform) {
    case 'TikTok':
      // Hook fort dans le titre ou début
      const hasStrongHook = /(attention|regarde|tu savais|secret|choc|wait|omg)/i.test(title);
      if (hasStrongHook) points += 15;
      details.hook = hasStrongHook;

      // Potentiel viral/trending
      const hasTrendingWords = /(challenge|trend|viral|fyp|danse|dance)/i.test(text);
      if (hasTrendingWords) points += 10;
      details.trending = hasTrendingWords;

      // Engagement bait
      const hasEngagementBait = /(commentez|dis moi|tag|partage)/i.test(text);
      if (hasEngagementBait) points += 5;
      details.engagementBait = hasEngagementBait;
      break;

    case 'Instagram':
      // Esthétique/lifestyle
      const isAesthetic = /(beautiful|aesthetic|style|mode|beauty|lifestyle)/i.test(text);
      if (isAesthetic) points += 12;
      details.aesthetic = isAesthetic;

      // Story potential
      const hasPersonalTouch = /(je|mon|ma|mes|today|aujourd'hui)/i.test(text);
      if (hasPersonalTouch) points += 8;
      details.personal = hasPersonalTouch;
      break;

    case 'YouTubeShorts':
      // Format court optimisé
      const isQuickTip = /(astuce|tips|hack|secret|méthode|truc)/i.test(text);
      if (isQuickTip) points += 15;
      details.quickTip = isQuickTip;
      break;

    case 'YouTube':
      // Structure vidéo longue
      const hasIntro = /(bonjour|salut|hello|bienvenue)/i.test(transcript.slice(0, 200));
      const hasConclusion = /(merci|conclusion|fin|à bientôt|n'hésitez pas)/i.test(transcript.slice(-300));
      const hasChapters = /(premièrement|deuxièmement|ensuite|enfin|partie)/i.test(text);
      
      if (hasIntro) points += 5;
      if (hasConclusion) points += 5;
      if (hasChapters) points += 8;
      
      details.structure = { intro: hasIntro, conclusion: hasConclusion, chapters: hasChapters };

      // Valeur éducative
      const isEducational = /(comment|pourquoi|explication|tutoriel|guide|apprendre)/i.test(text);
      if (isEducational) points += 10;
      details.educational = isEducational;
      break;

    case 'LinkedIn':
      // Ton professionnel
      const isProfessional = /(strategy|business|leadership|insights|professional|entreprise|équipe)/i.test(text);
      if (isProfessional) points += 20;
      details.professional = isProfessional;

      // Histoire personnelle pro
      const hasPersonalStory = /(expérience|vécu|parcours|carrière|j'ai appris)/i.test(text);
      if (hasPersonalStory) points += 10;
      details.personalStory = hasPersonalStory;

      // Valeur business
      const hasBusinessValue = /(roi|résultats|performance|croissance|chiffres|data)/i.test(text);
      if (hasBusinessValue) points += 8;
      details.businessValue = hasBusinessValue;
      break;

    case 'X':
      // Actualité/trending
      const isTimely = /(breaking|actualité|news|urgent|maintenant|aujourd'hui)/i.test(text);
      if (isTimely) points += 15;
      details.timely = isTimely;

      // Opinion/débat
      const hasOpinion = /(je pense|selon moi|opinion|avis|controverse|débat)/i.test(text);
      if (hasOpinion) points += 10;
      details.opinion = hasOpinion;

      // Thread potential
      const isThreadWorthy = /(thread|fil|suite|partie|1\/)/i.test(text);
      if (isThreadWorthy) points += 5;
      details.threadPotential = isThreadWorthy;
      break;
  }

  return { points: Math.min(30, points), details };
}

function analyzeContentQuality(title, description) {
  let points = 0;
  const details = {};

  // Qualité du titre
  if (title && title.length >= 10) {
    points += 5;
    details.titleLength = "good";
    
    // Titre engageant
    if (/(comment|pourquoi|secret|meilleur|top|incroyable)/i.test(title)) {
      points += 5;
      details.titleEngaging = true;
    }
  } else {
    details.titleLength = "too_short";
  }

  // Qualité de la description
  if (description && description.length >= 50) {
    points += 5;
    details.descriptionLength = "good";
    
    // Description avec valeur
    if (description.length >= 100) {
      points += 3;
      details.descriptionDetailed = true;
    }
  } else {
    details.descriptionLength = "too_short";
  }

  return { points: Math.min(15, points), details };
}

function generateAdvancedInsights(bestPlatform, analysis, data) {
  const insights = [];
  const { wordCount, estimatedDuration, title, description, platformScores } = data;

  // Insights sur la durée
  if (estimatedDuration < 30) {
    insights.push("⏱️ Vidéo très courte - parfaite pour TikTok/Instagram, mais développez pour YouTube");
  } else if (estimatedDuration > 300) {
    insights.push("⏱️ Vidéo longue - excellente pour YouTube, mais créez des extraits courts pour autres plateformes");
  }

  // Insights spécifiques à la meilleure plateforme
  const platformDetails = analysis?.details || {};
  
  switch (bestPlatform) {
    case 'TikTok':
      if (!platformDetails.hook) {
        insights.push("🎯 TikTok: Commencez par un hook ultra-fort dans les 3 premières secondes ('Tu savais que...', 'Attention !', etc.)");
      }
      if (!platformDetails.trending) {
        insights.push("📈 TikTok: Intégrez des éléments trending (challenges, sons populaires, hashtags du moment)");
      }
      if (!platformDetails.engagementBait) {
        insights.push("💬 TikTok: Ajoutez un 'comment bait' ('Dis-moi en commentaire si...', 'Tag quelqu'un qui...')");
      }
      insights.push("📱 TikTok: Format vertical 9:16 obligatoire + texte/effet visuel accrocheur");
      break;

    case 'Instagram':
      if (!platformDetails.aesthetic) {
        insights.push("📸 Instagram: Soignez l'esthétique visuelle - couleurs harmonieuses, bon éclairage, composition");
      }
      if (!platformDetails.personal) {
        insights.push("💫 Instagram: Ajoutez une touche personnelle ('Mon expérience avec...', 'Aujourd'hui j'ai...')");
      }
      insights.push("🏷️ Instagram: Utilisez 7-12 hashtags pertinents mélangés (populaires + niche)");
      if (estimatedDuration > 90) {
        insights.push("⏱️ Instagram: Coupez en carrousel de slides ou stories pour maximiser l'engagement");
      }
      break;

    case 'YouTube':
      if (!platformDetails.structure?.intro) {
        insights.push("🎬 YouTube: Ajoutez une intro claire (15-30s) qui présente la valeur de la vidéo");
      }
      if (!platformDetails.structure?.conclusion) {
        insights.push("🔚 YouTube: Terminez par un CTA fort (like, abonnement, vidéo suivante)");
      }
      if (!platformDetails.educational) {
        insights.push("📚 YouTube: Ajoutez de la valeur éducative - les gens viennent pour apprendre");
      }
      insights.push("🔍 YouTube: Optimisez titre pour SEO (mots-clés que les gens recherchent)");
      if (estimatedDuration < 300) {
        insights.push("⏰ YouTube: Développez le contenu (8-15min idéal) pour meilleure monétisation");
      }
      break;

    case 'LinkedIn':
      if (!platformDetails.professional) {
        insights.push("💼 LinkedIn: Ajoutez un angle business/professionnel clair");
      }
      if (!platformDetails.personalStory) {
        insights.push("👤 LinkedIn: Partagez votre expérience personnelle - les histoires humaines performent");
      }
      if (!platformDetails.businessValue) {
        insights.push("📊 LinkedIn: Incluez des données, métriques ou résultats concrets");
      }
      insights.push("🤝 LinkedIn: Terminez par une question pour encourager les discussions");
      break;

    case 'X':
      if (!platformDetails.timely) {
        insights.push("⚡ X: Liez votre contenu à l'actualité ou aux trends du moment");
      }
      if (!platformDetails.opinion) {
        insights.push("💭 X: Prenez position ou partagez un point de vue fort pour créer l'engagement");
      }
      if (estimatedDuration > 60) {
        insights.push("✂️ X: Coupez en thread ou créez des highlights de 30s max");
      }
      insights.push("🔥 X: Utilisez un langage direct et punchy pour couper dans le feed");
      break;
  }

  // Insights sur le contenu global
  if (!title || title.length < 10) {
    insights.push("📝 Titre trop court - développez avec mots-clés pour améliorer découvrabilité");
  }
  
  if (!description || description.length < 50) {
    insights.push("📋 Description insuffisante - ajoutez contexte, hashtags et mots-clés pertinents");
  }

  // Suggestions cross-platform
  const secondBest = Object.entries(platformScores).sort(([,a], [,b]) => b - a)[1];
  if (secondBest && secondBest[1] > 60) {
    insights.push(`🎯 Conseil bonus: Votre contenu score aussi bien sur ${secondBest[0]} (${secondBest[1]}/100) - pensez multi-plateforme !`);
  }

  return insights;
}

module.exports = { analyzeVideo };