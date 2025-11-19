// utils/sceneAnalyzer.js - Analyse des objets et scènes avec GPT-4o-mini-vision
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

let openai = null;

/**
 * Initialise le client OpenAI
 */
function initializeOpenAI() {
  if (!openai && process.env.OPENAI_API_KEY) {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    console.log('✅ OpenAI client initialisé pour analyse visuelle');
  }
  return openai;
}

/**
 * Analyse une image avec GPT-4o-mini-vision pour détecter objets et scènes
 * @param {string} imagePath - Chemin vers l'image
 * @param {string} language - Langue pour la réponse (défaut: 'en')
 * @returns {Promise<Object>} - Résultats de l'analyse
 */
async function analyzeScene(imagePath, language = 'en') {
  try {
    const client = initializeOpenAI();
    
    if (!client) {
      throw new Error('OpenAI client non initialisé. Vérifiez OPENAI_API_KEY.');
    }

    if (!fs.existsSync(imagePath)) {
      throw new Error(`Image non trouvée: ${imagePath}`);
    }

    // Lire l'image en base64
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = path.extname(imagePath).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';

    // Prompts selon la langue
    const prompts = {
      en: `Analyze this video frame and provide a detailed description of:
1. Objects present in the scene (list all visible objects)
2. Scene type and context (indoor/outdoor, setting, environment)
3. Visual elements (colors, lighting, composition)
4. Activity or action happening (if any)
5. Overall mood and atmosphere

Format your response as a JSON object with the following structure:
{
  "objects": ["object1", "object2", ...],
  "sceneType": "description",
  "environment": "indoor/outdoor description",
  "visualElements": {
    "colors": ["color1", "color2"],
    "lighting": "description",
    "composition": "description"
  },
  "activity": "description or null",
  "mood": "description",
  "tags": ["tag1", "tag2", ...]
}`,
      fr: `Analysez cette frame vidéo et fournissez une description détaillée de:
1. Objets présents dans la scène (listez tous les objets visibles)
2. Type de scène et contexte (intérieur/extérieur, cadre, environnement)
3. Éléments visuels (couleurs, éclairage, composition)
4. Activité ou action en cours (si applicable)
5. Ambiance et atmosphère générale

Formatez votre réponse comme un objet JSON avec la structure suivante:
{
  "objects": ["objet1", "objet2", ...],
  "sceneType": "description",
  "environment": "description intérieur/extérieur",
  "visualElements": {
    "colors": ["couleur1", "couleur2"],
    "lighting": "description",
    "composition": "description"
  },
  "activity": "description ou null",
  "mood": "description",
  "tags": ["tag1", "tag2", ...]
}`,
      tr: `Bu video karesini analiz edin ve şunların detaylı bir açıklamasını sağlayın:
1. Sahnede bulunan nesneler (tüm görünür nesneleri listeleyin)
2. Sahne türü ve bağlam (iç mekan/dış mekan, ortam, çevre)
3. Görsel öğeler (renkler, aydınlatma, kompozisyon)
4. Gerçekleşen aktivite veya eylem (varsa)
5. Genel ruh hali ve atmosfer

Yanıtınızı aşağıdaki yapıya sahip bir JSON nesnesi olarak biçimlendirin:
{
  "objects": ["nesne1", "nesne2", ...],
  "sceneType": "açıklama",
  "environment": "iç mekan/dış mekan açıklaması",
  "visualElements": {
    "colors": ["renk1", "renk2"],
    "lighting": "açıklama",
    "composition": "açıklama"
  },
  "activity": "açıklama veya null",
  "mood": "açıklama",
  "tags": ["etiket1", "etiket2", ...]
}`
    };

    const prompt = prompts[language] || prompts.en;

    console.log(`🔍 Analyse de scène avec GPT-4o-mini-vision: ${imagePath}`);

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: prompt
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`
              }
            }
          ]
        }
      ],
      max_tokens: 1000,
      temperature: 0.3
    });

    const content = response.choices[0]?.message?.content || '';
    
    // Essayer de parser le JSON de la réponse
    let analysisResult;
    try {
      // Extraire le JSON de la réponse (peut être entouré de markdown)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisResult = JSON.parse(jsonMatch[0]);
      } else {
        // Fallback: créer un objet à partir du texte
        analysisResult = {
          rawDescription: content,
          objects: extractObjectsFromText(content),
          sceneType: extractSceneType(content),
          environment: extractEnvironment(content),
          tags: extractTags(content)
        };
      }
    } catch (parseError) {
      console.warn('⚠️ Impossible de parser JSON, utilisation du texte brut');
      analysisResult = {
        rawDescription: content,
        objects: extractObjectsFromText(content),
        sceneType: extractSceneType(content),
        environment: extractEnvironment(content),
        tags: extractTags(content)
      };
    }

    return {
      success: true,
      analysis: analysisResult,
      model: 'gpt-4o-mini',
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error('❌ Erreur analyse scène:', error);
    return {
      success: false,
      error: error.message,
      analysis: null
    };
  }
}

/**
 * Analyse plusieurs frames et agrège les résultats
 * @param {string[]} framePaths - Chemins vers les frames
 * @param {string} language - Langue pour la réponse
 * @returns {Promise<Object>} - Résultats agrégés
 */
async function analyzeScenesBatch(framePaths, language = 'en') {
  const results = [];
  
  // Limiter à 5 frames pour éviter les coûts excessifs
  const framesToAnalyze = framePaths.slice(0, 5);
  
  for (const framePath of framesToAnalyze) {
    try {
      const result = await analyzeScene(framePath, language);
      if (result.success) {
        results.push(result);
      }
      // Petite pause pour éviter les rate limits
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`Erreur analyse frame ${framePath}:`, error);
    }
  }

  // Agréger les résultats
  const allObjects = new Set();
  const allTags = new Set();
  const sceneTypes = [];
  const environments = [];

  results.forEach(r => {
    if (r.analysis) {
      if (r.analysis.objects) {
        r.analysis.objects.forEach(obj => allObjects.add(obj));
      }
      if (r.analysis.tags) {
        r.analysis.tags.forEach(tag => allTags.add(tag));
      }
      if (r.analysis.sceneType) {
        sceneTypes.push(r.analysis.sceneType);
      }
      if (r.analysis.environment) {
        environments.push(r.analysis.environment);
      }
    }
  });

  return {
    framesAnalyzed: results.length,
    results: results,
    aggregated: {
      allObjects: Array.from(allObjects),
      allTags: Array.from(allTags),
      commonSceneTypes: sceneTypes,
      environments: [...new Set(environments)],
      dominantEnvironment: environments[0] || null
    }
  };
}

// Fonctions helper pour extraire des informations du texte
function extractObjectsFromText(text) {
  const objectKeywords = ['object', 'item', 'thing', 'objet', 'élément', 'nesne', 'eşya'];
  // Logique simplifiée - dans un vrai cas, on utiliserait un parsing plus sophistiqué
  return [];
}

function extractSceneType(text) {
  if (text.toLowerCase().includes('indoor')) return 'indoor';
  if (text.toLowerCase().includes('outdoor')) return 'outdoor';
  if (text.toLowerCase().includes('intérieur')) return 'indoor';
  if (text.toLowerCase().includes('extérieur')) return 'outdoor';
  return 'unknown';
}

function extractEnvironment(text) {
  // Logique simplifiée
  return text.substring(0, 100);
}

function extractTags(text) {
  // Logique simplifiée
  return [];
}

module.exports = { 
  analyzeScene, 
  analyzeScenesBatch,
  initializeOpenAI 
};

