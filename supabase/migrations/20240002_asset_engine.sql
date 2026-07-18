-- Migration: 20240002_asset_engine.sql
-- Creative Asset Intelligence System
-- Tables: assets, sound_effects, luts, presets, user_presets,
--         asset_usage_log, user_asset_preferences, timeline_event_log, audio_exports

-- ── pgvector ──────────────────────────────────────────────────────────────────
create extension if not exists vector;

-- ── assets (base table for SFX, LUT, Preset) ─────────────────────────────────
create table if not exists assets (
    id                      uuid primary key default gen_random_uuid(),
    type                    text not null,               -- AssetType enum value
    name                    text not null unique,        -- slug / internal key
    display_name            text not null,
    description             text,
    gcs_path                text,
    preview_url             text,
    thumbnail_url           text,
    duration                float,                       -- null for LUTs, fonts
    file_size               bigint,
    mime_type               text,
    license                 text not null default 'royalty_free',
    creator                 text,
    pack                    text,
    editing_intents         text[] not null default '{}',
    emotion_tags            text[] not null default '{}',
    energy_level            int not null default 3 check (energy_level between 1 and 5),
    style                   text[] not null default '{}',
    search_keywords         text[] not null default '{}',
    best_use_cases          text[] not null default '{}',
    category                text,
    sub_category            text,
    embedding               vector(1536),
    embedding_generated_at  timestamptz,
    use_count               int not null default 0,
    favorite_count          int not null default 0,
    last_used_at            timestamptz,
    is_system               boolean not null default true,
    is_active               boolean not null default true,
    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now()
);

-- ── sound_effects (SFX-specific columns) ─────────────────────────────────────
create table if not exists sound_effects (
    id                          uuid primary key references assets(id) on delete cascade,
    loudness_lufs               float not null default -20,
    peak_db                     float not null default -3,
    sample_rate                 int not null default 44100,
    channels                    int not null default 2,
    bit_depth                   int not null default 16,
    has_attack                  boolean not null default true,
    has_release                 boolean not null default true,
    is_tonal                    boolean not null default false,
    is_pitchable                boolean not null default false,
    recommended_volume          float not null default 0.8,
    recommended_fade_in         int not null default 0,    -- ms
    recommended_fade_out        int not null default 0,    -- ms
    offset_from_event           int not null default 0,    -- ms (negative=before)
    placement_strategy          text not null default 'on_event',
    similar_sound_ids           uuid[] not null default '{}',
    complementary_sound_ids     uuid[] not null default '{}',
    compatible_timeline_events  text[] not null default '{}'
);

-- ── luts ─────────────────────────────────────────────────────────────────────
create table if not exists luts (
    id                          uuid primary key references assets(id) on delete cascade,
    format                      text not null default 'cube',
    dimensions                  int not null default 33,
    color_space                 text not null default 'rec709',
    input_color_space           text not null default 'rec709',
    output_color_space          text not null default 'srgb',
    warmth                      float not null default 0,
    contrast                    float not null default 0,
    saturation                  float not null default 0,
    highlights                  float not null default 0,
    shadows                     float not null default 0,
    cinematic                   boolean not null default false,
    css_filter_preview          text not null,            -- NEVER NULL
    suitable_content_types      text[] not null default '{}',
    suitable_lighting_conditions text[] not null default '{}',
    platform_suggestions        text[] not null default '{}',
    pairs_with                  uuid[] not null default '{}'
);

-- ── presets ───────────────────────────────────────────────────────────────────
create table if not exists presets (
    id               uuid primary key references assets(id) on delete cascade,
    preset_type      text not null,                      -- PresetType enum value
    settings         jsonb not null default '{}',        -- typed per preset_type
    command_sequence jsonb,                              -- PresetCommand[] | null
    is_public        boolean not null default true,
    saved_count      int not null default 0
);

