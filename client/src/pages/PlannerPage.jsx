/**
 * client/src/pages/PlannerPage.jsx — the posting planner at /planner (R172).
 *
 * One calendar for every scheduled, to-post-by-hand and published post across
 * all projects. Posts are created from the Shorts panel (SocialPublisher); here
 * they are seen, moved, cancelled and, when the automatic publish fell back to
 * a reminder, marked as posted by hand.
 *
 *   GET    /api/social/calendar?from&to     the month's posts (+ metrics on Pro)
 *   PATCH  /api/social/publications/:id     reschedule (Pro, re-signs the media)
 *   DELETE /api/social/publications/:id     cancel a scheduled post
 *   POST   /api/social/publications/:id/posted   "I posted it myself"
 *
 * Below Pro the page still opens when the user has posts, so someone who left
 * the plan can see and cancel what is queued (the server keeps those routes
 * open for the same reason). With nothing to manage it shows the Pro lock.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, CalendarDays, Check, ChevronLeft, ChevronRight, Film, Loader2, Plus, X } from 'lucide-react';
import SocialPublisher from '../components/SocialPublisher.jsx';
import { probeVideo } from '../lib/socialFormat.js';
import { authFetch } from '../utils/authFetch.js';
import { useUserPlan } from '../hooks/useUserPlan.js';
import useDeviceType from '../hooks/useDeviceType';
import ProFeatureLock from '../components/ProFeatureLock.jsx';
import {
    canScheduleAt, dayKey, gridRange, groupByDay, localInputValue, monthGrid, moveToDay, postActions, postTime,
} from '../lib/socialCalendar.js';

const PROVIDER_COLOR = { youtube: '#ff4d4d', instagram: '#d946ef', tiktok: '#22d3ee' };
const STATUS_COLOR = {
    scheduled: 'var(--accent)', publishing: 'var(--accent)', published: 'var(--mint, #34d399)',
    manual_reminder: 'var(--warning, #f5a524)', failed: 'var(--coral, #ff6b6b)',
};
const PROVIDER_LABEL = { youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok' };

const surface = { background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.09)', borderRadius: 12 };
const ghostBtn = {
    background: 'transparent', color: 'var(--fg-2)', border: '0.5px solid var(--line-strong)', borderRadius: 999,
    padding: '6px 12px', fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
};

async function readError(response, fallback) {
    const body = await response.json().catch(() => ({}));
    return body?.message || body?.error || fallback;
}

export default function PlannerPage() {
    const { t, i18n } = useTranslation('dashboard');
    const navigate = useNavigate();
    const { plan, loading: planLoading } = useUserPlan();
    const { isMobile } = useDeviceType();
    const isPro = plan === 'pro';
    const lang = i18n.language || 'en';

    const today = new Date();
    const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
    const [posts, setPosts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [selectedDay, setSelectedDay] = useState(dayKey(today));
    const [busy, setBusy] = useState(null); // post id being changed
    const [notice, setNotice] = useState(null); // { type, text }
    const [dragId, setDragId] = useState(null);
    const [hasAnyPosts, setHasAnyPosts] = useState(null);
    const [newPostOpen, setNewPostOpen] = useState(false);

    const grid = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
    const byDay = useMemo(() => groupByDay(posts), [posts]);

    const load = useCallback(async () => {
        setLoading(true); setLoadError(null);
        try {
            const { from, to } = gridRange(cursor.year, cursor.month);
            const response = await authFetch(`/api/social/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
            if (!response.ok) throw new Error(await readError(response, 'CALENDAR_UNAVAILABLE'));
            const body = await response.json();
            setPosts(Array.isArray(body.publications) ? body.publications : []);
        } catch (err) {
            console.error('[Planner] load failed:', err.message);
            setLoadError(t('planner.loadError', 'The planner could not load. Try again in a moment.'));
        } finally {
            setLoading(false);
        }
    }, [cursor, t]);

    useEffect(() => { load(); }, [load]);

    // Below Pro, only open the planner when there is something to manage.
    useEffect(() => {
        if (planLoading || isPro) return undefined;
        let cancelled = false;
        authFetch('/api/social/publications')
            .then(r => (r.ok ? r.json() : { publications: [] }))
            .then(body => { if (!cancelled) setHasAnyPosts((body.publications || []).some(p => p.status !== 'cancelled')); })
            .catch(() => { if (!cancelled) setHasAnyPosts(false); });
        return () => { cancelled = true; };
    }, [planLoading, isPro]);

    const replacePost = (updated) => setPosts(list => list.map(p => (p.id === updated.id ? { ...p, ...updated } : p)));

    const reschedule = async (post, isoTime) => {
        if (!canScheduleAt(isoTime)) {
            setNotice({ type: 'error', text: t('planner.outOfRange', 'Pick a time between one minute and six and a half days from now.') });
            return false;
        }
        setBusy(post.id); setNotice(null);
        try {
            const response = await authFetch(`/api/social/publications/${encodeURIComponent(post.id)}`, {
                method: 'PATCH', body: JSON.stringify({ scheduledAt: isoTime }),
            });
            if (!response.ok) throw new Error(await readError(response, t('planner.rescheduleError', 'Could not move this post.')));
            const body = await response.json();
            replacePost(body.publication);
            setSelectedDay(dayKey(body.publication.scheduledAt));
            setNotice({ type: 'ok', text: t('planner.rescheduled', 'Post moved.') });
            return true;
        } catch (err) {
            setNotice({ type: 'error', text: err.message });
            return false;
        } finally {
            setBusy(null);
        }
    };

    const cancel = async (post) => {
        setBusy(post.id); setNotice(null);
        try {
            const response = await authFetch(`/api/social/publications/${encodeURIComponent(post.id)}`, { method: 'DELETE' });
            if (!response.ok) throw new Error(await readError(response, t('planner.cancelError', 'Could not cancel this post.')));
            setPosts(list => list.filter(p => p.id !== post.id));
            setNotice({ type: 'ok', text: t('planner.cancelled', 'Post cancelled.') });
        } catch (err) {
            setNotice({ type: 'error', text: err.message });
        } finally {
            setBusy(null);
        }
    };

    const markPosted = async (post) => {
        setBusy(post.id); setNotice(null);
        try {
            const response = await authFetch(`/api/social/publications/${encodeURIComponent(post.id)}/posted`, { method: 'POST', body: '{}' });
            if (!response.ok) throw new Error(await readError(response, t('planner.markError', 'Could not mark this post as done.')));
            const body = await response.json();
            replacePost(body.publication);
            setNotice({ type: 'ok', text: t('planner.marked', 'Marked as posted.') });
        } catch (err) {
            setNotice({ type: 'error', text: err.message });
        } finally {
            setBusy(null);
        }
    };

    const onDropDay = (key) => {
        const post = posts.find(p => p.id === dragId);
        setDragId(null);
        if (!post || !postActions(post, { isPro }).reschedule) return;
        const target = moveToDay(post.scheduledAt, key);
        if (target && dayKey(target) !== dayKey(post.scheduledAt)) reschedule(post, target);
    };

    const shiftMonth = (delta) => setCursor(c => {
        const d = new Date(c.year, c.month + delta, 1);
        return { year: d.getFullYear(), month: d.getMonth() };
    });

    if (!planLoading && !isPro && hasAnyPosts === false) {
        return <ProFeatureLock feature="planner" required="pro" />;
    }

    const monthLabel = new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' }).format(new Date(cursor.year, cursor.month, 1));
    const weekdays = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(lang, { weekday: isMobile ? 'narrow' : 'short' }).format(new Date(2024, 0, 1 + i)));
    const timeFmt = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' });
    const dayFmt = new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'long' });
    const selectedPosts = byDay.get(selectedDay) || [];
    const todayKey = dayKey(today);
    const counts = posts.reduce((acc, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc; }, {});

    return (
        <>
        {newPostOpen && (
            <NewPostDialog
                t={t}
                isMobile={isMobile}
                onClose={() => setNewPostOpen(false)}
                onScheduled={(post) => {
                    setNewPostOpen(false);
                    setHasAnyPosts(true);
                    if (post?.scheduledAt) {
                        const d = new Date(post.scheduledAt);
                        setCursor({ year: d.getFullYear(), month: d.getMonth() });
                        setSelectedDay(dayKey(d));
                    }
                    setNotice({ type: 'ok', text: t('planner.postCreated', 'Post added to the planner.') });
                    load();
                }}
            />
        )}
        <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--f-sans)', padding: isMobile ? '20px 16px 64px' : '36px 24px 80px', boxSizing: 'border-box' }}>
            <div style={{ maxWidth: 1080, margin: '0 auto' }}>
                <div style={{ height: 1, background: 'linear-gradient(90deg, var(--accent), var(--violet))', marginBottom: 20, borderRadius: 1 }} />
                <button type="button" onClick={() => navigate('/dashboard')} style={{ ...ghostBtn, border: 'none', padding: '4px 0', marginBottom: 12 }}>
                    <ArrowLeft size={14} /> {t('planner.back', 'Projects')}
                </button>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
                    <div>
                        <h1 style={{ fontSize: isMobile ? 24 : 28, fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                            <CalendarDays size={isMobile ? 22 : 26} color="var(--accent)" /> {t('planner.title', 'Planner')}
                        </h1>
                        <p style={{ margin: '6px 0 0', fontSize: 13.5, color: 'var(--fg-3)' }}>
                            {t('planner.subtitle', 'Every scheduled and published post, across all your projects.')}
                        </p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button type="button" aria-label={t('planner.prev', 'Previous month')} onClick={() => shiftMonth(-1)} style={{ ...ghostBtn, padding: 8 }}><ChevronLeft size={16} /></button>
                        <span style={{ minWidth: 150, textAlign: 'center', fontWeight: 600, textTransform: 'capitalize' }}>{monthLabel}</span>
                        <button type="button" aria-label={t('planner.next', 'Next month')} onClick={() => shiftMonth(1)} style={{ ...ghostBtn, padding: 8 }}><ChevronRight size={16} /></button>
                        <button type="button" onClick={() => { setCursor({ year: today.getFullYear(), month: today.getMonth() }); setSelectedDay(todayKey); }} style={ghostBtn}>
                            {t('planner.today', 'Today')}
                        </button>
                        {isPro && (
                            <button type="button" onClick={() => setNewPostOpen(true)} style={{ ...ghostBtn, background: 'var(--accent)', color: '#fff', border: 'none', fontWeight: 600 }}>
                                <Plus size={14} /> {t('planner.newPost', 'New post')}
                            </button>
                        )}
                    </div>
                </div>

                {!isPro && !planLoading && <div style={{ marginBottom: 14 }}><ProFeatureLock feature="planner" required="pro" variant="inline" /></div>}

                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--fg-3)', marginBottom: 12 }}>
                    {['scheduled', 'manual_reminder', 'published'].map(s => (
                        <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 8, height: 8, borderRadius: 999, background: STATUS_COLOR[s] }} />
                            {t(`planner.status.${s}`)} {counts[s] ? `· ${counts[s]}` : ''}
                        </span>
                    ))}
                    {!isMobile && isPro && <span style={{ color: 'var(--fg-4)' }}>{t('planner.dragHint', 'Drag a scheduled post onto another day to move it.')}</span>}
                </div>

                {notice && (
                    <div role={notice.type === 'error' ? 'alert' : 'status'} style={{ ...surface, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: notice.type === 'error' ? 'var(--coral, #ff6b6b)' : 'var(--fg-2)', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                        <span>{notice.text}</span>
                        <button type="button" onClick={() => setNotice(null)} aria-label={t('planner.dismiss', 'Dismiss')} style={{ background: 'none', border: 'none', color: 'var(--fg-3)', cursor: 'pointer' }}><X size={14} /></button>
                    </div>
                )}
                {loadError && <div role="alert" style={{ ...surface, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: 'var(--coral, #ff6b6b)' }}>{loadError} <button type="button" onClick={load} style={{ ...ghostBtn, marginLeft: 8, padding: '3px 10px' }}>{t('planner.retry', 'Retry')}</button></div>}

                <div style={{ display: isMobile ? 'block' : 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 16, alignItems: 'start' }}>
                    {/* ── Month grid ── */}
                    <div style={{ ...surface, padding: isMobile ? 8 : 10, position: 'relative' }}>
                        {loading && <Loader2 size={16} className="animate-spin" style={{ position: 'absolute', top: 10, right: 10, color: 'var(--fg-3)' }} />}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: isMobile ? 2 : 4 }}>
                            {weekdays.map((w, i) => (
                                <div key={i} style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--fg-3)', textAlign: 'center', padding: '4px 0' }}>{w}</div>
                            ))}
                            {grid.map(day => {
                                const list = byDay.get(day.key) || [];
                                const selected = day.key === selectedDay;
                                return (
                                    <div
                                        key={day.key}
                                        role="button"
                                        tabIndex={0}
                                        aria-pressed={selected}
                                        aria-label={`${dayFmt.format(day.date)}, ${t('planner.postCount', { count: list.length })}`}
                                        onClick={() => setSelectedDay(day.key)}
                                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedDay(day.key); } }}
                                        onDragOver={e => { if (dragId) e.preventDefault(); }}
                                        onDrop={e => { e.preventDefault(); onDropDay(day.key); }}
                                        style={{
                                            minHeight: isMobile ? 46 : 96, padding: isMobile ? 4 : 6, borderRadius: 8, cursor: 'pointer',
                                            opacity: day.inMonth ? 1 : 0.4,
                                            background: selected ? 'color-mix(in oklch, var(--accent) 12%, transparent)' : 'rgba(255,255,255,0.02)',
                                            border: selected ? '0.5px solid color-mix(in oklch, var(--accent) 45%, transparent)' : '0.5px solid transparent',
                                            display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0,
                                        }}
                                    >
                                        <span style={{ fontSize: 12, fontWeight: day.key === todayKey ? 700 : 400, color: day.key === todayKey ? 'var(--accent)' : 'var(--fg-2)' }}>{day.date.getDate()}</span>
                                        {isMobile ? (
                                            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                                                {list.slice(0, 4).map(p => <span key={p.id} style={{ width: 6, height: 6, borderRadius: 999, background: STATUS_COLOR[p.status] || 'var(--fg-3)' }} />)}
                                            </div>
                                        ) : (
                                            <>
                                                {list.slice(0, 3).map(p => {
                                                    const movable = postActions(p, { isPro }).reschedule;
                                                    return (
                                                        <div
                                                            key={p.id}
                                                            draggable={movable}
                                                            onDragStart={e => { setDragId(p.id); e.dataTransfer.effectAllowed = 'move'; }}
                                                            onDragEnd={() => setDragId(null)}
                                                            title={p.title || PROVIDER_LABEL[p.provider]}
                                                            style={{
                                                                fontSize: 11, lineHeight: 1.3, padding: '2px 5px', borderRadius: 4, cursor: movable ? 'grab' : 'pointer',
                                                                background: 'rgba(255,255,255,0.05)', borderLeft: `2px solid ${STATUS_COLOR[p.status] || 'var(--fg-3)'}`,
                                                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--fg-2)',
                                                                opacity: busy === p.id ? 0.5 : 1,
                                                            }}
                                                        >
                                                            <span style={{ color: PROVIDER_COLOR[p.provider] || 'var(--fg-3)' }}>●</span> {timeFmt.format(new Date(postTime(p)))} {p.title}
                                                        </div>
                                                    );
                                                })}
                                                {list.length > 3 && <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{t('planner.more', { count: list.length - 3 })}</span>}
                                            </>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                        {!loading && !loadError && posts.length === 0 && (
                            <p style={{ margin: '14px 6px 6px', fontSize: 13, color: 'var(--fg-3)', textAlign: 'center' }}>
                                {t('planner.empty', 'Nothing planned this month. Schedule a post from the Shorts panel of a project.')}
                            </p>
                        )}
                    </div>

                    {/* ── The selected day ── */}
                    <div style={{ marginTop: isMobile ? 16 : 0 }}>
                        <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 10px', textTransform: 'capitalize' }}>{dayFmt.format(new Date(`${selectedDay}T12:00:00`))}</h2>
                        {selectedPosts.length === 0 && <p style={{ fontSize: 13, color: 'var(--fg-3)', margin: 0 }}>{t('planner.dayEmpty', 'No posts on this day.')}</p>}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {selectedPosts.map(post => (
                                <PostCard
                                    key={post.id} post={post} isPro={isPro} busy={busy === post.id} timeFmt={timeFmt} t={t}
                                    onReschedule={iso => reschedule(post, iso)} onCancel={() => cancel(post)} onMarkPosted={() => markPosted(post)}
                                />
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
        </>
    );
}

function PostCard({ post, isPro, busy, timeFmt, t, onReschedule, onCancel, onMarkPosted }) {
    const actions = postActions(post, { isPro });
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(localInputValue(post.scheduledAt));
    const m = post.metrics || null;
    const metric = (v) => (Number.isFinite(Number(v)) ? new Intl.NumberFormat().format(Number(v)) : null);

    const save = async () => {
        const iso = new Date(value).toISOString();
        if (await onReschedule(iso)) setEditing(false);
    };

    return (
        <div style={{ ...surface, padding: 12, borderLeft: `2px solid ${STATUS_COLOR[post.status] || 'var(--fg-3)'}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, color: 'var(--fg-3)' }}>
                <span><span style={{ color: PROVIDER_COLOR[post.provider] }}>●</span> {PROVIDER_LABEL[post.provider] || post.provider} · {timeFmt.format(new Date(postTime(post)))}</span>
                <span style={{ color: STATUS_COLOR[post.status] }}>{post.postedManually ? t('planner.status.postedManually', 'Posted by you') : t(`planner.status.${post.status}`, post.status)}</span>
            </div>
            {post.title && <div style={{ fontSize: 14, fontWeight: 600, marginTop: 6, overflowWrap: 'anywhere' }}>{post.title}</div>}
            {post.caption && <div style={{ fontSize: 12.5, color: 'var(--fg-3)', marginTop: 4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{post.caption}</div>}

            {(post.status === 'manual_reminder' || post.status === 'failed') && (
                <p style={{ fontSize: 12.5, color: 'var(--warning, #f5a524)', margin: '8px 0 0', lineHeight: 1.5 }}>
                    {t('planner.manualNote', "Automatic publishing didn't go through. Post it yourself from the app, then mark it as posted.")}
                </p>
            )}
            {m && (
                <div style={{ display: 'flex', gap: 14, marginTop: 8, fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--fg-2)' }}>
                    {metric(m.views) && <span>{metric(m.views)} {t('planner.views', 'views')}</span>}
                    {metric(m.likes) && <span>{metric(m.likes)} {t('planner.likes', 'likes')}</span>}
                    {metric(m.comments) && <span>{metric(m.comments)} {t('planner.comments', 'comments')}</span>}
                </div>
            )}
            {post.status === 'published' && !m && !post.postedManually && isPro && (
                <p style={{ fontSize: 12, color: 'var(--fg-4)', margin: '8px 0 0' }}>{t('planner.metricsPending', 'Stats appear a day or two after publishing.')}</p>
            )}

            {editing && (
                <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                    <input type="datetime-local" value={value} onChange={e => setValue(e.target.value)}
                        style={{ flex: 1, minWidth: 0, minHeight: 36, background: 'var(--bg-2)', color: 'var(--fg)', border: '0.5px solid var(--line-strong)', borderRadius: 8, padding: '4px 8px', fontSize: 13 }} />
                    <button type="button" onClick={save} disabled={busy || !value} style={{ ...ghostBtn, background: 'var(--accent)', color: '#fff', border: 'none' }}>
                        {busy ? <Loader2 size={14} className="animate-spin" /> : t('planner.save', 'Save')}
                    </button>
                    <button type="button" onClick={() => setEditing(false)} style={ghostBtn}>{t('planner.close', 'Close')}</button>
                </div>
            )}

            {(actions.reschedule || actions.cancel || actions.markPosted) && !editing && (
                <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                    {actions.reschedule && <button type="button" onClick={() => { setValue(localInputValue(post.scheduledAt)); setEditing(true); }} disabled={busy} style={ghostBtn}>{t('planner.reschedule', 'Change time')}</button>}
                    {actions.markPosted && (
                        <button type="button" onClick={onMarkPosted} disabled={busy} style={{ ...ghostBtn, color: 'var(--mint, #34d399)' }}>
                            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {t('planner.markPosted', 'I posted it')}
                        </button>
                    )}
                    {actions.cancel && <button type="button" onClick={onCancel} disabled={busy} style={{ ...ghostBtn, color: 'var(--coral, #ff6b6b)' }}>{t('planner.cancel', 'Cancel post')}</button>}
                </div>
            )}
        </div>
    );
}

/**
 * R175: pick one of the user's recent exports (any project), then the same
 * publisher the Shorts panel and Export screen use.
 */
function NewPostDialog({ t, isMobile, onClose, onScheduled }) {
    const [state, setState] = useState({ loading: true, exports: [], error: null, storageUnavailable: false });
    const [picked, setPicked] = useState(null);
    const [video, setVideo] = useState(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const response = await authFetch('/api/social/exports');
                const body = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(body.message || body.error || 'EXPORTS_UNAVAILABLE');
                if (!cancelled) setState({ loading: false, exports: body.exports || [], error: null, storageUnavailable: !!body.storageUnavailable });
            } catch (err) {
                console.error('[Planner] exports load failed:', err.message);
                if (!cancelled) setState({ loading: false, exports: [], error: t('planner.exportsError', 'Your exports could not load. Try again in a moment.'), storageUnavailable: false });
            }
        })();
        return () => { cancelled = true; };
    }, [t]);

    useEffect(() => {
        if (!picked) return undefined;
        let cancelled = false;
        setVideo(null);
        probeVideo(picked.mediaUrl).then(v => { if (!cancelled) setVideo(v); });
        return () => { cancelled = true; };
    }, [picked]);

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const sizeLabel = (n) => (Number(n) > 0 ? `${(Number(n) / 1024 / 1024).toFixed(1)} MB` : '');

    return (
        <div role="dialog" aria-modal="true" aria-label={t('planner.newPost', 'New post')}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
            style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 0 : 16 }}>
            <div style={{ ...surface, background: 'var(--bg-2)', width: '100%', maxWidth: 520, maxHeight: isMobile ? '88vh' : '85vh', overflowY: 'auto', padding: 18, boxSizing: 'border-box', borderRadius: isMobile ? '18px 18px 0 0' : 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>{picked ? (picked.projectName || picked.name) : t('planner.pickExport', 'Choose a video to post')}</h2>
                    <button type="button" onClick={onClose} aria-label={t('planner.close', 'Close')} style={{ background: 'none', border: 'none', color: 'var(--fg-3)', cursor: 'pointer' }}><X size={18} /></button>
                </div>

                {!picked && state.loading && <p style={{ fontSize: 13, color: 'var(--fg-3)' }}><Loader2 size={14} className="animate-spin" style={{ verticalAlign: 'middle' }} /> {t('planner.loadingExports', 'Loading your exports…')}</p>}
                {!picked && state.error && <p role="alert" style={{ fontSize: 13, color: 'var(--coral, #ff6b6b)' }}>{state.error}</p>}
                {!picked && !state.loading && !state.error && state.exports.length === 0 && (
                    <p style={{ fontSize: 13, color: 'var(--fg-3)', lineHeight: 1.5 }}>
                        {state.storageUnavailable
                            ? t('planner.noCloud', 'Exports are not stored in the cloud on this server, so they cannot be posted from here.')
                            : t('planner.noExports', 'No exports yet. Export a video from a project first, then come back to post it.')}
                    </p>
                )}
                {!picked && state.exports.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {state.exports.map(item => (
                            <button key={item.id} type="button" onClick={() => setPicked(item)}
                                style={{ ...surface, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', textAlign: 'left', cursor: 'pointer', color: 'var(--fg)' }}>
                                <Film size={16} color="var(--accent)" style={{ flexShrink: 0 }} />
                                <span style={{ flex: 1, minWidth: 0 }}>
                                    <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {item.projectName || t('planner.exportNoProject', 'Export')}
                                    </span>
                                    <span style={{ display: 'block', fontSize: 11.5, color: 'var(--fg-3)' }}>
                                        {[item.createdAt ? dateFmt.format(new Date(item.createdAt)) : null, sizeLabel(item.size)].filter(Boolean).join(' · ')}
                                    </span>
                                </span>
                            </button>
                        ))}
                    </div>
                )}

                {picked && (
                    <>
                        <button type="button" onClick={() => setPicked(null)} style={{ ...ghostBtn, border: 'none', padding: '2px 0', marginBottom: 4 }}>
                            <ArrowLeft size={14} /> {t('planner.otherVideo', 'Choose another video')}
                        </button>
                        <video src={picked.mediaUrl} controls muted playsInline preload="metadata"
                            style={{ width: '100%', maxHeight: 260, borderRadius: 10, background: '#000', display: 'block' }} />
                        <SocialPublisher
                            mediaUrl={picked.mediaUrl}
                            sourceId={`export:${picked.name}`}
                            defaultTitle={picked.projectName || ''}
                            video={video}
                            onScheduled={onScheduled}
                        />
                    </>
                )}
            </div>
        </div>
    );
}
