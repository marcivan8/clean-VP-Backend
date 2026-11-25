/**
 * client/src/market/marketOpsSeed.js — seed data for the talent interface,
 * report-a-problem and the Trust desk (screens 12, 17-19, 21, 27-30). R100.
 *
 * Like the former buyer-side seed (moved to _to_delete/r102-market), this is the
 * whole data source until the market has a backend. Every number on the
 * design screens comes from here, so the screens agree with each other.
 */

const H = 3600 * 1000;
// A fixed reference instant keeps "waited N h" deterministic between renders.
export const SEED_NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const DAY = 24 * H;

export const SEED_ACTOR = { id: 'marc', name: 'Marc', role: 'admin' };

export const SEED_ID_CHECKS = [
    { id: 'idc_4471', userId: 'usr_4471', name: 'Awa Cissé', role: 'Talent', reason: 'Name on the document does not match the payout account', waitedHours: 19 },
    { id: 'idc_4468', userId: 'usr_4468', name: 'Studio Kemet', role: 'Host', reason: 'SIRET not found in the register', waitedHours: 6 },
    { id: 'idc_4455', userId: 'usr_4455', name: 'Léo Marchand', role: 'Talent', reason: 'Document expired 3 weeks ago', waitedHours: 2 },
    { id: 'idc_4449', userId: 'usr_4449', name: 'Maëlle Roux', role: 'Talent', reason: 'Photo does not match the selfie check', waitedHours: 11 },
    { id: 'idc_4440', userId: 'usr_4440', name: 'Atelier Nord', role: 'Host', reason: 'Registered address differs from the listing', waitedHours: 8 },
    { id: 'idc_4437', userId: 'usr_4437', name: 'Yanis Haddad', role: 'Talent', reason: 'Document image unreadable', waitedHours: 4 },
    { id: 'idc_4431', userId: 'usr_4431', name: 'Clara Roux', role: 'Host', reason: 'Business name not on the payout account', waitedHours: 1 },
];

export const SEED_CERTIFICATIONS = [
    { id: 'cert_nour', name: 'Nour Benali', test: 'Vertical / short form', marks: [4.6, 4.4], insurance: '€2M, valid', insuranceOk: true, level: 'L3' },
    { id: 'cert_ines', name: 'Inès Ferreira', test: 'Food & drink', marks: [4.8, 3.1], insurance: 'n/a', insuranceOk: true, level: 'L2' },
    { id: 'cert_sana', name: 'Sana Diop', test: 'Interview, two camera', marks: [4.2, 4.5], insurance: '€1M, valid', insuranceOk: true, level: 'L2' },
    { id: 'cert_theo', name: 'Théo Martin', test: 'Podcast set with sound', marks: [3.9, 4.1], insurance: 'expires in 6 days', insuranceOk: false, level: 'L2' },
];

export const SEED_MODERATION = [
    { id: 'mod_lumiere', kind: 'Listing', title: '“Studio Lumière” — phone number in the description', detail: 'Taking the booking off-platform. Rule: contact details in public fields are removed, the host is warned once, a second time suspends.', actions: [{ id: 'remove_warn', label: 'Remove field + warn' }, { id: 'allow', label: 'Allow' }] },
    { id: 'mod_review', kind: 'Review', title: 'names a person who was not on the booking', detail: 'Private data in a public review. Removed for that reason, not for being negative — the rating itself stays counted.', actions: [{ id: 'redact', label: 'Redact' }, { id: 'keep', label: 'Keep' }] },
    { id: 'mod_profile', kind: 'Profile', title: 'portfolio item credited to another operator', detail: 'Reported by the operator named in the credits. Hidden until the uploader shows the call sheet.', actions: [{ id: 'hide', label: 'Hide item' }, { id: 'keep', label: 'Keep' }] },
];

