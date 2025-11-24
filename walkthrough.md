# Usage Tracking Update Walkthrough

I have updated the usage tracking system to calculate usage dynamically by counting records in the `video_analyses` table, rather than relying on a manually incremented counter in the `profiles` table.

## Changes Made

### 1. Database Logic (`apply_usage_tracking.sql`)
- **Updated `check_usage_limits`**: This function now counts the number of rows in `video_analyses` for the current month to determine usage.
- **Removed `increment_usage`**: This function is no longer needed as usage is tracked automatically when an analysis is created.
- **Removed `reset_monthly_usage`**: The monthly reset cron job is no longer needed because the query automatically filters for the current month.

### 2. Backend Code
- **`controllers/mainController.js`**: Removed the call to `User.updateUsage(userId)` after a successful analysis.
- **`models/User.js`**: Removed the `updateUsage` method.

## Action Required

You need to apply the database changes for them to take effect. Please run the following SQL script in your Supabase SQL Editor:

**File:** `apply_usage_tracking.sql`

```sql
-- =================================================
-- POINT USAGE TRACKING TO VIDEO_ANALYSES TABLE
-- =================================================

-- 1. Drop obsolete functions
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

-- 3. Unschedule the monthly reset job as it's no longer needed
SELECT cron.unschedule('monthly-reset');

-- 4. Grant permissions
GRANT EXECUTE ON FUNCTION public.check_usage_limits(UUID) TO anon, authenticated;
```

Once you run this script, the usage displayed on the dashboard will reflect the actual number of analyses in the `video_analyses` table for the current month.
