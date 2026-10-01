/**
 * checkout.js — start a Polar checkout for a plan and redirect to it.
 * Same /api/checkout/create flow the pricing page, the dashboard and
 * UpgradeModal use. Resolves false when it could not redirect.
 */
import { supabase } from './supabaseClient.js';

export async function startCheckout(plan) {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { window.location.href = '/auth'; return false; }
        const res = await fetch('/api/checkout/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ plan }),
        });
        if (!res.ok) {
            console.error('[checkout] failed:', await res.text());
            return false;
        }
        const { url } = await res.json();
        if (!url) return false;
        window.location.href = url;
        return true;
    } catch (err) {
        console.error('[checkout] error:', err.message);
        return false;
    }
}
