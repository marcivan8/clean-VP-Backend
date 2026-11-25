/**
 * conversationPersistence.js — the assistant conversation is saved with the
 * project (R105). It lived only in memory (useAIStore), so a page refresh in
 * the middle of an edit emptied the chat.
 *
 * Pure: no store imports. useTimelineStore.saveProject() calls
 * serializeConversation(useAIStore.getState()); loadProject() and the boot
 * pre-restore hand the saved value back to useAIStore.restoreConversation().
 */

export const MAX_SAVED_ITEMS = 200;
// One item larger than this (a huge advisory payload, a pasted transcript) is
// dropped rather than allowed to push the whole autosave over the quota.
export const MAX_ITEM_BYTES = 24_000;

// Things that only make sense while the page is alive.
const TRANSIENT_TYPES = new Set(['thinking', 'typing', 'progress']);

function jsonSafe(value) {
    try {
        return JSON.parse(JSON.stringify(value, (key, v) => {
            if (typeof v === 'function' || typeof v === 'symbol') return undefined;
            if (v && typeof v === 'object' && (v.$$typeof || v instanceof Blob)) return undefined; // React elements, files
            return v;
        }));
    } catch {
        return undefined; // circular or otherwise unsaveable
    }
}

function clean(item, kind) {
    if (!item || typeof item !== 'object' || TRANSIENT_TYPES.has(item.type)) return null;
    // A clarification waits for an answer the reloaded page can no longer receive.
    if (kind === 'log' && String(item.id || '').startsWith('clarification-')) return null;
    const safe = jsonSafe(kind === 'log' && item.type === 'step' ? { ...item, done: true } : item);
    if (!safe) return null;
    if (JSON.stringify(safe).length > MAX_ITEM_BYTES) return null;
    return safe;
}

/** What goes into the project save. Null when there is nothing to keep. */
export function serializeConversation(state) {
    const logs = (state?.logs || []).map((l) => clean(l, 'log')).filter(Boolean);
    const suggestions = (state?.suggestions || []).map((s) => clean(s, 'suggestion')).filter(Boolean);
    if (!logs.length && !suggestions.length) return null;
    // Keep the most recent MAX_SAVED_ITEMS across both lists, in feed order.
    const all = [
        ...logs.map((x) => ({ k: 'l', x })),
        ...suggestions.map((x) => ({ k: 's', x })),
    ].sort((a, b) => (a.x._seq ?? 0) - (b.x._seq ?? 0)).slice(-MAX_SAVED_ITEMS);
    return {
        v: 1,
        logs: all.filter((e) => e.k === 'l').map((e) => e.x),
        suggestions: all.filter((e) => e.k === 's').map((e) => e.x),
    };
}

/** Validates a saved value. Anything unusable reads as an empty conversation. */
export function parseConversation(saved) {
    if (!saved || typeof saved !== 'object' || saved.v !== 1) return { logs: [], suggestions: [] };
    const list = (a) => (Array.isArray(a) ? a.filter((x) => x && typeof x === 'object') : []);
    return { logs: list(saved.logs), suggestions: list(saved.suggestions) };
}
