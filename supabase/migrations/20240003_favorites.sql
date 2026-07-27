-- Migration: 20240003_favorites.sql
-- User favorites — lightweight bookmarking, distinct from user_presets.
--
-- user_presets captures a NAMED, CUSTOM set of settings (e.g. a color grade
-- with specific brightness/contrast values, or a caption style) that the user
-- built and wants to reuse.
--
-- user_favorites is simpler: it just marks an EXISTING library item (an SFX or
-- LUT row in `assets`) or a fixed transition type (fade/crossfade/slide/zoom —
-- see client/src/components/Timeline/ClipContextMenu.jsx and render-lambda's
-- timeline.tsx for the supported transition kinds) for quick access later.
-- There's nothing to "name" or customize — you either favorited it or you didn't.
--
-- A row references EXACTLY ONE of asset_id / transition_type (enforced by the
-- check constraint below). Two partial unique indexes replace a single
-- compound unique constraint because Postgres treats NULLs as distinct from
-- each other in a regular UNIQUE constraint, which would silently allow
-- duplicate favorites of the same transition_type (since asset_id is NULL for
-- all of them and NULL != NULL).

create table if not exists user_favorites (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null references auth.users(id) on delete cascade,
    asset_id        uuid references assets(id) on delete cascade,
    transition_type text,
    created_at      timestamptz not null default now(),
    constraint user_favorites_exactly_one_target
        check ((asset_id is not null) <> (transition_type is not null))
);

create unique index if not exists user_favorites_asset_uniq
    on user_favorites(user_id, asset_id)
    where asset_id is not null;

create unique index if not exists user_favorites_transition_uniq
    on user_favorites(user_id, transition_type)
    where transition_type is not null;

create index if not exists user_favorites_user_idx on user_favorites(user_id);

alter table user_favorites enable row level security;

create policy "user_favorites_owner"
    on user_favorites for all
    to authenticated
    using (user_id = auth.uid());

-- Backend (service_role) bypasses RLS — no additional policy needed.
