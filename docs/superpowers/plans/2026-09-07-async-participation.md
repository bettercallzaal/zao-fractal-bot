# Async Fractal Participation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let someone submit in the 12 hours before a fractal and be ranked in it without attending - votable-for, never voted-with.

**Architecture:** `GameState.participants` keeps its current meaning (every candidate) and gains `asyncEntrantIds`, a subset naming who never votes. Vote arithmetic moves from the candidate count to a derived `voters(state)`; ranking, elimination and payout are untouched. A new pure `seatGroups` decides how many groups exist from the total candidate pool, so async entrants create the seats they occupy rather than competing for leftovers.

**Tech Stack:** TypeScript, vitest, discord.js (adapter layer only), Supabase via `@supabase/supabase-js`.

**Spec:** `docs/superpowers/specs/2026-09-02-async-participation-design.md` (amended 2026-09-07 with sections 3.1 and 3.2)

## Global Constraints

- `MAX_GROUP_MEMBERS = 6`, already in `packages/shared/src/config.ts`. `RESPECT_POINTS` has exactly six entries and `finalRanking` pays `RESPECT_POINTS[index] ?? 0`, so a seventh candidate silently earns nothing. The cap is what keeps that branch unreachable.
- `MIN_VOTERS = 3` (spec 3.2). Below it, no async entrant is admitted at all.
- Async window is **12 hours** before session start (spec 5), compared against the session's start, not wall clock.
- **The existing 16 `session.test.ts` cases must pass unmodified.** Spec section 9 states this as the check on whether the split was done right. If a task needs to edit one, stop and re-read section 2.
- No discord.js under `src/game` or `src/commands` - asserted by `src/architecture.test.ts`.
- Every Supabase write is awaited and throws on error. There is deliberately no fire-and-forget path (`gameRepo.ts` header; spec 2026-09-01 section 10).
- No model in the digest path (spec 7). Contributions are shown verbatim.

## A deviation from the spec's interface sketch, and why

Spec section 2 sketches:

```ts
interface GameState {
  voters: Participant[];
  asyncEntrants: Participant[];
}
```

This plan instead keeps `participants: Participant[]` as the candidate union and adds `asyncEntrantIds: string[]`, with `voters()` and `asyncEntrants()` as derived functions.

The reason is section 9's harder constraint: the 16 existing tests must pass unmodified. Those tests construct state through `startSession({ participants })` and read `s.participants` (`session.test.ts:25,36,57`; `playthrough.test.ts:14,27,55,96`). Renaming the field breaks all of them, and so would every consumer at `gameCommands.ts:37,192`, `gameRepo.ts:43,55`. The union-plus-subset representation delivers section 2's actual requirement - a person can be ranked without voting - while `activeCandidates`, `finalRanking`, the completion check and the whole persistence layer keep working unchanged.

The comment in the spec, `candidates = voters ++ asyncEntrants`, still holds. Only the direction of derivation is reversed.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `packages/shared/src/config.ts` | Tunable constants | Modify - add `MIN_VOTERS`, `ASYNC_WINDOW_HOURS` |
| `src/game/session.ts` | Pure elimination engine | Modify - `asyncEntrantIds`, `voters`, `asyncEntrants`, voter-based vote arithmetic |
| `src/game/seating.ts` | Pure group allocation (spec 3.1/3.2) | **Create** |
| `src/lib/asyncEligibility.ts` | Window + intro gate, earliest-first ordering (spec 4/5) | **Create** |
| `src/lib/gameRepo.ts` | The only file writing live game state | Modify - persist and rehydrate async membership |
| `src/commands/respectGame.ts` | Actions over the engine | Modify - accept async entrants at start |
| `src/discord/votingView.ts` | Vote buttons | Modify - mark async candidates |
| `src/discord/gameCommands.ts` | `/start` and vote handling | Modify - voter-count copy |
| `supabase/migrations/0006_async_participation.sql` | Schema | **Create** |

Tasks 1-3 are prerequisites for everything else. Tasks 4 and 5 are independent of each other and can run in either order. Tasks 6 and 7 depend on 3.

---

### Task 1: Fix the roster write that will fail on first `/start`

**This is not async work.** It is a live blocker found while reading the schema for this plan, and it stops `/start` completely the moment the migrations are applied. Async participation extends exactly this insert, so it is fixed first.

`discord_roster` constrains `confidence` to `('registry', 'exact', 'fuzzy', 'ambiguous', 'none')` (`0002_discord_roster.sql:25-26`). `gameRepo.ts:61` inserts `confidence: 'manual'`. That insert fails with a check violation, `createSession` throws, and `/start` reports "Could not start the fractal - nothing was recorded."

The existing tests pass because `gameRepo.test.ts` mocks Supabase - a check constraint only exists in the database.

`'manual'` is the right value to keep, not a bug in the caller: the other five are *name-resolution* confidences from `nameResolver.ts`, and a facilitator naming the group at `/start` is a different provenance from `'none'`, which means "we tried to resolve this person and failed". Writing `'none'` would make the `/fractals` dashboard show facilitator-confirmed members as unresolved. So the constraint widens.

The migration is written to be correct whether or not `0002` has already been applied.

**Files:**
- Create: `supabase/migrations/0006_async_participation.sql`
- Test: `src/lib/gameRepo.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `discord_roster.confidence` accepts `'manual'`; `discord_roster.is_async boolean not null default false` exists for Task 6.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/gameRepo.test.ts`. This pins the value against the constraint's allowed set so the two cannot drift apart again silently.

