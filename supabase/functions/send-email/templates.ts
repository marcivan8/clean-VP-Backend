// supabase/functions/send-email/templates.ts
// VIBED brand email templates (welcome, plan, feature, weekly, deletion warning).
// Variables follow the {{snake_case}} convention from the design files.

const BASE_URL = Deno.env.get('PUBLIC_URL') || 'https://www.viralpilot.fr';
const LOGO_URL = Deno.env.get('LOGO_URL') || `${BASE_URL}/logo.png`;

// Escape values that come from user data (names, project titles) before they
// are placed in HTML.
export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function footer(accountUrl: string, unsubscribeUrl: string) {
  return `
    <tr><td style="background:#F4F1EC;padding:24px 40px;text-align:center;border-top:1px solid #E8E4DC;">
      <p style="font-family:'JetBrains Mono',monospace,'Courier New',monospace;font-size:10px;letter-spacing:.08em;color:#B0A99E;margin:0 0 7px;text-transform:uppercase;">Vibed &middot; Conversational Video Editing</p>
      <p style="font-size:11px;color:#B0A99E;margin:0;">
        <a href="${accountUrl}" style="color:#B0A99E;text-decoration:underline;">Account settings</a>
        &middot;
        <a href="${unsubscribeUrl}" style="color:#B0A99E;text-decoration:underline;">Unsubscribe</a>
      </p>
    </td></tr>`;
}

function header() {
  return `
    <tr><td style="background:#0A0A0B;padding:28px 40px;text-align:center;">
      <table cellpadding="0" cellspacing="0" border="0" align="center"><tr>
        <td style="padding-right:10px;"><img src="${LOGO_URL}" width="26" height="26" alt="Vibed" style="display:block;"></td>
        <td style="font-family:'Instrument Serif',Georgia,'Times New Roman',serif;font-size:23px;color:#FAFAFA;letter-spacing:-0.01em;vertical-align:middle;">Vibed</td>
      </tr></table>
    </td></tr>`;
}

