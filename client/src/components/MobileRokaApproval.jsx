import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { EventBus, EVENT_TYPES } from '../agent/EventBus';
import { planLineKeys, formatLength } from '../agent/planFirst.js';
import MobileSheet from './MobileSheet';

/**
 * MobileRokaApproval — on phones, every "wait for the user" moment of the AI
 * pipeline (EventBus APPROVAL_REQUIRED) is answered here, as a bottom sheet,
 * instead of the desktop ApprovalDialog modal:
 *   - kind 'plan_first': edits that remove content (agent/planFirst.js) —
 *     what Roka will do, the current length, Apply / Not now;
 *   - anything else: the pipeline's own description and steps, Apply / Cancel.
 * Closing the sheet counts as "Not now" so the job never waits forever.
 * Mounted by IDELayout on mobile only.
 */
export default function MobileRokaApproval() {
    const { t } = useTranslation('editor');
    const [queue, setQueue] = useState([]);

    useEffect(() => {
        const offReq = EventBus.on(EVENT_TYPES.APPROVAL_REQUIRED, (payload) => {
            if (!payload?.jobId) return;
            setQueue(prev => (prev.some(p => p.jobId === payload.jobId) ? prev : [...prev, payload]));
        });
        const drop = (payload) => setQueue(prev => prev.filter(p => p.jobId !== payload?.jobId));
        const offCancel = EventBus.on(EVENT_TYPES.JOB_CANCELLED, drop);
        const offGrant = EventBus.on(EVENT_TYPES.APPROVAL_GRANTED, drop);
        const offDeny = EventBus.on(EVENT_TYPES.APPROVAL_DENIED, drop);
        return () => { offReq?.(); offCancel?.(); offGrant?.(); offDeny?.(); };
    }, []);

    const current = queue[0] || null;
    if (!current) return null;

    const answer = (granted) => {
        if (granted) EventBus.emit(EVENT_TYPES.APPROVAL_GRANTED, { jobId: current.jobId, approvedAt: Date.now() });
        else EventBus.emit(EVENT_TYPES.APPROVAL_DENIED, { jobId: current.jobId, reason: 'User chose not now', deniedAt: Date.now() });
        // The GRANTED / DENIED listeners above remove it from the queue.
    };

    const planFirst = current.kind === 'plan_first';
    const lines = planFirst
        ? planLineKeys(current.operation).map(k => t(`mobileRoka.${k}`))
        : String(current.actions || '').split('\n').map(l => l.replace(/^[•\-\s]+/, '').trim()).filter(Boolean);

    return (
        <MobileSheet
            open
            title={planFirst ? t('mobileRoka.planTitle') : t('mobileRoka.approveTitle')}
            onClose={() => answer(false)}
        >
            {!planFirst && current.description && (
                <p style={{ margin: '-4px 0 0', fontSize: 14, lineHeight: 1.5, color: 'var(--fg-2)' }}>{current.description}</p>
            )}
            {lines.length > 0 && (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {lines.map((line, i) => (
                        <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 15, lineHeight: 1.45 }}>
                            <span style={{ marginTop: 2, width: 20, height: 20, borderRadius: 10, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                                <Check size={12} strokeWidth={3} />
                            </span>
                            <span>{line}</span>
                        </li>
                    ))}
                </ul>
            )}
            {planFirst && Number(current.currentLength) > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderRadius: 'var(--r-sm)', background: 'var(--bg-3)', fontFamily: 'var(--f-mono)', fontSize: 12.5 }}>
                    <span style={{ color: 'var(--fg-3)' }}>{t('mobileRoka.currentLength')}</span>
                    <span>{formatLength(current.currentLength)}</span>
                </div>
            )}
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--fg-3)' }}>{t('mobileRoka.undoAfter')}</p>
            <div style={{ display: 'flex', gap: 10 }}>
                <button
                    type="button"
                    onClick={() => answer(true)}
                    style={{ flex: 1, height: 48, borderRadius: 'var(--r-sm)', border: 0, background: 'var(--accent)', color: '#fff', fontFamily: 'var(--f-sans)', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
                >
                    {t('mobileRoka.apply')}
                </button>
                <button
                    type="button"
                    onClick={() => answer(false)}
                    style={{ height: 48, padding: '0 18px', borderRadius: 'var(--r-sm)', border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--fg)', fontFamily: 'var(--f-sans)', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
                >
                    {t('mobileRoka.notNow')}
                </button>
            </div>
        </MobileSheet>
    );
}
