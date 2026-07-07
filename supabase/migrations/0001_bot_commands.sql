create table if not exists public.bot_commands (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  params jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  requested_by text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'failed')),
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists bot_commands_status_idx on public.bot_commands (status);

alter table public.bot_commands enable row level security;

-- Only rows inserted through the service role (Next.js API route, after the
-- Supreme Admin check) or the bot's own service-role connection may touch
-- this table - no anon/authenticated-role policy is defined, which means
-- only requests using the Supabase service role key can read/write it.
