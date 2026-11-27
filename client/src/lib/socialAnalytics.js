/**
 * client/src/lib/socialAnalytics.js — the Planner's performance numbers
 * (R178). Pure: no fetch, no DOM.
 *
 * WHAT THE DATA IS. Once a day the server stores, per published post, the
 * platform's RUNNING TOTALS so far (YouTube Analytics from publish date to two
 * days ago; Instagram lifetime insights). So "views in the last 7 days" is the
 * difference between the last total in the period and the last total before
 * it, never a sum of snapshots. Nothing here is estimated: when a post has no
 * total from before the period (its stats started inside it), what it gained
 * cannot be split exactly and the result says so (`approximate`).
 */

export const PROVIDERS = ['youtube', 'instagram'];

/** The metrics shown as totals, in display order. `saves` exists on Instagram only. */
export const TOTAL_METRICS = ['views', 'likes', 'comments', 'shares', 'saves'];

const DAY_MS = 24 * 60 * 60 * 1000;

export function dayKey(date) {
    return new Date(date).toISOString().slice(0, 10);
}

/** The value of one metric in a stored snapshot, or null when the platform does not report it. */
export function metricValue(metrics, metric) {
    if (!metrics || typeof metrics !== 'object') return null;
    const key = metric === 'saves' ? 'saved' : metric;
    const n = Number(metrics[key]);
    return Number.isFinite(n) ? n : null;
}

/** Inclusive date window ending today: { from, to, days[] } as YYYY-MM-DD. */
export function periodWindow(days, now = Date.now()) {
    const n = Math.max(1, Math.min(60, Math.round(Number(days) || 7)));
    const to = dayKey(now);
    const list = [];
    for (let i = n - 1; i >= 0; i -= 1) list.push(dayKey(new Date(now).getTime() - i * DAY_MS));
    return { from: list[0], to, days: list };
}

