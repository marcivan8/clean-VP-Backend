/**
 * client/src/components/ExportPublish.jsx — "Publish or schedule" on the
 * Export complete screen (desktop ExportModal and the mobile export sheet),
 * R175. Publishing is Pro (R167): below Pro this shows the Pro lock with what
 * it adds. Only an export stored in the cloud can be posted, since the
 * platforms fetch the file from there.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, ChevronDown } from 'lucide-react';
import { useUserPlan } from '../hooks/useUserPlan.js';
import useTimelineStore from '../store/useTimelineStore';
import SocialPublisher from './SocialPublisher.jsx';
import ProFeatureLock from './ProFeatureLock.jsx';
import { isPostableExport, parseResolution, probeVideo } from '../lib/socialFormat.js';

export default function ExportPublish({ result }) {
    const { t } = useTranslation('editor');
    const { plan, loading } = useUserPlan();
    const projectName = useTimelineStore(s => s.projectName);
    const [open, setOpen] = useState(false);
    const [duration, setDuration] = useState(null);
    const url = result?.url || '';
    const postable = isPostableExport(url);

    // Length is not in the export metadata (only its render time), so read it from the file.
    useEffect(() => {
        if (!open || !postable || duration !== null) return undefined;
        let cancelled = false;
        probeVideo(url).then(v => { if (!cancelled) setDuration(Number(v.duration) || 0); });
        return () => { cancelled = true; };
    }, [open, postable, url, duration]);

    const video = useMemo(() => ({ ...parseResolution(result?.metadata?.resolution), duration: duration || undefined }), [result, duration]);

    if (!result || loading) return null;
    if (plan !== 'pro') return <ProFeatureLock feature="social" required="pro" variant="inline" />;

    return (
        <div style={{ width: '100%', borderRadius: 'var(--r-md, 12px)', border: '0.5px solid var(--line)', background: 'var(--glass)', padding: '10px 12px', boxSizing: 'border-box', textAlign: 'left' }}>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', color: 'var(--fg)', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0 }}
            >
                <CalendarClock size={15} color="var(--accent)" />
                <span style={{ flex: 1, textAlign: 'left' }}>{t('socialPublisher.exportTitle', 'Post to YouTube or Instagram')}</span>
                <ChevronDown size={15} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
            </button>
            {open && (postable ? (
                <SocialPublisher
                    mediaUrl={url}
                    sourceId={`export:${result.filename || url.split('/').pop()}`}
                    defaultTitle={projectName && projectName !== 'Untitled Project' ? projectName : ''}
                    video={video}
                />
            ) : (
                <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--fg-3)', lineHeight: 1.5 }}>
                    {t('socialPublisher.notPostable', 'This export is not stored in the cloud, so it cannot be posted from here. Download it and post it yourself.')}
                </p>
            ))}
        </div>
    );
}