```ts
import { readFileSync } from 'node:fs';

describe('discord_roster confidence', () => {
  it('inserts a confidence value the schema actually permits', async () => {
    const sb = mockSupabase();
    await createSession(sb, {
      state: stateWith(2),
      name: 'ZAO Fractal 92 - Group 1',
      guildId: 'g1',
      facilitatorDiscordId: 'f1',
    });

    const rosterRows = sb.inserted('discord_roster') as { confidence: string }[];

    // The allowed set is read from the migrations rather than duplicated here,
    // so widening or narrowing the constraint moves this test with it.
    const sql = ['0002_discord_roster', '0006_async_participation']
      .map((f) => readFileSync(`supabase/migrations/${f}.sql`, 'utf8'))
      .join('\n');
    const lastCheck = [...sql.matchAll(/confidence in \(([^)]+)\)/g)].pop();
    if (!lastCheck) throw new Error('no confidence check constraint found in migrations');
    const allowed = new Set(
      lastCheck[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')),
    );

    expect(rosterRows.length).toBeGreaterThan(0);
    for (const row of rosterRows) {
      expect(allowed).toContain(row.confidence);
    }
  });
});
```

If `mockSupabase()` and `stateWith()` are not the helper names already in `gameRepo.test.ts`, use whatever that file already defines for a mock client and a `GameState` - do not add a second set of helpers.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/gameRepo.test.ts -t 'confidence value'`
Expected: FAIL - `'manual'` is not in the allowed set, and `0006_async_participation.sql` does not exist yet (the `readFileSync` throws).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0006_async_participation.sql`:

```sql
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/gameRepo.test.ts`
Expected: PASS, and the rest of the file still passes.

- [ ] **Step 5: Full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests pass (169 + the new one), tsc exit 0.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0006_async_participation.sql src/lib/gameRepo.test.ts
git commit -m "fix: /start could never record a session

discord_roster constrains confidence to five resolution values;
gameRepo writes 'manual'. The insert fails a check violation and
createSession throws. Unit tests mock Supabase, so only the database
could have caught it.

0006 widens the constraint rather than changing the caller - 'none'
means resolution was attempted and failed, which is not what a
facilitator-named group is."
```

- [ ] **Step 7: Tell the operator the clipboard SQL is now stale**

The combined migration file handed to Zaal on 2026-09-07 contains `0001`-`0005` only. It must be regenerated to include `0006` before it is run, or `/start` still fails. Say so explicitly in the task report - do not assume someone will notice.

---

### Task 2: The two constants

**Files:**
- Modify: `packages/shared/src/config.ts:18-19`
- Test: `packages/shared/src/config.test.ts` (create if absent)

**Interfaces:**
- Produces: `MIN_VOTERS: 3`, `ASYNC_WINDOW_HOURS: 12`, both exported from `@fractalbot/shared`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
  ASYNC_WINDOW_HOURS,
  MAX_GROUP_MEMBERS,
  MIN_GROUP_MEMBERS,
  MIN_VOTERS,
  RESPECT_POINTS,
} from './config.js';

describe('async participation constants', () => {
  it('MIN_VOTERS is 3', () => {
    expect(MIN_VOTERS).toBe(3);
  });

  it('MIN_VOTERS is distinct from MIN_GROUP_MEMBERS', () => {
    // They answer different questions: MIN_GROUP_MEMBERS is how few people can
    // play at all, MIN_VOTERS is how few can be trusted to rank an absent
    // person. Spec 3.2 requires they never be collapsed into one constant.
    expect(MIN_VOTERS).not.toBe(MIN_GROUP_MEMBERS);
  });

  it('the ladder still fits the cap', () => {
    expect(RESPECT_POINTS.length).toBe(MAX_GROUP_MEMBERS);
  });

  it('ASYNC_WINDOW_HOURS is 12', () => {
    expect(ASYNC_WINDOW_HOURS).toBe(12);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/shared/src/config.test.ts`
Expected: FAIL - `MIN_VOTERS` and `ASYNC_WINDOW_HOURS` are not exported.

- [ ] **Step 3: Add the constants**

In `packages/shared/src/config.ts`, after line 19:

```ts
export const MAX_GROUP_MEMBERS = 6;
export const MIN_GROUP_MEMBERS = 2;

/** How few voters can rank an absent person. Distinct from MIN_GROUP_MEMBERS,
 * which is how few people can play at all - do not collapse them.
 *
 * Three is the smallest number that is actually a vote. At 1 it is a decree;
 * at 2 a strict majority is 2, so it is unanimity and any disagreement
 * deadlocks under the no-tie-break rule. At 3 the threshold is 2, a real
 * majority that survives one dissent. Spec 2026-09-02 section 3.2. */
export const MIN_VOTERS = 3;

/** A submission counts if it landed within this many hours before the
 * session's start. Compared against session start, not wall clock, so the
 * window does not drift while a fractal runs. Spec section 5. */
export const ASYNC_WINDOW_HOURS = 12;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/shared/src/config.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/config.ts packages/shared/src/config.test.ts
git commit -m "feat: MIN_VOTERS and ASYNC_WINDOW_HOURS"
```

---

### Task 3: The engine split - ranked without voting

**Files:**
- Modify: `src/game/session.ts:28-38` (GameState), `61-82` (startSession), `89-98` (votesNeeded, awaitingVoters), `100-171` (castVote)
- Test: `src/game/session.async.test.ts` (create - keeps the existing 16 cases untouched in their own file)

**Interfaces:**
- Consumes: `MIN_VOTERS` from Task 2.
- Produces:
  - `GameState.asyncEntrantIds: string[]`
  - `startSession(input: { threadId, meetingNumber, groupNumber, participants, asyncEntrantIds? })`
  - `voters(state: GameState): Participant[]`
  - `asyncEntrants(state: GameState): Participant[]`

- [ ] **Step 1: Write the failing test**

