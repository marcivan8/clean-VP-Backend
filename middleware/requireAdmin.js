// middleware/requireAdmin.js
//
// Trust desk gate (R100). Runs AFTER authenticateUser, which loads the caller's
// `profiles` row into req.user.profile. `is_admin` is set by hand in the SQL
// editor and cannot be written from the browser (trigger
// profiles_guard_privileged, supabase/migrations/20240012_market_roles.sql).
//
// A non-admin gets 404, not 403: the response must not confirm that an admin
// surface exists at this path (same reasoning as R27/R97).

function isAdminProfile(profile) {
    return profile?.is_admin === true;
}

function requireAdmin(req, res, next) {
    if (!isAdminProfile(req.user?.profile)) {
        return res.status(404).json({ error: 'Not found' });
    }
    return next();
}

module.exports = { requireAdmin, isAdminProfile };
