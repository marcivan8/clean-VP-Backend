-- ─────────────────────────────────────────────────────────────────────────────
-- Bin classification columns (R49)
--
-- MediaIntelligencePipeline.runBinClassification() has always computed these —
-- ContentClassifier returns content_class / suggested_track / related_to /
-- confidence per asset, plus a project-level type — and has always tried to
-- persist them. It could never succeed, for two independent reasons:
--
--   1. The write used `.eq(...).catch(fn)` on a PostgREST query builder. The
--      builder is thenable but has no .catch(), so that threw synchronously
--      BEFORE the query was sent. Neither update ever ran.
--   2. None of these six columns existed. Even with (1) fixed, every update
--      would have failed on an unknown column.
--
-- Same family as R21 (media_assets had no migration) and R38 (nothing INSERTed
-- the row): a write path targeting a schema that was never created.
-- ─────────────────────────────────────────────────────────────────────────────

-- Per-asset classification, relative to the rest of the bin.
alter table public.media_assets
    -- main_camera | broll | interview_b_cam | music | sfx | screen_recording | unknown
    add column if not exists content_class   text,
    -- video_1 | video_2 | video_3 | audio_music | audio_sfx
    add column if not exists suggested_track text,
    -- id of the primary asset this one supports (b-roll → its a-roll), or null
    add column if not exists related_to      text,
    -- 0.0–1.0 model confidence in the classification above
    add column if not exists confidence      double precision;

-- Project-level result of classifying the bin as a whole.
alter table public.projects
    -- talking_head | interview | vlog | podcast | tutorial | product_demo |
    -- event | documentary | unknown
    add column if not exists detected_project_type text,
    -- Full ContentClassifier payload, kept whole so a later feature can read
    -- fields this migration didn't break out into columns.
    add column if not exists bin_classification    jsonb;

comment on column public.media_assets.content_class is
    'Bin-relative role from ContentClassifier. See CLAUDE.md R49.';
comment on column public.media_assets.related_to is
    'Asset id this one supports (e.g. b-roll → its a-roll). Not an FK: the value comes from a model and is best-effort.';
comment on column public.projects.bin_classification is
    'Full ContentClassifier payload for the project bin.';
