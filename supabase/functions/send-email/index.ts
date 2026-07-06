// supabase/functions/send-email/index.ts
// Unified email dispatcher for all VIBED transactional emails.
// Deploy: supabase functions deploy send-email
//
// Required environment variables (Supabase Dashboard → Edge Functions → Secrets):
//   RESEND_API_KEY  — from resend.com (free: 3 000 emails/month)
//   PUBLIC_URL      — https://www.viralpilot.fr (or your production domain)
//   LOGO_URL        — https://www.viralpilot.fr/logo.png (hosted PNG/SVG)
//   FROM_EMAIL      — Vibed <hello@viralpilot.fr>
//
// Invocation body:
//   { "type": "welcome" | "plan" | "feature" | "weekly", "to": "user@email.com", "data": { ... } }
//
// Trigger sources:
//   welcome  — Supabase DB webhook on profiles INSERT
//   plan     — polarWebhook.js calls this after setPlan()
//   feature  — admin POST to this function directly
//   weekly   — send-weekly-digest function calls this per user

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { welcomeEmail, planEmail, featureEmail, weeklyEmail } from './templates.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_EMAIL     = Deno.env.get('FROM_EMAIL') ?? 'Vibed <hello@viralpilot.fr>';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { type, to, data } = await req.json() as {
      type: 'welcome' | 'plan' | 'feature' | 'weekly';
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
      case 'feature': {
        const featureName = (data.feature_name as string) ?? 'New feature';
        subject = `Just shipped: ${featureName}`;
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

    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
    });

    const result = await res.json();

    if (!res.ok) {
      console.error('[send-email] Resend error:', result);
      return new Response(JSON.stringify({ error: 'Failed to send email', detail: result }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[send-email] Sent ${type} to ${to} — id: ${result.id}`);
    return new Response(JSON.stringify({ sent: true, id: result.id }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[send-email] Unexpected error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