export const SEED_DISPUTES = [
    {
        id: 'bk_8821', title: 'The rushes are unusable', kind: 'unusable rushes',
        raisedBy: 'buyer', raisedDaysAgo: 2, project: 'Noma founder interview',
        talentName: 'Nour Benali', talentId: 'nour-benali', venue: 'Atelier Rive Sud',
        buyerPaid: 995.40, talentPayout: 718.90, frozen: 995.40,
        waitedHours: 69, targetHours: 72, status: 'open',
        timeline: [
            { date: '06 Nov', text: 'Booking accepted, €995.40 captured into escrow', by: 'SYSTEM', tone: 'grey' },
            { date: '11 Nov', text: 'Scope change accepted: third setup, +€68', by: 'BOTH · IN THREAD', tone: 'grey' },
            { date: '19 Nov', text: 'Check-in at Atelier Rive Sud, 09:04', by: 'TALENT · GPS, 40 M FROM THE LISTED ADDRESS', tone: 'green' },
            { date: '19 Nov', text: 'Wrap marked 13:28 · 61 files queued, 61 uploaded by 15:10', by: 'TALENT', tone: 'grey' },
            { date: '19 Nov', text: 'Ingest warning: clips 14–22 show clipped audio on channel 1', by: 'SYSTEM · AUTOMATIC CHECK, SHOWN TO BOTH AT THE TIME', tone: 'amber' },
            { date: '21 Nov', text: 'Buyer raised a problem, release frozen', by: 'BUYER', tone: 'red' },
            { date: '22 Nov', text: '48 h settlement window passed with no agreement', by: 'SYSTEM', tone: 'grey' },
        ],
        eventCount: 14,
        buyer: { initials: 'MK', name: 'Buyer says', stats: '4.8 · 6 bookings · no previous dispute', quote: 'Half the interview has unusable audio. I cannot cut around it — the clipping is on the answers, not the questions. I am not paying for a shoot I have to redo.', files: [{ name: 'clip-17-audio.mp4', meta: '0:42' }, { name: 'waveform-screenshot.png', meta: 'PNG' }] },
        talent: { initials: 'NB', name: 'Talent says', stats: '4.92 · 38 jobs · no previous dispute', quote: 'Channel 1 clipped on the lav when he leaned forward. Channel 2 is the boom and it is clean for the whole interview — the second track is in the same files. I offered to re-sync it the same evening.', files: [{ name: 'clip-17-ch2-boom.mp4', meta: '0:42' }, { name: 'message offering a re-sync, 19 Nov 18:02', meta: 'THREAD' }] },
        brief: {
            agreed: 'two camera, lav + boom, raw files handed over, first cut in 48 h.',
            notAgreed: 'a single-track deliverable, or a guarantee that channel 1 alone would be usable.',
            relevant: 'the automatic ingest warning was shown to both sides on the day. Neither acted on it for two days.',
        },
        consequences: { disputeRate: '1 of 39', elite: 'at risk · <1% needed' },
        draftReason: 'The boom track is clean and was delivered, so the shoot is not unusable — but the ingest warning went unanswered and the re-sync was never done, so the buyer did not receive a workable first cut.',
    },
    {
        id: 'bk_8795', title: 'Studio damage', kind: 'studio damage',
        raisedBy: 'host', raisedDaysAgo: 1, project: 'Mellow Tea product set',
        talentName: 'Clara Roux', talentId: 'clara-roux', venue: 'Atelier Rive Sud',
        buyerPaid: 300, talentPayout: 300, frozen: 300, deposit: true,
        waitedHours: 31, targetHours: 72, status: 'open',
        timeline: [
            { date: '20 Nov', text: 'Deposit €300 held at booking', by: 'SYSTEM', tone: 'grey' },
            { date: '21 Nov', text: 'Wrap marked 18:10', by: 'BUYER', tone: 'grey' },
            { date: '22 Nov', text: 'Host reported damage to the cyclorama, €180 claimed', by: 'HOST', tone: 'red' },
        ],
        eventCount: 6,
        buyer: { initials: 'LB', name: 'Buyer says', stats: '4.6 · 3 bookings · no previous dispute', quote: 'The scuff was there when we arrived, we just did not photograph it.', files: [] },
        talent: { initials: 'CR', name: 'Host says', stats: '4.9 · 112 bookings · no previous dispute', quote: 'Fresh tyre marks on the cyc floor, photographed at 18:40, after their trolley.', files: [{ name: 'cyc-floor-1840.jpg', meta: 'JPG' }, { name: 'cyc-repaint-quote.pdf', meta: 'PDF' }] },
        brief: { agreed: 'cyclorama and drive-in, no vehicles on the painted floor.', notAgreed: 'anything about trolleys on the cyc.', relevant: 'photos carry their capture time; the host photos are after wrap.' },
        consequences: { disputeRate: '0 of 112', elite: 'unchanged' },
        draftReason: '',
    },
];

