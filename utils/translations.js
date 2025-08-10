// utils/translations.js - Utilitaires de traduction pour le backend

const PLATFORM_TRANSLATIONS = {
  en: {
    TikTok: "TikTok",
    YouTube: "YouTube",
    YouTubeShorts: "YouTube Shorts", 
    Instagram: "Instagram",
    X: "X",
    LinkedIn: "LinkedIn",
    Unknown: "Unknown",
    Facebook: "Facebook",
    Snapchat: "Snapchat"
  },
  fr: {
    TikTok: "TikTok",
    YouTube: "YouTube",
    YouTubeShorts: "YouTube Shorts",
    Instagram: "Instagram", 
    X: "X",
    LinkedIn: "LinkedIn",
    Unknown: "Inconnu",
    Facebook: "Facebook",
    Snapchat: "Snapchat"
  },
  tr: {
    TikTok: "TikTok",
    YouTube: "YouTube",
    YouTubeShorts: "YouTube Shorts",
    Instagram: "Instagram",
    X: "X",
    LinkedIn: "LinkedIn", 
    Unknown: "Bilinmeyen",
    Facebook: "Facebook",
    Snapchat: "Snapchat"
  }
};

const ERROR_TRANSLATIONS = {
  en: {
    "no_file": "No video file provided.",
    "file_too_large": "File too large. Maximum size: 100MB",
    "invalid_file_type": "Invalid file type. Use MP4, MOV, AVI, WebM, etc.",
    "missing_title": "Title required for analysis.",
    "missing_description": "Description required for analysis.",
    "transcription_failed": "Audio transcription failed, continuing with text analysis only.",
    "analysis_failed": "Video analysis failed.",
    "internal_error": "Internal server error during analysis."
  },
  fr: {
    "no_file": "Aucun fichier vidéo fourni.",
    "file_too_large": "Fichier trop volumineux. Taille maximale : 100Mo",
    "invalid_file_type": "Type de fichier invalide. Utilisez MP4, MOV, AVI, WebM, etc.",
    "missing_title": "Titre requis pour l'analyse.",
    "missing_description": "Description requise pour l'analyse.",
    "transcription_failed": "Échec de la transcription audio, poursuite avec analyse textuelle uniquement.",
    "analysis_failed": "Échec de l'analyse vidéo.",
    "internal_error": "Erreur interne du serveur pendant l'analyse."
  },
  tr: {
    "no_file": "Video dosyası sağlanmadı.",
    "file_too_large": "Dosya çok büyük. Maksimum boyut: 100MB",
    "invalid_file_type": "Geçersiz dosya türü. MP4, MOV, AVI, WebM vb. kullanın.",
    "missing_title": "Analiz için başlık gerekli.",
    "missing_description": "Analiz için açıklama gerekli.",
    "transcription_failed": "Ses transkripsiyon başarısız, sadece metin analiziyle devam ediliyor.",
    "analysis_failed": "Video analizi başarısız.",
    "internal_error": "Analiz sırasında sunucu iç hatası."
  }
};

/**
 * Traduit un nom de plateforme selon la langue
 */
function translatePlatform(platform, language = "en") {
  return PLATFORM_TRANSLATIONS[language]?.[platform] || PLATFORM_TRANSLATIONS.en[platform] || platform;
}

/**
 * Traduit un message d'erreur selon la langue  
 */
function translateError(errorKey, language = "en") {
  return ERROR_TRANSLATIONS[language]?.[errorKey] || ERROR_TRANSLATIONS.en[errorKey] || errorKey;
}

/**
 * Valide et normalise le code de langue
 */
function validateLanguage(lang) {
  const supported = ['en', 'fr', 'tr'];
  return supported.includes(lang) ? lang : 'en';
}

/**
 * Détecte la langue préférée depuis les headers de requête
 */
function detectLanguageFromHeaders(acceptLanguageHeader) {
  if (!acceptLanguageHeader) return 'en';
  
  const languages = acceptLanguageHeader
    .split(',')
    .map(lang => lang.split(';')[0].trim().toLowerCase());
  
  // Cherche une langue supportée
  for (const lang of languages) {
    if (lang.startsWith('fr')) return 'fr';
    if (lang.startsWith('tr')) return 'tr';
    if (lang.startsWith('en')) return 'en';
  }
  
  return 'en'; // fallback
}

module.exports = {
  translatePlatform,
  translateError,
  validateLanguage,
  detectLanguageFromHeaders,
  PLATFORM_TRANSLATIONS,
  ERROR_TRANSLATIONS
};