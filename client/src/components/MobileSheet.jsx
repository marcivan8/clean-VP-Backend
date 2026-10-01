import React, { useEffect, useId } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * MobileSheet — small bottom sheet for mobile menus (More, track menu,
 * speed, editor menu). Fixed above the bottom toolbar (z-60 > its z-50),
 * closes on backdrop tap, the close button or Escape. Renders nothing when
 * closed. Mobile-only callers; uses the app's design tokens.
 */
export default function MobileSheet({ open, title, onClose, children }) {
    const titleId = useId();
    const { t } = useTranslation('editor');
    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    if (!open) return null;
    return (
        <>
            <div
                aria-hidden="true"
                onClick={onClose}
                className="fixed inset-0 md:hidden"
                style={{ zIndex: 60, background: 'rgba(5,5,8,0.6)', backdropFilter: 'blur(2px)' }}
            />
            <section
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="fixed inset-x-0 bottom-0 md:hidden flex flex-col"
                style={{
                    zIndex: 61, maxHeight: '75vh', overflowY: 'auto', gap: 14,
                    padding: '8px 16px calc(20px + env(safe-area-inset-bottom))',
                    background: 'var(--bg-2)', borderTop: '1px solid var(--line-strong)',
                    borderRadius: '20px 20px 0 0', color: 'var(--fg)', fontFamily: 'var(--f-sans)',
                    touchAction: 'manipulation',
                }}
            >
                <div aria-hidden="true" style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--line-strong)', alignSelf: 'center' }} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <h2 id={titleId} style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>{title}</h2>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={t('mobileUi.close')}
                        style={{ width: 40, height: 40, borderRadius: 12, border: 0, background: 'transparent', color: 'var(--fg-2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                        <X size={18} />
                    </button>
                </div>
                {children}
            </section>
        </>
    );
}

/** Section label used inside sheets. */
export function SheetLabel({ children }) {
    return (
        <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--fg-3)' }}>
            {children}
        </div>
    );
}

/** Pill/chip button used for single-choice rows (aspect ratio, speed…). */
export function SheetChip({ active, onClick, children, disabled }) {
    return (
        <button
            type="button"
            aria-pressed={!!active}
            disabled={disabled}
            onClick={onClick}
            style={{
                minHeight: 40, padding: '0 14px', borderRadius: 20, whiteSpace: 'nowrap',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--line-strong)'}`,
                background: active ? 'var(--accent)' : 'var(--bg-3)',
                color: active ? '#fff' : 'var(--fg)', fontFamily: 'var(--f-sans)', fontSize: 13.5, fontWeight: 500,
                opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
            }}
        >
            {children}
        </button>
    );
}

/** Full-width row button with an icon (menus). */
export function SheetRow({ icon, label, sub, onClick, danger, disabled }) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            style={{
                display: 'flex', alignItems: 'center', gap: 14, minHeight: 52, padding: '0 12px', borderRadius: 14, textAlign: 'left',
                border: '1px solid var(--line)', background: 'var(--bg-3)', color: danger ? 'var(--coral)' : 'var(--fg)',
                opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer', width: '100%',
            }}
        >
            <span style={{ color: danger ? 'var(--coral)' : 'var(--accent)', display: 'inline-flex' }}>{icon}</span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{label}</span>
                {sub && <span style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>{sub}</span>}
            </span>
        </button>
    );
}
