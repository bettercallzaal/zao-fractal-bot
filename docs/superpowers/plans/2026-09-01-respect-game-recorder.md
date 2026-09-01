# Respect Game Recorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record a real ZAO fractal end to end - session, roster, elimination voting, results - into `fractal_sessions` and `fractal_scores`, and resume it after a restart, so the recording gap that has been open since 2026-03-23 stops growing.

**Architecture:** Three layers with an enforced boundary. `src/game/` is a pure engine (state plus event in, new state out, no I/O). `src/lib/gameRepo.ts` is the only file that talks to Supabase for game state. `src/commands/respectGame.ts` orchestrates. `src/discord/` is a thin adapter and the only layer that imports `discord.js`. The database is the state machine: a session row exists from `/start`, every vote is a write, and a failed write fails the round visibly rather than silently.

**Tech Stack:** TypeScript, discord.js 14.26.4, `@supabase/supabase-js`, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-01-respect-game-core-design.md` (merged as `bddfa1f`)

## Global Constraints

- **This is Phase 1 of five.** Spec section 2 "Delivery order". Phase 1 is the recorder. Onchain (spec section 9), the `cogs/timer.py` port (section 8), voice orchestration (section 7 steps 1 and 3) and history reads get their own plans. Do not build them here.
- **Database: the ZAO OS project only** (`efsxtoxvigqowjhgcbiz`). Spec section 4. A second Supabase project (`etwvzrmlxeobinrlytza`, cowork) has its own unrelated `bot_commands` table with different columns. Pointing the bot at it would half-work and then corrupt.
- **Status vocabulary is exactly `active`, `completed`, `paused`.** Spec section 5.2. These are the three values `ZAO OS V1/src/app/api/discord/fractal-live/route.ts` already queries. Do not invent a fourth.
- **Respect ladder is `[110, 68, 42, 26, 16, 10]`**, rank 1 (Level 6) through rank 6 (Level 1), already in `packages/shared/src/config.ts` as `RESPECT_POINTS`. Do not redefine it.
- **The consensus rule.** Spec section 7.1. A round is evaluated only once EVERY participant has voted, never on each vote as it lands. The threshold is a STRICT majority (4 of 6, 3 of 4), which makes a tie arithmetically impossible, so there is no tie break of any kind. If nobody clears the bar, voting stays open and members change their votes. Zaal, 2026-09-01: "No tie break we need consensus to move forward."
- **Resume is in Phase 1.** Spec section 2. A restart mid-fractal rehydrates participants, winners and votes from the database. It was originally phase 4; Zaal moved it.
- **Levels run 6 down to 1**: `STARTING_LEVEL = 6`, `ENDING_LEVEL = 1`, `MAX_GROUP_MEMBERS = 6`, `MIN_GROUP_MEMBERS = 2`, all in `packages/shared/src/config.ts`.
- **No file under `src/game/` or `src/commands/` may import `discord.js`.** Spec section 3. Task 2 enforces this with a test.
- **No fire-and-forget in the recording path.** Spec section 10. Every persistence call is awaited and its error propagated. This is the single rule the whole spec exists to establish.
- **Migrations are additive only.** No DROP, no UPDATE of existing rows. A snapshot of the affected tables is at `~/.zao/backups/zao-os-fractal-20260901/`.
- **No emojis and no em dashes** in code, comments, commit messages or docs.
- Tests must stay green. 129 pass on `main` after PR #15.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0005_respect_game.sql` | Create the three `discord_fractal_*` tables; add `fractal_sessions.meeting_number` |
| `src/game/session.ts` | Pure engine. `GameState`, `startSession`, `castVote`, `finalRanking`. No I/O |
| `src/game/session.test.ts` | Engine tests: rounds, tallies, ties, re-votes, dropouts |
| `src/lib/gameRepo.ts` | The only file that reads or writes game state in Supabase |
| `src/lib/gameRepo.test.ts` | Repo tests against a recording fake |
| `src/commands/respectGame.ts` | Actions: `startFractal`, `castFractalVote`, `endFractal`, `getFractal` |
| `src/commands/respectGame.test.ts` | Action tests, including that a failed write rejects |
| `src/discord/gameCommands.ts` | Slash command definitions and handlers. Imports discord.js |
| `src/discord/votingView.ts` | Vote buttons. Imports discord.js |
| `src/architecture.test.ts` | Asserts the layering rule |
| `src/index.ts` | Modified: register the Discord adapter |

---

## Task 1: Migration 0005

**Files:**
- Create: `supabase/migrations/0005_respect_game.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `discord_fractal_rounds`, `discord_fractal_votes`, `discord_fractal_awards`; column `fractal_sessions.meeting_number integer`.

There is no test framework for SQL in this repo, so this task's gate is that the file parses and is additive by inspection. Task 4 exercises the schema through the repo tests.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0005_respect_game.sql`:

```sql
-- ============================================================
-- Respect Game core - live session state
--
-- The database is the state machine. A session row exists from /start, not
-- from the end of the game, and every vote is a row. A bot restart mid-
-- fractal resumes from here.
--
-- Why this exists: MEASURED 2026-09-01, only 7 of 133 fractal_sessions rows
-- were ever written by the bot, and the newest is 2026-03-23. v1 wrote once,
-- at the end, through a fire-and-forget webhook. A recorder nothing depends
-- on can die unobserved. See
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
```

- [ ] **Step 2: Verify it is additive**

Run: `grep -inE "drop |truncate |delete from |update " supabase/migrations/0005_respect_game.sql`
Expected: no output. If anything matches, the statement must be removed - this migration runs against a production database that the public leaderboard reads.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0005_respect_game.sql
git commit -m "feat: migration 0005 - live Respect Game session state"
```

**Do not apply this migration yourself.** Migrations 0001 to 0004 have never been applied either (MEASURED: all six tables return 404 PGRST205). Applying five migrations to the live ZAO OS database is Zaal's to run. Surface the file and the ordering; do not execute it.

---

## Task 2: The layering test

**Files:**
- Create: `src/architecture.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing importable. It is a guard.

This comes second, before any engine code, so every task after it is written under the constraint rather than retrofitted to it.

- [ ] **Step 1: Write the failing test**

Create `src/architecture.test.ts`:

```typescript
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Spec section 3: the game engine and the action layer must be callable with
 * no Discord objects in their signatures, so a second surface in v3 is an
 * adapter rather than a rewrite. This is the kind of boundary that quietly
 * stops being true unless a test enforces it. */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('layering', () => {
  it('no file under src/game or src/commands imports discord.js', () => {
    const dirs = ['src/game', 'src/commands'].filter((d) => {
      try {
        return statSync(d).isDirectory();
      } catch {
        return false;
      }
    });
    const offenders: string[] = [];
    for (const dir of dirs) {
      for (const file of filesUnder(dir)) {
        const src = readFileSync(file, 'utf8');
        if (/from\s+['"]discord\.js['"]/.test(src)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/architecture.test.ts`
Expected: FAIL. `src/commands/executeCommand.ts` imports `type Client` from `discord.js`, so `offenders` is `['src/commands/executeCommand.ts']`.

This failure is correct and it is telling you something real: `captureRoster` takes a live `Client`. Fix it rather than weaken the test.

- [ ] **Step 3: Remove the discord.js type from the action layer**

In `src/commands/executeCommand.ts`, delete the import line:

```typescript
import type { Client } from 'discord.js';
```

and change the context interface to depend on a local structural type instead:

```typescript
/** The subset of the Discord client the presence collectors actually use.
 * Declared structurally so the action layer never imports discord.js - see
 * src/architecture.test.ts and spec section 3. The adapter passes the real
 * Client, which satisfies this shape. */
export interface DiscordClientLike {
  guilds: { fetch(id: string): Promise<unknown> };
}

interface ActionContext {
  supabase: SupabaseClient;
  client?: DiscordClientLike;
}
```

