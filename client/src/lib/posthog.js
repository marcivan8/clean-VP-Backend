/**
 * client/src/lib/posthog.js
 *
 * PostHog Analytics and Session Replay integration.
 *
 * Features:
 *   - Auto-initializes if VITE_POSTHOG_KEY is present
 *   - Configurable host via VITE_POSTHOG_HOST
 *   - Respects user consent for Session Recording via client/src/lib/consent.js
 *   - Safe fallback when not configured (no unhandled errors or console noise)
 *   - Helper functions: captureEvent, identifyUser, resetUser
 */

import posthog from 'posthog-js';
import { hasReplayConsent, onConsentChange } from './consent.js';

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY || 'phc_t9fuvGXvRfygAjUawy7CnueZwkPGgubNjqd46Xa849Qs';
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://eu.i.posthog.com';

let isInitialized = false;

function getClient() {
    return (typeof window !== 'undefined' && window.posthog) || posthog;
}

/**
 * Initializes PostHog with privacy-first defaults.
 */
export function initPostHog() {
    const ph = getClient();

    // If PostHog was already initialized by the <script> snippet in index.html
    if (typeof window !== 'undefined' && window.posthog && (window.posthog.__SV || window.posthog.__loaded)) {
        isInitialized = true;
        const canRecordReplay = hasReplayConsent();
        if (!canRecordReplay && typeof window.posthog.stopSessionRecording === 'function') {
            window.posthog.stopSessionRecording();
        }

        onConsentChange((consent) => {
            if (consent?.replay) {
                window.posthog.startSessionRecording?.();
            } else {
                window.posthog.stopSessionRecording?.();
            }
        });

        return window.posthog;
    }

    if (!POSTHOG_KEY) {
        if (import.meta.env.DEV) {
            console.info('[PostHog] VITE_POSTHOG_KEY is not set — tracking disabled.');
        }
        return posthog;
    }

    if (isInitialized) {
        return ph;
    }

    try {
        const canRecordReplay = hasReplayConsent();

        posthog.init(POSTHOG_KEY, {
            api_host: POSTHOG_HOST,
            defaults: '2026-05-30',
            person_profiles: 'identified_only',
            capture_pageview: true,
            capture_pageleave: true,
            autocapture: true,
            session_recording: {
                maskAllInputs: true,
                maskTextSelector: '*',
                blockSelector: 'video, canvas',
            },
            loaded: (loadedPh) => {
                if (import.meta.env.DEV) {
                    console.info('[PostHog] Initialized successfully.');
                }
            },
        });

        isInitialized = true;

        if (!canRecordReplay) {
            posthog.stopSessionRecording();
        }

        // Synchronize PostHog session recording with cookie consent changes
        onConsentChange((consent) => {
            if (!isInitialized) return;
            if (consent?.replay) {
                posthog.startSessionRecording();
            } else {
                posthog.stopSessionRecording();
            }
        });
    } catch (err) {
        console.warn('[PostHog] Initialization error:', err?.message);
    }

    return posthog;
}

/**
 * Captures a custom tracking event.
 */
export function captureEvent(eventName, properties = {}) {
    if (!isInitialized) return;
    try {
        getClient().capture(eventName, properties);
    } catch (err) {
        console.warn('[PostHog] captureEvent error:', err?.message);
    }
}

/**
 * Identifies the current user and sets user properties.
 */
export function identifyUser(userId, userProperties = {}) {
    if (!isInitialized || !userId) return;
    try {
        getClient().identify(userId, userProperties);
    } catch (err) {
        console.warn('[PostHog] identifyUser error:', err?.message);
    }
}

/**
 * Resets the identified user on sign out.
 */
export function resetPostHogUser() {
    if (!isInitialized) return;
    try {
        getClient().reset();
    } catch (err) {
        console.warn('[PostHog] resetUser error:', err?.message);
    }
}

export default posthog;
