// middleware/devAuth.js
//
// ⚠️  DEV-ONLY middleware — NEVER use in production.
// Immediately throws at startup if loaded when NODE_ENV=production.

if (process.env.NODE_ENV === 'production') {
    throw new Error(
        '[SECURITY] devAuth middleware was loaded in a production environment. ' +
        'Replace devAuth with authenticateUser on all routes before deploying.'
    );
}

const devAuth = (req, res, next) => {
    const DEV_USER = {
        id:    process.env.DEV_USER_ID    || 'df851dac-790d-4800-a140-f6c0fca1dacc',
        email: process.env.DEV_USER_EMAIL || 'dev@localhost',
        aud:   'authenticated',
        role:  'authenticated',
        profile: { subscription_tier: 'explorer' },
    };
    console.warn('⚠️  [devAuth] Bypassing authentication — dev-only, not for production.');
    req.user = DEV_USER;
    next();
};

module.exports = { devAuth };
