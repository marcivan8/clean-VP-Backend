/**
 * client/src/market/talent/TalentApp.jsx — the talent (supply-side) interface
 * of VIBED Market (R100). Screens 12 (my work), 17 (new request), 18 (on set),
 * 19 (earnings), 21 (listing intake), and 29 (report a problem).
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import useMarketOpsStore from '../../store/useMarketOpsStore.js';
import { eur } from '../opsMath.js';
import { Btn, Card, CardHead, Chip, Eyebrow, PageHead, Pill, Row, Shell, Stat } from '../ui.jsx';
import { useToast } from '../useToast.jsx';
import { cx } from '../uiUtils.js';
import ReportProblem from '../ReportProblem.jsx';
import TalentListings from './TalentListings.jsx';

/** Seed-data views (screens 12, 17-19, 21, 29): off until they run on real bookings (phase 3). */
const SHOW_SEED_VIEWS = false;

function SetupLink() {
    const navigate = useNavigate();
    return (
        <>
            <PageHead kicker="Supply side · Setup" kickerTone="purple" title="Your releases and the rules" lede="Signed releases and accepted rules are what let a listing go live." />
            <Btn tone="primary" onClick={() => navigate('/talent/setup')}>Open setup</Btn>
        </>
    );
}

export default function TalentApp({ onExit }) {
    // R102: listings are real; work, briefs, requests, on set, earnings and
    // reports still run on seed data and would show a real talent invented
    // money and jobs, so they stay hidden until bookings and payments exist.
    const [view, setView] = useState('listings');
    const talent = useMarketOpsStore((s) => s.talent);
    const request = useMarketOpsStore((s) => s.jobRequest);
    const openBriefs = talent.briefs.filter((b) => !b.hiddenByRules && !b.applied).length;

    const items = [
        { id: 'listings', label: 'My listings' },
        { id: 'setup', label: 'Setup' },
        ...(SHOW_SEED_VIEWS ? [
            { id: 'work', label: 'My work' },
            { id: 'briefs', label: 'Open briefs', count: openBriefs, tone: 'purple' },
            { id: 'request', label: 'Requests', count: request.status === 'open' ? 1 : 0, tone: 'purple' },
            { id: 'onset', label: 'On set' },
            { id: 'earnings', label: 'Earnings' },
            { id: 'listing', label: 'Profile & listing' },
            { id: 'report', label: 'Report a problem' },
        ] : []),
    ];

    return (
        <Shell
            eyebrow="VIBED"
            brand="Talent"
            items={items}
            active={view}
            onSelect={setView}
            footer={
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <span aria-hidden="true" style={{ width: 38, height: 38, borderRadius: 999, background: '#D9C2F7', display: 'grid', placeItems: 'center', color: 'var(--mk-ink)' }}>{talent.initials}</span>
                    <span><b style={{ color: 'var(--mk-ink)', fontWeight: 500, display: 'block' }}>{talent.name}</b><span style={{ color: 'var(--mk-purple)' }}>{talent.plan} · {talent.rate}% rate</span></span>
                    {onExit && <button type="button" className="mk-back" style={{ marginLeft: 'auto', marginBottom: 0 }} onClick={onExit}>Projects</button>}
                </div>
            }
        >
            {view === 'listings' && <TalentListings />}
            {view === 'setup' && <SetupLink />}
            {!SHOW_SEED_VIEWS && view === 'listings' && (
                <p className="mk-note" style={{ marginTop: 28 }}>Requests, bookings, earnings and reports open with payments.</p>
            )}
            {SHOW_SEED_VIEWS && view === 'work' && <MyWork go={setView} />}
            {view === 'briefs' && <Briefs full />}
            {view === 'request' && <JobRequest go={setView} />}
            {view === 'onset' && <OnSet />}
            {view === 'earnings' && <Earnings />}
            {view === 'listing' && <Listing />}
            {view === 'report' && <ReportProblem side="talent" onBack={() => setView('work')} />}
        </Shell>
    );
}

/* ── 12 · My work ─────────────────────────────────────────────────────── */

