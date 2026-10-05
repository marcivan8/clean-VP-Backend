import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Logo } from '../components/Logo.jsx';
import { LEGAL } from '../legal/legalInfo';

// Landing page for the unsubscribe link in the weekly summary and product
// emails. Requires a click (not automatic on load) so link scanners in mail
// clients cannot unsubscribe people by prefetching the URL.
export default function UnsubscribePage() {
    const { t } = useTranslation('common');
    const [params] = useSearchParams();
    const uid = params.get('uid') || '';
    const sig = params.get('sig') || '';
    const [state, setState] = useState(uid && sig ? 'idle' : 'invalid');

    const submit = async () => {
        setState('working');
        try {
            const res = await fetch('/api/email/unsubscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uid, sig }),
            });
            if (res.status === 403 || res.status === 400) return setState('invalid');
            setState(res.ok ? 'done' : 'error');
        } catch {
            setState('error');
        }
    };

    const message = {
        done: t('unsubscribe.done'),
        invalid: t('unsubscribe.invalid'),
        error: t('unsubscribe.error'),
    }[state];

    return (
        <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div style={{ width: '100%', maxWidth: 440, padding: 28, borderRadius: 12, background: 'var(--bg-2)', border: '0.5px solid var(--line)' }}>
                <div style={{ marginBottom: 20 }}><Logo size={26} /></div>
                <h1 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 10px' }}>{t('unsubscribe.title')}</h1>
                <p style={{ color: 'var(--fg-2)', fontSize: 14.5, lineHeight: 1.65, margin: '0 0 20px' }}>{t('unsubscribe.body')}</p>
                {message && (
                    <p role="status" style={{ color: state === 'done' ? 'var(--fg)' : 'var(--fg-2)', fontSize: 14, lineHeight: 1.6, margin: '0 0 16px' }}>
                        {message}
                        {state === 'invalid' && <> <a href={`mailto:${LEGAL.email}`} style={{ color: 'var(--accent)' }}>{LEGAL.email}</a></>}
                    </p>
                )}
                {(state === 'idle' || state === 'working' || state === 'error') && (
                    <button
                        type="button"
                        onClick={submit}
                        disabled={state === 'working'}
                        style={{
                            minHeight: 44, padding: '0 20px', borderRadius: 8, cursor: state === 'working' ? 'default' : 'pointer',
                            border: '0.5px solid var(--line-strong)', background: 'var(--bg)', color: 'var(--fg)',
                            font: 'inherit', fontSize: 14, fontWeight: 500,
                        }}
                    >
                        {state === 'working' ? t('unsubscribe.working') : t('unsubscribe.button')}
                    </button>
                )}
            </div>
        </div>
    );
}
