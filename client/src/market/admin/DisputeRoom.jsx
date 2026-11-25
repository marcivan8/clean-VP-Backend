/**
 * Screen 28 — a dispute, assembled automatically, decided with a written reason (R100).
 */
import React, { useState } from 'react';
import useMarketOpsStore from '../../store/useMarketOpsStore.js';
import { SPLIT_OPTIONS, splitDispute, eur } from '../opsMath.js';
import { Btn, Card, CardHead, Chip, Eyebrow, Pill, Row } from '../ui.jsx';
import { useToast } from '../useToast.jsx';
import { cx } from '../uiUtils.js';

const HOUSE_RULES = [
    'Decide within 72 h of the settlement window closing.',
    'Write a reason in plain language, always, even when one side is plainly right.',
    'A split is allowed and expected. Most real cases are not 0 or 100.',
    'Never decide a case involving someone you have worked with. Reassign instead.',
];

export default function DisputeRoom({ disputeId, onBack }) {
    const d = useMarketOpsStore((s) => s.disputes.find((x) => x.id === disputeId));
    const decideDispute = useMarketOpsStore((s) => s.decideDispute);
    const askDisputeQuestion = useMarketOpsStore((s) => s.askDisputeQuestion);
    const { report, toastNode } = useToast();

    const [pct, setPct] = useState(0.7);
    const [reason, setReason] = useState(d?.draftReason || '');
    const [asking, setAsking] = useState(false);
    const [question, setQuestion] = useState('');

    if (!d) {
        return <div><button type="button" className="mk-back" onClick={onBack}>← Trust desk</button><p className="mk-empty">This dispute no longer exists.</p></div>;
    }

    const decided = d.status !== 'open';
    const split = decided ? d.decision : splitDispute({ buyerPaid: d.buyerPaid, talentPayout: d.talentPayout, talentPct: pct });
    const talentFirst = d.talentName.split(' ')[0];
    const remaining = d.targetHours - d.waitedHours;

    return (
        <div>
            {toastNode}
            <header className="mk-head mk-head-split">
                <div>
                    <button type="button" className="mk-back" onClick={onBack}>← Trust desk</button>
                    <div className="mk-kicker is-red">28 · Dispute · {d.id.toUpperCase()}</div>
                    <h1 className="mk-title">“{d.title}”</h1>
                    <p className="mk-lede">Raised by the {d.raisedBy} {d.raisedDaysAgo} day{d.raisedDaysAgo > 1 ? 's' : ''} ago · {d.project} · {d.talentName} · {d.venue}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                    <Pill tone={decided ? 'green' : 'red'}>{decided ? 'Decided' : `${eur(d.frozen)} frozen`}</Pill>
                    {!decided && (
                        <div className="mk-mono mk-red" style={{ marginTop: 14, letterSpacing: '.12em', fontSize: 14 }}>
                            {d.waitedHours} H OF {d.targetHours} · {remaining < 24 ? 'DECIDE TODAY' : `${remaining} H LEFT`}
                        </div>
                    )}
                </div>
            </header>

            <div className="mk-grid mk-aside">
                <div className="mk-stack">
                    <Card>
                        <CardHead title="Assembled automatically · nobody chose what to include" right={<Pill>{d.eventCount} events</Pill>} />
                        <ul className="mk-tl">
                            {d.timeline.map((e, i) => (
                                <li key={i}>
                                    <span className="mk-tl-date">{e.date.toUpperCase()}</span>
                                    <span className={cx('mk-dot', e.tone !== 'grey' && `is-${e.tone}`)} aria-hidden="true" />
                                    <span>{e.text}<span className="mk-tl-by">{e.by}</span></span>
                                </li>
                            ))}
                        </ul>
                    </Card>

                    <div className="mk-grid mk-cols-2">
                        <SideCard who={d.buyer} tone="teal" avatar="#D9C2F7" />
                        <SideCard who={d.talent} tone="purple" avatar="#B5ECF5" />
                    </div>

                    <Card>
                        <CardHead title="What the brief actually said" />
                        <p style={{ margin: '0 0 10px' }}><b className="mk-strong">Agreed:</b> <span className="mk-muted">{d.brief.agreed}</span></p>
                        <p style={{ margin: '0 0 10px' }}><b className="mk-strong">Not agreed anywhere:</b> <span className="mk-muted">{d.brief.notAgreed}</span></p>
                        <p style={{ margin: 0 }}><span className="mk-amber">Relevant:</span> <span className="mk-muted">{d.brief.relevant}</span></p>
                        <p className="mk-note">Only the brief and accepted quote cards can ground a claim, from either side. Anything agreed by voice on the day is not evidence, which is exactly why scope changes are cards in the thread.</p>
                    </Card>
                </div>

                <div className="mk-stack">
                    <Card>
                        <CardHead title={decided ? 'Decided' : 'Decide'} tone="red" />
                        <p style={{ margin: '0 0 12px' }}>Split the {eur(d.buyerPaid)}</p>
                        {!decided && (
                            <div className="mk-seg" role="radiogroup" aria-label={`Share for ${talentFirst}`}>
                                {SPLIT_OPTIONS.map((o) => (
                                    <button key={o} type="button" role="radio" aria-checked={pct === o} className={cx(pct === o && 'is-on')} onClick={() => setPct(o)}>
                                        {o === 0 ? 'Talent 0%' : `${Math.round(o * 100)}%`}
                                    </button>
                                ))}
                            </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18 }}>
                            <div><div className="mk-muted">To {talentFirst}</div><div className="mk-mono mk-green" style={{ fontSize: 26 }}>{eur(split.toTalent)}</div></div>
                            <div style={{ textAlign: 'right' }}><div className="mk-muted">Refunded</div><div className="mk-mono" style={{ fontSize: 26 }}>{eur(split.refunded)}</div></div>
                        </div>
                        <p className="mk-note" style={{ marginTop: 10 }}>VIBED's fee is waived on a split decision. The platform does not earn more from a job that went wrong.</p>

                        <div style={{ borderTop: '1px solid var(--mk-line)', margin: '20px 0 0', paddingTop: 20 }}>
                            <label className="mk-eyebrow" htmlFor="mk-reason" style={{ display: 'block', marginBottom: 12 }}>Reason · both sides read this</label>
                            {decided
                                ? <p className="mk-callout" style={{ marginTop: 0 }}>{d.decision.reason}</p>
                                : <textarea id="mk-reason" className="mk-textarea" style={{ minHeight: 140 }} value={reason} onChange={(e) => setReason(e.target.value)} />}
                        </div>

                        {!decided && (
                            <div style={{ display: 'grid', gap: 12, marginTop: 18 }}>
                                <Btn tone="primary" block onClick={() => report(decideDispute(d.id, pct, reason), `Decided. ${eur(split.toTalent)} to ${talentFirst}, ${eur(split.refunded)} refunded.`)}>
                                    Decide and move the money
                                </Btn>
                                {!asking ? (
                                    <Btn block onClick={() => setAsking(true)}>Ask one question first</Btn>
                                ) : (
                                    <div>
                                        <label className="mk-sr" htmlFor="mk-q">Question for both sides</label>
                                        <input id="mk-q" className="mk-input" placeholder="One question, to both sides" value={question} onChange={(e) => setQuestion(e.target.value)} />
                                        <div className="mk-btn-row" style={{ marginTop: 10 }}>
                                            <Btn size="small" onClick={() => { const r = report(askDisputeQuestion(d.id, question), 'Question sent to both sides. The clock keeps running.'); if (r.ok) { setAsking(false); setQuestion(''); } }}>Send the question</Btn>
                                            <Btn size="small" tone="quiet" onClick={() => setAsking(false)}>Cancel</Btn>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                        {(d.questions || []).map((q, i) => <p key={i} className="mk-note">Asked: “{q}”</p>)}
                        <p className="mk-note">One appeal each, to a different person, within 7 days. The decision and its reason go into both profiles' private history, never into public reviews.</p>
                    </Card>

                    <Card>
                        <CardHead title="Consequences of this decision" />
                        <Row label="Reviews" value="Unblocked, both publish" valueClass="mk-strong" />
                        <Row label={`${talentFirst}'s dispute rate`} value={d.consequences.disputeRate} />
                        <Row label="Elite eligibility" value={d.consequences.elite} valueClass={d.consequences.elite.startsWith('at risk') ? 'mk-amber' : ''} />
                        <Row label="Files" value="Released to buyer" />
                        <Row label="Licence" value="Issues at the split" />
                        <p className="mk-note">A split still hands over the work. Refusing the files after taking money off would leave the buyer paying for nothing, and the talent's rushes in limbo.</p>
                    </Card>

                    <Card>
                        <CardHead title="House rules this case runs on" />
                        {HOUSE_RULES.map((r) => <p key={r} style={{ margin: '0 0 14px' }}>{r}</p>)}
                    </Card>
                </div>
            </div>
        </div>
    );
}

function SideCard({ who, tone, avatar }) {
    return (
        <Card tone={tone}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14 }}>
                <span aria-hidden="true" style={{ width: 40, height: 40, borderRadius: 999, background: avatar, display: 'grid', placeItems: 'center', fontSize: 14 }}>{who.initials}</span>
                <span><span className="mk-h3" style={{ display: 'block' }}>{who.name}</span><span className="mk-muted" style={{ fontSize: 14 }}>{who.stats}</span></span>
            </div>
            <p style={{ margin: 0, color: 'var(--mk-ink-2)', lineHeight: 1.65 }}>“{who.quote}”</p>
            {who.files.length > 0 && (
                <>
                    <Eyebrow as="div"><span style={{ display: 'block', marginTop: 22 }}>Attached</span></Eyebrow>
                    {who.files.map((f) => (
                        <div key={f.name} className="mk-row">
                            <span style={{ display: 'flex', gap: 14, alignItems: 'center', minWidth: 0 }}>
                                <span className="mk-thumb" style={{ width: 62, height: 44, flex: '0 0 auto' }} aria-hidden="true" />
                                <span style={{ minWidth: 0 }}>{f.name}</span>
                            </span>
                            <Chip tone="plain">{f.meta}</Chip>
                        </div>
                    ))}
                </>
            )}
        </Card>
    );
}
