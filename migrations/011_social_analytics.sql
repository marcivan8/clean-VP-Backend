-- R161: performance signals and approved editing guidance for Vibed posts.
alter table public.social_publications
    add column if not exists published_at timestamptz,
    add column if not exists edit_context jsonb not null default '{}'::jsonb,
    add column if not exists analytics_last_synced_at timestamptz,
    add column if not exists analytics_error text;

create table if not exists public.social_publication_metrics (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    publication_id uuid not null references public.social_publications(id) on delete cascade,
    metric_date date not null,
    metrics jsonb not null default '{}'::jsonb,
    captured_at timestamptz not null default now(),
    unique (publication_id, metric_date)
);
create index if not exists social_metrics_user_date_idx
    on public.social_publication_metrics(user_id, metric_date desc);
create index if not exists social_metrics_post_date_idx
    on public.social_publication_metrics(publication_id, metric_date desc);

create table if not exists public.social_edit_recommendations (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    provider text not null check (provider in ('youtube', 'instagram', 'all')),
    category text not null check (category in ('hook', 'pacing', 'captions', 'framing', 'duration', 'story')),
    title text not null,
    rationale text not null,
    instruction text not null,
    evidence jsonb not null default '[]'::jsonb,
    status text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed')),
    created_at timestamptz not null default now(),
    decided_at timestamptz
);
create index if not exists social_recommendations_user_status_idx
    on public.social_edit_recommendations(user_id, status, created_at desc);

alter table public.social_publication_metrics enable row level security;
revoke all on public.social_publication_metrics from anon, authenticated;
alter table public.social_edit_recommendations enable row level security;
revoke all on public.social_edit_recommendations from anon, authenticated;
