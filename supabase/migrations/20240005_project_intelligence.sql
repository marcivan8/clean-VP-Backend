-- ─────────────────────────────────────────────────────────────────────────────
-- project_intelligence — the persisted PROJECT MAP (Sprint 5)
--
-- media_assets answers "what is each clip?" (R21/R38). This table answers the
-- next question up: "what is this PROJECT?" — its format, its through-line,
-- what role each asset plays in it, and what's missing.
--
-- One row per project. Derived from the asset profiles + timeline shape by
-- server/brain/ProjectIntelligence.js, read by the Editorial Brain.
--
-- WHY PERSIST IT: deriving this costs a GPT call over the whole bin. Recomputing
-- it on every /analyze request would be slow, expensive, and would still forget
-- everything between sessions — the same "it re-ran the expensive thing" family
-- as R29. The fingerprint column below is what makes re-derivation conditional.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.project_intelligence (
    project_id      uuid primary key references public.projects(id) on delete cascade,
    user_id         uuid not null,

    -- ── What this project IS ────────────────────────────────────────────────
    -- project_type: interview | tutorial | vlog | product_demo | montage |
    --               presentation | narrative | unknown
    project_type    text,
    -- One sentence: what this video is actually about. The Brain's anchor for
    -- every piece of advice it gives about this project.
    through_line    text,
    -- Who it appears to be for, when inferable from the material.
    target_audience text,
    -- Overall register: educational | conversational | promotional | personal …
    tone            text,

    -- ── Per-asset roles ─────────────────────────────────────────────────────
    -- [{ assetId, name, role, serves }]
    --   role   — a_roll | b_roll | intro | outro | demo | cutaway | supporting
    --   serves — for b_roll/cutaway: which asset or topic it illustrates
    -- JSONB rather than a child table: it is always read whole, always written
    -- whole, and never queried by role.
    asset_roles     jsonb not null default '[]'::jsonb,

    -- ── What's missing ──────────────────────────────────────────────────────
    -- [{ gap, severity, suggestion }] — severity: low | medium | high
    -- The genuinely new capability here: knowing a project has 6 minutes of
    -- talking head and zero cutaways is something no per-asset row can express.
    coverage_gaps   jsonb not null default '[]'::jsonb,

    -- ── Freshness ───────────────────────────────────────────────────────────
    -- Hash of the inputs the map was derived from (asset ids + their analysis
    -- state + clip count). Re-derive only when this changes — without it the
    -- map either goes stale silently or costs a GPT call per request.
    fingerprint     text,
    -- ok | stale | failed. 'failed' is recorded rather than left empty so a
    -- persistent derivation failure is visible instead of looking like a
    -- project nobody has opened yet (R38's lesson about empty-vs-broken).
    status          text not null default 'ok',
    -- Number of assets the map was built from, for the "partial map" case.
    asset_count     integer not null default 0,

    derived_at      timestamptz default now(),
    created_at      timestamptz default now(),
    updated_at      timestamptz default now()
);

create index if not exists idx_project_intelligence_user
    on public.project_intelligence (user_id);

comment on table public.project_intelligence is
    'Persisted project-level understanding (Sprint 5). One row per project. See CLAUDE.md R44.';
comment on column public.project_intelligence.fingerprint is
    'Hash of derivation inputs. Re-derive only when it changes.';
