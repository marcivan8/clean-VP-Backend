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
//   EMAIL_FUNCTION_SECRET — optional shared secret accepted in the
//                          x-email-secret header, as an alternative to the
//                          service-role bearer token.
//
// Invocation body:
//   { "type": "welcome" | "plan" | "renewal" | "feature" | "weekly" | "deletion_warning",
//     "to": "user@email.com", "data": { ... } }
//
// Caller authentication (added 2026-10, RGPD round):
//   Every type requires a trusted caller: Authorization: Bearer <service role
//   key>, or x-email-secret: <EMAIL_FUNCTION_SECRET>. The anon key is public
//   (it ships in the web bundle), so before this change anyone could send any
//   email, with any subject and body, from marc@vibedstudio.com.
//   One exception keeps the welcome trigger working when it still uses the
//   anon key: an untrusted 'welcome' call must carry data.user_id, the user
//   must exist, have been created less than 30 minutes ago and own the
//   address in "to". The email content is then rebuilt here from the auth
//   record; nothing from the request body is rendered.
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
//   deletion_warning — backend retention job (services/retentionJob.js), at
//              least 24 hours before inactive projects are deleted.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  welcomeEmail, planEmail, featureEmail, weeklyEmail,
  deletionWarningEmail, deletionWarningSubject,
} from './templates.ts';

const HOSTINGER_MAIL_TOKEN  = Deno.env.get('HOSTINGER_MAIL_TOKEN') ?? '';
const HOSTINGER_MAILBOX_ID  = Deno.env.get('HOSTINGER_MAILBOX_ID') ?? 'AC1d579cf154577d17cf4a02bedd6a';
const DISPLAY_NAME          = Deno.env.get('FROM_DISPLAY_NAME') ?? 'Vibed';
const SUPABASE_URL          = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const EMAIL_FUNCTION_SECRET = Deno.env.get('EMAIL_FUNCTION_SECRET') ?? '';
const PUBLIC_URL            = Deno.env.get('PUBLIC_URL') ?? 'https://www.viralpilot.fr';

const WELCOME_WINDOW_MS = 30 * 60 * 1000;

type EmailType = 'welcome' | 'plan' | 'renewal' | 'feature' | 'weekly' | 'deletion_warning';

// Server-to-server only: no browser calls this function, so no CORS grant.
const JSON_HEADERS = { 'Content-Type': 'application/json' };

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

// Constant-time string comparison so the secret check does not leak timing.
function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function isTrustedCaller(req: Request): boolean {
  const auth = req.headers.get('authorization') ?? '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (SERVICE_ROLE_KEY && safeEqual(bearer, SERVICE_ROLE_KEY)) return true;
  const secret = req.headers.get('x-email-secret') ?? '';
  if (EMAIL_FUNCTION_SECRET && safeEqual(secret, EMAIL_FUNCTION_SECRET)) return true;
  return false;
}

// Untrusted welcome: verify the user and rebuild the data from the auth record.
async function verifiedWelcomeData(to: string, data: Record<string, unknown>) {
  const userId = typeof data?.user_id === 'string' ? data.user_id : '';
  if (!userId || !SUPABASE_URL || !SERVICE_ROLE_KEY) return null;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: res, error } = await admin.auth.admin.getUserById(userId);
  const user = res?.user;
  if (error || !user?.email) return null;
  if (user.email.toLowerCase() !== to.toLowerCase()) return null;
  const created = new Date(user.created_at).getTime();
  if (!Number.isFinite(created) || Date.now() - created > WELCOME_WINDOW_MS) return null;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const fullName = typeof meta.full_name === 'string' ? meta.full_name : '';
  return {
    user_id:         user.id,
    first_name:      (fullName.split(' ')[0] || user.email.split('@')[0]).slice(0, 60),
    cta_url:         `${PUBLIC_URL}/dashboard`,
    account_url:     `${PUBLIC_URL}/account`,
    unsubscribe_url: `${PUBLIC_URL}/unsubscribe?uid=${user.id}`,
  };
}

