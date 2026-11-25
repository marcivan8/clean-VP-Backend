// services/marketGeocoder.js — address search for VIBED Market listings (R102).
//
// Free and open: Photon (komoot), a geocoder over OpenStreetMap data, no key.
// Its fair-use terms ask for moderate traffic and an identifying client, so:
//   - every query is cached in market_geocode_cache (one lookup per address, ever);
//   - outbound calls are spaced at least MIN_INTERVAL_MS apart, process-wide;
//   - the request carries a User-Agent naming VIBED.
// Results are limited to Île-de-France (launch area): the bbox narrows the
// search and the postcode check is the authority, matching the CHECK
// constraint on market_listings.

const { supabaseAdmin } = require('../config/database');

const PHOTON_URL = process.env.MARKET_GEOCODER_URL || 'https://photon.komoot.io/api/';
const USER_AGENT = 'VIBED-Market/1.0 (+https://vibedstudio.com)';
const IDF_BBOX = '1.40,48.10,3.60,49.25'; // minLon,minLat,maxLon,maxLat
const IDF_POSTCODE = /^(75|77|78|91|92|93|94|95)\d{3}$/;
const MIN_INTERVAL_MS = 1100;
const TIMEOUT_MS = 6000;

let lastCallAt = 0;
let chain = Promise.resolve();

/** Serialise outbound calls and keep them MIN_INTERVAL_MS apart. */
function throttled(fn) {
    const run = chain.then(async () => {
        const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        lastCallAt = Date.now();
        return fn();
    });
    chain = run.catch(() => {});
    return run;
}

function normaliseQuery(q) {
    return String(q || '').trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 160);
}

/** Photon feature → our shape, or null when it is not a usable IDF address. */
function toPlace(feature) {
    const p = feature?.properties || {};
    const [lng, lat] = feature?.geometry?.coordinates || [];
    const postcode = String(p.postcode || '').split(';')[0].trim();
    if (p.countrycode && p.countrycode !== 'FR') return null;
    if (!IDF_POSTCODE.test(postcode)) return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const city = p.city || p.town || p.village || p.locality || p.district || '';
    const streetLine = [p.housenumber, p.street].filter(Boolean).join(' ') || p.name || '';
    if (!streetLine && !city) return null;
    const label = [streetLine, `${postcode} ${city}`.trim()].filter(Boolean).join(', ');
    return {
        label,
        postcode,
        city,
        lat: Math.round(lat * 1e6) / 1e6,
        lng: Math.round(lng * 1e6) / 1e6,
        precise: Boolean(p.housenumber), // a house number means a real address, not a street or a town
    };
}

/**
 * Search an address in Île-de-France.
 * @returns {Promise<{ places: Array, cached: boolean }>}
 */
async function searchAddress(query, { fetchImpl = fetch } = {}) {
    const key = normaliseQuery(query);
    if (key.length < 3) return { places: [], cached: false };

    const { data: hit, error: readError } = await supabaseAdmin
        .from('market_geocode_cache').select('results').eq('query', key).maybeSingle();
    if (readError) console.error('[geocoder] cache read failed:', readError.message);
    if (hit?.results) return { places: hit.results, cached: true };

    const url = `${PHOTON_URL}?q=${encodeURIComponent(key)}&lang=fr&limit=8&bbox=${IDF_BBOX}`;
    const res = await throttled(async () => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        try {
            return await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: ctrl.signal });
        } finally {
            clearTimeout(t);
        }
    });
    if (!res.ok) {
        const err = new Error(`Geocoder answered ${res.status}`);
        err.status = res.status;
        throw err;
    }
    const body = await res.json();
    const seen = new Set();
    const places = (body.features || []).map(toPlace).filter((p) => {
        if (!p || seen.has(p.label)) return false;
        seen.add(p.label);
        return true;
    }).slice(0, 5);

    // An empty answer is cached too: asking again would return the same nothing.
    const { error: writeError } = await supabaseAdmin
        .from('market_geocode_cache').upsert({ query: key, results: places }, { onConflict: 'query' });
    if (writeError) console.error('[geocoder] cache write failed:', writeError.message);
    return { places, cached: false };
}

module.exports = { searchAddress, toPlace, normaliseQuery, IDF_POSTCODE, IDF_BBOX };
