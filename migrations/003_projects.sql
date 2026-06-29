-- ─────────────────────────────────────────────────────────────────────────────
-- 003_projects.sql
-- Persistent project storage for Vibed.
--
-- Each row = one user project. The timeline_state column stores the full
-- serialised timeline (tracks, clips, captions, etc.) as JSONB.
-- Transcripts are intentionally excluded — they are large and can be
-- re-generated on demand. Only include what makes a project loadable.
--
-- Usage:
--   Run once in the Supabase SQL editor (Project → SQL Editor → New query).
--   Safe to run again (CREATE TABLE IF NOT EXISTS).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.projects (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          text          NOT NULL DEFAULT 'Untitled Project',
  thumbnail_url text,                       -- GCS signed URL or data: URI for the cover frame
  aspect_ratio  text          NOT NULL DEFAULT '16:9',
  duration      numeric(10,3) NOT NULL DEFAULT 0,
  timeline_state jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now()
);

-- Fast descending list by user
CREATE INDEX IF NOT EXISTS projects_user_updated_idx
  ON public.projects (user_id, updated_at DESC);

-- ── Row-level security ────────────────────────────────────────────────────────

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Drop policy first so this script is re-runnable
DROP POLICY IF EXISTS "users_own_projects" ON public.projects;

CREATE POLICY "users_own_projects"
  ON public.projects
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── updated_at trigger ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_set_updated_at ON public.projects;

CREATE TRIGGER projects_set_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();
