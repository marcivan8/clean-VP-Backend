/**
 * client/src/market/talent/TalentSetup.jsx — guided talent setup (R101). Route: /talent/setup.
 *
 *   signed out      → sign in / create an account, then come back here (?next=)
 *   buyer account   → talent needs a separate account (R100: one side per account)
 *   no role yet     → confirm "this becomes a talent account" (final)
 *   talent account  → identity → payouts → releases → rules → listing
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { TALENT_AGREEMENT_RULES } from '../marketOpsSeed.js';
import { chooseMarketRole, fetchMarketMe } from '../marketAccount.js';
import { fetchOnboarding, onboardingStep } from '../marketApi.js';
import useMarketRules from '../useMarketRules.js';
import { Logo } from '../../components/Logo.jsx';
import { Btn, Card, CardHead, Eyebrow, Pill, Row } from '../ui.jsx';
import { useToast } from '../useToast.jsx';
import { cx } from '../uiUtils.js';

const NEXT = '/talent/setup';

function Frame({ children, aside }) {
    const navigate = useNavigate();
    return (
        <div className="mk">
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px clamp(16px, 4vw, 48px)' }}>
                <button type="button" onClick={() => navigate('/talent')} aria-label="Back to the talent page" style={{ all: 'unset', cursor: 'pointer', display: 'flex' }}><Logo /></button>
                <button type="button" className="mk-back" style={{ margin: 0 }} onClick={() => navigate('/talent')}>← What talent agrees to</button>
            </header>
            <main style={{ padding: '12px clamp(16px, 4vw, 48px) 80px', maxWidth: 1240, margin: '0 auto' }}>
                {aside ? <div className="mk-grid mk-aside">{children}{aside}</div> : children}
            </main>
        </div>
    );
}

export default function TalentSetup() {
    const navigate = useNavigate();
    const [me, setMe] = useState(null);
    useEffect(() => { fetchMarketMe().then(setMe); }, []);
    const retry = () => { setMe(null); fetchMarketMe().then(setMe); };

    if (!me) return <Frame><p className="mk-muted" role="status">Loading…</p></Frame>;

    if (me.status === 'signed_out') {
        return (
            <Frame>
                <div style={{ maxWidth: 720 }}>
                    <div className="mk-kicker is-purple">Talent setup · step 0</div>
                    <h1 className="mk-title">First, an account</h1>
                    <p className="mk-lede">Bookings, money and reviews belong to a person. Create an account or log in, and you will come straight back here.</p>
                    <div className="mk-btn-row" style={{ marginTop: 24 }}>
                        <Btn tone="primary" onClick={() => navigate(`/auth?next=${encodeURIComponent(NEXT)}`)}>Create an account or log in</Btn>
                    </div>
                </div>
            </Frame>
        );
    }
    if (me.status !== 'ok') {
        return <Frame><Card tone="red"><Eyebrow tone="red">Could not load your account</Eyebrow><p className="mk-lede">Nothing was changed.</p><Btn style={{ marginTop: 16 }} onClick={retry}>Try again</Btn></Card></Frame>;
    }
    if (me.role === 'buyer') {
        return (
            <Frame>
                <div style={{ maxWidth: 720 }}>
                    <div className="mk-kicker">Talent setup</div>
                    <h1 className="mk-title">This is a buyer account</h1>
                    <p className="mk-lede">On VIBED an account books or gets booked, not both, so reviews and money never mix. To offer your work, log out and create a separate account with another email.</p>
                    <div className="mk-btn-row" style={{ marginTop: 24 }}>
                        <Btn onClick={() => navigate('/marketplace')}>Back to my bookings</Btn>
                    </div>
                </div>
            </Frame>
        );
    }
    if (!me.role) return <ConfirmTalent onDone={(role) => setMe({ ...me, role })} />;
    return <Steps />;
}

function ConfirmTalent({ onDone }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const go = async () => {
        setBusy(true); setError(null);
        const r = await chooseMarketRole('talent');
        setBusy(false);
        if (r.ok) onDone('talent');
        else if (r.role) onDone(r.role); // the account already had a role; the gate above handles a buyer
        else setError(r.error);
    };
    return (
        <Frame>
            <div style={{ maxWidth: 720 }}>
                <div className="mk-kicker is-purple">Talent setup · step 0</div>
                <h1 className="mk-title">Make this a talent account</h1>
                <p className="mk-lede">A talent account gets booked. This choice is final for this account: to book other people's work, you would use a separate account.</p>
                {error && <p className="mk-red" role="alert">{error}</p>}
                <Btn tone="purple" style={{ marginTop: 24 }} disabled={busy} onClick={go}>{busy ? 'Saving…' : 'Yes, this is my talent account'}</Btn>
            </div>
        </Frame>
    );
}

const STEP_LIST = [
    ['identity', 'Verify who you are'],
    ['payouts', 'Connect payouts'],
    ['releases', 'Sign your releases'],
    ['rules', 'Accept the rules'],
];

/** Which steps are done, from the saved onboarding (R102: GET /api/market/onboarding). */
function progressOf(o) {
    const steps = {
        identity: o?.idCheck?.result === 'pass',
        payouts: o?.payoutsConnected === true,
        releases: !!o?.appearanceReleaseAt && (o?.hostsLocations === false || (o?.hostsLocations === true && !!o?.locationReleaseAt)),
        rules: !!o?.rulesAcceptedAt,
    };
    const done = Object.values(steps).filter(Boolean).length;
    return { steps, done, total: 4, canPublish: steps.releases && steps.rules };
}

