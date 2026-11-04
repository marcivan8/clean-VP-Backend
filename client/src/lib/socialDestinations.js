/**
 * socialDestinations.js
 *
 * Talking to /api/social. Nothing here ever holds a token: the server returns
 * a destination's label, whether it is configured, and the handle of a
 * connected account, and that is all the browser is told. The token table is
 * not even readable through the Supabase client (migration 009 revokes anon
 * and authenticated), so this is the only way to know what is connected.
 */

import { authFetch } from '../utils/authFetch';

/** Destinations with their connection state, or null if it cannot be read. */
export async function fetchDestinations() {
    try {
        const res = await authFetch('/api/social/accounts');
        if (!res.ok) return null;
        const body = await res.json();
        return Array.isArray(body?.destinations) ? body.destinations : null;
    } catch (err) {
        console.warn('[social] could not read destinations:', err?.message);
        return null;
    }
}

/**
 * Starts a connection. The server hands back the provider's consent URL and
 * the browser navigates to it: a 302 would be followed by fetch() rather than
 * by the browser, so this cannot be a redirect.
 *
 * Returns an error code on failure, or never returns because the page
 * navigated away.
 */
export async function connectDestination(provider, returnTo) {
    try {
        const res = await authFetch(`/api/social/${encodeURIComponent(provider)}/connect`, {
            method: 'POST',
            body: JSON.stringify({ returnTo: returnTo || '/editor' }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body?.url) return body?.error || 'CONNECT_FAILED';
        window.location.href = body.url;
        return null;
    } catch (err) {
        console.warn('[social] connect failed:', err?.message);
        return 'CONNECT_FAILED';
    }
}

export async function disconnectDestination(provider) {
    try {
        const res = await authFetch(`/api/social/${encodeURIComponent(provider)}`, { method: 'DELETE' });
        return res.ok;
    } catch (err) {
        console.warn('[social] disconnect failed:', err?.message);
        return false;
    }
}

/**
 * The outcome of a round trip, read from the query the callback redirected to,
 * then removed from the URL so a refresh does not show it again.
 */
export function takeConnectOutcome() {
    if (typeof window === 'undefined') return null;
    let params;
    try {
        params = new URLSearchParams(window.location.search);
    } catch {
        return null;
    }
    const connected = params.get('connected');
    const error = params.get('social_error');
    if (!connected && !error) return null;

    params.delete('connected');
    params.delete('social_error');
    params.delete('provider');
    try {
        const qs = params.toString();
        window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    } catch {
        // A failed history rewrite is cosmetic; the outcome is still returned.
    }
    return connected ? { connected } : { error };
}

export default { fetchDestinations, connectDestination, disconnectDestination, takeConnectOutcome };
