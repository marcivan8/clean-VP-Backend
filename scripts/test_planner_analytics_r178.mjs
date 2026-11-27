// scripts/test_planner_analytics_r178.mjs — R178: performance analytics in the
// Planner. Runs the REAL calculations (client/src/lib/socialAnalytics.js) and
// the REAL server analytics code against an in-memory database.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

const A = await import('../client/src/lib/socialAnalytics.js');
const NOW = Date.parse('2026-11-27T12:00:00Z');
const D = (d) => `2026-11-${String(d).padStart(2, '0')}`;
const snap = (d, m) => ({ date: D(d), metrics: m });

// A YouTube post published Nov 10 with daily running totals, and an Instagram one.
const yt = { id: 'y1', provider: 'youtube', title: 'Launch', publishedAt: '2026-11-10T09:00:00Z',
    history: [snap(12, { views: 100, likes: 10, comments: 1, shares: 0, averageViewPercentage: 40 }), snap(20, { views: 400, likes: 30, comments: 4, shares: 2, averageViewPercentage: 42 }), snap(25, { views: 600, likes: 50, comments: 5, shares: 3, averageViewPercentage: 45 })] };
yt.metrics = yt.history.at(-1).metrics;
const ig = { id: 'i1', provider: 'instagram', title: 'Reel', publishedAt: '2026-11-22T09:00:00Z',
    history: [snap(23, { views: 50, reach: 40, likes: 5, comments: 0, saved: 2, shares: 1 }), snap(24, { views: 80, reach: 60, likes: 9, comments: 1, saved: 3, shares: 1 }), snap(26, { views: 70, reach: 60, likes: 9, comments: 1, saved: 3, shares: 1 })] };
ig.metrics = ig.history.at(-1).metrics;
const old = { id: 'o1', provider: 'youtube', title: 'Old', publishedAt: '2026-09-01T09:00:00Z', history: [snap(21, { views: 1000, likes: 80 }), snap(26, { views: 1100, likes: 85 })] };
old.metrics = old.history.at(-1).metrics;

console.log('\n§1 the calculations');
{
    const w = A.periodWindow(7, NOW);
    ok(w.from === D(21) && w.to === D(27) && w.days.length === 7, 'a 7-day window ends today');
    ok(A.metricValue({ saved: 3 }, 'saves') === 3 && A.metricValue({}, 'saves') === null, 'saves read the platform field, missing is null not zero');
    const g = A.gainedInPeriod(yt, 'views', D(21), D(27));
    ok(g.value === 200 && !g.approximate, 'gain = last total in the period minus the last total before it (600-400)');
    ok(A.gainedInPeriod(ig, 'views', D(21), D(27)).value === 70, 'a post published inside the period counts all it has');
    const o = A.gainedInPeriod(old, 'views', D(21), D(27));
    ok(o.value === 100 && o.approximate, 'an older post whose stats start inside the period gives a minimum, flagged');
    const tot = A.periodTotals([yt, ig, old], D(21), D(27));
    ok(tot.totals.views === 370 && tot.byProvider.youtube.views === 300 && tot.byProvider.instagram.views === 70, 'period totals add up per platform');
    ok(tot.totals.saves === 3 && tot.byProvider.youtube.saves === null, 'saves exist on Instagram only');
    ok(tot.approximate === true && tot.postsWithData === 3, 'the totals say when part is a minimum');

    const series = A.dailySeries([yt, ig], 'views', A.periodWindow(7, NOW).days);
    const day = (d) => series.series.find(s => s.date === D(d));
    ok(day(25).youtube === 200 && day(23).instagram === 50 && day(24).instagram === 30, 'a day is the change since the previous total; a fresh post counts in full on its first day');
    ok(day(26).instagram === 0, 'a total corrected down by the platform is a zero day, never negative');
    ok(series.max === 200, 'the chart maximum is the biggest day');
    const s2 = A.dailySeries([old], 'views', A.periodWindow(7, NOW).days);
    ok(s2.skippedBaseline && s2.series.find(s => s.date === D(21)).total === 0 && s2.series.find(s => s.date === D(26)).total === 100, "an old post's first total is not counted as one day's views");

    const pl = A.platformSummary([yt, ig, old]);
    ok(pl.youtube.posts === 2 && pl.youtube.views === 1700 && Math.round(pl.youtube.averageWatched) === 45, 'platform summary: lifetime views and average watched');
    ok(pl.instagram.reach === 60 && Math.round(pl.instagram.engagementRate) === Math.round((9 + 1 + 3 + 1) / 70 * 100), 'Instagram reach and engagement per 100 views');

    const posts = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, provider: 'youtube', publishedAt: '2026-11-01T00:00:00Z', metrics: { views: (i + 1) * 100 } }));
    posts.push({ id: 'fresh', provider: 'youtube', publishedAt: '2026-11-26T20:00:00Z', metrics: { views: 1 } });
    const r = A.rankPosts(posts, 'views', { now: NOW });
    ok(r.best.map(p => p.id).join() === 'p5,p4,p3' && r.weakest.map(p => p.id).join() === 'p0,p1,p2', 'best and weakest by views');
    ok(!r.weakest.some(p => p.id === 'fresh'), 'a post from yesterday is new, not weak');
    const few = A.rankPosts(posts.slice(0, 3), 'views', { now: NOW });
    ok(few.weakest.length === 0 && few.best.length === 3, 'with 3 posts nothing is called weak (no post on both lists)');
    const sorted = A.sortPosts([{ id: 'a', metrics: null }, { id: 'b', metrics: { views: 5 } }, { id: 'c', metrics: { views: 9 } }], 'views', 'asc');
    ok(sorted.map(p => p.id).join() === 'b,c,a', 'sorting puts posts without stats last, either direction');
}