Then change the `executeCommand` signature's last parameter from `client?: Client` to `client?: DiscordClientLike`.

- [ ] **Step 4: Run the test and the full suite**

Run: `npx vitest run src/architecture.test.ts && npx tsc --noEmit`
Expected: architecture test PASSES.

If `tsc` complains that `DiscordClientLike` is not assignable where `collectVoicePresence` expects a `Client`, cast at the single call site inside the action with a comment naming the reason, rather than reintroducing the import at module scope:

```typescript
// The adapter always passes a real discord.js Client; the action layer
// only knows the structural shape. See src/architecture.test.ts.
const voice = await collectVoicePresence(ctx.client as never, guildId, voiceChannelId);
```

- [ ] **Step 5: Run everything**

Run: `npx vitest run`
Expected: all pass, count is 129 plus 1.

- [ ] **Step 6: Commit**

```bash
git add src/architecture.test.ts src/commands/executeCommand.ts
git commit -m "test: enforce that game and action layers never import discord.js"
```

---

## Task 3: The pure engine

**Files:**
- Create: `src/game/session.ts`
- Test: `src/game/session.test.ts`

**Interfaces:**
- Consumes: `RESPECT_POINTS`, `STARTING_LEVEL`, `MIN_GROUP_MEMBERS` from `@fractalbot/shared`; `findRoundWinner`, `majorityThreshold` from `../lib/voteThreshold.js`.
- Produces:

```typescript
export interface Participant { discordId: string; displayName: string; wallet: string | null }
export interface LevelWinner { level: number; discordId: string }
export type SessionStatus = 'active' | 'completed' | 'paused';

export interface GameState {
  threadId: string;
  meetingNumber: number;
  groupNumber: string;
  status: SessionStatus;
  currentLevel: number;
  participants: Participant[];
  winners: LevelWinner[];
  votes: Record<string, string>;
}

export interface VoteOutcome {
  state: GameState;
  accepted: boolean;
  reason?: 'session_not_active' | 'not_participant' | 'not_candidate';
  previousCandidateId: string | null;
  roundWinnerId: string | null;
  awaitingVoters: string[];
  sessionComplete: boolean;
}

export interface RankedMember {
  discordId: string; displayName: string; wallet: string | null;
  level: number; rank: number; respectPoints: number;
}

export function startSession(input: {
  threadId: string; meetingNumber: number; groupNumber: string; participants: Participant[];
}): GameState;
export function activeCandidates(state: GameState): Participant[];
export function votesNeeded(state: GameState): number;
export function awaitingVoters(state: GameState): string[];
export function castVote(state: GameState, voterId: string, candidateId: string): VoteOutcome;
export function finalRanking(state: GameState): RankedMember[];
```

**The rule that shapes this whole file:** a round is evaluated only once every
participant has voted, and the threshold is a strict majority so no tie can
exist. There is no tie-break code to write. If that tempts you to add one for
an edge case, the edge case is wrong.

- [ ] **Step 1: Write the failing tests**

Create `src/game/session.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  activeCandidates,
  awaitingVoters,
  castVote,
  finalRanking,
  type GameState,
  type Participant,
  startSession,
  votesNeeded,
} from './session.js';

function people(n: number): Participant[] {
  return Array.from({ length: n }, (_, i) => ({
    discordId: `u${i + 1}`,
    displayName: `User ${i + 1}`,
    wallet: `0x${String(i + 1).repeat(40)}`,
  }));
}

function newGame(n = 4): GameState {
  return startSession({
    threadId: 't1',
    meetingNumber: 111,
    groupNumber: '1',
    participants: people(n),
  });
}

/** Everyone votes for `candidateId` except the overrides given. */
function everyoneVotes(
  state: GameState,
  candidateId: string,
  overrides: Record<string, string> = {},
): GameState {
  let s = state;
  for (const p of s.participants) {
    const choice = overrides[p.discordId] ?? candidateId;
    const out = castVote(s, p.discordId, choice);
    s = out.state;
    if (out.roundWinnerId) break;
  }
  return s;
}

describe('startSession', () => {
  it('opens at level 6 with everyone a candidate and no votes', () => {
    const s = newGame(4);
    expect(s.status).toBe('active');
    expect(s.currentLevel).toBe(6);
    expect(s.winners).toEqual([]);
    expect(s.votes).toEqual({});
    expect(activeCandidates(s)).toHaveLength(4);
  });

  it('refuses a group below the minimum', () => {
    expect(() =>
      startSession({ threadId: 't', meetingNumber: 1, groupNumber: '1', participants: people(1) }),
    ).toThrow(/at least 2/);
  });
});

describe('votesNeeded', () => {
  it('is a strict majority of the full group, not half and not of the remaining candidates', () => {
    expect(votesNeeded(newGame(4))).toBe(3);
    expect(votesNeeded(newGame(6))).toBe(4);
  });

  it('does not fall as members are eliminated', () => {
    let s = newGame(4);
    s = everyoneVotes(s, 'u2');
    expect(s.winners).toHaveLength(1);
    expect(votesNeeded(s)).toBe(3);
  });
});

describe('the consensus rule', () => {
  it('does not resolve the round until every participant has voted', () => {
    // Three of four vote the same way. That is already a strict majority, but
    // the fourth member has not spoken, so the round stays open.
    let s = newGame(4);
    let out = castVote(s, 'u1', 'u2');
    out = castVote(out.state, 'u2', 'u2');
    out = castVote(out.state, 'u3', 'u2');
    expect(out.roundWinnerId).toBeNull();
    expect(out.awaitingVoters).toEqual(['u4']);
    expect(out.state.currentLevel).toBe(6);
  });

  it('resolves once the last voter speaks', () => {
    let out = castVote(newGame(4), 'u1', 'u2');
    out = castVote(out.state, 'u2', 'u2');
    out = castVote(out.state, 'u3', 'u2');
    out = castVote(out.state, 'u4', 'u3');
    expect(out.roundWinnerId).toBe('u2');
    expect(out.awaitingVoters).toEqual([]);
    expect(out.state.currentLevel).toBe(5);
    expect(out.state.votes).toEqual({});
  });

  it('leaves the round open when everyone has voted and nobody has a majority', () => {
    // 2-2 in a group of 4. No tie break exists, so nothing resolves and the
    // group keeps talking. Zaal, 2026-09-01: "No tie break we need consensus
    // to move forward."
    let out = castVote(newGame(4), 'u1', 'u3');
    out = castVote(out.state, 'u2', 'u3');
    out = castVote(out.state, 'u3', 'u4');
    out = castVote(out.state, 'u4', 'u4');
    expect(out.roundWinnerId).toBeNull();
    expect(out.awaitingVoters).toEqual([]);
    expect(out.state.currentLevel).toBe(6);
    expect(out.state.winners).toEqual([]);
  });

  it('resolves when someone changes their mind after a deadlock', () => {
    let out = castVote(newGame(4), 'u1', 'u3');
    out = castVote(out.state, 'u2', 'u3');
    out = castVote(out.state, 'u3', 'u4');
    out = castVote(out.state, 'u4', 'u4');
    out = castVote(out.state, 'u4', 'u3');
    expect(out.previousCandidateId).toBe('u4');
    expect(out.roundWinnerId).toBe('u3');
  });

  it('a strict majority makes two winners arithmetically impossible', () => {
    // The property the whole rule rests on. If this ever fails, a tie state
    // exists and the design has a hole rather than a missing tie break.
    for (const n of [2, 3, 4, 5, 6]) {
      expect(votesNeeded(newGame(n)) * 2).toBeGreaterThan(n);
    }
  });
});

describe('castVote validation', () => {
  it('replaces a voter previous choice rather than adding a second vote', () => {
    const first = castVote(newGame(6), 'u1', 'u2').state;
    const out = castVote(first, 'u1', 'u3');
    expect(out.previousCandidateId).toBe('u2');
    expect(out.state.votes).toEqual({ u1: 'u3' });
  });

  it('rejects a vote from someone who is not in the group', () => {
    const out = castVote(newGame(4), 'stranger', 'u2');
    expect(out.accepted).toBe(false);
    expect(out.reason).toBe('not_participant');
  });

  it('rejects a vote for someone already eliminated', () => {
    const s = everyoneVotes(newGame(4), 'u2');
    const out = castVote(s, 'u1', 'u2');
    expect(out.accepted).toBe(false);
    expect(out.reason).toBe('not_candidate');
  });

  it('rejects votes while paused', () => {
    const s: GameState = { ...newGame(4), status: 'paused' };
    expect(castVote(s, 'u1', 'u2').reason).toBe('session_not_active');
  });
});

describe('session completion', () => {
  it('completes when one candidate remains', () => {
    let s = newGame(3); // strict majority of 3 is 2
    s = everyoneVotes(s, 'u2');
    let out = castVote(s, 'u1', 'u3');
    out = castVote(out.state, 'u2', 'u3');
    out = castVote(out.state, 'u3', 'u3');
    expect(out.sessionComplete).toBe(true);
    expect(out.state.status).toBe('completed');
  });
});

describe('finalRanking', () => {
  it('assigns the Respect ladder by rank and gives the last member the lowest level', () => {
    let s = newGame(3);
    s = everyoneVotes(s, 'u2');
    let out = castVote(s, 'u1', 'u3');
    out = castVote(out.state, 'u2', 'u3');
    out = castVote(out.state, 'u3', 'u3');
    const ranked = finalRanking(out.state);
    expect(ranked.map((r) => [r.discordId, r.level, r.rank, r.respectPoints])).toEqual([
      ['u2', 6, 1, 110],
      ['u3', 5, 2, 68],
      ['u1', 4, 3, 42],
    ]);
  });

  it('refuses to rank a session that is not complete', () => {
    expect(() => finalRanking(newGame(4))).toThrow(/not complete/);
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run src/game/session.test.ts`
Expected: FAIL, cannot resolve `./session.js`.

