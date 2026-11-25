// routes/marketRoutes.js — VIBED Market account roles (R100).
//
//   GET  /api/market/me           → { role: 'buyer'|'talent'|null, isAdmin }
//   POST /api/market/role         → choose a role, ONCE (separate accounts per role)
//   GET  /api/market/admin/check  → 200 for an admin, 404 for anyone else
//
// The market itself still runs on seed data in the client (useMarketOpsStore);
// these routes only decide WHICH interface an account gets. Writes go through
// supabaseAdmin because the browser is not allowed to touch market_role or
// is_admin (profiles_guard_privileged trigger).

const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../config/database');
const { authenticateUser } = require('../middleware/auth');
const { requireAdmin, isAdminProfile } = require('../middleware/requireAdmin');
const rateLimit = require('express-rate-limit');
const market = require('../services/marketData');
const { searchAddress } = require('../services/marketGeocoder');

const MARKET_ROLES = Object.freeze(['buyer', 'talent']);

function normaliseRole(value) {
    return MARKET_ROLES.includes(value) ? value : null;
}

router.get('/me', authenticateUser, (req, res) => {
    const profile = req.user.profile || {};
    res.json({
        role: normaliseRole(profile.market_role),
        isAdmin: isAdminProfile(profile),
    });
});

router.post('/role', authenticateUser, async (req, res) => {
    try {
        const role = normaliseRole(req.body?.role);
        if (!role) return res.status(400).json({ error: 'role must be buyer or talent' });

        const current = normaliseRole(req.user.profile?.market_role);
        if (current) {
            // Separate accounts per role: the choice is final. Same role again
            // is an idempotent success, a different one is refused.
            if (current === role) return res.json({ role, unchanged: true });
            return res.status(409).json({
                error: `This account is already a ${current} account. Use a separate account to ${role === 'talent' ? 'offer work' : 'book'}.`,
                role: current,
            });
        }

        // `.is('market_role', null)` makes two racing requests safe: only the
        // first one matches a row. A zero-row update is NOT an error in
        // PostgREST (R38), so the returned rows are checked explicitly.
        const { data, error } = await supabaseAdmin
            .from('profiles')
            .update({ market_role: role })
            .eq('id', req.user.id)
            .is('market_role', null)
            .select('market_role');
        if (error) throw error;

        if (!data || data.length === 0) {
            const { data: fresh, error: readError } = await supabaseAdmin
                .from('profiles').select('market_role').eq('id', req.user.id).maybeSingle();
            if (readError) throw readError;
            const now = normaliseRole(fresh?.market_role);
            if (now === role) return res.json({ role, unchanged: true });
            return res.status(409).json({ error: 'This account already has a role.', role: now });
        }

        return res.json({ role: data[0].market_role });
    } catch (err) {
        console.error('[market] POST /role failed:', err.message);
        // Most likely cause on a fresh deploy: the 20240012 migration has not
        // been applied, so the column does not exist.
        return res.status(500).json({ error: 'Could not save the role. Nothing was changed.' });
    }
});

router.get('/admin/check', authenticateUser, requireAdmin, (req, res) => {
    res.json({ ok: true });
});

/* ════════════════════════════════════════════════════════════════════
   Real data (R102): rules, listings, address search, onboarding, admin.
   ════════════════════════════════════════════════════════════════════ */

const actorOf = (req) => ({ id: req.user.id, label: req.user.profile?.full_name || req.user.email || 'Unknown' });

function requireTalent(req, res, next) {
    if (req.user?.profile?.market_role !== 'talent') {
        return res.status(403).json({ error: 'This needs a talent account.' });
    }
    return next();
}

const fail500 = (res, where, err) => {
    console.error(`[market] ${where} failed:`, err.message);
    return res.status(500).json({ error: 'Something went wrong. Nothing was changed.' });
};

// Rules are the published terms: readable without an account (the talent page is public).
router.get('/rules', async (req, res) => {
    try {
        res.json({ rules: await market.currentRules() });
    } catch (err) { return fail500(res, 'GET /rules', err); }
});

/* ── Address search (Photon, Île-de-France) ─────────────────────────── */

const geocodeLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many address searches. Wait a moment.' } });

router.get('/geocode', authenticateUser, geocodeLimiter, async (req, res) => {
    try {
        const q = String(req.query.q || '');
        if (q.trim().length < 3) return res.json({ places: [] });
        const { places, cached } = await searchAddress(q);
        res.json({ places, cached });
    } catch (err) {
        console.error('[market] geocode failed:', err.message);
        return res.status(502).json({ error: 'Address search is unavailable right now. Try again in a minute.', places: [] });
    }
});

