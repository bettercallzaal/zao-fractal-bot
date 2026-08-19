-- ============================================================
-- Async contributions - work logged outside the live call
--
-- Members who cannot make the weekly call (or who ship mid-week) log what
-- they did as it happens; facilitators pull a per-member digest during the
-- meeting so async work is seen when the circle ranks. Year-3 feedback item.
--
-- Written by the bot (service role) via the submitContribution action; read
-- back by listContributions and the /fractals dashboard (anon).
-- discord_ prefix + RLS + public read, same convention as discord_roster.
--
-- Deliberately stores NO wallet address: the roster/presence tables already
-- expose more identity linkage than the audit liked (L1), so contributions
-- keep to discord_id + display name and wallets resolve at read time via
-- the service role.
-- ============================================================

create table if not exists public.discord_contributions (
  id uuid primary key default gen_random_uuid(),
  discord_id text,                    -- null when logged for someone by name
  display_name text not null,
  content text not null,
  links jsonb not null default '[]'::jsonb,   -- URLs extracted from content
  meeting_number integer,             -- null = "next meeting", tagged later
  source text not null default 'command',     -- 'command' | 'channel'
  reviewed boolean not null default false,    -- true once a circle saw it
  created_at timestamptz not null default now()
);

create index if not exists discord_contributions_meeting_idx
  on public.discord_contributions (meeting_number);
create index if not exists discord_contributions_discord_id_idx
  on public.discord_contributions (discord_id);
create index if not exists discord_contributions_created_idx
  on public.discord_contributions (created_at desc);
create index if not exists discord_contributions_unreviewed_idx
  on public.discord_contributions (created_at desc) where reviewed = false;

comment on table public.discord_contributions is
  'Async contribution log - work members report outside the live call, surfaced to facilitators as a digest when the circle ranks.';

-- RLS: bot writes via service role (bypasses RLS); dashboard reads via anon.
alter table public.discord_contributions enable row level security;

create policy "Public read" on public.discord_contributions for select using (true);

-- Dashboard can watch contributions arrive live.
alter publication supabase_realtime add table public.discord_contributions;