function historyOf(post) {
    const rows = Array.isArray(post?.history) ? post.history : [];
    return rows.filter(r => r && typeof r.date === 'string').slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function publishedDay(post) {
    const t = Date.parse(post?.publishedAt || '');
    return Number.isFinite(t) ? dayKey(t) : null;
}

/**
 * What one post gained on one metric between `from` and `to` (inclusive).
 * @returns {{ value: number|null, approximate: boolean }}
 */
export function gainedInPeriod(post, metric, from, to) {
    const rows = historyOf(post);
    const end = [...rows].reverse().find(r => r.date <= to && metricValue(r.metrics, metric) !== null);
    if (!end) return { value: null, approximate: false };
    const endValue = metricValue(end.metrics, metric);
    const before = [...rows].reverse().find(r => r.date < from && metricValue(r.metrics, metric) !== null);
    if (before) return { value: Math.max(0, endValue - metricValue(before.metrics, metric)), approximate: false };
    const pub = publishedDay(post);
    // Published inside the period: everything it has was gained in it.
    if (pub && pub >= from) return { value: endValue, approximate: false };
    // Older post whose stats only start inside the period: the split is unknown.
    // Counting its whole total would inflate the period, so count what changed
    // from its first total inside the period and say it is a lower bound.
    const first = rows.find(r => r.date >= from && r.date <= to && metricValue(r.metrics, metric) !== null);
    return { value: Math.max(0, endValue - metricValue(first.metrics, metric)), approximate: true };
}

/**
 * Period totals: overall, per platform, and how many posts contributed.
 * @returns {{ totals, byProvider, approximate, postsWithData }}
 */
export function periodTotals(posts, from, to) {
    const totals = Object.fromEntries(TOTAL_METRICS.map(m => [m, null]));
    const byProvider = Object.fromEntries(PROVIDERS.map(p => [p, Object.fromEntries(TOTAL_METRICS.map(m => [m, null]))]));
    let approximate = false;
    let postsWithData = 0;
    for (const post of posts || []) {
        let contributed = false;
        for (const m of TOTAL_METRICS) {
            const g = gainedInPeriod(post, m, from, to);
            if (g.value === null) continue;
            contributed = true;
            if (g.approximate) approximate = true;
            totals[m] = (totals[m] || 0) + g.value;
            if (byProvider[post.provider]) byProvider[post.provider][m] = (byProvider[post.provider][m] || 0) + g.value;
        }
        if (contributed) postsWithData += 1;
    }
    return { totals, byProvider, approximate, postsWithData };
}

/**
 * Daily gains of one metric, per platform, for each day of the window.
 * A day's gain is the change in a post's running total since its previous
 * stored total. A post's first total counts in full only when it was
 * published within the last 3 days before it (its stats then cover its whole
 * life); otherwise its baseline is unknown and that first day is skipped.
 * @returns {{ series: Array<{date, youtube, instagram, total}>, max: number, skippedBaseline: boolean }}
 */
export function dailySeries(posts, metric, days) {
    const byDate = new Map(days.map(d => [d, { date: d, youtube: 0, instagram: 0, total: 0 }]));
    let skippedBaseline = false;
    for (const post of posts || []) {
        if (!PROVIDERS.includes(post.provider)) continue;
        const rows = historyOf(post).filter(r => metricValue(r.metrics, metric) !== null);
        const pub = publishedDay(post);
        rows.forEach((row, i) => {
            const slot = byDate.get(row.date);
            if (!slot) return;
            let gain;
            if (i > 0) gain = metricValue(row.metrics, metric) - metricValue(rows[i - 1].metrics, metric);
            else if (pub && (Date.parse(row.date) - Date.parse(pub)) <= 3 * DAY_MS) gain = metricValue(row.metrics, metric);
            else { skippedBaseline = true; return; }
            gain = Math.max(0, gain); // a platform correcting a total down is not a negative day
            slot[post.provider] += gain;
            slot.total += gain;
        });
    }
    const series = days.map(d => byDate.get(d));
    return { series, max: Math.max(0, ...series.map(s => s.total)), skippedBaseline };
}

/** Lifetime figures per platform from each post's latest totals. */
export function platformSummary(posts) {
    const out = {};
    for (const p of PROVIDERS) {
        const list = (posts || []).filter(x => x.provider === p);
        const measured = list.filter(x => x.metrics);
        const sum = (m) => measured.reduce((s, x) => s + (metricValue(x.metrics, m) || 0), 0);
        const views = sum('views');
        const interactions = sum('likes') + sum('comments') + sum('shares') + sum('saves');
        const watch = measured.map(x => metricValue(x.metrics, 'averageViewPercentage')).filter(v => v !== null);
        out[p] = {
            posts: list.length,
            measured: measured.length,
            views,
            reach: p === 'instagram' ? sum('reach') : null,
            engagementRate: views > 0 ? (interactions / views) * 100 : null,
            averageWatched: watch.length ? watch.reduce((a, b) => a + b, 0) / watch.length : null,
        };
    }
    return out;
}

/** A post's interactions per 100 views from its latest totals, or null. */
export function engagementRate(post) {
    const m = post?.metrics;
    const views = metricValue(m, 'views');
    if (!views) return null;
    const total = ['likes', 'comments', 'shares', 'saves'].reduce((s, k) => s + (metricValue(m, k) || 0), 0);
    return (total / views) * 100;
}

/**
 * Best and weakest posts by a metric, among posts with stats that are at
 * least `minAgeDays` old (a post from yesterday is not "weak", it is new).
 * Weakest is empty until there are 4 such posts, so a post never appears on
 * both lists.
 */
export function rankPosts(posts, metric = 'views', { minAgeDays = 3, now = Date.now(), size = 3 } = {}) {
    const eligible = (posts || []).filter(p => {
        const t = Date.parse(p.publishedAt || '');
        return p.metrics && metricValue(p.metrics, metric) !== null && Number.isFinite(t) && now - t >= minAgeDays * DAY_MS;
    }).sort((a, b) => metricValue(b.metrics, metric) - metricValue(a.metrics, metric));
    const best = eligible.slice(0, size);
    const weakest = eligible.length >= size + 1 ? eligible.slice(-Math.min(size, eligible.length - size)).reverse() : [];
    return { best, weakest, eligible: eligible.length };
}

/** Sort posts for the table by a column; missing values always sort last. */
export function sortPosts(posts, key, dir = 'desc') {
    const val = (p) => {
        if (key === 'publishedAt') { const t = Date.parse(p.publishedAt || ''); return Number.isFinite(t) ? t : null; }
        if (key === 'title') return String(p.title || '').toLowerCase();
        if (key === 'engagement') return engagementRate(p);
        if (key === 'watch') return metricValue(p.metrics, 'averageViewPercentage');
        return metricValue(p.metrics, key);
    };
    const sign = dir === 'asc' ? 1 : -1;
    return (posts || []).slice().sort((a, b) => {
        const va = val(a), vb = val(b);
        if (va === null && vb === null) return 0;
        if (va === null) return 1;
        if (vb === null) return -1;
        return va < vb ? -sign : va > vb ? sign : 0;
    });
}

export default { PROVIDERS, TOTAL_METRICS, dayKey, metricValue, periodWindow, gainedInPeriod, periodTotals, dailySeries, platformSummary, engagementRate, rankPosts, sortPosts };
