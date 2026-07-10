/**
 * Routes with optionalAuth — silence, captions
 * These endpoints must accept requests WITHOUT a token (unauthenticated usage).
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

describe('POST /api/captions/generate (optionalAuth)', () => {
    it('reachable without Authorization header', async () => {
        const res = await request(app)
            .post('/api/captions/generate')
            .send({ videoUrl: 'https://storage.googleapis.com/bucket/test.mp4' });
        expect(res.status).not.toBe(401);
    });

    it('400 or 202 when body is empty', async () => {
        const res = await request(app).post('/api/captions/generate').send({});
        expect([400, 202, 200]).toContain(res.status);
    });
});
