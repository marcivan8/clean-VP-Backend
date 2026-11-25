// scripts/test_market_real_data.mjs — R102: VIBED Market on real data (phase 1).
//
// Runs the REAL market router (routes/marketRoutes.js), the real services
// (marketData, marketGeocoder) against an in-memory Supabase stand-in and a
// stubbed Photon, then checks the client wiring: the real map, no seed data
// on the buyer page, no invented reputation, seed-only views switched off.
// The SQL itself is exercised on real Postgres by test_market_migrations.mjs.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗', msg); } };

/* ── An in-memory Supabase: just the query shapes the market code uses ── */
const db = { market_geocode_cache: [], market_listings: [], market_onboarding: [], market_audit_log: [], market_rules: [], market_rule_versions: [] };
let idSeq = 0;
function builder(table) {
    const st = { table, op: 'select', filters: [], payload: null, order: null };
    const match = (r) => st.filters.every(([k, op, v]) => (op === 'eq' ? r[k] === v : op === 'neq' ? r[k] !== v : op === 'in' ? v.includes(r[k]) : op === 'lte' ? r[k] <= v : true));
    const run = () => {
        const rows = db[table];
        if (st.op === 'insert') {
            const list = (Array.isArray(st.payload) ? st.payload : [st.payload]).map((p) => ({ id: `id_${++idSeq}`, status: 'draft', created_at: new Date().toISOString(), ...p }));
            rows.push(...list);
            return list;
        }
        if (st.op === 'upsert') {
            const key = st.onConflict;
            const existing = rows.find((r) => r[key] === st.payload[key]);
            if (existing) { Object.assign(existing, st.payload); return [existing]; }
            const row = { ...st.payload }; rows.push(row); return [row];
        }
        if (st.op === 'update') {
            const hit = rows.filter(match);
            hit.forEach((r) => Object.assign(r, st.payload));
            return hit;
        }
        return rows.filter(match);
    };
    const b = {
        select() { return b; },
        insert(p) { st.op = 'insert'; st.payload = p; return b; },
        update(p) { st.op = 'update'; st.payload = p; return b; },
        upsert(p, o) { st.op = 'upsert'; st.payload = p; st.onConflict = o?.onConflict; return b; },
        eq(k, v) { st.filters.push([k, 'eq', v]); return b; },
        neq(k, v) { st.filters.push([k, 'neq', v]); return b; },
        in(k, v) { st.filters.push([k, 'in', v]); return b; },
        lte(k, v) { st.filters.push([k, 'lte', v]); return b; },
        order() { return b; },
        limit() { return b; },
        single() { const r = run(); return Promise.resolve(r.length === 1 ? { data: r[0], error: null } : { data: null, error: { message: 'not single' } }); },
        maybeSingle() { const r = run(); return Promise.resolve({ data: r[0] || null, error: null }); },
        then(res, rej) { return Promise.resolve({ data: run(), error: null }).then(res, rej); },
    };
    return b;
}
const rpcCalls = [];
const supabaseAdmin = {
    from: (t) => builder(t),
    rpc: (name, params) => {
        rpcCalls.push({ name, params });
        const live = db.market_listings.filter((l) => l.status === 'live');
        return Promise.resolve({ data: live.map((l, i) => ({ id: l.id, distance_km: 1.234 + i })), error: null });
    },
};

// Photon stand-in: two Ivry results, a Lyon result, a duplicate, and a street-only one.
let photonCalls = 0;
const PHOTON = {
    features: [
        { properties: { housenumber: '14', street: 'Quai Jean Compagnon', postcode: '94200', city: 'Ivry-sur-Seine', countrycode: 'FR' }, geometry: { coordinates: [2.399477, 48.819103] } },
        { properties: { housenumber: '14', street: 'Quai Jean Compagnon', postcode: '94200', city: 'Ivry-sur-Seine', countrycode: 'FR' }, geometry: { coordinates: [2.399, 48.819] } },
        { properties: { street: 'Rue de la République', postcode: '69002', city: 'Lyon', countrycode: 'FR' }, geometry: { coordinates: [4.83, 45.76] } },
        { properties: { name: 'Rue Oberkampf', postcode: '75011', city: 'Paris', countrycode: 'FR' }, geometry: { coordinates: [2.3755, 48.8655] } },
    ],
};
globalThis.fetch = async (url) => {
    if (String(url).startsWith('https://photon')) { photonCalls++; return { ok: true, status: 200, json: async () => PHOTON }; }
    throw new Error(`unexpected fetch ${url}`);
};