function MyWork({ go }) {
    const t = useMarketOpsStore((s) => s.talent);
    const first = t.name.split(' ')[0];
    return (
        <>
            <PageHead
                kicker="12 · Supply side"
                kickerTone="purple"
                title={`Good morning, ${first}`}
                lede="Two seats running, one cut due Friday, and a brief that fits you better than anything this month."
                right={<Btn onClick={() => go('listing')}>Set availability</Btn>}
            />
            <div className="mk-grid mk-cols-4" style={{ marginBottom: 22 }}>
                <Stat label="Earned in November" mono value={eur(t.kpis.earnedMonth, { decimals: 0 })} sub={`after the ${t.rate}% rate`} />
                <Stat label="In escrow for you" mono tone="teal" value={eur(t.kpis.inEscrow, { decimals: 0 })} sub={`${t.kpis.seatsFunded} seats funded`} />
                <Stat label="Approved first pass" mono value={`${t.kpis.firstPass}%`} sub={`${t.kpis.seatsDelivered} seats delivered`} />
                <Stat label="On time" mono value={`${t.kpis.onTime}%`} sub={t.kpis.lateNote} />
            </div>
            <div className="mk-grid mk-aside">
                <div className="mk-stack">
                    <Card>
                        <CardHead title="Running now" right={<button type="button" className="mk-back" style={{ margin: 0, color: 'var(--mk-teal)' }} onClick={() => go('onset')}>All deliveries</button>} />
                        {t.running.map((r, i) => (
                            <div key={r.id} style={{ display: 'flex', gap: 18, alignItems: 'center', padding: '16px 0', borderTop: i ? '1px solid var(--mk-line)' : 'none', flexWrap: 'wrap' }}>
                                <span className="mk-thumb" style={{ width: 62, height: 62 }} aria-hidden="true" />
                                <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                                    <div style={{ fontSize: 17 }}>{r.title}</div>
                                    <div className="mk-muted" style={{ fontSize: 14 }}>{r.sub}</div>
                                    <div className="mk-btn-row" style={{ gap: 8, marginTop: 8 }}>{r.tags.map(([label, tone]) => <Pill key={label} tone={tone === 'grey' ? undefined : tone}>{label}</Pill>)}</div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <div className="mk-mono" style={{ fontSize: 18 }}>{eur(r.amount)}</div>
                                    {r.held && <div className="mk-teal" style={{ fontSize: 13 }}>held for you</div>}
                                    {r.cta && <Btn tone="purple" size="small" style={{ marginTop: 8 }} onClick={() => go('onset')}>{r.cta}</Btn>}
                                </div>
                            </div>
                        ))}
                    </Card>
                    <Briefs />
                </div>
                <div className="mk-stack">
                    <PayoutCard />
                    <EliteCard />
                    <Card>
                        <CardHead title="Your rules" />
                        {t.rules.map(([l, v]) => <Row key={l} label={l} value={v} />)}
                        <p className="mk-note">Briefs under your floor never reach you, and declining them never counts against your acceptance rate.</p>
                    </Card>
                </div>
            </div>
        </>
    );
}

function PayoutCard() {
    const p = useMarketOpsStore((s) => s.talent.payout);
    const rate = useMarketOpsStore((s) => s.talent.rate);
    return (
        <Card>
            <CardHead title="Next payout" />
            <div className="mk-mono" style={{ fontSize: 40 }}>{eur(p.next)}</div>
            <div className="mk-muted" style={{ marginBottom: 12 }}>{p.date} · {p.speed}</div>
            <Row label="Gross this month" value={eur(p.gross, { decimals: 0 })} />
            <Row label={`Platform ${rate}%`} value={`-${eur(-p.platform, { decimals: 0 })}`} />
            <Row label="Repeat-client discount" value={`+${eur(p.repeatDiscount, { decimals: 0 })}`} valueClass="mk-green" />
            <Btn block style={{ marginTop: 16 }}>Invoices & VAT</Btn>
        </Card>
    );
}

function EliteCard() {
    const elite = useMarketOpsStore((s) => s.talent.elite);
    return (
        <Card tone="green">
            <CardHead title="Toward Elite" tone="green" />
            {elite.map((e) => (
                <div key={e.label}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{e.label}</span><span className={cx('mk-mono', e.amber ? 'mk-amber' : 'mk-green')}>{e.value}</span></div>
                    <div className={cx('mk-bar', e.amber && 'is-amber')}><i style={{ width: `${Math.round(e.pct * 100)}%` }} /></div>
                </div>
            ))}
            <p className="mk-note" style={{ marginTop: 4 }}>Elite drops your rate to 9% and puts you in front of invite-only briefs.</p>
            <Btn block style={{ marginTop: 14 }}>Take the food &amp; drink test</Btn>
        </Card>
    );
}

