/**
 * client/src/market/ReportProblem.jsx — screen 29, "Report it, see what happens next".
 * Shared by the buyer and talent interfaces (R100). Both sides get the same
 * screen and the same clock; a host also gets the damage claim.
 */
import React, { useState } from 'react';
import { ArrowUp } from 'lucide-react';
import useMarketOpsStore from '../store/useMarketOpsStore.js';
import { REPORT_REASONS, capDamageClaim, eur } from './opsMath.js';
import { Btn, Card, CardHead, Eyebrow, PageHead, Pill } from './ui.jsx';
import { useToast } from './useToast.jsx';
import { cx } from './uiUtils.js';

const SIDE_LABEL = { buyer: 'Buyer', talent: 'Talent' };

export default function ReportProblem({ side, onBack, onOpenThread }) {
    const reportable = useMarketOpsStore((s) => s.reportable);
    const reports = useMarketOpsStore((s) => s.reports);
    const reportProblem = useMarketOpsStore((s) => s.reportProblem);
    const withdrawReport = useMarketOpsStore((s) => s.withdrawReport);
    const { report, toastNode } = useToast();

    const target = reportable[side];
    const [reasonId, setReasonId] = useState('not_as_agreed');
    const [words, setWords] = useState(target?.defaultWords || '');
    const openReport = reports.find((r) => r.bookingId === target?.bookingId && r.status === 'open');
    const reason = REPORT_REASONS.find((r) => r.id === reasonId);

    if (!target) return null;

    const send = () => report(
        reportProblem({ side, reasonId, words }),
        reason.freezes ? `Reported. ${eur(target.amount)} is frozen and both reviews are paused.` : 'Sent to moderation, confidentially.',
    );

    return (
        <div>
            {toastNode}
            <PageHead
                split
                back={onBack && <button type="button" className="mk-back" onClick={onBack}>← Back</button>}
                kicker="29 · When something goes wrong"
                kickerTone="red"
                title="Report it, see what happens next"
                lede="Both sides get the same screen and the same clock. Reporting a problem is never a dead end: it names what it freezes, what it needs from you, and when a human will answer."
                right={<Pill tone="red">Freezes the release immediately</Pill>}
            />

            <div className="mk-grid mk-cols-2" style={{ alignItems: 'start' }}>
                <Card>
                    <CardHead
                        title={`${SIDE_LABEL[side]} · report a problem`}
                        right={<Pill>{target.bookingId} · {eur(target.amount)} held</Pill>}
                    />

                    {openReport ? (
                        <div>
                            <p className="mk-h3">Reported. The clock is running.</p>
                            <p className="mk-note">
                                {openReport.freezes
                                    ? <>{eur(openReport.amount)} is frozen for both of you and both reviews are paused. The other side has 48 h to answer or settle in the thread.</>
                                    : <>This went to moderation, not to the money. Nothing is frozen.</>}
                            </p>
                            <div className="mk-btn-row" style={{ marginTop: 22 }}>
                                <Btn onClick={() => report(withdrawReport(openReport.id), 'Withdrawn. The money unfreezes and the clock stops.')}>Withdraw the report</Btn>
                                {onOpenThread && <Btn tone="quiet" onClick={onOpenThread}>Open the thread</Btn>}
                            </div>
                        </div>
                    ) : (
                        <>
                            <p className="mk-muted" style={{ margin: '0 0 14px' }} id="mk-what-wrong">What went wrong?</p>
                            <div role="radiogroup" aria-labelledby="mk-what-wrong">
                                {REPORT_REASONS.map((r) => (
                                    <button
                                        key={r.id}
                                        type="button"
                                        role="radio"
                                        aria-checked={reasonId === r.id}
                                        className={cx('mk-option', reasonId === r.id && 'is-on')}
                                        onClick={() => setReasonId(r.id)}
                                    >
                                        <span className="mk-radio" aria-hidden="true" />
                                        <span>
                                            <span style={{ display: 'block' }}>{r.label}</span>
                                            <span className="mk-option-hint">{r.hint}</span>
                                        </span>
                                    </button>
                                ))}
                            </div>

                            <label className="mk-label" htmlFor="mk-words"><Eyebrow as="span">In your own words</Eyebrow></label>
                            <textarea id="mk-words" className="mk-textarea" value={words} onChange={(e) => setWords(e.target.value)} />

                            <div className="mk-label"><Eyebrow as="span">Proof</Eyebrow></div>
                            <div className="mk-thumbs">
                                <div className="mk-thumb" aria-label="Attached file" />
                                <div className="mk-thumb" aria-label="Attached file" />
                                <button type="button" className="mk-thumb is-drop" aria-label="Add a file"><ArrowUp size={18} /></button>
                                <span className="mk-muted" style={{ fontSize: 14, maxWidth: 190 }}>Files already in the room are attached for you</span>
                            </div>

                            {reason.freezes ? (
                                <div className="mk-callout is-amber">
                                    <b>Before you send.</b> This freezes {eur(target.amount)} for both of you and pauses both reviews. Most cases like this settle in the thread within a day. {target.counterparty === 'Nour' ? 'Nour has' : 'The other side has'} 48 h to answer before it reaches a human.
                                </div>
                            ) : (
                                <div className="mk-callout">
                                    <b>This one does not touch the money.</b> Behaviour reports go to moderation, are read by a person, and stay confidential.
                                </div>
                            )}

                            <div className="mk-btn-row" style={{ marginTop: 20 }}>
                                <Btn tone="danger" onClick={send}>{reason.freezes ? 'Report and freeze' : 'Send to moderation'}</Btn>
                                {onOpenThread && <Btn onClick={onOpenThread}>Try the thread first</Btn>}
                            </div>
                        </>
                    )}
                </Card>

                <div className="mk-stack">
                    {side === 'talent' && <HostDamage report={report} />}
                    <AfterYouReport reported={!!openReport} />
                </div>
            </div>
        </div>
    );
}

