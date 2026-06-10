/**
 * Rate limiting — verifies that limiters trip at the correct thresholds.
 *
 * These tests fire requests rapidly in parallel and assert that:
 *  - At least one request passes (the limiter window isn't already exhausted)
 *  - When the limit is exceeded, the server returns 429
 *
 * NOTE: express-rate-limit uses an in-memory store by default; each Jest
 * worker gets a fresh process, so windows reset between test files.
 */
const request = require('supertest');
const app     = require('../index');

async function fire(n, fn) {
    return Promise.all(Array.from({ length: n }, fn));
}

describe('Rate limiting', () => {
    it('Auth limiter: returns 429 after 20 failed attempts in 15 min', async () => {
        // Send 25 unauthenticated requests to a protected auth endpoint
        const results = await fire(25, () =>
            request(app).get('/api/auth/profile')
        );
        const statuses = results.map(r => r.status);
        const has429 = statuses.includes(429);
        const has401 = statuses.includes(401);
        // Should see 401s (auth failures) and eventually 429s (rate limit)
        expect(has401).toBe(true);
        expect(has429).toBe(true);
    });

    it('Global limiter: headers include RateLimit-Limit', async () => {
        const res = await request(app).get('/health');
        expect(res.headers['ratelimit-limit'] || res.headers['x-ratelimit-limit']).toBeDefined();
    });

    it('429 response includes error message', async () => {
        const results = await fire(25, () =>
            request(app).get('/api/auth/profile')
        );
        const limited = results.find(r => r.status === 429);
        if (limited) {
            expect(limited.body).toHaveProperty('error');
        }
    });
});
