/**
 * client/src/market/MarketGate.jsx — routes an account to its interface (R100).
 *
 *   /marketplace   → buyer account   → the existing buyer market (MarketplacePage)
 *                  → talent account  → TalentApp
 *                  → no role yet     → choose once (separate accounts per role)
 *   /admin/trust   → is_admin only   → TrustDesk (anyone else sees "not found")
 */
import React, { lazy, Suspense, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { chooseMarketRole, checkMarketAdmin, fetchMarketMe } from './marketAccount.js';
import { Btn, Card, Eyebrow } from './ui.jsx';
import { cx } from './uiUtils.js';

const MarketplacePage = lazy(() => import('../pages/MarketplacePage.jsx'));
const TalentApp = lazy(() => import('./talent/TalentApp.jsx'));
const TrustDesk = lazy(() => import('./admin/TrustDesk.jsx'));

function Centered({ children }) {
    return (
        <div className="mk" style={{ display: 'grid', placeItems: 'center', padding: 24 }}>
            <div style={{ width: '100%', maxWidth: 820 }}>{children}</div>
        </div>
    );
}

function Loading() {
    return <Centered><p className="mk-muted" role="status">Opening VIBED Market…</p></Centered>;
}

function SignedOut() {
    const navigate = useNavigate();
    return (
        <Centered>
            <Card>
                <Eyebrow>VIBED Market</Eyebrow>
                <h1 className="mk-title" style={{ fontSize: 40 }}>Sign in to continue</h1>
                <p className="mk-lede">The market needs an account: bookings, money and reviews are attached to a person.</p>
                <Btn tone="primary" style={{ marginTop: 20 }} onClick={() => navigate('/auth')}>Sign in</Btn>
            </Card>
        </Centered>
    );
}

function Failed({ onRetry }) {
    return (
        <Centered>
            <Card tone="red">
                <Eyebrow tone="red">Could not open the market</Eyebrow>
                <p className="mk-lede">The server did not answer. Nothing was changed.</p>
                <Btn style={{ marginTop: 18 }} onClick={onRetry}>Try again</Btn>
            </Card>
        </Centered>
    );
}

const ROLE_COPY = {
    buyer: { title: 'I book', body: 'Studios, crews and operators for your own shoots. You brief, pay into escrow, and receive the work.' },
    talent: { title: 'I get booked', body: 'You shoot, host or create. You get requests and briefs that fit your verified work, and get paid from escrow.' },
};

function ChooseRole({ onChosen }) {
    const [pick, setPick] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    const confirm = async () => {
        setBusy(true);
        setError(null);
        const r = await chooseMarketRole(pick);
        setBusy(false);
        if (r.ok || r.role) onChosen(r.role || pick);
        else setError(r.error);
    };

    return (
        <Centered>
            <div className="mk-kicker">VIBED Market</div>
            <h1 className="mk-title">How will you use the market?</h1>
            <p className="mk-lede">One account is either a buyer or a talent account. This choice is final for this account: to do the other, use a separate account.</p>
            <div className="mk-grid mk-cols-2" style={{ margin: '26px 0 20px' }} role="radiogroup" aria-label="Account type">
                {Object.entries(ROLE_COPY).map(([id, c]) => (
                    <button key={id} type="button" role="radio" aria-checked={pick === id} onClick={() => setPick(id)}
                        className={cx('mk-card', pick === id && 'is-teal')}
                        style={{ all: 'unset', boxSizing: 'border-box', cursor: 'pointer', background: '#fff', border: `1.5px solid ${pick === id ? 'var(--mk-teal)' : 'var(--mk-line)'}`, borderRadius: 20, padding: '24px 26px' }}>
                        <span className="mk-h3" style={{ display: 'block' }}>{c.title}</span>
                        <span className="mk-muted" style={{ display: 'block', marginTop: 8, fontSize: 14.5 }}>{c.body}</span>
                    </button>
                ))}
            </div>
            {error && <p className="mk-red" role="alert">{error}</p>}
            <Btn tone="primary" disabled={!pick || busy} onClick={confirm}>
                {busy ? 'Saving…' : pick ? `Continue as a ${pick} account` : 'Choose one'}
            </Btn>
        </Centered>
    );
}

export function MarketGate() {
    const [me, setMe] = useState(null);
    const navigate = useNavigate();
    useEffect(() => { fetchMarketMe().then(setMe); }, []);
    const retry = () => { setMe(null); fetchMarketMe().then(setMe); };

    if (!me) return <Loading />;
    if (me.status === 'signed_out') return <SignedOut />;
    if (me.status !== 'ok') return <Failed onRetry={retry} />;
    if (!me.role) return <ChooseRole onChosen={(role) => setMe({ ...me, role })} />;

    return (
        <Suspense fallback={<Loading />}>
            {me.role === 'talent' ? <TalentApp onExit={() => navigate('/dashboard')} /> : <MarketplacePage />}
        </Suspense>
    );
}

export function MarketAdminGate() {
    const [state, setState] = useState('loading');
    useEffect(() => { checkMarketAdmin().then(setState); }, []);
    const retry = () => { setState('loading'); checkMarketAdmin().then(setState); };

    if (state === 'loading') return <Loading />;
    if (state === 'signed_out') return <SignedOut />;
    if (state === 'error') return <Failed onRetry={retry} />;
    if (state !== 'admin') {
        // Same answer as a page that does not exist: the gate must not confirm an admin surface is here.
        return <Centered><h1 className="mk-title" style={{ fontSize: 40 }}>Page not found</h1></Centered>;
    }
    return <Suspense fallback={<Loading />}><TrustDesk /></Suspense>;
}

export default MarketGate;
