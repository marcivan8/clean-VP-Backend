// scripts/test_legal_pages.mjs — R103: the legal pages say who publishes the
// service and what it really does, in both languages, with nothing left as a
// raw {{placeholder}} and no figure that disagrees with the product.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const client = path.join(root, 'client');
const requireClient = createRequire(path.join(client, 'package.json'));
const i18next = requireClient('i18next');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗', msg); } };

const { LEGAL, legalValues } = await import(pathToFileURL(path.join(client, 'src/legal/legalInfo.js')).href);
const NS = ['privacy', 'terms', 'legal', 'cookies', 'data', 'gdpr'];
const load = (l, n) => JSON.parse(read(`client/src/locales/${l}/${n}.json`));
await i18next.init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } });
const render = (v, vals, l) => (typeof v === 'string' ? i18next.services.interpolator.interpolate(v, vals, l, {})
    : Array.isArray(v) ? v.map((x) => render(x, vals, l))
        : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, render(x, vals, l)])) : v);
const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
const pages = {};
for (const l of ['en', 'fr']) for (const n of NS) pages[`${l}/${n}`] = JSON.stringify(render(load(l, n), legalValues(l), l));

console.log('\n§1 every page renders, in both languages, with the same structure');
for (const n of NS) {
    const en = new Set(keys(load('en', n))), fr = new Set(keys(load('fr', n)));
    ok([...en].every((k) => fr.has(k)) && [...fr].every((k) => en.has(k)), `${n}: English and French have the same keys`);
}
const leftovers = Object.entries(pages).flatMap(([p, t]) => [...t.matchAll(/\{\{[^}]*\}\}/g)].map((m) => `${p} ${m[0]}`));
ok(leftovers.length === 0, leftovers.length ? `unresolved: ${leftovers.slice(0, 5).join(', ')}` : 'no raw {{placeholder}} reaches a page');