// Signed unsubscribe link, verified by POST /api/email/unsubscribe on the
// backend (services/unsubscribeToken.js computes the same HMAC).
async function unsubscribeUrl(uid: string): Promise<string> {
  const keyMaterial = EMAIL_FUNCTION_SECRET || SERVICE_ROLE_KEY;
  if (!keyMaterial || !uid) return `${PUBLIC_URL}/unsubscribe`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(keyMaterial), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`unsub:v1:${uid}`)));
  const sig = Array.from(mac).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${PUBLIC_URL}/unsubscribe?uid=${encodeURIComponent(uid)}&sig=${sig}`;
}

async function hasOptedOut(uid: string): Promise<boolean> {
  if (!uid || !SUPABASE_URL || !SERVICE_ROLE_KEY) return false;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await admin.from('profiles').select('email_opt_out').eq('id', uid).maybeSingle();
  if (error) return false; // column missing before migration 006: send as before
  return data?.email_opt_out === true;
}

serve(async (req: Request) => {
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);

  try {
    const payload = await req.json().catch(() => null) as {
      type?: EmailType; to?: string; data?: Record<string, unknown>;
    } | null;
    const type = payload?.type;
    const to   = typeof payload?.to === 'string' ? payload.to.trim() : '';
    let data   = (payload?.data && typeof payload.data === 'object') ? payload.data : {};

    if (!type || !to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return reply({ error: 'Missing or invalid type or to' }, 400);
    }

    if (!isTrustedCaller(req)) {
      if (type !== 'welcome') return reply({ error: 'Forbidden' }, 403);
      const rebuilt = await verifiedWelcomeData(to, data);
      if (!rebuilt) return reply({ error: 'Forbidden' }, 403);
      data = rebuilt;
    }

    // Digest and announcements: honour the opt-out and sign the unsubscribe
    // link. Service emails (welcome, plan, renewal, deletion_warning) are not
    // affected.
    if (type === 'weekly' || type === 'feature' || type === 'welcome') {
      const uid = typeof data.user_id === 'string' ? data.user_id : '';
      if (uid) {
        if (type !== 'welcome' && await hasOptedOut(uid)) {
          return reply({ sent: false, skipped: 'opted_out' });
        }
        data = { ...data, unsubscribe_url: await unsubscribeUrl(uid) };
      }
    }

    let subject = '';
    let html    = '';

    switch (type) {
      case 'welcome': {
        subject = 'Welcome to Vibed, your studio is ready';
        html    = welcomeEmail(data as Parameters<typeof welcomeEmail>[0]);
        break;
      }
      case 'plan': {
        const planName = (data.plan_name as string) ?? 'Creator';
        subject = `Your ${planName} plan is active`;
        html    = planEmail(data as Parameters<typeof planEmail>[0]);
        break;
      }
      // Sent AFTER a successful recurring charge (Polar `order.created` on an
      // existing subscription). Same template as 'plan', renewal subject.
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
        subject = `Your Vibed week in numbers, ${weekDate}`;
        html    = weeklyEmail(data as Parameters<typeof weeklyEmail>[0]);
        break;
      }
      case 'deletion_warning': {
        subject = deletionWarningSubject(data as { projects?: unknown[]; locale?: string });
        html    = deletionWarningEmail(data as Parameters<typeof deletionWarningEmail>[0]);
        break;
      }
      default:
        return reply({ error: `Unknown email type: ${type}` }, 400);
    }

    const res = await fetch(
      `https://api.mail.hostinger.com/api/v1/mailboxes/${HOSTINGER_MAILBOX_ID}/send`,
      {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${HOSTINGER_MAIL_TOKEN}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ to: [to], subject, html, displayName: DISPLAY_NAME }),
      }
    );

    // Hostinger's send endpoint returns 204 No Content on success.
    if (!res.ok) {
      let detail: unknown = null;
      try { detail = await res.json(); } catch { /* some error responses have no body */ }
      console.error('[send-email] Hostinger error:', res.status, detail);
      return reply({ error: 'Failed to send email' }, 502);
    }

    console.log(`[send-email] Sent ${type} (status ${res.status})`);
    return reply({ sent: true });

  } catch (err) {
    console.error('[send-email] Unexpected error:', err);
    return reply({ error: 'Internal error' }, 500);
  }
});