-- ── user_presets (user-saved / personalised presets) ─────────────────────────
create table if not exists user_presets (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null references auth.users(id) on delete cascade,
    name            text not null,
    preset_type     text not null,
    settings        jsonb not null default '{}',
    command_sequence jsonb,
    is_public       boolean not null default false,
    use_count       int not null default 0,
    source_preset_id uuid references assets(id) on delete set null,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    unique (user_id, name)
);

-- ── asset_usage_log ───────────────────────────────────────────────────────────
create table if not exists asset_usage_log (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid references auth.users(id) on delete set null,
    asset_id        uuid not null references assets(id) on delete cascade,
    project_id      uuid,
    clip_id         text,
    timeline_time   float,
    event_type      text,                               -- TimelineEventType that triggered
    accepted        boolean,                            -- null = user-initiated (no suggestion)
    session_id      text,
    created_at      timestamptz not null default now()
);

-- ── user_asset_preferences ────────────────────────────────────────────────────
create table if not exists user_asset_preferences (
    id                  uuid primary key default gen_random_uuid(),
    user_id             uuid not null references auth.users(id) on delete cascade,
    asset_type          text not null,
    preferred_intents   text[] not null default '{}',
    preferred_emotions  text[] not null default '{}',
    preferred_energy    float,
    avoided_intents     text[] not null default '{}',
    avoided_emotions    text[] not null default '{}',
    total_uses          int not null default 0,
    last_updated_at     timestamptz not null default now(),
    unique (user_id, asset_type)
);

-- ── timeline_event_log ────────────────────────────────────────────────────────
create table if not exists timeline_event_log (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid references auth.users(id) on delete set null,
    project_id      uuid not null,
    event_type      text not null,
    timeline_time   float not null,
    clip_id         text,
    metadata        jsonb,
    suggested_asset_id uuid references assets(id) on delete set null,
    suggestion_accepted boolean,
    created_at      timestamptz not null default now()
);