function Steps() {
    const navigate = useNavigate();
    const { rules, state: rulesState, value: v } = useMarketRules();
    const { report: toast, toastNode } = useToast();
    const [o, setO] = useState(null);
    const [loadError, setLoadError] = useState(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        fetchOnboarding().then((r) => (r.ok ? setO(r.onboarding) : setLoadError(r.error)));
    }, []);

    const p = progressOf(o);
    // The first unfinished step is open unless the person picked another one.
    const firstOpen = STEP_LIST.find(([id]) => !p.steps[id] && id !== 'identity' && id !== 'payouts')?.[0] || null;
    const [picked, setPicked] = useState(undefined);
    const open = picked === undefined ? firstOpen : picked;
    const setOpen = setPicked;

    const step = async (name, body, okText) => {
        setBusy(true);
        const r = await onboardingStep(name, body);
        setBusy(false);
        if (r.ok) { setO(r.onboarding); setPicked(undefined); }
        toast(r, okText);
    };

    if (loadError) return <Frame><Card tone="red"><Eyebrow tone="red">Could not load your setup</Eyebrow><p className="mk-lede">{loadError}</p></Card></Frame>;
    if (!o) return <Frame><p className="mk-muted" role="status">Loading your setup…</p></Frame>;

    const aside = (
        <div className="mk-stack">
            <Card>
                <CardHead title="Your setup" right={<span className="mk-mono mk-amber">{p.done} of {p.total}</span>} />
                <div className="mk-bar is-amber" role="progressbar" aria-valuenow={p.done} aria-valuemin={0} aria-valuemax={p.total}><i style={{ width: `${(p.done / p.total) * 100}%` }} /></div>
                {STEP_LIST.map(([id, label]) => <Row key={id} label={label} value={p.steps[id] ? 'done' : (id === 'identity' || id === 'payouts') ? 'with payments' : 'to do'} valueClass={p.steps[id] ? 'mk-green' : 'mk-muted'} />)}
                <Row label="Your listing" value={p.canPublish ? 'ready' : 'next'} valueClass={p.canPublish ? 'mk-green' : 'mk-muted'} />
            </Card>
            <Card>
                <CardHead title="Kept, and not kept" />
                <p className="mk-note" style={{ marginTop: 0 }}><b>ID documents:</b> never stored. The payout provider verifies you and holds them; VIBED keeps the result, the level and the date ({v('ret_verification')}).</p>
                <p className="mk-note"><b>Releases:</b> withdrawable for future use at any time. Withdrawing takes your files down from the platform and the archive.</p>
            </Card>
        </div>
    );

    return (
        <Frame aside={aside}>
            <div>
                {toastNode}
                <div className="mk-kicker is-purple">Talent setup</div>
                <h1 className="mk-title">Your releases and the rules, then your listing</h1>
                <p className="mk-lede" style={{ marginBottom: 26 }}>Your listing can go live once the releases are signed and the rules accepted. Identity and payouts are verified together when payments open, before your first booking.</p>

                <StepCard id="identity" n={1} title="Verify who you are" done={p.steps.identity} open={open} setOpen={setOpen}
                    summary={o.idCheck && `Verified ${o.idCheck.date} · level ${o.idCheck.level}`}>
                    <p style={{ margin: 0 }}>Done by the payout provider when you connect payouts: one check, no separate service. They hold the document; VIBED receives and keeps three things: the result, the level and the date.</p>
                    <Pill tone="amber">Opens with payments, before your first booking</Pill>
                </StepCard>

                <StepCard id="payouts" n={2} title="Connect payouts" done={p.steps.payouts} open={open} setOpen={setOpen} summary="Payout account connected">
                    <p style={{ margin: '0 0 12px' }}>The account your money is released to: {v('payout_delay_standard')} after delivery is accepted ({v('payout_delay_pro')} at Pro and Elite).</p>
                    <Pill tone="amber">Opens with payments, before your first booking</Pill>
                </StepCard>

                <StepCard id="releases" n={3} title="Sign your releases" done={p.steps.releases} open={open} setOpen={setOpen}
                    summary={`Appearance release signed${o.hostsLocations ? ' · location release signed' : ''}`}>
                    <Release
                        title="Appearance release · people"
                        body="Lets buyers use footage in which you appear, within the licence of each booking. You can withdraw it for future use: the files then come down from the platform and the archive, and buyers are told to stop using them."
                        signed={!!o.appearanceReleaseAt}
                        disabled={busy}
                        onSign={() => step('appearance-release', {}, 'Appearance release signed.')}
                    />
                    <div style={{ marginTop: 22 }}>
                        <p style={{ margin: '0 0 10px' }} id="mk-hosts">Do you host shoots in a place you own or rent (a studio, a room, a shop)?</p>
                        <div className="mk-btn-row" role="radiogroup" aria-labelledby="mk-hosts">
                            {[[true, 'Yes, I host'], [false, 'No']].map(([val, label]) => (
                                <button key={label} type="button" role="radio" aria-checked={o.hostsLocations === val} disabled={busy}
                                    onClick={() => o.hostsLocations !== val && step('hosts', { hosts: val }, val ? 'Noted. Sign the location release below.' : 'Noted. No location release needed.')}
                                    className={cx('mk-pill', o.hostsLocations === val && 'is-teal')} style={{ cursor: 'pointer', fontSize: 15, padding: '8px 16px' }}>{label}</button>
                            ))}
                        </div>
                    </div>
                    {o.hostsLocations && (
                        <div style={{ marginTop: 18 }}>
                            <Release
                                title="Location release · places"
                                body="Lets buyers use footage that shows the place you host, for what was shot during their booking and within its licence. It covers the place, not the people in it, who sign their own appearance release. Withdrawable for future bookings."
                                signed={!!o.locationReleaseAt}
                                disabled={busy}
                                onSign={() => step('location-release', {}, 'Location release signed.')}
                            />
                        </div>
                    )}
                </StepCard>

                <StepCard id="rules" n={4} title="Accept the rules" done={p.steps.rules} open={open} setOpen={setOpen}
                    summary={o.rulesAcceptedAt && `Accepted ${new Date(o.rulesAcceptedAt).toLocaleDateString()}`}>
                    <p style={{ margin: '0 0 14px' }}>The same rules apply to buyers. You agree to the values in force today; a later change only applies to bookings made after it.</p>
                    {rulesState === 'error' && <p className="mk-red" role="alert">The rules could not be loaded, so they cannot be accepted right now.</p>}
                    {rulesState === 'ok' && (
                        <div className="mk-grid mk-cols-2" style={{ gap: 14 }}>
                            {TALENT_AGREEMENT_RULES.filter(([t]) => o.hostsLocations || t !== 'If you host a studio').map(([title, keys]) => (
                                <div key={title} className="mk-callout" style={{ marginTop: 0, background: 'var(--mk-sunk)' }}>
                                    <Eyebrow>{title}</Eyebrow>
                                    {keys.filter((k) => rules[k]).map((k) => <Row key={k} label={rules[k].label} value={v(k)} />)}
                                </div>
                            ))}
                        </div>
                    )}
                    <Btn tone="primary" style={{ marginTop: 18 }} disabled={busy || rulesState !== 'ok'} onClick={() => step('accept-rules', {}, 'Accepted. These are the terms your bookings run on.')}>I accept these rules</Btn>
                </StepCard>

                <Card tone={p.canPublish ? 'green' : undefined} style={{ marginTop: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                        <div>
                            <div className="mk-h3">{p.canPublish ? 'Ready. Now your listing.' : 'Then: your listing'}</div>
                            <p className="mk-muted" style={{ margin: '4px 0 0' }}>Add what you offer, your half-day price and where you work. Studios show their address; people show their town.</p>
                        </div>
                        <Btn tone={p.canPublish ? 'primary' : undefined} disabled={!p.canPublish} onClick={() => navigate('/marketplace')}>
                            {p.canPublish ? 'Create my listing' : 'Releases and rules first'}
                        </Btn>
                    </div>
                </Card>
            </div>
        </Frame>
    );
}

function StepCard({ id, n, title, done, open, setOpen, summary, children }) {
    const isOpen = open === id;
    return (
        <Card style={{ marginBottom: 16 }} tone={done ? 'green' : undefined}>
            <button type="button" onClick={() => setOpen(isOpen ? null : id)} aria-expanded={isOpen}
                style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14, width: '100%' }}>
                <span className={cx('mk-step-n')} style={done ? { background: 'var(--mk-green)', borderColor: 'var(--mk-green)', color: '#fff' } : undefined} aria-hidden="true">
                    {done ? <Check size={15} /> : n}
                </span>
                <span style={{ flex: 1 }}>
                    <span className="mk-h3" style={{ display: 'block' }}>{title}</span>
                    {done && summary && <span className="mk-muted" style={{ fontSize: 14 }}>{summary}</span>}
                </span>
                <span className="mk-muted" aria-hidden="true">{isOpen ? '−' : '+'}</span>
            </button>
            {isOpen && <div style={{ marginTop: 18 }}>{children}</div>}
        </Card>
    );
}

function Release({ title, body, signed, onSign, disabled }) {
    return (
        <div className="mk-callout" style={{ marginTop: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <b>{title}</b>
                {signed ? <Pill tone="green">Signed</Pill> : <Btn size="small" tone="primary" disabled={disabled} onClick={onSign}>Sign</Btn>}
            </div>
            <p style={{ margin: '8px 0 0' }}>{body}</p>
        </div>
    );
}
