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

-- Dropped by lookup rather than by name. 'discord_roster_confidence_check' is
-- what Postgres generates for 0002's unnamed column CHECK, but that could not
-- be verified against a real database from this machine, and a wrong guess
-- fails silently: drop-if-exists no-ops, then the add below errors on an
-- already-migrated database. Matching on the constraint definition removes the
-- assumption. Scoped to checks mentioning `confidence`, so no other constraint
-- on the table is touched.
--
-- The drop and the add live in the SAME do $$ ... $$ block, not two separate
-- statements. This file is concatenated with 0001-0005 into one combined
-- script that is already wrapped in an outer begin;/commit;, so this file
-- must not add its own transaction control - a nested commit would commit
-- the outer transaction early and destroy the all-or-nothing guarantee for
-- the whole run. A do block executes as a single statement, so putting both
-- the drop and the add inside it makes drop-then-add atomic (both happen or
-- neither does, even run statement-by-statement by hand) without touching
-- begin/commit at all.
do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public'
      and rel.relname = 'discord_roster'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%confidence%'
  loop
    execute format('alter table public.discord_roster drop constraint %I', c.conname);
  end loop;

  execute $c1$
    alter table public.discord_roster
      add constraint discord_roster_confidence_check
      check (confidence in ('registry', 'exact', 'fuzzy', 'ambiguous', 'none', 'manual'))
  $c1$;
end $$;

alter table public.discord_roster
  add column if not exists is_async boolean not null default false;

comment on column public.discord_roster.is_async is
  'True for a member ranked from an async submission - votable-for, never voted-with. Spec 2026-09-02 section 2.';

create index if not exists discord_roster_async_idx
  on public.discord_roster (session_id) where is_async;
