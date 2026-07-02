const { Redis } = require('ioredis');

// BullMQ requires each Queue and Worker to have its own dedicated Redis
// connection — sharing one instance causes ECONNRESET cascades when the
// single socket goes idle between job bursts (Railway drops idle TCP).
//
// Use makeRedisConnection() to create a fresh, independently-reconnecting
// connection for every Queue / Worker instantiation.

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

/**
 * Options shared by every connection.
 * - maxRetriesPerRequest: null  → required by BullMQ (disables per-cmd retry limit)
 * - enableReadyCheck: false     → skip LOADING check on reconnect (faster recovery)
 * - keepAlive: 10000            → TCP keepalive every 10 s — prevents Railway's idle
 *                                 network from silently dropping the socket
 * - retryStrategy              → exponential back-off up to 30 s; never gives up
 */
const BASE_OPTIONS = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    keepAlive: 10000,
    connectTimeout: 10000,
    retryStrategy(times) {
        const delay = Math.min(200 * Math.pow(2, times), 30000);
        return delay;
    },
};

function makeRedisConnection() {
    const conn = new Redis(REDIS_URL, BASE_OPTIONS);
    conn.on('error', (err) => {
        // Log but don't crash — ioredis will reconnect automatically.
        console.error('[Redis Error]', err.message);
    });
    return conn;
}

// Legacy single export kept for any callers that haven't been updated yet.
// New callers should use makeRedisConnection() directly.
const connection = makeRedisConnection();

module.exports = { connection, makeRedisConnection };
