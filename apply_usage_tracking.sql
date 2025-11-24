-- =================================================
-- POINT USAGE TRACKING TO VIDEO_ANALYSES TABLE
-- =================================================

-- 1. Drop obsolete functions (no longer needed as we count rows now)
DROP FUNCTION IF EXISTS public.increment_usage(uuid, int, int);
DROP FUNCTION IF EXISTS public.increment_usage(uuid);
DROP FUNCTION IF EXISTS public.reset_monthly_usage();

-- 2. Update check_usage_limits to count from video_analyses
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

  -- Count analyses created in the current month from the history table
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

-- 3. Unschedule the monthly reset job as it's no longer needed
SELECT cron.unschedule('monthly-reset');

-- 4. Grant permissions
GRANT EXECUTE ON FUNCTION public.check_usage_limits(UUID) TO anon, authenticated;
