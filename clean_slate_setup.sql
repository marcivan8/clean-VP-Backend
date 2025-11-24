-- =================================================
-- 1. CLEANUP (Fixes the "Function not unique" error)
-- =================================================
-- Drop all variations of the conflicting functions
DROP FUNCTION IF EXISTS public.increment_usage(uuid, int, int);
DROP FUNCTION IF EXISTS public.increment_usage(uuid);
DROP FUNCTION IF EXISTS public.check_usage_limits(uuid);
DROP FUNCTION IF EXISTS public.reset_monthly_usage();

-- Enable Extensions
CREATE EXTENSION IF NOT EXISTS "pg_cron"; 
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =================================================
-- 2. TABLE UPDATES
-- =================================================
-- Ensure profiles has the tracker column
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS monthly_usage JSONB DEFAULT '{"analyses": 0}'::jsonb,
  ADD COLUMN IF NOT EXISTS subscription_tier TEXT DEFAULT 'explorer';

-- Force defaults for data integrity
ALTER TABLE public.profiles 
  ALTER COLUMN subscription_tier SET DEFAULT 'explorer',
  ALTER COLUMN monthly_usage SET DEFAULT '{"analyses": 0}'::jsonb;

-- =================================================
-- 3. SECURE BACKEND LOGIC
-- =================================================

-- Function A: Check Limits (Frontend calls this)
-- Returns TRUE if user is under the limit of 20
CREATE OR REPLACE FUNCTION public.check_usage_limits(user_id_param UUID)
RETURNS TABLE(can_analyze BOOLEAN, current_usage INT, max_limit INT) 
AS $$
DECLARE
  usage_val INT;
  limit_val INT := 20; -- Hardcoded Explorer Limit
BEGIN
  -- Security: Users can only check their own limits
  IF (auth.uid() IS NOT NULL AND auth.uid() != user_id_param) THEN
      RAISE EXCEPTION 'Unauthorized check';
  END IF;

  SELECT COALESCE((monthly_usage->>'analyses')::int, 0)
  INTO usage_val
  FROM public.profiles 
  WHERE id = user_id_param;

  RETURN QUERY SELECT 
    (usage_val < limit_val), -- True/False
    usage_val,
    limit_val;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function B: Increment Usage (Backend/Edge Function calls this)
-- This adds +1 to the counter
CREATE OR REPLACE FUNCTION public.increment_usage(user_id_param UUID)
RETURNS void AS $$
BEGIN
  UPDATE public.profiles
  SET 
    monthly_usage = jsonb_set(
      monthly_usage,
      '{analyses}',
      to_jsonb(COALESCE((monthly_usage->>'analyses')::int, 0) + 1)
    ),
    updated_at = timezone('utc'::text, now())
  WHERE id = user_id_param;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function C: Monthly Reset (Cron Job calls this)
CREATE OR REPLACE FUNCTION public.reset_monthly_usage()
RETURNS void AS $$
BEGIN
  -- Resets EVERYONE to 0
  UPDATE public.profiles
  SET monthly_usage = '{"analyses": 0}'::jsonb,
      updated_at = timezone('utc'::text, now());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =================================================
-- 4. SECURITY & PERMISSIONS
-- =================================================

-- Allow frontend to check limits
GRANT EXECUTE ON FUNCTION public.check_usage_limits(UUID) TO anon, authenticated;

-- CRITICAL: Prevent frontend from faking usage
REVOKE EXECUTE ON FUNCTION public.increment_usage(UUID) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reset_monthly_usage() FROM anon, authenticated;

-- =================================================
-- 5. AUTOMATION (The Monthly Reset)
-- =================================================
-- Unschedule previous jobs to prevent duplicates
SELECT cron.unschedule('monthly-reset');

-- Schedule: Run at 00:00 on the 1st of every month
SELECT cron.schedule(
  'monthly-reset',
  '0 0 1 * *', 
  $$SELECT public.reset_monthly_usage()$$
);
