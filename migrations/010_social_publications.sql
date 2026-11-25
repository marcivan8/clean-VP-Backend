-- R160: scheduled social posts and their app-visible reminder state.
-- Tokens remain in social_accounts; this table contains only user content and
-- publication metadata. No browser grants: all access is through auth routes.
create table if not exists public.social_publications (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    provider text not null check (provider in ('youtube', 'instagram')),
    source_short_id text,
    media_url text not null,
    title text not null default '',
    caption text not null default '',
    scheduled_at timestamptz not null,
    status text not null default 'scheduled' check (status in ('scheduled', 'publishing', 'published', 'manual_reminder', 'failed', 'cancelled')),
    provider_post_id text,
    failure_code text,
    reminder_at timestamptz,
    reminder_seen_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists social_publications_user_date_idx on public.social_publications(user_id, scheduled_at desc);
create index if not exists social_publications_due_idx on public.social_publications(status, scheduled_at);
alter table public.social_publications enable row level security;
revoke all on public.social_publications from anon, authenticated;