function HostDamage({ report }) {
    const host = useMarketOpsStore((s) => s.reportable.host);
    const claimDeposit = useMarketOpsStore((s) => s.claimDeposit);
    const releaseDeposit = useMarketOpsStore((s) => s.releaseDeposit);
    const [cost, setCost] = useState('180');
    const cap = capDamageClaim(cost, host.deposit);

    return (
        <Card>
            <CardHead title="Host · report damage" tone="purple" right={<Pill tone="amber">{host.hoursLeft} h left to report</Pill>} />
            <p style={{ margin: 0 }}>
                The deposit holds <span className="mk-mono">{eur(host.deposit, { decimals: 0 })}</span> and releases automatically 24 h after wrap. A report before then opens a dispute; after then the deposit is gone and this becomes an ordinary claim between you and your insurer.
            </p>

            {host.resolved ? (
                <div className="mk-callout" style={{ marginTop: 20 }}>
                    {host.resolved === 'claimed'
                        ? <><b>Claim sent: {eur(host.claimed, { decimals: 0 })}.</b> A dispute is open with the same 72 h clock. You do not decide it.</>
                        : <><b>Deposit released.</b> Nothing was claimed on {host.bookingId}.</>}
                </div>
            ) : (
                <>
                    <div className="mk-label"><Eyebrow as="span">What was damaged</Eyebrow></div>
                    <div className="mk-thumbs">
                        <div className="mk-thumb is-wide" />
                        <div className="mk-thumb is-wide" />
                        <button type="button" className="mk-thumb is-wide is-drop" aria-label="Add a photo"><ArrowUp size={18} /></button>
                    </div>
                    <p className="mk-note">Photos carry their capture time and must be taken within 24 h of wrap. A picture from before the shoot, or after the window, cannot support a claim, and the system says so rather than letting it through.</p>

                    <div className="mk-grid mk-cols-2" style={{ gap: 16, marginTop: 8 }}>
                        <div>
                            <label className="mk-label" htmlFor="mk-cost"><Eyebrow as="span">Cost claimed</Eyebrow></label>
                            <input id="mk-cost" className="mk-input" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value.replace(/[^0-9.]/g, ''))} />
                        </div>
                        <div>
                            <div className="mk-label"><Eyebrow as="span">Quote or receipt</Eyebrow></div>
                            <div className="mk-input">cyc-repaint-quote.pdf</div>
                        </div>
                    </div>
                    <p style={{ margin: '18px 0 0' }}>
                        <b className="mk-strong">Capped at the listed hold.</b> <span className="mk-muted">{eur(host.deposit, { decimals: 0 })} here. A claim above it is a matter for insurance, and VIBED says so instead of pretending it can collect.{cap.capped && <> Your {eur(Number(cost) || 0, { decimals: 0 })} will be claimed as {eur(cap.amount, { decimals: 0 })}.</>}</span>
                    </p>
                    <p style={{ margin: '12px 0 0' }}>
                        <b className="mk-strong">The host never decides.</b> <span className="mk-muted">A report opens a dispute with the same 72 h clock and the same split outcomes. A host who could keep a deposit unilaterally would be a reason not to book studios at all.</span>
                    </p>
                    <div className="mk-btn-row" style={{ marginTop: 20 }}>
                        <Btn tone="danger" onClick={() => report(claimDeposit(cost), `Claim of ${eur(cap.amount, { decimals: 0 })} sent. A dispute is open.`)} disabled={cap.amount <= 0}>
                            Claim {eur(cap.amount, { decimals: 0 })} of the deposit
                        </Btn>
                        <Btn onClick={() => report(releaseDeposit(), 'Deposit released.')}>Release the deposit</Btn>
                    </div>
                </>
            )}
        </Card>
    );
}

const STEPS = [
    ['Money frozen, reviews paused', 'Immediately · done'],
    ['The other side has 48 h to answer or settle', 'Ends tomorrow 14:20 · most cases end here'],
    ['Trust desk reads the evidence', '72 h target · the room assembles itself, you upload nothing twice'],
    ['Decision with a written reason', 'Pay, refund or split · one appeal each within 7 days'],
    ['Money moves, files release, reviews publish', 'The outcome is noted on both reviews'],
];

function AfterYouReport({ reported }) {
    return (
        <Card>
            <CardHead title="After you report · the view both sides get" />
            <ol className="mk-steps">
                {STEPS.map(([title, sub], i) => {
                    const done = reported ? i < 2 : false;
                    return (
                        <li key={title}>
                            <span className={cx('mk-step-n', done && 'is-done')}>{i + 1}</span>
                            <span>
                                <span style={{ display: 'block' }}>{title}</span>
                                <span className="mk-muted" style={{ fontSize: 14 }}>{sub}</span>
                            </span>
                        </li>
                    );
                })}
            </ol>
            <p className="mk-note">Withdrawing is one tap and carries no penalty: the money unfreezes and the clock stops. A report that costs something to retract is a report people make too late.</p>
        </Card>
    );
}
