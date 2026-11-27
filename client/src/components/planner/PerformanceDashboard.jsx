/**
 * client/src/components/planner/PerformanceDashboard.jsx — the Planner's
 * "Performance" tab (R178): what the posts published through Vibed did.
 *
 * Every number comes from GET /api/social/analytics, which returns each post's
 * daily running totals collected from YouTube and Instagram. The maths lives in
 * lib/socialAnalytics.js (pure, tested). Pro only; the server refuses it below
 * Pro too (R167).
 *
 * Chart colours are validated series tokens (--series-youtube / -instagram in
 * index.css, one step per theme); text never wears a series colour.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Check, Loader2, RefreshCw, Sparkles, Table2, X, ArrowUp, ArrowDown } from 'lucide-react';
import { authFetch } from '../../utils/authFetch.js';
import {
    PROVIDERS, TOTAL_METRICS, periodWindow, periodTotals, dailySeries, platformSummary,
    rankPosts, sortPosts, metricValue, engagementRate,
} from '../../lib/socialAnalytics.js';

const surface = { background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.09)', borderRadius: 12 };
const chip = (on) => ({
    padding: '5px 11px', borderRadius: 999, fontSize: 12, cursor: 'pointer',
    border: `0.5px solid ${on ? 'color-mix(in oklch, var(--accent) 45%, transparent)' : 'var(--line, rgba(255,255,255,0.12))'}`,
    background: on ? 'color-mix(in oklch, var(--accent) 16%, transparent)' : 'transparent',
    color: on ? 'var(--fg)' : 'var(--fg-3)', fontWeight: on ? 600 : 400,
});
const SERIES = { youtube: 'var(--series-youtube)', instagram: 'var(--series-instagram)' };
const LABEL = { youtube: 'YouTube', instagram: 'Instagram' };

function fmt(n, digits = 0) {
    if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(Number(n));
}
function compact(n) {
    if (!Number.isFinite(Number(n))) return '—';
    return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(Number(n));
}
const pct = (n) => (n === null || n === undefined ? '—' : `${fmt(n, 1)}%`);

export default function PerformanceDashboard({ t, isMobile }) {
    const [data, setData] = useState({ posts: [], recommendations: [] });
    const [state, setState] = useState({ loading: true, error: null });
    const [busy, setBusy] = useState('');
    const [days, setDays] = useState(30);
    const [provider, setProvider] = useState('all');
    const [sort, setSort] = useState({ key: 'views', dir: 'desc' });
    const [showTable, setShowTable] = useState(false);
    const [hover, setHover] = useState(null);
    const L = (key, fallback, opts) => t(`planner.analytics.${key}`, { defaultValue: fallback, ...(opts || {}) });

    const load = useCallback(async () => {
        setState(s => ({ ...s, loading: true, error: null }));
        try {
            const res = await authFetch('/api/social/analytics');
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || 'ANALYTICS_UNAVAILABLE');
            setData({ posts: Array.isArray(body.posts) ? body.posts : [], recommendations: Array.isArray(body.recommendations) ? body.recommendations : [] });
            setState({ loading: false, error: null });
        } catch (err) {
            setState({ loading: false, error: err.message || 'ANALYTICS_UNAVAILABLE' });
        }
    }, []);
    useEffect(() => { load(); }, [load]);

    const posts = useMemo(() => (provider === 'all' ? data.posts : data.posts.filter(p => p.provider === provider)), [data.posts, provider]);
    const win = useMemo(() => periodWindow(days), [days]);
    const totals = useMemo(() => periodTotals(posts, win.from, win.to), [posts, win]);
    const chart = useMemo(() => dailySeries(posts, 'views', win.days), [posts, win]);
    const platforms = useMemo(() => platformSummary(data.posts), [data.posts]);
    const ranking = useMemo(() => rankPosts(posts, 'views'), [posts]);
    const sorted = useMemo(() => sortPosts(posts, sort.key, sort.dir), [posts, sort]);
    const measured = data.posts.filter(p => p.metrics).length;
    const shownProviders = provider === 'all' ? PROVIDERS : [provider];

    const generate = async () => {
        setBusy('generate');
        try {
            const res = await authFetch('/api/social/analytics/recommendations/generate', { method: 'POST', body: '{}' });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || 'RECOMMENDATION_GENERATION_FAILED');
            await load();
        } catch (err) { setState(s => ({ ...s, error: err.message })); }
        finally { setBusy(''); }
    };
    const decide = async (id, status) => {
        setBusy(id);
        try {
            const res = await authFetch(`/api/social/analytics/recommendations/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || 'RECOMMENDATION_UPDATE_FAILED');
            await load();
        } catch (err) { setState(s => ({ ...s, error: err.message })); }
        finally { setBusy(''); }
    };

    if (state.loading && !data.posts.length) {
        return <div style={{ ...surface, padding: 28, textAlign: 'center', color: 'var(--fg-3)' }}><Loader2 size={18} className="animate-spin" /></div>;
    }
    if (!state.loading && !data.posts.length) {
        return (
            <div style={{ ...surface, padding: 28, textAlign: 'center' }}>
                <BarChart3 size={22} color="var(--fg-3)" />
                <p style={{ margin: '10px 0 0', color: 'var(--fg-2)', fontSize: 14 }}>{L('empty', 'Publish a video through Vibed to start collecting performance data.')}</p>
                {state.error && <p role="alert" style={{ margin: '8px 0 0', color: 'var(--coral, #ff6b6b)', fontSize: 12 }}>{L('loadFailed', 'Analytics could not be loaded.')} ({state.error})</p>}
            </div>
        );
    }

    const tiles = TOTAL_METRICS.map(m => ({
        key: m,
        label: L(`metric.${m}`, { views: 'Views', likes: 'Likes', comments: 'Comments', shares: 'Shares', saves: 'Saves' }[m]),
        value: totals.totals[m],
        split: shownProviders.map(p => ({ p, v: totals.byProvider[p]?.[m] })).filter(x => x.v !== null && x.v !== undefined),
        note: m === 'saves' ? L('instagramOnly', 'Instagram only') : null,
    }));

    // ── chart geometry ──
    const W = 720, H = 200, padL = 40, padR = 8, padT = 10, padB = 24;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const n = chart.series.length;
    const step = plotW / Math.max(1, n);
    const barW = Math.max(3, Math.min(22, step - 2));
    const yMax = niceMax(chart.max);
    const y = (v) => padT + plotH - (yMax ? (v / yMax) * plotH : 0);
    const labelEvery = Math.ceil(n / (isMobile ? 5 : 8));

    const headerCell = (key, label, align = 'right') => (
        <th scope="col" style={{ padding: '8px 10px', textAlign: align, fontWeight: 600, fontSize: 11.5, color: 'var(--fg-3)', whiteSpace: 'nowrap' }}>
            <button type="button" onClick={() => setSort(s => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))}
                style={{ background: 'none', border: 'none', color: 'inherit', font: 'inherit', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3, padding: 0 }}
                aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                {label}{sort.key === key && (sort.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
            </button>
        </th>
    );

    return (
        <div className="vibed-analytics" style={{ display: 'grid', gap: 14 }}>
            {/* filters, one row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {[7, 30].map(d => <button key={d} type="button" style={chip(days === d)} aria-pressed={days === d} onClick={() => setDays(d)}>{L('lastDays', `Last ${d} days`, { count: d })}</button>)}
                <span style={{ width: 1, height: 18, background: 'var(--line, rgba(255,255,255,0.12))', margin: '0 4px' }} />
                {['all', ...PROVIDERS].map(p => <button key={p} type="button" style={chip(provider === p)} aria-pressed={provider === p} onClick={() => setProvider(p)}>{p === 'all' ? L('allPlatforms', 'All platforms') : LABEL[p]}</button>)}
                <button type="button" onClick={load} disabled={state.loading} title={L('refresh', 'Refresh')} aria-label={L('refresh', 'Refresh')}
                    style={{ ...chip(false), marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {state.loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                </button>
            </div>

            {state.error && <p role="alert" style={{ margin: 0, color: 'var(--coral, #ff6b6b)', fontSize: 12.5 }}>{L('loadFailed', 'Analytics could not be loaded.')} ({state.error})</p>}

            {/* KPI tiles */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0,1fr))' : 'repeat(5, minmax(0,1fr))', gap: 10 }}>
                {tiles.map(tile => (
                    <div key={tile.key} style={{ ...surface, padding: '12px 14px' }}>
                        <div style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>{tile.label}</div>
                        <div style={{ fontSize: 24, fontWeight: 650, color: 'var(--fg)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{tile.value === null ? '—' : compact(tile.value)}</div>
                        <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4, minHeight: 15 }}>
                            {tile.note || (provider === 'all' && tile.split.length > 1 ? tile.split.map(x => `${LABEL[x.p]} ${compact(x.v)}`).join(' · ') : '')}
                        </div>
                    </div>
                ))}
            </div>
            <p style={{ margin: '-4px 0 0', fontSize: 11.5, color: 'var(--fg-3)' }}>
                {L('periodNote', 'Gained in the last {{count}} days, across {{posts}} post(s) with stats.', { count: days, posts: totals.postsWithData })}
                {totals.approximate ? ` ${L('approximateNote', 'Some posts only have stats from inside this period, so their share is a minimum.')}` : ''}
            </p>

            {/* daily views */}
            <div style={{ ...surface, padding: '14px 14px 10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
                    <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{L('dailyViews', 'Views per day')}</h2>
                    {shownProviders.length > 1 && (
                        <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--fg-2)' }} aria-label={L('legend', 'Legend')}>
                            {shownProviders.map(p => <span key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: SERIES[p] }} />{LABEL[p]}</span>)}
                        </div>
                    )}
                    <button type="button" onClick={() => setShowTable(v => !v)} style={{ ...chip(showTable), marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <Table2 size={13} /> {showTable ? L('showChart', 'Show chart') : L('showTable', 'Show as table')}
                    </button>
                </div>
                {showTable ? (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                            <thead><tr>
                                <th scope="col" style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--fg-3)', fontWeight: 600 }}>{L('date', 'Date')}</th>
                                {shownProviders.map(p => <th key={p} scope="col" style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--fg-3)', fontWeight: 600 }}>{LABEL[p]}</th>)}
                                <th scope="col" style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--fg-3)', fontWeight: 600 }}>{L('total', 'Total')}</th>
                            </tr></thead>
                            <tbody>{chart.series.slice().reverse().map(d => (
                                <tr key={d.date} style={{ borderTop: '0.5px solid var(--line-soft, rgba(255,255,255,0.06))' }}>
                                    <td style={{ padding: '6px 8px' }}>{new Date(`${d.date}T12:00:00Z`).toLocaleDateString()}</td>
                                    {shownProviders.map(p => <td key={p} style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(d[p])}</td>)}
                                    <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt(d.total)}</td>
                                </tr>
                            ))}</tbody>
                        </table>
                    </div>
                ) : chart.max === 0 ? (
                    <p style={{ margin: '24px 0', textAlign: 'center', fontSize: 13, color: 'var(--fg-3)' }}>{L('noDailyData', 'No views recorded in this period yet. Platforms report with a delay of one to two days.')}</p>
                ) : (
                    <div style={{ position: 'relative' }} onMouseLeave={() => setHover(null)}>
                        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={L('dailyViews', 'Views per day')} style={{ display: 'block' }}>
                            {[0, 0.5, 1].map(f => (
                                <g key={f}>
                                    <line x1={padL} x2={W - padR} y1={y(yMax * f)} y2={y(yMax * f)} stroke="var(--line-soft, rgba(255,255,255,0.07))" strokeWidth="1" />
                                    <text x={padL - 6} y={y(yMax * f) + 4} textAnchor="end" fontSize="10" fill="var(--fg-3)">{compact(yMax * f)}</text>
                                </g>
                            ))}
                            {chart.series.map((d, i) => {
                                const x = padL + i * step + (step - barW) / 2;
                                let base = d.total;
                                const segs = shownProviders.map((p) => {
                                    const top = base; base -= d[p];
                                    return { p, y0: y(top), y1: y(base) };
                                }).filter(s => s.y1 - s.y0 > 0.5);
                                return (
                                    <g key={d.date}>
                                        {segs.map((s, k) => {
                                            const h = Math.max(1, s.y1 - s.y0 - (k < segs.length - 1 ? 2 : 0)); // 2px surface gap between stacked segments
                                            const r = k === 0 ? Math.min(4, barW / 2, h) : 0;
                                            return <path key={s.p} d={roundedTop(x, s.y0, barW, h, r)} fill={SERIES[s.p]} opacity={hover && hover.date !== d.date ? 0.55 : 1} />;
                                        })}
                                        {/* hit target larger than the bar */}
                                        <rect x={padL + i * step} y={padT} width={step} height={plotH} fill="transparent"
                                            onMouseEnter={() => setHover({ ...d, x: padL + i * step + step / 2 })} />
                                        {i % labelEvery === 0 && (
                                            <text x={x + barW / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--fg-3)">
                                                {new Date(`${d.date}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                                            </text>
                                        )}
                                    </g>
                                );
                            })}
                            <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} stroke="var(--line, rgba(255,255,255,0.14))" strokeWidth="1" />
                        </svg>
                        {hover && (
                            <div role="tooltip" style={{ position: 'absolute', top: 6, left: `${Math.min(78, Math.max(2, (hover.x / W) * 100))}%`, transform: 'translateX(-50%)', pointerEvents: 'none', background: 'var(--bg-2, #090C12)', border: '0.5px solid var(--line, rgba(255,255,255,0.14))', borderRadius: 8, padding: '7px 10px', fontSize: 12, color: 'var(--fg)', whiteSpace: 'nowrap', boxShadow: '0 6px 20px rgba(0,0,0,0.35)' }}>
                                <div style={{ color: 'var(--fg-3)', marginBottom: 3 }}>{new Date(`${hover.date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</div>
                                {shownProviders.map(p => <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: SERIES[p] }} />{LABEL[p]} <b style={{ marginLeft: 'auto', paddingLeft: 12 }}>{fmt(hover[p])}</b></div>)}
                                {shownProviders.length > 1 && <div style={{ borderTop: '0.5px solid var(--line-soft, rgba(255,255,255,0.08))', marginTop: 4, paddingTop: 4 }}>{L('total', 'Total')} <b style={{ float: 'right', paddingLeft: 12 }}>{fmt(hover.total)}</b></div>}
                            </div>
                        )}
                    </div>
                )}
                <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--fg-3)' }}>{L('lagNote', 'Stats are collected once a day. YouTube reports two days behind; Instagram can take up to 48 hours.')}</p>
            </div>

            {/* platform comparison */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
                {PROVIDERS.map(p => {
                    const s = platforms[p];
                    return (
                        <div key={p} style={{ ...surface, padding: '12px 14px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 13.5 }}>
                                <span style={{ width: 10, height: 10, borderRadius: 3, background: SERIES[p] }} />{LABEL[p]}
                                <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--fg-3)', fontWeight: 400 }}>{L('postsMeasured', '{{measured}} of {{posts}} posts with stats', { measured: s.measured, posts: s.posts })}</span>
                            </div>
                            <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8, margin: '10px 0 0' }}>
                                <Stat label={L('lifetimeViews', 'Total views')} value={s.measured ? compact(s.views) : '—'} />
                                {p === 'youtube'
                                    ? <Stat label={L('avgWatched', 'Average watched')} value={pct(s.averageWatched)} />
                                    : <Stat label={L('reach', 'Accounts reached')} value={s.measured ? compact(s.reach) : '—'} />}
                                <Stat label={L('engagement', 'Engagement')} value={pct(s.engagementRate)} hint={L('engagementHint', 'Likes, comments, shares and saves per 100 views')} />
                            </dl>
                        </div>
                    );
                })}
            </div>

            {/* best and weakest */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
                <RankList title={L('best', 'Best posts')} posts={ranking.best} empty={L('rankEmpty', 'Needs posts at least 3 days old with stats.')} L={L} />
                <RankList title={L('weakest', 'Weakest posts')} posts={ranking.weakest} empty={L('weakestEmpty', 'Shown once 4 posts at least 3 days old have stats.')} L={L} />
            </div>

            {/* every post */}
            <div style={{ ...surface, padding: 0, overflow: 'hidden' }}>
                <h2 style={{ margin: 0, padding: '12px 14px 4px', fontSize: 14, fontWeight: 600 }}>{L('allPosts', 'All posts')} <span style={{ color: 'var(--fg-3)', fontWeight: 400, fontSize: 12 }}>· {L('lifetimeNote', 'totals to date')}</span></h2>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 720 }}>
                        <thead><tr>
                            {headerCell('title', L('post', 'Post'), 'left')}
                            {headerCell('publishedAt', L('published', 'Published'))}
                            {headerCell('views', L('metric.views', 'Views'))}
                            {headerCell('likes', L('metric.likes', 'Likes'))}
                            {headerCell('comments', L('metric.comments', 'Comments'))}
                            {headerCell('shares', L('metric.shares', 'Shares'))}
                            {headerCell('saves', L('metric.saves', 'Saves'))}
                            {headerCell('watch', L('avgWatched', 'Average watched'))}
                            {headerCell('engagement', L('engagement', 'Engagement'))}
                        </tr></thead>
                        <tbody>{sorted.map(p => (
                            <tr key={p.id} style={{ borderTop: '0.5px solid var(--line-soft, rgba(255,255,255,0.06))' }}>
                                <td style={{ padding: '8px 10px', maxWidth: 260 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                                        <span title={LABEL[p.provider]} style={{ width: 8, height: 8, borderRadius: 2, background: SERIES[p.provider] || 'var(--fg-3)', flexShrink: 0 }} />
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title || L('untitled', 'Untitled video')}</span>
                                    </div>
                                    {!p.metrics && <div style={{ fontSize: 11, color: p.analyticsError ? 'var(--coral, #ff6b6b)' : 'var(--fg-3)', marginTop: 2 }}>
                                        {p.analyticsError ? L('statsError', 'Stats could not be read ({{code}})', { code: p.analyticsError }) : L('collecting', 'Collecting stats…')}
                                    </div>}
                                </td>
                                <td style={cell}>{p.publishedAt ? new Date(p.publishedAt).toLocaleDateString() : '—'}</td>
                                {['views', 'likes', 'comments', 'shares', 'saves'].map(m => <td key={m} style={cell}>{fmt(metricValue(p.metrics, m))}</td>)}
                                <td style={cell}>{pct(metricValue(p.metrics, 'averageViewPercentage'))}</td>
                                <td style={cell}>{pct(engagementRate(p))}</td>
                            </tr>
                        ))}</tbody>
                    </table>
                </div>
            </div>

            {/* AI suggestions, moved here from the Shorts tab */}
            <div style={{ ...surface, padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{L('suggestions', 'Editing suggestions from your results')}</h2>
                    <button type="button" onClick={generate} disabled={busy !== '' || measured < 3}
                        style={{ ...chip(true), marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, opacity: measured < 3 ? 0.5 : 1 }}>
                        {busy === 'generate' ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {L('analyze', 'Analyze and suggest edits')}
                    </button>
                </div>
                <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--fg-3)' }}>
                    {measured < 3 ? L('needThree', 'Needs 3 posts with stats ({{count}} so far).', { count: measured }) : L('suggestionsHint', 'Accepted suggestions are applied to the next shorts you finish.')}
                </p>
                <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                    {data.recommendations.filter(r => r.status !== 'dismissed').slice(0, 6).map(r => (
                        <div key={r.id} style={{ border: '0.5px solid var(--line-soft, rgba(255,255,255,0.08))', borderRadius: 10, padding: '9px 11px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                            <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ fontSize: 13, fontWeight: 600 }}>{r.title}</div>
                                <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 2 }}>{r.rationale}</div>
                                {r.status === 'accepted' && <div style={{ fontSize: 11.5, color: 'var(--fg-2)', marginTop: 4, display: 'inline-flex', gap: 4, alignItems: 'center' }}><Check size={12} /> {L('accepted', 'Used for your next shorts')}</div>}
                            </div>
                            {r.status === 'pending' && (
                                <div style={{ display: 'flex', gap: 4 }}>
                                    <button type="button" onClick={() => decide(r.id, 'accepted')} disabled={busy !== ''} title={L('accept', 'Use for future edits')} aria-label={L('accept', 'Use for future edits')} style={{ ...chip(false), padding: 6 }}><Check size={14} /></button>
                                    <button type="button" onClick={() => decide(r.id, 'dismissed')} disabled={busy !== ''} title={L('dismiss', 'Dismiss')} aria-label={L('dismiss', 'Dismiss')} style={{ ...chip(false), padding: 6 }}><X size={14} /></button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

const cell = { padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

function Stat({ label, value, hint }) {
    return (
        <div title={hint || undefined}>
            <dt style={{ fontSize: 11, color: 'var(--fg-3)' }}>{label}</dt>
            <dd style={{ margin: '2px 0 0', fontSize: 17, fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>{value}</dd>
        </div>
    );
}

function RankList({ title, posts, empty, L }) {
    return (
        <div style={{ ...surface, padding: '12px 14px' }}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{title}</h2>
            {posts.length === 0 ? <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--fg-3)' }}>{empty}</p> : (
                <ol style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
                    {posts.map(p => (
                        <li key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                            <span style={{ width: 8, height: 8, borderRadius: 2, background: SERIES[p.provider] || 'var(--fg-3)', flexShrink: 0 }} />
                            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title || L('untitled', 'Untitled video')}</span>
                            <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--fg-2)' }}>{compact(metricValue(p.metrics, 'views'))} {L('viewsShort', 'views')}</span>
                        </li>
                    ))}
                </ol>
            )}
        </div>
    );
}

/** A rounded top on a bar anchored to the baseline (4px data end). */
function roundedTop(x, y, w, h, r) {
    if (r <= 0) return `M${x},${y}h${w}v${h}h${-w}z`;
    return `M${x},${y + r}a${r},${r} 0 0 1 ${r},${-r}h${w - 2 * r}a${r},${r} 0 0 1 ${r},${r}v${h - r}h${-w}z`;
}

/** A round axis maximum just above the data (1, 2, 2.5, 5 × 10^n). */
function niceMax(v) {
    if (!(v > 0)) return 0;
    const exp = Math.floor(Math.log10(v));
    const base = 10 ** exp;
    for (const m of [1, 2, 2.5, 5, 10]) if (m * base >= v) return m * base;
    return 10 * base;
}