Create `src/game/session.async.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  activeCandidates,
  asyncEntrants,
  awaitingVoters,
  castVote,
  type Participant,
  startSession,
  voters,
  votesNeeded,
} from './session.js';

const person = (id: string): Participant => ({
  discordId: id,
  displayName: `Member ${id}`,
  wallet: null,
});

/** 4 present, 2 async - the shape spec 3.1 row 4 produces. */
const mixed = () =>
  startSession({
    threadId: 't',
    meetingNumber: 92,
    groupNumber: '1',
    participants: ['v1', 'v2', 'v3', 'v4', 'a1', 'a2'].map(person),
    asyncEntrantIds: ['a1', 'a2'],
  });

describe('async entrants are votable-for and never voted-with', () => {
  it('votesNeeded counts voters only', () => {
    // 4 voters -> strict majority 3. Counting all 6 candidates would say 4.
    expect(votesNeeded(mixed())).toBe(3);
  });

  it('an async entrant never appears in awaitingVoters', () => {
    expect(awaitingVoters(mixed()).sort()).toEqual(['v1', 'v2', 'v3', 'v4']);
  });

  it('an async entrant is a candidate', () => {
    expect(activeCandidates(mixed()).map((p) => p.discordId)).toContain('a1');
  });

  it('voters and asyncEntrants partition participants', () => {
    const s = mixed();
    expect(voters(s).map((p) => p.discordId)).toEqual(['v1', 'v2', 'v3', 'v4']);
    expect(asyncEntrants(s).map((p) => p.discordId)).toEqual(['a1', 'a2']);
  });

  it('rejects a vote cast BY an async entrant', () => {
    const out = castVote(mixed(), 'a1', 'v1');
    expect(out.accepted).toBe(false);
    expect(out.reason).toBe('not_participant');
  });

  it('an async entrant can win a level on the voters alone', () => {
    let s = mixed();
    for (const v of ['v1', 'v2', 'v3']) {
      s = castVote(s, v, 'a1').state;
    }
    const out = castVote(s, 'v4', 'a1');
    expect(out.roundWinnerId).toBe('a1');
  });

  it('the round resolves without the async entrants ever voting', () => {
    let s = mixed();
    for (const v of ['v1', 'v2', 'v3']) {
      s = castVote(s, v, 'v1').state;
    }
    // All four voters have now spoken; a1 and a2 never will.
    const out = castVote(s, 'v4', 'v1');
    expect(out.awaitingVoters).toEqual([]);
    expect(out.roundWinnerId).toBe('v1');
  });

  it('defaults to no async entrants, so existing callers are unaffected', () => {
    const s = startSession({
      threadId: 't',
      meetingNumber: 92,
      groupNumber: '1',
      participants: ['v1', 'v2', 'v3'].map(person),
    });
    expect(s.asyncEntrantIds).toEqual([]);
    expect(votesNeeded(s)).toBe(2);
  });

  it('throws when async entrants are present and voters are below the floor', () => {
    expect(() =>
      startSession({
        threadId: 't',
        meetingNumber: 92,
        groupNumber: '1',
        participants: ['v1', 'v2', 'a1'].map(person),
        asyncEntrantIds: ['a1'],
      }),
    ).toThrow(/at least 3 voters/);
  });

  it('throws when an async id is not among the participants', () => {
    expect(() =>
      startSession({
        threadId: 't',
        meetingNumber: 92,
        groupNumber: '1',
        participants: ['v1', 'v2', 'v3'].map(person),
        asyncEntrantIds: ['ghost'],
      }),
    ).toThrow(/not a participant/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/game/session.async.test.ts`
Expected: FAIL - `voters` and `asyncEntrants` are not exported and `asyncEntrantIds` is not a field.

- [ ] **Step 3: Change the engine**

In `src/game/session.ts`, add to the imports on line 12:

```ts
import { MIN_GROUP_MEMBERS, MIN_VOTERS, RESPECT_POINTS, STARTING_LEVEL } from '@fractalbot/shared';
```

Add the field to `GameState` (after `participants` on line 34):

```ts
  /** Every candidate: the room plus the async entrants. */
  participants: Participant[];
  /** The subset of `participants` who submitted async. They are ranked like
   * anyone else and never vote - spec 2026-09-02 section 2. Derivation runs
   * this way round, rather than holding two lists, because section 9 requires
   * the existing 16 tests to pass unmodified. */
  asyncEntrantIds: string[];
```

Replace `startSession` (lines 61-82):

```ts
export function startSession(input: {
  threadId: string;
  meetingNumber: number;
  groupNumber: string;
  participants: Participant[];
  asyncEntrantIds?: string[];
}): GameState {
  const asyncEntrantIds = input.asyncEntrantIds ?? [];

  if (input.participants.length < MIN_GROUP_MEMBERS) {
    throw new RangeError(
      `A fractal needs at least ${MIN_GROUP_MEMBERS} members, got ${input.participants.length}`,
    );
  }

  const ids = new Set(input.participants.map((p) => p.discordId));
  for (const id of asyncEntrantIds) {
    if (!ids.has(id)) {
      throw new RangeError(`asyncEntrantIds: ${id} is not a participant`);
    }
  }

  // The floor guards the VOTER count, not the candidate count. Without this,
  // one voter plus five async entrants gives a votesNeeded of 1 - one person
  // unilaterally ranking five absent people. Spec section 3.2.
  const voterCount = input.participants.length - asyncEntrantIds.length;
  if (asyncEntrantIds.length > 0 && voterCount < MIN_VOTERS) {
    throw new RangeError(
      `A fractal with async entrants needs at least ${MIN_VOTERS} voters, got ${voterCount}`,
    );
  }

  return {
    threadId: input.threadId,
    meetingNumber: input.meetingNumber,
    groupNumber: input.groupNumber,
    status: 'active',
    currentLevel: STARTING_LEVEL,
    participants: input.participants,
    asyncEntrantIds,
    winners: [],
    votes: {},
  };
}

/** Present in the room. The only people whose votes count and the only people
 * a round waits for. */
export function voters(state: GameState): Participant[] {
  const isAsync = new Set(state.asyncEntrantIds);
  return state.participants.filter((p) => !isAsync.has(p.discordId));
}

/** Ranked without attending. Votable-for, never voted-with. */
export function asyncEntrants(state: GameState): Participant[] {
  const isAsync = new Set(state.asyncEntrantIds);
  return state.participants.filter((p) => isAsync.has(p.discordId));
}
```

