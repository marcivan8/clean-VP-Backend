import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Lock, Sparkles, Mic, Users, Headphones, Smartphone, Clapperboard } from 'lucide-react';
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
 * R116 — this is now the chat box's LEFT button, in the slot R110/R111 gave
 * to Tools. The style is the thing a person sets before they say anything and
 * changes between projects, so it earns the primary control rather than a
 * small pill tucked beside it. It uses the composer's own menu shell
 * (`chat-composer__menu`), so the one menu in that corner looks like one menu.
 *
 * Each style shows its name AND what it does: "Interview" means nothing on
 * its own, and the hint is the difference between picking one and guessing.
 *
 * Paid gating: editing styles and "auto" mode are accessible only in paid
 * subscriptions (Creator and Pro). Free tier defaults to no style and only
 * manual ("normal") mode.
 */

/** A face per style. The menu is scanned, not read, and five words of hint
 *  all start to look alike without something to anchor each row. */
const STYLE_ICONS = {
    none: Sparkles,
    vlog: Clapperboard,
    talking_head: Mic,
    interview: Users,
    podcast: Headphones,
    reel: Smartphone,
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
    const buttonRef = useRef(null);
    const itemRefs = useRef([]);

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
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open]);

    useEffect(() => { if (open) itemRefs.current[0]?.focus(); }, [open]);

    const close = useCallback((returnFocus = true) => {
        setOpen(false);
        if (returnFocus) buttonRef.current?.focus();
    }, []);

    const onMenuKey = (e) => {
        const items = itemRefs.current.filter(Boolean);
        if (items.length === 0) return;
        const at = items.indexOf(document.activeElement);
        let next = null;
        if (e.key === 'ArrowDown') next = (at + 1) % items.length;
        else if (e.key === 'ArrowUp') next = (at - 1 + items.length) % items.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = items.length - 1;
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
        else if (e.key === 'Tab') { setOpen(false); return; }
        if (next === null) return;
        e.preventDefault();
        items[next]?.focus();
    };

    const choose = (id) => {
        if (!isPaid && id !== null) {
            close(false);
            EventBus.emit(EVENT_TYPES.QUOTA_EXCEEDED, {
                reason: 'paid_feature',
                upgradeRequired: 'creator',
                message: t('editingStyles.styleUpgradeRequired'),
            });
            return;
        }
        try { setEditingStyle(id); } catch (err) { console.error('[EditingStylePicker] set style failed:', err); }
        close(false);
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
    const ButtonIcon = STYLE_ICONS[editingStyle || 'none'] || Sparkles;
    const options = [null, ...EDITING_STYLE_IDS];

    return (
        // R105 anchors: the walkthrough's Auto step and the `auto_available`
        // hint both point here. One element, both systems, so the control can
        // move without either of them following it by hand.
        <div ref={rootRef} data-tour="style-picker" data-hint="style-picker" className="flex items-center gap-1.5">
            <div className="relative">
                <button
                    ref={buttonRef}
                    type="button"
                    disabled={disabled}
                    onClick={() => setOpen(o => !o)}
                    aria-haspopup="menu"
                    aria-expanded={open}
                    className="chat-composer__pill"
                    style={{ color: editingStyle ? 'var(--fg)' : undefined }}
                >
                    <ButtonIcon className="w-3.5 h-3.5" />
                    <span>{label}</span>
                    {!isPaid && <Lock className="w-2.5 h-2.5 text-amber-400/80" />}
                </button>
                {open && (
                    <div
                        role="menu"
                        aria-label={t('editingStyles.label')}
                        onKeyDown={onMenuKey}
                        className="chat-composer__menu chat-composer__menu--editing"
                    >
                        <div className="chat-composer__menu-heading" aria-hidden="true">{t('editingStyles.label')}</div>
                        {options.map((id, i) => {
                            const selected = (editingStyle || null) === id;
                            const key = id || 'none';
                            const isLocked = id !== null && !isPaid;
                            const Icon = STYLE_ICONS[key] || Sparkles;
                            return (
                                <button
                                    key={key}
                                    ref={el => { itemRefs.current[i] = el; }}
                                    type="button"
                                    role="menuitemradio"
                                    aria-checked={selected}
                                    onClick={() => choose(id)}
                                    className="chat-composer__menu-item chat-composer__style-item"
                                >
                                    <span className="chat-composer__menu-icon"><Icon className="w-4 h-4" /></span>
                                    <span className="chat-composer__style-text">
                                        <span className="chat-composer__style-title">
                                            {id ? t(`editingStyles.names.${id}`) : t('editingStyles.none')}
                                            {isLocked && (
                                                <span className="chat-composer__pro">
                                                    <Lock className="w-2.5 h-2.5" />
                                                    <span>PRO</span>
                                                </span>
                                            )}
                                        </span>
                                        <span className="chat-composer__style-hint">{t(`editingStyles.hints.${key}`)}</span>
                                    </span>
                                    {selected && <Check className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="chat-composer__mode" role="radiogroup" aria-label={t('editingStyles.modeLabel')}>
                {['normal', 'auto'].map(m => {
                    const active = editingMode === m;
                    const isLocked = m === 'auto' && !isPaid;
                    return (
                        <button key={m} type="button" role="radio" aria-checked={active} disabled={disabled}
                            onClick={() => switchMode(m)}
                            title={isLocked ? t('editingStyles.autoUpgradeTooltip') : t(`editingStyles.${m}Hint`)}
                            className="chat-composer__mode-btn"
                            // Auto is the accent with white on it, in both
                            // themes. Active Normal INVERTS instead: a 14%
                            // white wash with white text was invisible on the
                            // light theme - light grey on light grey - so the
                            // selected mode read as unselected.
                            style={{
                                color: active ? (m === 'auto' ? '#fff' : 'var(--bg)') : 'var(--fg-2)',
                                background: active
                                    ? (m === 'auto' ? 'var(--accent)' : 'color-mix(in oklch, var(--fg) 88%, transparent)')
                                    : 'transparent',
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
