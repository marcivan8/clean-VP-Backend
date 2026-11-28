-- R180: runs can be left out of "what the run learned from you". The Reset
-- button in the shorts plan (and the learned-style reset on /style) sets this
-- on every run the user has, so the next plan starts from the defaults again.
-- Runs stay stored (history, data export, Langfuse); they just stop teaching.
alter table public.agent_runs add column if not exists learning_excluded boolean not null default false;
create index if not exists agent_runs_user_learning_idx on public.agent_runs (user_id, created_at desc) where learning_excluded = false;
