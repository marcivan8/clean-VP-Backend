import { supabase } from '../../lib/supabaseClient';
import { captureEvent } from '../../lib/posthog';

/**
 * Starts a Stripe checkout session for a paid plan.
 * Sends the visitor to /auth first when there is no session.
 */
export async function createCheckout(plan) {
    captureEvent('checkout_started', { plan: plan || 'unknown' });
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { window.location.href = '/auth?next=/'; return; }
    const res = await fetch('/api/checkout/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ plan }),
    });
    if (!res.ok) { console.error('[checkout] failed', await res.text()); return; }
    const { url } = await res.json();
    window.location.href = url;
}

/** Sends the visitor to signup and records which CTA sent them. */
export function goToSignup(location) {
    captureEvent('landing_cta_click', { location });
    window.location.href = '/auth';
}

export default createCheckout;
