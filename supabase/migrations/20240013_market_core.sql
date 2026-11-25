-- supabase/migrations/20240013_market_core.sql
--
-- VIBED Market on real data, phase 1 (R102): versioned rules, listings with
-- real coordinates, talent onboarding, an append-only audit log and a
-- geocoding cache. Money (Stripe Connect), bookings and disputes come later.
--
-- Every table is backend-only: RLS on, no policies. The API reads and writes
-- with the service role (routes/marketRoutes.js); the browser never touches
-- these tables directly.
--
-- Apply via the Supabase Dashboard → SQL Editor (see STAGING_SETUP.md).
-- Requires 20240012_market_roles.sql (profiles.market_role / is_admin).

/* ── Rules: a row per rule, an append-only history of values ─────────── */

create table if not exists public.market_rules (
    key        text primary key check (key ~ '^[a-z0-9_]{2,60}$'),
    rule_group text not null,
    label      text not null,
    position   int  not null default 0,
    created_at timestamptz not null default now()
);

create table if not exists public.market_rule_versions (
    id               bigint generated always as identity primary key,
    rule_key         text not null references public.market_rules(key) on delete cascade,
    value            text not null check (char_length(value) between 1 and 80),
    effective_at     timestamptz not null default now(),
    changed_by       uuid references auth.users(id) on delete set null,
    changed_by_label text not null default 'system'
);
create index if not exists market_rule_versions_key_at on public.market_rule_versions (rule_key, effective_at desc);

/* ── Listings ────────────────────────────────────────────────────────── */

