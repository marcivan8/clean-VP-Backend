/**
 * Security headers — verifies CSP, CORS, and other headers are present
 * and correctly configured.
 */
const request = require('supertest');
const app     = require('../index');

describe('Security headers', () => {
    it('CSP header is present on every response', async () => {
        const res = await request(app).get('/health');
        expect(res.headers['content-security-policy']).toBeDefined();
    });

    it('CSP blocks object-src and frame-src', async () => {
        const res = await request(app).get('/health');
        const csp = res.headers['content-security-policy'];
        expect(csp).toMatch(/object-src 'none'/);
        expect(csp).toMatch(/frame-src 'none'/);
    });

    it('Referrer-Policy is strict-origin-when-cross-origin', async () => {
        const res = await request(app).get('/health');
        expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    });

    it('X-Content-Type-Options is nosniff', async () => {
        const res = await request(app).get('/health');
        expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('X-Frame-Options prevents clickjacking', async () => {
        const res = await request(app).get('/health');
        const xfo = res.headers['x-frame-options'];
        expect(['SAMEORIGIN', 'DENY']).toContain(xfo);
    });

    it('Cross-Origin-Resource-Policy is set (not absent)', async () => {
        const res = await request(app).get('/health');
        expect(res.headers['cross-origin-resource-policy']).toBeDefined();
    });

    it('OPTIONS preflight does not return wildcard CORS in dev', async () => {
        const res = await request(app)
            .options('/api/auth/profile')
            .set('Origin', 'http://localhost:5173')
            .set('Access-Control-Request-Method', 'POST');
        // Should be the explicit origin, not '*'
        const acao = res.headers['access-control-allow-origin'];
        expect(acao).not.toBe('*');
    });

    it('CORS rejects disallowed origins in non-dev by returning no ACAO', async () => {
        // In test env (NODE_ENV=test) the allowlist applies — a random origin should be blocked
        const res = await request(app)
            .get('/health')
            .set('Origin', 'https://evil.example.com');
        const acao = res.headers['access-control-allow-origin'];
        expect(acao).not.toBe('*');
        expect(acao).not.toBe('https://evil.example.com');
    });
});
