/**
 * client/src/market/talent/BecomeTalentPage.jsx — public talent onboarding page,
 * reached from "Become talent" in the landing nav (R101). Route: /talent.
 *
 * Every rule shown here is read from the same versioned rules table the Trust
 * desk edits (market_rules, via GET /api/market/rules), never retyped: a page that promised
 * different terms from the ones the desk enforces would be a contract problem.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { TALENT_AGREEMENT_RULES } from '../marketOpsSeed.js';
import useMarketRules from '../useMarketRules.js';
import { Logo } from '../../components/Logo.jsx';
import { Btn, Card, CardHead, Eyebrow, Pill, Row } from '../ui.jsx';

const STEPS = [
    ['Verify who you are', 'A one-time ID check through our provider. The provider keeps the document; we keep the result, the level and the date. About 3 minutes.'],
    ['Connect payouts', 'Where your money goes after a shoot. Paid from escrow, never chased.'],
    ['Sign your releases', 'An appearance release for you, and a location release for any place you host. Both stay withdrawable for future use.'],
    ['Read the rules, once', 'Cancellation, no-show and damage terms, in plain language. You agree to the version in force today; changes only apply to bookings made after them.'],
    ['Let the listing write itself', 'We read the work you already exported from VIBED, draft the listing and ask only what the files cannot say.'],
];

export default function BecomeTalentPage() {
    const navigate = useNavigate();
    // Live values from the database (R102): the page shows what the Trust desk enforces today.
    const { rules, state: rulesState, value: v } = useMarketRules();
    const start = () => navigate('/talent/setup');

    return (
        <div className="mk">
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px clamp(16px, 4vw, 48px)', gap: 12 }}>
                <button type="button" onClick={() => navigate('/')} aria-label="VIBED home" style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                    <Logo />
                </button>
                <div className="mk-btn-row">
                    <Btn tone="quiet" onClick={() => navigate('/auth?next=%2Ftalent%2Fsetup')}>Log in</Btn>
                    <Btn tone="primary" onClick={start}>Start as talent</Btn>
                </div>
            </header>

            <main style={{ padding: '24px clamp(16px, 4vw, 48px) 80px', maxWidth: 1320, margin: '0 auto' }}>
                <section style={{ maxWidth: 820, marginBottom: 40 }}>
                    <div className="mk-kicker is-purple">VIBED Market · for talent</div>
                    <h1 className="mk-title" style={{ fontSize: 'clamp(44px, 6vw, 76px)' }}>Get booked for the work you already do</h1>
                    <p className="mk-lede" style={{ fontSize: 18, maxWidth: 680 }}>
                        Camera operators, sound, studios and UGC creators. Buyers pay into escrow before you are asked to say yes, the rules are the same for both sides, and a person decides when something goes wrong.
                    </p>
                    <div className="mk-btn-row" style={{ marginTop: 26 }}>
                        <Btn tone="primary" onClick={start}>Start as talent</Btn>
                        <Btn onClick={() => document.getElementById('mk-rules')?.scrollIntoView({ behavior: 'smooth' })}>Read the rules first</Btn>
                    </div>
                </section>

                <div className="mk-grid mk-cols-4" style={{ marginBottom: 40 }}>
                    <Card><Eyebrow>Platform rate</Eyebrow><div className="mk-stat-value is-mono">{v('rate_standard')}</div><div className="mk-stat-sub">{v('rate_pro')} at Pro and Elite level</div></Card>
                    <Card><Eyebrow>Repeat client</Eyebrow><div className="mk-stat-value is-mono">{v('rate_repeat')}</div><div className="mk-stat-sub">from the 4th job with the same client</div></Card>
                    <Card tone="teal"><Eyebrow>Funded before you accept</Eyebrow><div className="mk-stat-value is-mono is-teal">100%</div><div className="mk-stat-sub">authorised at request, captured at acceptance</div></Card>
                    <Card><Eyebrow>Payout</Eyebrow><div className="mk-stat-value is-mono">{v('payout_delay_standard')}</div><div className="mk-stat-sub">after delivery · {v('payout_delay_pro')} at Pro</div></Card>
                </div>

                <div className="mk-grid mk-aside" style={{ marginBottom: 40 }}>
                    <Card>
                        <CardHead title="How it works · about ten minutes" />
                        <ol className="mk-steps">
                            {STEPS.map(([title, body], i) => (
                                <li key={title}>
                                    <span className="mk-step-n">{i + 1}</span>
                                    <span><span style={{ display: 'block', fontSize: 17 }}>{title}</span><span className="mk-muted" style={{ fontSize: 14.5 }}>{body}</span></span>
                                </li>
                            ))}
                        </ol>
                    </Card>
                    <div className="mk-stack">
                        <Card tone="teal">
                            <CardHead title="Your money, before you say yes" tone="teal" />
                            <p style={{ margin: 0 }}>The buyer's card is authorised when they request you and charged into escrow the moment you accept. There is no "accepted but never paid" state.</p>
                            <div className="mk-btn-row" style={{ margin: '16px 0 0', gap: 8 }}>
                                <Pill>authorised</Pill><span aria-hidden="true">→</span><Pill tone="teal">captured</Pill><span aria-hidden="true">→</span><Pill tone="teal">held</Pill><span aria-hidden="true">→</span><Pill tone="green">released</Pill>
                            </div>
                        </Card>
                        <Card>
                            <CardHead title="What we never do" />
                            <p style={{ margin: '0 0 10px' }}>Keep your ID document. The provider holds it; we keep the result.</p>
                            <p style={{ margin: '0 0 10px' }}>Set your price. The number is yours and never auto-adjusts.</p>
                            <p style={{ margin: 0 }}>Let a host or a buyer decide a dispute alone. The Trust desk decides, with a written reason both sides read.</p>
                        </Card>
                    </div>
                </div>

                <section id="mk-rules" style={{ scrollMarginTop: 24 }}>
                    <div className="mk-kicker">The rules you agree to</div>
                    <h2 className="mk-title" style={{ fontSize: 'clamp(32px, 4vw, 46px)', marginBottom: 8 }}>Same rules, both sides, written down</h2>
                    <p className="mk-lede" style={{ marginBottom: 24 }}>These are the live values. If one changes, bookings already made keep the terms they were made under.</p>
                    {rulesState === 'loading' && <p className="mk-muted" role="status">Loading the current rules…</p>}
                    {rulesState === 'error' && <p className="mk-red" role="alert">The rules could not be loaded. Nothing is shown rather than terms that might be out of date.</p>}
                    <div className="mk-grid mk-cols-2" style={{ alignItems: 'start' }}>
                        {rulesState === 'ok' && TALENT_AGREEMENT_RULES.map(([title, keys]) => (
                            <Card key={title}>
                                <CardHead title={title} />
                                {keys.filter((k) => rules[k]).map((k) => <Row key={k} label={rules[k].label} value={v(k)} />)}
                            </Card>
                        ))}
                    </div>
                </section>

                <Card tone="purple" style={{ marginTop: 40, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
                    <div>
                        <div className="mk-h3" style={{ fontSize: 22 }}>One account, one side</div>
                        <p className="mk-muted" style={{ margin: '6px 0 0', maxWidth: 620 }}>A talent account gets booked; a buyer account books. If you already book on VIBED, use a separate account for talent work.</p>
                    </div>
                    <Btn tone="purple" onClick={start}>Start as talent</Btn>
                </Card>
            </main>
        </div>
    );
}
