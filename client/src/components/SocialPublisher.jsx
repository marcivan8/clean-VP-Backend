import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CalendarClock, Check, Loader2, Sparkles, X } from 'lucide-react';
import { authFetch } from '../utils/authFetch';
import { connectDestination, fetchDestinations, takeConnectOutcome } from '../lib/socialDestinations';
import { postFormat } from '../lib/socialFormat.js';

const PROVIDERS = [
    { id: 'youtube', label: 'YouTube Shorts' },
    { id: 'instagram', label: 'Instagram Reels' },
];
let socialSnapshot = null;
let socialSnapshotAt = 0;
let socialSnapshotPromise = null;
async function fetchSocialSnapshot() {
    if (socialSnapshot && Date.now() - socialSnapshotAt < 45_000) return socialSnapshot;
    if (socialSnapshotPromise) return socialSnapshotPromise;
    socialSnapshotPromise = Promise.all([fetchDestinations(), authFetch('/api/social/publications')])
        .then(async ([available, response]) => {
            const body = response.ok ? await response.json().catch(() => ({})) : {};
            socialSnapshot = {
                destinations: available || [],
                posts: Array.isArray(body.publications) ? body.publications : [],
            };
            socialSnapshotAt = Date.now();
            return socialSnapshot;
        })
        .finally(() => { socialSnapshotPromise = null; });
    return socialSnapshotPromise;
}
const localInputValue = (date) => {
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

/**
 * Publish or schedule one video. Used for a short (Shorts panel), a finished
 * export (Export screen, mobile export sheet) and any past export (Planner).
 *   sourceId      what the post belongs to (defaults to the short's id); the
 *                 list under the form shows that source's posts
 *   defaultTitle  starting title when there is no short
 *   video         { width, height, duration } for the format note (R175)
 *   onScheduled   called with the new post
 */
function formatNote(provider, format, t) {
    if (provider === 'youtube') {
        if (format.youtube === 'short') return t('socialPublisher.formatShort', 'Goes out as a YouTube Short.');
        if (format.youtube === 'video') return t('socialPublisher.formatVideo', 'Goes out as a regular YouTube video (a Short has to be vertical or square and 3 minutes or less).');
        return null;
    }
    if (format.instagram === 'bars') return t('socialPublisher.reelBars', 'Instagram posts it as a Reel; a landscape video shows with bars above and below.');
    if (format.instagram === 'tooLong') return t('socialPublisher.reelTooLong', 'Instagram Reels are limited to 15 minutes, so this video cannot be posted there.');
    return null;
}

export default function SocialPublisher({ short, mediaUrl, editContext, sourceId, defaultTitle, video, onScheduled }) {
    const { t } = useTranslation('editor');
    const sourceKey = sourceId || short?.id || null;
    const format = useMemo(() => postFormat(video), [video]);
    const [destinations, setDestinations] = useState([]);
    const [posts, setPosts] = useState([]);
    const [provider, setProvider] = useState(short?.platform === 'reels' ? 'instagram' : 'youtube');
    const [title, setTitle] = useState(short?.title || defaultTitle || '');
    const [caption, setCaption] = useState(short?.description || '');
    const [context, setContext] = useState(short?.description || short?.title || defaultTitle || '');
    const [scheduledAt, setScheduledAt] = useState(() => localInputValue(new Date(Date.now() + 60 * 60_000)));
    const [busy, setBusy] = useState('');
    const [message, setMessage] = useState(null);

    const destination = useMemo(() => destinations.find(item => item.id === provider), [destinations, provider]);
    // Instagram refuses Reels over 15 minutes, so do not offer to send one.
    const blocked = provider === 'instagram' && format.instagram === 'tooLong';
    const connected = !!destination?.connection && !destination.connection.needsReconnect;

    const load = useCallback(async () => {
        const snapshot = await fetchSocialSnapshot();
        setDestinations(snapshot.destinations);
        setPosts(snapshot.posts);
    }, []);

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const outcome = takeConnectOutcome();
                const snapshot = await fetchSocialSnapshot();
                if (!active) return;
                setDestinations(snapshot.destinations);
                setPosts(snapshot.posts);
                if (outcome?.connected) setMessage({ type: 'ok', text: t('socialPublisher.connectedNotice', '{{provider}} connected.', { provider: outcome.connected }) });
                if (outcome?.error) setMessage({ type: 'error', text: t('socialPublisher.connectionError', 'Connection did not complete. Try again.') });
            } catch (err) {
                console.warn('[SocialPublisher] initial load failed:', err.message);
            }
        })();
        return () => { active = false; };
    }, []);

    useEffect(() => {
        const timer = setInterval(() => { load().catch(err => console.warn('[SocialPublisher] refresh failed:', err.message)); }, 60_000);
        return () => clearInterval(timer);
    }, [load]);

    const generate = async () => {
        setBusy('generate'); setMessage(null);
        try {
            const response = await authFetch('/api/social/copy/generate', {
                method: 'POST', body: JSON.stringify({ provider, title, context, language: navigator.language || 'English' }),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.error || 'COPY_GENERATION_FAILED');
            setTitle(body.title || title); setCaption(body.caption || '');
        } catch (err) { setMessage({ type: 'error', text: err.message }); }
        finally { setBusy(''); }
    };

    const submit = async (publishNow) => {
        if (provider === 'youtube' && !title.trim()) {
            setMessage({ type: 'error', text: t('socialPublisher.titleRequired', 'Add a YouTube title first.') });
            return;
        }
        setBusy(publishNow ? 'now' : 'schedule'); setMessage(null);
        try {
            const response = await authFetch('/api/social/publications', {
                method: 'POST',
                body: JSON.stringify({
                    provider, shortId: sourceKey, mediaUrl, title, caption, editContext,
                    ...(publishNow ? { publishNow: true } : { scheduledAt: new Date(scheduledAt).toISOString() }),
                }),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.message || body.error || 'SCHEDULE_FAILED');
            setMessage({ type: 'ok', text: publishNow
                ? t('socialPublisher.publishing', 'Publishing now. It appears in the Planner.')
                : t('socialPublisher.scheduled', 'Publication scheduled.') });
            socialSnapshotAt = 0;
            await load();
            onScheduled?.(body.publication);
        } catch (err) { setMessage({ type: 'error', text: err.message }); }
        finally { setBusy(''); }
    };
    const schedule = (event) => { event.preventDefault(); submit(false); };

    const connect = async () => {
        setBusy('connect'); setMessage(null);
        const error = await connectDestination(provider, window.location.pathname);
        if (error) { setMessage({ type: 'error', text: error }); setBusy(''); }
    };

    const dismissReminder = async (postId) => {
        await authFetch(`/api/social/publications/${encodeURIComponent(postId)}/reminder-seen`, { method: 'POST' });
        setPosts(list => list.map(post => post.id === postId ? { ...post, reminderDue: false } : post));
    };

    const cancel = async (postId) => {
        const response = await authFetch(`/api/social/publications/${encodeURIComponent(postId)}`, { method: 'DELETE' });
        if (response.ok) setPosts(list => list.map(post => post.id === postId ? { ...post, status: 'cancelled' } : post));
        else setMessage({ type: 'error', text: t('socialPublisher.cancelError', 'Could not cancel this scheduled publication.') });
    };

    return (
        <div className="mt-2 rounded-md border border-border bg-background/70 p-2.5 space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
                <CalendarClock className="w-3.5 h-3.5 text-primary" /> {t('socialPublisher.title', 'Publish or schedule')}
            </div>
            <div className="flex gap-1.5">
                <select value={provider} onChange={event => setProvider(event.target.value)} className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1.5 text-[11px] text-foreground">
                    {PROVIDERS.map(item => <option key={item.id} value={item.id}>
                        {item.id === 'youtube' && format.youtube === 'video' ? t('socialPublisher.youtubeVideo', 'YouTube') : t(`socialPublisher.${item.id}`, item.label)}
                    </option>)}
                </select>
                {!connected ? (
                    <button type="button" onClick={connect} disabled={!destination?.configured || !!busy} className="rounded bg-primary/15 px-2 py-1 text-[10px] text-primary disabled:opacity-50">
                        {busy === 'connect' ? <Loader2 className="h-3 w-3 animate-spin" /> : destination?.configured ? t('socialPublisher.connect', 'Connect') : t('socialPublisher.setUp', 'Set up account')}
                    </button>
                ) : <span className="flex items-center gap-1 text-[10px] text-emerald-400"><Check className="h-3 w-3" /> {t('socialPublisher.connected', 'Connected')}</span>}
            </div>
            {formatNote(provider, format, t) && (
                <p className={`text-[10px] leading-snug ${format.instagram === 'tooLong' && provider === 'instagram' ? 'text-amber-400' : 'text-muted-foreground'}`}>
                    {formatNote(provider, format, t)}
                </p>
            )}
            {connected && <form onSubmit={schedule} className="space-y-2">
                {provider === 'youtube' && <input value={title} onChange={event => setTitle(event.target.value)} maxLength={100} placeholder={t('socialPublisher.youtubeTitle', 'YouTube title')} className="w-full rounded border border-border bg-background px-2 py-1.5 text-[11px] text-foreground" required />}
                <textarea value={caption} onChange={event => setCaption(event.target.value)} maxLength={5000} rows={3} placeholder={provider === 'youtube' ? t('socialPublisher.description', 'Description') : t('socialPublisher.reelCaption', 'Reel caption')} className="w-full resize-y rounded border border-border bg-background px-2 py-1.5 text-[11px] text-foreground" />
                <textarea value={context} onChange={event => setContext(event.target.value)} maxLength={5000} rows={2} placeholder={t('socialPublisher.context', 'What is this video about?')} className="w-full resize-y rounded border border-border bg-background px-2 py-1.5 text-[11px] text-foreground" />
                <button type="button" onClick={generate} disabled={!!busy} className="flex items-center gap-1 rounded border border-primary/40 px-2 py-1.5 text-[10px] text-primary disabled:opacity-50">
                    {busy === 'generate' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} {t('socialPublisher.generate', 'Generate copy')}
                </button>
                <div className="flex gap-1.5">
                    <input type="datetime-local" value={scheduledAt} onChange={event => setScheduledAt(event.target.value)} min={localInputValue(new Date(Date.now() + 60_000))} className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1.5 text-[10px] text-foreground" required />
                    <button type="submit" disabled={!!busy || !mediaUrl || blocked} className="rounded bg-primary px-2.5 py-1.5 text-[10px] font-semibold text-primary-foreground disabled:opacity-50">
                        {busy === 'schedule' ? <Loader2 className="h-3 w-3 animate-spin" /> : t('socialPublisher.schedule', 'Schedule')}
                    </button>
                </div>
                <button type="button" onClick={() => submit(true)} disabled={!!busy || !mediaUrl || blocked} className="w-full rounded border border-primary/40 px-2.5 py-1.5 text-[10px] font-semibold text-primary disabled:opacity-50">
                    {busy === 'now' ? <Loader2 className="mx-auto h-3 w-3 animate-spin" /> : t('socialPublisher.publishNow', 'Publish now')}
                </button>
            </form>}
            {message && <p role={message.type === 'error' ? 'alert' : 'status'} className={`flex items-start gap-1 text-[10px] ${message.type === 'error' ? 'text-amber-400' : 'text-emerald-400'}`}>
                {message.type === 'error' ? <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" /> : <Check className="mt-0.5 h-3 w-3 shrink-0" />}{message.text}
            </p>}
            {posts.filter(post => post.shortId === sourceKey && ['scheduled', 'manual_reminder', 'failed'].includes(post.status)).length > 0 && <div className="border-t border-border pt-2 space-y-1.5">
                {posts.filter(post => post.shortId === sourceKey && ['scheduled', 'manual_reminder', 'failed'].includes(post.status)).slice(0, 4).map(post => (
                    <div key={post.id} className="flex items-start gap-2 text-[10px] text-muted-foreground">
                        <span className="min-w-0 flex-1">{t(`socialPublisher.${post.provider}`, post.provider)}: {new Date(post.scheduledAt).toLocaleString()} · {post.status === 'manual_reminder' ? t('socialPublisher.manual', 'Publish manually') : t(`socialPublisher.status_${post.status}`, post.status)}</span>
                        {post.reminderDue && <button type="button" onClick={() => dismissReminder(post.id)} title={t('socialPublisher.dismiss', 'Dismiss reminder')} className="text-primary"><Check className="h-3 w-3" /></button>}
                        {post.status === 'scheduled' && <button type="button" onClick={() => cancel(post.id)} title={t('socialPublisher.cancel', 'Cancel schedule')} className="text-muted-foreground hover:text-destructive"><X className="h-3 w-3" /></button>}
                    </div>
                ))}
            </div>}
        </div>
    );
}
