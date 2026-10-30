-- Store a visual grammar profile for assets explicitly uploaded as references.
-- `visual_style_profile` is separate from content_description so style tokens
-- cannot pollute transcript-to-b-roll matching.
ALTER TABLE media_assets
    ADD COLUMN IF NOT EXISTS is_reference boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS visual_style_profile jsonb;

CREATE INDEX IF NOT EXISTS media_assets_reference_idx
    ON media_assets(project_id, is_reference)
    WHERE is_reference = true;
