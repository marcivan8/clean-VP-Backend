-- Migration 007: authenticated email calls
-- Idempotent, safe to re-run. Run AFTER deploying the updated send-email and
-- send-weekly-digest edge functions.
--
-- The send-email function now refuses calls made with the public anon key,
-- except a verified welcome email (see the function header). These calls
-- therefore need the service role key, which must not be committed to the
-- repository. It is read from Supabase Vault instead. One-time setup, in the
-- SQL editor, with the real key from Settings > API:
--
--   select vault.create_secret('<service role key>', 'service_role_key');
--
-- Without that secret:
--   - welcome emails still go out (anon key + user_id, verified by the function);
--   - the weekly digest is refused (fail closed) until the secret exists.

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Returns the service role key from Vault, or null when it is not configured.
create or replace function public.email_service_key()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  k text;
begin
  begin
    select decrypted_secret into k
    from vault.decrypted_secrets
    where name = 'service_role_key'
    limit 1;
  exception when others then
    k := null;
  end;
  return k;
end;
$$;

revoke all on function public.email_service_key() from public, anon, authenticated;

-- ── Welcome email trigger ────────────────────────────────────────────────────
-- Now sends user_id so the function can verify the recipient, and never lets
-- an email problem block a signup.
create or replace function public.notify_welcome_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  user_email text;
  user_name  text;
  bearer     text;
begin
  select email, raw_user_meta_data->>'full_name'
  into   user_email, user_name
  from   auth.users
  where  id = new.id;

  if user_email is null then
    return new;
  end if;

  bearer := coalesce(
    public.email_service_key(),
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2bGVjY3RpZmdjdHJnaGx2bmVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ5ODY2MDAsImV4cCI6MjA3MDU2MjYwMH0.bJR3TLmfea-zLwrZ_C8LRoRSN68s0BSgn0zfkOV0hxQ'
  );

  begin
    perform net.http_post(
      url     := 'https://cvlecctifgctrghlvnes.supabase.co/functions/v1/send-email',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || bearer
      ),
      body    := jsonb_build_object(
        'type', 'welcome',
        'to',   user_email,
        'data', jsonb_build_object(
          'user_id',         new.id,
          'first_name',      coalesce(nullif(split_part(user_name, ' ', 1), ''), split_part(user_email, '@', 1)),
          'cta_url',         'https://www.viralpilot.fr/dashboard',
          'account_url',     'https://www.viralpilot.fr/account',
          'unsubscribe_url', 'https://www.viralpilot.fr/unsubscribe?uid=' || new.id
        )
      )
    );
  exception when others then
    raise warning 'notify_welcome_email: %', sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists trg_welcome_email on public.profiles;
create trigger trg_welcome_email
  after insert on public.profiles
  for each row
  execute function public.notify_welcome_email();

-- ── Weekly digest cron ───────────────────────────────────────────────────────
select cron.unschedule('vibed-weekly-digest')
where exists (select 1 from cron.job where jobname = 'vibed-weekly-digest');

select cron.schedule(
  'vibed-weekly-digest',
  '0 8 * * 1',   -- every Monday at 08:00 UTC
  $$
    select net.http_post(
      url     := 'https://cvlecctifgctrghlvnes.supabase.co/functions/v1/send-weekly-digest',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || coalesce(public.email_service_key(), '')
      ),
      body    := '{}'::jsonb
    );
  $$
);