function Briefs({ full }) {
    const briefs = useMarketOpsStore((s) => s.talent.briefs);
    const applyToBrief = useMarketOpsStore((s) => s.applyToBrief);
    const { report, toastNode } = useToast();
    const [showHidden, setShowHidden] = useState(false);
    const [reading, setReading] = useState(null);
    const body = (
        <Card>
            {toastNode}
            <CardHead title="Briefs matched to your verified work" tone="purple" right={<Btn size="small">Filter</Btn>} />
            {briefs.map((b, i) => {
                const hidden = b.hiddenByRules && !showHidden;
                return (
                    <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', padding: '16px 0', borderTop: i ? '1px solid var(--mk-line)' : 'none', flexWrap: 'wrap' }}>
                        <div style={{ flex: '1 1 320px', minWidth: 0, opacity: b.hiddenByRules ? 0.85 : 1 }}>
                            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 17 }}>
                                <span className={b.hiddenByRules ? 'mk-muted' : ''}>{b.title}</span>
                                {b.match && <Pill tone={b.match >= 90 ? 'purple' : undefined}>{b.match} match</Pill>}
                                {b.buyout && <Pill tone="amber">Buyout only</Pill>}
                            </div>
                            <div className="mk-muted" style={{ fontSize: 14 }}>{b.terms}{b.hiddenByRules && ' Hidden by your rules.'}</div>
                            {reading === b.id && <p className="mk-callout" style={{ marginTop: 10 }}>Full brief: deliverables, usage rights and the shipping date, exactly as the buyer wrote them. Applying sends your rate and your two closest verified pieces.</p>}
                        </div>
                        {hidden ? (
                            <Btn onClick={() => setShowHidden(true)}>Show anyway</Btn>
                        ) : (
                            <div className="mk-btn-row">
                                <Btn tone="purple" disabled={b.applied} onClick={() => report(applyToBrief(b.id), 'Applied. The buyer sees your rate and your two closest pieces.')}>{b.applied ? 'Applied' : 'Apply'}</Btn>
                                <Btn onClick={() => setReading(reading === b.id ? null : b.id)}>{reading === b.id ? 'Close' : 'Read'}</Btn>
                            </div>
                        )}
                    </div>
                );
            })}
        </Card>
    );
    return full ? <><PageHead kicker="Supply side · Open briefs" kickerTone="purple" title="Briefs that fit your work" />{body}</> : body;
}

/* ── 17 · New request ─────────────────────────────────────────────────── */

function JobRequest({ go }) {
    const r = useMarketOpsStore((s) => s.jobRequest);
    const respond = useMarketOpsStore((s) => s.respondToRequest);
    const { report, toastNode } = useToast();
    return (
        <div className="mk-phone">
            {toastNode}
            <div className="mk-kicker">New request · expires in {r.expiresInHours} h</div>
            <h1 className="mk-title" style={{ fontSize: 40 }}>{r.title}</h1>
            <p className="mk-lede" style={{ marginBottom: 22 }}>{r.when} · {r.where}</p>
            <div className="mk-stack" style={{ gap: 16 }}>
                <Card tone="teal">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="mk-mono" style={{ fontSize: 40 }}>{eur(r.take)}</span>
                        <Pill tone="green">Funded</Pill>
                    </div>
                    <p className="mk-note">{r.rateNote}</p>
                </Card>
                <Card>{r.facts.map(([l, v]) => <Row key={l} label={l} value={v} />)}</Card>
                <Card><Eyebrow>What they wrote</Eyebrow><p style={{ margin: '10px 0 0' }}>“{r.note}”</p></Card>
                {r.status === 'open' && <div className="mk-callout is-amber" style={{ marginTop: 0 }}>{r.conflict}</div>}
                {r.status === 'open' ? (
                    <div className="mk-stack" style={{ gap: 10 }}>
                        <Btn tone="primary" block onClick={() => report(respond('accept'), 'Accepted. The day is blocked and the other hold is cleared.')}>Accept · block the day</Btn>
                        <Btn block tone="quiet" onClick={() => report(respond('decline'), 'Declined. It does not count against your acceptance rate.')}>Decline</Btn>
                    </div>
                ) : (
                    <Card tone={r.status === 'accepted' ? 'green' : undefined}>
                        <p style={{ margin: 0 }}>{r.status === 'accepted' ? 'Accepted. The call sheet arrives the evening before.' : 'Declined. The buyer is shown the next match.'}</p>
                        {r.status === 'accepted' && <Btn style={{ marginTop: 14 }} onClick={() => go('onset')}>Open the shoot day</Btn>}
                    </Card>
                )}
            </div>
        </div>
    );
}