/* ── Load the real router with database/auth stubbed ─────────────────── */
const Module = require('module');
const profiles = {
    talent_a: { id: 'talent_a', market_role: 'talent', full_name: 'Ana' },
    talent_b: { id: 'talent_b', market_role: 'talent', full_name: 'Ben' },
    buyer_c: { id: 'buyer_c', market_role: 'buyer' },
    admin_d: { id: 'admin_d', market_role: null, is_admin: true, full_name: 'Marc' },
};
const stubs = {
    [path.join(root, 'config/database.js')]: { supabaseAdmin },
    [path.join(root, 'middleware/auth.js')]: {
        authenticateUser: (req, res, next) => {
            const id = (req.headers.authorization || '').replace('Bearer ', '');
            if (!profiles[id]) return res.status(401).json({ error: 'no' });
            req.user = { id, email: `${id}@x`, profile: { ...profiles[id] } };
            return next();
        },
        optionalAuth: (req, res, next) => next(),
    },
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
    let resolved; try { resolved = Module._resolveFilename(request, parent, isMain); } catch { return origLoad.apply(this, arguments); }
    return stubs[resolved] || origLoad.apply(this, arguments);
};
for (const f of ['routes/marketRoutes.js', 'services/marketData.js', 'services/marketGeocoder.js']) delete require.cache[path.join(root, f)];
const express = require('express');
const router = require(path.join(root, 'routes/marketRoutes.js'));
const geocoder = require(path.join(root, 'services/marketGeocoder.js'));
const data = require(path.join(root, 'services/marketData.js'));
Module._load = origLoad;

const app = express(); app.use(express.json()); app.use('/api/market', router);
const server = http.createServer(app); await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const realFetch = (await import('node:http')).default && globalThis.fetch;
// Our HTTP calls must not hit the Photon stub: use a tiny client over node:http.
const call = (method, url, user, body) => new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(base + url, { method, headers: { 'content-type': 'application/json', ...(user ? { authorization: `Bearer ${user}` } : {}), ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}) } }, (res) => {
        let s = ''; res.on('data', (d) => { s += d; }); res.on('end', () => resolve({ status: res.statusCode, json: s ? JSON.parse(s) : null }));
    });
    if (payload) req.write(payload);
    req.end();
});
void realFetch;

console.log('\n§1 address search: Île-de-France only, cached, our coordinates');
{
    const r = await call('GET', '/api/market/geocode?q=14%20quai%20jean%20compagnon', 'talent_a');
    ok(r.status === 200 && r.json.places.length === 2, 'Lyon is dropped and the duplicate merged (2 places)');
    ok(r.json.places[0].label === '14 Quai Jean Compagnon, 94200 Ivry-sur-Seine' && r.json.places[0].precise === true, 'a house number gives a precise, readable label');
    ok(r.json.places[1].precise === false, 'a street-only result is marked as not precise');
    const before = photonCalls;
    const again = await call('GET', '/api/market/geocode?q=14%20QUAI%20Jean%20compagnon', 'talent_a');
    ok(again.json.cached === true && photonCalls === before, 'the same address (any case or spacing) is served from the cache, not asked again');
    ok((await call('GET', '/api/market/geocode?q=ab', 'talent_a')).json.places.length === 0 && photonCalls === before, 'under 3 characters never reaches Photon');
    ok((await call('GET', '/api/market/geocode?q=paris')).status === 401, 'address search needs an account');
    ok(geocoder.toPlace({ properties: { postcode: '75011', city: 'Paris', street: 'x', countrycode: 'BE' }, geometry: { coordinates: [2.3, 48.8] } }) === null, 'a non-French result is refused');
}

