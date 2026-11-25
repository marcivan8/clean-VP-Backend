/**
 * client/src/market/useMarketRules.js — the live market rules from the
 * database (GET /api/market/rules), shared by every screen that shows them (R102).
 *
 * One request per page load, cached at module level; `refresh()` after a
 * Trust desk edit. Screens never fall back to the seed values: if the rules
 * cannot be loaded, they say so instead of showing terms that may be stale.
 */
import { useCallback, useEffect, useState } from 'react';
import { fetchRules } from './marketApi.js';

let cache = null;       // { byKey, list }
let inflight = null;
const listeners = new Set();

function load(force = false) {
    if (cache && !force) return Promise.resolve(cache);
    if (inflight && !force) return inflight;
    inflight = fetchRules().then((r) => {
        inflight = null;
        if (!r.ok) throw new Error(r.error || 'Could not load the rules.');
        const list = r.rules || [];
        cache = { list, byKey: Object.fromEntries(list.map((x) => [x.key, x])) };
        listeners.forEach((fn) => fn(cache));
        return cache;
    }).catch((err) => { inflight = null; throw err; });
    return inflight;
}

export default function useMarketRules() {
    const [data, setData] = useState(cache);
    const [state, setState] = useState(cache ? 'ok' : 'loading');

    useEffect(() => {
        const onChange = (c) => { setData(c); setState('ok'); };
        listeners.add(onChange);
        if (!cache) load().then(onChange).catch(() => setState('error'));
        return () => { listeners.delete(onChange); };
    }, []);

    const refresh = useCallback(() => load(true).catch(() => setState('error')), []);
    const value = useCallback((key) => data?.byKey?.[key]?.value ?? '—', [data]);

    return { rules: data?.byKey || {}, list: data?.list || [], state, value, refresh };
}
