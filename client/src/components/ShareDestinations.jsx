import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2, Check, Loader2, AlertCircle } from 'lucide-react';
import { SHARE_ROW, SHARE_ROW_LABEL, SHARE_ROW_NOTE } from './shareRow.js';
import {
    fetchDestinations, connectDestination, disconnectDestination, takeConnectOutcome,
} from '../lib/socialDestinations';

/**
 * ShareDestinations — "Publish to" inside the export sheet.
 *
 * Connecting an account works now. POSTING from Vibed does not, for every
 * platform, and not because of missing code: TikTok, Meta and Google each
 * require an approved app before they accept an upload from anyone but the
 * developer's own test account. So this says so plainly instead of offering a
 * Post button that fails. R149.
 *
 * It sits below Save to phone and Share rather than replacing them, because
 * the share sheet already reaches TikTok and Instagram through the phone's own
 * apps and that keeps working whatever the API review says.
 */
export default function ShareDestinations() {
    const { t } = useTranslation('editor');
    const [destinations, setDestinations] = useState(null); // null = loading
    const [busy, setBusy] = useState(null);                 // provider id
    const [notice, setNotice] = useState(null);             // { connected } | { error }

    const load = useCallback(async () => {
        setDestinations(await fetchDestinations() || []);
    }, []);

    useEffect(() => {
        let cancelled = false;
        // The outcome is read BEFORE the fetch, so a connection that was just
        // made is reflected in the list that loads. Both pieces of state are
        // set together in the async callback rather than synchronously in the
        // effect body: one render instead of two, and it is what the
        // set-state-in-effect rule is asking for.
        (async () => {
            const outcome = takeConnectOutcome();
            const list = await fetchDestinations();
            if (cancelled) return;
            setNotice(outcome);
            setDestinations(list || []);
        })();
        return () => { cancelled = true; };
    }, []);

    const onConnect = async (id) => {
        setBusy(id); setNotice(null);
        const error = await connectDestination(id, `${window.location.pathname}`);
        // No error means the browser is navigating to the consent screen, so
        // leaving `busy` set is correct: the page is going away.
        if (error) { setNotice({ error }); setBusy(null); }
    };

    const onDisconnect = async (id) => {
        setBusy(id); setNotice(null);
        const ok = await disconnectDestination(id);
        if (!ok) setNotice({ error: 'DISCONNECT_FAILED' });
        await load();
        setBusy(null);
    };

    if (destinations === null) return null;
    if (destinations.length === 0) return null;

    const action = {
        minHeight: 36, padding: '8px 14px', borderRadius: 999, cursor: 'pointer', flex: 'none',
        border: '1px solid var(--line-strong)', background: 'transparent',
        color: 'var(--fg)', fontFamily: 'var(--f-sans)', fontSize: 13.5, fontWeight: 600,
    };

    return (
        <>
            {notice?.connected && (
                <p style={{ margin: '0 0 2px', fontSize: 12.5, color: 'var(--fg-2)' }}>
                    {t('shareDestinations.connectedNotice', { provider: notice.connected })}
                </p>
            )}
            {notice?.error && (
                <p role="alert" style={{ margin: '0 0 2px', fontSize: 12.5, color: 'var(--coral)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <AlertCircle size={13} /> {t(`shareDestinations.error_${notice.error}`, t('shareDestinations.error_GENERIC'))}
                </p>
            )}

            {destinations.map((d) => {
                const connected = d.connection && !d.connection.needsReconnect;
                const stale = d.connection?.needsReconnect;
                const note = !d.configured
                    ? t('shareDestinations.notAvailable', 'Not available yet')
                    : stale
                        ? t('shareDestinations.needsReconnect', 'Sign in again')
                        : connected
                            ? (d.connection.handle || t('shareDestinations.connected', 'Connected'))
                            : null;

                // A destination with no credentials on the server cannot be
                // connected, so its row is a statement rather than a button
                // that would go nowhere.
                const Tag = d.configured ? 'button' : 'div';
                return (
                    <Tag
                        key={d.id}
                        {...(d.configured ? { type: 'button', onClick: () => (connected ? onDisconnect(d.id) : onConnect(d.id)) } : {})}
                        style={{ ...SHARE_ROW, cursor: d.configured ? 'pointer' : 'default', opacity: d.configured ? 1 : 0.6 }}
                    >
                        {connected
                            ? <Check size={20} style={{ color: 'var(--accent-2)', flex: 'none' }} />
                            : <Link2 size={20} style={{ color: 'var(--fg-3)', flex: 'none' }} />}
                        <span style={SHARE_ROW_LABEL}>{d.label}</span>
                        {busy === d.id
                            ? <Loader2 size={16} style={{ color: 'var(--fg-3)', flex: 'none' }} />
                            : note && <span style={SHARE_ROW_NOTE}>{note}</span>}
                        {d.configured && !connected && !busy && (
                            <span style={action}>
                                {stale ? t('shareDestinations.reconnect', 'Reconnect') : t('shareDestinations.connect', 'Connect')}
                            </span>
                        )}
                    </Tag>
                );
            })}

            {/* Said once, under the list. */}
            <p style={{ margin: '2px 0 0', fontSize: 11.5, lineHeight: 1.5, color: 'var(--fg-3)' }}>
                {destinations.some((d) => d.publishReady)
                    ? t('shareDestinations.publishNote')
                    : t('shareDestinations.reviewPending')}
            </p>
        </>
    );
}
