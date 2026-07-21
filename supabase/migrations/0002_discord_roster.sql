-- ============================================================
-- discord_roster - per-session presence snapshot for roster capture
--
-- One row per person observed present in a fractal session, with the
-- source(s) that observed them and how they resolved to a Respect member.
-- Written by the bot's captureRoster action; read by the /fractals dashboard
-- (roster visibility) and by the scoring flow (matched rows are safe to score).
--
-- The persistent Discord<->Respect binding (the "registry") is NOT here - it
-- lives in the existing ZAO OS `users` table (users.discord_id ->
-- primary_wallet), which registerMember upserts. This table is only the
-- point-in-time snapshot.
--
-- `session_id` is a soft reference to fractal_sessions(id) (a ZAO OS table);
-- no hard FK so this migration stays self-contained. It is nullable so a
-- roster can be captured before a session row is opened.
-- ============================================================

create table if not exists public.discord_roster (
  id uuid primary key default gen_random_uuid(),
  session_id uuid,
  discord_id text,                 -- null for manual name-only entries
  display_name text not null,
  sources text[] not null default '{}'::text[],  -- 'voice' | 'text' | 'reaction' | 'manual'
  confidence text not null
    check (confidence in ('registry', 'exact', 'fuzzy', 'ambiguous', 'none')),
  member_name text,                -- resolved Respect member (registry/exact/fuzzy)
  wallet_address text,
  fid integer,
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists discord_roster_session_idx on public.discord_roster (session_id);
create index if not exists discord_roster_discord_id_idx on public.discord_roster (discord_id);
create index if not exists discord_roster_confidence_idx on public.discord_roster (confidence);

comment on table public.discord_roster is
  'Per-session presence snapshot. captureRoster writes; the /fractals dashboard and scoring read. Registry binding lives in users.discord_id, not here.';

-- RLS: bot writes via service role (bypasses RLS); dashboard reads via anon.
alter table public.discord_roster enable row level security;

create policy "Public read" on public.discord_roster
  for select using (true);

-- Live roster updates on the dashboard as captures land.
alter publication supabase_realtime add table public.discord_roster;
