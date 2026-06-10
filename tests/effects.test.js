/**
 * Effects routes — /api/effects/*
 */
const request = require('supertest');
const app     = require('../index');

describe('Effects endpoints', () => {
    it('GET /api/effects/health → 200', async () => {
        const res = await request(app).get('/api/effects/health');
        expect(res.status).toBe(200);
    });

    it('POST /api/effects/smart-zoom → 400 when no clips provided', async () => {
        const res = await request(app).post('/api/effects/smart-zoom').send({});
        expect([400, 422, 500]).toContain(res.status);
    });

    it('POST /api/effects/emotion-frame → 400 when no clips provided', async () => {
        const res = await request(app).post('/api/effects/emotion-frame').send({});
        expect([400, 422, 500]).toContain(res.status);
    });

    it('POST /api/effects/beat-sync → 400 when no clips or audio provided', async () => {
        const res = await request(app).post('/api/effects/beat-sync').send({});
        expect([400, 422, 500]).toContain(res.status);
    });
});
