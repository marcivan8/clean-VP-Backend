/**
 * client/src/pages/AccountPage.jsx
 *
 * Billing & subscription management.
 *
 * This page exists at /account because every plan-confirmation email already
 * links there (`account_url` in routes/polarWebhook.js) — the route was never
 * built, so that link 404'd for every paying customer. Same shape as the LUT
 * import (R33) and the "Your Style" page (R37): a missing entry point is
 * indistinguishable from a missing feature from the outside.
 *
 * Data sources:
 *   GET  /api/polar/subscription  — live state, read from Polar not the DB
 *   POST /api/polar/cancel        — schedules cancellation at period end
 *   POST /api/polar/reactivate    — undoes a scheduled cancellation
 *   POST /api/polar/portal        — hosted Polar portal (invoices, card)
 *
 * The cancellation is at PERIOD END by design: the customer keeps the tier they
 * have already paid for until it lapses. The UI must never imply access is lost
 * immediately, because it isn't.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { authFetch } from '../utils/authFetch.js';

const S = {
    page: {
        minHeight: '100vh',
        background: 'var(--bg, #09090d)',
        color: 'var(--fg, #f0f0f5)',
        fontFamily: 'var(--f-sans, Geist, system-ui, sans-serif)',
        padding: '48px 24px 80px',
        boxSizing: 'border-box',
    },
    inner: { maxWidth: 680, margin: '0 auto' },
    accentBar: {
        height: 1,
        background: 'linear-gradient(90deg, var(--accent, #00e5ff), var(--violet, #8a2be2))',
        marginBottom: 32,
        borderRadius: 1,
    },
    eyebrow: {
        fontFamily: 'var(--f-mono, JetBrains Mono, monospace)',
        fontSize: 10,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: 'var(--fg-3, #7a7a8c)',
        marginBottom: 8,
    },
    h1: { fontSize: 28, fontWeight: 600, margin: '0 0 28px' },
    card: {
        background: 'rgba(255,255,255,0.04)',
        border: '0.5px solid rgba(255,255,255,0.09)',
        borderRadius: 12,
        padding: 24,
        marginBottom: 16,
    },
    row: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        padding: '10px 0',
        borderBottom: '0.5px solid rgba(255,255,255,0.06)',
    },
    label: { fontSize: 13, color: 'var(--fg-3, #7a7a8c)' },
    value: { fontSize: 14, fontWeight: 500 },
    notice: {
        background: 'color-mix(in oklch, var(--accent, #00e5ff) 10%, transparent)',
        border: '0.5px solid color-mix(in oklch, var(--accent, #00e5ff) 28%, transparent)',
        borderRadius: 10,
        padding: '14px 16px',
        fontSize: 13,
        lineHeight: 1.55,
        marginBottom: 16,
    },
    error: {
        background: 'rgba(255,90,90,0.08)',
        border: '0.5px solid rgba(255,90,90,0.3)',
        borderRadius: 10,
        padding: '14px 16px',
        fontSize: 13,
        lineHeight: 1.55,
        marginBottom: 16,
        color: '#ffb4b4',
    },
    btnRow: { display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 20 },
    btnGhost: {
        padding: '10px 18px',
        borderRadius: 8,
        border: '0.5px solid rgba(255,255,255,0.16)',
        background: 'transparent',
        color: 'var(--fg, #f0f0f5)',
        fontSize: 13,
        cursor: 'pointer',
    },
    btnDanger: {
        padding: '10px 18px',
        borderRadius: 8,
        border: '0.5px solid rgba(255,90,90,0.35)',
        background: 'transparent',
        color: '#ff7a7a',
        fontSize: 13,
        cursor: 'pointer',
    },
    btnPrimary: {
        padding: '10px 18px',
        borderRadius: 8,
        border: 'none',
        background: 'linear-gradient(135deg, var(--accent, #00e5ff), var(--violet, #8a2be2))',
        color: '#fff',
        fontSize: 13,
        fontWeight: 500,
        cursor: 'pointer',
    },
    select: {
        width: '100%',
        padding: '10px 12px',
        borderRadius: 8,
        border: '0.5px solid rgba(255,255,255,0.16)',
        background: 'var(--bg-2, #111118)',
        color: 'var(--fg, #f0f0f5)',
        fontSize: 13,
        marginBottom: 12,
    },
    textarea: {
        width: '100%',
        minHeight: 80,
        padding: '10px 12px',
        borderRadius: 8,
        border: '0.5px solid rgba(255,255,255,0.16)',
        background: 'var(--bg-2, #111118)',
        color: 'var(--fg, #f0f0f5)',
        fontSize: 13,
        fontFamily: 'inherit',
        resize: 'vertical',
        boxSizing: 'border-box',
    },
};

// Polar's fixed enum. Anything not in this list is dropped server-side.
const REASONS = [
    ['',                  'Prefer not to say'],
    ['too_expensive',     'Too expensive'],
    ['missing_features',  'Missing features I need'],
    ['switched_service',  'Switched to another tool'],
    ['unused',            "I'm not using it enough"],
    ['customer_service',  'Unhappy with support'],
    ['low_quality',       'Quality not what I expected'],
    ['too_complex',       'Too complicated to use'],
    ['other',             'Other'],
];

function formatDate(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function AccountPage() {
    const [sub,      setSub]      = useState(null);
    const [loading,  setLoading]  = useState(true);
    const [error,    setError]    = useState(null);
    const [busy,     setBusy]     = useState(false);
    const [confirm,  setConfirm]  = useState(false);
    const [reason,   setReason]   = useState('');
    const [comment,  setComment]  = useState('');
    const [flash,    setFlash]    = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res  = await authFetch('/api/polar/subscription');
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Could not load your subscription.');
            setSub(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const cancel = async () => {
        setBusy(true);
        setError(null);
        try {
            const res  = await authFetch('/api/polar/cancel', {
                method: 'POST',
                body:   JSON.stringify({ reason: reason || undefined, comment: comment || undefined }),
            });
            const data = await res.json();
            // Trust the server's own verdict — it verifies with Polar that the
            // cancellation actually took effect before reporting success.
            if (!res.ok || !data.canceled) {
                throw new Error(data.error || 'The subscription was not changed.');
            }
            setFlash(data.message);
            setConfirm(false);
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const reactivate = async () => {
        setBusy(true);
        setError(null);
        try {
            const res  = await authFetch('/api/polar/reactivate', { method: 'POST' });
            const data = await res.json();
            if (!res.ok || !data.reactivated) {
                throw new Error(data.error || 'The subscription was not changed.');
            }
            setFlash(data.message);
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const openPortal = async () => {
        setBusy(true);
        setError(null);
        try {
            const res  = await authFetch('/api/polar/portal', { method: 'POST' });
            const data = await res.json();
            if (!res.ok || !data.url) throw new Error(data.error || 'Could not open the billing portal.');
            window.open(data.url, '_blank', 'noopener,noreferrer');
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const endsOn = formatDate(sub?.currentPeriodEnd);

    return (
        <div style={S.page}>
            <div style={S.inner}>
                <div style={S.accentBar} />
                <div style={S.eyebrow}>Account</div>
                <h1 style={S.h1}>Billing &amp; subscription</h1>

                {flash && <div style={S.notice}>{flash}</div>}
                {error && <div style={S.error}>{error}</div>}

                {loading ? (
                    <div style={S.card}>
                        <span style={S.label}>Loading your subscription…</span>
                    </div>
                ) : !sub?.active && !sub?.cancelAtPeriodEnd ? (
                    <div style={S.card}>
                        <div style={S.row}>
                            <span style={S.label}>Current plan</span>
                            <span style={S.value}>Free</span>
                        </div>
                        <p style={{ ...S.label, marginTop: 16, lineHeight: 1.6 }}>
                            You don’t have an active subscription. Upgrade from the dashboard to
                            unlock exports and higher limits.
                        </p>
                    </div>
                ) : (
                    <>
                        <div style={S.card}>
                            <div style={S.row}>
                                <span style={S.label}>Current plan</span>
                                <span style={{ ...S.value, textTransform: 'capitalize' }}>{sub.plan}</span>
                            </div>
                            <div style={S.row}>
                                <span style={S.label}>Status</span>
                                <span style={S.value}>
                                    {sub.cancelAtPeriodEnd ? 'Cancels at period end' : 'Active'}
                                </span>
                            </div>
                            {endsOn && (
                                <div style={{ ...S.row, borderBottom: 'none' }}>
                                    <span style={S.label}>
                                        {sub.cancelAtPeriodEnd ? 'Access until' : 'Renews on'}
                                    </span>
                                    <span style={S.value}>{endsOn}</span>
                                </div>
                            )}
                        </div>

                        {sub.cancelAtPeriodEnd && (
                            <div style={S.notice}>
                                Your subscription is scheduled to end
                                {endsOn ? ` on ${endsOn}` : ' at the end of this billing period'}.
                                You keep full <strong style={{ textTransform: 'capitalize' }}>{sub.plan}</strong> access
                                until then — nothing changes before that date. You can undo this any time
                                before it takes effect.
                            </div>
                        )}

                        <div style={S.btnRow}>
                            <button style={S.btnGhost} onClick={openPortal} disabled={busy}>
                                Invoices &amp; payment method
                            </button>

                            {sub.cancelAtPeriodEnd ? (
                                <button style={S.btnPrimary} onClick={reactivate} disabled={busy}>
                                    {busy ? 'Working…' : 'Resume subscription'}
                                </button>
                            ) : sub.canCancel && !confirm ? (
                                <button style={S.btnDanger} onClick={() => setConfirm(true)} disabled={busy}>
                                    Cancel subscription
                                </button>
                            ) : null}
                        </div>

                        {confirm && !sub.cancelAtPeriodEnd && (
                            <div style={{ ...S.card, marginTop: 16 }}>
                                <p style={{ fontSize: 14, lineHeight: 1.6, marginTop: 0 }}>
                                    You’ll keep full <strong style={{ textTransform: 'capitalize' }}>{sub.plan}</strong> access
                                    until {endsOn || 'the end of your current billing period'}. After that your
                                    account moves to the free plan. Your projects are not deleted.
                                </p>

                                <label style={{ ...S.label, display: 'block', margin: '18px 0 6px' }}>
                                    Why are you cancelling? (optional)
                                </label>
                                <select
                                    style={S.select}
                                    value={reason}
                                    onChange={e => setReason(e.target.value)}
                                >
                                    {REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                </select>

                                <textarea
                                    style={S.textarea}
                                    placeholder="Anything else you'd like us to know? (optional)"
                                    value={comment}
                                    onChange={e => setComment(e.target.value)}
                                    maxLength={1000}
                                />

                                <div style={S.btnRow}>
                                    <button style={S.btnGhost} onClick={() => setConfirm(false)} disabled={busy}>
                                        Keep my subscription
                                    </button>
                                    <button style={S.btnDanger} onClick={cancel} disabled={busy}>
                                        {busy ? 'Cancelling…' : 'Confirm cancellation'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