create table if not exists public.market_listings (
    id                   uuid primary key default gen_random_uuid(),
    owner_id             uuid not null references auth.users(id) on delete cascade,
    category             text not null check (category in ('studio', 'operator', 'crew', 'sound')),
    title                text not null check (char_length(title) between 3 and 90),
    description          text not null default '' check (char_length(description) <= 2000),
    price_half_day_cents int  not null check (price_half_day_cents between 1000 and 1000000),
    price_full_day_cents int  check (price_full_day_cents is null or price_full_day_cents between 1000 and 2000000),
    -- The exact address and point stay private. The API publishes the exact
    -- point only for studios (a studio's address IS the product) and a
    -- ~1 km rounded point for people, who are often listing their home.
    address_label        text not null,
    postcode             text not null check (postcode ~ '^(75|77|78|91|92|93|94|95)[0-9]{3}$'),
    city                 text not null,
    lat                  double precision not null check (lat between 48.10 and 49.25),
    lng                  double precision not null check (lng between 1.40 and 3.60),
    travel_radius_km     int check (travel_radius_km is null or travel_radius_km between 0 and 200),
    features             text[] not null default '{}',
    status               text not null default 'draft' check (status in ('draft', 'live', 'paused')),
    published_at         timestamptz,
    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now()
);
create index if not exists market_listings_live_geo on public.market_listings (lat, lng) where status = 'live';
create index if not exists market_listings_owner on public.market_listings (owner_id);

create or replace function public.market_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists trg_market_listings_touch on public.market_listings;
create trigger trg_market_listings_touch before update on public.market_listings
    for each row execute function public.market_touch_updated_at();

/* Live listings near a point, nearest first. Bounding box first (indexed),
   then the great-circle distance. No PostGIS needed at this scale. */
create or replace function public.market_listings_near(
    p_lat double precision,
    p_lng double precision,
    p_radius_km double precision default 25,
    p_category text default null,
    p_max_half_day_cents int default null,
    p_limit int default 200
)
returns table (id uuid, distance_km double precision)
language sql stable
set search_path = public
as $$
    select l.id,
           6371 * 2 * asin(sqrt(
               power(sin(radians(l.lat - p_lat) / 2), 2)
               + cos(radians(p_lat)) * cos(radians(l.lat)) * power(sin(radians(l.lng - p_lng) / 2), 2)
           )) as distance_km
    from public.market_listings l
    where l.status = 'live'
      and l.lat between p_lat - p_radius_km / 111.0 and p_lat + p_radius_km / 111.0
      and l.lng between p_lng - p_radius_km / (111.0 * cos(radians(p_lat)))
                    and p_lng + p_radius_km / (111.0 * cos(radians(p_lat)))
      and (p_category is null or l.category = p_category)
      and (p_max_half_day_cents is null or l.price_half_day_cents <= p_max_half_day_cents)
    order by distance_km
    limit least(greatest(p_limit, 1), 500);
$$;

/* ── Talent onboarding ───────────────────────────────────────────────── */

create table if not exists public.market_onboarding (
    user_id              uuid primary key references auth.users(id) on delete cascade,
    -- Identity is verified by the payout provider (Stripe Connect KYC, phase 2).
    -- Only these three facts are ever kept; the document stays with the provider.
    kyc_result           text check (kyc_result is null or kyc_result in ('pass', 'fail', 'pending')),
    kyc_level            text,
    kyc_date             date,
    stripe_account_id    text unique,
    payouts_enabled      boolean not null default false,
    appearance_release_at timestamptz,
    hosts_locations      boolean,
    location_release_at  timestamptz,
    rules_accepted_at    timestamptz,
    updated_at           timestamptz not null default now(),
    check (location_release_at is null or hosts_locations is true)
);
drop trigger if exists trg_market_onboarding_touch on public.market_onboarding;
create trigger trg_market_onboarding_touch before update on public.market_onboarding
    for each row execute function public.market_touch_updated_at();

/* ── Audit log: append-only ──────────────────────────────────────────── */

create table if not exists public.market_audit_log (
    id          bigint generated always as identity primary key,
    at          timestamptz not null default now(),
    actor_id    uuid references auth.users(id) on delete set null,
    actor_label text not null,
    action      text not null,
    target      text,
    detail      jsonb not null default '{}'
);
create index if not exists market_audit_log_at on public.market_audit_log (at desc);

-- Append-only, enforced in the database: a reversal is a new row, never an edit.
create or replace function public.market_append_only()
returns trigger language plpgsql as $$
begin
    raise exception '% is append-only', tg_table_name using errcode = '42501';
end;
$$;
drop trigger if exists trg_market_audit_append_only on public.market_audit_log;
create trigger trg_market_audit_append_only before update or delete on public.market_audit_log
    for each row execute function public.market_append_only();
drop trigger if exists trg_market_rule_versions_append_only on public.market_rule_versions;
create trigger trg_market_rule_versions_append_only before update or delete on public.market_rule_versions
    for each row execute function public.market_append_only();

/* ── Geocoding cache (Photon results, Île-de-France only) ─────────────── */

create table if not exists public.market_geocode_cache (
    query      text primary key,
    results    jsonb not null,
    created_at timestamptz not null default now()
);

/* ── Backend-only access ─────────────────────────────────────────────── */

alter table public.market_rules         enable row level security;
alter table public.market_rule_versions enable row level security;
alter table public.market_listings      enable row level security;
alter table public.market_onboarding    enable row level security;
alter table public.market_audit_log     enable row level security;
alter table public.market_geocode_cache enable row level security;

revoke execute on function public.market_listings_near(double precision, double precision, double precision, text, int, int) from public, anon, authenticated;

/* ── Rules seed: the values settled in the market review (R101) ──────── */

insert into public.market_rules (key, rule_group, label, position) values
    ('answer_request', 'deadlines', 'Answer a booking request', 0),
    ('request_expires', 'deadlines', 'Request expires, whatever the counters', 1),
    ('request_reminder', 'deadlines', 'Reminder before it expires', 2),
    ('answer_counter', 'deadlines', 'Answer a counter-offer', 3),
    ('counter_rounds', 'deadlines', 'Counter rounds, per side', 4),
    ('review_rushes', 'deadlines', 'Review the rushes', 5),
    ('auto_accept_reminder', 'deadlines', 'Reminder before auto-accept', 6),
    ('settle_window', 'deadlines', 'Settle between the parties', 7),
    ('trust_decision', 'deadlines', 'Trust desk decision', 8),
    ('appeal_window', 'deadlines', 'Appeal window', 9),
    ('publish_ratings', 'deadlines', 'Publish ratings', 10),
    ('verify_buyer', 'verification', 'Buyer verification', 11),
    ('verify_talent', 'verification', 'Talent and host verification', 12),
    ('shoot_proof', 'verification', 'Proof the shoot happened', 13),
    ('host_confirmation', 'verification', 'Host confirmation', 14),
    ('fee_pro', 'money', 'Buyer service fee · Pro', 15),
    ('fee_enterprise', 'money', 'Buyer service fee · Enterprise', 16),
    ('rate_standard', 'money', 'Talent rate · standard', 17),
    ('rate_pro', 'money', 'Talent rate · Pro and Elite level', 18),
    ('rate_repeat', 'money', 'Talent rate · 4th job, same client', 19),
    ('ugc_take', 'money', 'UGC take on creator payments', 20),
    ('fee_split', 'money', 'Fee on a split decision', 21),
    ('payout_delay_standard', 'money', 'Payout delay · standard', 22),
    ('payout_delay_pro', 'money', 'Payout delay · Pro and Elite', 23),
    ('second_approval_above', 'money', 'Second approval above', 24),
    ('buyer_free_until', 'cancellation', 'Buyer cancels · free until', 25),
    ('buyer_7d_48h', 'cancellation', 'Buyer cancels · 7 days to 48 h', 26),
    ('buyer_inside_48h', 'cancellation', 'Buyer cancels · inside 48 h', 27),
    ('talent_share_kept', 'cancellation', 'Of what is kept, talent receives', 28),
    ('talent_cancel_over7', 'cancellation', 'Talent cancels · more than 7 days out', 29),
    ('talent_cancel_7d', 'cancellation', 'Talent cancels · inside 7 days', 30),
    ('talent_cancel_48h', 'cancellation', 'Talent cancels · inside 48 h', 31),
    ('talent_third_cancel', 'cancellation', 'Third talent cancellation in 12 months', 32),
    ('checkin_grace', 'cancellation', 'Check-in grace before a no-show', 33),
    ('no_show_buyer', 'cancellation', 'Buyer no-show', 34),
    ('no_show_talent', 'cancellation', 'Talent no-show', 35),
    ('damage_cap', 'damage', 'Damage claim cap', 36),
    ('damage_photos', 'damage', 'Damage photos', 37),
    ('deposit_release', 'damage', 'Studio deposit auto-releases', 38),
    ('damage_decided_by', 'damage', 'Who decides a damage claim', 39),
    ('ret_id_docs', 'retention', 'ID documents', 40),
    ('ret_verification', 'retention', 'Verification result and date', 41),
    ('ret_rushes', 'retention', 'Rushes', 42),
    ('ret_deliverables', 'retention', 'Deliverables', 43),
    ('ret_dispute_evidence', 'retention', 'Dispute evidence', 44),
    ('ret_ledger', 'retention', 'Ledger and invoices', 45)
on conflict (key) do update set rule_group = excluded.rule_group, label = excluded.label, position = excluded.position;

insert into public.market_rule_versions (rule_key, value, changed_by_label)
select v.key, v.value, 'system' from (values
    ('answer_request', '24 h'),
    ('request_expires', '24 h'),
    ('request_reminder', '18 h'),
    ('answer_counter', '12 h'),
    ('counter_rounds', '2'),
    ('review_rushes', '5 days'),
    ('auto_accept_reminder', 'day 4'),
    ('settle_window', '48 h'),
    ('trust_decision', '72 h'),
    ('appeal_window', '7 days'),
    ('publish_ratings', '14 days'),
    ('verify_buyer', 'email + valid card'),
    ('verify_talent', 'ID via provider'),
    ('shoot_proof', 'talent GPS check-in'),
    ('host_confirmation', 'optional, opens damage window'),
    ('fee_pro', '5%'),
    ('fee_enterprise', '0%'),
    ('rate_standard', '12%'),
    ('rate_pro', '9%'),
    ('rate_repeat', '6%'),
    ('ugc_take', '12%'),
    ('fee_split', 'waived'),
    ('payout_delay_standard', '7 days'),
    ('payout_delay_pro', '2 days'),
    ('second_approval_above', '€2,000'),
    ('buyer_free_until', '7 days before'),
    ('buyer_7d_48h', '50%'),
    ('buyer_inside_48h', '100%'),
    ('talent_share_kept', '80%'),
    ('talent_cancel_over7', 'reliability hit only'),
    ('talent_cancel_7d', '20% of payout, max €150'),
    ('talent_cancel_48h', '50% + level drop'),
    ('talent_third_cancel', 'suspension'),
    ('checkin_grace', '30 min'),
    ('no_show_buyer', 'talent paid 50%, buyer charged it'),
    ('no_show_talent', 'full refund + cancellation penalty'),
    ('damage_cap', 'the listed hold (€300)'),
    ('damage_photos', 'within 24 h of wrap'),
    ('deposit_release', '24 h after wrap'),
    ('damage_decided_by', 'Trust desk, never the host'),
    ('ret_id_docs', 'never stored'),
    ('ret_verification', '5 years'),
    ('ret_rushes', '30 days'),
    ('ret_deliverables', '12 months'),
    ('ret_dispute_evidence', '3 years'),
    ('ret_ledger', '10 years')
) as v(key, value)
where not exists (select 1 from public.market_rule_versions x where x.rule_key = v.key);
