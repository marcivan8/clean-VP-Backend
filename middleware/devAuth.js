// middleware/devAuth.js
const devAuth = (req, res, next) => {
    // Hardcoded user ID from scripts/fetch_test_user.js
    const DEV_USER = {
        id: 'df851dac-790d-4800-a140-f6c0fca1dacc',
        email: 'gillesaubin5@gmail.com',
        aud: 'authenticated',
        role: 'authenticated'
    };

    if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
        console.log('⚠️ DEV AUTH: Bypassing authentication with dev user:', DEV_USER.email);
        req.user = DEV_USER;
        next();
    } else {
        // Fallback to error or pass to real auth if specific logic needed
        res.status(401).json({ error: 'Dev auth only allowed in development' });
    }
};

module.exports = { devAuth };
