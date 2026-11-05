/**
 * aiRequestError.js
 *
 * What to say when a call to an AI route fails.
 *
 * The planner used to turn every non-OK response into the string "API planning
 * failed", which is true of a missing provider key, an expired session, a spent
 * quota and a crashed handler alike. A user sees one opaque sentence and can do
 * nothing with it, and so can whoever is debugging it.
 *
 * Three of those have different remedies, so they are told apart:
 *   402 → the usage gate refused. Goes on the shared QUOTA_EXCEEDED channel so
 *         the upgrade sheet opens, the same as MediaExecutionEngine does.
 *   401 → the session expired. Signing in again fixes it; waiting does not.
 *   anything else → the server usually says exactly what is wrong (for example
 *         "Cannot generate plan: Operation not supported locally and no API
 *         key", which means the configured AI_PROVIDER has no key in this
 *         environment). That sentence is worth far more than a generic one, so
 *         it is passed through, with the status when there is nothing to pass.
 */

import i18next from 'i18next';
import { EventBus, EVENT_TYPES } from '../agent/EventBus';
import { quotaReason } from './quotaReason.js';

/**
 * i18next returns the key, or nothing at all, when it has not been initialised
 * yet. A half-built app showing someone the string "editor:aiErrors.signedOut"
 * is worse than showing them plain English, so the default always wins when the
 * lookup does not produce real text.
 */
function say(key, fallbackText) {
    try {
        const out = i18next.t(key, fallbackText);
        return (typeof out === 'string' && out && out !== key) ? out : fallbackText;
    } catch {
        return fallbackText;
    }
}

/**
 * @param {Response} response  the failed response (not consumed: it is cloned)
 * @param {string}   fallback  what to say when the server said nothing at all
 * @returns {Promise<string>}  a sentence worth showing someone
 */
export async function describeAiFailure(response, fallback = 'The AI service did not respond.') {
    let body = {};
    try {
        // Cloned so a caller that still wants to read the body can.
        body = await response.clone().json();
    } catch {
        // Not JSON, which is itself common for a proxy error or a timeout.
    }
    const serverMessage = typeof body?.message === 'string' ? body.message
        : typeof body?.error === 'string' ? body.error
            : null;

    if (response.status === 402) {
        EventBus.emit(EVENT_TYPES.QUOTA_EXCEEDED, {
            reason: quotaReason(body),
            message: serverMessage || say('editor:aiErrors.quota', "You've used all your AI operations."),
            upgradeRequired: body?.upgradeRequired || 'creator',
        });
        return serverMessage || say('editor:aiErrors.quota', "You've used all your AI operations.");
    }

    if (response.status === 401 || response.status === 403) {
        return say('editor:aiErrors.signedOut', 'Your session expired. Sign in again to keep editing.');
    }

    if (serverMessage) return serverMessage;
    return `${fallback} (${response.status})`;
}

export default { describeAiFailure };
