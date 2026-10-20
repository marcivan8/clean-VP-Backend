import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Check, Lock } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import useTimelineStore from '../../store/useTimelineStore';
import { EDITING_STYLE_IDS } from '../../agent/EditingStyles.js';
import { useUserPlan } from '../../hooks/useUserPlan.js';
import EventBus, { EVENT_TYPES } from '../../agent/EventBus.js';

/**
 * R91 — editing style + Normal/Auto under the chat box, the way a chatbot
 * lets you pick a model. The style is saved with the project; the mode is
 * not (a reload never resumes in Auto). See agent/EditingStyles.js.
 *
 * Paid gating: editing styles and "auto" mode are accessible only in paid
 * subscriptions (Creator and Pro). Free tier defaults to no style and only
 * manual ("normal") mode.
 */
const pill = {
    fontFamily: 'var(--f-sans)', fontSize: 11, color: 'var(--fg-2)',
    border: '0.5px solid var(--line)', background: 'rgba(255,255,255,0.03)',
};

const EditingStylePicker = ({ disabled = false }) => {
    const { t } = useTranslation('editor');
    const { plan, loading: planLoading } = useUserPlan();
    const isPaid = plan === 'creator' || plan === 'pro';

    const { editingStyle, editingMode, setEditingStyle, setEditingMode } = useTimelineStore(useShallow(s => ({
        editingStyle: s.editingStyle, editingMode: s.editingMode,
        setEditingStyle: s.setEditingStyle, setEditingMode: s.setEditingMode,
    })));
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);

    // Free tier defaults to no style and only manual ("normal") mode
    useEffect(() => {
        if (!planLoading && !isPaid) {
            if (editingStyle !== null) {
                try { setEditingStyle(null); } catch (err) { console.error('[EditingStylePicker] reset style failed:', err); }
            }
            if (editingMode !== 'normal') {
                try { setEditingMode('normal'); } catch (err) { console.error('[EditingStylePicker] reset mode failed:', err); }
            }
        }
    }, [planLoading, isPaid, editingStyle, editingMode, setEditingStyle, setEditingMode]);

    useEffect(() => {
        if (!open) return undefined;
        const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
    }, [open]);

    const choose = (id) => {
        if (!isPaid && id !== null) {
            setOpen(false);
            EventBus.emit(EVENT_TYPES.QUOTA_EXCEEDED, {
                reason: 'paid_feature',
                upgradeRequired: 'creator',
                message: t('editingStyles.styleUpgradeRequired'),
            });
            return;
        }
        try { setEditingStyle(id); } catch (err) { console.error('[EditingStylePicker] set style failed:', err); }
        setOpen(false);
    };

    const switchMode = (m) => {
        if (!isPaid && m === 'auto') {
            EventBus.emit(EVENT_TYPES.QUOTA_EXCEEDED, {
                reason: 'paid_feature',
                upgradeRequired: 'creator',
                message: t('editingStyles.autoUpgradeRequired'),
            });
            return;
        }
        try { setEditingMode(m); } catch (err) { console.error('[EditingStylePicker] set mode failed:', err); }
    };

    const label = editingStyle ? t(`editingStyles.names.${editingStyle}`) : t('editingStyles.label');
    const options = [null, ...EDITING_STYLE_IDS];

    return (
        <div ref={rootRef} className="flex items-center gap-1.5">
            <div className="relative">
                <button type="button" disabled={disabled} onClick={() => setOpen(o => !o)}
                    aria-haspopup="listbox" aria-expanded={open}
                    className="flex items-center gap-1 px-2 py-1 rounded-md transition-colors hover:bg-white/5 disabled:opacity-40"
                    style={{ ...pill, color: editingStyle ? 'var(--fg)' : 'var(--fg-2)' }}>
                    {label}
                    {!isPaid && <Lock className="w-2.5 h-2.5 text-amber-400/80 ml-0.5" />}
                    <ChevronDown className="w-3 h-3 opacity-60" />
                </button>
                {open && (
                    <div role="listbox" className="absolute bottom-full left-0 mb-1.5 w-60 rounded-lg p-1 z-50 shadow-xl"
                        style={{ background: 'var(--popover)', border: '0.5px solid var(--line)' }}>
                        {options.map(id => {
                            const selected = (editingStyle || null) === id;
                            const key = id || 'none';
                            const isLocked = id !== null && !isPaid;
                            return (
                                <button key={key} type="button" role="option" aria-selected={selected} onClick={() => choose(id)}
                                    className="w-full flex items-start gap-2 px-2.5 py-2 rounded-md text-left transition-colors hover:bg-white/5">
                                    <span className="flex-1 min-w-0">
                                        <span className="flex items-center gap-1.5">
                                            <span className="block" style={{ fontFamily: 'var(--f-sans)', fontSize: 12, color: 'var(--fg)' }}>
                                                {id ? t(`editingStyles.names.${id}`) : t('editingStyles.none')}
                                            </span>
                                            {isLocked && (
                                                <span className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded text-[9px] font-medium"
                                                    style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', border: '0.5px solid rgba(245, 158, 11, 0.3)' }}>
                                                    <Lock className="w-2.5 h-2.5" />
                                                    <span>PRO</span>
                                                </span>
                                            )}
                                        </span>
                                        <span className="block" style={{ fontFamily: 'var(--f-sans)', fontSize: 10.5, color: 'var(--fg-3)', lineHeight: 1.35 }}>
                                            {t(`editingStyles.hints.${key}`)}
                                        </span>
                                    </span>
                                    {selected && <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="flex items-center rounded-md p-0.5" style={{ border: '0.5px solid var(--line)', background: 'rgba(255,255,255,0.03)' }}
                role="radiogroup" aria-label={t('editingStyles.modeLabel')}>
                {['normal', 'auto'].map(m => {
                    const active = editingMode === m;
                    const isLocked = m === 'auto' && !isPaid;
                    return (
                        <button key={m} type="button" role="radio" aria-checked={active} disabled={disabled}
                            onClick={() => switchMode(m)}
                            title={isLocked ? t('editingStyles.autoUpgradeTooltip') : t(`editingStyles.${m}Hint`)}
                            className="px-2 py-0.5 rounded transition-colors disabled:opacity-40 flex items-center gap-1"
                            style={{
                                fontFamily: 'var(--f-sans)', fontSize: 11,
                                color: active ? '#fff' : 'var(--fg-2)',
                                background: active ? (m === 'auto' ? 'var(--accent)' : 'rgba(255,255,255,0.12)') : 'transparent',
                            }}>
                            <span>{t(`editingStyles.${m}`)}</span>
                            {isLocked && <Lock className="w-2.5 h-2.5 text-amber-400/80 shrink-0" />}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export default EditingStylePicker;