function wrap(inner: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>@import url('https://fonts.bunny.net/css?family=instrument-serif:400,400i|jetbrains-mono:400,500&display=swap');</style>
</head>
<body style="margin:0;padding:0;background:#F0F0F4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F0F0F4;">
<tr><td align="center" style="padding:40px 20px;">
  <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;border-radius:10px;overflow:hidden;">
    ${inner}
  </table>
</td></tr></table>
</body></html>`;
}

// ── 1. WELCOME ────────────────────────────────────────────────────────────────
export function welcomeEmail(data: {
  first_name: string;
  cta_url?: string;
  account_url?: string;
  unsubscribe_url?: string;
}) {
  const ctaUrl       = data.cta_url       || BASE_URL;
  const accountUrl   = data.account_url   || `${BASE_URL}/account`;
  const unsubUrl     = data.unsubscribe_url || `${BASE_URL}/unsubscribe`;

  return wrap(`
    ${header()}
    <tr><td style="background:#0A0A0B;padding:8px 40px 48px;text-align:center;">
      <h1 style="font-family:'Instrument Serif',Georgia,'Times New Roman',serif;font-size:46px;color:#FAFAFA;margin:0 0 12px;letter-spacing:-0.02em;line-height:1.1;">Welcome to<br><em style="color:#00E5FF;">Vibed.</em></h1>
      <p style="color:rgba(250,250,250,0.55);font-size:15px;line-height:1.65;margin:0;">Conversational video editing is now yours.</p>
    </td></tr>
    <tr><td style="background:#FFFFFF;padding:40px;">
      <p style="font-size:16px;color:#16181B;line-height:1.8;margin:0 0 28px;">Hi <strong>${esc(data.first_name)}</strong>, your studio is ready. Edit video by describing what you want — no timeline scrubbing, no manual trimming. Just talk.</p>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-left:2px solid #00E5FF;margin:0 0 32px;">
        <tr><td style="padding:0 0 0 20px;">
          <p style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#00E5FF;margin:0 0 16px;">Get started in 3 steps</p>
          <p style="font-size:14px;font-weight:600;color:#16181B;margin:0 0 3px;">1 — Open a project</p>
          <p style="font-size:14px;color:#6B7280;margin:0 0 14px;line-height:1.55;">Drop in any video clip, paste a URL, or record directly from your browser.</p>
          <p style="font-size:14px;font-weight:600;color:#16181B;margin:0 0 3px;">2 — Describe your edit</p>
          <p style="font-size:14px;color:#6B7280;margin:0 0 14px;line-height:1.55;">"Cut the silence," "add captions," "trim to 60 seconds." Vibed handles the rest.</p>
          <p style="font-size:14px;font-weight:600;color:#16181B;margin:0 0 3px;">3 — Export</p>
          <p style="font-size:14px;color:#6B7280;margin:0;line-height:1.55;">Download publish-ready in any format.</p>
        </td></tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
        <a href="${ctaUrl}" style="display:inline-block;background:#0A0A0B;color:#00E5FF;font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:.12em;text-transform:uppercase;padding:15px 36px;border:1px solid #00E5FF;text-decoration:none;border-radius:4px;">Open Your Studio &#8594;</a>
      </td></tr></table>
    </td></tr>
    ${footer(accountUrl, unsubUrl)}
  `);
}

// ── 2. PLAN ACTIVATED ─────────────────────────────────────────────────────────
export function planEmail(data: {
  first_name: string;
  plan_name: string;         // 'Creator' | 'Pro'
  renewal_date: string;      // 'August 6, 2026'
  plan_price: string;        // '€15'
  cta_url?: string;
  account_url?: string;
  unsubscribe_url?: string;
}) {
  const ctaUrl     = data.cta_url       || BASE_URL;
  const accountUrl = data.account_url   || `${BASE_URL}/account`;
  const unsubUrl   = data.unsubscribe_url || `${BASE_URL}/unsubscribe`;

  const planFeatures: Record<string, { title: string; desc: string }[]> = {
    Creator: [
      { title: 'Unlimited AI edits',        desc: 'No monthly cap on silence removal, captions, or auto-cuts.' },
      { title: 'Up to 10 projects',         desc: 'Organise your work across multiple clients and campaigns.' },
      { title: 'Export to Premiere & DaVinci', desc: 'Export your timeline as a native project file.' },
      { title: '30-day project storage',    desc: 'Your projects stay safe for 30 days.' },
    ],
    Pro: [
      { title: 'Unlimited AI edits',        desc: 'No monthly cap — edit as much as you need.' },
      { title: 'Unlimited projects',        desc: 'No limit on project count.' },
      { title: 'Priority render queue',     desc: 'Your exports go first, every time.' },
      { title: 'Projects kept while subscribed', desc: 'No automatic deletion for as long as your plan is active.' },
    ],
  };

  const features = planFeatures[data.plan_name] ?? planFeatures['Creator'];

  return wrap(`
    ${header()}
    <tr><td style="background:#0A0A0B;padding:8px 40px 48px;text-align:center;">
      <p style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#8A2BE2;border:1px solid rgba(138,43,226,0.5);display:inline-block;padding:5px 14px;border-radius:3px;margin:0 0 16px;">Plan activated</p>
      <h1 style="font-family:'Instrument Serif',Georgia,'Times New Roman',serif;font-size:46px;color:#FAFAFA;margin:0 0 12px;letter-spacing:-0.02em;line-height:1.1;"><em style="color:#8A2BE2;">${data.plan_name}</em><br>is live.</h1>
      <p style="color:rgba(250,250,250,0.52);font-size:15px;line-height:1.65;margin:0;">Everything that comes with your plan, ready now.</p>
    </td></tr>
    <tr><td style="background:#FFFFFF;padding:40px;">
      <p style="font-size:16px;color:#16181B;line-height:1.8;margin:0 0 28px;">Hi <strong>${esc(data.first_name)}</strong>, your <strong>${data.plan_name}</strong> subscription is confirmed. Here's what you've unlocked:</p>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 32px;">
        ${features.map((f, i) => `
        <tr><td style="padding:12px 0;${i < features.length - 1 ? 'border-bottom:1px solid #F3F4F6;' : ''}">
          <table cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="color:#00E5FF;font-size:16px;padding-right:12px;vertical-align:top;padding-top:2px;">&#10003;</td>
            <td><p style="font-size:14px;font-weight:600;color:#16181B;margin:0 0 2px;">${f.title}</p><p style="font-size:13px;color:#6B7280;margin:0;">${f.desc}</p></td>
          </tr></table>
        </td></tr>`).join('')}
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;"><tr><td align="center">
        <a href="${ctaUrl}" style="display:inline-block;background:#0A0A0B;color:#8A2BE2;font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:.12em;text-transform:uppercase;padding:15px 36px;border:1px solid #8A2BE2;text-decoration:none;border-radius:4px;">Start Editing &#8594;</a>
      </td></tr></table>
      <p style="font-size:12px;color:#9CA3AF;text-align:center;margin:0;line-height:1.6;">Your ${data.plan_name} renews on <strong>${data.renewal_date}</strong> at <strong>${data.plan_price}/mo</strong>. <a href="${accountUrl}" style="color:#6B7280;">Manage billing &#8594;</a></p>
    </td></tr>
    ${footer(accountUrl, unsubUrl)}
  `);
}

// ── 3. FEATURE ANNOUNCEMENT ───────────────────────────────────────────────────
export function featureEmail(data: {
  first_name: string;
  feature_name: string;
  feature_description: string;
  benefits: { title: string; desc: string }[];   // 2-4 items
  cta_url?: string;
  account_url?: string;
  unsubscribe_url?: string;
}) {
  const ctaUrl     = data.cta_url       || BASE_URL;
  const accountUrl = data.account_url   || `${BASE_URL}/account`;
  const unsubUrl   = data.unsubscribe_url || `${BASE_URL}/unsubscribe`;

  return wrap(`
    ${header()}
    <tr><td style="background:#0A0A0B;padding:8px 40px 52px;text-align:center;">
      <table cellpadding="0" cellspacing="0" border="0" align="center" style="margin-bottom:20px;">
        <tr>
          <td style="width:7px;height:7px;border-radius:50%;background:#00E5FF;padding-right:8px;vertical-align:middle;"></td>
          <td style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#00E5FF;vertical-align:middle;">Just shipped</td>
        </tr>
      </table>
      <h1 style="font-family:'Instrument Serif',Georgia,'Times New Roman',serif;font-size:48px;color:#FAFAFA;margin:0 0 14px;letter-spacing:-0.02em;line-height:1.05;"><em>${data.feature_name}</em></h1>
      <p style="color:rgba(250,250,250,0.55);font-size:15px;line-height:1.65;margin:0 auto;max-width:440px;">${data.feature_description}</p>
    </td></tr>
    <tr><td style="background:#FFFFFF;padding:40px;">
      <p style="font-size:16px;color:#16181B;line-height:1.8;margin:0 0 28px;">Hi <strong>${esc(data.first_name)}</strong>, we just shipped something we think will change how you work. Here's what you can do with ${data.feature_name} starting today:</p>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 32px;">
        ${data.benefits.map((b, i) => `
        <tr><td style="padding:14px 0;${i < data.benefits.length - 1 ? 'border-bottom:1px solid #F3F4F6;' : ''}">
          <table cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="width:6px;height:6px;border-radius:50%;background:#00E5FF;padding-right:14px;vertical-align:top;padding-top:6px;"></td>
            <td><p style="font-size:14px;font-weight:600;color:#16181B;margin:0 0 3px;">${b.title}</p><p style="font-size:13px;color:#6B7280;margin:0;line-height:1.55;">${b.desc}</p></td>
          </tr></table>
        </td></tr>`).join('')}
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
        <a href="${ctaUrl}" style="display:inline-block;background:#0A0A0B;color:#00E5FF;font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:.12em;text-transform:uppercase;padding:15px 36px;border:1px solid #00E5FF;text-decoration:none;border-radius:4px;">Try ${data.feature_name} &#8594;</a>
      </td></tr></table>
    </td></tr>
    ${footer(accountUrl, unsubUrl)}
  `);
}

// ── 4. WEEKLY DIGEST ──────────────────────────────────────────────────────────
export function weeklyEmail(data: {
  first_name: string;
  week_date: string;          // 'June 30, 2026'
  clips_edited: number;
  time_saved: string;         // '2h 14m'
  last_project_name: string;
  last_edited_time: string;   // '3 hours'
  cta_url?: string;
  account_url?: string;
  unsubscribe_url?: string;
}) {
  const ctaUrl     = data.cta_url       || BASE_URL;
  const accountUrl = data.account_url   || `${BASE_URL}/account`;
  const unsubUrl   = data.unsubscribe_url || `${BASE_URL}/unsubscribe`;

  return wrap(`
    ${header()}
    <tr><td style="background:#0A0A0B;padding:8px 40px 48px;text-align:center;">
      <p style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:rgba(250,250,250,0.38);margin:0 0 10px;">Week of ${data.week_date}</p>
      <h1 style="font-family:'Instrument Serif',Georgia,'Times New Roman',serif;font-size:42px;color:#FAFAFA;margin:0 0 32px;letter-spacing:-0.02em;line-height:1.15;">Your week<br>in <em style="color:#00E5FF;">numbers.</em></h1>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td width="50%" style="padding:20px 24px;text-align:center;border-right:1px solid rgba(250,250,250,0.08);">
            <div style="font-family:'Instrument Serif',Georgia,serif;font-size:52px;color:#00E5FF;line-height:1;margin-bottom:8px;">${data.clips_edited}</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:rgba(250,250,250,0.42);">Clips edited</div>
          </td>
          <td width="50%" style="padding:20px 24px;text-align:center;">
            <div style="font-family:'Instrument Serif',Georgia,serif;font-size:52px;color:#8A2BE2;line-height:1;margin-bottom:8px;">${data.time_saved}</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:rgba(250,250,250,0.42);">Time saved</div>
          </td>
        </tr>
      </table>
    </td></tr>
    <tr><td style="background:#FFFFFF;padding:40px;">
      <p style="font-size:16px;color:#16181B;line-height:1.8;margin:0 0 24px;">Good week, <strong>${esc(data.first_name)}</strong>. You saved ${data.time_saved} that would have gone to manual trimming and captioning. Keep the momentum going.</p>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F9F9FB;border:1px solid #EBEBEF;border-radius:6px;margin:0 0 20px;">
        <tr><td style="padding:20px 24px;">
          <p style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#9CA3AF;margin:0 0 10px;">Pick up where you left off</p>
          <p style="font-size:15px;font-weight:600;color:#16181B;margin:0 0 4px;">${esc(data.last_project_name)}</p>
          <p style="font-size:13px;color:#6B7280;margin:0;">Last edited ${data.last_edited_time} ago &middot; <a href="${ctaUrl}" style="color:#00E5FF;text-decoration:none;">Continue &#8594;</a></p>
        </td></tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F9F9FB;border:1px solid #EBEBEF;border-radius:6px;margin:0 0 32px;">
        <tr><td style="padding:18px 24px;">
          <p style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#9CA3AF;margin:0 0 8px;">Tip of the week</p>
          <p style="font-size:14px;color:#374151;margin:0;line-height:1.65;">Say "remove all filler words" to clean up any interview in seconds — Vibed detects "um," "uh," and silence automatically.</p>
        </td></tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
        <a href="${ctaUrl}" style="display:inline-block;background:#0A0A0B;color:#00E5FF;font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:.12em;text-transform:uppercase;padding:15px 36px;border:1px solid #00E5FF;text-decoration:none;border-radius:4px;">Continue Editing &#8594;</a>
      </td></tr></table>
    </td></tr>
    ${footer(accountUrl, unsubUrl)}
  `);
}

// ── 5. PROJECT DELETION NOTICE ────────────────────────────────────────────────
// Service message sent by the backend retention job at least 24 hours before
// inactive projects are deleted. Plain and factual on purpose: no marketing,
// no unsubscribe link (it is a notice about the user's own data).
type DeletionLocale = 'fr' | 'en';

const DELETION_COPY: Record<DeletionLocale, {
  subject: (n: number) => string;
  eyebrow: string;
  title: string;
  greeting: (name: string) => string;
  intro: (n: number, days: number, date: string) => string;
  keep: string;
  cta: string;
  plan: string;
  footer: string;
}> = {
  en: {
    subject: (n) => n === 1 ? 'One of your Vibed projects will be deleted soon' : `${n} of your Vibed projects will be deleted soon`,
    eyebrow: 'Storage notice',
    title: 'Projects scheduled for deletion',
    greeting: (name) => name ? `Hello ${name},` : 'Hello,',
    intro: (n, days, date) => `${n === 1 ? 'The project below has' : 'The projects below have'} not been opened for ${days} days. Under the storage rules of your plan, ${n === 1 ? 'it' : 'they'} and the related media files will be permanently deleted on <strong>${date}</strong>.`,
    keep: 'To keep a project, open it in Vibed before that date. Any change resets the storage period.',
    cta: 'Open my projects',
    plan: 'Paid plans keep projects longer. Pro projects are kept for as long as the subscription is active.',
    footer: 'You receive this message because you have projects stored on Vibed. It is a one-time notice about your data, not a marketing email.',
  },
  fr: {
    subject: (n) => n === 1 ? 'Un de vos projets Vibed sera bientôt supprimé' : `${n} de vos projets Vibed seront bientôt supprimés`,
    eyebrow: 'Avis de stockage',
    title: 'Projets bientôt supprimés',
    greeting: (name) => name ? `Bonjour ${name},` : 'Bonjour,',
    intro: (n, days, date) => `${n === 1 ? "Le projet ci-dessous n'a pas été ouvert" : "Les projets ci-dessous n'ont pas été ouverts"} depuis ${days} jours. Conformément aux règles de conservation de votre offre, ${n === 1 ? 'il sera supprimé' : 'ils seront supprimés'} définitivement, avec les fichiers associés, le <strong>${date}</strong>.`,
    keep: "Pour conserver un projet, ouvrez-le dans Vibed avant cette date. Toute modification relance la durée de conservation.",
    cta: 'Ouvrir mes projets',
    plan: "Les offres payantes conservent les projets plus longtemps. Avec l'offre Pro, les projets sont conservés tant que l'abonnement est actif.",
    footer: "Vous recevez ce message car des projets sont stockés sur votre compte Vibed. Il s'agit d'un avis ponctuel concernant vos données, et non d'un e-mail commercial.",
  },
};

function formatDate(iso: string, locale: DeletionLocale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  return d.toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris',
  });
}

export function deletionWarningSubject(data: { projects?: unknown[]; locale?: string }) {
  const n = Array.isArray(data.projects) ? data.projects.length : 1;
  if (data.locale === 'en' || data.locale === 'fr') return DELETION_COPY[data.locale].subject(n);
  return `${DELETION_COPY.fr.subject(n)} / ${DELETION_COPY.en.subject(n)}`;
}

export function deletionWarningEmail(data: {
  first_name?: string;
  projects: { name: string }[];
  deletion_date: string;     // ISO timestamp
  inactive_days: number;     // 7 or 30
  locale?: string;           // 'fr' | 'en'; omitted → both languages
  cta_url?: string;
  account_url?: string;
}) {
  const ctaUrl     = data.cta_url     || `${BASE_URL}/dashboard`;
  const accountUrl = data.account_url || `${BASE_URL}/account`;
  const projects   = (Array.isArray(data.projects) ? data.projects : []).slice(0, 50);
  const n          = Math.max(1, projects.length);
  const locales: DeletionLocale[] = data.locale === 'en' ? ['en'] : data.locale === 'fr' ? ['fr'] : ['fr', 'en'];

  const list = projects.map((p) =>
    `<tr><td style="padding:9px 0;border-bottom:1px solid #F3F4F6;font-size:14px;color:#16181B;">${esc(p?.name || 'Untitled Project')}</td></tr>`
  ).join('');

  const section = (loc: DeletionLocale, first: boolean) => {
    const c = DELETION_COPY[loc];
    const date = formatDate(data.deletion_date, loc);
    return `
    <tr><td style="background:#FFFFFF;padding:${first ? '36px' : '8px'} 40px 36px;${first ? '' : 'border-top:1px solid #E8E4DC;'}">
      <p style="font-family:'JetBrains Mono',monospace,'Courier New',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#9CA3AF;margin:${first ? '0' : '28px'} 0 10px;">${c.eyebrow}</p>
      <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:normal;color:#16181B;margin:0 0 20px;line-height:1.25;">${c.title}</h1>
      <p style="font-size:15px;color:#16181B;line-height:1.7;margin:0 0 14px;">${c.greeting(esc(data.first_name || ''))}</p>
      <p style="font-size:15px;color:#374151;line-height:1.7;margin:0 0 18px;">${c.intro(n, Number(data.inactive_days) || 7, date)}</p>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;border-top:1px solid #F3F4F6;">${list}</table>
      <p style="font-size:15px;color:#374151;line-height:1.7;margin:0 0 24px;">${c.keep}</p>
      <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;"><tr><td>
        <a href="${ctaUrl}" style="display:inline-block;background:#0A0A0B;color:#FFFFFF;font-size:14px;padding:12px 24px;text-decoration:none;border-radius:4px;">${c.cta}</a>
      </td></tr></table>
      <p style="font-size:13px;color:#6B7280;line-height:1.6;margin:0 0 10px;">${c.plan}</p>
      <p style="font-size:12px;color:#9CA3AF;line-height:1.6;margin:0;">${c.footer}</p>
    </td></tr>`;
  };

  return wrap(`
    ${header()}
    ${locales.map((loc, i) => section(loc, i === 0)).join('')}
    <tr><td style="background:#F4F1EC;padding:20px 40px;text-align:center;border-top:1px solid #E8E4DC;">
      <p style="font-size:11px;color:#B0A99E;margin:0;"><a href="${accountUrl}" style="color:#B0A99E;text-decoration:underline;">Account settings / Paramètres du compte</a></p>
    </td></tr>
  `);
}
