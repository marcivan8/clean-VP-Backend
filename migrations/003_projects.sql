-- Migration 003: projects table + profiles plan column RLS
-- Idempotent — safe to re-run.

-- ── profiles: plan column ─────────────────────────────────────────────────
alter table public.profiles
    add column if not exists plan text not null default 'free'
        check (plan in ('free', 'creator', 'pro')),
    add column if not exists plan_expires_at timestamptz;

-- RLS: allow users to read their own plan
do $$ begin
    if not exists (
        select 1 from pg_policies
        where tablename = 'profiles' and policyname = 'profiles: own row select'
    ) then
        create policy "profiles: own row select"
            on public.profiles for select using (auth.uid() = id);
    end if;
end $$;

-- ── projects table ────────────────────────────────────────────────────────
create table if not exists public.projects (
    id             uuid          primary key default gen_random_uuid(),
    user_id        uuid          not null references auth.users(id) on delete cascade,
    name           text          not null default 'Untitled Project',
    thumbnail_url  text,
    aspect_ratio   text          not null default '16:9',
    duration       numeric(10,3) not null default 0,
    timeline_state jsonb         not null default '{}'::jsonb,
    created_at     timestamptz   not null default now(),
    updated_at     timestamptz   not null default now()
);

create index if not exists projects_user_updated_idx
    on public.projects (user_id, updated_at desc);

alter table public.projects enable row level security;

drop policy if exists "users_own_projects" on public.projects;
create policy "users_own_projects"
    on public.projects for all
    using  (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- ── updated_at trigger ────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
    before update on public.projects
    for each row execute procedure public.set_updated_at();