/** Re-resolve the label the client picked, so coordinates always come from the server. */
async function resolveAddress(label) {
    const { places } = await searchAddress(label);
    return places.find((p) => p.label.toLowerCase() === String(label).trim().toLowerCase()) || null;
}

/* ── Listings ───────────────────────────────────────────────────────── */

const PARIS = { lat: 48.8566, lng: 2.3522 };

router.get('/listings', authenticateUser, async (req, res) => {
    try {
        const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : d);
        const lat = num(req.query.lat, PARIS.lat);
        const lng = num(req.query.lng, PARIS.lng);
        if (lat < 48.10 || lat > 49.25 || lng < 1.40 || lng > 3.60) {
            return res.json({ listings: [], outsideLaunchArea: true });
        }
        const radiusKm = Math.min(Math.max(num(req.query.radiusKm, 25), 1), 80);
        const category = market.CATEGORIES.includes(req.query.category) ? req.query.category : null;
        const maxPrice = num(req.query.maxPrice, null);

        const { data: near, error } = await supabaseAdmin.rpc('market_listings_near', {
            p_lat: lat, p_lng: lng, p_radius_km: radiusKm, p_category: category,
            p_max_half_day_cents: maxPrice == null ? null : Math.round(maxPrice * 100), p_limit: 200,
        });
        if (error) throw error;
        if (!near?.length) return res.json({ listings: [], center: { lat, lng }, radiusKm });

        const { data: rows, error: rowsErr } = await supabaseAdmin.from('market_listings')
            .select('*').in('id', near.map((n) => n.id)).eq('status', 'live');
        if (rowsErr) throw rowsErr;
        const byId = new Map((rows || []).map((r) => [r.id, r]));
        const listings = near.filter((n) => byId.has(n.id)).map((n) => market.toPublicListing(byId.get(n.id), n.distance_km));
        res.json({ listings, center: { lat, lng }, radiusKm });
    } catch (err) { return fail500(res, 'GET /listings', err); }
});

router.get('/listings/mine', authenticateUser, requireTalent, async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin.from('market_listings').select('*').eq('owner_id', req.user.id).order('created_at');
        if (error) throw error;
        res.json({ listings: (data || []).map((r) => ({ ...market.toPublicListing(r), status: r.status, exactAddress: r.address_label })) });
    } catch (err) { return fail500(res, 'GET /listings/mine', err); }
});

router.post('/listings', authenticateUser, requireTalent, async (req, res) => {
    try {
        const { values, errors } = market.validateListingInput(req.body || {});
        if (errors.length) return res.status(400).json({ error: errors.join('; ') });
        const place = await resolveAddress(req.body?.addressLabel);
        if (!place) return res.status(400).json({ error: 'Pick the address from the suggestions (Île-de-France only).' });

        const { data, error } = await supabaseAdmin.from('market_listings').insert({
            ...values, owner_id: req.user.id,
            address_label: place.label, postcode: place.postcode, city: place.city, lat: place.lat, lng: place.lng,
        }).select('*').single();
        if (error) throw error;
        await market.audit(actorOf(req), 'listing.created', data.id, { category: data.category });
        res.status(201).json({ listing: { ...market.toPublicListing(data), status: data.status, exactAddress: data.address_label } });
    } catch (err) {
        if (/geocoder/i.test(err.message)) return res.status(502).json({ error: 'Address search is unavailable right now. Nothing was saved.' });
        return fail500(res, 'POST /listings', err);
    }
});

async function ownListing(req, res) {
    const { data, error } = await supabaseAdmin.from('market_listings').select('*').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    // Someone else's listing reads exactly like a missing one (R27/R97).
    if (!data || data.owner_id !== req.user.id) { res.status(404).json({ error: 'Listing not found.' }); return null; }
    return data;
}

router.patch('/listings/:id', authenticateUser, requireTalent, async (req, res) => {
    try {
        const current = await ownListing(req, res);
        if (!current) return undefined;
        const { values, errors } = market.validateListingInput(req.body || {}, { partial: true });
        if (errors.length) return res.status(400).json({ error: errors.join('; ') });
        if (req.body?.addressLabel !== undefined) {
            const place = await resolveAddress(req.body.addressLabel);
            if (!place) return res.status(400).json({ error: 'Pick the address from the suggestions (Île-de-France only).' });
            Object.assign(values, { address_label: place.label, postcode: place.postcode, city: place.city, lat: place.lat, lng: place.lng });
        }
        if (!Object.keys(values).length) return res.status(400).json({ error: 'Nothing to change.' });
        const { data, error } = await supabaseAdmin.from('market_listings').update(values).eq('id', current.id).select('*').single();
        if (error) throw error;
        res.json({ listing: { ...market.toPublicListing(data), status: data.status, exactAddress: data.address_label } });
    } catch (err) { return fail500(res, 'PATCH /listings/:id', err); }
});