Replace `votesNeeded` and `awaitingVoters` (lines 89-98):

```ts
/** Strict majority of the VOTERS - everyone present, including members who
 * already hold a level, so the bar does not fall as the candidate pool
 * shrinks. Async entrants are excluded: counting them would raise the
 * threshold using people who cannot cast a vote, and every round they touched
 * would deadlock. That is the failure already recorded as the passing test
 * "known limitation: a silent member blocks the round". */
export function votesNeeded(state: GameState): number {
  return majorityThreshold(voters(state).length);
}

export function awaitingVoters(state: GameState): string[] {
  return voters(state)
    .filter((p) => !(p.discordId in state.votes))
    .map((p) => p.discordId);
}
```

In `castVote`, change the voter check on line 112:

```ts
  if (!voters(state).some((p) => p.discordId === voterId)) return unchanged('not_participant');
```

and the threshold denominator on line 141:

```ts
  const winnerId = findRoundWinner(tally, voters(state).length);
```

Leave line 113 (`activeCandidates`) and line 155 (the completion check) exactly as they are. Both operate on candidates, and `participants` still means candidates.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/game/`
Expected: PASS - the 10 new cases, plus the existing 16 in `session.test.ts` and the playthrough cases **unmodified**. If any existing test needed editing, revert and re-read spec section 2; the split was done wrong.

- [ ] **Step 5: Commit**

```bash
git add src/game/session.ts src/game/session.async.test.ts
git commit -m "feat: a person can be ranked without voting

votesNeeded and awaitingVoters move from the candidate count to a
derived voters(); activeCandidates, finalRanking and the completion
check keep operating on all candidates. The existing 16 engine tests
pass unmodified, which is spec section 9's check on the split."
```

---

### Task 4: Seating - async entrants create the seats they occupy

**Files:**
- Create: `src/game/seating.ts`
- Test: `src/game/seating.test.ts`

**Interfaces:**
- Consumes: `MAX_GROUP_MEMBERS`, `MIN_VOTERS` from Task 2; `Participant` from `src/game/session.ts`.
- Produces: `seatGroups(input: SeatingInput): Seating`, with `SeatedGroup { voters: Participant[]; asyncEntrants: Participant[] }` and `Seating { groups: SeatedGroup[]; deferred: Participant[] }`.

- [ ] **Step 1: Write the failing test**

Create `src/game/seating.test.ts`. Every row of spec 3.1's table is a case:

```ts
import { describe, expect, it } from 'vitest';
import type { Participant } from './session.js';
import { seatGroups } from './seating.js';

const people = (prefix: string, n: number): Participant[] =>
  Array.from({ length: n }, (_, i) => ({
    discordId: `${prefix}${i + 1}`,
    displayName: `${prefix}${i + 1}`,
    wallet: null,
  }));

const shape = (present: number, async: number) => {
  const s = seatGroups({ voters: people('v', present), eligibleAsync: people('a', async) });
  return {
    groups: s.groups.map((g) => `${g.voters.length}v+${g.asyncEntrants.length}a`),
    deferred: s.deferred.length,
  };
};

describe('seatGroups - spec 3.1 table', () => {
  it('12 present + 3 async -> three groups of 4 voters + 1 async', () => {
    expect(shape(12, 3)).toEqual({ groups: ['4v+1a', '4v+1a', '4v+1a'], deferred: 0 });
  });

  it('6 present + 2 async -> TWO groups of 3 voters + 1 async', () => {
    // The gap this whole rule exists to close. Seating the room first would
    // make one full group of 6 and turn both async submitters away, every
    // week, forever.
    expect(shape(6, 2)).toEqual({ groups: ['3v+1a', '3v+1a'], deferred: 0 });
  });

  it('6 present + 0 async -> one group of 6, unchanged from today', () => {
    expect(shape(6, 0)).toEqual({ groups: ['6v+0a'], deferred: 0 });
  });

  it('4 present + 2 async -> one group of 4 voters + 2 async', () => {
    expect(shape(4, 2)).toEqual({ groups: ['4v+2a'], deferred: 0 });
  });

  it('3 present + 5 async -> seats 3, defers 2', () => {
    expect(shape(3, 5)).toEqual({ groups: ['3v+3a'], deferred: 2 });
  });

  it('2 present + 5 async -> admits nobody async, defers all 5', () => {
    expect(shape(2, 5)).toEqual({ groups: ['2v+0a'], deferred: 5 });
  });
});

