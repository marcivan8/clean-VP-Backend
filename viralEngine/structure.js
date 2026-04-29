/**
 * Analyzes the narrative structure of a video using transcript + metadata.
 * Returns hook candidates, intro/body/outro, sections, and key moments.
 *
 * @param {Object} data - { duration, transcript, segments }
 *   - duration: number (seconds)
 *   - transcript: string (full plain-text transcript)
 *   - segments: Array<{ start, end, text, words }> (Whisper verbose_json segments)
 * @returns {Object} - Rich structure analysis
 */
function analyzeStructure(data) {
    const { duration, transcript = '', segments = [] } = data;

    if (!duration || duration <= 0) {
        return { score: 0, error: 'Invalid duration', sections: {}, hookCandidate: null };
    }

    // ── Region boundaries ──────────────────────────────────────────────────
    const introEnd = Math.min(duration * 0.15, 90);       // Max 90s intro
    const outroStart = Math.max(duration * 0.85, duration - 120); // Last 120s max

    // ── CTA Detection (outro) ──────────────────────────────────────────────
    const outroText = transcript.slice(-Math.min(transcript.length, 600)).toLowerCase();
    const ctaKeywords = ['subscribe', 'follow', 'like', 'comment', 'share', 'link in bio',
        'abonnez', 'clique', 'check out', 'click below', 'buy now', 'dm me'];
    const hasCTA = ctaKeywords.some(kw => outroText.includes(kw));

    // ── Hook Candidate Detection ───────────────────────────────────────────
    // Strategy: find the 20-30s window with the highest word-density peak
    let hookCandidate = null;

    if (segments.length > 0) {
        // Score each segment by speech rate (words-per-second) as energy proxy
        const scoredSegments = segments.map(seg => {
            const segDuration = seg.end - seg.start;
            const wordCount = (seg.words || seg.text.split(' ')).length;
            const speechRate = segDuration > 0 ? wordCount / segDuration : 0;
            const isEarly = seg.start < duration * 0.4; // Prefer early segments for hook
            return { ...seg, speechRate, isEarly };
        });

        // Find peak energy segment in the first 40% of video
        const earlySegments = scoredSegments.filter(s => s.isEarly);
        const hookSeg = earlySegments.sort((a, b) => b.speechRate - a.speechRate)[0];

        if (hookSeg) {
            // Expand to a clean 20-30s window around the peak
            const windowStart = Math.max(0, hookSeg.start - 5);
            const windowEnd = Math.min(hookSeg.end + 15, duration, windowStart + 30);
            hookCandidate = {
                start: parseFloat(windowStart.toFixed(2)),
                end: parseFloat(windowEnd.toFixed(2)),
                energy: parseFloat(hookSeg.speechRate.toFixed(2)),
                segmentText: hookSeg.text,
                reason: 'High speech-rate peak detected in first 40% of video'
            };
        }
    }

    // ── Section Detection via Topic Shifts ────────────────────────────────
    // A topic shift is flagged when a segment's vocabulary has low overlap
    // with the preceding segment's vocabulary.
    const sections = [];

    if (segments.length >= 4) {
        let currentSection = {
            start: segments[0].start,
            text: segments[0].text,
            words: new Set((segments[0].text || '').toLowerCase().split(/\s+/).filter(w => w.length > 4))
        };

        for (let i = 1; i < segments.length; i++) {
            const seg = segments[i];
            const segWords = new Set((seg.text || '').toLowerCase().split(/\s+/).filter(w => w.length > 4));

            // Jaccard similarity between current section and new segment
            const intersection = [...segWords].filter(w => currentSection.words.has(w)).length;
            const union = new Set([...currentSection.words, ...segWords]).size;
            const similarity = union > 0 ? intersection / union : 1;

            const isTopicShift = similarity < 0.15 && (seg.start - currentSection.start) > 20;
            const isFinalSegment = i === segments.length - 1;

            if (isTopicShift || isFinalSegment) {
                sections.push({
                    start: parseFloat(currentSection.start.toFixed(2)),
                    end: parseFloat(seg.start.toFixed(2)),
                    topic: _inferTopic(currentSection.text),
                    type: _classifySection(currentSection.start, seg.start, duration)
                });
                currentSection = {
                    start: seg.start,
                    text: seg.text,
                    words: segWords
                };
            } else {
                // Merge segment into current section
                currentSection.text += ' ' + seg.text;
                segWords.forEach(w => currentSection.words.add(w));
            }
        }
    }

    // ── Score ──────────────────────────────────────────────────────────────
    let score = 60;
    if (hasCTA) score += 20;
    if (hookCandidate && hookCandidate.start < 30) score += 15;
    if (sections.length >= 2) score += 5;

    return {
        score: Math.min(score, 100),
        duration,
        sections: {
            intro: { start: 0, end: parseFloat(introEnd.toFixed(2)) },
            body: { start: parseFloat(introEnd.toFixed(2)), end: parseFloat(outroStart.toFixed(2)) },
            outro: { start: parseFloat(outroStart.toFixed(2)), end: duration }
        },
        detectedSections: sections,
        hookCandidate,
        hasCTA,
        hasIntro: true,
        feedback: _buildFeedback(hasCTA, hookCandidate, sections)
    };
}

// ── Private Helpers ──────────────────────────────────────────────────────────

/**
 * Infers a short topic label from text using keyword frequency.
 */
function _inferTopic(text = '') {
    const stopWords = new Set(['that', 'this', 'with', 'from', 'have', 'were', 'they', 'been',
        'their', 'what', 'when', 'where', 'which', 'about', 'would', 'could', 'should']);
    const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 4 && !stopWords.has(w));
    const freq = {};
    words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 3);
    return top.map(([w]) => w).join(', ') || 'general';
}

/**
 * Classifies a section as intro, main, or outro based on position.
 */
function _classifySection(start, end, duration) {
    const midStart = start / duration;
    if (midStart < 0.15) return 'intro';
    if (midStart > 0.80) return 'outro';
    return 'main';
}

/**
 * Builds a human-readable feedback string.
 */
function _buildFeedback(hasCTA, hookCandidate, sections) {
    const lines = [];
    if (hookCandidate) {
        lines.push(`✓ Hook candidate found at ${hookCandidate.start.toFixed(0)}s–${hookCandidate.end.toFixed(0)}s.`);
    } else {
        lines.push('⚠ No strong hook found in the first 40% of the video.');
    }
    if (hasCTA) {
        lines.push('✓ Call-to-Action detected in the outro.');
    } else {
        lines.push('⚠ No clear Call-to-Action at the end.');
    }
    if (sections.length > 0) {
        lines.push(`✓ ${sections.length} content section(s) detected.`);
    }
    return lines.join(' ');
}

module.exports = { analyzeStructure };

