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
-- Ensure profiles has the tracker column (kept for legacy or other metadata, but not used for counting anymore)
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
-- UPDATED: Counts directly from video_analyses table
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

  -- Count analyses created in the current month
  SELECT COUNT(*)::int
  INTO usage_val
  FROM public.video_analyses 
  WHERE user_id = user_id_param
    AND created_at >= date_trunc('month', now());

  RETURN QUERY SELECT 
    (usage_val < limit_val), -- True/False
    usage_val,
    limit_val;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function B: Increment Usage - DEPRECATED/REMOVED
-- We no longer need to manually increment usage as we count rows.

-- Function C: Monthly Reset - DEPRECATED/REMOVED
-- We no longer need to reset usage as the query filters by current month.

-- =================================================
-- 4. SECURITY & PERMISSIONS
-- =================================================

-- Allow frontend to check limits
GRANT EXECUTE ON FUNCTION public.check_usage_limits(UUID) TO anon, authenticated;

-- =================================================
-- 5. AUTOMATION (The Monthly Reset)
-- =================================================
-- Unschedule previous jobs as they are no longer needed
SELECT cron.unschedule('monthly-reset');