export const SEED_RULES = {
    // Values settled in the market review (R101). Config, not code: the Trust
    // desk edits these as versioned rows, and the talent onboarding page shows
    // the same rows a talent agrees to.
    deadlines: [
        ['answer_request', 'Answer a booking request', '24 h'],
        ['request_expires', 'Request expires, whatever the counters', '24 h'],
        ['request_reminder', 'Reminder before it expires', '18 h'],
        ['answer_counter', 'Answer a counter-offer', '12 h'],
        ['counter_rounds', 'Counter rounds, per side', '2'],
        ['review_rushes', 'Review the rushes', '5 days'],
        ['auto_accept_reminder', 'Reminder before auto-accept', 'day 4'],
        ['settle_window', 'Settle between the parties', '48 h'],
        ['trust_decision', 'Trust desk decision', '72 h'],
        ['appeal_window', 'Appeal window', '7 days'],
        ['publish_ratings', 'Publish ratings', '14 days'],
    ],
    verification: [
        ['verify_buyer', 'Buyer verification', 'email + valid card'],
        ['verify_talent', 'Talent and host verification', 'ID via provider'],
        ['shoot_proof', 'Proof the shoot happened', 'talent GPS check-in'],
        ['host_confirmation', 'Host confirmation', 'optional, opens damage window'],
    ],
    money: [
        ['fee_pro', 'Buyer service fee · Pro', '5%'],
        ['fee_enterprise', 'Buyer service fee · Enterprise', '0%'],
        ['rate_standard', 'Talent rate · standard', '12%'],
        ['rate_pro', 'Talent rate · Pro and Elite level', '9%'],
        ['rate_repeat', 'Talent rate · 4th job, same client', '6%'],
        ['ugc_take', 'UGC take on creator payments', '12%'],
        ['fee_split', 'Fee on a split decision', 'waived'],
        ['payout_delay_standard', 'Payout delay · standard', '7 days'],
        ['payout_delay_pro', 'Payout delay · Pro and Elite', '2 days'],
        ['second_approval_above', 'Second approval above', '€2,000'],
    ],
    cancellation: [
        ['buyer_free_until', 'Buyer cancels · free until', '7 days before'],
        ['buyer_7d_48h', 'Buyer cancels · 7 days to 48 h', '50%'],
        ['buyer_inside_48h', 'Buyer cancels · inside 48 h', '100%'],
        ['talent_share_kept', 'Of what is kept, talent receives', '80%'],
        ['talent_cancel_over7', 'Talent cancels · more than 7 days out', 'reliability hit only'],
        ['talent_cancel_7d', 'Talent cancels · inside 7 days', '20% of payout, max €150'],
        ['talent_cancel_48h', 'Talent cancels · inside 48 h', '50% + level drop'],
        ['talent_third_cancel', 'Third talent cancellation in 12 months', 'suspension'],
        ['checkin_grace', 'Check-in grace before a no-show', '30 min'],
        ['no_show_buyer', 'Buyer no-show', 'talent paid 50%, buyer charged it'],
        ['no_show_talent', 'Talent no-show', 'full refund + cancellation penalty'],
    ],
    damage: [
        ['damage_cap', 'Damage claim cap', 'the listed hold (€300)'],
        ['damage_photos', 'Damage photos', 'within 24 h of wrap'],
        ['deposit_release', 'Studio deposit auto-releases', '24 h after wrap'],
        ['damage_decided_by', 'Who decides a damage claim', 'Trust desk, never the host'],
    ],
    retention: [
        ['ret_id_docs', 'ID documents', 'never stored'],
        ['ret_verification', 'Verification result and date', '5 years'],
        ['ret_rushes', 'Rushes', '30 days'],
        ['ret_deliverables', 'Deliverables', '12 months'],
        ['ret_dispute_evidence', 'Dispute evidence', '3 years'],
        ['ret_ledger', 'Ledger and invoices', '10 years'],
    ],
};

