import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getConsent, setConsent, onConsentOpen } from '../lib/consent';

// Small consent panel for the two optional trackers: Sentry error replay and
// PostHog product analytics. Each one has its own switch, off by default.
// Accept all and Refuse all have the same size and weight, as the CNIL requires.
// Shown on first visit, after 6 months, and from the footer "Cookie settings".
export default function ConsentBanner() {
    const { t } = useTranslation('common');
    const [open, setOpen] = useState(() => getConsent() === null);
    const [current, setCurrent] = useState(() => getConsent());
    const [replay, setReplay] = useState(() => getConsent()?.replay === true);
    const [analytics, setAnalytics] = useState(() => getConsent()?.analytics === true);

    useEffect(() => onConsentOpen(() => {
        const saved = getConsent();
        setCurrent(saved);
        setReplay(saved?.replay === true);
        setAnalytics(saved?.analytics === true);
        setOpen(true);
    }), []);

    if (!open) return null;

    const choose = (choice) => {
        setCurrent(setConsent(choice));
        setOpen(false);
    };

    const allValue = (v) => current?.replay === v && current?.analytics === v;

    const option = (id, checked, onChange) => (
        <label htmlFor={id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 8, cursor: 'pointer' }}>
            <input
                id={id}
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                style={{ marginTop: 4, accentColor: 'var(--accent)' }}
            />
            <span>
                <span style={{ color: 'var(--fg)', fontWeight: 500 }}>{t(`consent.${id}.title`)}</span>
                <br />
                {t(`consent.${id}.body`)}
            </span>
        </label>
    );

    const btn = {
        flex: 1,
        minHeight: 44,
        padding: '0 16px',
        borderRadius: 8,
        border: '0.5px solid var(--line-strong)',
        background: 'var(--bg)',
        color: 'var(--fg)',
        fontSize: 14,
        fontWeight: 500,
        cursor: 'pointer',
    };

    return (
        <div
            role="dialog"
            aria-labelledby="vibed-consent-title"
            aria-describedby="vibed-consent-body"
            style={{
                position: 'fixed',
                left: 12,
                right: 12,
                bottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
                maxWidth: 420,
                zIndex: 10000,
                padding: 18,
                borderRadius: 12,
                border: '0.5px solid var(--line-strong)',
                background: 'var(--bg-2)',
                color: 'var(--fg-2)',
                boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
                fontSize: 13.5,
                lineHeight: 1.6,
            }}
        >
            <div id="vibed-consent-title" style={{ color: 'var(--fg)', fontWeight: 600, fontSize: 14, marginBottom: 6 }}>
                {t('consent.title')}
            </div>
            <p id="vibed-consent-body" style={{ margin: '0 0 6px' }}>
                {t('consent.body')}
            </p>
            {option('replay', replay, setReplay)}
            {option('analytics', analytics, setAnalytics)}
            <div style={{ height: 10 }} />
            <Link to="/cookie-policy" onClick={() => setOpen(false)} style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: 13 }}>
                {t('consent.learnMore')}
            </Link>
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <button
                    type="button"
                    onClick={() => choose({ replay: false, analytics: false })}
                    aria-pressed={allValue(false)}
                    style={btn}
                >
                    {t('consent.refuse')}
                </button>
                <button
                    type="button"
                    onClick={() => choose({ replay: true, analytics: true })}
                    aria-pressed={allValue(true)}
                    style={btn}
                >
                    {t('consent.accept')}
                </button>
            </div>
            <button
                type="button"
                onClick={() => choose({ replay, analytics })}
                style={{ ...btn, width: '100%', marginTop: 10, background: 'transparent' }}
            >
                {t('consent.save')}
            </button>
        </div>
    );
}
