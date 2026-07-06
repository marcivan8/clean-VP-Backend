-- migrations/005_email_triggers.sql
-- Sets up automated email triggers for VIBED:
--   1. Weekly digest via pg_cron (every Monday 8am UTC)
--   2. Welcome email via DB webhook (Supabase dashboard config)
--
-- Run in Supabase SQL Editor.
-- Requires: pg_net, pg_cron extensions (enabled in Supabase by default on Pro).

-- ── EXTENSIONS ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ── WEEKLY DIGEST — every Monday at 08:00 UTC ─────────────────────────────────
-- Calls the send-weekly-digest edge function.
-- Replace <SUPABASE_PROJECT_REF> and <SUPABASE_ANON_KEY> with your real values.

SELECT cron.unschedule('vibed-weekly-digest') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'vibed-weekly-digest'
);

SELECT cron.schedule(
  'vibed-weekly-digest',
  '0 8 * * 1',   -- every Monday at 08:00 UTC
  $$
    SELECT net.http_post(
      url     := 'https://cvlecctifgctrghlvnes.supabase.co/functions/v1/send-weekly-digest',
      headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2bGVjY3RpZmdjdHJnaGx2bmVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ5ODY2MDAsImV4cCI6MjA3MDU2MjYwMH0.bJR3TLmfea-zLwrZ_C8LRoRSN68s0BSgn0zfkOV0hxQ"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);

-- ── WELCOME EMAIL — DB WEBHOOK (configure in Supabase Dashboard) ───────────────
-- You cannot create a DB Webhook via SQL — do it in the Supabase Dashboard:
--
--   Dashboard → Database → Webhooks → Create new webhook
--     Name:    on_profile_created
--     Table:   public.profiles
--     Events:  INSERT
--     Type:    Supabase Edge Functions
--     Function: send-email
--     Payload (sent automatically by Supabase):
--       { "type": "INSERT", "table": "profiles", "record": { "id": "...", ... } }
--
-- The send-email function handles the translation from the webhook payload
-- via the /welcome-hook helper below.

-- ── WELCOME HOOK HELPER (called from DB webhook payload) ─────────────────────
-- Alternatively, use this PostgreSQL function as a trigger if you prefer
-- server-side triggers over Supabase webhooks.

CREATE OR REPLACE FUNCTION public.notify_welcome_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_email TEXT;
  user_name  TEXT;
BEGIN
  -- Look up email from auth.users
  SELECT email, raw_user_meta_data->>'full_name'
  INTO   user_email, user_name
  FROM   auth.users
  WHERE  id = NEW.id;

  IF user_email IS NULL THEN
    RETURN NEW;
  END IF;

  -- Fire-and-forget HTTP call to send-email edge function
  PERFORM net.http_post(
    url     := 'https://cvlecctifgctrghlvnes.supabase.co/functions/v1/send-email',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2bGVjY3RpZmdjdHJnaGx2bmVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ5ODY2MDAsImV4cCI6MjA3MDU2MjYwMH0.bJR3TLmfea-zLwrZ_C8LRoRSN68s0BSgn0zfkOV0hxQ"}'::jsonb,
    body    := json_build_object(
      'type', 'welcome',
      'to',   user_email,
      'data', json_build_object(
        'first_name',      COALESCE(split_part(user_name, ' ', 1), split_part(user_email, '@', 1)),
        'cta_url',         'https://www.viralpilot.fr/dashboard',
        'account_url',     'https://www.viralpilot.fr/account',
        'unsubscribe_url', 'https://www.viralpilot.fr/unsubscribe?uid=' || NEW.id
      )
    )::jsonb
  );

  RETURN NEW;
END;
$$;

-- Attach trigger to profiles table
DROP TRIGGER IF EXISTS trg_welcome_email ON public.profiles;
CREATE TRIGGER trg_welcome_email
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_welcome_email();

-- ── NOTES ─────────────────────────────────────────────────────────────────────
-- Replace these placeholders before running:
--   <SUPABASE_PROJECT_REF>  → found in Settings → API (e.g. abcdefghijklmnop)
--   <SUPABASE_ANON_KEY>     → found in Settings → API → anon/public key
--   <YOUR_APP_URL>          → https://www.viralpilot.fr (or your domain)
