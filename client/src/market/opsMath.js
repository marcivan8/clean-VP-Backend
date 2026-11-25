/**
 * client/src/market/opsMath.js — pure rules for the VIBED Market operations
 * (Trust desk, disputes, reports, versioned rules). R100.
 *
 * No React, no store, no Date.now() hidden inside: every function takes what it
 * needs, so scripts/test_market_interfaces.mjs can execute it directly.
 */

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const eur = (n, { decimals = 2 } = {}) => {
    const v = Number(n) || 0;
    const s = v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    return `€${s}`;
};

/** The four outcomes the dispute room offers. A split is expected, not exotic. */
export const SPLIT_OPTIONS = Object.freeze([0, 0.25, 0.7, 1]);

/**
 * Split a disputed booking.
 *  - The talent receives `talentPct` of what they would normally have been paid.
 *  - The buyer is refunded the rest of what they paid.
 *  - Whatever is left is what the platform keeps; on a split the platform's
 *    margin is scaled with the talent's share, never increased by the dispute.
 * Screen 28: €995.40 paid, €718.90 normal payout, 70% → €503.23 / €298.62.
 */
export function splitDispute({ buyerPaid, talentPayout, talentPct }) {
    const pct = Math.min(1, Math.max(0, Number(talentPct) || 0));
    const toTalent = round2(talentPayout * pct);
    const refunded = round2(buyerPaid * (1 - pct));
    const platformRetained = round2(buyerPaid - toTalent - refunded);
    return { pct, toTalent, refunded, platformRetained };
}

/**
 * The colour of a queue clock. `breach` = past target, `urgent` = a long clock
 * with under a day left ("breaching today"), `warning` = 40% of the time used.
 */
export function clockState(waitedHours, targetHours) {
    const w = Number(waitedHours) || 0;
    const t = Number(targetHours) || 0;
    if (t <= 0) return 'neutral';
    if (w >= t) return 'breach';
    if (t > 24 && t - w < 24) return 'urgent';
    if (w / t >= 0.4) return 'warning';
    return 'neutral';
}

export const isBreachingToday = (waited, target) => {
    const s = clockState(waited, target);
    return s === 'breach' || s === 'urgent';
};

/**
 * Rules are rows with a history. The CURRENT value is the last version; a
 * booking is held to the version that was current when it was made, which is
 * the difference between a policy change and a breach of contract.
 */
export function currentRuleValue(rule) {
    const v = rule?.versions;
    return Array.isArray(v) && v.length ? v[v.length - 1].value : undefined;
}

export function ruleValueAt(rule, atMs) {
    const v = Array.isArray(rule?.versions) ? rule.versions : [];
    let found;
    for (const ver of v) {
        if (ver.at <= atMs) found = ver.value;
    }
    // A booking older than every version is held to the first one.
    return found !== undefined ? found : v[0]?.value;
}

/** Returns a NEW rule with one more version, or the same rule when nothing changed. */
export function withRuleVersion(rule, value, { at, by }) {
    const next = String(value ?? '').trim();
    if (!next || next === String(currentRuleValue(rule))) return rule;
    return { ...rule, versions: [...(rule.versions || []), { value: next, at, by }] };
}

/** Payouts above the threshold need a second person: the approver cannot be the requester. */
export function needsSecondApproval(amount, threshold) {
    return (Number(amount) || 0) > (Number(threshold) || 0);
}

export function canApprovePayout(payout, approverId, threshold) {
    if (!payout || payout.state === 'approved' || payout.state === 'paid') {
        return { ok: false, reason: 'Already approved.' };
    }
    if (payout.state === 'held') return { ok: false, reason: 'Held while a review is open.' };
    if (needsSecondApproval(payout.amount, threshold) && payout.requestedBy === approverId) {
        return { ok: false, reason: 'You started this payout. Above the limit it needs a second person.' };
    }
    return { ok: true };
}

/** What a reported problem freezes and when a human answers. Screen 29. */
export const REPORT_REASONS = Object.freeze([
    { id: 'not_as_agreed', label: 'The work is not what we agreed', hint: 'Missing, unusable or clearly outside the brief. Needs the files and the brief line it breaks.', freezes: true },
    { id: 'no_show', label: 'Nobody turned up', hint: 'Decided by the check-in and a 30 minute grace, not by argument.', freezes: true },
    { id: 'rushes_missing', label: 'The rushes never arrived', hint: 'Upload stalled or incomplete. Check the asset room first, it often resolves itself.', freezes: true },
    { id: 'behaviour', label: 'Someone behaved badly', hint: 'Goes to moderation, not to the money. Handled separately and confidentially.', freezes: false },
]);

/** A host's damage claim is capped at the deposit actually held. */
export function capDamageClaim(claimed, depositHeld) {
    const c = Math.max(0, Number(claimed) || 0);
    const held = Math.max(0, Number(depositHeld) || 0);
    return { amount: Math.min(c, held), capped: c > held, held };
}

/** "HH:MM" for the audit log, from an explicit timestamp. */
export const clockLabel = (ms) => {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
