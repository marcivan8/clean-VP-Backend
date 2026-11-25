-- supabase/migrations/20240011_stripe_billing.sql
--
-- Stripe billing identifiers on `profiles`, for routes/stripeWebhook.js.
--
-- `subscription_status` and `plan_expires_at` already exist (migrations/
-- 002_usage_gates.sql and 003_projects.sql) and are reused unchanged, so this
-- only adds the two Stripe ids.
--
-- The Polar columns (polar_customer_id / polar_subscription_id) are deliberately
-- NOT dropped. They were populated on 0 of 45 production rows and nothing reads
-- them any more, but dropping a column is irreversible and buys nothing here.
--
-- Apply via the Supabase Dashboard → SQL Editor (this project has no CLI or
-- direct DB connection — see STAGING_SETUP.md).

alter table public.profiles
    add column if not exists stripe_customer_id     text,
    add column if not exists stripe_subscription_id text;

-- One Stripe customer maps to exactly one profile.
--
-- This is load-bearing, not hygiene: resolveUser() in routes/stripeWebhook.js
-- reads the customer id with .maybeSingle(), which ERRORS when more than one row
-- matches. Without the constraint, a duplicated customer id would make every
-- webhook for that customer fail to resolve a user — and the handler logs and
-- acknowledges rather than retrying, so the plan would silently never update.
create unique index if not exists profiles_stripe_customer_id_key
    on public.profiles (stripe_customer_id)
    where stripe_customer_id is not null;

create index if not exists profiles_stripe_subscription_id_idx
    on public.profiles (stripe_subscription_id)
    where stripe_subscription_id is not null;

comment on column public.profiles.stripe_customer_id is
    'Stripe Customer id. Written by routes/stripeWebhook.js (checkout + webhook) and used to resolve a webhook back to a user without depending on email, which a customer can change in the billing portal.';
comment on column public.profiles.stripe_subscription_id is
    'Most recent Stripe Subscription id. Recorded for support/debugging; subscription state is always read live from Stripe, never from this column.';
