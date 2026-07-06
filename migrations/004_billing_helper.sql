-- migrations/004_billing_helper.sql
-- Adds a helper function so the Polar webhook can resolve a Supabase user UUID
-- from their email address (auth.users is not accessible via PostgREST, so we
-- expose a SECURITY DEFINER function that runs with the owner's privileges).
--
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query).

CREATE OR REPLACE FUNCTION public.get_user_id_by_email(email_param TEXT)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = auth, public
AS $$
  SELECT id FROM auth.users WHERE email = email_param LIMIT 1;
$$;

-- Only the service role (backend) needs to call this.
-- The anon/authenticated roles must NOT have access to avoid email enumeration.
REVOKE EXECUTE ON FUNCTION public.get_user_id_by_email(TEXT) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_user_id_by_email(TEXT) TO service_role;
