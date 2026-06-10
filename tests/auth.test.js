/**
 * Auth routes — /api/auth/*
 */
const request = require('supertest');
const app     = require('../index');

// Access the supabase mock at runtime (after jest.mock hoisting runs)
function db() { return require('../config/database').supabaseAdmin; }

const VALID_USER    = { id: 'user-test-123', email: 'test@example.com' };
const VALID_PROFILE = { id: 'user-test-123', email: 'test@example.com', subscription_tier: 'explorer' };

function mockAuthSuccess() {
    db().auth.getUser.mockResolvedValueOnce({ data: { user: VALID_USER }, error: null });
    db()._mockSingle.mockResolvedValueOnce({ data: VALID_PROFILE, error: null });
}

// ── auth guard ─────────────────────────────────────────────────────────────────
describe('Auth guard', () => {
    it('GET /api/auth/profile → 401 when no token', async () => {
        const res = await request(app).get('/api/auth/profile');
        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('code', 'MISSING_AUTH_HEADER');
    });

    it('GET /api/auth/usage → 401 when no token', async () => {
        const res = await request(app).get('/api/auth/usage');
        expect(res.status).toBe(401);
    });

    it('GET /api/auth/history → 401 when no token', async () => {
        const res = await request(app).get('/api/auth/history');
        expect(res.status).toBe(401);
    });

    it('POST /api/auth/profile → 401 when no token', async () => {
        const res = await request(app).post('/api/auth/profile').send({ email: 'x@x.com' });
        expect(res.status).toBe(401);
    });

    it('returns TOKEN_VALIDATION_FAILED when token is invalid', async () => {
        db().auth.getUser.mockResolvedValueOnce({
            data:  { user: null },
            error: { code: 'invalid_token', message: 'JWT expired', status: 401 },
        });
        const res = await request(app)
            .get('/api/auth/profile')
            .set('Authorization', 'Bearer bad-token');
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('TOKEN_VALIDATION_FAILED');
    });

    it('returns 404 when user has no profile yet', async () => {
        db().auth.getUser.mockResolvedValueOnce({ data: { user: VALID_USER }, error: null });
        db()._mockSingle.mockResolvedValueOnce({
            data:  null,
            error: { code: 'PGRST116', message: 'No rows found' },
        });
        const res = await request(app)
            .get('/api/auth/profile')
            .set('Authorization', 'Bearer valid-token');
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('PROFILE_NOT_FOUND');
    });
});

// ── authenticated CRUD ─────────────────────────────────────────────────────────
describe('Auth CRUD (authenticated)', () => {
    it('GET /api/auth/profile → 200 with profile', async () => {
        mockAuthSuccess();
        db()._mockSingle.mockResolvedValueOnce({ data: VALID_PROFILE, error: null });
        const res = await request(app)
            .get('/api/auth/profile')
            .set('Authorization', 'Bearer valid-token');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('profile');
    });

    it('PATCH /api/auth/profile → 200 when updating name', async () => {
        mockAuthSuccess();
        db()._mockSingle.mockResolvedValueOnce({ data: { ...VALID_PROFILE, full_name: 'Marc' }, error: null });
        const res = await request(app)
            .patch('/api/auth/profile')
            .set('Authorization', 'Bearer valid-token')
            .send({ full_name: 'Marc' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('POST /api/auth/profile → 400 when email is missing', async () => {
        mockAuthSuccess();
        const res = await request(app)
            .post('/api/auth/profile')
            .set('Authorization', 'Bearer valid-token')
            .send({ fullName: 'No Email' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/email/i);
    });
});
