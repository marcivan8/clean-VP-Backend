-- ─────────────────────────────────────────────────────────────────────────────
-- story_intelligence — narrative reading of the ASSEMBLED cut (Sprint 6, R51)
--
-- The level above project_intelligence:
--   media_assets         → what is each clip?              (R21/R38)
--   project_intelligence → what is this PROJECT?           (R44)
--   story_intelligence   → does the CUT tell that story?   (this)
--
-- Everything before this analysed the BIN — what footage exists. This analyses
-- what the user actually assembled: where the hook lands, where the cut sags,
-- whether the order delivers the through-line the project map identified.
--
-- FINGERPRINTED ON THE CUT, not the bin. The bin changes on upload; the cut
-- changes on every trim, reorder and delete, so the two need separate
-- freshness gates or the story map either goes stale or costs a GPT call per
-- edit (R29's recompute trap).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.story_intelligence (
    project_id       uuid primary key references public.projects(id) on delete cascade,
    user_id          uuid not null,

    -- [{ beat, startSec, endSec, clipIds[], summary }]
    -- beat: hook | setup | build | turn | payoff | outro | filler
    beats            jsonb not null default '[]'::jsonb,

    hook_at_sec      double precision,
    hook_strength    text,   -- strong | adequate | weak | absent
    hook_note        text,

    -- [{ startSec, endSec, reason, severity }] — stretches where nothing
    -- changes. Invisible to any per-clip view, which is the point.
    sag_windows      jsonb not null default '[]'::jsonb,

    delivers_through_line boolean,
    through_line_note     text,

    -- [{ issue, severity, suggestion, atSec }]
    issues           jsonb not null default '[]'::jsonb,

    fingerprint      text,
    status           text not null default 'ok',   -- ok | failed | insufficient_data
    clip_count       integer not null default 0,
    analysed_sec     double precision,

    derived_at       timestamptz default now(),
    created_at       timestamptz default now(),
    updated_at       timestamptz default now()
);

create index if not exists idx_story_intelligence_user
    on public.story_intelligence (user_id);

comment on table public.story_intelligence is
    'Narrative reading of the ASSEMBLED timeline (Sprint 6). One row per project. See CLAUDE.md R51.';
comment on column public.story_intelligence.fingerprint is
    'Hash of the cut (clip order + durations), NOT the bin. Re-derive only when the cut changes.';
