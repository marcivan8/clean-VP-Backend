/**
 * client/src/agent/runs/postSchedule.js — when each short of a
 * "shorts_to_posts" run goes out (R179). Pure: no fetch, no store, no DOM.
 *
 * The user chose "best times from my results": the hours of the day at which
 * their own published posts on that platform got the most views. That needs
 * data, so:
 *   - only posts at least 3 days old with a view count are used (a newer
 *     post's views are still climbing and would rank its hour too low);
 *   - a platform needs at least MIN_POSTS such posts, else the fallback hour
 *     (18:00 local) is used and the plan says so;
 *   - an hour is ranked by the MEDIAN views of its posts, so one viral post
 *     does not decide the schedule.
 * Hours only, not weekdays: per-weekday ranking needs several times more posts
 * than most accounts have.
 *
 * Posts are spread one a day per platform from the first slot at least
 * POST_MIN_LEAD_MS ahead; past the platform's last day in the window, a second
 * post that day uses the next-best hour.
 */
import { POST_MIN_LEAD_MS, POST_MAX_AHEAD_MS, POST_PROVIDER } from './goalContract.js';

export const MIN_POSTS = 4;
export const FALLBACK_HOUR = 18;
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_AGE_MS = 3 * DAY_MS;

function median(nums) {
    const a = nums.slice().sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * Ranked local hours for one provider from the Planner's analytics posts.
 * @param {Array<{provider, publishedAt, metrics}>} posts
 * @returns {{ hours: number[], fromData: boolean, sample: number }}
 */
export function bestHours(posts, provider, { now = Date.now(), hourOf = (t) => new Date(t).getHours() } = {}) {
    const byHour = new Map();
    let sample = 0;
    for (const p of posts || []) {
        if (p?.provider !== provider) continue;
        const t = Date.parse(p.publishedAt || '');
        const views = Number(p.metrics?.views);
        if (!Number.isFinite(t) || !Number.isFinite(views) || now - t < MIN_AGE_MS) continue;
        sample += 1;
        const h = hourOf(t);
        if (!byHour.has(h)) byHour.set(h, []);
        byHour.get(h).push(views);
    }
    if (sample < MIN_POSTS) return { hours: [FALLBACK_HOUR], fromData: false, sample };
    const ranked = [...byHour.entries()]
        .map(([h, v]) => ({ h, score: median(v), n: v.length }))
        .sort((a, b) => b.score - a.score || b.n - a.n || a.h - b.h)
        .map(x => x.h);
    return { hours: ranked, fromData: true, sample };
}

/** Local time `hour`:00 on the day `dayOffset` days after `now`'s day. */
function slotAt(now, dayOffset, hour) {
    const d = new Date(now);
    d.setHours(hour, 0, 0, 0);
    d.setDate(d.getDate() + dayOffset);
    return d.getTime();
}

/**
 * A time for each post. Returns the same items with `scheduledAt` (ISO) set,
 * or `problem: 'no_slot'` when the window is full.
 * @param {Array<{key, provider}>} items   in the order they should go out
 * @param {Record<string, number[]>} hoursByProvider  ranked hours per provider
 */
export function planSlots(items, hoursByProvider, { now = Date.now() } = {}) {
    const used = new Set();
    const earliest = now + POST_MIN_LEAD_MS;
    const latest = now + POST_MAX_AHEAD_MS;
    const nextDay = {};
    return (items || []).map((item) => {
        if (!item?.provider) return item;
        const hours = (hoursByProvider?.[item.provider] || []).length ? hoursByProvider[item.provider] : [FALLBACK_HOUR];
        // First pass: one a day at the best hour. Second: the next hours on
        // days already used, earliest first.
        for (let rank = 0; rank < hours.length; rank += 1) {
            for (let day = rank === 0 ? (nextDay[item.provider] || 0) : 0; day <= 7; day += 1) {
                const t = slotAt(now, day, hours[rank]);
                if (t < earliest) continue;
                if (t > latest) break;
                const k = `${item.provider}@${t}`;
                if (used.has(k)) continue;
                used.add(k);
                if (rank === 0) nextDay[item.provider] = day + 1;
                return { ...item, scheduledAt: new Date(t).toISOString(), problem: item.problem || null };
            }
        }
        return { ...item, scheduledAt: null, problem: item.problem || 'no_slot' };
    });
}

/** Is an ISO time inside the window a post may be scheduled in? */
export function inPostWindow(iso, now = Date.now()) {
    const t = Date.parse(iso || '');
    return Number.isFinite(t) && t >= now + 60 * 1000 && t <= now + POST_MAX_AHEAD_MS + 60 * 60 * 1000;
}

/**
 * The schedule to approve, before its copy is written: one post per finished
 * short, on the provider its platform posts to, with what blocks it.
 * @param {Array<{id, platform, title}>} shorts   finished, in the order they rank
 * @param {Array<{id, connection}>|null} destinations  from /api/social/accounts
 * @param {Array} analyticsPosts  from /api/social/analytics (may be empty)
 * @returns {{ posts: object[], timing: Record<string, {fromData, sample}> }}
 */
export function draftSchedule(shorts, destinations, analyticsPosts, { now = Date.now(), hourOf } = {}) {
    const dest = new Map((destinations || []).map(d => [d.id, d]));
    const items = (shorts || []).map((s) => {
        const provider = POST_PROVIDER[s.platform] ?? null;
        const d = provider ? dest.get(provider) : null;
        let problem = null;
        if (!provider) problem = 'unsupported';
        else if (!d?.connection) problem = 'not_connected';
        else if (d.connection.needsReconnect) problem = 'reconnect';
        return { key: `${s.id}:${provider || s.platform}`, shortId: s.id, platform: s.platform, provider, title: String(s.title || '').slice(0, 100), caption: '', problem, skip: problem === 'unsupported' };
    });
    const timing = {};
    const hours = {};
    for (const provider of new Set(items.map(i => i.provider).filter(Boolean))) {
        const b = bestHours(analyticsPosts, provider, { now, ...(hourOf ? { hourOf } : {}) });
        hours[provider] = b.hours;
        timing[provider] = { fromData: b.fromData, sample: b.sample, hour: b.hours[0] };
    }
    const posts = planSlots(items, hours, { now }).map(p => ({ ...p, timeFromData: !!(p.provider && timing[p.provider]?.fromData) }));
    return { posts, timing };
}

/**
 * Re-check a drafted schedule against the accounts as they are now (after the
 * user connected one). Only the connection problems change.
 */
export function refreshProblems(posts, destinations) {
    const dest = new Map((destinations || []).map(d => [d.id, d]));
    return (posts || []).map((p) => {
        if (!p.provider || p.problem === 'no_slot') return p;
        const d = dest.get(p.provider);
        const problem = !d?.connection ? 'not_connected' : d.connection.needsReconnect ? 'reconnect' : null;
        return { ...p, problem };
    });
}

export default { MIN_POSTS, FALLBACK_HOUR, bestHours, planSlots, inPostWindow, draftSchedule, refreshProblems };
