// Polyfill for TensorFlow.js in Node environment
if (!global.navigator) {
  global.navigator = {
    userAgent: 'node',
    product: 'ReactNative', // Helps avoid some browser checks
    platform: 'NodeJS'
  };
}

// utils/emotionAnalyzer.js - Analyse des émotions avec TensorFlow.js
let tf, faceDetection, faceLandmarkDetectorModel;
let tfAvailable = false;
let transformErrorLogged = false;

try {
  tf = require('@tensorflow/tfjs-node');
  faceDetection = require('@tensorflow-models/face-detection');
  faceLandmarkDetectorModel = require('@tensorflow-models/face-landmarks-detection');
  tfAvailable = true;
} catch (e) {
  console.warn('⚠️ TensorFlow dependencies not available. Emotion analysis will be disabled.', e.message);
}
const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');

// Note: Les modèles TensorFlow seront téléchargés automatiquement au premier usage

let faceDetector = null;
let faceLandmarkDetector = null;

/**
 * Initialise les modèles de détection de visages
 */
async function initializeModels() {
  if (!tfAvailable) return;

  try {
    await initializeFaceDetector();

    if (!faceLandmarkDetector) {
      console.log('🔄 Initialisation du détecteur de landmarks...');
      faceLandmarkDetector = await faceLandmarkDetectorModel.createDetector(
        faceLandmarkDetectorModel.SupportedModels.MediaPipeFaceMesh,
        {
          runtime: 'tfjs',
          refineLandmarks: true,
          maxFaces: 10
        }
      );
      console.log('✅ Détecteur de landmarks initialisé');
    }
  } catch (error) {
    console.error('❌ Erreur initialisation modèles:', error);
    // Don't throw, just log and continue without emotion analysis
    tfAvailable = false;
  }
}

async function initializeFaceDetector() {
  if (!tfAvailable) throw new Error('Face detection dependencies are unavailable');
  if (faceDetector) return;
  console.log('🔄 Initialisation du détecteur de visages...');
  const model = faceDetection.SupportedModels.MediaPipeFaceDetector;
  faceDetector = await faceDetection.createDetector(model, {
    runtime: 'tfjs',
    modelType: 'short',
    maxFaces: 10
  });
  console.log('✅ Détecteur de visages initialisé');
}

/** Detect faces without running the separate expression/landmark heuristic. */
async function detectFaces(imagePath) {
  if (!fs.existsSync(imagePath)) throw new Error(`Image not found: ${imagePath}`);
  await initializeFaceDetector();
  const image = await loadImage(imagePath);
  const canvas = createCanvas(image.width, image.height);
  canvas.getContext('2d').drawImage(image, 0, 0);
  const faces = await faceDetector.estimateFaces(canvas);
  return { width: image.width, height: image.height, faces };
}

/**
 * Analyse les émotions sur une image
 * @param {string} imagePath - Chemin vers l'image
 * @returns {Promise<Object>} - Résultats de l'analyse des émotions
 */
