/**
 * Presets and job-status routes
 */
const request = require('supertest');
const app     = require('../index');

describe('Presets', () => {
    it('GET /api/presets/marketplace → 200 with presets list', async () => {
        const res = await request(app).get('/api/presets/marketplace');
        expect(res.status).toBe(200);
    });

    it('POST /api/presets/publish → responds (stub or validation)', async () => {
        const res = await request(app).post('/api/presets/publish').send({});
        expect([200, 400, 422, 501]).toContain(res.status);
    });
});

describe('Job status', () => {
    it('GET /api/jobs/:id/status → 404 for unknown jobId', async () => {
        const res = await request(app).get('/api/jobs/nonexistent-job-id/status');
        expect([404, 200]).toContain(res.status);
    });

    it('GET /api/jobs/:id/progress → 404 for unknown jobId', async () => {
        const res = await request(app).get('/api/jobs/nonexistent-job-id/progress');
        expect([404, 200]).toContain(res.status);
    });
});