console.log('\n§2 the publisher is identified as the law requires (LCEN art. 6-III)');
const sirenNum = Number(LEGAL.siret.replace(/\s/g, '').slice(0, 9));
let luhn = 0;
LEGAL.siret.replace(/\s/g, '').split('').reverse().forEach((d, i) => { let x = Number(d); if (i % 2) { x *= 2; if (x > 9) x -= 9; } luhn += x; });
ok(luhn % 10 === 0, `SIRET ${LEGAL.siret} passes its checksum`);
const vatKey = String((12 + 3 * (sirenNum % 97)) % 97).padStart(2, '0');
ok(LEGAL.vatNumber === `FR${vatKey}${sirenNum}`, `the VAT number is the one the SIREN produces (FR${vatKey}${sirenNum})`);
for (const l of ['en', 'fr']) {
    const defs = load(l, 'legal').sections[0].blocks[0].defs.map((d) => d.desc).join(' ');
    ok(['{{ownerName}}', '{{companyForm}}', '{{shareCapital}}', '{{rcs}}', '{{headOffice}}', '{{address}}', '{{siret}}', '{{vatNumber}}', '{{email}}', '{{phone}}', '{{publicationDirector}}', '{{website}}'].every((p) => defs.includes(p)),
        `${l}: name, legal form, capital, RCS, head office, establishment, SIRET, VAT, email, phone, director, website are all on the legal notice`);
    ok(!/legal entity|personne morale/i.test(load(l, 'legal').sections[0].blocks[0].defs.find((d) => d.desc.includes('publicationDirector')).desc), `${l}: the publication director line does not describe a company`);
}
for (const l of ['en', 'fr']) {
    const d = legalValues(l).publicationDirector;
    ok(!/^(CIJE|VIBED)|personne morale|legal entity/i.test(d) && (/^[A-ZÀ-Ý][a-zà-ÿ]+ [A-ZÀ-Ý]/.test(d) || /compléter|completed/.test(d)), `${l}: the publication director is a named person ("${d}")`);
}
ok(/^822 297 560 R\.C\.S\. /.test(legalValues('fr').rcs) && legalValues('fr').rcs.includes(LEGAL.siret.slice(0, 11)), 'the RCS number is the SIREN of the SIRET');
ok(/6 route de Ville la Chapelle, 20200 Bastia/.test(legalValues('fr').headOffice), 'the head office is the Bastia address from the Kbis');
for (const l of ['en', 'fr']) {
    const t = pages[`${l}/legal`] + pages[`${l}/privacy`] + pages[`${l}/terms`] + pages[`${l}/gdpr`];
    ok(!/compléter|to be completed|pending/i.test(t), `${l}: no "to be completed" placeholder text on any page (empty values are hidden, not announced)`);
}
for (const [key, n] of [['phone', 'legal'], ['hostPhone', 'legal'], ['phone', 'privacy'], ['phone', 'gdpr']]) {
    for (const l of ['en', 'fr']) {
        const hit = JSON.stringify(load(l, n)).match(new RegExp(`\\{"term":"[^"]*","desc":"\\{\\{${key}\\}\\}"(,"requires":"${key}")?\\}`, 'g')) || [];
        ok(hit.length > 0 && hit.every((h) => h.includes('requires')), `${l}/${n}: the ${key} line is hidden while ${key} is empty`);
    }
}
ok(load('en', 'terms').sections[14].blocks.some((b) => b && b.requires === 'mediator') && load('fr', 'terms').sections[14].blocks.some((b) => b && b.requires === 'mediator'), 'the mediator sentence only shows once a mediator is named');
ok(/typeof block\.text === 'string'/.test(read('client/src/legal/LegalDocument.jsx')), 'LegalDocument renders a switchable {text, requires} paragraph');
ok(legalValues('fr').headOffice !== legalValues('fr').address, 'the head office (Bastia registry) is not presented as the Paris establishment');
ok(!/Owner|Creator|Propriétaire|Créateur/.test(JSON.stringify(load('en', 'legal').sections[0]) + JSON.stringify(load('fr', 'legal').sections[0])), 'a brand is not presented as owner or creator');
for (const [p, t] of Object.entries(pages)) {
    if (/Pasteur|Kremlin|entrepreneur individuel|sole trader|registration in progress|en cours d'immatriculation|Iubenda|\bPolar\b/i.test(t)) ok(false, `${p} still carries the old identity or an old provider`);
}
ok(true, 'no old identity (EI, Kremlin-Bicêtre), Iubenda or Polar on any page');

console.log('\n§3 the processors listed are the ones the code actually uses');
for (const l of ['en', 'fr']) {
    const rows = load(l, 'privacy').sections[4].blocks[1].table.rows.map((r) => r[0]).join(' | ');
    ok(!/AWS|Lambda/.test(rows), `${l}: no AWS Lambda (the Revideo export was removed, R56)`);
    for (const name of ['Supabase', 'Google Cloud', 'Railway', 'AssemblyAI', 'Groq', 'OpenAI', 'Gemini', 'Sentry', 'PostHog', 'Bunny', 'Stripe', 'YouTube', 'Instagram', 'TikTok', 'Pexels', 'Vecteezy', 'jsDelivr']) {
        if (!rows.includes(name)) ok(false, `${l}: processor table is missing ${name}`);
    }
    ok(true, `${l}: every integration in the code is listed (incl. TikTok, stock search, in-browser model files)`);
}
ok(/open\.tiktokapis\.com/.test(read('services/social/providers.js')), 'TikTok is a real integration in the code (so it must stay listed)');
ok(!fs.readdirSync(path.join(root, 'routes')).some((f) => /revideoRender/i.test(f)) && !/LambdaClient|InvokeCommand/.test(read('index.js')), 'and nothing calls AWS Lambda any more');
for (const l of ['en', 'fr']) {
    const stripe = load(l, 'privacy').sections[4].blocks[1].table.rows.find((r) => r[0] === 'Stripe');
    ok(/Stripe Payments Europe/.test(stripe[2]), `${l}: Stripe's contracting entity is named`);
}

console.log('\n§4 prices and product claims agree with the product');
ok(LEGAL.prices.creator.en === '€19' && LEGAL.prices.pro.en === '€39', 'legal prices are the live Stripe prices (€19 / €39, R99)');
const planLimits = read('client/src/lib/planLimits.js');
ok(!/PLAN_PRICES\s*=/.test(planLimits) && /LEGAL\.prices\[plan\]/.test(planLimits), 'the upgrade sheet price comes from the same single source (it said €15 / €35)');
ok(/planPrice\(target, i18n\.language\)/.test(read('client/src/components/PlanSheet.jsx')), 'PlanSheet shows that price in the reader\'s language');
ok(/LEGAL\.prices\[meta\.key\]\[language\]/.test(read('client/src/pages/landing/Closing.jsx')), 'the landing pricing reads the same values');
for (const l of ['en', 'fr']) {
    const t = JSON.stringify(load(l, 'landing')) + Object.entries(pages).filter(([p]) => p.startsWith(l)).map(([, x]) => x).join('');
    ok(!/marketplace|vibed market|escrow|séquestre|book a shoot|become talent|devenir talent/i.test(t), `${l}: no word of the hidden market on the landing or legal pages (R102)`);
    ok(!/€15\b|€35\b|\b15 €|\b35 €/.test(t), `${l}: no old price anywhere`);
}
ok(/TikTok/.test(JSON.stringify(load('en', 'terms'))) && /TikTok/.test(JSON.stringify(load('fr', 'terms'))), 'the terms describe social publishing including TikTok where available');

console.log('\n§5 the footer reaches every legal page');
const home = read('client/src/pages/HomePage.jsx');
const app = read('client/src/App.jsx');
for (const p of ['/terms', '/privacy', '/cookie-policy', '/data', '/gdpr', '/legal']) {
    ok(home.includes(`href: '${p}'`) && app.includes(`path="${p}"`), `${p} is linked from the footer and routed`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