async function analyzeEmotions(imagePath) {
  try {
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Image non trouvée: ${imagePath}`);
    }

    if (!tfAvailable) {
      return {
        facesDetected: 0,
        emotions: [],
        averageEmotion: null,
        dominantEmotion: 'neutral',
        note: 'Emotion analysis disabled due to missing dependencies'
      };
    }

    // Initialiser les modèles si nécessaire
    await initializeModels();

    // Charger l'image
    const image = await loadImage(imagePath);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);

    // Détecter les visages
    const faces = await faceDetector.estimateFaces(canvas);

    if (faces.length === 0) {
      return {
        facesDetected: 0,
        emotions: [],
        averageEmotion: null,
        dominantEmotion: null
      };
    }

    // Analyser les landmarks pour chaque visage
    const landmarks = await faceLandmarkDetector.estimateFaces(canvas);

    // Analyser les émotions basées sur les expressions faciales
    const emotions = faces.map((face, index) => {
      const emotion = analyzeFacialExpression(face, landmarks[index]);
      return {
        faceIndex: index,
        confidence: face.score,
        boundingBox: face.box,
        emotion: emotion
      };
    });

    // Calculer l'émotion moyenne
    const emotionCounts = {};
    emotions.forEach(e => {
      const emo = e.emotion.dominant;
      emotionCounts[emo] = (emotionCounts[emo] || 0) + 1;
    });

    const dominantEmotion = Object.keys(emotionCounts).reduce((a, b) =>
      emotionCounts[a] > emotionCounts[b] ? a : b
    );

    return {
      facesDetected: faces.length,
      emotions: emotions,
      averageEmotion: calculateAverageEmotion(emotions),
      dominantEmotion: dominantEmotion
    };
  } catch (error) {
    if (error.message.includes("Kernel 'Transform' not registered")) {
      if (!transformErrorLogged) {
        console.warn('⚠️ TensorFlow Transform kernel missing. Emotion analysis skipped for frames (suppressing further warnings).');
        transformErrorLogged = true;
      }
    } else {
      console.error('❌ Erreur analyse émotions:', error);
    }
    return {
      facesDetected: 0,
      emotions: [],
      averageEmotion: null,
      dominantEmotion: null,
      error: error.message
    };
  }
}

/**
 * Analyse l'expression faciale basée sur les landmarks
 * @param {Object} face - Détection de visage
 * @param {Object} landmarks - Landmarks faciaux
 * @returns {Object} - Émotion détectée avec scores
 */
function analyzeFacialExpression(face, landmarks) {
  if (!landmarks || !landmarks.keypoints) {
    return {
      dominant: 'neutral',
      scores: { neutral: 0.5, happy: 0, sad: 0, angry: 0, surprised: 0, fearful: 0 }
    };
  }

  const keypoints = landmarks.keypoints;
  const scores = {
    neutral: 0.3,
    happy: 0,
    sad: 0,
    angry: 0,
    surprised: 0,
    fearful: 0
  };

  // Analyser la position des points clés pour déterminer l'émotion
  // Cette logique est simplifiée - une vraie implémentation utiliserait un modèle ML

  // Points pour les yeux
  const leftEye = keypoints.find(kp => kp.name === 'leftEye');
  const rightEye = keypoints.find(kp => kp.name === 'rightEye');

  // Points pour la bouche
  const mouth = keypoints.find(kp => kp.name === 'mouth');
  const upperLip = keypoints.find(kp => kp.name === 'upperLip');
  const lowerLip = keypoints.find(kp => kp.name === 'lowerLip');

  // Logique simplifiée basée sur les positions
  if (mouth && upperLip && lowerLip) {
    const mouthOpen = Math.abs(upperLip.y - lowerLip.y);
    if (mouthOpen > 10) {
      scores.surprised += 0.4;
    }
  }

  // Déterminer l'émotion dominante
  const dominant = Object.keys(scores).reduce((a, b) =>
    scores[a] > scores[b] ? a : b
  );

  return {
    dominant,
    scores
  };
}

/**
 * Calcule l'émotion moyenne sur plusieurs visages
 * @param {Array} emotions - Tableau d'émotions
 * @returns {Object} - Émotion moyenne
 */
function calculateAverageEmotion(emotions) {
  if (emotions.length === 0) return null;

  const avgScores = {
    neutral: 0,
    happy: 0,
    sad: 0,
    angry: 0,
    surprised: 0,
    fearful: 0
  };

  emotions.forEach(e => {
    Object.keys(avgScores).forEach(emotion => {
      avgScores[emotion] += e.emotion.scores[emotion] || 0;
    });
  });

  Object.keys(avgScores).forEach(emotion => {
    avgScores[emotion] /= emotions.length;
  });

  const dominant = Object.keys(avgScores).reduce((a, b) =>
    avgScores[a] > avgScores[b] ? a : b
  );

  return {
    dominant,
    scores: avgScores
  };
}

/**
 * Analyse les émotions sur plusieurs frames
 * @param {string[]} framePaths - Chemins vers les frames
 * @returns {Promise<Object>} - Résultats agrégés
 */
async function analyzeEmotionsBatch(framePaths) {
  const results = [];

  for (const framePath of framePaths) {
    try {
      const result = await analyzeEmotions(framePath);
      results.push(result);
    } catch (error) {
      console.error(`Erreur analyse frame ${framePath}:`, error);
    }
  }

  // Agréger les résultats
  const totalFaces = results.reduce((sum, r) => sum + r.facesDetected, 0);
  const allEmotions = results.flatMap(r => r.emotions);

  const emotionCounts = {};
  allEmotions.forEach(e => {
    const emo = e.emotion.dominant;
    emotionCounts[emo] = (emotionCounts[emo] || 0) + 1;
  });

  const overallDominant = Object.keys(emotionCounts).reduce((a, b) =>
    emotionCounts[a] > emotionCounts[b] ? a : b, 'neutral'
  );

  return {
    totalFacesDetected: totalFaces,
    framesAnalyzed: results.length,
    results: results,
    overallDominantEmotion: overallDominant,
    emotionDistribution: emotionCounts
  };
}

module.exports = {
  detectFaces,
  analyzeEmotions,
  analyzeEmotionsBatch,
  initializeModels
};

