-- R179: shorts_to_posts runs. A run that schedules its shorts passes through
-- three more statuses: preparing_posts (copy and times being drafted),
-- awaiting_schedule_approval (the user approves the whole schedule once) and
-- posting (approved shorts being exported and scheduled).
--
-- 20240014 declared the status check inline, so Postgres named it
-- agent_runs_status_check. The goal kind lives in the goal jsonb and is
-- checked by routes/agentRunRoutes.js, so no constraint changes for it.
alter table public.agent_runs drop constraint if exists agent_runs_status_check;
alter table public.agent_runs add constraint agent_runs_status_check check (status in (
    'awaiting_plan_approval', 'finding', 'awaiting_short_review',
    'finishing', 'preparing_posts', 'awaiting_schedule_approval', 'posting',
    'interrupted', 'done', 'stopped', 'failed'));
