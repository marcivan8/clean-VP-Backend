-- migrations/009_social_accounts.sql
-- Run once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
--
-- R149: connected destinations. A user links a TikTok / Instagram / YouTube
-- account once, and later publishes a finished short to it without leaving
-- the app.
--
-- The tokens in this table are credentials for someone else's account, so
-- the design point is that the CLIENT CAN NEVER READ THIS TABLE. RLS is on
-- and there are deliberately NO policies for anon or authenticated, which
-- means those roles see zero rows no matter what query they send. The app
-- reads connected accounts through GET /api/social/accounts, which returns
-- the handle and status and never a token.
--
-- Tokens are additionally encrypted at rest (services/social/tokenCrypto.js),
-- so a leaked database dump is not a set of working credentials.

create table if not exists public.social_accounts (
    id            uuid        primary key default gen_random_uuid(),
    user_id       uuid        not null references auth.users(id) on delete cascade,
    -- Validated against services/social/providers.js rather than a check
    -- constraint here, so adding a destination stays config and not a
    -- migration. The route refuses anything not in that registry.
    provider      text        not null,
    -- The account on the provider's side: its id, and whatever it calls a
    -- handle. Shown in the UI so a user can tell two accounts apart.
    external_id   text,
    handle        text,
    scopes        text,
    -- Encrypted. See tokenCrypto.js for the envelope format.
    access_token  text,
    refresh_token text,
    expires_at    timestamptz,
    connected_at  timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    -- Reconnecting the same provider updates the row rather than piling up
    -- stale credentials.
    unique (user_id, provider)
);

create index if not exists social_accounts_user_idx
    on public.social_accounts (user_id);

alter table public.social_accounts enable row level security;

-- Intentionally no policies, AND no grant. Both matter.
--
-- RLS with no policies already yields zero rows to anon and authenticated.
-- But Supabase grants the public schema's tables to those roles by default,
-- so that protection was one well meaning "create policy ... using
-- (auth.uid() = user_id)" away from publishing OAuth tokens to the browser.
-- Taking the privilege away entirely means such a policy would change
-- nothing. A column level revoke does NOT work here: Postgres cannot cut back
-- a table level grant with one, and has_column_privilege keeps returning true.
revoke all on public.social_accounts from anon, authenticated;