/* ── 18 · On set ──────────────────────────────────────────────────────── */

function OnSet() {
    const o = useMarketOpsStore((s) => s.onSet);
    const toggleShot = useMarketOpsStore((s) => s.toggleShot);
    const done = o.shots.filter((x) => x.done).length;
    const visible = o.shots.slice(0, 5);
    const pct = Math.round((o.upload.done / o.upload.total) * 100);
    return (
        <div className="mk-phone">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="mk-kicker" style={{ color: 'var(--mk-green)' }}>Checked in · {o.checkedIn}</div>
                <Pill tone="teal">{eur(o.held)} held</Pill>
            </div>
            <h1 className="mk-title" style={{ fontSize: 40 }}>{o.title}</h1>
            <p className="mk-lede" style={{ marginBottom: 22 }}>{o.venue} · wrap {o.wrap}</p>
            <div className="mk-stack" style={{ gap: 16 }}>
                <Card>
                    <CardHead title="Shot list" right={<span className="mk-mono mk-teal">{done} / {o.shots.length}</span>} />
                    {visible.map((shot) => (
                        <button key={shot.id} type="button" className={cx('mk-check', shot.done && 'is-done')} aria-pressed={shot.done} onClick={() => toggleShot(shot.id)}>
                            <span className="mk-check-box" aria-hidden="true">{shot.done && <Check size={16} />}</span>
                            <span className="mk-check-text" style={{ flex: 1 }}>{shot.text}</span>
                            {shot.now && !shot.done && <span className="mk-mono mk-teal" style={{ fontSize: 12 }}>NOW</span>}
                        </button>
                    ))}
                    {o.shots.length > visible.length && <p className="mk-note">{o.shots.length - visible.length} more already done earlier in the day.</p>}
                </Card>
                <Card>
                    <CardHead title="Rushes uploading" tone="teal" right={<span className="mk-mono">{o.upload.done} of {o.upload.total}</span>} />
                    <div className="mk-bar is-teal" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }} className="mk-muted"><span>Wi-Fi · {o.upload.gb} GB done</span><span className="mk-mono">{o.upload.eta}</span></div>
                    <p className="mk-note">The project opens for the buyer as files land. They can start watching before you have packed the stands.</p>
                </Card>
                <Card>
                    <CardHead title="If the day grows" />
                    <p style={{ margin: 0 }}>Send a priced card instead of agreeing out loud. They tap once, you keep shooting, and the extra is in escrow before you start it.</p>
                    <Btn style={{ marginTop: 14 }}>Send a priced card</Btn>
                </Card>
            </div>
        </div>
    );
}

/* ── 19 · Earnings ────────────────────────────────────────────────────── */

