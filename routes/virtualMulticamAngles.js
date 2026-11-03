const SOLO_CYCLE = ['close', 'mid', 'close', 'mid'];

/** Cycle framing during speech; the timeline splitter keeps longer pauses wide. */
function soloAngleForChunk(index, count, cycleIndex = 0) {
    if (count <= 1) return 'mid';
    if (count === 2) return index === 0 ? 'mid' : 'close';
    if (index === 0 || index === count - 1) return 'mid';
    return SOLO_CYCLE[cycleIndex % SOLO_CYCLE.length];
}

module.exports = { soloAngleForChunk };
