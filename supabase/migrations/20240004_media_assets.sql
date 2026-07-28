-- ============================================================
-- Migration: 20240004_media_assets.sql
-- Media Intelligence — per-asset audio + visual analysis
--
-- WHY THIS EXISTS
-- server/brain/media/MediaIntelligencePipeline.js has always written its
-- analysis results to a `media_assets` table, and server/routes/brainRoutes.js
-- reads that table for /bin-summary and /organize. The table was never defined
-- in any migration, so in production every write silently failed and every read
-- returned nothing: the Editorial Brain had no idea what the uploaded footage
-- actually contained, and could only give generic advice. See CLAUDE.md R14's
-- note about media_assets not existing.
--
-- Columns mirror MediaIntelligencePipeline.analyzeAsset()'s update payload
-- exactly — adding a field there means adding it here too.
-- ============================================================

CREATE TABLE IF NOT EXISTS media_assets (
    id            text        PRIMARY KEY,          -- client-generated asset id ("asset-<ts>-<rand>")
    user_id       uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
    project_id    uuid,                             -- projects.id (nullable: bin assets may precede a save)
    name          text,
    gcs_path      text,

    -- ── Audio analysis (AudioClassifier) ──────────────────────
    audio_type          text,
    has_audio           boolean,
    has_spoken_word     boolean,
    integrated_loudness double precision,
    loudness_range      double precision,
    true_peak           double precision,
    is_mono             boolean,

    -- ── Visual analysis (VisualAnalyzer / GPT-4o Vision) ──────
    scene_type          text,      -- talking_head | interview | broll | screen_recording | podcast | …
    camera_angle        text,      -- close_up | medium | wide | overhead | unknown
    subject_count       integer,   -- people visible on camera
    has_main_speaker    boolean,
    has_faces           boolean,
    is_broll            boolean,
    is_screen_recording boolean,
    location_type       text,
    lighting_quality    text,
    stability           text,
    emotional_tone      text,
    content_description text,      -- one-sentence summary of the footage
    suggested_label     text,      -- short media-bin label

    -- ── Transcript ────────────────────────────────────────────
    transcript_text     text,

    -- ── Status ────────────────────────────────────────────────
    analysis_status text        DEFAULT 'pending'
                                CHECK (analysis_status IN ('pending', 'processing', 'done', 'failed')),
    analyzed_at     timestamptz,
    created_at      timestamptz DEFAULT now(),
    updated_at      timestamptz DEFAULT now()
);

-- Bin summaries and the organize flow both query by project
CREATE INDEX IF NOT EXISTS media_assets_project_idx ON media_assets(project_id);
CREATE INDEX IF NOT EXISTS media_assets_user_idx    ON media_assets(user_id);
CREATE INDEX IF NOT EXISTS media_assets_status_idx  ON media_assets(analysis_status);

-- RLS: users only see their own assets. Backend writes via supabaseAdmin
-- (service_role), which bypasses RLS — matching the pattern in
-- 20240001_brain.sql and 20240003_favorites.sql.
ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "media_assets_owner"
    ON media_assets
    FOR ALL
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "media_assets_service"
    ON media_assets
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
