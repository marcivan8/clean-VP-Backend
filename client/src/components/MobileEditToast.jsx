import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Undo2 } from 'lucide-react';
import useAIStore from '../store/useAIStore';
import useTimelineStore from '../store/useTimelineStore';
import { timelineLength, formatLength } from '../agent/planFirst.js';
import { undoTaskEdits } from '../agent/undoTask.js';

const SHOW_MS = 7000;

/**
 * MobileEditToast — on the preview, right after Roka applies an edit:
 * what changed, the length before → after when it changed, and one-tap Undo.
 * The same result also sits in the Roka bar as a card (MobileAIBar); both
 * share useAIStore.taskOutcomes so undoing in one updates the other.
 * Mounted by IDELayout on mobile only.
 */
export default function MobileEditToast() {
    const { t } = useTranslation('editor');
    const logs = useAIStore(s => s.logs);
    const isAnalyzing = useAIStore(s => s.isAnalyzing);
    const taskOutcomes = useAIStore(s => s.taskOutcomes);
    const setTaskOutcome = useAIStore(s => s.setTaskOutcome);

    // Length when the current AI job started, for "1:12 → 0:51".
    const startLenRef = useRef(null);
    useEffect(() => {
        if (isAnalyzing) startLenRef.current = timelineLength(useTimelineStore.getState().tracks);
    }, [isAnalyzing]);

    // Only edits finished after mount get a toast.
    const lastSeenRef = useRef(undefined);
    const [toast, setToast] = useState(null);
    useEffect(() => {
        let latest = null;
        for (let i = logs.length - 1; i >= 0; i--) {
            if (logs[i].type === 'task_complete') { latest = logs[i]; break; }
        }
        const latestId = latest?.id ?? null;
        if (lastSeenRef.current === undefined) { lastSeenRef.current = latestId; return; }
        if (!latest || latestId === lastSeenRef.current) return;
        lastSeenRef.current = latestId;
        if (!(latest.data?.stepsApplied > 0)) return;
        setToast({
            log: latest,
            before: startLenRef.current,
            after: timelineLength(useTimelineStore.getState().tracks),
        });
    }, [logs]);

    useEffect(() => {
        if (!toast) return undefined;
        const timer = setTimeout(() => setToast(null), SHOW_MS);
        return () => clearTimeout(timer);
    }, [toast]);

    if (!toast || taskOutcomes[toast.log.id]) return null;

    const changed = Number.isFinite(toast.before) && Math.abs((toast.before || 0) - (toast.after || 0)) > 0.5;

    return (
        <div
            role="status"
            style={{
                position: 'absolute', left: 10, right: 10, bottom: 10, zIndex: 26,
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px 8px 12px',
                borderRadius: 'var(--r-sm)', background: 'var(--bg-2)',
                border: '1px solid color-mix(in oklch, var(--mint) 45%, transparent)', boxShadow: '0 8px 24px rgba(0,0,0,.45)',
                fontFamily: 'var(--f-sans)', color: 'var(--fg)',
            }}
        >
            <Check size={18} strokeWidth={2.6} style={{ color: 'var(--mint)', flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{toast.log.message}</span>
                {changed && (
                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--fg-2)' }}>
                        {formatLength(toast.before)} → {formatLength(toast.after)}
                    </span>
                )}
            </span>
            <button
                type="button"
                onClick={() => { undoTaskEdits(toast.log.data?.preTaskHistoryLen); setTaskOutcome(toast.log.id, 'undone'); setToast(null); }}
                style={{ height: 36, padding: '0 12px', borderRadius: 10, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--fg)', fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
            >
                <Undo2 size={14} /> {t('mobileRoka.undo')}
            </button>
        </div>
    );
}
