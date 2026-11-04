/**
 * trackEvent.js
 *
 * Fire-and-forget client-side event tracking. Goes to PostHog only.
 * Never throws: a tracking failure must never break the user's flow.
 *
 * R148: this used to ALSO insert into public.usage_events. That table is the
 * server's billing ledger, and usageGate meters AI operations by counting
 * rows in it, so 'video_uploaded' and 'video_exported' were charged as AI
 * usage. 232 upload rows and 92 export rows had accumulated against only 10
 * rows the gate itself recorded, and measured conservatively that pushed 12
 * free user-months and 2 Creator user-months past their cap on analytics
 * alone, including a paying user counted at 119 of 100.
 *
 * Billable operations are recorded by the server and nowhere else now
 * (middleware/usageGate.js). migrations/008_usage_run_ids.sql drops the
 * client INSERT policy that let these rows reach the ledger, and the count
 * whitelists server-written rows so the historical ones stop being charged.
 *
 * Usage:
 *   trackEvent('video_uploaded');
 *   trackEvent('ai_edit:silence_removal');
 *   trackEvent('video_exported');
 */

import { captureEvent } from '../lib/posthog';

export async function trackEvent(operation, properties = {}) {
    try {
        captureEvent(operation, properties);
    } catch (err) {
        // Never surface tracking errors to the user
        console.warn('[trackEvent] Failed to log event:', err?.message);
    }
}