- [ ] **Step 3: Write the engine**

Create `src/game/session.ts`:

```typescript
// Pure elimination-game engine. No I/O, no discord.js, no Supabase - see
// src/architecture.test.ts and spec section 3. Every function takes state and
// returns new state; nothing here mutates its input.
//
// Ported in behaviour from fractalbotapril2026 cogs/fractal/group.py, with one
// deliberate and load-bearing difference: the consensus rule in spec section
// 7.1. v1 read the tally after every vote and broke ties at random. This waits
// for every participant to vote and uses a strict majority, so a tie cannot
// arise and there is nothing to break. A split group does not resolve until
// somebody changes their mind, which is the intent rather than a deadlock.

import {
  MIN_GROUP_MEMBERS,
  RESPECT_POINTS,
  STARTING_LEVEL,
} from '@fractalbot/shared';
import { findRoundWinner, majorityThreshold } from '../lib/voteThreshold.js';

export interface Participant {
  discordId: string;
  displayName: string;
  wallet: string | null;
}

export interface LevelWinner {
  level: number;
  discordId: string;
}

export type SessionStatus = 'active' | 'completed' | 'paused';

export interface GameState {
  threadId: string;
  meetingNumber: number;
  groupNumber: string;
  status: SessionStatus;
  currentLevel: number;
  participants: Participant[];
  winners: LevelWinner[];
  /** voterDiscordId -> candidateDiscordId, current round only. */
  votes: Record<string, string>;
}

export interface VoteOutcome {
  state: GameState;
  accepted: boolean;
  reason?: 'session_not_active' | 'not_participant' | 'not_candidate';
  previousCandidateId: string | null;
  roundWinnerId: string | null;
  /** Who the round is still waiting on. Empty and no winner means the group
   * has voted and not agreed - the round stays open on purpose. */
  awaitingVoters: string[];
  sessionComplete: boolean;
}

export interface RankedMember {
  discordId: string;
  displayName: string;
  wallet: string | null;
  level: number;
  rank: number;
  respectPoints: number;
}

export function startSession(input: {
  threadId: string;
  meetingNumber: number;
  groupNumber: string;
  participants: Participant[];
}): GameState {
  if (input.participants.length < MIN_GROUP_MEMBERS) {
    throw new RangeError(
      `A fractal needs at least ${MIN_GROUP_MEMBERS} members, got ${input.participants.length}`,
    );
  }
  return {
    threadId: input.threadId,
    meetingNumber: input.meetingNumber,
    groupNumber: input.groupNumber,
    status: 'active',
    currentLevel: STARTING_LEVEL,
    participants: input.participants,
    winners: [],
    votes: {},
  };
}

export function activeCandidates(state: GameState): Participant[] {
  const won = new Set(state.winners.map((w) => w.discordId));
  return state.participants.filter((p) => !won.has(p.discordId));
}

/** Strict majority of the FULL group. Everyone votes every round, including
 * members who already hold a level, so the bar does not fall as the candidate
 * pool shrinks. */
export function votesNeeded(state: GameState): number {
  return majorityThreshold(state.participants.length);
}

export function awaitingVoters(state: GameState): string[] {
  return state.participants.filter((p) => !(p.discordId in state.votes)).map((p) => p.discordId);
}

export function castVote(state: GameState, voterId: string, candidateId: string): VoteOutcome {
  const unchanged = (reason: VoteOutcome['reason']): VoteOutcome => ({
    state,
    accepted: false,
    reason,
    previousCandidateId: null,
    roundWinnerId: null,
    awaitingVoters: awaitingVoters(state),
    sessionComplete: false,
  });

  if (state.status !== 'active') return unchanged('session_not_active');
  if (!state.participants.some((p) => p.discordId === voterId)) return unchanged('not_participant');
  if (!activeCandidates(state).some((p) => p.discordId === candidateId)) {
    return unchanged('not_candidate');
  }

  const previousCandidateId = state.votes[voterId] ?? null;
  const votes = { ...state.votes, [voterId]: candidateId };
  const voted: GameState = { ...state, votes };

  const stillOut = awaitingVoters(voted);
  if (stillOut.length > 0) {
    // The consensus rule: do not read the tally until the group has spoken.
    return {
      state: voted,
      accepted: true,
      previousCandidateId,
      roundWinnerId: null,
      awaitingVoters: stillOut,
      sessionComplete: false,
    };
  }

  const tally = new Map<string, number>();
  for (const choice of Object.values(votes)) {
    tally.set(choice, (tally.get(choice) ?? 0) + 1);
  }

  // A strict majority means at most one candidate can clear, so this is the
  // winner or there is none. No tie is representable.
  const winnerId = findRoundWinner(tally, state.participants.length);
  if (!winnerId) {
    return {
      state: voted,
      accepted: true,
      previousCandidateId,
      roundWinnerId: null,
      awaitingVoters: [],
      sessionComplete: false,
    };
  }

  const winners = [...state.winners, { level: state.currentLevel, discordId: winnerId }];
  const nextLevel = state.currentLevel - 1;
  const complete = state.participants.length - winners.length <= 1 || nextLevel < 1;

  return {
    state: {
      ...state,
      votes: {},
      winners,
      currentLevel: nextLevel,
      status: complete ? 'completed' : state.status,
    },
    accepted: true,
    previousCandidateId,
    roundWinnerId: winnerId,
    awaitingVoters: [],
    sessionComplete: complete,
  };
}

/** Ranked highest level first, with the Respect each member earned. The one
 * member never voted a level takes the next level down, as in group.py
 * end_fractal. */
export function finalRanking(state: GameState): RankedMember[] {
  if (state.status !== 'completed') {
    throw new Error('finalRanking: session is not complete');
  }
  const byId = new Map(state.participants.map((p) => [p.discordId, p]));
  const ordered = [...state.winners].sort((a, b) => b.level - a.level);

  const leftover = activeCandidates(state);
  const lowestAssigned = ordered.length > 0 ? ordered[ordered.length - 1].level : STARTING_LEVEL + 1;
  ordered.push(
    ...leftover.map((p, i) => ({ level: lowestAssigned - 1 - i, discordId: p.discordId })),
  );

  return ordered.map((w, index) => {
    const p = byId.get(w.discordId);
    if (!p) throw new Error(`finalRanking: no participant for ${w.discordId}`);
    return {
      discordId: p.discordId,
      displayName: p.displayName,
      wallet: p.wallet,
      level: w.level,
      rank: index + 1,
      respectPoints: RESPECT_POINTS[index] ?? 0,
    };
  });
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/game/session.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Run the full suite and the type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/game/session.ts src/game/session.test.ts
git commit -m "feat: elimination engine under the consensus rule, no tie break"
```

