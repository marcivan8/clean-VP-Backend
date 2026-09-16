-- Migration: 20240009_sticker_library.sql
-- R83 — Sticker/Icon/Emoji Asset Library.
--
-- Finally wires up AssetType.STICKER (server/audio-engine/types.js), reserved
-- since the original 20240002_asset_engine.sql migration but never given a
-- detail table — the same "built but never wired" pattern this codebase has
-- caught before (CLAUDE.md R33/R37/R46/R52/R55/R55c). Follows the EXACT same
-- shape as `sound_effects`/`luts`/`presets`: a detail table keyed 1:1 to
-- `assets(id)`, reusing that table's already-generous generic columns
-- (search_keywords, category, sub_category, editing_intents, license,
-- creator, pack, gcs_path, preview_url, use_count, is_active) rather than
-- duplicating them here.
--
-- Populated by scripts/seed_sticker_library.js from a curated, free,
-- self-hosted set: Lucide icons (ISC) and Noto Emoji (Apache-2.0, via
-- @svgmoji/noto) — see that script's own header for full sourcing/licensing
-- notes and why Noto was chosen over Twemoji (CC-BY 4.0, which would require
-- per-video attribution — impractical for exported footage; Apache-2.0 does
-- not carry that obligation).

create table if not exists stickers (
    id                          uuid primary key references assets(id) on delete cascade,
    sticker_kind                text not null check (sticker_kind in ('icon', 'emoji')),
    unicode_codepoint           text,                       -- emoji only, e.g. 'U+1F600'; null for icons
    native_width                int not null default 512,
    native_height                int not null default 512,
    has_transparent_bg          boolean not null default true,
    compatible_timeline_events  text[] not null default '{}' -- mirrors sound_effects' own column: which TimelineEventType this pairs well with
);

create index if not exists stickers_kind_idx on stickers(sticker_kind);

alter table stickers enable row level security;

drop policy if exists "stickers_public_read" on stickers;
create policy "stickers_public_read"
    on stickers for select
    to authenticated
    using (true);