router.post('/listings/:id/publish', authenticateUser, requireTalent, async (req, res) => {
    try {
        const current = await ownListing(req, res);
        if (!current) return undefined;
        if (current.status === 'live') return res.status(409).json({ error: 'Already live.' });
        const blockers = market.publishBlockers(await market.getOnboarding(req.user.id));
        if (blockers.length) return res.status(409).json({ error: 'Finish your setup first.', blockers });
        const { data, error } = await supabaseAdmin.from('market_listings')
            .update({ status: 'live', published_at: current.published_at || new Date().toISOString() })
            .eq('id', current.id).neq('status', 'live').select('*');
        if (error) throw error;
        if (!data?.length) return res.status(409).json({ error: 'Already live.' });
        await market.audit(actorOf(req), 'listing.published', current.id);
        res.json({ listing: { ...market.toPublicListing(data[0]), status: 'live' } });
    } catch (err) { return fail500(res, 'POST /listings/:id/publish', err); }
});

router.post('/listings/:id/pause', authenticateUser, requireTalent, async (req, res) => {
    try {
        const current = await ownListing(req, res);
        if (!current) return undefined;
        if (current.status !== 'live') return res.status(409).json({ error: 'Only a live listing can be paused.' });
        const { error } = await supabaseAdmin.from('market_listings').update({ status: 'paused' }).eq('id', current.id);
        if (error) throw error;
        await market.audit(actorOf(req), 'listing.paused', current.id);
        res.json({ ok: true, status: 'paused' });
    } catch (err) { return fail500(res, 'POST /listings/:id/pause', err); }
});

/* ── Onboarding ─────────────────────────────────────────────────────── */

router.get('/onboarding', authenticateUser, requireTalent, async (req, res) => {
    try {
        res.json({ onboarding: market.toPublicOnboarding(await market.getOnboarding(req.user.id)) });
    } catch (err) { return fail500(res, 'GET /onboarding', err); }
});

const ONBOARDING_STEPS = {
    'appearance-release': (o) => (o.appearance_release_at ? 'Already signed.' : { appearance_release_at: new Date().toISOString() }),
    'location-release': (o) => (o.hosts_locations !== true ? 'A location release is only for places you host.'
        : o.location_release_at ? 'Already signed.' : { location_release_at: new Date().toISOString() }),
    'accept-rules': (o) => (o.rules_accepted_at ? 'Already accepted.' : { rules_accepted_at: new Date().toISOString() }),
    hosts: (o, body) => {
        if (typeof body?.hosts !== 'boolean') return 'hosts must be true or false.';
        if (o.hosts_locations === body.hosts) return 'Nothing to change.';
        return body.hosts ? { hosts_locations: true } : { hosts_locations: false, location_release_at: null };
    },
};

router.post('/onboarding/:step', authenticateUser, requireTalent, async (req, res) => {
    try {
        const step = ONBOARDING_STEPS[req.params.step];
        if (!step) return res.status(404).json({ error: 'Unknown step.' });
        const current = await market.getOnboarding(req.user.id);
        const patch = step(current, req.body);
        if (typeof patch === 'string') return res.status(409).json({ error: patch });
        const saved = await market.updateOnboarding(req.user.id, patch);
        await market.audit(actorOf(req), `onboarding.${req.params.step}`, req.user.id, req.params.step === 'accept-rules' ? { at: patch.rules_accepted_at } : {});
        res.json({ onboarding: market.toPublicOnboarding(saved) });
    } catch (err) { return fail500(res, `POST /onboarding/${req.params.step}`, err); }
});

/* ── Admin ──────────────────────────────────────────────────────────── */

router.put('/admin/rules/:key', authenticateUser, requireAdmin, async (req, res) => {
    try {
        const r = await market.setRule(req.params.key, req.body?.value, actorOf(req));
        if (!r.ok) return res.status(r.status).json({ error: r.error });
        res.json({ rule: r.rule });
    } catch (err) { return fail500(res, 'PUT /admin/rules/:key', err); }
});

router.get('/admin/audit', authenticateUser, requireAdmin, async (req, res) => {
    try {
        res.json({ audit: await market.recentAudit(Number(req.query.limit) || 100) });
    } catch (err) { return fail500(res, 'GET /admin/audit', err); }
});

module.exports = router;
module.exports.MARKET_ROLES = MARKET_ROLES;
module.exports.normaliseRole = normaliseRole;
