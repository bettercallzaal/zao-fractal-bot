-- ============================================================
-- One active fractal per thread, enforced by the database
--
-- Found in the pre-deployment security review, 2026-09-13, while getting v2
-- onto a host for the first time.
--
-- `createSession` inserts into fractal_sessions unconditionally, and nothing
-- stops two rows existing for one thread_id. Two ways that bites:
--
-- 1. Two bot instances (the live v1 and this one, or two copies of this one)
--    both answer the same /start. Each writes its own session row, so the
--    unique constraints that do exist - discord_fractal_rounds (session_id,
--    level) and discord_fractal_votes (round_id, voter_discord_id) - protect
--    nothing, because they are scoped per session. Every vote lands twice and
--    completeSession writes two full sets of fractal_scores: 110 + 110,
--    68 + 68, for one real fractal. Those rows are what a human reads when
--    building proposeBreakoutResultX2, so the error propagates to an onchain
--    award.
--
-- 2. A single bot, /start run twice in one thread. Two active rows, and
--    loadSessionByThread's .maybeSingle() then errors on every restart, so
--    every vote in that thread reports "your vote was NOT recorded".
--
-- A partial index, not a plain unique index: a thread can hold a finished
-- fractal and later hold another one. Only one may be active at a time.
--
-- Additive. No DROP, no UPDATE. fractal_sessions is shared with the ZAO OS app.
--
-- IF THIS FAILS TO APPLY, there are already duplicate active rows. Do not
-- force it. Find them first:
--   select thread_id, count(*), array_agg(id)
--   from public.fractal_sessions
--   where status = 'active' and thread_id is not null
--   group by thread_id having count(*) > 1;
-- Each group is one real fractal recorded more than once, and which row to
-- keep is a human decision about which scores are the real ones - check discord_fractal_votes
-- for each session id before closing or deleting anything.
-- ============================================================

create unique index if not exists fractal_sessions_one_active_per_thread
  on public.fractal_sessions (thread_id)
  where status = 'active' and thread_id is not null;

comment on index public.fractal_sessions_one_active_per_thread is
  'One open fractal per Discord thread. Stops a second bot instance, or a second /start, recording the same fractal twice and doubling every score.';
