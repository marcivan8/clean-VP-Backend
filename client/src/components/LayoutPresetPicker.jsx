import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useTimelineStore from '../store/useTimelineStore';

/**
 * R88 (to-do A1) — layout presets for the selected overlay clip (b-roll,
 * screen recording, image): split screen, full-screen cutaway,
 * picture-in-picture. The geometry and the speaker reframe live in the store
 * action `applyLayout` (motion/LayoutPresets.js does the maths).
 */
const PRESETS = [
    { id: 'split',      icon: (
        <svg width="18" height="28" viewBox="0 0 18 28" aria-hidden="true"><rect x="1" y="1" width="16" height="26" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2"/><rect x="1" y="14" width="16" height="13" rx="1" fill="currentColor" opacity="0.55"/><circle cx="9" cy="7.5" r="2.6" fill="currentColor"/></svg>
    ) },
    { id: 'fullscreen', icon: (
        <svg width="18" height="28" viewBox="0 0 18 28" aria-hidden="true"><rect x="1" y="1" width="16" height="26" rx="2" fill="currentColor" opacity="0.55" stroke="currentColor" strokeWidth="1.2"/></svg>
    ) },
    { id: 'pip',        icon: (
        <svg width="18" height="28" viewBox="0 0 18 28" aria-hidden="true"><rect x="1" y="1" width="16" height="26" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2"/><rect x="9" y="3" width="6" height="5" rx="1" fill="currentColor" opacity="0.75"/><circle cx="9" cy="15" r="3" fill="currentColor" opacity="0.4"/></svg>
    ) },
];

const LayoutPresetPicker = ({ trackId, clip }) => {
    const { t } = useTranslation('editor');
    const [note, setNote] = useState(null);
    const current = clip?.frame?.preset || null;

    const apply = (preset) => {
        const store = useTimelineStore.getState();
        try {
            const r = store.applyLayout(trackId, clip.id, preset);
            if (!r?.success) { setNote(r?.error || t('layout.failed')); return; }
            if (preset === 'split') {
                setNote(r.faceAware ? t('layout.splitFace') : t('layout.splitNoFace'));
            } else {
                setNote(null);
            }
        } catch (err) {
            console.error('[LayoutPresetPicker] applyLayout failed:', err);
            setNote(t('layout.failed'));
        }
    };
    const reset = () => {
        try {
            const r = useTimelineStore.getState().clearLayout(trackId, clip.id);
            setNote(r?.success ? null : (r?.error || null));
        } catch (err) {
            console.error('[LayoutPresetPicker] clearLayout failed:', err);
        }
    };

    return (
        <div className="space-y-2">
            <div className="text-xs text-muted-foreground uppercase tracking-wider font-bold">{t('layout.title')}</div>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('layout.title')}>
                {PRESETS.map(p => (
                    <button
                        key={p.id}
                        type="button"
                        role="radio"
                        aria-checked={current === p.id}
                        onClick={() => apply(p.id)}
                        className="flex flex-col items-center gap-1.5 py-2 rounded border transition-colors"
                        style={{
                            borderColor: current === p.id ? 'var(--accent)' : 'var(--line)',
                            color: current === p.id ? 'var(--accent)' : 'var(--fg-3)',
                            background: current === p.id ? 'color-mix(in oklch, var(--accent) 12%, transparent)' : 'transparent',
                        }}
                    >
                        {p.icon}
                        <span className="text-[10px]">{t(`layout.${p.id}`)}</span>
                    </button>
                ))}
            </div>
            {current && (
                <>
                    <p className="text-[10px] leading-relaxed" style={{ color: 'var(--fg-3)' }}>{t('layout.panHint')}</p>
                    <button type="button" onClick={reset} className="w-full py-1.5 text-xs bg-secondary hover:bg-white/10 rounded text-muted-foreground transition-colors">
                        {t('layout.reset')}
                    </button>
                </>
            )}
            {note && <p className="text-[10px] leading-relaxed" style={{ color: 'var(--fg-3)' }}>{note}</p>}
        </div>
    );
};

export default LayoutPresetPicker;
