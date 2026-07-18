-- ============================================================
-- Migration: 20240001_brain.sql
-- Editorial Brain & Media Intelligence Layer
-- Apply via: supabase db push  OR  psql -f this file
-- ============================================================

-- ── user_editing_profiles ─────────────────────────────────────
-- Persists learned preferences for each user.
-- Created on first AI interaction; updated fire-and-forget.

CREATE TABLE IF NOT EXISTS user_editing_profiles (
    user_id                   uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    avg_cut_rate              float       DEFAULT 0,
    preferred_pace            text        DEFAULT 'medium',
    preferred_fonts           jsonb       DEFAULT '[]'::jsonb,
    preferred_platforms       jsonb       DEFAULT '[]'::jsonb,
    accepted_suggestions      jsonb       DEFAULT '{}'::jsonb,
    rejected_suggestions      jsonb       DEFAULT '{}'::jsonb,
    permanently_hidden        jsonb       DEFAULT '[]'::jsonb,
    common_commands           jsonb       DEFAULT '{}'::jsonb,
    skill_level               text        DEFAULT 'beginner'
                                          CHECK (skill_level IN ('beginner', 'intermediate', 'advanced')),
    content_type              text        DEFAULT 'talking_head',
    typically_removes_silences boolean   DEFAULT false,
    typically_adds_captions   boolean    DEFAULT false,
    typically_adds_music      boolean    DEFAULT false,
    updated_at                timestamptz DEFAULT now()
);

-- RLS: users can only read/write their own profile
ALTER TABLE user_editing_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_editing_profiles_self"
    ON user_editing_profiles
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Service role bypass (backend writes via supabaseAdmin)
CREATE POLICY "user_editing_profiles_service"
    ON user_editing_profiles
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ── editing_sessions ──────────────────────────────────────────
-- Append-only log of brain interactions for pattern analysis.

CREATE TABLE IF NOT EXISTS editing_sessions (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
    project_id       uuid,
    session_id       text        NOT NULL,
    trigger          text,
    raw_input        text,
    resolved_command text,
    executed         boolean     DEFAULT false,
    platform         text,
    content_type     text,
    created_at       timestamptz DEFAULT now()
);

-- Index for per-user queries (pattern learning reads)
CREATE INDEX IF NOT EXISTS idx_editing_sessions_user_id
    ON editing_sessions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_editing_sessions_session_id
    ON editing_sessions(session_id);

-- RLS: service role only (brain writes; no direct client access)
ALTER TABLE editing_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "editing_sessions_service"
    ON editing_sessions
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ── suggestion_feedback ───────────────────────────────────────
-- Records user accept/dismiss actions on suggestion chips.
-- Used to auto-hide suggestions after 3 rejections.

CREATE TABLE IF NOT EXISTS suggestion_feedback (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id       text        NOT NULL,
    suggestion_type  text        NOT NULL,
    accepted         boolean     NOT NULL,
    created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suggestion_feedback_user_type
    ON suggestion_feedback(user_id, suggestion_type, accepted);

-- RLS: service role only
ALTER TABLE suggestion_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "suggestion_feedback_service"
    ON suggestion_feedback
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ── RPC: increment_suggestion_counter ────────────────────────
-- Atomically increments a counter in accepted_suggestions or
-- rejected_suggestions jsonb column of user_editing_profiles.
--
-- Usage:
--   SELECT increment_suggestion_counter(
--     p_user_id  := '<uuid>',
--     p_type     := 'generate_captions',
--     p_accepted := true
--   );

CREATE OR REPLACE FUNCTION increment_suggestion_counter(
    p_user_id  uuid,
    p_type     text,
    p_accepted boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_column text;
    v_current_val integer;
BEGIN
    v_column := CASE WHEN p_accepted THEN 'accepted_suggestions' ELSE 'rejected_suggestions' END;

    -- Ensure profile row exists (upsert default)
    INSERT INTO user_editing_profiles (user_id)
    VALUES (p_user_id)
    ON CONFLICT (user_id) DO NOTHING;

    -- Read current counter value (0 if key not present)
    EXECUTE format(
        'SELECT COALESCE((%s->>$2)::integer, 0) FROM user_editing_profiles WHERE user_id = $1',
        v_column
    )
    INTO v_current_val
    USING p_user_id, p_type;

    -- Write incremented value back
    EXECUTE format(
        'UPDATE user_editing_profiles SET %s = %s || jsonb_build_object($2, ($3)::text), updated_at = now() WHERE user_id = $1',
        v_column, v_column
    )
    USING p_user_id, p_type, (v_current_val + 1);
END;
$$;
