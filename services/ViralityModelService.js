const tf = require('@tensorflow/tfjs-node');
const path = require('path');
const fs = require('fs');

class ViralityModelService {
    constructor() {
        this.modelPath = path.join(__dirname, '../ML_Models/virality_predictor/model.json');
        this.model = null;
        this.isModelLoaded = false;
    }

    async loadModel() {
        try {
            if (fs.existsSync(this.modelPath)) {
                this.model = await tf.loadLayersModel(`file://${this.modelPath}`);
                this.isModelLoaded = true;
                console.log('✅ Virality prediction model loaded.');
            } else {
                console.warn('⚠️ No trained model found at', this.modelPath);
            }
        } catch (error) {
            console.error('❌ Error loading virality model:', error);
        }
    }

    /**
     * Predicts total views based on video features.
     * @param {Object} features - { duration, hookScore, pacingScore, emotionScore, ... }
     * @returns {Object} - Prediction result { predictedViews, confidence }
     */
    async predict(features) {
        if (!this.isModelLoaded) {
            await this.loadModel();
            if (!this.isModelLoaded) {
                return { predictedViews: null, note: "Model not available" };
            }
        }

        try {
            // Preprocess features (Normalization logic must match training)
            // Note: In a real prod env, we'd save scalar stats with the model.
            // For this MVP, we use fixed scaling based on typical ranges.

            const tensorData = tf.tensor2d([[
                this.normalize(features.duration, 0, 120),       // Duration (0-120s)
                this.normalize(features.hookScore, 0, 100),      // Hook Score
                this.normalize(features.pacingScore, 0, 100),    // Pacing Score
                this.normalize(features.emotionScore, 0, 100),   // Emotion Score
            ]]);

            const prediction = this.model.predict(tensorData);
            const predictedValue = prediction.dataSync()[0];

            // De-normalize (Log scale used in training, so we exp it)
            // predicted_val = (log(views) - min) / (max - min)
            // So: log(views) = predicted_val * (max - min) + min
            // We'll hardcode the training bounds for now based on dataset exploration
            const MIN_LOG_VIEWS = 3.0; // ~1000 views
            const MAX_LOG_VIEWS = 16.0; // ~9M views

            const logViews = predictedValue * (MAX_LOG_VIEWS - MIN_LOG_VIEWS) + MIN_LOG_VIEWS;
            const predictedViews = Math.exp(logViews);

            return {
                predictedViews: Math.round(predictedViews),
                viralityAssessment: this.assessVirality(predictedViews)
            };

        } catch (error) {
            console.error('Prediction error:', error);
            return { predictedViews: null, error: error.message };
        }
    }

    normalize(value, min, max) {
        return (Math.min(max, Math.max(min, value || 0)) - min) / (max - min);
    }

    assessVirality(views) {
        if (views > 1000000) return "Viral Hit 🚀";
        if (views > 100000) return "High Potential 🔥";
        if (views > 10000) return "Good Performance 📈";
        return "Average Reach";
    }
}

module.exports = new ViralityModelService();
