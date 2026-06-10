/**
 * Health & diagnostic endpoints
 */
const request = require('supertest');
const app     = require('../index');

describe('Health endpoints', () => {
    it('GET /health → 200 with status:healthy', async () => {
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('healthy');
        expect(res.body).toHaveProperty('timestamp');
        expect(res.body).toHaveProperty('environment');
    });

    it('GET /api → 200 with API description', async () => {
        const res = await request(app).get('/api');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('version');
    });

    it('GET /api/analyze/test → 200', async () => {
        const res = await request(app).get('/api/analyze/test');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('message');
    });

    it('GET /api/effects/health → 200', async () => {
        const res = await request(app).get('/api/effects/health');
        expect(res.status).toBe(200);
    });

    it('GET /nonexistent-api-route → 404 with JSON', async () => {
        const res = await request(app).get('/api/nonexistent-route-xyz');
        expect(res.status).toBe(404);
        expect(res.body).toHaveProperty('error');
    });
});
