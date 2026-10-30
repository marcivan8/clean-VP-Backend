'use strict';

/** Turn timestamped frame classifications into conservative candidate ranges. */
function rangesFromFrameMatches(matches, sampleInterval, duration, rangeStart = 0) {
    const step = Math.max(0.25, Number(sampleInterval) || 1);
    const total = Math.max(0, Number(duration) || 0);
    const lowerBound = Math.max(0, Number(rangeStart) || 0);
    const sorted = (Array.isArray(matches) ? matches : [])
        .filter(m => m && Number.isFinite(Number(m.timestamp)) && Number(m.confidence) >= 0.4)
        .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
    const ranges = [];

    for (const hit of sorted) {
        const start = Math.max(lowerBound, Number(hit.timestamp) - step / 2);
        const end = Math.min(total || Number(hit.timestamp) + step / 2, Number(hit.timestamp) + step / 2);
        const previous = ranges[ranges.length - 1];
        if (previous && start <= previous.end + step * 0.6) {
            previous.end = Math.max(previous.end, end);
            previous.confidence = Math.min(previous.confidence, Number(hit.confidence));
            previous.evidence = [...new Set([previous.evidence, hit.evidence].filter(Boolean))].join(' · ').slice(0, 500);
            previous.sampleCount += 1;
        } else {
            ranges.push({ start, end, confidence: Number(hit.confidence), evidence: String(hit.evidence || '').slice(0, 240), sampleCount: 1 });
        }
    }
    return ranges.filter(r => r.end > r.start);
}

module.exports = { rangesFromFrameMatches };
