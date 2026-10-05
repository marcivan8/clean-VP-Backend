// Cookie and tracker consent for the one optional tracker Vibed uses:
// Sentry Session Replay (a masked recording of the screen when an error
// happens, used to debug the editor). Everything else stored in the browser
// is strictly necessary (sign-in session, media access cookie, language and
// editor preferences) and does not need consent.
//
// The choice is kept for 6 months (CNIL recommendation), then asked again.

const KEY = 'vibed_consent_v1';
const MAX_AGE_MS = 182 * 24 * 60 * 60 * 1000;
const CHANGE_EVENT = 'vibed:consent-change';
const OPEN_EVENT = 'vibed:consent-open';

export function getConsent() {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return null;
        const v = JSON.parse(raw);
        if (!v || typeof v.replay !== 'boolean' || !v.at) return null;
        if (Date.now() - Date.parse(v.at) > MAX_AGE_MS) return null;
        return v;
    } catch {
        return null;
    }
}

export function hasReplayConsent() {
    return getConsent()?.replay === true;
}

export function setConsent({ replay }) {
    const value = { replay: !!replay, at: new Date().toISOString() };
    try {
        localStorage.setItem(KEY, JSON.stringify(value));
    } catch {
        // Storage blocked: the choice applies to this page view only.
    }
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: value }));
    return value;
}

export function onConsentChange(fn) {
    const handler = (e) => fn(e.detail);
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
}

/** Opens the consent panel again (footer "Cookie settings" link). */
export function openConsentSettings() {
    window.dispatchEvent(new Event(OPEN_EVENT));
}

export function onConsentOpen(fn) {
    window.addEventListener(OPEN_EVENT, fn);
    return () => window.removeEventListener(OPEN_EVENT, fn);
}
