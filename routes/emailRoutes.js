// routes/emailRoutes.js: email preferences reachable without signing in.
const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../config/database');
const { verifyUnsubscribe } = require('../services/unsubscribeToken');

// POST /api/email/unsubscribe { uid, sig }
// Stops the weekly digest and product announcements for this user.
// Rate limited by the authLimiter mounted in index.js.
router.post('/unsubscribe', express.json({ limit: '2kb' }), async (req, res) => {
    const { uid, sig } = req.body || {};
    if (!uid || !sig) return res.status(400).json({ error: 'uid and sig are required' });
    if (!verifyUnsubscribe(uid, sig)) return res.status(403).json({ error: 'Invalid or expired link' });

    try {
        const { error } = await supabaseAdmin
            .from('profiles')
            .update({ email_opt_out: true })
            .eq('id', uid);
        if (error) throw new Error(error.message);
        return res.json({ ok: true });
    } catch (err) {
        console.error('[email/unsubscribe] error:', err.message);
        return res.status(500).json({ error: 'Could not update your preferences. Please try again.' });
    }
});

module.exports = router;