-- ── audio_exports ─────────────────────────────────────────────────────────────
create table if not exists audio_exports (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null references auth.users(id) on delete cascade,
    project_id      uuid not null,
    status          text not null default 'pending',    -- pending | processing | done | error
    options         jsonb not null default '{}',        -- AudioExportOptions
    gcs_path        text,
    signed_url      text,
    signed_url_expires_at timestamptz,
    error_message   text,
    duration_seconds float,
    file_size_bytes bigint,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

-- ── Indices ───────────────────────────────────────────────────────────────────

-- Vector similarity (ivfflat — requires at least 1 row before it can build)
create index if not exists assets_embedding_idx
    on assets using ivfflat (embedding vector_cosine_ops)
    with (lists = 100);

-- Array search (GIN)
create index if not exists assets_editing_intents_idx  on assets using gin(editing_intents);
create index if not exists assets_emotion_tags_idx     on assets using gin(emotion_tags);
create index if not exists assets_style_idx            on assets using gin(style);
create index if not exists assets_search_keywords_idx  on assets using gin(search_keywords);

-- Scalar lookups
create index if not exists assets_type_idx             on assets(type);
create index if not exists assets_energy_level_idx     on assets(energy_level);
create index if not exists assets_is_active_idx        on assets(is_active);
create index if not exists assets_use_count_idx        on assets(use_count desc);

-- Usage / preference lookups
create index if not exists asset_usage_log_user_idx    on asset_usage_log(user_id);
create index if not exists asset_usage_log_asset_idx   on asset_usage_log(asset_id);
create index if not exists user_preferences_user_idx   on user_asset_preferences(user_id);
create index if not exists timeline_event_log_proj_idx on timeline_event_log(project_id);
create index if not exists audio_exports_user_idx      on audio_exports(user_id, project_id);
create index if not exists user_presets_user_idx       on user_presets(user_id);

-- ── Row-Level Security ────────────────────────────────────────────────────────

alter table assets                  enable row level security;
alter table sound_effects           enable row level security;
alter table luts                    enable row level security;
alter table presets                 enable row level security;
alter table user_presets            enable row level security;
alter table asset_usage_log         enable row level security;
alter table user_asset_preferences  enable row level security;
alter table timeline_event_log      enable row level security;
alter table audio_exports           enable row level security;

-- System assets: readable by all authenticated users
create policy "assets_public_read"
    on assets for select
    to authenticated
    using (is_active = true);

create policy "sound_effects_public_read"
    on sound_effects for select
    to authenticated
    using (true);

create policy "luts_public_read"
    on luts for select
    to authenticated
    using (true);

create policy "presets_public_read"
    on presets for select
    to authenticated
    using (true);

-- User-owned rows
create policy "user_presets_owner"
    on user_presets for all
    to authenticated
    using (user_id = auth.uid());

create policy "usage_log_owner_read"
    on asset_usage_log for select
    to authenticated
    using (user_id = auth.uid());

create policy "preferences_owner"
    on user_asset_preferences for all
    to authenticated
    using (user_id = auth.uid());

create policy "event_log_owner_read"
    on timeline_event_log for select
    to authenticated
    using (user_id = auth.uid());

create policy "audio_exports_owner"
    on audio_exports for all
    to authenticated
    using (user_id = auth.uid());

-- Backend (service_role) bypasses RLS — no additional policies needed.

-- ── RPCs ─────────────────────────────────────────────────────────────────────

-- 1. Semantic similarity search across assets
create or replace function search_assets_by_embedding(
    query_embedding     vector(1536),
    asset_type_filter   text default null,
    limit_count         int  default 20,
    min_similarity      float default 0.60
)
returns table (
    id              uuid,
    type            text,
    name            text,
    display_name    text,
    similarity      float
)
language sql stable
as $$
    select
        a.id,
        a.type,
        a.name,
        a.display_name,
        1 - (a.embedding <=> query_embedding) as similarity
    from assets a
    where
        a.is_active = true
        and a.embedding is not null
        and (asset_type_filter is null or a.type = asset_type_filter)
        and 1 - (a.embedding <=> query_embedding) >= min_similarity
    order by a.embedding <=> query_embedding
    limit limit_count;
$$;

-- 2. Find assets similar to a given asset
create or replace function get_similar_assets(
    source_asset_id     uuid,
    limit_count         int  default 10,
    min_similarity      float default 0.70
)
returns table (
    id              uuid,
    type            text,
    name            text,
    display_name    text,
    similarity      float
)
language sql stable
as $$
    select
        a.id,
        a.type,
        a.name,
        a.display_name,
        1 - (a.embedding <=> src.embedding) as similarity
    from assets a
    cross join (
        select embedding from assets where id = source_asset_id
    ) src
    where
        a.id != source_asset_id
        and a.is_active = true
        and a.embedding is not null
        and 1 - (a.embedding <=> src.embedding) >= min_similarity
    order by a.embedding <=> src.embedding
    limit limit_count;
$$;

-- 3. Search LUTs by visual profile (warmth, contrast, saturation ranges)
create or replace function search_luts_by_profile(
    warmth_min      float default -5,
    warmth_max      float default  5,
    contrast_min    float default -5,
    contrast_max    float default  5,
    saturation_min  float default -5,
    saturation_max  float default  5,
    cinematic_only  boolean default false,
    limit_count     int default 10
)
returns table (
    id              uuid,
    name            text,
    display_name    text,
    warmth          float,
    contrast        float,
    saturation      float,
    cinematic       boolean,
    css_filter_preview text
)
language sql stable
as $$
    select
        a.id,
        a.name,
        a.display_name,
        l.warmth,
        l.contrast,
        l.saturation,
        l.cinematic,
        l.css_filter_preview
    from luts l
    join assets a on a.id = l.id
    where
        a.is_active = true
        and l.warmth    between warmth_min    and warmth_max
        and l.contrast  between contrast_min  and contrast_max
        and l.saturation between saturation_min and saturation_max
        and (not cinematic_only or l.cinematic = true)
    order by a.use_count desc
    limit limit_count;
$$;
