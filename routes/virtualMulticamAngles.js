const SOLO_CYCLE = ['close', 'mid', 'close', 'mid'];

/** Keep an establish/close wide shot when there are enough turns for one. */
function useWideDuoBoundary(index, count) {
    return count === 1 || (count > 2 && (index === 0 || index === count - 1));
}

/**
 * A two-turn solo interview still needs an angle change: establish wide, then
 * close. Longer edits keep a wide bookend and cycle mid/close on the body.
 */
function soloAngleForChunk(index, count, cycleIndex = 0) {
    if (count <= 1) return 'wide';
    if (count === 2) return index === 0 ? 'wide' : 'close';
    if (index === 0 || index === count - 1) return 'wide';
    return SOLO_CYCLE[cycleIndex % SOLO_CYCLE.length];
}

module.exports = { useWideDuoBoundary, soloAngleForChunk };
