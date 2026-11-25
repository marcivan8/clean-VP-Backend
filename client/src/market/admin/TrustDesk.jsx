/**
 * client/src/market/admin/TrustDesk.jsx — the admin interface of VIBED Market (R100).
 * Screens 27 (dashboard), 28 (dispute, see DisputeRoom.jsx) and 30 (rules),
 * plus list views for every other section of the sidebar.
 *
 * Access is decided by the caller (MarketAdminGate): this component assumes the
 * viewer is an admin.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import useMarketOpsStore from '../../store/useMarketOpsStore.js';
import { clockState, currentRuleValue, eur, isBreachingToday, needsSecondApproval } from '../opsMath.js';
import { Btn, Card, CardHead, Chip, ClockChip, Eyebrow, PageHead, Pill, Row, Shell, Stat } from '../ui.jsx';
import { useToast } from '../useToast.jsx';
import { cx } from '../uiUtils.js';
import DisputeRoom from './DisputeRoom.jsx';
import useMarketRules from '../useMarketRules.js';
import { adminAudit, adminSetRule } from '../marketApi.js';

const QUEUE_TARGETS = [['ID check, manual', '24 h'], ['Certification', '5 days'], ['Moderation report', '48 h'], ['Dispute decision', '72 h'], ['Payout approval', 'same day']];

export default function TrustDesk() {
    const [view, setView] = useState('dashboard');
    const [disputeId, setDisputeId] = useState(null);
    // useShallow: the selector builds a new object each time, which zustand 5
    // treats as a change and re-renders forever without a shallow compare.
    const counts = useMarketOpsStore(useShallow((s) => ({
        id: s.idChecks.length,
        cert: s.certifications.length,
        mod: s.moderation.length,
        disputes: s.disputes.filter((d) => d.status === 'open').length,
    })));
    const actorName = useMarketOpsStore((s) => s.actor.name);

    const items = [
        { id: 'dashboard', label: 'Dashboard' },
        { id: 'users', label: 'Users' },
        { id: 'idchecks', label: 'ID checks', count: counts.id, tone: 'amber' },
        { id: 'certifications', label: 'Certifications', count: counts.cert },
        { id: 'moderation', label: 'Moderation', count: counts.mod },
        { id: 'disputes', label: 'Disputes', count: counts.disputes, tone: 'red' },
        { id: 'money', label: 'Money' },
        { id: 'settings', label: 'Settings' },
        { id: 'audit', label: 'Audit log' },
    ];

    const go = (v) => { setDisputeId(null); setView(v); };
    const openDispute = (id) => { setDisputeId(id); setView('disputes'); };

    return (
        <Shell
            eyebrow="VIBED"
            brand="Trust desk"
            items={items}
            active={view}
            onSelect={go}
            footer={<>Signed in as <b style={{ color: 'var(--mk-ink)', fontWeight: 500 }}>{actorName}</b> · admin<br /><span>Every action here is written to the audit log with your name on it.</span></>}
        >
            {view !== 'settings' && view !== 'audit' && (
                <div className="mk-callout is-amber" style={{ marginTop: 0, marginBottom: 22 }}>
                    <b>Sample data.</b> Queues, disputes, users and money here are examples until bookings and payments go live. Settings and the audit log are real.
                </div>
            )}
            {disputeId ? <DisputeRoom disputeId={disputeId} onBack={() => go('dashboard')} />
                : view === 'dashboard' ? <Dashboard onOpenDispute={openDispute} go={go} />
                : view === 'users' ? <UsersView />
                : view === 'idchecks' ? <IdChecksView full />
                : view === 'certifications' ? <CertificationsView full />
                : view === 'moderation' ? <ModerationView full />
                : view === 'disputes' ? <DisputesView onOpen={openDispute} />
                : view === 'money' ? <MoneyView />
                : view === 'settings' ? <RulesView />
                : <AuditView />}
        </Shell>
    );
}

/* ── 27 · Dashboard ───────────────────────────────────────────────────── */

