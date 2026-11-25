/**
 * client/src/store/useMarketOpsStore.js — state for the talent interface,
 * report-a-problem and the Trust desk (R100).
 *
 * Seed-data only, like useMarketplaceStore for the buyer side. Every action
 * returns { ok, error } and only reports ok when it actually changed something
 * (R30): a decision that moved no money is not a decision.
 *
 * Money moves are append-only: a decision ADDS ledger entries and never edits
 * an old one, so the escrow balance stays reconstructable from events.
 */

import { create } from 'zustand';
import {
    splitDispute, withRuleVersion, currentRuleValue, canApprovePayout,
    capDamageClaim, clockLabel, round2, REPORT_REASONS,
} from '../market/opsMath.js';
import {
    SEED_ACTOR, SEED_ID_CHECKS, SEED_CERTIFICATIONS, SEED_MODERATION, SEED_DISPUTES,
    buildSeedRules, SEED_PAYOUTS, SEED_ESCROW, SEED_AUDIT, SEED_USERS,
    SEED_TALENT, SEED_JOB_REQUEST, SEED_ON_SET, SEED_LISTING_DRAFT, SEED_REPORTABLE,
} from '../market/marketOpsSeed.js';

const clone = (v) => JSON.parse(JSON.stringify(v));

const parseEuro = (s) => Number(String(s).replace(/[^0-9.]/g, '')) || 0;

export function initialMarketOpsState() {
    return {
        actor: { ...SEED_ACTOR },
        idChecks: clone(SEED_ID_CHECKS),
        certifications: clone(SEED_CERTIFICATIONS),
        moderation: clone(SEED_MODERATION),
        disputes: clone(SEED_DISPUTES),
        rules: buildSeedRules(),
        payouts: clone(SEED_PAYOUTS),
        escrow: { ...SEED_ESCROW },
        ledger: [],
        audit: clone(SEED_AUDIT),
        users: clone(SEED_USERS),
        talent: clone(SEED_TALENT),
        jobRequest: { ...clone(SEED_JOB_REQUEST), status: 'open' },
        onSet: clone(SEED_ON_SET),
        listing: { ...clone(SEED_LISTING_DRAFT), published: false, removedTags: [] },
        reports: [],
        reportable: clone(SEED_REPORTABLE),
        onboarding: initialOnboarding(),
    };
}

/** Talent onboarding (R101). Seed-only like the rest of this store: not persisted. */
export function initialOnboarding() {
    return {
        idCheck: null,              // null | { result, level, date } — never the document itself
        payoutsConnected: false,
        appearanceRelease: null,    // null | { signedAt }
        hostsLocations: null,       // null (not answered) | true | false
        locationRelease: null,      // null | { signedAt }
        rulesAcceptedAt: null,      // timestamp: the rule versions in force then are the ones agreed to
    };
}

/** Which onboarding steps are done, and whether the talent can go live. */
export function onboardingProgress(o) {
    const steps = {
        identity: o.idCheck?.result === 'pass',
        payouts: o.payoutsConnected === true,
        releases: !!o.appearanceRelease && (o.hostsLocations === false || (o.hostsLocations === true && !!o.locationRelease)),
        rules: !!o.rulesAcceptedAt,
    };
    const done = Object.values(steps).filter(Boolean).length;
    return { steps, done, total: Object.keys(steps).length, complete: done === Object.keys(steps).length };
}

const fail = (error) => ({ ok: false, error });

