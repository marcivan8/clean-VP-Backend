// Product analytics (PostHog, EU cloud), only with consent (cookie banner).
// posthog-js is loaded with a dynamic import, so a visitor who has not
// accepted analytics does not download it and sends nothing.
//
// The project key is public by design (it only allows sending events), so it
// is safe as a fallback. Override with VITE_POSTHOG_KEY / VITE_POSTHOG_HOST.
// A new host must also be added to connectSrc in the CSP (index.js).
import { hasAnalyticsConsent } from './consent.js';

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY
    || 'phc_t9fuvGXvRfygAjUawy7CnueZwkPGgubNjqd46Xa849Qs';
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://eu.i.posthog.com';

let posthogPromise = null;

function loadPosthog() {
    if (!posthogPromise) {
        posthogPromise = import('posthog-js').then(({ default: posthog }) => {
            posthog.init(POSTHOG_KEY, {
                api_host: POSTHOG_HOST,
                defaults: '2025-11-30',
                // Single-page app: one $pageview per route change.
                capture_pageview: 'history_change',
                person_profiles: 'identified_only',
                // Never record what the user types or shows in the editor.
                mask_all_text: true,
                mask_all_element_attributes: true,
                // Sentry already covers replays and errors. The CSP allows
                // scripts from 'self' only, so no extra PostHog scripts load.
                disable_session_recording: true,
                disable_surveys: true,
                capture_exceptions: false,
                disable_external_dependency_loading: true,
            });
            return posthog;
        });
    }
    return posthogPromise;
}

export async function syncAnalyticsWithConsent() {
    try {
        if (hasAnalyticsConsent()) {
            const posthog = await loadPosthog();
            if (posthog.has_opted_out_capturing()) posthog.opt_in_capturing();
        } else if (posthogPromise) {
            // Consent withdrawn: stop capturing and clear the anonymous id.
            const posthog = await posthogPromise;
            posthog.opt_out_capturing();
            posthog.reset();
        }
    } catch (err) {
        console.warn('[consent] analytics toggle failed:', err?.message);
    }
}
