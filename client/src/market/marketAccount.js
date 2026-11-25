/**
 * client/src/market/marketAccount.js — which VIBED Market interface an account
 * gets (R100). Talks to routes/marketRoutes.js.
 */
import { authFetch } from '../utils/authFetch.js';

/** @returns {Promise<{ status: 'ok'|'signed_out'|'error', role?: string|null, isAdmin?: boolean }>} */
export async function fetchMarketMe() {
    try {
        const res = await authFetch('/api/market/me');
        if (res.status === 401) return { status: 'signed_out' };
        if (!res.ok) return { status: 'error' };
        const body = await res.json();
        return { status: 'ok', role: body.role ?? null, isAdmin: body.isAdmin === true };
    } catch (err) {
        console.error('[market] /me failed:', err.message);
        return { status: 'error' };
    }
}

/** Choose buyer or talent. Final: the server refuses a change once set. */
export async function chooseMarketRole(role) {
    try {
        const res = await authFetch('/api/market/role', { method: 'POST', body: JSON.stringify({ role }) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, error: body.error || 'Could not save the role.', role: body.role ?? null };
        return { ok: true, role: body.role };
    } catch (err) {
        console.error('[market] /role failed:', err.message);
        return { ok: false, error: 'Could not reach the server. Nothing was changed.' };
    }
}

/** True only when the server confirms the caller is an admin (404 otherwise). */
export async function checkMarketAdmin() {
    try {
        const res = await authFetch('/api/market/admin/check');
        if (res.status === 401) return 'signed_out';
        return res.ok ? 'admin' : 'denied';
    } catch (err) {
        console.error('[market] admin check failed:', err.message);
        return 'error';
    }
}