---

## Task 4: The repository layer

**Files:**
- Create: `src/lib/gameRepo.ts`
- Test: `src/lib/gameRepo.test.ts`

**Interfaces:**
- Consumes: `GameState`, `Participant`, `RankedMember`, `votesNeeded` from `../game/session.js`; `SupabaseClient`.
- Produces:

```typescript
export interface StoredSession { sessionId: string; state: GameState }
export async function createSession(sb: SupabaseClient, args: {
  state: GameState; name: string; guildId: string; facilitatorDiscordId: string;
}): Promise<StoredSession>;
export async function loadSessionByThread(sb: SupabaseClient, threadId: string): Promise<StoredSession | null>;
export async function recordVote(sb: SupabaseClient, args: {
  sessionId: string; level: number; votesNeeded: number;
  voterDiscordId: string; candidateDiscordId: string;
}): Promise<void>;
export async function resolveRound(sb: SupabaseClient, args: {
  sessionId: string; level: number; winnerDiscordId: string;
}): Promise<void>;
export async function completeSession(sb: SupabaseClient, args: {
  sessionId: string; ranking: RankedMember[];
}): Promise<void>;
```

Every function awaits its write and throws on error. Nothing here is fire-and-forget. That is the point of the whole spec.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/gameRepo.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { completeSession, createSession, recordVote } from './gameRepo.js';
import { startSession } from '../game/session.js';

interface Call { table: string; op: string; payload: unknown }

/** Records what was written and lets a test make any single write fail.
 * A mocked client cannot tell you a table is missing - see PR #15 - so this
 * fake pins tables and payloads, and the table names are checked against the
 * live database by hand in the migration. */
function fakeSupabase(failOn?: { table: string; op: string }) {
  const calls: Call[] = [];
  const api = {
    calls,
    from(table: string) {
      const fail = (op: string) =>
        failOn && failOn.table === table && failOn.op === op
          ? { error: { message: `simulated ${op} failure on ${table}` } }
          : { error: null };
      return {
        insert(payload: unknown) {
          calls.push({ table, op: 'insert', payload });
          const res = fail('insert');
          return {
            select: () => ({
              single: async () =>
                res.error ? { data: null, error: res.error } : { data: { id: 'sess-1' }, error: null },
            }),
            then: (r: (v: unknown) => unknown) => Promise.resolve(res).then(r),
          };
        },
        upsert(payload: unknown) {
          calls.push({ table, op: 'upsert', payload });
          return Promise.resolve(fail('upsert'));
        },
        update(payload: unknown) {
          calls.push({ table, op: 'update', payload });
          const res = fail('update');
          return { eq: () => ({ eq: () => Promise.resolve(res) }), then: (r: (v: unknown) => unknown) => Promise.resolve(res).then(r) };
        },
        select() {
          return {
            eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          };
        },
      };
    },
  };
  return api;
}

const state = startSession({
  threadId: 'thread-1',
  meetingNumber: 111,
  groupNumber: '1',
  participants: [
    { discordId: 'u1', displayName: 'One', wallet: '0x1' },
    { discordId: 'u2', displayName: 'Two', wallet: null },
  ],
});

describe('createSession', () => {
  it('writes an active session row carrying the meeting number', async () => {
    const sb = fakeSupabase();
    const stored = await createSession(sb as never, {
      state,
      name: 'ZAO Fractal 111 - Group 1',
      guildId: 'g1',
      facilitatorDiscordId: 'u1',
    });
    expect(stored.sessionId).toBe('sess-1');
    const row = sb.calls.find((c) => c.table === 'fractal_sessions')?.payload as Record<string, unknown>;
    expect(row.status).toBe('active');
    expect(row.meeting_number).toBe(111);
    expect(row.thread_id).toBe('thread-1');
  });

  it('rejects rather than resolving when the write fails', async () => {
    const sb = fakeSupabase({ table: 'fractal_sessions', op: 'insert' });
    await expect(
      createSession(sb as never, {
        state,
        name: 'n',
        guildId: 'g1',
        facilitatorDiscordId: 'u1',
      }),
    ).rejects.toThrow(/simulated/);
  });
});

describe('recordVote', () => {
  it('upserts so a changed vote replaces rather than duplicates', async () => {
    const sb = fakeSupabase();
    await recordVote(sb as never, {
      sessionId: 'sess-1',
      level: 6,
      votesNeeded: 2,
      voterDiscordId: 'u1',
      candidateDiscordId: 'u2',
    });
    const voteCall = sb.calls.find((c) => c.table === 'discord_fractal_votes');
    expect(voteCall?.op).toBe('upsert');
  });

  it('rejects when the vote write fails - a failed write must fail the round', async () => {
    const sb = fakeSupabase({ table: 'discord_fractal_votes', op: 'upsert' });
    await expect(
      recordVote(sb as never, {
        sessionId: 'sess-1',
        level: 6,
        votesNeeded: 2,
        voterDiscordId: 'u1',
        candidateDiscordId: 'u2',
      }),
    ).rejects.toThrow(/simulated/);
  });
});

