const { Redis } = require('ioredis');

// Connect to Redis instance
// Use REDIS_URL from environment variables (Railway convention)
// Fallback to local Redis if not defined
const connection = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
});

connection.on('error', (err) => {
    console.error('[Redis Error]', err);
});

module.exports = { connection };
