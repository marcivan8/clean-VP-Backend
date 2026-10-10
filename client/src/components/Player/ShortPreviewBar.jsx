/**
 * client/src/components/Player/ShortPreviewBar.jsx
 *
 * R93: shown over the editor's player while a finished short plays in it
 * (Shorts tab > Preview). The main edit is set aside in the store
 * (useTimelineStore.startShortPreview) and comes back with "Back to my edit",
 * Escape, or when the editor closes.
 */
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Smartphone, RotateCcw, X } from 'lucide-react';

import useTimelineStore from '../../store/useTimelineStore';

export default function ShortPreviewBar() {
    const { t } = useTranslation('editor');
    const preview = useTimelineStore(s => s.shortPreview);
    const active = !!preview;

    // Leaving the editor while previewing puts the main edit back first.
    useEffect(() => () => { useTimelineStore.getState().exitShortPreview(); }, []);

    useEffect(() => {
        if (!active) return undefined;
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            const tag = String(e.target?.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
            useTimelineStore.getState().exitShortPreview();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [active]);

    if (!active) return null;

    const replay = () => {
        const st = useTimelineStore.getState();
        st.seek(0);
        if (!st.isPlaying) st.setIsPlaying(true);
    };

    return (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-3 py-1.5 rounded-full backdrop-blur-xl shadow-xl max-w-[95%]"
            style={{ background: 'rgba(14,15,17,0.88)', border: '0.5px solid var(--line-strong)' }}
            role="status">
            <Smartphone className="w-3.5 h-3.5 text-primary shrink-0" />
            <div className="min-w-0">
                <div className="text-[11px] font-semibold text-foreground truncate">{t('shortsPanel.previewing', { platform: preview.label })}</div>
                <div className="text-[10px] text-muted-foreground truncate">{t('shortsPanel.previewNote')}</div>
            </div>
            <button type="button" onClick={replay} aria-label={t('shortsPanel.previewReplay')} title={t('shortsPanel.previewReplay')}
                className="p-1 rounded-full hover:bg-white/10 text-muted-foreground hover:text-foreground">
                <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={() => useTimelineStore.getState().exitShortPreview()}
                className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] bg-primary/15 border border-primary/40 text-primary whitespace-nowrap">
                <X className="w-3 h-3" /> {t('shortsPanel.previewBack')}
            </button>
        </div>
    );
}
