// services/marketData.js — VIBED Market rules, listings and onboarding on real
// data (R102). Every write goes through supabaseAdmin; every table is
// backend-only (RLS on, no policies — supabase/migrations/20240013_market_core.sql).

const { supabaseAdmin } = require('../config/database');

const CATEGORIES = Object.freeze(['studio', 'operator', 'crew', 'sound']);
const CATEGORY_LABEL = { studio: 'Studio', operator: 'Operator', crew: 'Crew', sound: 'Sound' };

/* ── Rules ───────────────────────────────────────────────────────────── */

/** Current value of every rule (the latest version already in effect). */
async function currentRules() {
    const [{ data: rules, error: rErr }, { data: versions, error: vErr }] = await Promise.all([
        supabaseAdmin.from('market_rules').select('key, rule_group, label, position').order('position'),
        supabaseAdmin.from('market_rule_versions')
            .select('rule_key, value, effective_at, changed_by_label')
            .lte('effective_at', new Date().toISOString())
            .order('effective_at', { ascending: true }),
    ]);
    if (rErr) throw rErr;
    if (vErr) throw vErr;
    const history = {};
    for (const v of versions || []) (history[v.rule_key] ||= []).push(v);
    return (rules || []).map((r) => {
        const h = history[r.key] || [];
        const last = h[h.length - 1];
        return {
            key: r.key,
            group: r.rule_group,
            label: r.label,
            value: last ? last.value : null,
            versions: h.length,
            previous: h.length > 1 ? h[h.length - 2].value : null,
            changedAt: last?.effective_at || null,
        };
    });
}

/** Append a new version. Refuses an unchanged value (R30: no silent no-op). */
async function setRule(key, value, actor) {
    const next = String(value ?? '').trim();
    if (!next || next.length > 80) return { ok: false, status: 400, error: 'A value of 1 to 80 characters is required.' };
    const rules = await currentRules();
    const rule = rules.find((r) => r.key === key);
    if (!rule) return { ok: false, status: 404, error: 'Unknown rule.' };
    if (rule.value === next) return { ok: false, status: 409, error: 'Same value: nothing to change.' };

    const { error } = await supabaseAdmin.from('market_rule_versions').insert({
        rule_key: key, value: next, changed_by: actor.id, changed_by_label: actor.label,
    });
    if (error) throw error;
    await audit(actor, 'rule.changed', key, { from: rule.value, to: next });
    return { ok: true, rule: { ...rule, previous: rule.value, value: next, versions: rule.versions + 1 } };
}

/* ── Audit ───────────────────────────────────────────────────────────── */

async function audit(actor, action, target, detail = {}) {
    const { error } = await supabaseAdmin.from('market_audit_log').insert({
        actor_id: actor?.id || null, actor_label: actor?.label || 'System', action, target, detail,
    });
    // An audit write that fails must be visible, but must not undo the action
    // it records — the action already happened.
    if (error) console.error('[market] audit write failed:', action, target, error.message);
}

async function recentAudit(limit = 100) {
    const { data, error } = await supabaseAdmin.from('market_audit_log')
        .select('at, actor_label, action, target, detail').order('at', { ascending: false }).limit(Math.min(limit, 500));
    if (error) throw error;
    return data || [];
}

/* ── Listings ────────────────────────────────────────────────────────── */

const euros = (cents) => (Number.isFinite(cents) ? Math.round(cents) / 100 : null);
const cents = (eur) => Math.round(Number(eur) * 100);

/**
 * What a buyer may see. People are often listing from home, so an operator,
 * crew or sound listing shows a point rounded to ~1 km and the city only; a
 * studio's address is the product, so it is shown exactly.
 */
function toPublicListing(row, distanceKm = null) {
    const isPlace = row.category === 'studio';
    const coarse = (n) => Math.round(n * 100) / 100; // ~1.1 km of latitude
    return {
        id: row.id,
        category: row.category,
        kind: CATEGORY_LABEL[row.category],
        type: isPlace ? 'studio' : 'operator',
        name: row.title,
        subtitle: row.description ? row.description.split('\n')[0].slice(0, 140) : '',
        description: row.description,
        priceHalfDay: euros(row.price_half_day_cents),
        priceFullDay: euros(row.price_full_day_cents),
        location: row.city,
        address: isPlace ? row.address_label : `${row.city} (${row.postcode.slice(0, 2)})`,
        lat: isPlace ? row.lat : coarse(row.lat),
        lng: isPlace ? row.lng : coarse(row.lng),
        exactLocation: isPlace,
        distanceKm: Number.isFinite(distanceKm) ? Math.round(distanceKm * 10) / 10 : null,
        travelRadiusKm: row.travel_radius_km,
        features: row.features || [],
        // Reputation comes from real bookings (phase 3). Until then: empty, never invented.
        badges: [],
        rating: null,
        jobsCount: 0,
        reviews: [],
        certifications: [],
        publishedAt: row.published_at,
    };
}

