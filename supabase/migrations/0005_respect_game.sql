-- ============================================================
-- Respect Game core - live session state
--
-- The database is the state machine. A session row exists from /start, not
-- from the end of the game, and every vote is a row. A bot restart mid-
-- fractal resumes from here.
--
-- Why this exists: MEASURED 2026-09-01, only 7 of 133 fractal_sessions rows
-- were ever written by the bot, and the newest is 2026-03-23. The cause was
-- not a code bug - the deployed bot's .env has no Supabase credentials at
-- all, so its only write path was a webhook whose own header reads
-- "fire-and-forget semantics (10s timeout)". A recorder nothing depends on
-- can die unobserved. See
-- docs/superpowers/specs/2026-09-01-respect-game-core-design.md section 1.
--
-- Additive only. No DROP, no UPDATE. fractal_sessions and fractal_scores are
-- shared with the ZAO OS app; this adds one column to the former and nothing
-- to the latter.
-- ============================================================

-- proposeBreakoutResultX2 requires a meeting number. Today it exists only
-- inside the free-text name, like 'ZAO Fractal 92 - Group 1'.
alter table public.fractal_sessions
  add column if not exists meeting_number integer;

comment on column public.fractal_sessions.meeting_number is
  'Fractal number, e.g. 92. Required by the onchain proposal; previously only encoded in name.';

-- One row per elimination round. current_level descends 6 -> 1.
create table if not exists public.discord_fractal_rounds (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.fractal_sessions(id) on delete cascade,
  level integer not null,
  votes_needed integer not null,
  started_at timestamptz not null default now(),
  resolved_at timestamptz,
  winner_discord_id text,
  unique (session_id, level)
);

create index if not exists discord_fractal_rounds_session_idx
  on public.discord_fractal_rounds (session_id);
create index if not exists discord_fractal_rounds_open_idx
  on public.discord_fractal_rounds (session_id) where resolved_at is null;

comment on table public.discord_fractal_rounds is
  'One elimination round of a fractal. Live state, not a summary written at the end.';

-- One row per voter per round. A changed vote is an upsert, not a duplicate.
create table if not exists public.discord_fractal_votes (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.discord_fractal_rounds(id) on delete cascade,
  voter_discord_id text not null,
  candidate_discord_id text not null,
  cast_at timestamptz not null default now(),
  unique (round_id, voter_discord_id)
);

create index if not exists discord_fractal_votes_round_idx
  on public.discord_fractal_votes (round_id);

comment on table public.discord_fractal_votes is
  'Votes cast in a round. Unique on (round_id, voter_discord_id) so re-voting replaces rather than duplicates.';

-- The onchain award lifecycle. Written in Phase 1, driven in Phase 2.
-- MEASURED: OREC voteLen 72h + vetoLen 72h, so an award cannot execute for
-- six days after its session. This table is what survives that gap.
create table if not exists public.discord_fractal_awards (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.fractal_sessions(id) on delete cascade,
  proposal_id text,
  call_used text,                  -- 'proposeBreakoutResultX2' | 'proposeRespectAccountBatch'
  mint_type integer,               -- 10 = Respect Breakout x2
  period_number integer,
  meeting_number integer,
  status text not null default 'pending'
    check (status in ('pending', 'proposed', 'executed', 'failed')),
  tx_hash text,
  covers_wallets jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  executed_at timestamptz
);

create index if not exists discord_fractal_awards_session_idx
  on public.discord_fractal_awards (session_id);
create index if not exists discord_fractal_awards_open_idx
  on public.discord_fractal_awards (created_at desc) where status in ('pending', 'proposed');

comment on table public.discord_fractal_awards is
  'Onchain award lifecycle for a session. Separate from the session because execution lands about six days later.';

-- RLS: bot writes via service role (bypasses RLS); dashboard reads via anon.
-- Same convention as discord_roster and discord_contributions.
alter table public.discord_fractal_rounds enable row level security;
alter table public.discord_fractal_votes enable row level security;
alter table public.discord_fractal_awards enable row level security;

create policy "Public read" on public.discord_fractal_rounds for select using (true);
create policy "Public read" on public.discord_fractal_votes for select using (true);
create policy "Public read" on public.discord_fractal_awards for select using (true);

alter publication supabase_realtime add table public.discord_fractal_rounds;
alter publication supabase_realtime add table public.discord_fractal_votes;