function Dashboard({ onOpenDispute, go }) {
    const s = useMarketOpsStore((st) => st);
    const open = s.disputes.filter((d) => d.status === 'open');
    const breaching = open.filter((d) => isBreachingToday(d.waitedHours, d.targetHours));
    const oldestId = s.idChecks.reduce((m, c) => Math.max(m, c.waitedHours), 0);
    const disagreeing = s.certifications.filter((c) => Math.abs(c.marks[0] - c.marks[1]) > 1).length;

    return (
        <>
            <PageHead
                kicker="27 · Admin"
                title="What needs a human today"
                right={<p className="mk-lede" style={{ maxWidth: 600 }}>One queue per kind of decision, each with a clock. A marketplace fails at the speed of its slowest queue: a creator waiting four days on an ID check has already gone back to Instagram DMs.</p>}
            />
            <div className="mk-grid mk-cols-4" style={{ marginBottom: 22 }}>
                <Stat cardTone="red" label="Open disputes" value={open.length} tone="red" sub={breaching.length ? `${breaching.length} breaching 72h today` : 'none breaching today'} />
                <Stat label="ID checks waiting" value={s.idChecks.length} sub={s.idChecks.length ? `oldest ${oldestId} h · target 24 h` : 'queue empty'} />
                <Stat label="Certifications waiting" value={s.certifications.length} sub={`${disagreeing} need a second marker`} />
                <Stat cardTone="teal" label="Money held" mono tone="teal" value={eur(s.escrow.held, { decimals: 0 })} sub={`across ${s.escrow.bookings} bookings · ${eur(s.escrow.frozen, { decimals: 0 })} frozen`} />
            </div>

            <div className="mk-grid mk-aside">
                <div className="mk-stack">
                    <IdChecksView />
                    <CertificationsView />
                    <ModerationView />
                </div>
                <div className="mk-stack">
                    <Card tone="red">
                        <CardHead title="Breaching today" tone="red" />
                        {open.length === 0 && <p className="mk-empty">No open disputes.</p>}
                        {open.map((d, i) => {
                            const hot = isBreachingToday(d.waitedHours, d.targetHours);
                            return (
                                <div key={d.id} style={{ padding: '14px 0', borderTop: i ? '1px solid var(--mk-line)' : 'none' }}>
                                    <div className="mk-h3">Dispute · {d.kind}</div>
                                    <div className="mk-muted">booking {d.id} · {eur(d.frozen)} {d.deposit ? 'deposit' : 'frozen'}</div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
                                        <ClockChip waited={d.waitedHours} target={d.targetHours} showTarget />
                                        <Btn tone={hot ? 'primary' : undefined} onClick={() => onOpenDispute(d.id)}>{hot ? 'Decide' : 'Open'}</Btn>
                                    </div>
                                </div>
                            );
                        })}
                    </Card>
                    <UserSearch go={go} />
                    <Card>
                        <CardHead title="Queue targets" />
                        {QUEUE_TARGETS.map(([l, v]) => <Row key={l} label={l} value={v} />)}
                        <p className="mk-note">Published to users, not internal. A target nobody outside can see is a target nobody misses.</p>
                    </Card>
                </div>
            </div>
        </>
    );
}

function UserSearch({ go }) {
    const [q, setQ] = useState('');
    return (
        <Card>
            <CardHead title="Search a user" />
            <form onSubmit={(e) => { e.preventDefault(); go('users'); }} style={{ position: 'relative' }}>
                <Search size={18} style={{ position: 'absolute', left: 16, top: 15, color: 'var(--mk-muted)' }} aria-hidden="true" />
                <label className="mk-sr" htmlFor="mk-user-q">Search a user</label>
                <input id="mk-user-q" className="mk-input" style={{ paddingLeft: 46 }} placeholder="name, email, id, booking" value={q} onChange={(e) => setQ(e.target.value)} />
            </form>
            <p className="mk-note">A user page shows level, history, bookings, payouts and every decision ever made about them, then suspend or ban, with a reason that is shown to them.</p>
        </Card>
    );
}

