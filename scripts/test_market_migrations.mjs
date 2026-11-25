// scripts/test_market_migrations.mjs — R102: the market migrations, run on a REAL
// Postgres (PGlite, Postgres compiled to WebAssembly) rather than read as text.
//
// Applies 20240012 + 20240013 onto a minimal Supabase-shaped database (auth.users,
// profiles, the anon/authenticated/service_role roles), twice (idempotent), then
// exercises what the API relies on: the profile privilege guard per role, the
// Île-de-France limits, the distance search, append-only history, RLS.
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗', msg); } };
const refuses = async (fn) => { try { await fn(); return false; } catch { return true; } };

const db = new PGlite();
const q = (sql) => db.exec(sql);
const rows = async (sql, p) => (await db.query(sql, p)).rows;
const mig = (f) => fs.readFileSync(path.join(root, 'supabase/migrations', f), 'utf8');

await q(`
  create schema auth;
  create table auth.users (id uuid primary key);
  create role anon; create role authenticated; create role service_role;
  create table public.profiles (
    id uuid primary key, email text, plan text, plan_expires_at timestamptz, subscription_tier text,
    subscription_status text, tier_expires_at timestamptz, paddle_subscription_id text,
    polar_customer_id text, polar_subscription_id text, stripe_customer_id text, stripe_subscription_id text,
    monthly_usage int, usage_reset_at timestamptz, email_opt_out boolean, usage_data jsonb);
  grant usage on schema public to anon, authenticated, service_role;
  grant select, update on public.profiles to authenticated, service_role;
`);

console.log('\n§1 migrations apply, and re-apply cleanly');
const files = ['20240012_market_roles.sql', '20240013_market_core.sql'];
ok(!(await refuses(async () => { for (const f of files) await q(mig(f)); })), 'both apply on a Supabase-shaped database');
ok(!(await refuses(async () => { for (const f of files) await q(mig(f)); })), 're-applying is safe (idempotent)');
const seed = await import(path.join(root, 'client/src/market/marketOpsSeed.js'));
const expected = Object.values(seed.SEED_RULES).reduce((n, list) => n + list.length, 0);
const [{ n: ruleCount }] = await rows('select count(*)::int n from market_rules');
const [{ n: verCount }] = await rows('select count(*)::int n from market_rule_versions');
ok(ruleCount === expected && verCount === expected, `every rule is seeded once, with one version (${ruleCount})`);
const [{ value: ratings }] = await rows(`select value from market_rule_versions where rule_key = 'publish_ratings'`);
ok(ratings === '14 days', 'seeded values are the settled ones (ratings publish after 14 days)');

console.log('\n§2 the browser cannot grant itself anything (profiles guard, R100)');
const u = '11111111-1111-1111-1111-111111111111';
await q(`insert into auth.users values ('${u}'); insert into profiles (id, plan) values ('${u}', 'free');`);
await q('set role authenticated');
ok(await refuses(() => q(`update profiles set plan = 'pro' where id = '${u}'`)), 'browser cannot change its own plan');
ok(await refuses(() => q(`update profiles set is_admin = true where id = '${u}'`)), 'browser cannot make itself admin');
ok(await refuses(() => q(`update profiles set market_role = 'buyer' where id = '${u}'`)), 'browser cannot pick its market role directly');
ok(!(await refuses(() => q(`update profiles set usage_data = '{"x":1}' where id = '${u}'`))), 'browser can still write usage_data');
await q('reset role; set role service_role');
ok(!(await refuses(() => q(`update profiles set market_role = 'talent' where id = '${u}'`))), 'the server can set the market role');
await q('reset role');
ok(await refuses(() => q(`update profiles set market_role = 'admin' where id = '${u}'`)), 'market_role is buyer or talent only');

console.log('\n§3 listings: Île-de-France only, nearest first');
const add = (title, category, lat, lng, status = 'live', postcode = '75011') => rows(
    `insert into market_listings (owner_id, category, title, price_half_day_cents, address_label, postcode, city, lat, lng, status)
     values ($1, $2, $3, 40000, 'x', $4, 'Paris', $5, $6, $7) returning id`, [u, category, title, postcode, lat, lng, status]);
await add('Studio Bastille', 'studio', 48.853, 2.369);
await add('Operator Montreuil', 'operator', 48.861, 2.443);
await add('Draft studio', 'studio', 48.85, 2.35, 'draft');
await add('Meaux studio', 'studio', 48.96, 2.88, 'live', '77100');
const near = await rows(`select l.title, n.distance_km from market_listings_near(48.8566, 2.3522, 10) n join market_listings l on l.id = n.id`);
ok(near.length === 2 && near[0].title === 'Studio Bastille' && near[1].title === 'Operator Montreuil', 'within 10 km of central Paris: live listings only, nearest first');
ok(Math.abs(near[0].distance_km - 1.29) < 0.05 && Math.abs(near[1].distance_km - 6.66) < 0.05, `distances are real great-circle km (${near[0].distance_km.toFixed(2)}, ${near[1].distance_km.toFixed(2)})`);
ok((await rows(`select * from market_listings_near(48.8566, 2.3522, 60, 'studio')`)).length === 2, 'category filter + wider radius reaches Meaux, still skips the draft');
ok((await rows(`select * from market_listings_near(48.8566, 2.3522, 60, null, 30000)`)).length === 0, 'price ceiling filters out a €400 half-day');
ok(await refuses(() => add('Lyon', 'studio', 45.76, 4.83, 'live', '69001')), 'a point outside Île-de-France is refused');
ok(await refuses(() => add('Wrong postcode', 'studio', 48.85, 2.35, 'live', '69001')), 'a non-Île-de-France postcode is refused');
ok(await refuses(() => add('x', 'studio', 48.85, 2.35)), 'a title under 3 characters is refused');

console.log('\n§4 history is append-only, onboarding is consistent');
ok(await refuses(() => q(`update market_rule_versions set value = 'x' where rule_key = 'trust_decision'`)), 'a rule version cannot be edited');
ok(await refuses(() => q(`delete from market_rule_versions`)), 'nor deleted');
await q(`insert into market_audit_log (actor_label, action) values ('Marc', 'test')`);
ok(await refuses(() => q('update market_audit_log set action = \'x\'')) && await refuses(() => q('delete from market_audit_log')), 'the audit log cannot be edited or deleted');
ok(await refuses(() => q(`insert into market_onboarding (user_id, hosts_locations, location_release_at) values ('${u}', false, now())`)), 'a location release requires hosting a place');

console.log('\n§5 the browser cannot read market tables directly (RLS, no policies)');
await q('grant select on market_listings, market_onboarding to authenticated; set role authenticated');
ok((await rows('select count(*)::int n from market_listings'))[0].n === 0, 'listings are invisible to a direct browser query');
ok(await refuses(() => q(`select * from market_listings_near(48.85, 2.35, 10)`)), 'the search function is not callable by the browser');
await q('reset role');

await db.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