console.log('\n§2 listings: server coordinates, owner only, publish blocked until setup is done');
let listingId;
{
    const body = { category: 'operator', title: 'Camera and sound for interviews', priceHalfDay: 480, addressLabel: '14 Quai Jean Compagnon, 94200 Ivry-sur-Seine', lat: 45.0, lng: 4.0 };
    ok((await call('POST', '/api/market/listings', 'buyer_c', body)).status === 403, 'a buyer account cannot create a listing');
    let r = await call('POST', '/api/market/listings', 'talent_a', { ...body, addressLabel: 'Somewhere I typed myself' });
    ok(r.status === 400 && /suggestions/.test(r.json.error), 'an address not picked from our search is refused');
    r = await call('POST', '/api/market/listings', 'talent_a', { ...body, priceHalfDay: 3 });
    ok(r.status === 400 && /half-day price/.test(r.json.error), 'a price outside €10–€10,000 is refused');
    r = await call('POST', '/api/market/listings', 'talent_a', body);
    ok(r.status === 201, 'a talent creates a listing');
    listingId = r.json.listing.id;
    const row = db.market_listings.find((l) => l.id === listingId);
    ok(row.lat === 48.819103 && row.lng === 2.399477, 'the stored point is the server\'s geocode, not the lat/lng the client sent');
    ok(row.status === 'draft' && row.price_half_day_cents === 48000, 'it starts as a draft, price stored in cents');
    ok(db.market_audit_log.some((a) => a.action === 'listing.created' && a.target === listingId && a.actor_label === 'Ana'), 'creation is in the audit log');

    ok((await call('PATCH', `/api/market/listings/${listingId}`, 'talent_b', { title: 'Hijacked title' })).status === 404, "another talent's listing reads as not found");
    ok((await call('POST', `/api/market/listings/${listingId}/publish`, 'talent_b')).status === 404, 'and cannot be published by them');

    r = await call('POST', `/api/market/listings/${listingId}/publish`, 'talent_a');
    ok(r.status === 409 && r.json.blockers.length === 3, 'publishing is blocked until the releases, the hosting answer and the rules are done');
    ok((await call('POST', '/api/market/onboarding/location-release', 'talent_a')).status === 409, 'a location release is refused before saying you host');
    for (const [step, b] of [['appearance-release'], ['hosts', { hosts: false }], ['accept-rules']]) await call('POST', `/api/market/onboarding/${step}`, 'talent_a', b);
    ok((await call('POST', '/api/market/onboarding/accept-rules', 'talent_a')).status === 409, 'accepting the rules twice is refused, not re-recorded');
    const ob = await call('GET', '/api/market/onboarding', 'talent_a');
    ok(ob.json.onboarding.publishBlockers.length === 0 && ob.json.onboarding.idCheck === null, 'setup done; no identity is claimed before payouts exist');
    r = await call('POST', `/api/market/listings/${listingId}/publish`, 'talent_a');
    ok(r.status === 200 && db.market_listings.find((l) => l.id === listingId).status === 'live', 'now it publishes');
    ok((await call('POST', `/api/market/listings/${listingId}/publish`, 'talent_a')).status === 409, 'publishing twice is refused');
}

console.log('\n§3 buyers see real listings, never a person\'s exact address');
{
    const r = await call('GET', '/api/market/listings?lat=48.85&lng=2.35&radiusKm=500&category=nonsense&maxPrice=600', 'buyer_c');
    ok(r.status === 200 && r.json.listings.length === 1, 'the live listing is returned');
    const l = r.json.listings[0];
    ok(l.lat === 48.82 && l.lng === 2.4 && l.exactLocation === false, "an operator's point is rounded to ~1 km");
    ok(l.address === 'Ivry-sur-Seine (94)' && !JSON.stringify(l).includes('Quai Jean Compagnon'), 'the street address never leaves the server');
    ok(l.rating === null && l.jobsCount === 0 && l.badges.length === 0 && l.certifications.length === 0, 'no invented rating, jobs, badges or certifications');
    const p = rpcCalls[rpcCalls.length - 1].params;
    ok(p.p_radius_km === 80 && p.p_category === null && p.p_max_half_day_cents === 60000, 'radius capped at 80 km, unknown category ignored, budget sent in cents');
    ok((await call('GET', '/api/market/listings?lat=45.76&lng=4.83', 'buyer_c')).json.outsideLaunchArea === true, 'a search centred outside Île-de-France says so instead of returning nothing silently');
    const studio = data.toPublicListing({ id: 's', category: 'studio', title: 'Loft', description: '', price_half_day_cents: 40000, address_label: '3 rue X, 75011 Paris', postcode: '75011', city: 'Paris', lat: 48.86543, lng: 2.37811 });
    ok(studio.lat === 48.86543 && studio.address === '3 rue X, 75011 Paris', 'a studio shows its exact address (the place is the product)');
    ok((await call('GET', '/api/market/listings')).status === 401, 'browsing needs an account');
}

