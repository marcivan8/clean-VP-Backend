-- ============================================================
-- Row Level Security (RLS) policies
-- Run this once in the Supabase SQL editor (Dashboard → SQL).
-- All tables that hold per-user data must be covered.
-- ============================================================

-- ── profiles ─────────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Users can only read and update their own profile row.
CREATE POLICY "profiles: own row select"
    ON public.profiles FOR SELECT
    USING (id = auth.uid());

CREATE POLICY "profiles: own row update"
    ON public.profiles FOR UPDATE
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

-- The server-side service role (used by the backend) bypasses RLS,
-- so INSERT from the backend still works without a separate policy.

-- ── video_analyses ────────────────────────────────────────────
ALTER TABLE public.video_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "video_analyses: own rows select"
    ON public.video_analyses FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "video_analyses: own rows insert"
    ON public.video_analyses FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "video_analyses: own rows update"
    ON public.video_analyses FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "video_analyses: own rows delete"
    ON public.video_analyses FOR DELETE
    USING (user_id = auth.uid());

-- ── usage_logs ────────────────────────────────────────────────
ALTER TABLE public.usage_logs ENABLE ROW LEVEL SECURITY;

-- Usage logs are write-only from the client perspective.
-- Only the service role reads them (for admin/analytics).
CREATE POLICY "usage_logs: own rows insert"
    ON public.usage_logs FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "usage_logs: own rows select"
    ON public.usage_logs FOR SELECT
    USING (user_id = auth.uid());

-- ── sessions (anonymous sessions table, if it exists) ─────────
-- If you have a sessions table keyed by a uuid session_id column,
-- use a looser policy tied to the stored session id instead.
-- Uncomment and adapt if needed:
--
-- ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "sessions: own rows"
--     ON public.sessions FOR ALL
--     USING (user_id = auth.uid() OR user_id IS NULL);

-- ── Grant execute on check_usage_limits to authenticated users ─
-- Already in clean_slate_setup.sql but repeated here for completeness.
GRANT EXECUTE ON FUNCTION public.check_usage_limits(UUID) TO authenticated;
