-- migrations/008_usage_run_ids.sql
-- Run once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
--
-- Why this exists (R148):
--
-- 1. usage_events was counting things that are not AI operations. The live
--    database carries an INSERT policy that is in no migration in this repo,
--    so client trackEvent() calls land in the billing ledger. 232
--    video_uploaded and 92 video_exported rows were being metered as AI ops,
--    against only 10 rows the server gate actually recorded. Measured
--    conservatively, that pushed 12 free user-months and 2 Creator
--    user-months past their cap on analytics rows alone.
--
-- 2. One Auto run spends 3 to 5 gated requests (captions/generate,
--    audio/filler/detect, audio/enhance, audio/search, ai/detect-repeated-takes),
--    so "3 AI operations" was less than a single Auto edit and Creator's
--    "100 AI operations" was really about 20 to 30. Marc's decision on
--    2026-11-04 is that an operation means one Auto run, so the steps inside
--    a run collapse into one billable op.
--
-- After this migration usage_events is the SERVER's ledger only.

-- 1. Group a run's requests under one id. Null means a standalone operation.
alter table public.usage_events
    add column if not exists run_id text;

create index if not exists usage_events_user_run_idx
    on public.usage_events (user_id, run_id);

-- 2. The client must not write to the billing ledger. PostHog keeps the
--    analytics (trackEvent still calls captureEvent); only the service role
--    records billable operations from here on.
drop policy if exists "Users insert own usage" on public.usage_events;

-- 3. Billable operations for the current UTC month.
--    Only rows the server gate wrote are counted: recordUsageEvent stores
--    req.path, so every genuine row starts with '/'. Whitelisting the shape
--    means no future client event can ever consume someone's quota, and the
--    historical analytics rows above stop being charged.
--
--    p_exclude is the run being gated right now. A run's id is recorded by its
--    FIRST request, so counting it here would make a run count against itself:
--    step 2 of run 3 would read 3 ops and get refused halfway through. Asking
--    "how many runs BESIDES this one" makes the check mean what it says, and a
--    run is admitted or refused as a whole.
create or replace function public.count_monthly_ops(
    p_user    uuid,
    p_exclude text default null
)
returns integer
language sql
stable
as $$
    with billable as (
        select run_id
        from public.usage_events
        where user_id = p_user
          and operation like '/%'
          and created_at >= (date_trunc('month', timezone('utc', now())) at time zone 'utc')
          and (run_id is null or p_exclude is null or run_id <> p_exclude)
    )
    select
        (select count(distinct run_id) from billable where run_id is not null)
      + (select count(*)              from billable where run_id is null);
$$;

-- 4. Lifetime Auto runs, for the one-time trial grant. A new free account gets
--    its first few Auto runs with full capability so a beginner sees a finished
--    short before the wall; after that the published free plan applies again.
--    Lifetime on purpose: the trial is once per account, not once per month.
--    p_exclude keeps the run in progress inside its own trial, for the same
--    reason as above.
create or replace function public.count_lifetime_auto_runs(
    p_user    uuid,
    p_exclude text default null
)
returns integer
language sql
stable
as $$
    select count(distinct run_id)
    from public.usage_events
    where user_id = p_user
      and operation like '/%'
      and run_id is not null
      and (p_exclude is null or run_id <> p_exclude);
$$;

-- Functions are granted to PUBLIC by default, so revoking anon and
-- authenticated alone would leave that grant standing. Revoke PUBLIC and grant
-- back only the role the gate runs as.
revoke all on function public.count_monthly_ops(uuid, text)        from public;
revoke all on function public.count_lifetime_auto_runs(uuid, text) from public;

grant execute on function public.count_monthly_ops(uuid, text)        to service_role;
grant execute on function public.count_lifetime_auto_runs(uuid, text) to service_role;