function Earnings() {
    const t = useMarketOpsStore((s) => s.talent);
    const max = Math.max(...t.monthly.map((m) => m.v));
    return (
        <>
            <PageHead kicker="Supply side · Earnings" kickerTone="purple" title="Earnings" right={<Pill tone="purple">{t.plan} · {t.rate}%</Pill>} />
            <div className="mk-grid mk-cols-2" style={{ alignItems: 'start' }}>
                <div className="mk-stack">
                    <Card>
                        <Eyebrow>Next payout · Friday</Eyebrow>
                        <div className="mk-mono" style={{ fontSize: 52, marginTop: 8 }}>{eur(t.payout.next)}</div>
                        <div className="mk-bars" role="img" aria-label={`Monthly earnings, ${t.monthly.map((m) => `${m.m} ${m.v}`).join(', ')}`}>
                            {t.monthly.map((m, i) => <i key={m.m} className={i === t.monthly.length - 1 ? 'is-now' : ''} style={{ height: `${Math.round((m.v / max) * 100)}%` }} />)}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }} className="mk-mono mk-muted">
                            <span>{t.monthly[0].m}</span><span>{t.monthly[t.monthly.length - 1].m} · {eur(t.kpis.earnedMonth, { decimals: 0 })}</span>
                        </div>
                    </Card>
                    <Card>
                        <CardHead title="Held for you" />
                        {t.running.map((r) => (
                            <div key={r.id} className="mk-row">
                                <span><span style={{ display: 'block' }}>{r.title.replace(' of 3', '')}</span><span className={r.held ? 'mk-amber' : 'mk-muted'} style={{ fontSize: 14 }}>{r.held ? 'their review · auto 16 Nov' : 'cut due Friday'}</span></span>
                                <span className="mk-mono mk-teal">{eur(r.amount)}</span>
                            </div>
                        ))}
                    </Card>
                </div>
                <div className="mk-stack">
                    <Card tone="green">
                        <CardHead title="Toward Elite · 9%" tone="green" right={<span className="mk-mono mk-green">2 of 3</span>} />
                        <div className="mk-bar"><i style={{ width: '67%' }} /></div>
                        <p style={{ margin: 0 }}>One more certification. The food &amp; drink test takes 48 h and is free the first time.</p>
                        <Btn block style={{ marginTop: 16 }}>Start the test</Btn>
                    </Card>
                    <Card>
                        <CardHead title="Paperwork" />
                        {t.paperwork.map(([l, v]) => <Row key={l} label={l} value={v} />)}
                    </Card>
                </div>
            </div>
        </>
    );
}

/* ── 21 · Listing intake ──────────────────────────────────────────────── */

const SHOOTS = ['Interviews', 'Founder & corporate', 'Events', 'Podcasts', 'Product', 'UGC'];
const REACH = ['My arrondissement', 'Paris + 40 km', 'Anywhere in France', 'Half-day minimum'];