describe('seatGroups - invariants', () => {
  it('defers by earliest submission, keeping the caller order', () => {
    const s = seatGroups({ voters: people('v', 3), eligibleAsync: people('a', 5) });
    expect(s.groups[0].asyncEntrants.map((p) => p.discordId)).toEqual(['a1', 'a2', 'a3']);
    expect(s.deferred.map((p) => p.discordId)).toEqual(['a4', 'a5']);
  });

  it('never exceeds the cap and never starves a group of voters', () => {
    for (let v = 0; v <= 40; v++) {
      for (let a = 0; a <= 20; a++) {
        const s = seatGroups({ voters: people('v', v), eligibleAsync: people('a', a) });
        for (const g of s.groups) {
          expect(g.voters.length + g.asyncEntrants.length).toBeLessThanOrEqual(6);
          if (g.asyncEntrants.length > 0) expect(g.voters.length).toBeGreaterThanOrEqual(3);
        }
        const seated = s.groups.reduce((n, g) => n + g.asyncEntrants.length, 0);
        expect(seated + s.deferred.length).toBe(a);
      }
    }
  });

  it('distributes voters before async entrants', () => {
    // 7 voters + 5 async: voters split 4/3 first, then async fills the
    // emptier group first. No group ends short of voters while another
    // has spares.
    const s = seatGroups({ voters: people('v', 7), eligibleAsync: people('a', 5) });
    expect(s.groups.map((g) => g.voters.length).sort()).toEqual([3, 4]);
    expect(s.groups.every((g) => g.voters.length + g.asyncEntrants.length <= 6)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/game/seating.test.ts`
Expected: FAIL - `Cannot find module './seating.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/game/seating.ts`:

```ts
// Group allocation for a fractal, including async entrants. Pure: no I/O, no
// discord.js - see src/architecture.test.ts.
//
// The rule this file exists for (spec 2026-09-02 section 3.1): group count is
// derived from the TOTAL candidate pool, not from the room. Under the obvious
// alternative - seat the people present, offer async whatever is left - six
// people present fill one group of six and every async submitter is deferred,
// again the next week, under the same rule, forever. The feature would ship
// and never fire.

import { MAX_GROUP_MEMBERS, MIN_VOTERS } from '@fractalbot/shared';
import type { Participant } from './session.js';

export interface SeatingInput {
  /** Present in the room. */
  voters: Participant[];
  /** Already gated and window-filtered, EARLIEST SUBMISSION FIRST. Order is
   * the deferral rule - see asyncEligibility.ts. */
  eligibleAsync: Participant[];
}

export interface SeatedGroup {
  voters: Participant[];
  asyncEntrants: Participant[];
}

export interface Seating {
  groups: SeatedGroup[];
  /** Async entrants who did not get a seat: over capacity, or below the voter
   * floor. Carried to the next fractal and told so. */
  deferred: Participant[];
}

export function seatGroups(input: SeatingInput): Seating {
  const { voters, eligibleAsync } = input;

  // 1. Admit. Below the floor, nobody is admitted (spec 3.2).
  const admitted = voters.length < MIN_VOTERS ? [] : eligibleAsync;

  // 2. Count groups. Never fewer than one; never so many that a group would
  //    fall under the voter floor.
  const byPool = Math.ceil((voters.length + admitted.length) / MAX_GROUP_MEMBERS);
  const byFloor = Math.floor(voters.length / MIN_VOTERS);
  const groupCount = Math.max(1, Math.min(byPool, byFloor));

  const groups: SeatedGroup[] = Array.from({ length: groupCount }, () => ({
    voters: [],
    asyncEntrants: [],
  }));

  const size = (g: SeatedGroup): number => g.voters.length + g.asyncEntrants.length;
  const smallest = (): SeatedGroup =>
    groups.reduce((min, g) => (size(g) < size(min) ? g : min), groups[0]);

  // 3. Seat. Voters first, so groups balance on the people who actually vote;
  //    async entrants then fill the emptiest groups. Same greedy round-robin
  //    as distributeIntoGroups in randomize.ts.
  for (const v of voters) smallest().voters.push(v);

  const seats = groupCount * MAX_GROUP_MEMBERS - voters.length;
  const seated = admitted.slice(0, Math.max(seats, 0));
  for (const a of seated) smallest().asyncEntrants.push(a);

  // Derived from eligibleAsync rather than from admitted, so the below-floor
  // case (admitted === []) defers everyone instead of dropping them silently.
  const seatedIds = new Set(seated.map((p) => p.discordId));
  const deferred = eligibleAsync.filter((p) => !seatedIds.has(p.discordId));

  return { groups, deferred };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/game/seating.test.ts`
Expected: PASS (10 cases, one of which sweeps 861 combinations).

- [ ] **Step 5: Commit**

```bash
git add src/game/seating.ts src/game/seating.test.ts
git commit -m "feat: seat async entrants by planning groups from the candidate pool

Six present plus two async now forms two groups of three voters plus
one async, rather than one full group turning both away. With no async
submissions the formula collapses to ceil(6/6) and today's behaviour is
untouched."
```

---

### Task 5: Eligibility - the window and the intro gate

**Files:**
- Create: `src/lib/asyncEligibility.ts`
- Test: `src/lib/asyncEligibility.test.ts`

**Interfaces:**
- Consumes: `ASYNC_WINDOW_HOURS` from Task 2; `Participant` from `src/game/session.ts`.
- Produces: `eligibleAsyncEntrants(args: { submissions: AsyncSubmission[]; sessionStartMs: number; introDiscordIds: ReadonlySet<string> }): Participant[]`, earliest submission first. `AsyncSubmission { discordId: string; displayName: string; wallet: string | null; createdAtMs: number }`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/asyncEligibility.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { type AsyncSubmission, eligibleAsyncEntrants } from './asyncEligibility.js';

const SESSION_START = Date.parse('2026-09-10T19:00:00Z');
const HOUR = 3_600_000;
const MINUTE = 60_000;

const sub = (id: string, offsetMs: number): AsyncSubmission => ({
  discordId: id,
  displayName: id,
  wallet: null,
  createdAtMs: SESSION_START - offsetMs,
});

const run = (submissions: AsyncSubmission[], intros: string[] = ['a', 'b', 'c', 'd']) =>
  eligibleAsyncEntrants({
    submissions,
    sessionStartMs: SESSION_START,
    introDiscordIds: new Set(intros),
  }).map((p) => p.discordId);

describe('the 12-hour window', () => {
  it('accepts a submission 11h59m before the session', () => {
    expect(run([sub('a', 11 * HOUR + 59 * MINUTE)])).toEqual(['a']);
  });

  it('rejects a submission 12h1m before the session', () => {
    expect(run([sub('a', 12 * HOUR + MINUTE)])).toEqual([]);
  });

  it('accepts a submission exactly on the boundary', () => {
    expect(run([sub('a', 12 * HOUR)])).toEqual(['a']);
  });

  it('rejects a submission made after the session started', () => {
    expect(run([sub('a', -MINUTE)])).toEqual([]);
  });
});

describe('the intro gate', () => {
  it('rejects someone with no intro on file', () => {
    expect(run([sub('z', HOUR)], ['a', 'b'])).toEqual([]);
  });

  it('resolves the gate at capture time, so a late intro does not qualify', () => {
    // The caller passes the intro set as it stood at session start. This test
    // pins the signature: there is no way to hand in a later set.
    expect(run([sub('a', HOUR)], [])).toEqual([]);
  });
});

describe('ordering and duplicates', () => {
  it('returns earliest submission first, because that is the deferral rule', () => {
    expect(run([sub('c', HOUR), sub('a', 5 * HOUR), sub('b', 3 * HOUR)])).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('keeps one entry per person, their earliest in-window submission', () => {
    expect(run([sub('a', 2 * HOUR), sub('a', 6 * HOUR), sub('b', 4 * HOUR)])).toEqual([
      'a',
      'b',
    ]);
  });

  it('carries displayName and wallet through', () => {
    const out = eligibleAsyncEntrants({
      submissions: [
        { discordId: 'a', displayName: 'Alex', wallet: '0xabc', createdAtMs: SESSION_START - HOUR },
      ],
      sessionStartMs: SESSION_START,
      introDiscordIds: new Set(['a']),
    });
    expect(out).toEqual([{ discordId: 'a', displayName: 'Alex', wallet: '0xabc' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/asyncEligibility.test.ts`
Expected: FAIL - `Cannot find module './asyncEligibility.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/asyncEligibility.ts`:

```ts
// Who may be ranked without attending. Pure: the caller supplies the clock and
// the intro set, so nothing here reads the wall clock or the database.
//
// Spec 2026-09-02 sections 4 and 5.

import { ASYNC_WINDOW_HOURS } from '@fractalbot/shared';
import type { Participant } from '../game/session.js';

export interface AsyncSubmission {
  discordId: string;
  displayName: string;
  wallet: string | null;
  createdAtMs: number;
}

/** Eligible entrants, EARLIEST SUBMISSION FIRST. That order is load-bearing:
 * seatGroups defers from the tail, so the ordering here is the overflow rule.
 * Earliest-first is the only rule that cannot be gamed by refreshing and does
 * not ask the facilitator to choose between people.
 *
 * `introDiscordIds` is the set as it stood when the session started. Passing
 * it in - rather than looking it up here - is what makes the gate resolve at
 * capture time: a late intro cannot retroactively qualify a submission that
 * was already made (spec section 4). */
export function eligibleAsyncEntrants(args: {
  submissions: AsyncSubmission[];
  sessionStartMs: number;
  introDiscordIds: ReadonlySet<string>;
}): Participant[] {
  const opensAt = args.sessionStartMs - ASYNC_WINDOW_HOURS * 3_600_000;

  const inWindow = args.submissions.filter(
    (s) =>
      s.createdAtMs >= opensAt &&
      s.createdAtMs <= args.sessionStartMs &&
      args.introDiscordIds.has(s.discordId),
  );

  const earliestFirst = [...inWindow].sort((a, b) => a.createdAtMs - b.createdAtMs);

  // One seat per person. Sorted ascending, so the first sighting is the
  // earliest and later submissions from the same person do not jump the queue.
  const seen = new Set<string>();
  const unique: Participant[] = [];
  for (const s of earliestFirst) {
    if (seen.has(s.discordId)) continue;
    seen.add(s.discordId);
    unique.push({ discordId: s.discordId, displayName: s.displayName, wallet: s.wallet });
  }
  return unique;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/asyncEligibility.test.ts`
Expected: PASS (9 cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/asyncEligibility.ts src/lib/asyncEligibility.test.ts
git commit -m "feat: the 12-hour window and the intro gate

The intro set is passed in rather than looked up, which is what makes
the gate resolve at capture time - a late intro cannot retroactively
qualify a submission already made."
```

---

### Task 6: Persist async membership so a restart does not change the maths

Without this, `loadSessionByThread` rehydrates every roster row as a voter. A bot restart mid-fractal would silently raise `votesNeeded` - 4 voters + 2 async resumes as 6 voters, threshold 3 becomes 4 - and the round would wait forever on two people who cannot vote. That is the exact failure the consensus rule was written to avoid.

**Files:**
- Modify: `src/lib/gameRepo.ts:54-64` (roster insert), `92-96` (roster select), `147-157` (rehydration)
- Test: `src/lib/gameRepo.test.ts`

**Interfaces:**
- Consumes: `GameState.asyncEntrantIds` from Task 3; `discord_roster.is_async` from Task 1.
- Produces: `createSession` writes `is_async`; `loadSessionByThread` returns a `GameState` whose `asyncEntrantIds` matches what was stored.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/gameRepo.test.ts`:

```ts
describe('async membership survives a restart', () => {
  it('createSession marks async entrants on their roster rows', async () => {
    const sb = mockSupabase();
    const state = startSession({
      threadId: 't1',
      meetingNumber: 92,
      groupNumber: '1',
      participants: ['v1', 'v2', 'v3', 'a1'].map((id) => ({
        discordId: id,
        displayName: id,
        wallet: null,
      })),
      asyncEntrantIds: ['a1'],
    });

    await createSession(sb, {
      state,
      name: 'ZAO Fractal 92 - Group 1',
      guildId: 'g1',
      facilitatorDiscordId: 'f1',
    });

    const rows = sb.inserted('discord_roster') as { discord_id: string; is_async: boolean }[];
    expect(rows.find((r) => r.discord_id === 'a1')?.is_async).toBe(true);
    expect(rows.find((r) => r.discord_id === 'v1')?.is_async).toBe(false);
  });

  it('loadSessionByThread rehydrates asyncEntrantIds', async () => {
    const sb = mockSupabase();
    sb.seed('fractal_sessions', [
      {
        id: 's1',
        meeting_number: 92,
        group_number: '1',
        thread_id: 't1',
        status: 'active',
      },
    ]);
    sb.seed('discord_roster', [
      { discord_id: 'v1', display_name: 'v1', wallet_address: null, is_async: false },
      { discord_id: 'v2', display_name: 'v2', wallet_address: null, is_async: false },
      { discord_id: 'v3', display_name: 'v3', wallet_address: null, is_async: false },
      { discord_id: 'a1', display_name: 'a1', wallet_address: null, is_async: true },
    ]);
    sb.seed('discord_fractal_rounds', []);

    const loaded = await loadSessionByThread(sb, 't1');

    expect(loaded?.state.asyncEntrantIds).toEqual(['a1']);
    // The point of the test: the threshold is unchanged by the restart.
    expect(votesNeeded(loaded!.state)).toBe(2);
  });
});
```

Use whatever seeding and inspection helpers `gameRepo.test.ts` already defines for the mock client - `sb.seed` and `sb.inserted` here are placeholders for those. Do not introduce a second mock.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/gameRepo.test.ts -t 'restart'`
Expected: FAIL - `is_async` is never written and `asyncEntrantIds` comes back `undefined`.

- [ ] **Step 3: Write the implementation**

In `createSession`, replace the roster insert (lines 54-64):

```ts
  // The roster is persisted here, not just held in memory, because
  // loadSessionByThread rehydrates participants from it after a restart.
  // Without this write, resume would come back with an empty group.
  //
  // is_async has to be on the row for the same reason: rehydrating an async
  // entrant as a voter would raise votesNeeded mid-fractal and the round would
  // wait forever on someone who cannot vote.
  const isAsync = new Set(state.asyncEntrantIds);
  const roster = await sb.from('discord_roster').insert(
    state.participants.map((p) => ({
      session_id: sessionId,
      discord_id: p.discordId,
      display_name: p.displayName,
      wallet_address: p.wallet,
      sources: ['thread'],
      confidence: 'manual',
      is_async: isAsync.has(p.discordId),
      captured_at: new Date().toISOString(),
    })),
  );
```

In `loadSessionByThread`, widen the roster select (line 94):

```ts
    .select('discord_id, display_name, wallet_address, is_async')
```

and replace the rehydration block (lines 147-157):

```ts
      participants: rosterRows.map((r) => ({
        discordId: r.discord_id,
        displayName: r.display_name,
        wallet: r.wallet_address,
      })),
      asyncEntrantIds: rosterRows.filter((r) => r.is_async).map((r) => r.discord_id),
```

with this immediately above the `return` (after the `currentLevel` block on line 137):

```ts
  const rosterRows = (roster.data ?? []) as {
    discord_id: string;
    display_name: string;
    wallet_address: string | null;
    is_async: boolean | null;
  }[];
```

`is_async` is typed nullable because a roster row written before Task 1's migration has no value for it; `filter((r) => r.is_async)` treats null as false, which is the right default - an unmarked row is someone who was present.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/gameRepo.test.ts`
Expected: PASS, including the pre-existing cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gameRepo.ts src/lib/gameRepo.test.ts
git commit -m "feat: async membership survives a bot restart

Rehydrating an async entrant as a voter would raise votesNeeded
mid-fractal - 4+2 resumes as 6 voters, threshold 3 becomes 4 - and the
round would wait forever on two people who cannot vote."
```

---

### Task 7: The Discord surface - mark them, and count the right people

Two user-visible bugs appear the moment async entrants exist, both from copy that assumes candidates and voters are the same set. `gameCommands.ts:37` says "The round resolves once all N have voted" using `state.participants.length` - with 4 voters and 2 async that reads 6, and the round resolves at 4. `votingPrompt` is called with `participants.length` at lines 192 and (via `participants.length`) 88.

**Files:**
- Modify: `src/discord/votingView.ts:26-44`
- Modify: `src/discord/gameCommands.ts:34-40` (votingPrompt), `:88`, `:192`
- Test: `src/discord/votingView.test.ts`

**Interfaces:**
- Consumes: `voters`, `asyncEntrants` from Task 3.
- Produces: `buildVotingRows(threadId, candidates, asyncEntrantIds?)`.

- [ ] **Step 1: Write the failing test**

Add to `src/discord/votingView.test.ts`:

```ts
describe('async entrants are visibly marked', () => {
  const candidates = ['v1', 'a1'].map((id) => ({
    discordId: id,
    displayName: id === 'a1' ? 'Async Alex' : 'Present Pat',
    wallet: null,
  }));

  it('labels an async candidate so nobody mistakes them for present', () => {
    const rows = buildVotingRows('t1', candidates, ['a1']);
    const labels = rows.flatMap((r) => r.components.map((c) => c.data.label));
    expect(labels).toContain('Present Pat');
    expect(labels).toContain('Async Alex (async)');
  });

  it('uses a different button style for async candidates', () => {
    const rows = buildVotingRows('t1', candidates, ['a1']);
    const styles = rows.flatMap((r) => r.components.map((c) => c.data.style));
    expect(new Set(styles).size).toBe(2);
  });

  it('keeps the label inside Discord 80-character cap', () => {
    const long = [{ discordId: 'a1', displayName: 'x'.repeat(200), wallet: null }];
    const rows = buildVotingRows('t1', long, ['a1']);
    expect(rows[0].components[0].data.label!.length).toBeLessThanOrEqual(80);
  });

  it('is unchanged when no async ids are given', () => {
    const rows = buildVotingRows('t1', candidates);
    const labels = rows.flatMap((r) => r.components.map((c) => c.data.label));
    expect(labels).toEqual(['Present Pat', 'Async Alex']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/discord/votingView.test.ts`
Expected: FAIL - `buildVotingRows` takes two parameters and never appends `(async)`.

- [ ] **Step 3: Write the implementation**

Replace `buildVotingRows` in `src/discord/votingView.ts`:

```ts
/** Discord allows at most 5 buttons per row and 5 rows. A group is capped at 6
 * candidates including async entrants (MAX_GROUP_MEMBERS), so two rows always
 * suffice.
 *
 * Async entrants are marked twice over - a suffix and a different style -
 * because a voter picking between names has no other way to know that one of
 * them is not in the room. Spec 2026-09-02 section 7. */
export function buildVotingRows(
  threadId: string,
  candidates: Participant[],
  asyncEntrantIds: readonly string[] = [],
): ActionRowBuilder<ButtonBuilder>[] {
  const isAsync = new Set(asyncEntrantIds);
  const SUFFIX = ' (async)';
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  for (let i = 0; i < candidates.length; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const c of candidates.slice(i, i + 5)) {
      const async = isAsync.has(c.discordId);
      // Trim the name, not the marker: an 80-character name must not push
      // "(async)" off the end of the label.
      const label = async
        ? c.displayName.slice(0, 80 - SUFFIX.length) + SUFFIX
        : c.displayName.slice(0, 80);
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(voteButtonId(threadId, c.discordId))
          .setLabel(label)
          .setStyle(async ? ButtonStyle.Secondary : ButtonStyle.Primary),
      );
    }
    rows.push(row);
  }
  return rows;
}
```

In `src/discord/gameCommands.ts`, import `voters` alongside `activeCandidates`, then replace `votingPrompt` (lines 34-40):

```ts
function votingPrompt(state: GameState, awaiting: number): string {
  // voters(state), not participants: with 4 present and 2 async this used to
  // read "all 6 have voted" while the round resolved at 4.
  const voterCount = voters(state).length;
  const asyncCount = state.asyncEntrantIds.length;
  const asyncNote =
    asyncCount > 0
      ? ` ${asyncCount} async ${asyncCount === 1 ? 'entrant is' : 'entrants are'} ranked but do not vote.`
      : '';
  return (
    `Level ${state.currentLevel}. Pick who contributed most.\n` +
    `The round resolves once all ${voterCount} present have voted ` +
    `and someone has a majority. ${awaiting} still to vote.${asyncNote}`
  );
}
```

At line 88, pass the voter count and the async ids:

```ts
    await channel.send({
      content: votingPrompt(started.state, voters(started.state).length),
      components: buildVotingRows(
        channel.id,
        activeCandidates(started.state),
        started.state.asyncEntrantIds,
      ),
    });
```

At lines 192-193:

```ts
          votingPrompt(out.state, voters(out.state).length),
        components: buildVotingRows(
          parsed.threadId,
          activeCandidates(out.state),
          out.state.asyncEntrantIds,
        ),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/discord/`
Expected: PASS, including the pre-existing `votingView.test.ts` cases - the third parameter defaults to `[]`, so nothing that called it with two arguments changes.

- [ ] **Step 5: Full suite, typecheck and architecture**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass. `src/architecture.test.ts` in particular must still pass - `seating.ts` and `asyncEligibility.ts` import no discord.js.

- [ ] **Step 6: Commit**

```bash
git add src/discord/votingView.ts src/discord/gameCommands.ts src/discord/votingView.test.ts
git commit -m "feat: mark async candidates and count only voters in the prompt

The prompt said 'once all 6 have voted' while the round resolved at 4.
Async candidates now carry a suffix and a different button style,
because a voter picking between names has no other way to know one of
them is not in the room."
```

---

## What this plan does NOT do

Carried from spec section 10, plus one item this plan adds.

- **Farcaster, mini-app and web surfaces.** Discord only. Each is its own spec and each must answer the identity problem in section 4 for itself.
- **Surface-agnostic intros.** `discord_intros` is keyed on `discord_id`, so the gate is Discord-shaped by construction.
- **Async voting.** Zaal chose ranked-but-not-voting: ranking before hearing the presentations inverts the Respect Game.
- **Wiring a submission source into `/start`.** Tasks 4 and 5 produce `seatGroups` and `eligibleAsyncEntrants` as pure functions with tests, but nothing yet reads `discord_contributions` and `discord_intros` to feed them, and `/start` still takes its participants from the facilitator. That integration is the natural next plan and needs one decision first: whether `/start` seats a single group as today, or a new facilitator command seats the whole fractal across several groups at once. Section 3.1 only pays off under the second, and that is a question for Zaal.
- **`/admin_refresh_intros`.** The gate is only meaningful once the intro table is populated; it holds 6 rows today (MEASURED 2026-09-02). v1 rebuilt it from the `#intros` channel. Porting that is not in this plan.

## Self-review

**Spec coverage.** Section 1 needs no task. Section 2 is Task 3. Section 3 cap is Task 4. 3.1 seating is Task 4. 3.2 floor is Tasks 2 and 3 (the `startSession` guard) and Task 4 (the clamp). Section 4 gate is Task 5. Section 5 window is Task 5. Section 6 - Discord only - is Task 7, and the other three surfaces are out of scope above. Section 7 marking is Task 7; the digest itself is unchanged and needs no task. Section 8 is satisfied by not touching `finalRanking`, which the Task 3 tests pin. Section 9's test list is distributed across Tasks 3, 4, 5, 7 - each of its bullets appears as a named case. Section 10 is the out-of-scope list.

One gap, stated rather than hidden: section 9's "the existing 16 `session.test.ts` cases pass unmodified" is enforced by Task 3 step 4 as a manual check rather than by an automated assertion. That is the right level - a test asserting that other tests were not edited would be worse than reading the diff.

**Type consistency.** `Participant` is used unchanged throughout. `seatGroups` returns `SeatedGroup { voters, asyncEntrants }` and `startSession` takes `asyncEntrantIds: string[]` - the shapes differ deliberately, and nothing in this plan passes a `SeatedGroup` straight into `startSession`; that conversion belongs to the integration work listed as out of scope. `voters()` is a function everywhere, never a field. `is_async` is the column, `asyncEntrantIds` the state field, `asyncEntrants()` the derived accessor - three names for three different things, each used consistently.
