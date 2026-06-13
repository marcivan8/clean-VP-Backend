/**
 * Routes with optionalAuth — silence detection
 * These endpoints must accept requests WITHOUT a token.
 *
 * Note: /api/captions/generate requires auth (requireAuth middleware) because
 * caption generation is a tracked AI operation. Those tests are in ai.test.js.
 */
const request = require('supertest');
const app     = require('../index');

describe('POST /api/silence/detect (optionalAuth)', () => {
    it('400 when no audioUrl provided', async () => {
        const res = await request(app).post('/api/silence/detect').send({});
        expect([400, 422]).toContain(res.status);
    });

    it('reachable without Authorization header', async () => {
        const res = await request(app)
            .post('/api/silence/detect')
            .send({ audioUrl: 'https://storage.googleapis.com/bucket/test.mp3' });
        // Should get a processing error, not a 401
        expect(res.status).not.toBe(401);
    });
});

describe('POST /api/captions/generate (requireAuth)', () => {
    it('returns 401 without Authorization header', async () => {
        const res = await request(app)
            .post('/api/captions/generate')
            .send({ videoUrl: 'https://storage.googleapis.com/bucket/test.mp4' });
        expect(res.status).toBe(401);
    });

    it('returns 401 when body is empty and no auth', async () => {
        const res = await request(app).post('/api/captions/generate').send({});
        expect(res.status).toBe(401);
    });
});
