/**
 * trackEvent.js
 *
 * Fire-and-forget client-side event tracking.
 * Writes to public.usage_events via the Supabase client.
 * Never throws — a tracking failure must never break the user's flow.
 *
 * Usage:
 *   trackEvent('video_uploaded');
 *   trackEvent('ai_edit:silence_removal');
 *   trackEvent('video_exported');
 */

import { supabase } from '../lib/supabaseClient';

export async function trackEvent(operation) {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return; // anonymous / not logged in — skip silently

        await supabase.from('usage_events').insert({
            user_id:   user.id,
            operation,
        });

        console.log(`[trackEvent] ${operation}`);
    } catch (err) {
        // Never surface tracking errors to the user
        console.warn('[trackEvent] Failed to log event:', err?.message);
    }
}
