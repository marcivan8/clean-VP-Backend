-- Migration 006: project retention notices
-- Idempotent, safe to re-run.
--
-- The daily retention job (services/retentionJob.js) records here which
-- projects have been announced for deletion. A project is deleted only when
-- a notice exists, was sent at least 24 hours earlier, and the project has
-- not been modified since. Opening or editing the project clears the notice.
--
-- Kept in its own table on purpose: writing to public.projects would fire
-- the set_updated_at trigger and reset the retention clock.

create table if not exists public.project_deletion_notices (
    project_id  uuid        primary key references public.projects(id) on delete cascade,
    user_id     uuid        not null references auth.users(id) on delete cascade,
    warned_at   timestamptz not null default now(),
    deadline    timestamptz not null
);

create index if not exists project_deletion_notices_user_idx
    on public.project_deletion_notices (user_id);

-- Service role only. RLS on with no policies means anon and authenticated
-- clients can neither read nor write this table.
alter table public.project_deletion_notices enable row level security;

-- Helps the job find inactive projects without a full scan.
create index if not exists projects_updated_at_idx
    on public.projects (updated_at);

-- ── Email opt-out ──────────────────────────────────────────────────────────
-- Set from the unsubscribe link (POST /api/email/unsubscribe). The weekly
-- digest and feature announcements skip opted-out users. Service messages
-- (plan receipts, deletion notices) are still sent.
alter table public.profiles
    add column if not exists email_opt_out boolean not null default false;
