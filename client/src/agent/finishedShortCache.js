/**
 * client/src/agent/finishedShortCache.js — finished shorts built by an agent
 * run, kept in memory so the Shorts panel's Preview and Export use them
 * instead of building them again (R176b).
 *
 * Keyed on everything a build depends on: a short moved, retimed, switched to
 * another platform or built with other treatment options is a cache miss. Not
 * saved with the project (a finished timeline is large); after a reload the
 * panel builds on demand as before.
 */
const MAX = 12;
const cache = new Map();

export function finishKey(short, opts = {}) {
    if (!short?.id) return null;
    const o = { polish: opts.polish !== false, popOut: !!opts.popOut, sfx: opts.sfx !== false, duo: opts.duo !== false };
    return [short.id, short.platform, Number(short.start) || 0, Number(short.end) || 0, o.polish, o.popOut, o.sfx, o.duo].join('|');
}

export function getFinishedShort(short, opts) {
    const key = finishKey(short, opts);
    return key ? cache.get(key) || null : null;
}

export function putFinishedShort(short, opts, built) {
    const key = finishKey(short, opts);
    if (!key || !built) return;
    cache.delete(key);
    cache.set(key, built);
    while (cache.size > MAX) cache.delete(cache.keys().next().value);
}

export function clearFinishedShorts() {
    cache.clear();
}

export default { finishKey, getFinishedShort, putFinishedShort, clearFinishedShorts };