/** The rule rows a talent agrees to at onboarding, grouped as the page shows them (R101). */
export const TALENT_AGREEMENT_RULES = [
    ['Requests and counters', ['answer_request', 'request_expires', 'answer_counter', 'counter_rounds']],
    ['If you cancel', ['talent_cancel_over7', 'talent_cancel_7d', 'talent_cancel_48h', 'talent_third_cancel']],
    ['On the day', ['shoot_proof', 'checkin_grace', 'no_show_talent', 'no_show_buyer']],
    ['If you host a studio', ['host_confirmation', 'damage_cap', 'damage_photos', 'deposit_release', 'damage_decided_by']],
    ['Getting paid', ['rate_standard', 'rate_pro', 'payout_delay_standard', 'payout_delay_pro', 'publish_ratings']],
];

/** Turns the compact table above into versioned rows: one initial version each. */
export function buildSeedRules(now = SEED_NOW) {
    const out = {};
    for (const [group, rows] of Object.entries(SEED_RULES)) {
        for (const [key, label, value] of rows) {
            out[key] = { key, group, label, versions: [{ value, at: now - 400 * DAY, by: 'system' }] };
        }
    }
    // One real history entry, so the audit log and the rules agree (screen 30).
    out.talent_cancel_7d.versions = [
        { value: '20% of payout, max €120', at: now - 400 * DAY, by: 'system' },
        { value: '20% of payout, max €150', at: now - 2 * DAY, by: 'marc' },
    ];
    return out;
}

export const SEED_PAYOUTS = [
    { id: 'po_8830', who: 'Nour Benali · bk_8830', amount: 718.90, state: 'approved', requestedBy: 'system' },
    { id: 'po_rive', who: 'Atelier Rive Sud · 4 bookings', amount: 2480.00, state: 'needs_check', requestedBy: 'finance' },
    { id: 'po_ines3', who: 'Inès Ferreira · seat 3', amount: 213.84, state: 'held', requestedBy: 'system' },
];

export const SEED_ESCROW = { held: 14206, frozen: 1840, dueFriday: 4318, bookings: 19 };

export const SEED_AUDIT = [
    { at: '14:21', who: 'Marc', text: 'granted L3 to Nour Benali' },
    { at: '13:58', who: 'Marc', text: 'split bk_8821 70/30, reason written' },
    { at: '09:00', who: 'System', text: 'auto-accepted bk_8802 after 5 days' },
    { at: 'Mon', who: 'Marc', text: 'changed talent cancellation cap €120 → €150' },
    { at: 'Mon', who: 'Marc', text: 'removed a phone number from a listing' },
];

export const SEED_USERS = [
    { id: 'usr_4471', name: 'Awa Cissé', kind: 'Talent', level: 'L1', status: 'ID check pending', bookings: 0 },
    { id: 'usr_4302', name: 'Nour Benali', kind: 'Talent', level: 'L2', status: 'Active', bookings: 39 },
    { id: 'usr_4290', name: 'Inès Ferreira', kind: 'Talent', level: 'L2', status: 'Active', bookings: 51 },
    { id: 'usr_4251', name: 'Atelier Rive Sud', kind: 'Host', level: 'Verified', status: 'Active', bookings: 112 },
    { id: 'usr_4188', name: 'Mathis Klein', kind: 'Buyer', level: 'Pro', status: 'Active', bookings: 6 },
];

/* ── Talent side (screens 12, 17, 18, 19, 21) ────────────────────────────── */

export const SEED_TALENT = {
    name: 'Inès Ferreira', initials: 'IF', plan: 'Pro', rate: 12,
    kpis: { earnedMonth: 1284, inEscrow: 427, seatsFunded: 2, firstPass: 86, seatsDelivered: 51, onTime: 98, lateNote: '1 late, Aug 2026' },
    running: [
        { id: 'run_noma', title: 'Noma serum · seat 3 of 3', sub: '2 videos · revision 2 delivered Monday', amount: 213.84, held: true, tags: [['Awaiting their review', 'amber'], ['Auto-accepts 16 Nov', 'grey']], bookingId: 'bk_8840' },
        { id: 'run_mellow', title: 'Mellow Tea · 3 hooks', sub: 'Product delivered Tue · first cut due Fri 14 Nov', amount: 213.84, cta: 'Upload cut', tags: [['Funded', 'green'], ['3 days left', 'amber'], ['Script approved', 'grey']], bookingId: 'bk_8851' },
    ],
    briefs: [
        { id: 'br_cream', title: 'Dry-skin body cream · 4 videos', match: 93, terms: '€210 per video · paid ads 3 months · ships Thursday · closes in 2 days', price: 210, buyout: false },
        { id: 'br_meal', title: 'Meal-kit unboxing · 2 videos', match: 81, terms: '€160 per video · organic only · invite from a repeat client', price: 160, buyout: false },
        { id: 'br_fitness', title: 'Fitness app · 6 videos', terms: '€120 per video with a perpetual buyout — below your floor for those terms.', price: 120, buyout: true, hiddenByRules: true },
    ],
    payout: { next: 427.68, date: 'Friday 14 Nov', speed: '2-day payout at Pro', gross: 1459, platform: -175, repeatDiscount: 38 },
    elite: [{ label: '30 seats delivered', value: '51', pct: 1 }, { label: 'Rating ≥ 4.9', value: '4.94', pct: 1 }, { label: 'Second certification', value: '1 of 2', pct: 0.5, amber: true }],
    rules: [['Floor per video', '€150'], ['Buyout floor', '€390'], ['Max seats at once', '3'], ["Won't shoot", 'Alcohol, gambling']],
    monthly: [{ m: 'JUN', v: 610 }, { m: 'JUL', v: 840 }, { m: 'AUG', v: 700 }, { m: 'SEP', v: 1010 }, { m: 'OCT', v: 920 }, { m: 'NOV', v: 1284 }],
    paperwork: [['October invoices', '4 PDF'], ['2026 earnings summary', 'JANUARY']],
};

