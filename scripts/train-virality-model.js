const tf = require('@tensorflow/tfjs-node');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Polyfill for Node 20+ compatibility with TFJS
const util = require('util');
if (!util.isNullOrUndefined) {
    util.isNullOrUndefined = (val) => val === null || val === undefined;
}

// Configuration
const DATASET_PATH = path.join(__dirname, '../ML_Dataset/viral_shorts_reels_performance_dataset.csv');
const MODEL_DIR = path.join(__dirname, '../ML_Models/virality_predictor');
const MODEL_PATH = `file://${MODEL_DIR}`;

// Supabase Setup
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function loadCSV(filePath) {
    const data = [];
    return new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (row) => {
                // Parse and filter valid rows
                if (row.views_total && row.duration_sec && row.hook_strength_score) {
                    data.push({
                        views: parseInt(row.views_total),
                        duration: parseFloat(row.duration_sec),
                        hookScore: parseFloat(row.hook_strength_score) * 100, // Convert 0-1 to 0-100
                        pacing: 50, // Default if missing
                        emotion: 50 // Default if missing
                    });
                }
            })
            .on('end', () => resolve(data))
            .on('error', (error) => reject(error));
    });
}

async function fetchFeedbackData() {
    console.log('🔄 Fetching feedback data from database...');
    const { data, error } = await supabase
        .from('video_analyses')
        .select('actual_views, analysis_results')
        .not('actual_views', 'is', null);

    if (error) {
        if (error.code === '42703') {
            console.warn('⚠️ Warning: DB columns for feedback not found. Skipping feedback data.');
            return [];
        }
        console.error('❌ Error fetching DB data:', error);
        return [];
    }

    return data.map(record => {
        const r = record.analysis_results || {};
        return {
            views: record.actual_views,
            duration: r.duration || 0,
            hookScore: r.hook ? r.hook.score : 0,
            pacing: r.pacing ? r.pacing.score : 0,
            emotion: r.emotion ? r.emotion.score : 0
        };
    });
}

async function trainModel() {
    console.log('🚀 Starting Model Training...');

    // 1. Load Data
    const csvData = await loadCSV(DATASET_PATH);
    const dbData = await fetchFeedbackData();
    const allData = [...csvData, ...dbData];

    console.log(`📊 Total training samples: ${allData.length} (CSV: ${csvData.length}, DB: ${dbData.length})`);

    if (allData.length === 0) {
        console.error('❌ No training data found.');
        return;
    }

    // 2. Preprocess
    const inputs = [];
    const labels = [];

    const MIN_LOG_VIEWS = 3.0; // ~1000
    const MAX_LOG_VIEWS = 16.0; // ~9M

    allData.forEach(d => {
        // Features: [Duration, Hook, Pacing, Emotion]
        // Normalized to 0-1 range
        inputs.push([
            normalize(d.duration, 0, 120),
            normalize(d.hookScore, 0, 100),
            normalize(d.pacing, 0, 100),
            normalize(d.emotion, 0, 100)
        ]);

        // Label: Log(Views) normalized
        // Log scale is better for views which follow power law
        const logViews = Math.log(d.views);
        const normLabel = normalize(logViews, MIN_LOG_VIEWS, MAX_LOG_VIEWS);
        labels.push([normLabel]);
    });

    const inputTensor = tf.tensor2d(inputs);
    const labelTensor = tf.tensor2d(labels);

    // 3. Define Model structure
    const model = tf.sequential();
    model.add(tf.layers.dense({ inputShape: [4], units: 32, activation: 'relu' }));
    model.add(tf.layers.dropout({ rate: 0.1 }));
    model.add(tf.layers.dense({ units: 16, activation: 'relu' }));
    model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' })); // Output 0-1

    model.compile({
        optimizer: tf.train.adam(0.001),
        loss: 'meanSquaredError',
        metrics: ['mse']
    });

    // 4. Train
    console.log('🏋️‍♂️ Training in progress...');
    await model.fit(inputTensor, labelTensor, {
        epochs: 50,
        batchSize: 32,
        shuffle: true,
        callbacks: {
            onEpochEnd: (epoch, logs) => {
                if (epoch % 10 === 0) console.log(`Epoch ${epoch}: loss = ${logs.loss.toFixed(4)}`);
            }
        }
    });

    // 5. Save
    if (!fs.existsSync(MODEL_DIR)) {
        fs.mkdirSync(MODEL_DIR, { recursive: true });
    }
    await model.save(MODEL_PATH);
    console.log(`✅ Model saved to ${MODEL_DIR}`);

    // Cleanup
    inputTensor.dispose();
    labelTensor.dispose();
    model.dispose();
}

function normalize(value, min, max) {
    return (Math.min(max, Math.max(min, value || 0)) - min) / (max - min);
}

// Run
trainModel().catch(console.error);
