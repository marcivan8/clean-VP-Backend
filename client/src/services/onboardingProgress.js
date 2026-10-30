/**
 * client/src/services/onboardingProgress.js
 *
 * R105 — what a user has already been shown, remembered PER USER.
 *
 * The previous mechanism was one localStorage key, `vp_onboarding_tour_seen`.
 * That is per BROWSER, which gets two things wrong that matter here:
 *
 *   1. A user who signs up on a laptop and opens the editor on a desktop is
 *      taught the product twice, and a user who clears their cache is taught
 *      it again forever. With a 7% day-two return rate, the few people who DO
 *      come back are exactly the ones who must not be re-onboarded.
 *   2. Nothing could ever be reported on. "How many users finished the
 *      walkthrough" was unanswerable, because the answer lived in browsers.
 *
 * State lives in `profiles.usage_data.onboarding`, a jsonb column that already
 * exists (no migration), on a table that is 1:1 with auth.users. Shape:
 *
 *     usage_data: { onboarding: { tour_v2: 1792... , hint_first_upload: 1792... } }
 *
 * Values are timestamps rather than booleans so a later question ("did they
 * see the Auto hint before or after their first export?") is answerable
 * without a new column.
 *
 * ── THE RULES THIS MODULE KEEPS ─────────────────────────────────────────
 *
 * NEVER SHOW THE SAME THING TWICE, even while the network is slow. Writes are
 * applied to the in-memory cache first and flushed after, so a hint dismissed
 * at t=0 cannot reappear at t=200ms because the round trip has not landed.
 *
 * NEVER BLOCK THE EDITOR. Every failure path degrades to localStorage. A user
 * who is logged out, offline, or hitting an RLS error still gets a tour that
 * remembers itself for the session; they do not get a tour that replays on
 * every render, and they never get an exception out of this module.
 *
 * NEVER CLOBBER. `usage_data` is shared with other features, so a write
 * read-modify-writes the whole object and merges only the `onboarding` key.
 */

import { supabase } from '../lib/supabaseClient.js';

const LOCAL_KEY = 'vp_onboarding_progress';

/** Resolved once per session: { userId, seen: {key: ts} } | null while loading. */
let cache = null;
let loadPromise = null;

// ── localStorage, the fallback that must never throw ────────────────────────

function readLocal() {
    try {
        const raw = window.localStorage.getItem(LOCAL_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch (_) {
        // Private browsing, blocked storage, or corrupt JSON. An empty object
        // means "nothing seen", which shows the tour once per session rather
        // than never — the right failure direction for a teaching surface.
        return {};
    }
}

function writeLocal(seen) {
    try {
        window.localStorage.setItem(LOCAL_KEY, JSON.stringify(seen));
    } catch (_) { /* nothing to do, and nothing worth telling the user */ }
}

/**
 * The pre-R105 key. A user who completed the old four-step tour in THIS
 * browser should not be shown the new one as though they were brand new —
 * they are not, and re-teaching a returning user is the specific thing this
 * module exists to avoid. The old tour is treated as a completed `tour_v1`.
 */
function legacySeen() {
    try {
        return window.localStorage.getItem('vp_onboarding_tour_seen') ? { tour_v1: 1 } : {};
    } catch (_) {
        return {};
    }
}

// ── Load ────────────────────────────────────────────────────────────────────

/**
 * Load this user's progress once. Safe to call from several components in the
 * same tick: they share one in-flight promise rather than racing requests.
 *
 * @returns {Promise<{userId: string|null, seen: Record<string, number>}>}
 */
export function loadOnboardingProgress() {
    if (cache) return Promise.resolve(cache);
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
        const local = { ...legacySeen(), ...readLocal() };
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                cache = { userId: null, seen: local };
                return cache;
            }

            const { data, error } = await supabase
                .from('profiles')
                .select('usage_data')
                .eq('id', user.id)
                .single();

            if (error) throw error;

            const remote = (data?.usage_data && typeof data.usage_data === 'object')
                ? (data.usage_data.onboarding || {})
                : {};

            // Local wins on conflict only in the sense that a key seen in
            // EITHER place counts as seen. Showing something twice is the
            // failure; showing it zero times is the acceptable cost.
            cache = { userId: user.id, seen: { ...local, ...remote } };

            // A browser that completed the old tour teaches the server about
            // it once, so the next device inherits the fact.
            const unsynced = Object.keys(local).filter(k => !(k in remote));
            if (unsynced.length > 0) flush(unsynced.reduce((acc, k) => ({ ...acc, [k]: local[k] }), {}));

            return cache;
        } catch (err) {
            console.warn('[onboardingProgress] falling back to local storage:', err?.message || err);
            cache = { userId: null, seen: local };
            return cache;
        }
    })();

    return loadPromise;
}

