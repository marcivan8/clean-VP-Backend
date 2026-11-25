-- supabase/migrations/20240012_market_roles.sql
--
-- VIBED Market: who an account is (buyer or talent), who may open the Trust
-- desk, and a guard so neither can be granted from the browser.
--
-- WHY THE GUARD IS PART OF THIS MIGRATION, NOT A FOLLOW-UP:
-- `profiles` has an UPDATE policy "Users can update own profile" with
-- `using (auth.uid() = id)` and NO column restriction. Any signed-in user can
-- therefore update EVERY column of their own row with the public anon key —
-- including `plan` (set yourself to 'pro'), and, once this migration exists,
-- `is_admin`. Adding an admin flag on a table the user can write freely would
-- create a self-service admin button. The trigger below refuses changes to
-- privileged columns unless the write comes from the backend (service_role) or
-- from the dashboard SQL editor (postgres). The client legitimately writes only
-- `usage_data` (client/src/services/onboardingProgress.js), which stays open.
--
-- Apply via the Supabase Dashboard → SQL Editor (see STAGING_SETUP.md).

alter table public.profiles
    add column if not exists is_admin    boolean not null default false,
    add column if not exists market_role text;

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.profiles'::regclass
          and conname = 'profiles_market_role_check'
    ) then
        alter table public.profiles
            add constraint profiles_market_role_check
            check (market_role is null or market_role in ('buyer', 'talent'));
    end if;
end $$;

comment on column public.profiles.is_admin is
    'Opens the VIBED Market Trust desk. Set by hand in the SQL editor; never writable from the browser (see profiles_guard_privileged).';
comment on column public.profiles.market_role is
    'buyer | talent | null (not chosen yet). Chosen once through POST /api/market/role; separate accounts per role, so it never changes afterwards.';

-- SECURITY INVOKER on purpose: current_user must be the caller's role
-- (authenticated / anon for browser requests, service_role for the backend,
-- postgres for the SQL editor). Under SECURITY DEFINER it would always be the
-- function owner and the guard would allow everything.
create or replace function public.profiles_guard_privileged()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
    if current_user not in ('authenticated', 'anon') then
        return new;
    end if;

    if new.is_admin               is distinct from old.is_admin
    or new.market_role            is distinct from old.market_role
    or new.plan                   is distinct from old.plan
    or new.plan_expires_at        is distinct from old.plan_expires_at
    or new.subscription_tier      is distinct from old.subscription_tier
    or new.subscription_status    is distinct from old.subscription_status
    or new.tier_expires_at        is distinct from old.tier_expires_at
    or new.paddle_subscription_id is distinct from old.paddle_subscription_id
    or new.polar_customer_id      is distinct from old.polar_customer_id
    or new.polar_subscription_id  is distinct from old.polar_subscription_id
    or new.stripe_customer_id     is distinct from old.stripe_customer_id
    or new.stripe_subscription_id is distinct from old.stripe_subscription_id
    or new.monthly_usage          is distinct from old.monthly_usage
    or new.usage_reset_at         is distinct from old.usage_reset_at
    or new.email_opt_out          is distinct from old.email_opt_out
    or new.id                     is distinct from old.id
    then
        raise exception 'This profile field can only be changed by the server'
            using errcode = '42501';
    end if;

    return new;
end;
$$;

drop trigger if exists trg_profiles_guard_privileged on public.profiles;
create trigger trg_profiles_guard_privileged
    before update on public.profiles
    for each row execute function public.profiles_guard_privileged();
