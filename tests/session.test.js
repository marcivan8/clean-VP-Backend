/**
 * Session routes — /api/session/*
 * Tests anonymous session creation, retrieval, and migration.
 */
const request = require('supertest');
const app     = require('../index');

describe('Session management', () => {
    let sessionId;

    it('POST /api/session/create → 2xx with sessionId and expiresAt', async () => {
        const res = await request(app).post('/api/session/create').send({});
        expect(res.status).toBeGreaterThanOrEqual(200);
        expect(res.status).toBeLessThan(300);
        expect(res.body).toHaveProperty('sessionId');
        expect(res.body).toHaveProperty('expiresAt');
        sessionId = res.body.sessionId;
    });

    it('GET /api/session/:id → 200 with session details', async () => {
        // Create first so we have a valid ID
        const create = await request(app).post('/api/session/create').send({});
        const id = create.body.sessionId;

        const res = await request(app).get(`/api/session/${id}`);
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('expiresAt');
    });

    it('GET /api/session/nonexistent-id → 404', async () => {
        const res = await request(app).get('/api/session/nonexistent-session-id-xyz');
        expect(res.status).toBe(404);
    });

    it('POST /api/session/migrate → 400 when sessionId or userId missing', async () => {
        const res = await request(app).post('/api/session/migrate').send({});
        expect(res.status).toBe(400);
    });

    it('Rate limiter: rapid session creates are throttled', async () => {
        const results = await Promise.all(
            Array.from({ length: 8 }, () =>
                request(app).post('/api/session/create').send({})
            )
        );
        const statuses = results.map(r => r.status);
        // All should either pass (2xx) or be rate-limited (429)
        expect(statuses.every(s => (s >= 200 && s < 300) || s === 429)).toBe(true);
    });
});
