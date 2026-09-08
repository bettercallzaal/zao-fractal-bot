-- ============================================================
-- Async fractal participation - schema
--
-- Two changes, both additive and both safe to re-run.
--
-- 1. discord_roster.confidence did not permit 'manual', but gameRepo's
--    createSession writes exactly that for a facilitator-named group. The
--    insert failed with a check violation, so /start could never record a
--    session. Found 2026-09-07 while planning async participation; the unit
--    tests could not see it because they mock Supabase and a check constraint
--    lives only in the database.
--
--    'manual' is kept rather than swapped for 'none': the other five values
--    are name-RESOLUTION confidences from nameResolver.ts, and 'none' means
--    "we tried to resolve this person and failed". A facilitator naming the
--    group is different provenance, and collapsing the two would show
--    confirmed members as unresolved on the /fractals dashboard.
--
-- 2. is_async records who was ranked without attending. It must persist:
--    loadSessionByThread rehydrates the roster after a restart, and without
--    this column a resumed session would count async entrants as voters and
--    silently raise votesNeeded mid-game.
--
-- See docs/superpowers/specs/2026-09-02-async-participation-design.md
-- sections 2 and 3.2.
-- ============================================================

alter table public.discord_roster
  drop constraint if exists discord_roster_confidence_check;

alter table public.discord_roster
  add constraint discord_roster_confidence_check
  check (confidence in ('registry', 'exact', 'fuzzy', 'ambiguous', 'none', 'manual'));

alter table public.discord_roster
  add column if not exists is_async boolean not null default false;

comment on column public.discord_roster.is_async is
  'True for a member ranked from an async submission - votable-for, never voted-with. Spec 2026-09-02 section 2.';

create index if not exists discord_roster_async_idx
  on public.discord_roster (session_id) where is_async;
