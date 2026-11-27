-- R176b — agent runs: one row per goal a user starts ("turn this video into
-- shorts"), holding the goal, the approved plan, every step with its timing
-- and outcome, every approval and kept/dropped decision with its reason, why
-- it stopped, and what it cost.
--
-- Backend-only, like the other runtime tables: RLS on and NO policies, so the
-- browser cannot read or write it with the anon key; routes/agentRunRoutes.js
-- reads and writes it with the service role, scoped to req.user.
--
-- Deletion follows the owner: deleting the account (auth.users) or the
-- project removes its runs, so the privacy promises of R87 hold without a
-- separate cleanup.

create table if not exists agent_runs (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references auth.users(id) on delete cascade,
    project_id  uuid references projects(id) on delete cascade,
    goal        jsonb not null,
    status      text not null check (status in (
                    'awaiting_plan_approval', 'finding', 'awaiting_short_review',
                    'finishing', 'interrupted', 'done', 'stopped', 'failed')),
    state       jsonb not null default '{}'::jsonb,
    cost        jsonb not null default '{}'::jsonb,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create index if not exists agent_runs_user_project_idx
    on agent_runs(user_id, project_id, created_at desc);

alter table agent_runs enable row level security;
