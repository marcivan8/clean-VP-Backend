-- migrations/002_usage_gates.sql
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query).

-- 1. Add plan tracking to profiles
alter table public.profiles
    add column if not exists plan text not null default 'free'
        check (plan in ('free', 'creator', 'pro')),
    add column if not exists plan_expires_at timestamptz;

-- 2. Usage event log — one row per billable AI operation
create table if not exists public.usage_events (
    id         uuid        primary key default gen_random_uuid(),
    user_id    uuid        not null references auth.users(id) on delete cascade,
    operation  text        not null,
    created_at timestamptz not null default now()
);

create index if not exists usage_events_user_month_idx
    on public.usage_events (user_id, created_at desc);

-- 3. RLS — users can read their own events; the service role inserts
alter table public.usage_events enable row level security;

create policy "usage_events: own rows read"
    on public.usage_events for select
    using (auth.uid() = user_id);

-- To manually upgrade a user to creator or pro:
-- update public.profiles set plan = 'creator' where id = '<user-uuid>';
-- update public.profiles set plan = 'pro'     where id = '<user-uuid>';
