// supabase/functions/send-email/index.ts
// Unified email dispatcher for all VIBED transactional emails.
// Deploy: supabase functions deploy send-email
//
// Sends via the Hostinger-hosted mailbox marc@vibedstudio.com (Hostinger Email
// API's mailbox Send endpoint) — swapped off Resend on 2026-09-18. Resend
// required per-sending-domain verification (DKIM/SPF) that was never
// completed for either viralpilot.fr or vibedstudio.com; Hostinger's send
// endpoint sends from a real, already-working mailbox, so there's no separate
// domain-verification step at all.
//
// Required environment variables (Supabase Dashboard → Edge Functions → Secrets):
//   HOSTINGER_MAIL_TOKEN — Hostinger API token scoped for the Email API
//                          (hPanel → API). NOT the same token as the Hostinger
//                          Reach MCP connector — generate one specifically here.
//   HOSTINGER_MAILBOX_ID — the mailbox's resourceId, from GET /api/v1/me.
//                          Currently AC1d579cf154577d17cf4a02bedd6a for
//                          marc@vibedstudio.com — used as the fallback default
//                          below so this keeps working even if the secret is
//                          never explicitly set, but re-verify it if the
//                          mailbox is ever recreated (resourceId changes).
//   FROM_DISPLAY_NAME    — optional, defaults to "Vibed". The mailbox address
//                          itself (marc@vibedstudio.com) is fixed by which
//                          mailbox HOSTINGER_MAILBOX_ID points at — this API
//                          has no separate "from" field to override it.
//   PUBLIC_URL           — https://www.viralpilot.fr (or your production domain)
//   LOGO_URL             — https://www.viralpilot.fr/logo.png (hosted PNG/SVG)
//
// Invocation body:
//   { "type": "welcome" | "plan" | "renewal" | "feature" | "weekly", "to": "user@email.com", "data": { ... } }
//
// Trigger sources:
//   welcome  — DB trigger trg_welcome_email on profiles INSERT (notify_welcome_email())
//   plan     — polarWebhook.js calls this after setPlan()
//   renewal  — polarWebhook.js calls this after a recurring Polar charge succeeds.
//              This case was MISSING from the previously-deployed version (v9) —
//              every renewal notification was silently failing with "Unknown
//              email type: renewal" (fire-and-forget call, so it never surfaced
//              as an error anywhere). Restored here while rewiring the sender.
//   feature  — admin POST to this function directly (see scripts/send-feature-email.js)
//   weekly   — send-weekly-digest function calls this per user (pg_cron, Mondays 08:00 UTC)

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { welcomeEmail, planEmail, featureEmail, weeklyEmail } from './templates.ts';

const HOSTINGER_MAIL_TOKEN = Deno.env.get('HOSTINGER_MAIL_TOKEN') ?? '';
const HOSTINGER_MAILBOX_ID = Deno.env.get('HOSTINGER_MAILBOX_ID') ?? 'AC1d579cf154577d17cf4a02bedd6a';
const DISPLAY_NAME          = Deno.env.get('FROM_DISPLAY_NAME') ?? 'Vibed';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (req.method === 'GET' && new URL(req.url).pathname.endsWith('/debug-key')) {
    return new Response(JSON.stringify({
      key_present:  !!HOSTINGER_MAIL_TOKEN,
      key_length:   HOSTINGER_MAIL_TOKEN.length,
      mailbox_id:   HOSTINGER_MAILBOX_ID,
      display_name: DISPLAY_NAME,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  try {
    const { type, to, data } = await req.json() as {
      type: 'welcome' | 'plan' | 'renewal' | 'feature' | 'weekly';
      to:   string;
      data: Record<string, unknown>;
    };

    if (!type || !to) {
      return new Response(JSON.stringify({ error: 'Missing type or to' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    let subject = '';
    let html    = '';

    switch (type) {
      case 'welcome': {
        subject = 'Welcome to Vibed — your studio is ready';
        html    = welcomeEmail(data as Parameters<typeof welcomeEmail>[0]);
        break;
      }
      case 'plan': {
        const planName = (data.plan_name as string) ?? 'Creator';
        subject = `Your ${planName} plan is live 🎬`;
        html    = planEmail(data as Parameters<typeof planEmail>[0]);
        break;
      }
      // Sent AFTER a successful recurring charge (Polar `order.created` on an
      // existing subscription). Reuses the plan template — same visual, but the
      // subject and the data the webhook passes describe a renewal, not a new
      // signup, so a returning customer is never told their plan "is live" as
      // if they had just subscribed.
      case 'renewal': {
        const planName = (data.plan_name as string) ?? 'Creator';
        subject = `Your ${planName} plan has renewed`;
        html    = planEmail(data as Parameters<typeof planEmail>[0]);
        break;
      }
      case 'feature': {
        const featureName = (data.feature_name as string) ?? 'New feature';
        subject = (data.subject_override as string) || `Just shipped: ${featureName}`;
        html    = featureEmail(data as Parameters<typeof featureEmail>[0]);
        break;
      }
      case 'weekly': {
        const weekDate = (data.week_date as string) ?? '';
        subject = `Your Vibed week in numbers — ${weekDate}`;
        html    = weeklyEmail(data as Parameters<typeof weeklyEmail>[0]);
        break;
      }
      default:
        return new Response(JSON.stringify({ error: `Unknown email type: ${type}` }), {
          status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
        });
    }

    const res = await fetch(
      `https://api.mail.hostinger.com/api/v1/mailboxes/${HOSTINGER_MAILBOX_ID}/send`,
      {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${HOSTINGER_MAIL_TOKEN}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          to: [to],
          subject,
          html,
          displayName: DISPLAY_NAME,
        }),
      }
    );

    // Hostinger's send endpoint returns 204 No Content on success — unlike
    // Resend, there's no response body and no message id to log or return.
    if (!res.ok) {
      let detail: unknown = null;
      try { detail = await res.json(); } catch { /* some error responses have no body */ }
      console.error('[send-email] Hostinger error:', res.status, detail);
      return new Response(JSON.stringify({ error: 'Failed to send email', detail }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[send-email] Sent ${type} to ${to} via Hostinger (status ${res.status})`);
    return new Response(JSON.stringify({ sent: true }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[send-email] Unexpected error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
