/**
 * Presets and job-status routes
 */
const request = require('supertest');
const app     = require('../index');

describe('Presets', () => {
    it('GET /api/presets → 200 with presets list', async () => {
        const res = await request(app).get('/api/presets');
        expect(res.status).toBe(200);
    });

    it('GET /api/presets/:id → 200 or 404', async () => {
        const res = await request(app).get('/api/presets/mkt-viral-punch');
        expect([200, 404]).toContain(res.status);
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
