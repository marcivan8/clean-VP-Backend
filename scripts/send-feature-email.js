// scripts/send-feature-email.js
//
// One-off sender for the "Editorial Brain" feature-announcement email, using
// the SAME send-email Supabase Edge Function this app already calls from
// routes/polarWebhook.js — see that file's sendEmail() helper for the pattern
// this is copied from. The edge function (supabase/functions/send-email/
// index.ts) already supports type:"feature" ("admin POST to this function
// directly" per its own header comment), so nothing needs to change there.
//
// This script does NOT run automatically. Review the RECIPIENTS list and the
// DATA payload below (same content as the HTML preview you were sent —
// keep them in sync if you edit either one), then run manually:
//
//   node scripts/send-feature-email.js            # sends to everyone below
//   node scripts/send-feature-email.js --dry-run   # logs payloads, sends nothing
//
// Requires SUPABASE_URL and SUPABASE_ANON_KEY in your environment (already in
// your .env). The edge function itself needs RESEND_API_KEY and FROM_EMAIL
// configured as Supabase Edge Function secrets — those are separate from your
// local .env and were presumably set already since 'welcome'/'plan' emails
// are live in production; worth a quick check in the Supabase dashboard
// (Edge Functions → send-email → Secrets) if a send comes back failed.

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;

// Users who have actually run at least one editing session, pulled from
// Supabase on 2026-08-20. Excludes mariojaris2@gmail.com (your own account)
// and accounts that never confirmed / never edited.
const RECIPIENTS = [
    'nelshybridepro@gmail.com',
    'stylemoya@skymail.ink',
    'www.amaiga180.am@gmail.com',
    '2683263305@qq.com',
    'randyabandaembolo@gmail.com',
    'axellesureau.pro@gmail.com',
    'saul09b@gmail.com',
    'emmanuelboulingui2016@gmail.com',
];

// None of these 8 profiles have a full_name on file, so first_name is a flat
// "there" for all of them — swap in real names here if you have them.
const DATA = {
    first_name: 'there',
    feature_name: 'Editorial Brain',
    feature_description:
        "Vibed now reads what you’re making — not just what you clicked — and tailors every suggestion to it.",
    benefits: [
        {
            title: 'Recognizes your format automatically',
            desc: "Podcast, vlog, tutorial, ad, or narrative — tell it what you're making, or let it recognize the format itself.",
        },
        {
            title: 'Suggestions built for how each format works',
            desc: 'Speaker-colored transcripts for interviews, pacing-aware cuts for talking-head, a stronger hook for ads.',
        },
        {
            title: 'Nothing to configure',
            desc: 'Open a project and Editorial Brain is already reading it — no settings to dig through first.',
        },
    ],
    cta_url: 'https://vibedstudio.com/dashboard',
    account_url: 'https://vibedstudio.com/account',
    // NOTE: this route doesn't exist yet in client/src/App.jsx's <Routes> —
    // there's no /unsubscribe page. Either add one before sending, or point
    // this at wherever unsubscribe actually gets handled today (a mailto?,
    // a support address?). Sending a marketing email with a dead unsubscribe
    // link is a real compliance problem (CAN-SPAM/GDPR), not just a nicety.
    unsubscribe_url: 'https://vibedstudio.com/unsubscribe',
};

async function sendFeatureEmail(to) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_ANON}`,
        },
        body: JSON.stringify({ type: 'feature', to, data: DATA }),
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');

    if (!SUPABASE_URL || !SUPABASE_ANON) {
        console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in the environment. Aborting.');
        process.exit(1);
    }

    console.log(`${dryRun ? '[DRY RUN] Would send' : 'Sending'} the "${DATA.feature_name}" email to ${RECIPIENTS.length} recipients:\n`);

    for (const to of RECIPIENTS) {
        if (dryRun) {
            console.log(`  [DRY RUN] ${to}`);
            continue;
        }
        try {
            const { ok, status, body } = await sendFeatureEmail(to);
            console.log(`  ${ok ? '✓' : '✗'} ${to} — ${status} ${JSON.stringify(body)}`);
        } catch (err) {
            console.log(`  ✗ ${to} — request failed: ${err.message}`);
        }
        // Small gap between sends so this doesn't slam Resend's rate limit.
        await new Promise((r) => setTimeout(r, 400));
    }

    console.log('\nDone.');
}

main();
