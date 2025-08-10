// utils/videoAnalyzer.js - VERSION MULTILINGUE COMPLÈTE

// Traductions pour les insights
const INSIGHT_TRANSLATIONS = {
  en: {
    "very_short_video": "⏱️ Very short video - perfect for TikTok/Instagram, but expand for YouTube",
    "long_video": "⏱️ Long video - excellent for YouTube, but create short clips for other platforms",
    "tiktok_hook": "🎯 TikTok: Start with a strong hook in the first 3 seconds ('Did you know...', 'Attention!', etc.)",
    "tiktok_trending": "📈 TikTok: Integrate trending elements (challenges, popular sounds, trending hashtags)",
    "tiktok_engagement": "💬 TikTok: Add comment bait ('Tell me in comments if...', 'Tag someone who...')",
    "tiktok_format": "📱 TikTok: Vertical 9:16 format required + eye-catching text/visual effects",
    "instagram_aesthetic": "📸 Instagram: Polish visual aesthetics - harmonious colors, good lighting, composition",
    "instagram_personal": "💫 Instagram: Add a personal touch ('My experience with...', 'Today I...')",
    "instagram_hashtags": "🏷️ Instagram: Use 7-12 relevant hashtags (mix popular + niche)",
    "instagram_carousel": "⏱️ Instagram: Cut into carousel slides or stories to maximize engagement",
    "youtube_intro": "🎬 YouTube: Add clear intro (15-30s) presenting video value",
    "youtube_cta": "🔚 YouTube: End with strong CTA (like, subscribe, next video)",
    "youtube_educational": "📚 YouTube: Add educational value - people come to learn",
    "youtube_seo": "🔍 YouTube: Optimize title for SEO (keywords people search for)",
    "youtube_length": "⏰ YouTube: Develop content (8-15min ideal) for better monetization",
    "youtubeshorts_tips": "⚡ YouTube Shorts: Quick tips format works best with fast-paced editing",
    "linkedin_business": "💼 LinkedIn: Add clear business/professional angle",
    "linkedin_story": "👤 LinkedIn: Share personal experience - human stories perform well",
    "linkedin_data": "📊 LinkedIn: Include data, metrics or concrete results",
    "linkedin_question": "🤝 LinkedIn: End with question to encourage discussions",
    "x_timely": "⚡ X: Link content to current news or trends",
    "x_opinion": "💭 X: Take a stance or share strong viewpoint to create engagement",
    "x_thread": "✂️ X: Cut into thread or create 30s max highlights",
    "x_punchy": "🔥 X: Use direct, punchy language to cut through the feed",
    "title_short": "📝 Title too short - expand with keywords for better discoverability",
    "description_short": "📋 Insufficient description - add context, hashtags and relevant keywords",
    "multiplatform": "🎯 Bonus tip: Your content also scores well on {platform} ({score}/100) - think multi-platform!"
  },
  
  fr: {
    "very_short_video": "⏱️ Vidéo très courte - parfaite pour TikTok/Instagram, mais développez pour YouTube",
    "long_video": "⏱️ Vidéo longue - excellente pour YouTube, mais créez des extraits courts pour autres plateformes",
    "tiktok_hook": "🎯 TikTok : Commencez par un hook ultra-fort dans les 3 premières secondes ('Tu savais que...', 'Attention !', etc.)",
    "tiktok_trending": "📈 TikTok : Intégrez des éléments trending (challenges, sons populaires, hashtags du moment)",
    "tiktok_engagement": "💬 TikTok : Ajoutez un 'comment bait' ('Dis-moi en commentaire si...', 'Tag quelqu'un qui...')",
    "tiktok_format": "📱 TikTok : Format vertical 9:16 obligatoire + texte/effet visuel accrocheur",
    "instagram_aesthetic": "📸 Instagram : Soignez l'esthétique visuelle - couleurs harmonieuses, bon éclairage, composition",
    "instagram_personal": "💫 Instagram : Ajoutez une touche personnelle ('Mon expérience avec...', 'Aujourd'hui j'ai...')",
    "instagram_hashtags": "🏷️ Instagram : Utilisez 7-12 hashtags pertinents mélangés (populaires + niche)",
    "instagram_carousel": "⏱️ Instagram : Coupez en carrousel de slides ou stories pour maximiser l'engagement",
    "youtube_intro": "🎬 YouTube : Ajoutez une intro claire (15-30s) qui présente la valeur de la vidéo",
    "youtube_cta": "🔚 YouTube : Terminez par un CTA fort (like, abonnement, vidéo suivante)",
    "youtube_educational": "📚 YouTube : Ajoutez de la valeur éducative - les gens viennent pour apprendre",
    "youtube_seo": "🔍 YouTube : Optimisez titre pour SEO (mots-clés que les gens recherchent)",
    "youtube_length": "⏰ YouTube : Développez le contenu (8-15min idéal) pour meilleure monétisation",
    "youtubeshorts_tips": "⚡ YouTube Shorts : Le format conseils rapides fonctionne mieux avec du montage rythmé",
    "linkedin_business": "💼 LinkedIn : Ajoutez un angle business/professionnel clair",
    "linkedin_story": "👤 LinkedIn : Partagez votre expérience personnelle - les histoires humaines performent",
    "linkedin_data": "📊 LinkedIn : Incluez des données, métriques ou résultats concrets",
    "linkedin_question": "🤝 LinkedIn : Terminez par une question pour encourager les discussions",
    "x_timely": "⚡ X : Liez votre contenu à l'actualité ou aux trends du moment",
    "x_opinion": "💭 X : Prenez position ou partagez un point de vue fort pour créer l'engagement",
    "x_thread": "✂️ X : Coupez en thread ou créez des highlights de 30s max",
    "x_punchy": "🔥 X : Utilisez un langage direct et punchy pour couper dans le feed",
    "title_short": "📝 Titre trop court - développez avec mots-clés pour améliorer découvrabilité",
    "description_short": "📋 Description insuffisante - ajoutez contexte, hashtags et mots-clés pertinents",
    "multiplatform": "🎯 Conseil bonus : Votre contenu score aussi bien sur {platform} ({score}/100) - pensez multi-plateforme !"
  },
  
  tr: {
    "very_short_video": "⏱️ Çok kısa video - TikTok/Instagram için mükemmel, YouTube için genişletin",
    "long_video": "⏱️ Uzun video - YouTube için mükemmel, diğer platformlar için kısa klipler oluşturun",
    "tiktok_hook": "🎯 TikTok: İlk 3 saniyede güçlü bir hook ile başlayın ('Biliyor muydun...', 'Dikkat!', vb.)",
    "tiktok_trending": "📈 TikTok: Trend öğeleri entegre edin (challenge'lar, popüler sesler, trend hashtagler)",
    "tiktok_engagement": "💬 TikTok: Yorum tuzağı ekleyin ('Yorumlarda söyleyin eğer...', 'Birini etiketleyin...')",
    "tiktok_format": "📱 TikTok: Dikey 9:16 format gerekli + dikkat çekici metin/görsel efektler",
    "instagram_aesthetic": "📸 Instagram: Görsel estetiği geliştirin - uyumlu renkler, iyi aydınlatma, kompozisyon",
    "instagram_personal": "💫 Instagram: Kişisel dokunuş ekleyin ('Bu konudaki deneyimim...', 'Bugün...')",
    "instagram_hashtags": "🏷️ Instagram: 7-12 alakalı hashtag kullanın (popüler + niş karışımı)",
    "instagram_carousel": "⏱️ Instagram: Etkileşimi maksimize etmek için carousel slaytlara veya hikayelere bölün",
    "youtube_intro": "🎬 YouTube: Net intro ekleyin (15-30s) video değerini sunan",
    "youtube_cta": "🔚 YouTube: Güçlü CTA ile bitirin (beğeni, abone, sonraki video)",
    "youtube_educational": "📚 YouTube: Eğitici değer ekleyin - insanlar öğrenmek için gelir",
    "youtube_seo": "🔍 YouTube: SEO için başlığı optimize edin (insanların aradığı anahtar kelimeler)",
    "youtube_length": "⏰ YouTube: İçeriği geliştirin (8-15dk ideal) daha iyi para kazanma için",
    "youtubeshorts_tips": "⚡ YouTube Shorts: Hızlı ipuçları formatı ritmik montajla en iyi çalışır",
    "linkedin_business": "💼 LinkedIn: Net iş/profesyonel açı ekleyin",
    "linkedin_story": "👤 LinkedIn: Kişisel deneyiminizi paylaşın - insan hikayeleri iyi performans gösterir",
    "linkedin_data": "📊 LinkedIn: Veri, metrik veya somut sonuçlar dahil edin",
    "linkedin_question": "🤝 LinkedIn: Tartışmaları teşvik etmek için soru ile bitirin",
    "x_timely": "⚡ X: İçeriğinizi güncel haberler veya trendlerle bağlayın",
    "x_opinion": "💭 X: Etkileşim yaratmak için pozisyon alın veya güçlü görüş paylaşın",
    "x_thread": "✂️ X: Thread'e bölün veya maksimum 30s öne çıkanlar oluşturun",
    "x_punchy": "🔥 X: Feed'de öne çıkmak için doğrudan, etkili dil kullanın",
    "title_short": "📝 Başlık çok kısa - daha iyi keşfedilebilirlik için anahtar kelimelerle genişletin",
    "description_short": "📋 Yetersiz açıklama - bağlam, hashtag ve alakalı anahtar kelimeler ekleyin",
    "multiplatform": "🎯 Bonus ipucu: İçeriğiniz {platform} platformunda da iyi puan alıyor ({score}/100) - multi-platform düşünün!"
  }
};

