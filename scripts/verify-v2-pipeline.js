const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const path = require('path');
const fs = require('fs');
const { analyzeVideo } = require('../utils/videoAnalyzer');

ffmpeg.setFfmpegPath(ffmpegPath);

async function createTestVideo(outputPath) {
    return new Promise((resolve, reject) => {
        console.log('🎥 Creating test video...');
        ffmpeg()
            .input('color=c=red:s=640x480:d=5')
            .inputFormat('lavfi')
            .input('anullsrc')
            .inputFormat('lavfi')
            .outputOptions([
                '-c:v libx264',
                '-c:a aac',
                '-shortest'
            ])
            .save(outputPath)
            .on('end', () => {
                console.log('✅ Test video created');
                resolve(outputPath);
            })
            .on('error', (err) => {
                console.error('❌ Error creating test video:', err);
                reject(err);
            });
    });
}

async function runVerification() {
    const testVideoPath = path.join(__dirname, '../uploads/test-video.mp4');

    try {
        // Ensure uploads dir exists
        const uploadsDir = path.dirname(testVideoPath);
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }

        // 1. Create Test Video
        await createTestVideo(testVideoPath);

        // 2. Run Analysis
        console.log('🚀 Running V2 Analysis Pipeline...');
        const results = await analyzeVideo({
            videoPath: testVideoPath,
            title: "Test Video",
            description: "This is a test video for the V2 pipeline verification.",
            language: "en",
            userId: "test-user-id"
        });

        // 3. Verify Results
        console.log('📊 Verification Results:');
        console.log('--------------------------------');
        console.log(`Virality Score: ${results.scores.platformFit.tiktok}`); // Check a score
        console.log(`Best Platform: ${Object.keys(results.scores.platformFit).reduce((a, b) => results.scores.platformFit[a] > results.scores.platformFit[b] ? a : b)}`);
        console.log(`Transcript: "${results.transcript}"`);
        console.log(`Suggestions: ${JSON.stringify(results.suggestions, null, 2)}`);

        if (results.scores.platformFit && results.suggestions) {
            console.log('✅ Pipeline verification PASSED');
        } else {
            console.error('❌ Pipeline verification FAILED: Missing scores or suggestions');
        }

    } catch (error) {
        console.error('❌ Verification failed:', error);
    } finally {
        // Cleanup
        if (fs.existsSync(testVideoPath)) {
            fs.unlinkSync(testVideoPath);
        }
    }
}

runVerification();
