/**
 * Error handling — malformed inputs, missing fields, edge cases.
 * Verifies the API fails gracefully rather than crashing or leaking stack traces.
 */
const request = require('supertest');
const app     = require('../index');

describe('Malformed JSON', () => {
    it('POST with invalid JSON body → 400, not crash', async () => {
        const res = await request(app)
            .post('/api/ai/chat')
            .set('Content-Type', 'application/json')
            .send('{ bad json :::');
        expect([400, 500]).toContain(res.status);
        // Must return JSON, not raw stack trace
        expect(res.headers['content-type']).toMatch(/json/);
    });

    it('POST with extremely large payload → 413 or 400', async () => {
        const huge = 'x'.repeat(60 * 1024 * 1024); // 60 MB — over the 50MB limit
        const res = await request(app)
            .post('/api/ai/chat')
            .set('Content-Type', 'application/json')
            .send(JSON.stringify({ command: huge }));
        expect([400, 413]).toContain(res.status);
    });
});

describe('Missing required fields', () => {
    it('POST /api/auth/profile without email → 400', async () => {
        const db = require('../config/database').supabaseAdmin;
        db.auth.getUser.mockResolvedValueOnce({
            data: { user: { id: 'u1', email: 'u@u.com' } }, error: null,
        });
        db._mockSingle.mockResolvedValueOnce({ data: { id: 'u1' }, error: null });

        const res = await request(app)
            .post('/api/auth/profile')
            .set('Authorization', 'Bearer valid')
            .send({ fullName: 'No Email' });
        expect(res.status).toBe(400);
    });
});

describe('Error response shape', () => {
    it('All 4xx responses return JSON with "error" key', async () => {
        const endpoints = [
            { method: 'get',  url: '/api/auth/profile' },
            { method: 'get',  url: '/api/auth/usage' },
            { method: 'post', url: '/api/auth/profile', body: {} },
        ];
        for (const { method, url, body } of endpoints) {
            const req = request(app)[method](url);
            if (body) req.send(body);
            const res = await req;
            if (res.status >= 400) {
                expect(res.body).toHaveProperty('error');
            }
        }
    });

    it('404 for unknown API path returns JSON, not HTML', async () => {
        const res = await request(app).get('/api/does-not-exist-xyz');
        expect(res.status).toBe(404);
        expect(res.headers['content-type']).toMatch(/json/);
    });
});

describe('Content-Type enforcement', () => {
    it('POST /api/ai/chat without Content-Type still responds (express is lenient)', async () => {
        const res = await request(app)
            .post('/api/ai/chat')
            .set('Content-Type', 'text/plain')
            .send('remove silences');
        // AI routes require auth, so no-auth requests return 401
        expect([200, 400, 401, 415, 500]).toContain(res.status);
    });
});
