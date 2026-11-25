import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, Check, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import { authFetch } from '../utils/authFetch';

function number(value) {
    if (!Number.isFinite(Number(value))) return '—';
    return new Intl.NumberFormat().format(Number(value));
}

function percent(value) {
    if (!Number.isFinite(Number(value))) return '—';
    return `${Number(value).toFixed(1)}%`;
}

export default function SocialPerformancePanel() {
    const { t } = useTranslation('editor');
    const [data, setData] = useState({ posts: [], recommendations: [], guidance: [], sampleCount: 0 });
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        setBusy('load'); setError('');
        try {
            const response = await authFetch('/api/social/analytics');
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.error || 'ANALYTICS_UNAVAILABLE');
            setData(body);
        } catch (err) {
            setError(err.message || 'ANALYTICS_UNAVAILABLE');
        } finally { setBusy(''); }
    }, []);

    useEffect(() => { load(); }, [load]);

    const generate = async () => {
        setBusy('generate'); setError('');
        try {
            const response = await authFetch('/api/social/analytics/recommendations/generate', { method: 'POST', body: '{}' });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.error || 'RECOMMENDATION_GENERATION_FAILED');
            await load();
        } catch (err) { setError(err.message || 'RECOMMENDATION_GENERATION_FAILED'); }
        finally { setBusy(''); }
    };

    const decide = async (id, status) => {
        setBusy(id); setError('');
        try {
            const response = await authFetch(`/api/social/analytics/recommendations/${encodeURIComponent(id)}`, {
                method: 'PATCH', body: JSON.stringify({ status }),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.error || 'RECOMMENDATION_UPDATE_FAILED');
            await load();
        } catch (err) { setError(err.message || 'RECOMMENDATION_UPDATE_FAILED'); }
        finally { setBusy(''); }
    };

    const measured = data.posts.filter(post => post.metrics);
    const recommendationItems = data.recommendations || [];
    const localize = (key, fallback) => t(`socialAnalytics.${key}`, fallback);

    return (
        <section className="mb-3 rounded-lg border border-primary/25 bg-primary/[0.04] p-3 space-y-2.5">
            <div className="flex items-start gap-2">
                <BarChart3 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                        <h3 className="text-[11px] font-bold text-foreground">{localize('title', 'Published performance')}</h3>
                        <button type="button" onClick={load} disabled={busy !== ''} title={localize('refresh', 'Refresh')} className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-50">
                            {busy === 'load' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        </button>
                    </div>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">{localize('description', 'Daily metrics from videos published through Vibed. Instagram metrics may take up to 48 hours to appear.')}</p>
                </div>
            </div>

            {measured.length > 0 ? <div className="space-y-1.5">
                {measured.slice(0, 5).map(post => {
                    const metrics = post.metrics || {};
                    return <div key={post.id} className="rounded border border-border/70 bg-background/60 px-2 py-1.5">
                        <div className="flex items-center justify-between gap-2 text-[10px]">
                            <span className="truncate font-medium text-foreground">{post.provider === 'youtube' ? 'YouTube Shorts' : 'Instagram Reels'} · {post.title || localize('video', 'Video')}</span>
                            <span className="shrink-0 text-muted-foreground">{post.publishedAt ? new Date(post.publishedAt).toLocaleDateString() : ''}</span>
                        </div>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                            {number(metrics.views)} {localize('views', 'views')} · {post.provider === 'youtube'
                                ? `${percent(metrics.averageViewPercentage)} ${localize('watchedAverage', 'average watched')} · ${number(metrics.likes)} ${localize('likes', 'likes')}`
                                : `${number(metrics.reach)} ${localize('reach', 'reached')} · ${number(metrics.saved)} ${localize('saves', 'saves')} · ${number(metrics.shares)} ${localize('shares', 'shares')}`}
                        </p>
                    </div>;
                })}
                {measured.length > 5 && <p className="text-[9px] text-muted-foreground">{t('socialAnalytics.morePosts', { count: measured.length - 5, defaultValue: `+${measured.length - 5} more measured posts` })}</p>}
            </div> : <p className="rounded border border-border/70 bg-background/50 px-2 py-2 text-[10px] text-muted-foreground">
                {data.posts.length ? localize('waiting', 'Performance stats are being collected; platform reporting can take a day or two.') : localize('empty', 'Publish a short through Vibed to start collecting performance data.')}
            </p>}

            <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={generate} disabled={busy !== '' || measured.length < 3} className="flex items-center gap-1 rounded bg-primary/15 px-2.5 py-1.5 text-[10px] font-semibold text-primary disabled:opacity-45">
                    {busy === 'generate' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    {localize('analyze', 'Analyze and suggest edits')}
                </button>
                <span className="text-[9px] text-muted-foreground">{t('socialAnalytics.sampleCount', { count: measured.length, defaultValue: `${measured.length} of 3 posts with stats needed` })}</span>
            </div>

            {recommendationItems.filter(item => item.status !== 'dismissed').length > 0 && <div className="space-y-1.5 border-t border-border/70 pt-2">
                <p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">{localize('recommendations', 'Editing recommendations')}</p>
                {recommendationItems.filter(item => item.status !== 'dismissed').slice(0, 4).map(item => (
                    <article key={item.id} className="rounded border border-border/70 bg-background/60 p-2">
                        <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                                <p className="text-[10px] font-semibold text-foreground">{item.title}</p>
                                <p className="mt-0.5 text-[9px] text-muted-foreground">{item.rationale}</p>
                                {item.status === 'accepted' && <p className="mt-1 flex items-center gap-1 text-[9px] text-emerald-400"><Check className="h-3 w-3" />{localize('accepted', 'Included in future short edits')}</p>}
                            </div>
                            {item.status === 'pending' && <div className="flex shrink-0 gap-1">
                                <button type="button" onClick={() => decide(item.id, 'accepted')} disabled={busy !== ''} title={localize('accept', 'Use for future edits')} className="rounded p-1 text-emerald-400 hover:bg-emerald-400/10"><Check className="h-3.5 w-3.5" /></button>
                                <button type="button" onClick={() => decide(item.id, 'dismissed')} disabled={busy !== ''} title={localize('dismiss', 'Dismiss')} className="rounded p-1 text-muted-foreground hover:bg-white/10"><X className="h-3.5 w-3.5" /></button>
                            </div>}
                        </div>
                    </article>
                ))}
            </div>}

            {error && <p role="alert" className="text-[10px] text-amber-400">{localize(error, error.replaceAll('_', ' ').toLowerCase())}</p>}
        </section>
    );
}