// Fonction helper pour traductions
function getTranslation(key, lang = "en", replacements = {}) {
  let text = INSIGHT_TRANSLATIONS[lang]?.[key] || INSIGHT_TRANSLATIONS.en[key] || key;
  
  Object.entries(replacements).forEach(([placeholder, value]) => {
    text = text.replace(`{${placeholder}}`, value);
  });
  
  return text;
}

const PLATFORM_CRITERIA = {
  TikTok: {
    optimal: {
      duration: { min: 15, max: 60, ideal: 30 },
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
      duration: { min: 480, max: 1200, ideal: 600 },
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

function analyzeVideo({ title = "", description = "", transcript = "", language = "en", metadata = {} }) {
  const text = `${title} ${description} ${transcript}`.toLowerCase();
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  
  // Estimation durée (approximative: 150 mots/minute pour parole normale)
  const estimatedDuration = Math.max(30, Math.round(wordCount / 2.5));

  console.log(`📊 Analyse avancée - Mots: ${wordCount}, Durée estimée: ${estimatedDuration}s, Langue: ${language}`);

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

  // Suggestions personnalisées et traduites
  const insights = generateAdvancedInsights(
    bestPlatform, 
    detailedAnalysis[bestPlatform], 
    { text, wordCount, estimatedDuration, title, description, platformScores },
    language
  );

  return {
    bestPlatform,
    viralityScore,
    platformScores,
    insights,
    detailedAnalysis,
    metadata: {
      wordCount,
      estimatedDuration,
      analysisTimestamp: new Date().toISOString(),
      language
    }
  };
}

function analyzeForPlatform(platform, criteria, data) {
  const { text, wordCount, estimatedDuration, title, description, transcript } = data;
  let score = 20;
  const details = { breakdown: {} };

  // 1. Analyse de durée
  const durationScore = calculateDurationScore(estimatedDuration, criteria.optimal.duration);
  const durationPoints = durationScore * 30;
  score += durationPoints;
  details.breakdown.duration = { score: durationScore, points: durationPoints, estimated: estimatedDuration };

  // 2. Analyse de mots-clés
  const keywordScore = calculateKeywordScore(text, criteria.keywords);
  const keywordPoints = keywordScore * 25;
  score += keywordPoints;
  details.breakdown.keywords = { score: keywordScore, points: keywordPoints };

  // 3. Détection CTA
  const hasCTA = /(abonnez|like|comment|follow|clique|share|retweet|regarde|subscribe|bell)/i.test(text);
  const ctaPoints = hasCTA ? 15 : 0;
  score += ctaPoints;
  details.breakdown.cta = { hasIt: hasCTA, points: ctaPoints };

  // 4. Analyse spécifique à la plateforme
  const platformSpecific = analyzePlatformSpecifics(platform, data);
  score += platformSpecific.points;
  details.breakdown.platformSpecific = platformSpecific;

  // 5. Qualité du contenu
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
    const ideal = optimal.ideal || (optimal.min + optimal.max) / 2;
    const distanceFromIdeal = Math.abs(duration - ideal);
    const tolerance = (optimal.max - optimal.min) / 4;
    return Math.max(0.8, 1 - (distanceFromIdeal / tolerance) * 0.2);
  }
  
  const center = (optimal.min + optimal.max) / 2;
  const distance = Math.abs(duration - center);
  const range = optimal.max - optimal.min;
  
  return Math.max(0, 1 - (distance / range));
}

function calculateKeywordScore(text, keywords) {
  if (!keywords) return 0.5;

  let score = 0.4;
  
  if (keywords.positive) {
    const matches = keywords.positive.filter(kw => text.includes(kw)).length;
    score += Math.min(0.4, matches * 0.08);
  }
  
  if (keywords.negative) {
    const matches = keywords.negative.filter(kw => text.includes(kw)).length;
    score -= Math.min(0.3, matches * 0.1);
  }
  
  if (keywords.emotional) {
    const matches = keywords.emotional.filter(kw => text.includes(kw)).length;
    score += Math.min(0.3, matches * 0.15);
  }

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
      const hasStrongHook = /(attention|regarde|tu savais|secret|choc|wait|omg)/i.test(title);
      if (hasStrongHook) points += 15;
      details.hook = hasStrongHook;

      const hasTrendingWords = /(challenge|trend|viral|fyp|danse|dance)/i.test(text);
      if (hasTrendingWords) points += 10;
      details.trending = hasTrendingWords;

      const hasEngagementBait = /(commentez|dis moi|tag|partage)/i.test(text);
      if (hasEngagementBait) points += 5;
      details.engagementBait = hasEngagementBait;
      break;

    case 'Instagram':
      const isAesthetic = /(beautiful|aesthetic|style|mode|beauty|lifestyle)/i.test(text);
      if (isAesthetic) points += 12;
      details.aesthetic = isAesthetic;

      const hasPersonalTouch = /(je|mon|ma|mes|today|aujourd'hui)/i.test(text);
      if (hasPersonalTouch) points += 8;
      details.personal = hasPersonalTouch;
      break;

    case 'YouTubeShorts':
      const isQuickTip = /(astuce|tips|hack|secret|méthode|truc)/i.test(text);
      if (isQuickTip) points += 15;
      details.quickTip = isQuickTip;
      break;

    case 'YouTube':
      const hasIntro = /(bonjour|salut|hello|bienvenue)/i.test(transcript.slice(0, 200));
      const hasConclusion = /(merci|conclusion|fin|à bientôt|n'hésitez pas)/i.test(transcript.slice(-300));
      const hasChapters = /(premièrement|deuxièmement|ensuite|enfin|partie)/i.test(text);
      
      if (hasIntro) points += 5;
      if (hasConclusion) points += 5;
      if (hasChapters) points += 8;
      
      details.structure = { intro: hasIntro, conclusion: hasConclusion, chapters: hasChapters };

      const isEducational = /(comment|pourquoi|explication|tutoriel|guide|apprendre)/i.test(text);
      if (isEducational) points += 10;
      details.educational = isEducational;
      break;

    case 'LinkedIn':
      const isProfessional = /(strategy|business|leadership|insights|professional|entreprise|équipe)/i.test(text);
      if (isProfessional) points += 20;
      details.professional = isProfessional;

      const hasPersonalStory = /(expérience|vécu|parcours|carrière|j'ai appris)/i.test(text);
      if (hasPersonalStory) points += 10;
      details.personalStory = hasPersonalStory;

      const hasBusinessValue = /(roi|résultats|performance|croissance|chiffres|data)/i.test(text);
      if (hasBusinessValue) points += 8;
      details.businessValue = hasBusinessValue;
      break;

    case 'X':
      const isTimely = /(breaking|actualité|news|urgent|maintenant|aujourd'hui)/i.test(text);
      if (isTimely) points += 15;
      details.timely = isTimely;

      const hasOpinion = /(je pense|selon moi|opinion|avis|controverse|débat)/i.test(text);
      if (hasOpinion) points += 10;
      details.opinion = hasOpinion;

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

  if (title && title.length >= 10) {
    points += 5;
    details.titleLength = "good";
    
    if (/(comment|pourquoi|secret|meilleur|top|incroyable)/i.test(title)) {
      points += 5;
      details.titleEngaging = true;
    }
  } else {
    details.titleLength = "too_short";
  }

  if (description && description.length >= 50) {
    points += 5;
    details.descriptionLength = "good";
    
    if (description.length >= 100) {
      points += 3;
      details.descriptionDetailed = true;
    }
  } else {
    details.descriptionLength = "too_short";
  }

  return { points: Math.min(15, points), details };
}

function generateAdvancedInsights(bestPlatform, analysis, data, language = "en") {
  const insights = [];
  const { wordCount, estimatedDuration, title, description, platformScores } = data;

  // Insights sur la durée
  if (estimatedDuration < 30) {
    insights.push(getTranslation("very_short_video", language));
  } else if (estimatedDuration > 300) {
    insights.push(getTranslation("long_video", language));
  }

  // Insights spécifiques à la meilleure plateforme
  const platformDetails = analysis?.details || {};
  
  switch (bestPlatform) {
    case 'TikTok':
      if (!platformDetails.hook) {
        insights.push(getTranslation("tiktok_hook", language));
      }
      if (!platformDetails.trending) {
        insights.push(getTranslation("tiktok_trending", language));
      }
      if (!platformDetails.engagementBait) {
        insights.push(getTranslation("tiktok_engagement", language));
      }
      insights.push(getTranslation("tiktok_format", language));
      break;

    case 'Instagram':
      if (!platformDetails.aesthetic) {
        insights.push(getTranslation("instagram_aesthetic", language));
      }
      if (!platformDetails.personal) {
        insights.push(getTranslation("instagram_personal", language));
      }
      insights.push(getTranslation("instagram_hashtags", language));
      if (estimatedDuration > 90) {
        insights.push(getTranslation("instagram_carousel", language));
      }
      break;

    case 'YouTubeShorts':
      insights.push(getTranslation("youtubeshorts_tips", language));
      if (estimatedDuration > 60) {
        insights.push(getTranslation("very_short_video", language));
      }
      break;

    case 'YouTube':
      if (!platformDetails.structure?.intro) {
        insights.push(getTranslation("youtube_intro", language));
      }
      if (!platformDetails.structure?.conclusion) {
        insights.push(getTranslation("youtube_cta", language));
      }
      if (!platformDetails.educational) {
        insights.push(getTranslation("youtube_educational", language));
      }
      insights.push(getTranslation("youtube_seo", language));
      if (estimatedDuration < 300) {
        insights.push(getTranslation("youtube_length", language));
      }
      break;

    case 'LinkedIn':
      if (!platformDetails.professional) {
        insights.push(getTranslation("linkedin_business", language));
      }
      if (!platformDetails.personalStory) {
        insights.push(getTranslation("linkedin_story", language));
      }
      if (!platformDetails.businessValue) {
        insights.push(getTranslation("linkedin_data", language));
      }
      insights.push(getTranslation("linkedin_question", language));
      break;

    case 'X':
      if (!platformDetails.timely) {
        insights.push(getTranslation("x_timely", language));
      }
      if (!platformDetails.opinion) {
        insights.push(getTranslation("x_opinion", language));
      }
      if (estimatedDuration > 60) {
        insights.push(getTranslation("x_thread", language));
      }
      insights.push(getTranslation("x_punchy", language));
      break;
  }

  // Insights sur le contenu global
  if (!title || title.length < 10) {
    insights.push(getTranslation("title_short", language));
  }
  
  if (!description || description.length < 50) {
    insights.push(getTranslation("description_short", language));
  }

  // Suggestions cross-platform
  const secondBest = Object.entries(platformScores).sort(([,a], [,b]) => b - a)[1];
  if (secondBest && secondBest[1] > 60) {
    insights.push(getTranslation("multiplatform", language, {
      platform: secondBest[0],
      score: secondBest[1]
    }));
  }

  return insights;
}

module.exports = { analyzeVideo };