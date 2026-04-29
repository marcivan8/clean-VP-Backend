/**
 * Hook Detection Engine — Viral Pilot Phase 7
 *
 * Analyzes the first 3–5 seconds of a video for hook quality.
 * Produces timestamped hook moments and a grade (A/B/C/F).
 *
 * @param {Object} data - Multimodal analysis data.
 * @returns {Object} - Hook analysis results and score.
 */
function analyzeHook(data) {
    const { transcript, audioAnalysis, visualAnalysis, duration } = data;

    // 1. Define Hook Window (first 3 seconds or 10% of video if shorter)
    const hookDuration = Math.min(3, duration * 0.1);

    // 2. Analyze Audio in Hook
    const speechSegments = audioAnalysis?.segments || [];
    const hookSpeechSegments = speechSegments.filter(
        s => s.start < hookDuration && s.text && s.text.length > 0
    );
    const speechInHook = hookSpeechSegments.length > 0;
    const highEnergyStart = (audioAnalysis?.wpm || 0) > 150;

    // 3. Analyze Visuals in Hook
    const frames = visualAnalysis?.frames || [];
    const faceInHook = frames.some(f => f.time < hookDuration && f.facesDetected > 0);
    const sceneBoundaries = visualAnalysis?.sceneBoundaries || [];
    const cutsInHook = sceneBoundaries.filter(t => t < hookDuration).length;

    // 4. Keyword Detection (EN + FR)
    const hookTranscript = (transcript || '').slice(0, 200).toLowerCase();
    const hookKeywords = [
        // English
        'wait', 'stop', 'secret', 'you need', 'listen', 'watch this',
        'attention', 'did you know', 'the truth', 'never told', 'no one tells',
        'i discovered', 'mistake', 'warning', 'before you', 'what if',
        'hack', 'tip', 'trick', 'how to', 'why you',
        // French
        'tu savais', 'regarde', 'attends', 'le secret', 'erreur',
        'jamais dit', 'attention', 'découverte', 'avant de', 'la vérité',
        'astuce', 'technique', 'comment', 'pourquoi tu'
    ];
    const matchedKeywords = hookKeywords.filter(kw => hookTranscript.includes(kw));
    const hasHookKeyword = matchedKeywords.length > 0;

    // 5. Build timestamped hook moments
    const timestampedHooks = [];

    // Hook at time 0 if strong verbal opener
    if (hasHookKeyword && speechSegments.length > 0) {
        const firstSpeechSeg = speechSegments[0];
        if (firstSpeechSeg && firstSpeechSeg.start <= hookDuration) {
            timestampedHooks.push({
                time: firstSpeechSeg.start,
                strength: matchedKeywords.length > 2 ? 'HIGH' : 'MEDIUM',
                type: 'verbal_hook',
                keyword: matchedKeywords[0] || null
            });
        }
    }

    // Hook moments at scene boundaries in hook window
    sceneBoundaries.forEach(t => {
        if (t <= hookDuration) {
            timestampedHooks.push({
                time: t,
                strength: 'MEDIUM',
                type: 'visual_cut'
            });
        }
    });

    // Hook moment if face appears early
    if (faceInHook) {
        const firstFaceFrame = frames.find(f => f.time <= hookDuration && f.facesDetected > 0);
        if (firstFaceFrame) {
            timestampedHooks.push({
                time: firstFaceFrame.time,
                strength: 'MEDIUM',
                type: 'face_appearance'
            });
        }
    }

    // Sort by time
    timestampedHooks.sort((a, b) => a.time - b.time);

    // 6. Calculate Score (0–100)
    let score = 50;
    if (speechInHook)     score += 10;
    if (faceInHook)       score += 10;
    if (cutsInHook > 0)   score += 10;
    if (hasHookKeyword)   score += 15;
    if (highEnergyStart)  score += 5;
    if (matchedKeywords.length >= 3) score += 5; // Power opener bonus
    if (!speechInHook && !faceInHook && cutsInHook === 0) score -= 20;

    score = Math.min(100, Math.max(0, score));

    // 7. Quality Grade
    let grade;
    if      (score >= 85) grade = 'A';
    else if (score >= 70) grade = 'B';
    else if (score >= 50) grade = 'C';
    else                  grade = 'F';

    // 8. Suggestion
    let suggestion;
    if (grade === 'A') {
        suggestion = 'Exceptional hook — high retention expected in the first 3 seconds.';
    } else if (grade === 'B') {
        suggestion = 'Strong hook. Consider adding a visual surprise or a high-energy keyword opener.';
    } else if (grade === 'C') {
        suggestion = 'Weak hook. Start with a bold statement, question, or visible result to grab attention instantly.';
    } else {
        suggestion = 'Critical: No hook detected. The first 3 seconds must have speech, a face, OR a fast cut — ideally all three.';
    }

    return {
        score,
        grade,
        duration: hookDuration,
        hasSpeech: speechInHook,
        hasFace: faceInHook,
        hasFastCuts: cutsInHook > 0,
        hasHookKeyword,
        matchedKeywords,
        timestampedHooks,
        suggestion
    };
}

module.exports = { analyzeHook };