export const SEED_JOB_REQUEST = {
    id: 'req_noma', title: 'Founder interview, two camera', when: 'Thu 19 Nov · 09:30–13:30', where: 'Atelier Rive Sud, Ivry',
    expiresInHours: 21, take: 718.90, rateNote: 'Your take after the 9% Pro rate. The buyer has already authorised the full amount.',
    facts: [['Distance', '8.1 km · 24 min'], ['Add-ons', '2nd camera, first cut'], ['Delivery', 'Cut in 48 h'], ['Buyer', '4.8 · 6 bookings']],
    note: 'Subject is camera-shy — allow time to warm up. French, warm and plain-spoken, no music bed.',
    conflict: 'You have a hold on the 19th from another client that never turned into a booking. Accepting this clears it.',
};

export const SEED_ON_SET = {
    title: 'Noma — founder interview', venue: 'Atelier Rive Sud', checkedIn: '09:04', wrap: '13:30', held: 718.90,
    shots: [
        { id: 's1', text: 'Why you started', done: true },
        { id: 's2', text: 'The moment it nearly stopped', done: true },
        { id: 's3', text: 'What the product does', done: false, now: true },
        { id: 's4', text: 'Who it is not for', done: false },
        { id: 's5', text: '3 vertical hooks to lens', done: false },
        { id: 's6', text: 'Product on the table, 3 angles', done: true },
        { id: 's7', text: 'Room tone, 30 seconds', done: true },
        { id: 's8', text: 'Founder walking in', done: true },
    ],
    upload: { done: 42, total: 61, gb: 18, eta: '~12 min' },
};

export const SEED_LISTING_DRAFT = {
    rows: [
        ['Headline', 'Camera and sound for interviews and podcast sets', 'DRAFTED'],
        ['Services', 'Half-day · full day · first cut', 'DRAFTED'],
        ['Rate', '€480 half-day', 'YOU SET'],
        ['Area', 'Paris + 40 km', 'YOU SET'],
        ['Tags', 'interview · multi-speaker · sound', 'EXPORTS'],
        ['Languages', 'FR · EN', 'EXPORTS'],
        ['Portfolio', '9 verified · 0 chosen', 'EXPORTS'],
        ['Availability', 'From your calendar', 'DRAFTED'],
    ],
    tags: ['two-camera interview · 9', 'multi-speaker · 4', 'lav + boom', 'FR · EN', 'slow cut rhythm', '16:9 → 9:16 derived'],
    searches: [['“two camera interview Paris”', 6], ['“podcast set with sound”', 5], ['“founder video, French”', 3]],
};

/** The booking each side can report against (screen 29). */
export const SEED_REPORTABLE = {
    buyer: { bookingId: 'bk_8821', amount: 995.40, counterparty: 'Nour', defaultWords: 'Half the interview has clipped audio on the lav. I cannot cut around it.' },
    talent: { bookingId: 'bk_8851', amount: 213.84, counterparty: 'the client', defaultWords: '' },
    host: { bookingId: 'bk_8870', deposit: 300, hoursLeft: 22 },
};