describe('completeSession', () => {
  it('writes scores and flips the session to completed', async () => {
    const sb = fakeSupabase();
    await completeSession(sb as never, {
      sessionId: 'sess-1',
      ranking: [
        { discordId: 'u1', displayName: 'One', wallet: '0x1', level: 6, rank: 1, respectPoints: 110 },
        { discordId: 'u2', displayName: 'Two', wallet: null, level: 5, rank: 2, respectPoints: 68 },
      ],
    });
    const scores = sb.calls.find((c) => c.table === 'fractal_scores')?.payload as Record<string, unknown>[];
    expect(scores).toHaveLength(2);
    expect(scores[0].respect_points).toBe(110);
    expect(scores[0].session_id).toBe('sess-1');
    const update = sb.calls.find((c) => c.table === 'fractal_sessions' && c.op === 'update')
      ?.payload as Record<string, unknown>;
    expect(update.status).toBe('completed');
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run src/lib/gameRepo.test.ts`
Expected: FAIL, cannot resolve `./gameRepo.js`.

- [ ] **Step 3: Write the repository**

Create `src/lib/gameRepo.ts`:

```typescript
// The only file that reads or writes live game state in Supabase.
//
// Every write is awaited and every error is thrown. There is deliberately no
// fire-and-forget path here: v1 wrote through a webhook whose own header says
// "fire-and-forget semantics (10s timeout)", and the result was that only 7 of
// 133 sessions were ever recorded and nobody noticed for five months. See
// docs/superpowers/specs/2026-09-01-respect-game-core-design.md sections 1 and 10.
//
// Tables live in the ZAO OS project (efsxtoxvigqowjhgcbiz). A different
// Supabase project has its own unrelated bot_commands table - see spec
// section 4 before pointing this anywhere else.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { GameState, RankedMember } from '../game/session.js';

export interface StoredSession {
  sessionId: string;
  state: GameState;
}

export async function createSession(
  sb: SupabaseClient,
  args: { state: GameState; name: string; guildId: string; facilitatorDiscordId: string },
): Promise<StoredSession> {
  const { state } = args;
  const { data, error } = await sb
    .from('fractal_sessions')
    .insert({
      name: args.name,
      status: 'active',
      session_date: new Date().toISOString().slice(0, 10),
      meeting_number: state.meetingNumber,
      group_number: state.groupNumber,
      thread_id: state.threadId,
      discord_thread_id: state.threadId,
      guild_id: args.guildId,
      facilitator_discord_id: args.facilitatorDiscordId,
      participant_count: state.participants.length,
    })
    .select('id')
    .single();
  if (error) throw new Error(`createSession: ${error.message}`);
  if (!data?.id) throw new Error('createSession: insert returned no id');
  const sessionId = data.id as string;

  // The roster is persisted here, not just held in memory, because
  // loadSessionByThread rehydrates participants from it after a restart.
  // Without this write, resume would come back with an empty group.
  const roster = await sb.from('discord_roster').insert(
    state.participants.map((p) => ({
      session_id: sessionId,
      discord_id: p.discordId,
      display_name: p.displayName,
      wallet_address: p.wallet,
      sources: ['thread'],
      confidence: 'manual',
      captured_at: new Date().toISOString(),
    })),
  );
  if (roster.error) throw new Error(`createSession (roster): ${roster.error.message}`);

  return { sessionId, state };
}

/** Full rehydration: session, participants, level winners and the votes of
 * the round that was open. A crash during a live call must not cost the group
 * the round - Zaal moved this into Phase 1 on 2026-09-01.
 *
 * Participants come from discord_roster, which captureRoster already writes
 * keyed on session_id. Winners and the open round come from
 * discord_fractal_rounds; the open round is the one with resolved_at null. */
export async function loadSessionByThread(
  sb: SupabaseClient,
  threadId: string,
): Promise<StoredSession | null> {
  const session = await sb
    .from('fractal_sessions')
    .select('id, meeting_number, group_number, thread_id, status')
    .eq('thread_id', threadId)
    .maybeSingle();
  if (session.error) throw new Error(`loadSessionByThread: ${session.error.message}`);
  if (!session.data) return null;
  const sessionId = session.data.id as string;

  const roster = await sb
    .from('discord_roster')
    .select('discord_id, display_name, wallet_address')
    .eq('session_id', sessionId);
  if (roster.error) throw new Error(`loadSessionByThread (roster): ${roster.error.message}`);

  const rounds = await sb
    .from('discord_fractal_rounds')
    .select('id, level, winner_discord_id, resolved_at')
    .eq('session_id', sessionId)
    .order('level', { ascending: false });
  if (rounds.error) throw new Error(`loadSessionByThread (rounds): ${rounds.error.message}`);

  const rows = (rounds.data ?? []) as {
    id: string;
    level: number;
    winner_discord_id: string | null;
    resolved_at: string | null;
  }[];

  const winners = rows
    .filter((r) => r.resolved_at !== null && r.winner_discord_id !== null)
    .map((r) => ({ level: r.level, discordId: r.winner_discord_id as string }));

  const open = rows.find((r) => r.resolved_at === null);
  let votes: Record<string, string> = {};
  if (open) {
    const cast = await sb
      .from('discord_fractal_votes')
      .select('voter_discord_id, candidate_discord_id')
      .eq('round_id', open.id);
    if (cast.error) throw new Error(`loadSessionByThread (votes): ${cast.error.message}`);
    votes = Object.fromEntries(
      ((cast.data ?? []) as { voter_discord_id: string; candidate_discord_id: string }[]).map(
        (v) => [v.voter_discord_id, v.candidate_discord_id],
      ),
    );
  }

  // The level to resume on is the open round if there is one, otherwise one
  // below the lowest level already won.
  const currentLevel = open
    ? open.level
    : winners.length > 0
      ? Math.min(...winners.map((w) => w.level)) - 1
      : 6;

  return {
    sessionId,
    state: {
      threadId: session.data.thread_id as string,
      meetingNumber: (session.data.meeting_number as number) ?? 0,
      groupNumber: (session.data.group_number as string) ?? '1',
      status: session.data.status as GameState['status'],
      currentLevel,
      participants: ((roster.data ?? []) as {
        discord_id: string;
        display_name: string;
        wallet_address: string | null;
      }[]).map((r) => ({
        discordId: r.discord_id,
        displayName: r.display_name,
        wallet: r.wallet_address,
      })),
      winners,
      votes,
    },
  };
}

/** Opens the round row if it is not there yet, then upserts the vote. The
 * unique constraint on (round_id, voter_discord_id) is what makes a changed
 * vote a replacement rather than a duplicate. */
export async function recordVote(
  sb: SupabaseClient,
  args: {
    sessionId: string;
    level: number;
    votesNeeded: number;
    voterDiscordId: string;
    candidateDiscordId: string;
  },
): Promise<void> {
  const round = await sb
    .from('discord_fractal_rounds')
    .upsert(
      { session_id: args.sessionId, level: args.level, votes_needed: args.votesNeeded },
      { onConflict: 'session_id,level' },
    );
  if (round.error) throw new Error(`recordVote (round): ${round.error.message}`);

  const vote = await sb.from('discord_fractal_votes').upsert(
    {
      round_id: await roundIdFor(sb, args.sessionId, args.level),
      voter_discord_id: args.voterDiscordId,
      candidate_discord_id: args.candidateDiscordId,
      cast_at: new Date().toISOString(),
    },
    { onConflict: 'round_id,voter_discord_id' },
  );
  if (vote.error) throw new Error(`recordVote (vote): ${vote.error.message}`);
}

async function roundIdFor(sb: SupabaseClient, sessionId: string, level: number): Promise<string> {
  const { data, error } = await sb
    .from('discord_fractal_rounds')
    .select('id')
    .eq('session_id', sessionId)
    .eq('level', level)
    .maybeSingle();
  if (error) throw new Error(`roundIdFor: ${error.message}`);
  return (data?.id as string) ?? '';
}

export async function resolveRound(
  sb: SupabaseClient,
  args: { sessionId: string; level: number; winnerDiscordId: string },
): Promise<void> {
  const { error } = await sb
    .from('discord_fractal_rounds')
    .update({ winner_discord_id: args.winnerDiscordId, resolved_at: new Date().toISOString() })
    .eq('session_id', args.sessionId)
    .eq('level', args.level);
  if (error) throw new Error(`resolveRound: ${error.message}`);
}

export async function completeSession(
  sb: SupabaseClient,
  args: { sessionId: string; ranking: RankedMember[] },
): Promise<void> {
  const scores = await sb.from('fractal_scores').insert(
    args.ranking.map((r) => ({
      session_id: args.sessionId,
      member_name: r.displayName,
      wallet_address: r.wallet,
      discord_id: r.discordId,
      rank: r.rank,
      level: r.level,
      score: r.respectPoints,
      respect_points: r.respectPoints,
    })),
  );
  if (scores.error) throw new Error(`completeSession (scores): ${scores.error.message}`);

  const session = await sb
    .from('fractal_sessions')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', args.sessionId);
  if (session.error) throw new Error(`completeSession (session): ${session.error.message}`);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/gameRepo.test.ts`
Expected: PASS, 5 tests.

If the `insert(...).select().single()` chain in the fake does not line up with what `createSession` awaits, adjust the fake rather than the production code - the production shape must match `@supabase/supabase-js`, not the test.

- [ ] **Step 5: Run everything**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/gameRepo.ts src/lib/gameRepo.test.ts
git commit -m "feat: game state repository, every write awaited and thrown on"
```

---

## Task 5: The actions

**Files:**
- Create: `src/commands/respectGame.ts`
- Test: `src/commands/respectGame.test.ts`
- Modify: `src/commands/executeCommand.ts` (register the actions)

**Interfaces:**
- Consumes: everything from Task 3 and Task 4.
- Produces:

```typescript
export interface GameActionContext { supabase: SupabaseClient }
export async function startFractal(params: {
  threadId: string; guildId: string; facilitatorDiscordId: string;
  name: string; meetingNumber: number; groupNumber: string; participants: Participant[];
}, ctx: GameActionContext): Promise<{ sessionId: string; state: GameState; votesNeeded: number }>;
export async function castFractalVote(params: {
  sessionId: string; state: GameState; voterDiscordId: string; candidateDiscordId: string;
}, ctx: GameActionContext): Promise<VoteOutcome & { sessionId: string; ranking: RankedMember[] | null }>;
```

- [ ] **Step 1: Write the failing tests**

Create `src/commands/respectGame.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { castFractalVote, startFractal } from './respectGame.js';
import { startSession } from '../game/session.js';
import * as repo from '../lib/gameRepo.js';

const participants = [
  { discordId: 'u1', displayName: 'One', wallet: '0x1' },
  { discordId: 'u2', displayName: 'Two', wallet: '0x2' },
  { discordId: 'u3', displayName: 'Three', wallet: null },
];

describe('startFractal', () => {
  it('persists before returning, so a caller never has state the database lacks', async () => {
    const spy = vi
      .spyOn(repo, 'createSession')
      .mockResolvedValue({ sessionId: 'sess-1', state: startSession({ threadId: 't', meetingNumber: 111, groupNumber: '1', participants }) });
    const out = await startFractal(
      {
        threadId: 't',
        guildId: 'g',
        facilitatorDiscordId: 'u1',
        name: 'ZAO Fractal 111 - Group 1',
        meetingNumber: 111,
        groupNumber: '1',
        participants,
      },
      { supabase: {} as never },
    );
    expect(spy).toHaveBeenCalledOnce();
    expect(out.sessionId).toBe('sess-1');
    expect(out.votesNeeded).toBe(2);
    spy.mockRestore();
  });

  it('propagates a persistence failure instead of returning a session', async () => {
    const spy = vi.spyOn(repo, 'createSession').mockRejectedValue(new Error('db down'));
    await expect(
      startFractal(
        {
          threadId: 't',
          guildId: 'g',
          facilitatorDiscordId: 'u1',
          name: 'n',
          meetingNumber: 111,
          groupNumber: '1',
          participants,
        },
        { supabase: {} as never },
      ),
    ).rejects.toThrow('db down');
    spy.mockRestore();
  });
});

describe('castFractalVote', () => {
  it('does not persist a vote the engine rejected', async () => {
    const spy = vi.spyOn(repo, 'recordVote').mockResolvedValue(undefined);
    const state = startSession({ threadId: 't', meetingNumber: 111, groupNumber: '1', participants });
    const out = await castFractalVote(
      { sessionId: 'sess-1', state, voterDiscordId: 'stranger', candidateDiscordId: 'u2' },
      { supabase: {} as never },
    );
    expect(out.accepted).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('completes the session and returns the ranking on the final vote', async () => {
    vi.spyOn(repo, 'recordVote').mockResolvedValue(undefined);
    vi.spyOn(repo, 'resolveRound').mockResolvedValue(undefined);
    const complete = vi.spyOn(repo, 'completeSession').mockResolvedValue(undefined);

    let state = startSession({ threadId: 't', meetingNumber: 111, groupNumber: '1', participants });
    let out = await castFractalVote(
      { sessionId: 'sess-1', state, voterDiscordId: 'u1', candidateDiscordId: 'u2' },
      { supabase: {} as never },
    );
    out = await castFractalVote(
      { sessionId: 'sess-1', state: out.state, voterDiscordId: 'u3', candidateDiscordId: 'u2' },
      { supabase: {} as never },
    );
    out = await castFractalVote(
      { sessionId: 'sess-1', state: out.state, voterDiscordId: 'u1', candidateDiscordId: 'u3' },
      { supabase: {} as never },
    );
    out = await castFractalVote(
      { sessionId: 'sess-1', state: out.state, voterDiscordId: 'u3', candidateDiscordId: 'u3' },
      { supabase: {} as never },
    );

    expect(out.sessionComplete).toBe(true);
    expect(complete).toHaveBeenCalledOnce();
    expect(out.ranking?.map((r) => r.respectPoints)).toEqual([110, 68, 42]);
    vi.restoreAllMocks();
  });

  it('rejects when the vote write fails, so the round does not advance silently', async () => {
    const spy = vi.spyOn(repo, 'recordVote').mockRejectedValue(new Error('write failed'));
    const state = startSession({ threadId: 't', meetingNumber: 111, groupNumber: '1', participants });
    await expect(
      castFractalVote(
        { sessionId: 'sess-1', state, voterDiscordId: 'u1', candidateDiscordId: 'u2' },
        { supabase: {} as never },
      ),
    ).rejects.toThrow('write failed');
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run src/commands/respectGame.test.ts`
Expected: FAIL, cannot resolve `./respectGame.js`.

- [ ] **Step 3: Write the actions**

Create `src/commands/respectGame.ts`:

```typescript
// Orchestration for the Respect Game. Loads state, calls the pure engine,
// persists, returns plain JSON. No discord.js - see src/architecture.test.ts.
//
// The ordering rule in castFractalVote is the whole point of the spec: the
// vote is written BEFORE the outcome is returned, and a write failure rejects.
// A caller can therefore never show a round advancing that the database does
// not have.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  castVote,
  type GameState,
  type Participant,
  type RankedMember,
  startSession,
  type VoteOutcome,
  votesNeeded as computeVotesNeeded,
  finalRanking,
} from '../game/session.js';
import * as repo from '../lib/gameRepo.js';

export interface GameActionContext {
  supabase: SupabaseClient;
}

export async function startFractal(
  params: {
    threadId: string;
    guildId: string;
    facilitatorDiscordId: string;
    name: string;
    meetingNumber: number;
    groupNumber: string;
    participants: Participant[];
  },
  ctx: GameActionContext,
): Promise<{ sessionId: string; state: GameState; votesNeeded: number }> {
  const state = startSession({
    threadId: params.threadId,
    meetingNumber: params.meetingNumber,
    groupNumber: params.groupNumber,
    participants: params.participants,
  });
  const stored = await repo.createSession(ctx.supabase, {
    state,
    name: params.name,
    guildId: params.guildId,
    facilitatorDiscordId: params.facilitatorDiscordId,
  });
  return { sessionId: stored.sessionId, state, votesNeeded: computeVotesNeeded(state) };
}

export async function castFractalVote(
  params: {
    sessionId: string;
    state: GameState;
    voterDiscordId: string;
    candidateDiscordId: string;
  },
  ctx: GameActionContext,
): Promise<VoteOutcome & { sessionId: string; ranking: RankedMember[] | null }> {
  const levelBefore = params.state.currentLevel;
  const outcome = castVote(params.state, params.voterDiscordId, params.candidateDiscordId);

  if (!outcome.accepted) {
    return { ...outcome, sessionId: params.sessionId, ranking: null };
  }

  await repo.recordVote(ctx.supabase, {
    sessionId: params.sessionId,
    level: levelBefore,
    votesNeeded: computeVotesNeeded(params.state),
    voterDiscordId: params.voterDiscordId,
    candidateDiscordId: params.candidateDiscordId,
  });

  if (outcome.roundWinnerId) {
    await repo.resolveRound(ctx.supabase, {
      sessionId: params.sessionId,
      level: levelBefore,
      winnerDiscordId: outcome.roundWinnerId,
    });
  }

  let ranking: RankedMember[] | null = null;
  if (outcome.sessionComplete) {
    ranking = finalRanking(outcome.state);
    await repo.completeSession(ctx.supabase, { sessionId: params.sessionId, ranking });
  }

  return { ...outcome, sessionId: params.sessionId, ranking };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/commands/respectGame.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Run everything including the layering guard**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass. The architecture test must still pass - `respectGame.ts` imports no discord.js.

- [ ] **Step 6: Commit**

```bash
git add src/commands/respectGame.ts src/commands/respectGame.test.ts
git commit -m "feat: Respect Game actions, persisting before reporting an outcome"
```

---

## Task 6: The Discord adapter

**Files:**
- Create: `src/discord/gameCommands.ts`
- Create: `src/discord/votingView.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `startFractal`, `castFractalVote` from Task 5; `Participant`, `GameState` from Task 3.
- Produces: `registerGameCommands(client, supabase): void`.

This is the only layer that imports discord.js. It holds the in-flight `GameState` per thread in a `Map`, and reloads from `gameRepo.loadSessionByThread` if a thread is unknown after a restart.

- [ ] **Step 1: Write the voting buttons**

Create `src/discord/votingView.ts`:

```typescript
// Vote buttons for one elimination round. Adapter layer: this file may import
// discord.js, and nothing under src/game or src/commands may.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { Participant } from '../game/session.js';

export const VOTE_BUTTON_PREFIX = 'fractal_vote';

/** customId encodes the thread and candidate so a click needs no lookup table:
 * fractal_vote:<threadId>:<candidateDiscordId>. Discord caps customId at 100
 * characters; two snowflakes plus the prefix fits inside that. */
export function voteButtonId(threadId: string, candidateDiscordId: string): string {
  return `${VOTE_BUTTON_PREFIX}:${threadId}:${candidateDiscordId}`;
}

export function parseVoteButtonId(
  customId: string,
): { threadId: string; candidateDiscordId: string } | null {
  const parts = customId.split(':');
  if (parts.length !== 3 || parts[0] !== VOTE_BUTTON_PREFIX) return null;
  return { threadId: parts[1], candidateDiscordId: parts[2] };
}

/** Discord allows at most 5 buttons per row and 5 rows. A fractal group is
 * capped at 6 members (MAX_GROUP_MEMBERS), so two rows always suffice. */
export function buildVotingRows(
  threadId: string,
  candidates: Participant[],
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < candidates.length; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const c of candidates.slice(i, i + 5)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(voteButtonId(threadId, c.discordId))
          .setLabel(c.displayName.slice(0, 80))
          .setStyle(ButtonStyle.Primary),
      );
    }
    rows.push(row);
  }
  return rows;
}
```

- [ ] **Step 2: Write a test for the id round trip**

Append to `src/discord/votingView.test.ts` (create it):

```typescript
import { describe, expect, it } from 'vitest';
import { buildVotingRows, parseVoteButtonId, voteButtonId } from './votingView.js';

describe('vote button ids', () => {
  it('round trips a thread and candidate', () => {
    const id = voteButtonId('123', '456');
    expect(parseVoteButtonId(id)).toEqual({ threadId: '123', candidateDiscordId: '456' });
  });

  it('returns null for a customId from any other component', () => {
    expect(parseVoteButtonId('some_other_button')).toBeNull();
  });

  it('stays inside the Discord 100 character customId limit for snowflakes', () => {
    expect(voteButtonId('1071292017117761616', '785782556896788521').length).toBeLessThanOrEqual(100);
  });

  it('splits six candidates into two rows, since Discord allows five per row', () => {
    const candidates = Array.from({ length: 6 }, (_, i) => ({
      discordId: `u${i}`,
      displayName: `User ${i}`,
      wallet: null,
    }));
    expect(buildVotingRows('t', candidates)).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run and verify**

Run: `npx vitest run src/discord/votingView.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 4: Write the command handlers**

Create `src/discord/gameCommands.ts`:

```typescript
// Discord adapter for the Respect Game. The only layer that knows what an
// Interaction is. It translates interactions into action calls and action
// results into messages, and holds no game logic of its own.

import {
  type ChatInputCommandInteraction,
  type Client,
  Events,
  type Interaction,
  SlashCommandBuilder,
} from 'discord.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { activeCandidates, type GameState, type Participant } from '../game/session.js';
import { castFractalVote, startFractal } from '../commands/respectGame.js';
import { loadSessionByThread } from '../lib/gameRepo.js';
import { buildVotingRows, parseVoteButtonId } from './votingView.js';

/** In-flight state per thread. The database is the record; this is a cache in
 * front of it so a vote does not re-read the whole session. On a restart this
 * map is empty and the thread is reloaded from gameRepo. */
const live = new Map<string, { sessionId: string; state: GameState }>();

export const startCommand = new SlashCommandBuilder()
  .setName('start')
  .setDescription('Start a fractal in this thread')
  .addIntegerOption((o) =>
    o.setName('meeting').setDescription('Fractal number, e.g. 111').setRequired(true),
  )
  .addStringOption((o) =>
    o.setName('group').setDescription('Group number, e.g. 1').setRequired(true),
  );

async function handleStart(
  interaction: ChatInputCommandInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  await interaction.deferReply();
  const meetingNumber = interaction.options.getInteger('meeting', true);
  const groupNumber = interaction.options.getString('group', true);

  const channel = interaction.channel;
  if (!channel || !channel.isThread()) {
    await interaction.editReply('Run /start inside the fractal thread.');
    return;
  }

  // Phase 1 takes the roster from who is in the thread. Voice-based capture
  // and group splitting are Phase 4 - see the spec's delivery order.
  const members = await channel.members.fetch();
  const participants: Participant[] = members
    .filter((m) => !m.user?.bot)
    .map((m) => ({
      discordId: m.id,
      displayName: m.user?.displayName ?? m.id,
      wallet: null,
    }));

  try {
    const started = await startFractal(
      {
        threadId: channel.id,
        guildId: interaction.guildId ?? '',
        facilitatorDiscordId: interaction.user.id,
        name: `ZAO Fractal ${meetingNumber} - Group ${groupNumber}`,
        meetingNumber,
        groupNumber,
        participants,
      },
      { supabase },
    );
    live.set(channel.id, { sessionId: started.sessionId, state: started.state });

    await interaction.editReply(
      `Fractal ${meetingNumber}, group ${groupNumber}. ${participants.length} members, ` +
        `${started.votesNeeded} votes to take a level.\nVoting for Level ${started.state.currentLevel}:`,
    );
    await channel.send({
      content: `Level ${started.state.currentLevel}. Pick who contributed most.`,
      components: buildVotingRows(channel.id, activeCandidates(started.state)),
    });
  } catch (err) {
    // A failed write must be visible, not swallowed. This message existing at
    // all is the difference between this bot and the one that lost five months.
    await interaction.editReply(
      `Could not start the fractal - nothing was recorded. ${String(err)}`,
    );
  }
}

async function handleVote(interaction: Interaction, supabase: SupabaseClient): Promise<void> {
  if (!interaction.isButton()) return;
  const parsed = parseVoteButtonId(interaction.customId);
  if (!parsed) return;

  let entry = live.get(parsed.threadId);
  if (!entry) {
    // Restart recovery. The database is the record, so a fractal survives the
    // process dying mid-round - spec section 2, moved into Phase 1 by Zaal on
    // 2026-09-01 because a crash during a live call should not cost the round.
    try {
      const restored = await loadSessionByThread(supabase, parsed.threadId);
      if (!restored || restored.state.status !== 'active') {
        await interaction.reply({
          content: 'That fractal is not open. Ask the facilitator to run /start.',
          ephemeral: true,
        });
        return;
      }
      entry = { sessionId: restored.sessionId, state: restored.state };
      live.set(parsed.threadId, entry);
    } catch (err) {
      await interaction.reply({
        content: `Could not reload that fractal, so your vote was NOT recorded. ${String(err)}`,
        ephemeral: true,
      });
      return;
    }
  }

  try {
    const out = await castFractalVote(
      {
        sessionId: entry.sessionId,
        state: entry.state,
        voterDiscordId: interaction.user.id,
        candidateDiscordId: parsed.candidateDiscordId,
      },
      { supabase },
    );

    if (!out.accepted) {
      const why =
        out.reason === 'not_participant'
          ? 'You are not in this group.'
          : out.reason === 'not_candidate'
            ? 'That member already has a level.'
            : 'Voting is not open.';
      await interaction.reply({ content: why, ephemeral: true });
      return;
    }

    live.set(parsed.threadId, { sessionId: entry.sessionId, state: out.state });

    // Votes are public. Spec section 7: two years of the game have run this
    // way and the fractal's premise is peers openly accounting for
    // contribution.
    const name = `<@${interaction.user.id}>`;
    const target = `<@${parsed.candidateDiscordId}>`;
    await interaction.reply({
      content: out.previousCandidateId
        ? `${name} changed vote to ${target}`
        : `${name} voted for ${target}`,
    });

    const channel = interaction.channel;
    if (!channel?.isSendable()) return;

    if (out.sessionComplete && out.ranking) {
      const lines = out.ranking.map(
        (r) => `${r.rank}. <@${r.discordId}> - Level ${r.level}, ${r.respectPoints} Respect`,
      );
      await channel.send(
        `Fractal complete and recorded.\n${lines.join('\n')}\n\n` +
          'Onchain submission lands in a later release. Results are saved.',
      );
      live.delete(parsed.threadId);
      return;
    }

    if (out.roundWinnerId) {
      await channel.send({
        content:
          `Level ${out.state.currentLevel + 1}: <@${out.roundWinnerId}>.\n` +
          `Voting for Level ${out.state.currentLevel}.`,
        components: buildVotingRows(parsed.threadId, activeCandidates(out.state)),
      });
    }
  } catch (err) {
    await interaction.reply({
      content: `Your vote was NOT recorded and the round has not advanced. ${String(err)}`,
    });
  }
}

export function registerGameCommands(client: Client, supabase: SupabaseClient): void {
  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isChatInputCommand() && interaction.commandName === 'start') {
      await handleStart(interaction, supabase);
      return;
    }
    if (interaction.isButton()) {
      await handleVote(interaction, supabase);
    }
  });
}
```

- [ ] **Step 5: Wire it into the bot**

In `src/index.ts`, add the import beside the existing ones:

```typescript
import { registerGameCommands, startCommand } from './discord/gameCommands.js';
```

and inside the `Events.ClientReady` handler, after `subscribeToCommands(supabase, readyClient);`:

```typescript
  registerGameCommands(readyClient, supabase);
  void readyClient.application?.commands.create(startCommand.toJSON());
  console.log('Respect Game commands registered');
```

- [ ] **Step 6: Run the full suite and the type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass. The architecture test must still pass - `src/discord/` is not covered by it, and that is correct.

- [ ] **Step 7: Commit**

```bash
git add src/discord/ src/index.ts
git commit -m "feat: Discord adapter for the Respect Game - /start and vote buttons"
```

---

## Task 7: Manual verification against a real Discord server

**Files:** none.

This is the only task that proves the thing works, and it cannot be automated in this repo. It needs the migration applied and secrets set, both of which are Zaal's to run (spec section 12).

- [ ] **Step 1: Confirm the prerequisites are done**

- Migrations 0001 to 0005 applied to the ZAO OS project.
- `.env` populated: `DISCORD_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BOT_API_SECRET`, `HTTP_PORT`.
- Bot invited to a test server with a thread it can post in.

- [ ] **Step 2: Run the bot**

Run: `npm run dev`
Expected: "Logged in as ...", "Respect Game commands registered".

- [ ] **Step 3: Run one fractal with three people**

In a thread, run `/start meeting:999 group:test`. Vote until the session completes.

- [ ] **Step 4: Verify the database, not the Discord messages**

The messages are a projection. Check the record:

```bash
# Reads the ZAO OS project. Never print the key.
node -e '
const fs=require("fs"),os=require("os");
const env=Object.fromEntries(fs.readFileSync(os.homedir()+"/Documents/ZAO OS V1/.env.local","utf8")
  .split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#"))
  .map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1).trim().replace(/^["\x27]|["\x27]$/g,"")]}));
const url=env.NEXT_PUBLIC_SUPABASE_URL||env.SUPABASE_URL;
const key=Object.entries(env).find(([k])=>k.includes("SERVICE_ROLE_KEY"))[1];
fetch(url+"/rest/v1/fractal_sessions?select=name,status,meeting_number,participant_count,completed_at&meeting_number=eq.999",
  {headers:{apikey:key,Authorization:"Bearer "+key}}).then(r=>r.json()).then(d=>console.log(d));
'
```

Expected: one row, `status: "completed"`, `meeting_number: 999`, a non-null `completed_at`. Then check `fractal_scores` for that `session_id` has one row per member with the right `respect_points`.

- [ ] **Step 5: Verify the failure path, because it is the point of the spec**

Stop the database from accepting writes (revoke the key in `.env` and restart, or point `SUPABASE_URL` at a bad host), then run `/start`.

Expected: Discord shows "Could not start the fractal - nothing was recorded." **It must not appear to work.** If it silently starts anyway, that is the March defect reproduced and the task fails.

- [ ] **Step 6: Clean up the test rows**

```sql
delete from public.fractal_scores where session_id in
  (select id from public.fractal_sessions where meeting_number = 999);
delete from public.fractal_sessions where meeting_number = 999;
```

Zaal runs this, same as the migration.

---

## Self-Review

**Spec coverage for Phase 1.** Section 3 architecture: Tasks 2 to 6. Section 4 which database: Task 1 and Task 4 comments. Section 5.1 measured shapes: Task 4 writes only measured columns. Section 5.2 status vocabulary: Task 1 and Task 4 use `active`, `completed` only, and never invent a fourth. Section 5.3 new tables: Task 1. Section 5.4 database as state machine: Tasks 4 and 5. Section 6 command surface, gameplay half: Task 6. Section 7 steps 2, 5, 6: Tasks 3 and 6. Section 10 failure handling: Tasks 4, 5, 6 and the Task 7 step 5 gate. Section 11 testing including the layering test: Task 2.

**Deliberately not covered here, and each has a named home.** Section 8 timer, Phase 3. Section 9 onchain, Phase 2 - `discord_fractal_awards` is created in Task 1 so Phase 2 needs no migration. Section 7 steps 1 and 3, voice splitting and moves, Phase 4. Section 6 history reads, Phase 5.

**Type consistency.** `GameState`, `Participant`, `RankedMember` and `VoteOutcome` are defined once in Task 3 and imported unchanged in Tasks 4, 5 and 6. `votesNeeded` is the engine function throughout; the repo column is `votes_needed`. `sessionId` is a string everywhere.

**Two earlier open items, both now closed by Zaal on 2026-09-01.**

1. **The tie break is gone entirely.** The first draft of this plan proposed a
   deterministic lowest-id break and flagged it as a behaviour change not in
   the spec. That flag was right and the answer was neither option: "No tie
   break we need consensus to move forward." The round is now evaluated only
   once every participant has voted, the threshold is a strict majority so no
   tie can exist, and a split group simply does not resolve. Spec section 7.1.
   `majorityThreshold` was corrected at the same time - it returned exactly
   half for even groups while calling itself a majority, and its own test
   asserted that bug under the name "strict majority".

2. **Resume is in Phase 1.** `loadSessionByThread` now rehydrates
   participants, level winners and the open round's votes, `createSession`
   persists the roster so there is something to rehydrate from, and the vote
   handler reloads a thread it does not have in memory. Moved out of Phase 4
   by Zaal, on the grounds that a crash during a live call should never cost
   the group the round.

**One thing a reviewer should still push back on.** The consensus rule means a
group that will not agree has no exit. That is deliberate - Zaal chose the
option with that tradeoff written into it - but nothing in Phase 1 tells a
facilitator how long a round has been open. If it bites in practice, the fix
is a nudge, not a tie break.