function Listing() {
    const l = useMarketOpsStore((s) => s.listing);
    const removeTag = useMarketOpsStore((s) => s.removeListingTag);
    const publish = useMarketOpsStore((s) => s.publishListing);
    const setFlag = useMarketOpsStore((s) => s.setListingFlag);
    const { report, toastNode } = useToast();
    const [shoots, setShoots] = useState(['Interviews', 'Founder & corporate', 'Podcasts']);
    const [reach, setReach] = useState(['Paris + 40 km', 'Half-day minimum']);
    const [rate, setRate] = useState(480);
    const toggle = (list, setList, v) => setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
    const tags = l.tags.filter((t) => !l.removedTags.includes(t));
    const ready = 6 + (l.payoutsConnected ? 1 : 0) + (l.leadItem ? 1 : 0);

    const chipBtn = (label, on, onClick) => (
        <button key={label} type="button" aria-pressed={on} onClick={onClick} className={cx('mk-pill', on && 'is-teal')} style={{ cursor: 'pointer', fontSize: 15, padding: '8px 16px' }}>{label}</button>
    );

    return (
        <>
            {toastNode}
            <PageHead
                split
                kicker="21 · Before the listing"
                title="The listing writes itself from the work"
                lede="The intake reads what you have already made in the editor, proposes the listing, and asks only what the files cannot tell it."
                right={<div className="mk-btn-row"><Btn>Fill it in by hand</Btn><Btn tone="primary" onClick={() => report(publish(), 'Your listing is live.')} disabled={l.published}>{l.published ? 'Listing live' : 'Publish listing'}</Btn></div>}
            />
            <div className="mk-grid mk-aside">
                <Card>
                    <div className="mk-stack" style={{ gap: 18 }}>
                        <div className="mk-callout" style={{ marginTop: 0 }}>
                            <Eyebrow>Question 1 · the only one about identity</Eyebrow>
                            <p style={{ margin: '8px 0 12px', color: 'var(--mk-ink)' }}>What do you shoot, and who normally pays you for it?</p>
                            <div className="mk-btn-row" style={{ gap: 8 }}>{SHOOTS.map((x) => chipBtn(x, shoots.includes(x), () => toggle(shoots, setShoots, x)))}</div>
                        </div>
                        <div className="mk-callout" style={{ marginTop: 0, background: 'var(--mk-teal-soft)' }}>
                            <Eyebrow tone="teal">Read from your 14 exports · no upload needed</Eyebrow>
                            <p style={{ margin: '8px 0 12px', color: 'var(--mk-ink)' }}>Here is what the work says about you. Correct anything that is wrong: these become the tags buyers actually search.</p>
                            <div className="mk-btn-row" style={{ gap: 8 }}>
                                {tags.map((t) => (
                                    <span key={t} className="mk-pill is-teal" style={{ gap: 6 }}>{t}
                                        <button type="button" aria-label={`Remove ${t}`} onClick={() => report(removeTag(t), `Removed “${t}”.`)} style={{ all: 'unset', cursor: 'pointer', paddingLeft: 4 }}>×</button>
                                    </span>
                                ))}
                            </div>
                        </div>
                        <div className="mk-callout" style={{ marginTop: 0 }}>
                            <Eyebrow>Question 2 · changes who can reach you</Eyebrow>
                            <p style={{ margin: '8px 0 12px', color: 'var(--mk-ink)' }}>How far will you travel, and what is the smallest job worth leaving the house for?</p>
                            <div className="mk-btn-row" style={{ gap: 8 }}>{REACH.map((x) => chipBtn(x, reach.includes(x), () => toggle(reach, setReach, x)))}</div>
                        </div>
                        <div className="mk-callout" style={{ marginTop: 0 }}>
                            <Eyebrow tone="amber">Question 3 · you decide, not us</Eyebrow>
                            <p style={{ margin: '8px 0 12px', color: 'var(--mk-ink)' }}>What is a half-day worth to you? Half-days in your area are listed between €320 and €620. The number is yours: the platform never sets it and never auto-adjusts it.</p>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                                <Chip tone="plain">€320</Chip>
                                <label className="mk-sr" htmlFor="mk-rate">Half-day rate</label>
                                <input id="mk-rate" type="range" min={320} max={620} step={10} value={rate} onChange={(e) => setRate(Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--mk-teal)' }} />
                                <Chip tone="plain">€620</Chip>
                                <span className="mk-mono mk-teal" style={{ fontSize: 18 }}>€{rate}</span>
                            </div>
                        </div>
                        {!l.published && (
                            <div className="mk-callout is-amber" style={{ marginTop: 0 }}>
                                <Eyebrow tone="amber">{2 - (l.payoutsConnected ? 1 : 0) - (l.leadItem ? 1 : 0)} things still block you</Eyebrow>
                                <p style={{ margin: '8px 0 12px', color: 'var(--mk-ink)' }}>A payout account, and one portfolio item you are happy to lead with. Everything else on your listing is already drafted and editable.</p>
                                <div className="mk-btn-row">
                                    <Btn tone="primary" disabled={l.payoutsConnected} onClick={() => report(setFlag('payoutsConnected'), 'Payout account connected.')}>{l.payoutsConnected ? 'Payouts connected' : 'Connect payouts'}</Btn>
                                    <Btn disabled={l.leadItem} onClick={() => report(setFlag('leadItem'), 'Lead item chosen.')}>{l.leadItem ? 'Lead item chosen' : 'Pick the lead item'}</Btn>
                                </div>
                            </div>
                        )}
                    </div>
                </Card>
                <div className="mk-stack">
                    <Card>
                        <CardHead title="Your listing, drafted" right={<Pill tone={l.published ? 'green' : 'amber'}>{l.published ? 'Live' : 'Not live yet'}</Pill>} />
                        {l.rows.map(([label, value, src]) => (
                            <div key={label} className="mk-row">
                                <span className="mk-row-label">{label}</span>
                                <span style={{ display: 'flex', gap: 10, alignItems: 'center', textAlign: 'right' }}>
                                    <span>{label === 'Rate' ? `€${rate} half-day` : value}</span>
                                    <Chip tone={src === 'DRAFTED' ? 'purple' : src === 'EXPORTS' ? 'teal' : 'plain'}>{src}</Chip>
                                </span>
                            </div>
                        ))}
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}><span>Ready to publish</span><span className="mk-mono mk-amber">{ready} of 8</span></div>
                        <div className="mk-bar is-amber"><i style={{ width: `${(ready / 8) * 100}%` }} /></div>
                    </Card>
                    <Card tone="teal">
                        <CardHead title="What this unlocks for you" tone="teal" />
                        <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}><span className="mk-mono" style={{ fontSize: 34 }}>14</span><span className="mk-muted">searches last week you now match</span></div>
                        {l.searches.map(([q, n]) => <Row key={q} label={q} value={n} />)}
                        <p className="mk-note">Adding the vertical certification would have put you in 9 more. That is the honest reason to take a test, not a badge for its own sake.</p>
                    </Card>
                </div>
            </div>
        </>
    );
}