console.log('\n§4 rules are public; changing them is admin-only and versioned');
{
    db.market_rules.push({ key: 'publish_ratings', rule_group: 'deadlines', label: 'Publish ratings', position: 0 });
    db.market_rule_versions.push({ rule_key: 'publish_ratings', value: '14 days', effective_at: '2026-01-01T00:00:00Z', changed_by_label: 'system' });
    const r = await call('GET', '/api/market/rules');
    ok(r.status === 200 && r.json.rules[0].value === '14 days', 'rules are readable without an account (they are the published terms)');
    ok((await call('PUT', '/api/market/admin/rules/publish_ratings', 'talent_a', { value: '7 days' })).status === 404, 'a non-admin cannot change a rule');
    ok((await call('PUT', '/api/market/admin/rules/publish_ratings', 'admin_d', { value: '14 days' })).status === 409, 'saving the same value is refused');
    const saved = await call('PUT', '/api/market/admin/rules/publish_ratings', 'admin_d', { value: '10 days' });
    ok(saved.status === 200 && db.market_rule_versions.length === 2 && db.market_rule_versions[0].value === '14 days', 'a change appends a version; the old one is untouched');
    ok(db.market_audit_log.some((a) => a.action === 'rule.changed' && a.detail.from === '14 days' && a.detail.to === '10 days' && a.actor_label === 'Marc'), 'and is audited with before and after');
    ok((await call('GET', '/api/market/admin/audit', 'admin_d')).json.audit.length > 0 && (await call('GET', '/api/market/admin/audit', 'buyer_c')).status === 404, 'the audit log is admin-only');
}
server.close();

console.log('\n§5 client wiring');
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
{
    const map = read('client/src/components/Marketplace/MarketplaceMap.jsx');
    ok(/from 'maplibre-gl'/.test(map) && /tiles\.openfreemap\.org\/styles\/positron/.test(map) && !/leaflet|cartocdn/i.test(map.replace(/\/\*[\s\S]*?\*\//g, '')), 'the map is MapLibre on OpenFreeMap; no Leaflet or CARTO left');
    ok(/searchAddress\(q\)/.test(map) && !/window\.prompt/.test(map), 'changing location uses our address search, not a browser prompt');
    const pkg = JSON.parse(read('client/package.json'));
    ok(pkg.dependencies['maplibre-gl'] === '4.7.1' && !pkg.dependencies.leaflet, 'maplibre-gl pinned, leaflet removed');
    const csp = read('index.js');
    ok(/"https:\/\/tiles\.openfreemap\.org"/.test(csp) && !/cartocdn|tile\.openstreetmap/.test(csp), 'the CSP allows OpenFreeMap and no longer the old tile hosts');
    const page = read('client/src/pages/MarketplacePage.jsx');
    ok(!/marketplaceSeedData|\bLISTINGS\.|\bLISTINGS\]|scoutMatches|MOCK_SCOUT/.test(codeOf(page)) && !/import[^;]*\bLISTINGS\b/.test(page), 'the buyer page reads no seed listings');
    ok(/fetchListings\(\{ lat: center\.lat/.test(page), 'it loads real listings for the chosen centre');
    ok(/const SHOW_SEED_VIEWS = false;/.test(page) && !/<BookingEscrowModal/.test(page), 'seed-only buyer views are off and the pretend escrow modal is not used');
    ok(!/Unlimited AI/.test(codeOf(page)) && /String\(plan \|\| 'free'\)/.test(page), 'the header shows the real plan, not a hard-coded PRO badge');
    const modal = read('client/src/components/Marketplace/ProfileDetailModal.jsx');
    ok(!/\|\| 100\}%|\|\| 11\}|\|\| 91|'40 min'|Interview & talking head', status: 'PASSED'/.test(modal), 'the detail modal invents no on-time rate, clients, score, reply time or certifications');
    ok(/Number\.isFinite\(item\.rating\) \? item\.rating\.toFixed\(2\) : 'New'/.test(modal), 'a listing with no rating shows "New" instead of crashing');
    const talent = read('client/src/market/talent/TalentApp.jsx');
    ok(/const SHOW_SEED_VIEWS = false;/.test(talent) && /useState\('listings'\)/.test(talent), 'the talent side opens on real listings; seed views are off');
    const setup = read('client/src/market/talent/TalentSetup.jsx');
    ok(/fetchOnboarding\(\)/.test(setup) && /onboardingStep\(/.test(setup) && !/useMarketOpsStore/.test(setup), 'setup is saved through the API, not seed state');
    ok(!/useMarketOpsStore/.test(codeOf(read('client/src/market/talent/BecomeTalentPage.jsx'))) && /useMarketRules\(\)/.test(read('client/src/market/talent/BecomeTalentPage.jsx')), 'the public talent page shows the live rules from the database');
    const desk = read('client/src/market/admin/TrustDesk.jsx');
    ok(/adminSetRule\(key, draft\)/.test(desk) && /adminAudit\(\)/.test(desk) && /Sample data\./.test(desk), 'the Trust desk edits real rules, reads the real audit log, and labels the rest as sample data');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