console.log('\n§2 the server: history per post, and old posts keep their totals');
{
    const db = {
        social_publications: [{ id: 'pub1', user_id: 'u1', provider: 'youtube', provider_post_id: 'v1', status: 'published', published_at: '2026-09-01T00:00:00Z', title: 'Old' }],
        social_publication_metrics: [
            { publication_id: 'pub1', user_id: 'u1', metric_date: '2026-09-20', metrics: { views: 10 }, captured_at: 'x' },
            { publication_id: 'pub1', user_id: 'u1', metric_date: '2026-09-30', metrics: { views: 50 }, captured_at: 'x' },
            { publication_id: 'pub2', user_id: 'u1', metric_date: '2026-10-01', metrics: { views: 1 }, captured_at: 'x' },
            { publication_id: 'pub2', user_id: 'u1', metric_date: '2026-11-20', metrics: { views: 9 }, captured_at: 'x' },
        ],
        social_edit_recommendations: [],
    };
    function builder(table) {
        const st = { filters: [], op: 'select', limit: null, asc: true, orderCol: null };
        const rows = () => db[table].filter(r => st.filters.every(fn => fn(r)));
        const run = () => {
            if (st.op === 'delete') { const hit = rows(); db[table] = db[table].filter(r => !hit.includes(r)); return { data: null, error: null }; }
            let data = rows().map(r => ({ ...r }));
            if (st.orderCol) data.sort((a, b) => (st.asc ? 1 : -1) * String(a[st.orderCol]).localeCompare(String(b[st.orderCol])));
            if (st.limit) data = data.slice(0, st.limit);
            return { data, error: null };
        };
        const b = {
            select() { return b; }, limit(n) { st.limit = n; return b; },
            order(c, o) { st.orderCol = c; st.asc = o?.ascending !== false; return b; },
            delete() { st.op = 'delete'; return b; },
            eq(c, v) { st.filters.push(r => r[c] === v); return b; },
            in(c, vs) { st.filters.push(r => vs.includes(r[c])); return b; },
            lt(c, v) { st.filters.push(r => r[c] < v); return b; },
            gte(c, v) { st.filters.push(r => r[c] >= v); return b; },
            not(c, op, v) { st.filters.push(r => !(op === 'is' && v === null ? r[c] === null : false)); return b; },
            then(res, rej) { return Promise.resolve(run()).then(res, rej); },
        };
        return b;
    }
    const stub = (rel, exports) => { const p = require.resolve(rel); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
    stub('../config/database.js', { supabaseAdmin: { from: builder } });
    stub('../services/social/accessToken.js', { accessTokenFor: async () => ({ accessToken: 't' }) });
    const S = require('../services/social/analytics.js');

    await S.pruneOldSnapshots('2026-10-28');
    const left = db.social_publication_metrics.map(r => `${r.publication_id}@${r.metric_date}`).sort();
    ok(left.includes('pub1@2026-09-30') && !left.includes('pub1@2026-09-20'), 'a post with no recent stats keeps its latest totals, older rows go');
    ok(left.includes('pub2@2026-11-20') && !left.includes('pub2@2026-10-01'), 'a post with recent stats keeps only rows inside the 30 days');

    const out = await S.getUserAnalytics('u1');
    const post = out.posts.find(p => p.id === 'pub1');
    ok(post && post.metrics?.views === 50, 'the old post still shows its final totals');
    ok(Array.isArray(post.history) && post.history.length === 1 && post.history[0].date === '2026-09-30', 'each post carries its daily totals, oldest first');
}

console.log('\n§3 wiring');
{
    const planner = read('client/src/pages/PlannerPage.jsx');
    ok(/import PerformanceDashboard from '\.\.\/components\/planner\/PerformanceDashboard\.jsx'/.test(planner), 'the Planner imports the dashboard');
    ok(/role="tablist"/.test(planner) && /'performance', <BarChart3/.test(planner) && /get\('view'\) === 'performance'/.test(planner), 'a Calendar / Performance switch, also reachable as ?view=performance');
    ok(/isPro\s*\?\s*<PerformanceDashboard/.test(planner) && /<ProFeatureLock feature="social"/.test(planner), 'Pro only, with the lock below Pro');
    const dash = read('client/src/components/planner/PerformanceDashboard.jsx');
    ok(/authFetch\('\/api\/social\/analytics'\)/.test(dash) && /periodTotals\(/.test(dash) && /dailySeries\(/.test(dash) && /rankPosts\(/.test(dash), 'the dashboard uses the tested calculations on the real endpoint');
    ok(/role="tooltip"/.test(dash) && /Show as table/.test(dash) && /className="vibed-analytics"/.test(dash), 'hover tooltip, a table view, and the validated series colours');
    ok(/recommendations\/generate/.test(dash) && /decide\(r\.id, 'accepted'\)/.test(dash), 'the AI editing suggestions moved with it');
    const shorts = read('client/src/components/ShortsPanel.jsx');
    ok(!/SocialPerformancePanel/.test(shorts) && /navigate\('\/planner\?view=performance'\)/.test(shorts), 'the Shorts tab no longer shows analytics, only a link to the Planner');
    ok(!fs.existsSync(path.join(ROOT, 'client/src/components/SocialPerformancePanel.jsx')), 'the old panel is gone');
    const css = read('client/src/index.css');
    ok(/\.vibed-analytics \{\s*--series-youtube: #00A3B8;\s*--series-instagram: #A857EC;/.test(css) && /\.theme-warm \.vibed-analytics/.test(css), 'series colours per theme');
    for (const l of ['en', 'fr']) {
        const d = JSON.parse(read(`client/src/locales/${l}/dashboard.json`)).planner;
        ok(d.tabPerformance && d.analytics && ['dailyViews', 'best', 'weakest', 'allPosts', 'suggestions', 'lagNote'].every(k => d.analytics[k]), `${l}: the Performance copy exists`);
    }
}

console.log(`\n${'─'.repeat(60)}\nPlanner analytics: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