// ── Read ────────────────────────────────────────────────────────────────────

/**
 * Has this key been shown? Synchronous, so a render can ask without flashing.
 * Returns `true` while progress is still loading: a hint that never fires is
 * a smaller mistake than one that fires and then vanishes as state arrives.
 *
 * @param {string} key
 * @returns {boolean}
 */
export function hasSeen(key) {
    if (!cache) return true;
    return Boolean(cache.seen[key]);
}

/** Is progress resolved yet? Components wait on this before offering a hint. */
export function isProgressReady() {
    return cache !== null;
}

// ── Write ───────────────────────────────────────────────────────────────────

let pending = {};
let flushTimer = null;

/**
 * Persist the pending keys. Debounced, because a tour marks several keys in
 * quick succession and each one is not worth a round trip.
 */
function flush(extra = {}) {
    pending = { ...pending, ...extra };
    if (flushTimer) return;

    flushTimer = setTimeout(async () => {
        const batch = pending;
        pending = {};
        flushTimer = null;
        if (Object.keys(batch).length === 0) return;

        writeLocal({ ...readLocal(), ...batch });

        const userId = cache?.userId;
        if (!userId) return;

        try {
            // Read-modify-write: `usage_data` belongs to several features, so
            // the whole object is merged rather than replaced. Without this,
            // recording a dismissed hint would silently wipe usage counters.
            const { data, error: readErr } = await supabase
                .from('profiles')
                .select('usage_data')
                .eq('id', userId)
                .single();
            if (readErr) throw readErr;

            const current = (data?.usage_data && typeof data.usage_data === 'object') ? data.usage_data : {};
            const merged = {
                ...current,
                onboarding: { ...(current.onboarding || {}), ...batch },
            };

            const { error: writeErr } = await supabase
                .from('profiles')
                .update({ usage_data: merged })
                .eq('id', userId);
            if (writeErr) throw writeErr;
        } catch (err) {
            // The local copy above already succeeded, so this user is not
            // re-taught in this browser. Losing cross-device sync is the
            // whole cost of a failure here.
            console.warn('[onboardingProgress] could not persist:', err?.message || err);
        }
    }, 400);
}

/**
 * Record that `key` has been shown. Applied to the cache SYNCHRONOUSLY so the
 * very next render already knows, whatever the network does afterwards.
 *
 * @param {string} key
 */
export function markSeen(key) {
    if (!key || typeof key !== 'string') return;
    const ts = Date.now();
    if (cache) {
        if (cache.seen[key]) return;
        cache.seen[key] = ts;
    }
    flush({ [key]: ts });
}

/** Show everything again. For a "replay the walkthrough" control in settings. */
export async function resetOnboardingProgress() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    pending = {};
    if (cache) cache.seen = {};
    writeLocal({});
    try { window.localStorage.removeItem('vp_onboarding_tour_seen'); } catch (_) {}
    const userId = cache?.userId;
    if (!userId) return;
    try {
        const { data } = await supabase.from('profiles').select('usage_data').eq('id', userId).single();
        const current = (data?.usage_data && typeof data.usage_data === 'object') ? data.usage_data : {};
        await supabase.from('profiles').update({ usage_data: { ...current, onboarding: {} } }).eq('id', userId);
    } catch (err) {
        console.warn('[onboardingProgress] could not reset remotely:', err?.message || err);
    }
}

export default { loadOnboardingProgress, hasSeen, isProgressReady, markSeen, resetOnboardingProgress };