function validateListingInput(body, { partial = false } = {}) {
    const out = {};
    const errors = [];
    const has = (k) => body[k] !== undefined;
    if (!partial || has('category')) {
        if (!CATEGORIES.includes(body.category)) errors.push('category must be studio, operator, crew or sound');
        else out.category = body.category;
    }
    if (!partial || has('title')) {
        const t = String(body.title || '').trim();
        if (t.length < 3 || t.length > 90) errors.push('title must be 3 to 90 characters');
        else out.title = t;
    }
    if (has('description')) {
        const d = String(body.description || '').trim();
        if (d.length > 2000) errors.push('description is limited to 2000 characters');
        else out.description = d;
    }
    if (!partial || has('priceHalfDay')) {
        const p = Number(body.priceHalfDay);
        if (!Number.isFinite(p) || p < 10 || p > 10000) errors.push('half-day price must be between €10 and €10,000');
        else out.price_half_day_cents = cents(p);
    }
    if (has('priceFullDay')) {
        if (body.priceFullDay === null || body.priceFullDay === '') out.price_full_day_cents = null;
        else {
            const p = Number(body.priceFullDay);
            if (!Number.isFinite(p) || p < 10 || p > 20000) errors.push('full-day price must be between €10 and €20,000');
            else out.price_full_day_cents = cents(p);
        }
    }
    if (has('travelRadiusKm')) {
        if (body.travelRadiusKm === null || body.travelRadiusKm === '') out.travel_radius_km = null;
        else {
            const r = Number(body.travelRadiusKm);
            if (!Number.isInteger(r) || r < 0 || r > 200) errors.push('travel radius must be 0 to 200 km');
            else out.travel_radius_km = r;
        }
    }
    if (has('features')) {
        const f = Array.isArray(body.features) ? body.features.map((x) => String(x).trim()).filter(Boolean) : [];
        if (f.length > 20 || f.some((x) => x.length > 60)) errors.push('up to 20 features of 60 characters');
        else out.features = f;
    }
    return { values: out, errors };
}

/* ── Onboarding ──────────────────────────────────────────────────────── */

async function getOnboarding(userId) {
    const { data, error } = await supabaseAdmin.from('market_onboarding').select('*').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data || { user_id: userId };
}

/** What blocks publishing a listing. Identity and payouts block BOOKINGS (phase 2), not the listing. */
function publishBlockers(o) {
    const out = [];
    if (!o.appearance_release_at) out.push('Sign the appearance release.');
    if (o.hosts_locations == null) out.push('Say whether you host a place.');
    if (o.hosts_locations === true && !o.location_release_at) out.push('Sign the location release for the place you host.');
    if (!o.rules_accepted_at) out.push('Accept the market rules.');
    return out;
}

function toPublicOnboarding(o) {
    return {
        idCheck: o.kyc_result ? { result: o.kyc_result, level: o.kyc_level, date: o.kyc_date } : null,
        payoutsConnected: o.payouts_enabled === true,
        appearanceReleaseAt: o.appearance_release_at || null,
        hostsLocations: o.hosts_locations ?? null,
        locationReleaseAt: o.location_release_at || null,
        rulesAcceptedAt: o.rules_accepted_at || null,
        publishBlockers: publishBlockers(o),
    };
}

async function updateOnboarding(userId, patch) {
    const { data, error } = await supabaseAdmin.from('market_onboarding')
        .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' }).select('*').single();
    if (error) throw error;
    return data;
}

module.exports = {
    CATEGORIES, currentRules, setRule, audit, recentAudit,
    toPublicListing, validateListingInput, getOnboarding, publishBlockers, toPublicOnboarding, updateOnboarding,
};