const useMarketOpsStore = create((set, get) => {
    const log = (text, who) => {
        const entry = { at: clockLabel(Date.now()), who: who || get().actor.name, text };
        set((s) => ({ audit: [entry, ...s.audit] }));
        return entry;
    };
    const ledgerAdd = (entries) => set((s) => ({ ledger: [...s.ledger, ...entries.map((e) => ({ ...e, at: Date.now() }))] }));

    return {
        ...initialMarketOpsState(),

        /** Test/dev only: back to the seed. */
        resetMarketOps: () => set(initialMarketOpsState()),

        /* ── Disputes (screen 28) ─────────────────────────────────────── */
        decideDispute: (id, talentPct, reason) => {
            const d = get().disputes.find((x) => x.id === id);
            if (!d) return fail('Dispute not found.');
            if (d.status !== 'open') return fail('This dispute is already decided.');
            const why = String(reason || '').trim();
            // House rule: a reason in plain language, always — even when one side is plainly right.
            if (why.length < 20) return fail('Write the reason both sides will read (at least a full sentence).');

            const split = splitDispute({ buyerPaid: d.buyerPaid, talentPayout: d.talentPayout, talentPct });
            set((s) => ({
                disputes: s.disputes.map((x) => (x.id === id ? { ...x, status: 'decided', decision: { ...split, reason: why, by: s.actor.name } } : x)),
                escrow: {
                    ...s.escrow,
                    frozen: round2(Math.max(0, s.escrow.frozen - d.frozen)),
                    held: round2(Math.max(0, s.escrow.held - d.frozen)),
                },
            }));
            const entries = [];
            if (split.toTalent > 0) entries.push({ bookingId: id, kind: 'release', to: d.talentName, amount: split.toTalent });
            if (split.refunded > 0) entries.push({ bookingId: id, kind: 'refund', to: 'buyer', amount: split.refunded });
            ledgerAdd(entries);
            const pct = Math.round(split.pct * 100);
            log(`split ${id} ${pct}/${100 - pct}, reason written`);
            return { ok: true, split };
        },

        askDisputeQuestion: (id, question) => {
            const d = get().disputes.find((x) => x.id === id);
            const q = String(question || '').trim();
            if (!d || d.status !== 'open') return fail('Only an open dispute can take a question.');
            if (!q) return fail('Write the question.');
            set((s) => ({ disputes: s.disputes.map((x) => (x.id === id ? { ...x, questions: [...(x.questions || []), q] } : x)) }));
            log(`asked one question on ${id}`);
            return { ok: true };
        },

        /* ── ID checks (screen 27) ────────────────────────────────────── */
        resolveIdCheck: (id, decision) => {
            const c = get().idChecks.find((x) => x.id === id);
            if (!c) return fail('Check not found.');
            if (!['approve', 'reject'].includes(decision)) return fail('Approve or reject.');
            // GDPR: approving keeps {result, level, date} and nothing else — the document stays with the provider.
            const record = { result: decision === 'approve' ? 'pass' : 'fail', level: decision === 'approve' ? 'L1' : null, date: new Date().toISOString().slice(0, 10) };
            set((s) => ({
                idChecks: s.idChecks.filter((x) => x.id !== id),
                users: s.users.map((u) => (u.id === c.userId ? { ...u, status: decision === 'approve' ? 'Active' : 'ID check failed', verification: record } : u)),
            }));
            log(`${decision === 'approve' ? 'approved' : 'rejected'} the ID check of ${c.name}`);
            return { ok: true, record };
        },

        /* ── Certifications ───────────────────────────────────────────── */
        grantCertification: (id) => {
            const c = get().certifications.find((x) => x.id === id);
            if (!c) return fail('Candidate not found.');
            const [a, b] = c.marks;
            if (Math.abs(a - b) > 1) return fail('The markers disagree. Ask a third marker first.');
            if (!c.insuranceOk) return fail('Insurance is not valid. Ask for an updated certificate.');
            set((s) => ({ certifications: s.certifications.filter((x) => x.id !== id) }));
            log(`granted ${c.level} to ${c.name}`);
            return { ok: true };
        },
        requestThirdMarker: (id) => {
            const c = get().certifications.find((x) => x.id === id);
            if (!c) return fail('Candidate not found.');
            if (c.thirdMarker) return fail('A third marker is already assigned.');
            set((s) => ({ certifications: s.certifications.map((x) => (x.id === id ? { ...x, thirdMarker: true } : x)) }));
            log(`asked a third marker for ${c.name}`);
            return { ok: true };
        },

        /* ── Moderation ───────────────────────────────────────────────── */
        moderate: (id, actionId) => {
            const m = get().moderation.find((x) => x.id === id);
            const action = m?.actions.find((a) => a.id === actionId);
            if (!m || !action) return fail('Nothing to moderate.');
            set((s) => ({ moderation: s.moderation.filter((x) => x.id !== id) }));
            log(`${action.label.toLowerCase()} · ${m.kind.toLowerCase()} ${m.title.split('—')[0].trim()}`);
            return { ok: true };
        },

        /* ── Money (screen 30) ────────────────────────────────────────── */
        approvePayout: (id) => {
            const s = get();
            const p = s.payouts.find((x) => x.id === id);
            const threshold = parseEuro(currentRuleValue(s.rules.second_approval_above));
            const check = canApprovePayout(p, s.actor.id, threshold);
            if (!check.ok) return fail(check.reason);
            set((st) => ({ payouts: st.payouts.map((x) => (x.id === id ? { ...x, state: 'approved', approvedBy: st.actor.id } : x)) }));
            log(`approved the payout to ${p.who}`);
            return { ok: true };
        },

        /* ── Rules (screen 30) ────────────────────────────────────────── */
        updateRule: (key, value) => {
            const s = get();
            const rule = s.rules[key];
            if (!rule) return fail('Unknown rule.');
            const before = currentRuleValue(rule);
            const next = withRuleVersion(rule, value, { at: Date.now(), by: s.actor.id });
            if (next === rule) return fail('Same value: nothing to change.');
            set((st) => ({ rules: { ...st.rules, [key]: next } }));
            log(`changed ${rule.label.toLowerCase()} ${before} → ${currentRuleValue(next)}`);
            return { ok: true };
        },

        /* ── Report a problem (screen 29) ─────────────────────────────── */
        reportProblem: ({ side, reasonId, words }) => {
            const s = get();
            const target = s.reportable[side];
            const reason = REPORT_REASONS.find((r) => r.id === reasonId);
            if (!target || !reason) return fail('Pick what went wrong.');
            if (s.reports.some((r) => r.bookingId === target.bookingId && r.status === 'open')) {
                return fail('This booking already has an open report.');
            }
            const report = {
                id: `rp_${target.bookingId}`, side, bookingId: target.bookingId, reasonId,
                words: String(words || '').trim(), amount: target.amount || 0,
                freezes: reason.freezes, status: 'open', openedAt: Date.now(),
            };
            set((st) => ({
                reports: [...st.reports, report],
                escrow: reason.freezes ? { ...st.escrow, frozen: round2(st.escrow.frozen + report.amount) } : st.escrow,
            }));
            log(reason.freezes
                ? `${side} reported a problem on ${target.bookingId}, ${report.amount.toFixed(2)} frozen`
                : `${side} reported behaviour on ${target.bookingId}, sent to moderation`, side === 'buyer' ? 'Buyer' : 'Talent');
            return { ok: true, report };
        },

        /** Withdrawing is one tap and carries no penalty: the money unfreezes and the clock stops. */
        withdrawReport: (reportId) => {
            const r = get().reports.find((x) => x.id === reportId);
            if (!r || r.status !== 'open') return fail('No open report to withdraw.');
            set((st) => ({
                reports: st.reports.map((x) => (x.id === reportId ? { ...x, status: 'withdrawn' } : x)),
                escrow: r.freezes ? { ...st.escrow, frozen: round2(Math.max(0, st.escrow.frozen - r.amount)) } : st.escrow,
            }));
            log(`report on ${r.bookingId} withdrawn, money unfrozen`, r.side === 'buyer' ? 'Buyer' : 'Talent');
            return { ok: true };
        },

        /** A host claims part of the deposit. The host never decides: this opens a dispute. */
        claimDeposit: (claimed) => {
            const s = get();
            const host = s.reportable.host;
            if (host.resolved) return fail('The deposit is already settled.');
            const cap = capDamageClaim(claimed, host.deposit);
            if (cap.amount <= 0) return fail('Enter the cost of the damage.');
            set((st) => ({ reportable: { ...st.reportable, host: { ...host, resolved: 'claimed', claimed: cap.amount } } }));
            log(`host claimed €${cap.amount} of the €${host.deposit} deposit on ${host.bookingId}, dispute opened`, 'Host');
            return { ok: true, ...cap };
        },
        releaseDeposit: () => {
            const host = get().reportable.host;
            if (host.resolved) return fail('The deposit is already settled.');
            set((st) => ({ reportable: { ...st.reportable, host: { ...host, resolved: 'released' } } }));
            log(`host released the deposit on ${host.bookingId}`, 'Host');
            return { ok: true };
        },

        /* ── Talent onboarding (R101) ─────────────────────────────────── */
        runIdCheck: () => {
            const o = get().onboarding;
            if (o.idCheck?.result === 'pass') return fail('Your identity is already verified.');
            // Seed stand-in for the provider redirect: the provider keeps the
            // document; VIBED keeps the result, the level and the date.
            const record = { result: 'pass', level: 'L1', date: new Date().toISOString().slice(0, 10) };
            set({ onboarding: { ...o, idCheck: record } });
            return { ok: true, record };
        },
        connectOnboardingPayouts: () => {
            const o = get().onboarding;
            if (o.payoutsConnected) return fail('Payouts are already connected.');
            set({ onboarding: { ...o, payoutsConnected: true }, listing: { ...get().listing, payoutsConnected: true } });
            return { ok: true };
        },
        setHostsLocations: (value) => {
            const o = get().onboarding;
            if (typeof value !== 'boolean' || o.hostsLocations === value) return fail('Nothing to change.');
            set({ onboarding: { ...o, hostsLocations: value, locationRelease: value ? o.locationRelease : null } });
            return { ok: true };
        },
        signRelease: (kind) => {
            const o = get().onboarding;
            if (kind === 'appearance') {
                if (o.appearanceRelease) return fail('Already signed.');
                set({ onboarding: { ...o, appearanceRelease: { signedAt: Date.now() } } });
                return { ok: true };
            }
            if (kind === 'location') {
                if (o.hostsLocations !== true) return fail('A location release is only for places you host.');
                if (o.locationRelease) return fail('Already signed.');
                set({ onboarding: { ...o, locationRelease: { signedAt: Date.now() } } });
                return { ok: true };
            }
            return fail('Unknown release.');
        },
        acceptTalentRules: () => {
            const o = get().onboarding;
            if (o.rulesAcceptedAt) return fail('Already accepted.');
            set({ onboarding: { ...o, rulesAcceptedAt: Date.now() } });
            return { ok: true };
        },

        /* ── Talent (screens 12, 17, 18, 21) ──────────────────────────── */
        respondToRequest: (decision) => {
            const r = get().jobRequest;
            if (r.status !== 'open') return fail('You already answered this request.');
            if (!['accept', 'decline'].includes(decision)) return fail('Accept or decline.');
            set({ jobRequest: { ...r, status: decision === 'accept' ? 'accepted' : 'declined' } });
            return { ok: true };
        },
        toggleShot: (shotId) => {
            const o = get().onSet;
            if (!o.shots.some((x) => x.id === shotId)) return fail('Shot not found.');
            set({ onSet: { ...o, shots: o.shots.map((x) => (x.id === shotId ? { ...x, done: !x.done } : x)) } });
            return { ok: true };
        },
        applyToBrief: (briefId) => {
            const t = get().talent;
            const b = t.briefs.find((x) => x.id === briefId);
            if (!b) return fail('Brief not found.');
            if (b.applied) return fail('Already applied.');
            set({ talent: { ...t, briefs: t.briefs.map((x) => (x.id === briefId ? { ...x, applied: true } : x)) } });
            return { ok: true };
        },
        removeListingTag: (tag) => {
            const l = get().listing;
            if (l.removedTags.includes(tag)) return fail('Already removed.');
            set({ listing: { ...l, removedTags: [...l.removedTags, tag] } });
            return { ok: true };
        },
        publishListing: () => {
            const l = get().listing;
            if (l.published) return fail('Already live.');
            if (!l.payoutsConnected || !l.leadItem) return fail('Two things still block you: a payout account and a lead portfolio item.');
            set({ listing: { ...l, published: true } });
            return { ok: true };
        },
        setListingFlag: (flag) => {
            const l = get().listing;
            if (!['payoutsConnected', 'leadItem'].includes(flag) || l[flag]) return fail('Nothing to change.');
            set({ listing: { ...l, [flag]: true } });
            return { ok: true };
        },
    };
});

export default useMarketOpsStore;