/* ── Queues ───────────────────────────────────────────────────────────── */

function IdChecksView({ full }) {
    const checks = useMarketOpsStore((s) => s.idChecks);
    const resolveIdCheck = useMarketOpsStore((s) => s.resolveIdCheck);
    const { report, toastNode } = useToast();
    const [openId, setOpenId] = useState(null);
    const rows = full ? checks : checks.slice(0, 3);

    const body = (
        <Card>
            {toastNode}
            <CardHead title="ID check queue · failed or doubtful only" tone="amber" right={<Pill>Passes are automatic</Pill>} />
            {rows.length === 0 ? <p className="mk-empty">Nothing waiting. Every recent check passed automatically.</p> : (
                <div className="mk-table-wrap">
                    <table className="mk-table">
                        <thead><tr><th>Person</th><th>Role</th><th>Why it stopped</th><th>Waiting</th><th className="is-right">Decide</th></tr></thead>
                        <tbody>
                            {rows.map((c) => (
                                <React.Fragment key={c.id}>
                                    <tr>
                                        <td><span className="mk-strong">{c.name}</span><span className="mk-sub">{c.userId}</span></td>
                                        <td>{c.role}</td>
                                        <td>{c.reason}</td>
                                        <td><ClockChip waited={c.waitedHours} target={24} /></td>
                                        <td className="is-right"><Btn onClick={() => setOpenId(openId === c.id ? null : c.id)} aria-expanded={openId === c.id}>{openId === c.id ? 'Close' : 'Open'}</Btn></td>
                                    </tr>
                                    {openId === c.id && (
                                        <tr><td colSpan={5} style={{ background: 'var(--mk-sunk)', borderRadius: 12 }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'center', padding: '4px 8px' }}>
                                                <span className="mk-muted">Provider result: <b style={{ color: 'var(--mk-ink)', fontWeight: 500 }}>{c.reason.toLowerCase()}</b>. The document stays with the provider.</span>
                                                <span className="mk-btn-row">
                                                    <Btn size="small" tone="primary" onClick={() => report(resolveIdCheck(c.id, 'approve'), `${c.name} approved. Stored: result, level, date.`)}>Approve</Btn>
                                                    <Btn size="small" onClick={() => report(resolveIdCheck(c.id, 'reject'), `${c.name} rejected, with the reason shown to them.`)}>Reject</Btn>
                                                </span>
                                            </div>
                                        </td></tr>
                                    )}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {!full && checks.length > rows.length && <p className="mk-note">{checks.length - rows.length} more in ID checks.</p>}
            <div className="mk-callout"><b>The document itself is never stored here.</b> The provider holds it; this queue shows the reason code, the name match and the date. Approving writes <span className="mk-mono">{'{result, level, date}'}</span> and nothing else, which is the whole GDPR answer for identity data.</div>
        </Card>
    );
    return full ? <><PageHead kicker="Admin · ID checks" title="Identity, by exception" />{body}</> : body;
}

function CertificationsView({ full }) {
    const certs = useMarketOpsStore((s) => s.certifications);
    const grant = useMarketOpsStore((s) => s.grantCertification);
    const third = useMarketOpsStore((s) => s.requestThirdMarker);
    const { report, toastNode } = useToast();
    const rows = full ? certs : certs.slice(0, 2);

    const body = (
        <Card>
            {toastNode}
            <CardHead title="Certification queue" />
            {rows.length === 0 ? <p className="mk-empty">No candidates waiting.</p> : (
                <div className="mk-table-wrap">
                    <table className="mk-table">
                        <thead><tr><th>Candidate</th><th>Test</th><th>Marks</th><th>Insurance</th><th className="is-right">Action</th></tr></thead>
                        <tbody>
                            {rows.map((c) => {
                                const disagree = Math.abs(c.marks[0] - c.marks[1]) > 1;
                                return (
                                    <tr key={c.id}>
                                        <td className="mk-strong">{c.name}</td>
                                        <td>{c.test}</td>
                                        <td><span className="mk-mono">{c.marks[0]} · {c.marks[1]}</span><span className={cx('mk-sub', disagree && 'mk-amber')} style={{ fontFamily: 'inherit' }}>{disagree ? (c.thirdMarker ? 'third marker assigned' : 'markers disagree') : '2 peers agree'}</span></td>
                                        <td className={c.insuranceOk ? 'mk-green' : 'mk-amber'}>{c.insurance}</td>
                                        <td className="is-right">
                                            {disagree
                                                ? <Btn disabled={!!c.thirdMarker} onClick={() => report(third(c.id), `Third marker asked for ${c.name}.`)}>Third marker</Btn>
                                                : <Btn tone="primary" onClick={() => report(grant(c.id), `${c.level} granted to ${c.name}.`)}>Grant {c.level}</Btn>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
            <p className="mk-note">Two certified peers mark against the published rubric and are paid for it; staff only break ties and spot-check. A marker never sees a candidate they have worked with.</p>
        </Card>
    );
    return full ? <><PageHead kicker="Admin · Certifications" title="Levels, marked by peers" />{body}</> : body;
}

function ModerationView({ full }) {
    const items = useMarketOpsStore((s) => s.moderation);
    const moderate = useMarketOpsStore((s) => s.moderate);
    const { report, toastNode } = useToast();
    const rows = full ? items : items.slice(0, 2);
    const body = (
        <Card>
            {toastNode}
            <CardHead title="Moderation" right={<Pill tone="red">Reported by users</Pill>} />
            {rows.length === 0 && <p className="mk-empty">Nothing reported.</p>}
            {rows.map((m, i) => (
                <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', padding: '16px 0', borderTop: i ? '1px solid var(--mk-line)' : 'none' }}>
                    <div style={{ flex: '1 1 420px', minWidth: 0 }}>
                        <div style={{ fontSize: 17 }}>{m.kind} · {m.title}</div>
                        <div className="mk-muted" style={{ fontSize: 14.5, marginTop: 4 }}>{m.detail}</div>
                    </div>
                    <div className="mk-btn-row" style={{ alignSelf: 'center' }}>
                        {m.actions.map((a, j) => (
                            <Btn key={a.id} tone={j ? 'quiet' : undefined} onClick={() => report(moderate(m.id, a.id), `${a.label}: done, logged.`)}>{a.label}</Btn>
                        ))}
                    </div>
                </div>
            ))}
        </Card>
    );
    return full ? <><PageHead kicker="Admin · Moderation" title="What users reported" />{body}</> : body;
}

function DisputesView({ onOpen }) {
    const disputes = useMarketOpsStore((s) => s.disputes);
    return (
        <>
            <PageHead kicker="Admin · Disputes" kickerTone="red" title="Every dispute, with its clock" />
            <Card>
                <div className="mk-table-wrap">
                    <table className="mk-table">
                        <thead><tr><th>Booking</th><th>Problem</th><th>Money</th><th>Clock</th><th className="is-right">Action</th></tr></thead>
                        <tbody>
                            {disputes.map((d) => (
                                <tr key={d.id}>
                                    <td className="mk-mono">{d.id}</td>
                                    <td>{d.kind}<span className="mk-sub" style={{ fontFamily: 'inherit' }}>{d.project}</span></td>
                                    <td className="mk-mono">{eur(d.frozen)}</td>
                                    <td>{d.status === 'open' ? <ClockChip waited={d.waitedHours} target={d.targetHours} showTarget /> : <Chip tone="green">decided {Math.round(d.decision.pct * 100)}/{100 - Math.round(d.decision.pct * 100)}</Chip>}</td>
                                    <td className="is-right"><Btn tone={d.status === 'open' && clockState(d.waitedHours, d.targetHours) !== 'neutral' ? 'primary' : undefined} onClick={() => onOpen(d.id)}>{d.status === 'open' ? 'Decide' : 'View'}</Btn></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>
        </>
    );
}

function UsersView() {
    const users = useMarketOpsStore((s) => s.users);
    const [q, setQ] = useState('');
    const list = useMemo(() => {
        const n = q.trim().toLowerCase();
        return n ? users.filter((u) => `${u.name} ${u.id} ${u.kind}`.toLowerCase().includes(n)) : users;
    }, [users, q]);
    return (
        <>
            <PageHead kicker="Admin · Users" title="Everyone, with their history" />
            <Card>
                <label className="mk-sr" htmlFor="mk-users-q">Search users</label>
                <input id="mk-users-q" className="mk-input" placeholder="name, id, role" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 16 }} />
                <div className="mk-table-wrap">
                    <table className="mk-table">
                        <thead><tr><th>Name</th><th>Kind</th><th>Level</th><th>Status</th><th className="is-right">Bookings</th></tr></thead>
                        <tbody>
                            {list.map((u) => (
                                <tr key={u.id}>
                                    <td><span className="mk-strong">{u.name}</span><span className="mk-sub">{u.id}</span></td>
                                    <td>{u.kind}</td><td>{u.level}</td>
                                    <td className={u.status === 'Active' ? 'mk-green' : 'mk-amber'}>{u.status}</td>
                                    <td className="is-right mk-mono">{u.bookings}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {list.length === 0 && <p className="mk-empty">No one matches “{q}”.</p>}
            </Card>
        </>
    );
}

/* ── Money ────────────────────────────────────────────────────────────── */

function MoneyHeld() {
    const s = useMarketOpsStore((st) => st);
    const approvePayout = useMarketOpsStore((st) => st.approvePayout);
    const { report, toastNode } = useToast();
    const threshold = currentRuleValue(s.rules.second_approval_above);
    const limit = Number(String(threshold).replace(/[^0-9.]/g, '')) || 0;
    const stateLabel = { approved: ['Approved', 'mk-green'], needs_check: ['Needs 2nd check', 'mk-amber'], held: ['Held · in review', 'mk-muted'] };
    return (
        <Card tone="teal">
            {toastNode}
            <CardHead title="Money · what is actually held" tone="teal" />
            <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
                {[['In escrow', eur(s.escrow.held, { decimals: 0 }), ''], ['Frozen by disputes', eur(s.escrow.frozen, { decimals: 0 }), 'mk-red'], ['Due out Friday', eur(s.escrow.dueFriday, { decimals: 0 }), 'mk-green']].map(([l, v, c]) => (
                    <div key={l}><Eyebrow>{l}</Eyebrow><div className={cx('mk-mono', c)} style={{ fontSize: 34, marginTop: 6 }}>{v}</div></div>
                ))}
            </div>
            <div className="mk-table-wrap" style={{ marginTop: 20 }}>
                <table className="mk-table">
                    <thead><tr><th>Payout</th><th>Amount</th><th>State</th><th className="is-right">Action</th></tr></thead>
                    <tbody>
                        {s.payouts.map((p) => (
                            <tr key={p.id}>
                                <td>{p.who}</td>
                                <td className="mk-mono">{eur(p.amount)}</td>
                                <td className={stateLabel[p.state]?.[1]}>{stateLabel[p.state]?.[0] || p.state}{needsSecondApproval(p.amount, limit) && p.state === 'needs_check' && <span className="mk-sub" style={{ fontFamily: 'inherit' }}>above {threshold}</span>}</td>
                                <td className="is-right">{p.state === 'needs_check'
                                    ? <Btn onClick={() => report(approvePayout(p.id), `Payout to ${p.who} approved.`)}>Approve</Btn>
                                    : <span className="mk-muted">{p.state === 'approved' ? 'auto' : '—'}</span>}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p className="mk-note">Anything above {threshold} needs a second person, and the ledger stays append-only: a reversal is a new entry, never an edit. That is what makes the escrow balance reconstructable from events if a provider, an auditor or a court asks.</p>
        </Card>
    );
}

function EscrowConstraint() {
    return (
        <Card tone="amber">
            <CardHead title="Escrow · the constraint that shapes this" tone="amber" />
            <p style={{ margin: 0 }}>A card authorisation lapses in about seven days, so a shoot booked three weeks out cannot sit on a hold. The money is <b className="mk-strong">authorised at request</b> and <b className="mk-strong">charged into an escrow balance at acceptance</b>, not held as a pending authorisation until the shoot day.</p>
            <div className="mk-btn-row" style={{ margin: '16px 0 4px', gap: 8 }}>
                <Chip>authorised</Chip><span aria-hidden="true">→</span><Chip tone="teal">captured</Chip><span aria-hidden="true">→</span><Chip tone="teal">held</Chip><span aria-hidden="true">→</span><Chip tone="green">released</Chip>
            </div>
            <p className="mk-note">Reserve against chargebacks from the first euro: released money can still be clawed back months later, and a marketplace that has already paid the talent is the one holding the loss.</p>
        </Card>
    );
}

function MoneyView() {
    const ledger = useMarketOpsStore((s) => s.ledger);
    return (
        <>
            <PageHead kicker="Admin · Money" title="What is held, frozen and due" />
            <div className="mk-grid mk-cols-2" style={{ alignItems: 'start' }}>
                <MoneyHeld />
                <div className="mk-stack">
                    <EscrowConstraint />
                    <Card>
                        <CardHead title="Ledger · this session" />
                        {ledger.length === 0 ? <p className="mk-empty">No money moved yet. Deciding a dispute adds entries here.</p>
                            : ledger.map((e, i) => <Row key={i} label={`${e.bookingId} · ${e.kind === 'refund' ? 'refund to buyer' : `release to ${e.to}`}`} value={eur(e.amount)} />)}
                        <p className="mk-note">Append-only. Nothing here can be edited, only reversed by a new entry.</p>
                    </Card>
                </div>
            </div>
        </>
    );
}

/* ── 30 · Rules ───────────────────────────────────────────────────────── */

function RuleTable({ title, group, footnote }) {
    // R102: the real rules table (market_rules + market_rule_versions), not seed state.
    const { list, state, refresh } = useMarketRules();
    const { report, toastNode } = useToast();
    const [editing, setEditing] = useState(null);
    const [draft, setDraft] = useState('');
    const [saving, setSaving] = useState(false);
    const rows = list.filter((r) => r.group === group);

    const save = async (key) => {
        setSaving(true);
        const r = await adminSetRule(key, draft);
        setSaving(false);
        report(r, 'Saved as a new version. Bookings already made keep their terms.');
        if (r.ok) { setEditing(null); refresh(); }
    };

    return (
        <Card>
            {toastNode}
            <CardHead title={title} />
            {state === 'loading' && <p className="mk-muted" role="status">Loading…</p>}
            {state === 'error' && <p className="mk-red" role="alert">The rules could not be loaded.</p>}
            {rows.map((r) => {
                const v = r.value;
                const tone = v === 'waived' || v === 'never stored' ? 'green' : v === 'suspension' ? 'red' : undefined;
                return (
                    <div key={r.key} className="mk-row">
                        <span className="mk-row-label">{r.label}{r.versions > 1 && <span className="mk-sub" style={{ fontFamily: 'inherit' }}>{r.versions} versions · was {r.previous}</span>}</span>
                        {editing === r.key ? (
                            <span className="mk-btn-row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                                <label className="mk-sr" htmlFor={`rule-${r.key}`}>{r.label}</label>
                                <input id={`rule-${r.key}`} className="mk-input" style={{ width: 170, padding: '7px 10px' }} value={draft} autoFocus maxLength={80}
                                    onChange={(e) => setDraft(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') save(r.key); if (e.key === 'Escape') setEditing(null); }} />
                                <Btn size="small" tone="primary" disabled={saving} onClick={() => save(r.key)}>Save</Btn>
                                <Btn size="small" tone="quiet" onClick={() => setEditing(null)}>Cancel</Btn>
                            </span>
                        ) : (
                            <button type="button" onClick={() => { setEditing(r.key); setDraft(v); }} aria-label={`Change ${r.label}, currently ${v}`} style={{ all: 'unset', cursor: 'pointer' }}>
                                <Chip tone={tone}>{v}</Chip>
                            </button>
                        )}
                    </div>
                );
            })}
            {footnote && <p className="mk-note">{footnote}</p>}
        </Card>
    );
}

function RulesView() {
    return (
        <>
            <PageHead
                split
                kicker="30 · Admin"
                title="Every rule is a row, not a constant"
                lede="Deadlines, fees, deposits and cancellation terms live in one table with a history. Changing a number here applies to new bookings only: a booking carries the terms it was made under, which is the difference between a policy change and a breach of contract."
                right={<Pill tone="amber">Changes are versioned and logged</Pill>}
            />
            <div className="mk-grid mk-cols-2" style={{ alignItems: 'start' }}>
                <div className="mk-stack">
                    <RuleTable title="Deadlines" group="deadlines" />
                    <RuleTable title="Money" group="money" />
                    <RuleTable title="Cancellation and no-show" group="cancellation"
                        footnote="The talent-side cancellation penalty was missing from the first design. Without it, only one side of the market carried a cost for backing out, and the buyer whose shoot day evaporates is the one who leaves and does not come back." />
                    <RuleTable title="Damage and deposits" group="damage"
                        footnote="The host never decides. A damage report opens a dispute with the same clock and the same split outcomes as any other." />
                </div>
                <div className="mk-stack">
                    <MoneyHeld />
                    <EscrowConstraint />
                    <RuleTable title="Verification and proof" group="verification"
                        footnote="ID is a supply-side gate only. Buyers are the ones paying, so an ID check on them costs conversion and stops no fraud." />
                    <RuleTable title="Retention" group="retention"
                        footnote="A withdrawn appearance release overrides all of it: those files come down from the platform, from the archive, and the buyer is told to stop using them." />
                    <AuditCard limit={5} />
                </div>
            </div>
        </>
    );
}

/* ── Audit ────────────────────────────────────────────────────────────── */

function AuditCard({ limit }) {
    // R102: the real append-only market_audit_log.
    const [rows, setRows] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => { adminAudit().then((r) => (r.ok ? setRows(r.audit || []) : setError(r.error))); }, []);
    const shown = rows ? (limit ? rows.slice(0, limit) : rows) : [];
    const when = (iso) => { const d = new Date(iso); return `${d.toLocaleDateString()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
    return (
        <Card>
            <CardHead title="Audit log" />
            {error && <p className="mk-red" role="alert">{error}</p>}
            {!error && !rows && <p className="mk-muted" role="status">Loading…</p>}
            {rows && rows.length === 0 && <p className="mk-empty">Nothing recorded yet.</p>}
            {shown.map((a, i) => <Row key={i} label={`${a.actor_label} · ${a.action}${a.target ? ` · ${a.target}` : ''}`} value={when(a.at)} />)}
            <p className="mk-note">Every admin action, every automatic one, who and when: append-only, enforced by the database. While the Trust desk is one person, this is also the only thing standing between a bad afternoon and a claim nobody can answer.</p>
        </Card>
    );
}

function AuditView() {
    return (<><PageHead kicker="Admin · Audit log" title="Who did what, and when" /><AuditCard /></>);
}
