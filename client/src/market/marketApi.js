/**
 * client/src/market/marketApi.js — VIBED Market real-data API (R102).
 * Every call returns { ok, ...data } or { ok: false, error } — never throws.
 */
import { authFetch } from '../utils/authFetch.js';

async function call(url, options = {}, label = url) {
    try {
        const res = await authFetch(url, options);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, status: res.status, error: body.error || `Request failed (${res.status}).`, ...body };
        return { ok: true, ...body };
    } catch (err) {
        console.error(`[market] ${label} failed:`, err.message);
        return { ok: false, error: 'Could not reach the server. Nothing was changed.' };
    }
}

const json = (method, body) => ({ method, body: JSON.stringify(body ?? {}) });

/** Public terms. Uses plain fetch-compatible authFetch (works signed out too). */
export const fetchRules = () => call('/api/market/rules');
export const searchAddress = (q) => call(`/api/market/geocode?q=${encodeURIComponent(q)}`);

export function fetchListings({ lat, lng, radiusKm, category, maxPrice } = {}) {
    const p = new URLSearchParams();
    if (Number.isFinite(lat)) p.set('lat', lat);
    if (Number.isFinite(lng)) p.set('lng', lng);
    if (radiusKm) p.set('radiusKm', radiusKm);
    if (category) p.set('category', category);
    if (maxPrice) p.set('maxPrice', maxPrice);
    return call(`/api/market/listings?${p.toString()}`);
}

export const fetchMyListings = () => call('/api/market/listings/mine');
export const createListing = (body) => call('/api/market/listings', json('POST', body));
export const updateListing = (id, body) => call(`/api/market/listings/${encodeURIComponent(id)}`, json('PATCH', body));
export const publishListing = (id) => call(`/api/market/listings/${encodeURIComponent(id)}/publish`, json('POST'));
export const pauseListing = (id) => call(`/api/market/listings/${encodeURIComponent(id)}/pause`, json('POST'));

export const fetchOnboarding = () => call('/api/market/onboarding');
export const onboardingStep = (step, body) => call(`/api/market/onboarding/${step}`, json('POST', body));

export const adminSetRule = (key, value) => call(`/api/market/admin/rules/${encodeURIComponent(key)}`, json('PUT', { value }));
export const adminAudit = () => call('/api/market/admin/audit');

/** Category ids on the server ↔ the buyer page's filter ids. */
export const CATEGORY_FILTERS = [
    { id: 'all', server: null, label: 'All' },
    { id: 'studios', server: 'studio', label: 'Studios' },
    { id: 'operators', server: 'operator', label: 'Operators' },
    { id: 'crews', server: 'crew', label: 'Crews' },
    { id: 'sound', server: 'sound', label: 'Sound' },
];
